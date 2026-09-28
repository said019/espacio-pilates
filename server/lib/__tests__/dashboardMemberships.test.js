import { readFileSync } from 'node:fs';
import pg from 'pg';
import { expect, it } from 'vitest';

it.skipIf(!process.env.TEST_DATABASE_URL)('dashboard counts only active memberships overlapping the selected month and branch', async () => {
  const source = readFileSync('server/index.js', 'utf8').split('// GET /api/admin/stats')[1];
  const sql = source.match(/pool\.query\(`(SELECT COUNT\(\*\) FROM memberships[\s\S]*?)`/)[1];
  const db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await db.connect();
  const branch = '11111111-1111-4111-8111-111111111111';
  const other = '22222222-2222-4222-8222-222222222222';
  try {
    await db.query('BEGIN');
    await db.query(`CREATE TEMP TABLE memberships (status text, start_date date, end_date date, branch_id uuid) ON COMMIT DROP`);
    for (const [status, start, end, id] of [
      ['active', '2026-08-01', '2026-08-31', branch],
      ['active', '2026-08-15', '2026-09-01', branch],
      ['active', '2026-09-30', '2026-10-30', branch],
      ['active', '2026-10-01', '2026-10-31', branch],
      ['expired', '2026-09-01', '2026-09-30', branch],
      ['frozen', '2026-09-01', '2026-09-30', branch],
      ['active', '2026-09-01', '2026-09-30', other],
    ]) await db.query('INSERT INTO memberships VALUES ($1,$2,$3,$4)', [status, start, end, id]);
    expect((await db.query(sql, [branch, '2026-09-01'])).rows[0].count).toBe('2');
    expect((await db.query(sql, [other, '2026-09-01'])).rows[0].count).toBe('1');
    expect((await db.query(sql, [null, '2026-09-01'])).rows[0].count).toBe('3');
    expect((await db.query(sql, [branch, '2026-10-01'])).rows[0].count).toBe('2');
  } finally {
    await db.query('ROLLBACK');
    await db.end();
  }
});
