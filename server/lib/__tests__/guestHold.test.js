import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, it, expect, vi } from 'vitest';
import { consentGuard } from '../consent.js';
import { effectiveWalkInAmount, isComplimentaryWalkInPlan } from '../walkIn.js';

const source=readFileSync('server/index.js','utf8');
async function hold({body={name:'Invitada',phone:'4441234567'},full=false,cancelled=false,admin=true}={}) {
  let handlers;
  const query=vi.fn(async(sql,args)=>{
    if(sql.startsWith('ALTER') || ['BEGIN','COMMIT','ROLLBACK'].includes(sql)) return {rows:[]};
    if(sql.includes('FROM classes c')) return {rows:[{id:'class',branch_id:'pozos',current_bookings:full?6:0,max_capacity:6,status:cancelled?'cancelled':'scheduled',class_category:'pilates'}]};
    if(sql.includes('INSERT INTO bookings')) return {rows:[{id:'booking',user_id:null,guest_name:args[1],guest_phone:args[2],order_id:args[3],status:'confirmed'}]};
    if(sql.startsWith('UPDATE classes')) return {rows:[]};
    throw new Error('Unexpected query '+sql);
  });
  const client={query,release:vi.fn()};
  const pool={connect:vi.fn().mockResolvedValue(client),query};
  const start=source.indexOf('app.post("/api/admin/classes/:id/walkin",');
  vm.runInNewContext(source.slice(start,source.indexOf('\n});',start)+4),{
    app:{post:(_path,...registered)=>{handlers=registered;}},pool,console,consentGuard,
    adminMiddleware:(req,res,next)=>req.admin?next():res.status(403).json({message:'Admin required'}),
    normalizePhoneForStorage:v=>v,programForClassCategory:v=>v,effectiveWalkInAmount,isComplimentaryWalkInPlan,
  });
  const res={code:200,status(code){this.code=code;return this;},json(data){this.body=data;return this;}};
  const req={body,admin,params:{id:'class'},userId:'admin'};
  const run=i=>handlers[i]?.(req,res,()=>run(i+1));
  await run(0);
  return {res,query,pool};
}
describe('admin guest holds without account or plan',()=>{
  it.each([{name:'Invitada',phone:'4441234567'},{name:'Invitada',amount:0}])('allows name and optional phone without account, membership or charge',async body=>{
    const {res,query}=await hold({body});
    expect(res.code).toBe(200);
    expect(res.body.data).toMatchObject({user_id:null,guest_name:'Invitada',orderId:null,amount:0,affectsInscription:false});
    expect(query.mock.calls.some(([sql])=>sql.includes('INSERT INTO orders'))).toBe(false);
    expect(query).toHaveBeenCalledWith('COMMIT');
  });
  it('still requires admin authorization',async()=>{
    const {res,pool}=await hold({admin:false});expect(res.code).toBe(403);expect(pool.connect).not.toHaveBeenCalled();
  });
  it.each([{full:true},{cancelled:true}])('rejects full or cancelled classes',async options=>{
    const {res,query}=await hold(options);expect(res.code).toBeGreaterThanOrEqual(400);
    expect(query.mock.calls.some(([sql])=>sql.includes('INSERT INTO bookings'))).toBe(false);
  });
  it('requires a guest name',async()=>{expect((await hold({body:{}})).res.code).toBe(400);});
});
