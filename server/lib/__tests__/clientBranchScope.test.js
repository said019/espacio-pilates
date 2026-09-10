import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import pg from 'pg';
import { clientBranchPredicate } from '../clientBranchScope.js';

const source = readFileSync('server/index.js', 'utf8');
async function list(query) {
  let handler;
  const db = vi.fn().mockResolvedValue({ rows: [] });
  const start = source.indexOf('app.get("/api/users",');
  vm.runInNewContext(source.slice(start, source.indexOf('\n});', start) + 4), {
    app: { get: (_path, _auth, fn) => { handler = fn; } }, adminMiddleware() {},
    pool: { query: db }, console, camelRows: rows => rows, clientBranchPredicate,
    requestBranchReference: req => req.query.branchId,
    resolveRequestBranch: async req => req.query.branchId === 'invalid' ? null : { id: req.query.branchId },
  });
  const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ query }, res);
  return { res, db };
}
describe('client branch route', () => {
  it.each([undefined, 'all'])('leaves all clients visible when branch=%s', async branchId => {
    const { res, db } = await list({ role: 'client', branchId });
    expect(res.code).toBe(200);
    expect(db.mock.calls[0][0]).not.toContain('EXISTS');
  });
  it('combines branch and name/phone search with bound parameters', async () => {
    const { res, db } = await list({ role: 'client', branchId: 'pozos', search: '444' });
    expect(res.code).toBe(200);
    expect(db.mock.calls[0][0]).toContain(clientBranchPredicate('$2'));
    expect(db.mock.calls[0][1]).toEqual(['client', 'pozos', '%444%', '%444%']);
  });
  it('rejects unknown branch rather than returning all clients', async () => {
    const { res, db } = await list({ role: 'client', branchId: 'invalid' });
    expect(res.code).toBe(400);
    expect(db).not.toHaveBeenCalled();
  });
});

// Optional integration test: all fixtures are TEMP tables and rolled back.
// Real application tables are never written or read by the fixture queries.
describe.skipIf(!process.env.TEST_DATABASE_URL)('client branch SQL integration', () => {
  it('separates both branches, retains expired memberships, supports free walk-ins, and never duplicates users', async () => {
    const db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
    await db.connect();
    try {
      await db.query('BEGIN');
      await db.query(`
        CREATE TEMP TABLE users (id text) ON COMMIT DROP;
        CREATE TEMP TABLE memberships (user_id text, branch_id text, status text) ON COMMIT DROP;
        CREATE TEMP TABLE enrollments (user_id text, branch_id text) ON COMMIT DROP;
        CREATE TEMP TABLE orders (user_id text, branch_id text, status text) ON COMMIT DROP;
        CREATE TEMP TABLE classes (id text, branch_id text) ON COMMIT DROP;
        CREATE TEMP TABLE bookings (user_id text, class_id text, status text) ON COMMIT DROP;
        INSERT INTO users VALUES ('villa'), ('pozos'), ('both'), ('free'), ('new'), ('pending'), ('enrolled'), ('cancelled');
        INSERT INTO memberships VALUES ('villa','villa','expired'), ('pozos','pozos','active'),
          ('both','villa','active'), ('both','pozos','active'), ('both','pozos','expired');
        INSERT INTO enrollments VALUES ('enrolled','pozos');
        INSERT INTO orders VALUES ('pending','pozos','pending_verification'), ('cancelled','pozos','cancelled');
        INSERT INTO classes VALUES ('class','pozos');
        INSERT INTO bookings VALUES ('free','class','confirmed'), ('free','class','waitlist'), ('cancelled','class','cancelled');
      `);
      const select = branch => db.query(`SELECT id FROM users WHERE ${clientBranchPredicate('$1')} ORDER BY id`, [branch]);
      expect((await select('villa')).rows.map(r => r.id)).toEqual(['both', 'villa']);
      expect((await select('pozos')).rows.map(r => r.id)).toEqual(['both', 'enrolled', 'free', 'pending', 'pozos']);
    } finally {
      await db.query('ROLLBACK');
      await db.end();
    }
  });
});
