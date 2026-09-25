import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import pg from 'pg';
import { expect, it } from 'vitest';

function load(client) {
  const source = readFileSync('server/index.js', 'utf8');
  const start = source.indexOf('async function clientNeedsInscription(');
  const end = source.indexOf('// Reads the active "Inscripción"', start);
  const ctx = { pool: client, DEFAULT_BRANCH_ID: 'branch', enrollmentProgram: p => p === 'prenatal' ? 'pilates' : p, console };
  vm.createContext(ctx);
  vm.runInContext(source.slice(start, end), ctx);
  return ctx;
}
it('does not waive enrollment on database errors', async () => {
  const ctx = load({ query: async () => { throw new Error('database unavailable'); } });
  await expect(ctx.clientNeedsInscription('user')).rejects.toThrow('database unavailable');
});
it.skipIf(!process.env.TEST_DATABASE_URL)('validates visits, trials, paid enrollment and branch scope with real PostgreSQL', async () => {
  const db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await db.connect();
  try {
    await db.query('BEGIN');
    await db.query(`CREATE TEMP TABLE enrollments (user_id text,branch_id text,program text,paid_at timestamptz,last_activity_at timestamptz) ON COMMIT DROP;
      CREATE TEMP TABLE plans (id text,program text,plan_kind text) ON COMMIT DROP;
      CREATE TEMP TABLE memberships (user_id text,branch_id text,plan_id text,end_date date) ON COMMIT DROP;
      INSERT INTO plans VALUES ('visit','pilates','single'),('trial','pilates','single'),('package','pilates','package');
      INSERT INTO memberships VALUES ('isabel','branch','visit',CURRENT_DATE),('trial-user','branch','trial',CURRENT_DATE),('legacy','branch','package',CURRENT_DATE);
      INSERT INTO enrollments VALUES ('paid','branch','pilates',NOW(),NOW()),('unpaid','branch','pilates',NULL,NOW());`);
    const ctx = load(db);
    for (const user of ['isabel', 'trial-user', 'unpaid', 'new-user']) {
      expect(await ctx.clientNeedsInscription(user)).toBe(true);
      expect(await ctx.clientHasPaidWalkInInscription(user)).toBe(false);
    }
    for (const user of ['paid', 'legacy']) {
      expect(await ctx.clientNeedsInscription(user)).toBe(false);
      expect(await ctx.clientHasPaidWalkInInscription(user)).toBe(true);
      expect(await ctx.clientNeedsInscription(user, { branchId: 'other' })).toBe(true);
      expect(await ctx.clientNeedsInscription(user, { program: 'functional' })).toBe(true);
    }
  } finally { await db.query('ROLLBACK'); await db.end(); }
}, 30000);
