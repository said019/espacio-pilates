import test from 'node:test';
import assert from 'node:assert/strict';
import { noticeWindow, validNoticeDay, claimNoticeWindow } from './paymentNoticeFrequency.mjs';
test('Mexico City boundaries and next day', () => {
  assert.equal(noticeWindow(new Date('2026-10-14T17:59:00Z')), '2026-10-14:morning');
  assert.equal(noticeWindow(new Date('2026-10-14T18:00:00Z')), '2026-10-14:afternoon');
  assert.equal(noticeWindow(new Date('2026-10-15T01:00:00Z')), '2026-10-14:night');
  assert.equal(noticeWindow(new Date('2026-10-15T06:00:00Z')), '2026-10-15:morning');
});
test('reload, message changes and three independent slots', async () => {
  const data = new Map(); const host = {window:{},localStorage:{getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)}};
  for (const iso of ['2026-10-14T16:00Z','2026-10-14T20:00Z','2026-10-15T02:00Z']) {
    assert.ok(await claimNoticeWindow({host,now:new Date(iso)}));
    assert.equal(await claimNoticeWindow({host,now:new Date(iso)}),null);
  }
  assert.equal(data.size,3);
});
test('invalid notices and storage/SSR failure do not show', async () => {
  assert.equal(validNoticeDay({texto:'Hi',fecha:'2026-02-30'}),false);
  assert.equal(validNoticeDay({texto:'Hi',fecha:'2026-10-15'},new Date('2026-10-14T16:00Z')),true);
  assert.equal(await claimNoticeWindow({host:{}}),null);
  assert.equal(await claimNoticeWindow({host:{window:{},get localStorage(){throw Error('blocked')}}}),null);
});
test('cross-tab lock rechecks storage and canceled requests consume nothing',async()=>{
 const data=new Map();let chain=Promise.resolve();
 const host={window:{},localStorage:{getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)},navigator:{locks:{request:(_key,run)=>{const job=chain.then(run);chain=job;return job;}}}};
 const now=new Date('2026-10-14T16:00Z');
 const results=await Promise.all([claimNoticeWindow({host,now}),claimNoticeWindow({host,now})]);
 assert.equal(results.filter(Boolean).length,1);
 assert.equal(await claimNoticeWindow({host,now:new Date('2026-10-14T20:00Z'),canShow:()=>false}),null);
 assert.equal(data.size,1);
});
