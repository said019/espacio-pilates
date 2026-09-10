import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { consentGuard, registerConsentRoutes, consentVersion, consentText, validSignature } from '../consent.js';

const signature = [[[0.1,0.2],[0.5,0.8],[0.8,0.1]]];
const response = () => ({ code: 200, status(code) { this.code=code; return this; }, json(body) { this.body=body; return this; } });
function harness() {
  const rows = [];
  const pool = { query: vi.fn(async (sql,args) => {
    if (sql.startsWith('INSERT')) {
      if (!rows.some(r => r.user_id===args[0] && r.version===args[1])) rows.push({ id:'signed', user_id:args[0], version:args[1], document_text:args[2], signer_name:args[3], signer_role:args[4], signature:JSON.parse(args[5]) });
      return { rows:[] };
    }
    return { rows: rows.filter(r => r.user_id===args[0] && (!args[1] || r.version===args[1])) };
  }) };
  const routes = {};
  const auth = () => {}, admin = () => {};
  const app = Object.fromEntries(['get','post'].map(method => [method,(path,...handlers) => { routes[`${method} ${path}`] = handlers; }]));
  registerConsentRoutes(app,pool,auth,admin);
  const post = async (body,userId='client') => { const res=response(); await routes['post /api/consent'].at(-1)({ userId,body },res); return res; };
  return { pool, rows, routes, post, auth, admin };
}
const payload = { accepted:true,version:consentVersion,signerName:'Clienta Prueba',signerRole:'adult',signature };
describe('mandatory consent', () => {
  it.each([undefined, [], [[[0,0]]], [[[0,0],[0,0]]], [[[0,0],[2,1]]], [[[0,0],['0.5',0.5]]]])('rejects blank/invalid signature %j', value => expect(validSignature(value)).toBe(false));
  it('accepts bounded strokes', () => expect(validSignature(signature)).toBe(true));
  it.each([{accepted:false}, {signature:[]}, {signerName:''}, {signerRole:'other'}, {version:'old'}])('rejects invalid submission %j', async bad => {
    const h=harness(); expect((await h.post({...payload,...bad})).code).toBeGreaterThanOrEqual(400); expect(h.rows).toHaveLength(0);
  });
  it('blocks before signing, allows afterwards, and cannot reuse another account signature', async () => {
    const h=harness(); const guard=consentGuard(h.pool, req=>req.userId); const next=vi.fn();
    const before=response(); await guard({userId:'client'},before,next);
    expect(before.code).toBe(403); expect(next).not.toHaveBeenCalled();
    expect((await h.post(payload)).code).toBe(201);
    await guard({userId:'client'},response(),next); expect(next).toHaveBeenCalledOnce();
    const other=response(); await guard({userId:'other'},other,next); expect(other.code).toBe(403);
    expect(h.rows[0].document_text).toBe(consentText);
  });
  it('preserves original signature on repeated submissions', async () => {
    const h=harness(); await h.post(payload); await h.post({...payload,signerName:'Changed'});
    expect(h.rows).toHaveLength(1); expect(h.rows[0].signer_name).toBe(payload.signerName);
  });
  it('does not trust a body userId and guards admin reads', async () => {
    const h=harness(); await h.post({...payload,userId:'victim'});
    expect(h.rows[0].user_id).toBe('client');
    expect(h.routes['get /api/admin/clients/:id/consents'][0]).toBe(h.admin);
    expect(h.routes['post /api/consent'][0]).toBe(h.auth);
  });
  it('fails closed if database is unavailable, including guests', async () => {
    const next=vi.fn(); const res=response();
    await consentGuard({query:async()=>{throw new Error('offline');}},req=>req.userId)({userId:'client'},res,next);
    expect(res.code).toBe(503); expect(next).not.toHaveBeenCalled();
    const guest=response(); await consentGuard({},()=>null)({},guest,next); expect(guest.code).toBe(403);
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('consent database integration', () => {
  it('stores and retrieves immutable signed evidence and releases the booking guard', async () => {
    const db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
    await db.connect();
    const userId='99999999-9999-4999-8999-999999999999';
    try {
      await db.query('BEGIN');
      await db.query('CREATE TEMP TABLE users (id uuid PRIMARY KEY)');
      await db.query('INSERT INTO users VALUES ($1)',[userId]);
      await db.query(readFileSync('supabase/migrations/202609100001_signed_consents.sql','utf8').replace('CREATE TABLE IF NOT EXISTS','CREATE TEMP TABLE'));
      const routes={};
      const app=Object.fromEntries(['get','post'].map(method=>[method,(path,...handlers)=>{ routes[method+path]=handlers.at(-1); }]));
      registerConsentRoutes(app,db,()=>{},()=>{});
      const next=vi.fn(), guard=consentGuard(db,req=>req.userId);
      const before=response(); await guard({userId},before,next); expect(before.code).toBe(403);
      const signed=response(); await routes['post/api/consent']({userId,body:payload},signed); expect(signed.code).toBe(201);
      await routes['post/api/consent']({userId,body:{...payload,signerName:'Changed'}},response());
      const result=response(); await routes['get/api/consent']({userId},result);
      expect(result.body.data.signed.signer_name).toBe(payload.signerName);
      expect(result.body.data.signed.document_text).toBe(consentText);
      expect(result.body.data.signed.signed_at).toBeTruthy();
      await guard({userId},response(),next); expect(next).toHaveBeenCalledOnce();
    } finally { await db.query('ROLLBACK'); await db.end(); }
  },20000);
});
