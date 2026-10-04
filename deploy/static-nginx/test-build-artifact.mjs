// Verify that the public runtime contains exactly one real application build.
// Includes public files, build identity, worker/version contracts and .br/.gz bytes.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
const docker=args=>execFileSync('docker',args,{encoding:'utf8'}).trim();
const temp=await mkdtemp(join(tmpdir(),'static-build-artifact-'));
const owned=[];const result={status:'RUNNING',publicApiBuildInput:process.env.VITE_API_URL,sourceCommit:process.env.BUILD_GIT_SHA,files:[],cleanup:[]};
async function manifest(dir,prefix='') {
  const files={};
  for(const e of await readdir(dir,{withFileTypes:true})) {
    assert.equal(e.isSymbolicLink(),false,'Build output must not contain symlinks');
    const name=prefix+e.name;
    if(e.isDirectory())Object.assign(files,await manifest(join(dir,e.name),name+'/'));
    else files[name]=createHash('sha256').update(await readFile(join(dir,e.name))).digest('hex');
  }
  return Object.fromEntries(Object.entries(files).sort(([a],[b])=>a.localeCompare(b)));
}
try {
  const trees=[];
  for(const [name,image] of [['build','static-app-builder'],['runtime','static-nginx-candidate']]) {
    const id=docker(['create','--entrypoint','true',image]);owned.push(id);
    docker(['cp',id+ (name==='runtime'?':/srv/frontend/public':':/app/dist'),join(temp,name)]);
    trees.push(await manifest(join(temp,name)));
  }
  assert.deepEqual(trees[1],trees[0],'Final runtime must contain exactly the app build, without base-image defaults');
  const publicFiles=await manifest(resolve('public'));
  for(const [name,digest] of Object.entries(publicFiles)) {
    if(name==='sw.js' && process.env.STATIC_APP==='casa-she') continue;
    assert.equal(trees[0][name],digest,'Public asset must retain its bytes: '+name);
  }
  const scripts=await Promise.all(Object.keys(trees[0]).filter(p=>p.startsWith('assets/')&&p.endsWith('.js')).map(p=>readFile(join(temp,'build',p),'utf8')));
  for(const key of ['VITE_API_URL','VITE_VAPID_PUBLIC_KEY','VITE_MP_PUBLIC_KEY']) if(process.env[key]) {
    assert.ok(scripts.some(s=>s.includes(process.env[key])),key+' must be present in compiled client');
  }
  if(process.env.STATIC_APP==='casa-she') {
    assert.match(process.env.BUILD_GIT_SHA||'',/^[0-9a-f]{40}$/);
    const sw=await readFile(join(temp,'build','sw.js'),'utf8');
    assert.ok(sw.includes('bmb-'+process.env.BUILD_GIT_SHA.slice(0,8)),'Keep the existing worker commit stamp');
  }
  if(process.env.STATIC_APP==='Catarsis') {
    const version=JSON.parse(await readFile(join(temp,'build','version.json'),'utf8')).version;
    assert.ok(Number.isFinite(Date.parse(version)));
    assert.ok(scripts.some(s=>s.includes(version)),'Version endpoint must match compiled application version');
    result.version=version;
  }
  result.lockSHA256=createHash('sha256').update(await readFile('package-lock.json')).digest('hex');
  result.caddyfileSHA256=createHash('sha256').update(await readFile('Caddyfile')).digest('hex');
  result.buildMode=process.env.STATIC_BUILD_MODE;
  result.buildImage='node:20.18.1-alpine';
  result.publicFilesVerified=Object.keys(publicFiles).length;
  result.runtimeTreeMatchesBuild=true;
  result.files=Object.keys(trees[0]);result.sha256=trees[0];result.status='PASS';
} catch(error) {result.status='FAIL';result.error=error.stack;throw error;}
finally {
  const failures=[];
  for(const id of owned)try {
    const [info]=JSON.parse(docker(['inspect',id]));
    const volumes=info.Mounts.filter(m=>m.Type==='volume').map(m=>m.Name);
    docker(['rm','-f','-v',id]);
    assert.equal(docker(['container','ls','-aq','--filter','id='+id]),'');
    const remaining=new Set(docker(['volume','ls','--format','{{.Name}}']).split('\n'));
    assert.ok(volumes.every(v=>!remaining.has(v)));
    result.cleanup.push({removed:true,anonymousVolumes:volumes.length});
  } catch(error) {failures.push(error.message);}
  if(failures.length){result.status='FAIL';result.cleanupErrors=failures;}
  await rm(temp,{recursive:true,force:true});
  await writeFile(resolve('nginx-build-artifact-result.json'),JSON.stringify(result,null,2)+'\n');
  if(failures.length)throw new Error('Build-equivalence owned resources cleanup failed');
}
