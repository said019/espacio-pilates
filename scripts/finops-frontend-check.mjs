import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

const cwd=process.cwd();
const port=3389;
const base=`http://127.0.0.1:${port}`;
const env={...process.env,PATH:path.dirname(process.execPath)+':'+process.env.PATH,SERVE_MODE:'frontend',PORT:String(port),NO_UPDATE_NOTIFIER:'1'};
// No backend is started, and tests only request the local static server.
delete env.DATABASE_URL;
const assets=fs.readdirSync('dist/assets');
const js='/assets/'+assets.find(n=>n.endsWith('.js'));
const css='/assets/'+assets.find(n=>n.endsWith('.css'));
const cases=[['/'],['/client/bookings'],['/admin'],['/auth/reset-password'],
 ['/missing-spa-route'],[js],[css],[css,{method:'HEAD'}],
 [css,{headers:{Range:'bytes=0-31'}}],[css,{headers:{'Accept-Encoding':'gzip'}}]];
const hash=b=>createHash('sha256').update(b).digest('hex');
function processTree(root){
 const rows=execFileSync('ps',['-axo','pid=,ppid=,rss=,comm='],{encoding:'utf8'}).trim().split('\n').map(l=>{const [pid,ppid,rss,...command]=l.trim().split(/\s+/);return {pid:Number(pid),ppid:Number(ppid),rss:Number(rss),command:command.join(' ')};});
 const ids=new Set([root]);let changed=true;while(changed){changed=false;for(const r of rows)if(ids.has(r.ppid)&&!ids.has(r.pid)){ids.add(r.pid);changed=true;}}
 return rows.filter(r=>ids.has(r.pid));
}
async function request(url,options={}){
 const r=await fetch(base+url,{...options,redirect:'manual',signal:AbortSignal.timeout(5000)});
 const b=Buffer.from(await r.arrayBuffer());
 return {url,status:r.status,hash:hash(b),bytes:b.length,headers:Object.fromEntries(['content-type','cache-control','etag','location','accept-ranges','content-range','content-encoding'].map(k=>[k,r.headers.get(k)]))};
}
async function measure(mode){
 const args=mode==='old'?['-c','exec npx serve -s dist -l "$PORT"']:['start.sh'];
 const child=spawn('/bin/sh',args,{cwd,env,detached:true,stdio:'ignore'});
 const finished=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
 let exited=false;child.once('exit',()=>{exited=true;});
 try {
  let ready=false;for(let i=0;i<80;i++){if(exited)throw Error('Static process exited early');try{await request('/');ready=true;break;}catch{await delay(100);}}
  assert.ok(ready,'Static server ready');
  const responses=[];for(const [url,options]of cases)responses.push(await request(url,options));
  const etag=responses.find(r=>r.url===css).headers.etag;
  responses.push(await request(css,{headers:{'If-None-Match':etag}}));
  for(let i=0;i<12;i++)await Promise.all(cases.map(([url,options])=>request(url,options)));
  await delay(300);
  const tree=processTree(child.pid),rssMiB=tree.reduce((n,p)=>n+p.rss,0)/1024;
  child.kill('SIGTERM');
  const termination=await Promise.race([finished,delay(3000).then(()=>({timeout:true}))]);
  if(mode==='new')assert.ok(!termination.timeout,'Direct server terminates on SIGTERM');
  return {mode,responses,rssMiB,processes:tree.map(p=>({command:p.command,rssMiB:p.rss/1024})),termination};
 } finally {
  // Only the detached group created above; never a system-wide kill by name.
  try{process.kill(-child.pid,'SIGKILL');}catch(e){if(e.code!=='ESRCH')throw e;}
  await finished;
 }
}
const old=await measure('old');await delay(200);const next=await measure('new');
assert.deepEqual(next.responses,old.responses);
assert.ok(next.rssMiB<old.rssMiB,'Measured process-tree memory improves');
assert.equal(next.processes.length,1);
const start=fs.readFileSync('start.sh','utf8');
assert.match(start,/else\s+echo "▶ Backend API"\s+exec node server\/index\.js\s+fi/);
console.log(JSON.stringify({node:process.version,requestCases:cases.length+1,requestsPerMode:132,old,next,sameHttp:true,backendBranchUnchanged:true,localBenchmarkNotMonthlySavings:true},null,2));
