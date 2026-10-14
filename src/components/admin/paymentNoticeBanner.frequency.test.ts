import {test,expect,vi} from 'vitest';
import {montarAviso} from './paymentNoticeBanner.js';
test('one popup per period survives remount, permits afternoon and night, blocks storage errors',async()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-14T16:00:00Z'));
 const entries=new Map<string,string>();
 vi.stubGlobal('localStorage',{getItem:(k:string)=>entries.get(k)||null,setItem:(k:string,v:string)=>entries.set(k,v)});
 vi.stubGlobal('window',{location:{origin:'https://example.test'},addEventListener:vi.fn(),removeEventListener:vi.fn()});
 vi.stubGlobal('document',{hidden:false,addEventListener:vi.fn(),removeEventListener:vi.fn()});
 const fetchImpl=vi.fn(async()=>new Response(JSON.stringify({aviso:{fecha:'2026-10-15',texto:'Pago mañana',ciclo:'2026-10'}})));
 const mount=()=>{const notices:any[]=[];const stop=montarAviso({hidden:true,textContent:'',setAttribute:vi.fn()} as unknown as HTMLElement,{endpoint:'/api/admin/platform-payment-notice',fetchImpl,onNotice:(n:any)=>{if(n)notices.push(n);}});return {stop,notices};};
 let a:any,b:any;
 try{
  a=mount();await vi.advanceTimersByTimeAsync(10);expect(a.notices).toHaveLength(1);a.stop();
  b=mount();await vi.advanceTimersByTimeAsync(10);expect(b.notices).toHaveLength(0);b.stop();
  vi.setSystemTime(new Date('2026-10-14T18:00:00Z'));a=mount();await vi.advanceTimersByTimeAsync(10);expect(a.notices[0].frequencyKey).toContain('afternoon');a.stop();
  vi.setSystemTime(new Date('2026-10-15T01:00:00Z'));a=mount();await vi.advanceTimersByTimeAsync(10);expect(a.notices[0].frequencyKey).toContain('night');a.stop();
  expect(entries.size).toBe(3);
  vi.setSystemTime(new Date('2026-10-15T16:00:00Z'));vi.stubGlobal('localStorage',{getItem:()=>{throw new Error('blocked');}});
  b=mount();await vi.advanceTimersByTimeAsync(10);expect(b.notices).toHaveLength(0);
 }finally{a?.stop();b?.stop();vi.useRealTimers();vi.unstubAllGlobals();}
});
test('late superseded and disposed responses never hide the current popup',async()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-14T16:00Z'));
 const storage=new Map();const events=new Map();const pending:Array<(r:Response)=>void>=[];
 vi.stubGlobal('localStorage',{getItem:(k:string)=>storage.get(k)||null,setItem:(k:string,v:string)=>storage.set(k,v)});
 vi.stubGlobal('window',{location:{origin:'https://example.test'},addEventListener:(n:string,f:any)=>events.set(n,f),removeEventListener:vi.fn()});
 vi.stubGlobal('document',{hidden:false,addEventListener:vi.fn(),removeEventListener:vi.fn()});
 const onNotice=vi.fn();const element={hidden:true,textContent:'',setAttribute:vi.fn()} as unknown as HTMLElement;
 const stop=montarAviso(element,{endpoint:'/api/admin/platform-payment-notice',fetchImpl:()=>new Promise<Response>(resolve=>pending.push(resolve)),onNotice});
 try{
  events.get('focus')();
  pending[1](new Response(JSON.stringify({aviso:{fecha:'2026-10-15',texto:'Current',ciclo:'2026-10'}})));
  await vi.advanceTimersByTimeAsync(10);expect(element.hidden).toBe(false);const count=onNotice.mock.calls.length;
  pending[0](new Response('',{status:503}));await vi.advanceTimersByTimeAsync(10);
  expect(element.hidden).toBe(false);expect(onNotice.mock.calls).toHaveLength(count);
  events.get('focus')();stop();const disposedCalls=onNotice.mock.calls.length;
  pending[2](new Response('',{status:503}));await vi.advanceTimersByTimeAsync(10);
  expect(onNotice.mock.calls).toHaveLength(disposedCalls);
 }finally{stop();vi.useRealTimers();vi.unstubAllGlobals();}
});
