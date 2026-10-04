// Entirely offline: compare the candidate image with the unchanged Caddyfile
// and exactly its compiled files. No browser JS executes and no API is called.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFile, readdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { request } from 'node:http';
import { createHash } from 'node:crypto';
import { gunzipSync, brotliDecompressSync } from 'node:zlib';
import { setTimeout as delay } from 'node:timers/promises';

const image = process.env.CANDIDATE_IMAGE || 'static-nginx-candidate';
const caddyImage = 'caddy:2.11.4-alpine@sha256:6aeddd44c3078b0f9a35206472a11420648a79c184603ef95957d0a20044cb2b';
const docker = args => execFileSync('docker', args, { encoding: 'utf8', maxBuffer: 8*1024*1024 }).trim();
const hash = b => createHash('sha256').update(b).digest('hex');
const decode = r => r.headers['content-encoding']==='br' ? brotliDecompressSync(r.body) : r.headers['content-encoding']==='gzip' ? gunzipSync(r.body) : r.body;
const mime = value => {
  const type=(value||'').split(';')[0];
  return ['application/javascript','text/javascript'].includes(type) ? 'javascript' : ['image/vnd.microsoft.icon','image/x-icon'].includes(type) ? 'icon' : type;
};
const temp=await mkdtemp(join(tmpdir(),'static-nginx-contract-'));
const containers=new Map();
const result={status:'RUNNING',scope:'Offline real application artifacts/config, synthetic VITE_API_URL, no production calls; no billed RAM savings claim',checks:[],cleanup:[]};
const out=resolve(process.env.CONTRACT_RESULT || 'nginx-runtime-contract-result.json');
function register(id) {
  const [data]=JSON.parse(docker(['inspect',id]));
  containers.set(id,data.Mounts.filter(m=>m.Type==='volume').map(m=>m.Name));
  return data;
}
function cleanup(id) {
  assert.ok(containers.has(id));
  const volumes=containers.get(id);docker(['rm','-f','-v',id]);
  assert.equal(docker(['container','ls','-aq','--filter','id='+id]),'');
  const remaining=new Set(docker(['volume','ls','--format','{{.Name}}']).split('\n'));
  assert.ok(volumes.every(v=>!remaining.has(v)));
  result.cleanup.push({containerRemoved:true,ownedAnonymousVolumes:volumes.length,removed:true});containers.delete(id);
}
function raw(port,path,headers={},method='GET') {
  return new Promise((ok,no)=>{
    const q=request({hostname:'127.0.0.1',port,path,method,headers:{'Accept-Encoding':'identity',...headers},agent:false},r=>{
      const parts=[];r.on('data',b=>parts.push(b));r.on('error',no);r.on('end',()=>ok({status:r.statusCode,headers:r.headers,body:Buffer.concat(parts)}));
    });q.setTimeout(10000,()=>q.destroy(new Error('Local contract timeout')));q.on('error',no);q.end();
  });
}
async function ready(id,insidePort) {
  const [data]=JSON.parse(docker(['inspect',id]));const port=Number(data.NetworkSettings.Ports[insidePort+'/tcp'][0].HostPort);
  for(let i=0;i<100;i++){try{if((await raw(port,'/')).status===200)return port;}catch{}
    assert.equal(docker(['inspect','-f','{{.State.Running}}',id]),'true','Container must stay running');await delay(100);}
  throw new Error('Readiness timeout');
}
async function collect(dir,prefix='') {
  let all=[];for(const e of await readdir(dir,{withFileTypes:true})) {
    assert.equal(e.isSymbolicLink(),false,'No symlink in build output');
    if(e.isDirectory())all.push(...await collect(join(dir,e.name),prefix+e.name+'/'));
    else if(!/\.(br|gz)$/.test(e.name))all.push(prefix+e.name);
  }return all.sort();
}
const urlPath=file=>'/'+file.split('/').map(encodeURIComponent).join('/');
function same(a,b,path) {
  assert.equal(b.status,a.status,path+' status');assert.equal(b.headers.location,a.headers.location,path+' redirect');
  if(a.status>=300&&a.status<400)return;
  assert.equal(hash(decode(b)),hash(decode(a)),path+' decoded bytes');
  assert.equal(mime(b.headers['content-type']),mime(a.headers['content-type']),path+' MIME');
  assert.equal(b.headers['cache-control'],a.headers['cache-control'],path+' Cache-Control');
}
function head(a,full) {
  assert.equal(a.status,200);assert.equal(a.body.length,0);assert.equal(mime(a.headers['content-type']),mime(full.headers['content-type']));
  assert.equal(a.headers.etag,full.headers.etag);assert.equal(a.headers['content-encoding'],full.headers['content-encoding']);
  if(a.headers['content-length']!==undefined){assert.match(a.headers['content-length'],/^\d+$/);assert.equal(Number(a.headers['content-length']),full.body.length);}
}
try {
  // Export from the built candidate: both servers use the same single build.
  const exportId=docker(['create','--entrypoint','true',image]);register(exportId);
  docker(['cp',exportId+':/srv/frontend/public',join(temp,'dist')]);cleanup(exportId);
  const files=await collect(join(temp,'dist'));assert.ok(files.includes('index.html'));result.originalFiles=files.length;
  const config=resolve('Caddyfile');
  const caddyId=docker(['run','-d','-e','PORT=8080','-p','127.0.0.1::8080','-w','/app','-v',join(temp,'dist')+':/app/dist:ro','-v',config+':/app/Caddyfile:ro',caddyImage,'caddy','run','--config','Caddyfile','--adapter','caddyfile']);register(caddyId);
  // Non-default internal PORT proves the durable launcher substitutes only PORT.
  const nginxId=docker(['run','-d','-e','PORT=8413','-p','127.0.0.1::8413',image]);register(nginxId);
  // Reproduce the shared root railway.json override from the image's own cwd.
  // No -w override: an absent/wrong WORKDIR must make this regression fail.
  const legacyId=docker(['run','-d','-e','PORT=8414','-e','SERVE_MODE=frontend','-p','127.0.0.1::8414',image,'sh','start.sh']);register(legacyId);
  const aPort=await ready(caddyId,8080),bPort=await ready(nginxId,8413),legacyPort=await ready(legacyId,8414);
  for(const [id,mode] of [[nginxId,'CMD'],[legacyId,'sh start.sh']]) {
    const [info]=JSON.parse(docker(['inspect',id]));
    assert.equal(info.Config.WorkingDir,'/srv/frontend',mode+' working directory');
    assert.deepEqual(info.Config.Cmd,mode==='CMD'?['/usr/local/bin/start-static-nginx']:['sh','start.sh']);
    assert.equal(docker(['exec',id,'cat','/proc/1/comm']),'nginx',mode+' must exec nginx as PID1');
    docker(['exec',id,'sh','-c','test ! -e /app/node_modules && ! command -v node && ! command -v caddy']);
    result.checks.push({kind:'LAUNCH_MODE',mode,workingDirectory:info.Config.WorkingDir,pid1:'nginx'});
  }
  result.runtimeOnlyNginx=true;
  const jsx=await readFile('src/App.tsx','utf8');
  const routes=[...new Set([...jsx.matchAll(/path=["']([^"']+)["']/g)].map(m=>m[1]).filter(p=>p.startsWith('/')).map(p=>p.replace(/:[^/]+/g,'fixture-id').replace('*','unknown')))];
  for(const path of [...new Set([...routes,...files.map(urlPath),'/login/','/missing-file.js','/50x.html','/.env','/server/package.json','/api/local-static-fixture','/deploy/static-nginx/Dockerfile','/index','/index.html?foo=bar'])]) {
    const a=await raw(aPort,path),b=await raw(bPort,path);same(a,b,path);
    result.checks.push({kind:'GET',path,status:b.status,decodedSHA256:b.status===200?hash(decode(b)):null});
  }
  const directories=[...new Set(files.filter(f=>f.includes('/')).map(f=>'/'+f.slice(0,f.lastIndexOf('/'))))];
  for(const path of directories.flatMap(p=>[p,p+'/'])) {
    const a=await raw(aPort,path),b=await raw(bPort,path);
    assert.equal(b.status,a.status,path+' directory status');
    assert.equal(b.headers.location,a.headers.location,path+' directory redirect');
    if(a.status===200)same(a,b,path);
    result.checks.push({kind:'DIRECTORY',path,status:b.status});
  }
  const js=files.find(p=>/^assets\/index-.*\.js$/.test(p));assert.ok(js,'Main JavaScript asset');
  for(const path of ['/', '/login',urlPath(js),'/start.sh']) {
    const normal=await raw(bPort,path),legacy=await raw(legacyPort,path);
    same(normal,legacy,path+' legacy launcher');
    head(await raw(legacyPort,path,{},'HEAD'),legacy);
    assert.notEqual(hash(legacy.body),hash(await readFile('deploy/static-nginx/start-legacy-static-nginx.sh')),'Launcher must stay outside the public root');
    result.checks.push({kind:'LEGACY_LAUNCH_HTTP',path,status:legacy.status,decodedSHA256:hash(decode(legacy))});
  }
  const sw=files.includes('sw.js')?'/sw.js':files.includes('push-sw.js')?'/push-sw.js':null;
  if(sw) for(const path of [sw+'/',sw+'/?contract=1']) {
    const a=await raw(aPort,path),b=await raw(bPort,path);same(a,b,path);
    result.checks.push({kind:'WORKER_CANONICAL_PATH',path,status:b.status});
  }
  if(files.includes('version.json')) {
    const version=JSON.parse(await readFile(join(temp,'dist','version.json'),'utf8')).version;
    for(const cb of ['1','2']) {
      const path='/version.json?cb='+cb;const a=await raw(aPort,path,{'Cache-Control':'no-cache'}),b=await raw(bPort,path,{'Cache-Control':'no-cache'});
      same(a,b,path);assert.equal(JSON.parse(b.body).version,version);assert.equal(b.headers['cache-control'],undefined);
      result.checks.push({kind:'VERSION_POLL',path,status:b.status});
    }
  }
  for(const path of [...new Set(['/',urlPath(js),...(sw?[sw]:[])])])for(const encoding of ['br','gzip','br, gzip','br;q=0, gzip;q=0','br;q=0, gzip;q=1','gzip;q=0, br;q=1']) {
    const a=await raw(aPort,path,{'Accept-Encoding':encoding}),b=await raw(bPort,path,{'Accept-Encoding':encoding});same(a,b,path);
    assert.equal(b.headers['content-encoding'],a.headers['content-encoding']);assert.equal(b.body.length,a.body.length,'Encoded transfer size must match existing representation');
    if(b.headers['content-encoding'])assert.match(b.headers.vary||'',/Accept-Encoding/i);
    const hA=await raw(aPort,path,{'Accept-Encoding':encoding},'HEAD'),hB=await raw(bPort,path,{'Accept-Encoding':encoding},'HEAD');head(hA,a);head(hB,b);
    result.checks.push({kind:'ENCODING+HEAD',path,encoding,wireBytes:b.body.length});
  }
  for(const path of [urlPath(js),'/index.html','/favicon.ico',...(sw?[sw]:[])].filter(p=>p!=='/index.html')) {
    if(!files.includes(decodeURIComponent(path.slice(1))))continue;
    for(const port of [aPort,bPort]) {
      const full=await raw(port,path);assert.ok(full.headers.etag);
      assert.equal((await raw(port,path,{'If-None-Match':full.headers.etag})).status,304);
      const range=await raw(port,path,{Range:'bytes=0-9'});assert.equal(range.status,206);assert.equal(hash(range.body),hash(full.body.subarray(0,10)));
      assert.equal((await raw(port,path,{Range:'bytes=999999999-'})).status,416);
      assert.equal((await raw(port,path,{},'POST')).status,405);
    }
    result.checks.push({kind:'304+206+416+405',path});
  }
  for(const path of [urlPath(js),...(sw?[sw]:[])]) for(const encoding of ['br','gzip']) {
    const aFull=await raw(aPort,path,{'Accept-Encoding':encoding}),bFull=await raw(bPort,path,{'Accept-Encoding':encoding});
    for(const port of [aPort,bPort]) {
      const invalid=await raw(port,path,{'Accept-Encoding':encoding,Range:'bytes=999999999-'});
      assert.equal(invalid.status,416,path+' '+encoding+' unsatisfiable range');
    }
    for(const matched of [true,false]) {
      const a=await raw(aPort,path,{'Accept-Encoding':encoding,Range:'bytes=0-9','If-Range':matched?aFull.headers.etag:'"fixture-other-etag"'});
      const b=await raw(bPort,path,{'Accept-Encoding':encoding,Range:'bytes=0-9','If-Range':matched?bFull.headers.etag:'"fixture-other-etag"'});
      result.checks.push({kind:'ENCODED_RANGE_DIAGNOSTIC',path,encoding,matched,caddyStatus:a.status,nginxStatus:b.status,caddyHeaders:a.headers,nginxHeaders:b.headers});
      assert.equal(b.status,a.status,path+' '+encoding+' compressed If-Range status');
      assert.equal(b.headers['content-encoding'],a.headers['content-encoding']);
      assert.equal(hash(b.body),hash(a.body),path+' compressed If-Range wire bytes');
      assert.equal(b.headers['content-range'],a.headers['content-range']);
      result.checks.push({kind:'ENCODED_RANGE_IF_RANGE',path,encoding,matched,status:b.status});
    }
  }
  for(const command of [[],['sh','start.sh']]) for(const value of ['0','65536','8080;invalid']) {
    const badId=docker(['create','-e','PORT='+value,image,...command]);register(badId);
    const stopped=spawnSync('docker',['start','-a',badId],{encoding:'utf8',timeout:10000});
    assert.ok(!stopped.error,'Invalid PORT process must terminate promptly');
    const [state]=JSON.parse(docker(['inspect',badId]));
    assert.equal(state.State.Running,false);assert.notEqual(state.State.ExitCode,0,'Invalid PORT must fail before launch');
    cleanup(badId);result.checks.push({kind:'INVALID_PORT_REJECTED',mode:command.length?'sh start.sh':'CMD',value});
  }
  result.routes=routes.length;result.status='PASS';
}catch(error){result.status='FAIL';result.error=error.stack;throw error;}
finally {
  const failures=[];for(const id of [...containers.keys()])try{cleanup(id);}catch(error){failures.push(error.message);}
  if(failures.length){result.status='FAIL';result.cleanupErrors=failures;}
  await rm(temp,{recursive:true,force:true});await writeFile(out,JSON.stringify(result,null,2)+'\n');
  if(failures.length)throw new Error('Owned container/volume cleanup failed');
}
