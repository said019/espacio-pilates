import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registerPaymentNoticeRoute} from './paymentNoticeRoute.mjs';
test('notice route uses session guard and excludes staff and clients',async()=>{
 const auth=()=>{};let route;let calls=0;
 for(const role of ['client','instructor','reception',null,'admin','super_admin']){
  registerPaymentNoticeRoute({get:(path,guard,handler)=>{assert.equal(path,'/api/admin/platform-payment-notice');assert.equal(guard,auth);route=handler;}},{authMiddleware:auth,pool:{query:async()=>({rows:role?[{role}]:[]})},consultar:async()=>{calls++;return null;}});
  const res={code:200,set(){},status(code){this.code=code;return this;},json(body){this.body=body;}};
  await route({userId:'fixture'},res);
  assert.equal(res.code,['admin','super_admin'].includes(role)?200:403);
 }
 assert.equal(calls,2);
});
