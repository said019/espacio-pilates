import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import pg from 'pg';
import { expect, it, vi } from 'vitest';

it.skipIf(!process.env.TEST_DATABASE_URL)('PostgreSQL accepts the actual attendance query parameter types', async () => {
  const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('CREATE TEMP TABLE bookings (id uuid, status varchar(20), checked_in_at timestamptz) ON COMMIT DROP');
    const source = readFileSync('server/index.js', 'utf8');
    const sql = source.match(/"(UPDATE bookings SET status = \$2, checked_in_at = CASE[^"\n]+)"/)[1];
    for (const status of ['confirmed', 'checked_in']) {
      // EXPLAIN without ANALYZE parses/plans the real query but never updates rows.
      await client.query('EXPLAIN ' + sql, ['00000000-0000-0000-0000-000000000000', status, status === 'checked_in']);
    }
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
});

async function run({ status = 'waitlist', occupied = 7, eligible = true, targetStatus } = {}) {
  const source = readFileSync('server/index.js', 'utf8');
  const start = source.indexOf('app.put("/api/bookings/:id/check-in",');
  const booking = { id: 'b', user_id: 'u', class_id: 'c', membership_id: 'm', status };
  const query = vi.fn(async (sql) => {
    if (sql.includes('SELECT c.*')) return { rows: [{ id: 'c', max_capacity: 8, status: 'scheduled' }] };
    if (sql.startsWith('SELECT * FROM bookings')) return { rows: [booking] };
    if (sql.startsWith('SELECT COUNT')) return { rows: [{ count: occupied }] };
    if (sql.includes('SELECT m.*')) return { rows: [{ id: 'm' }] };
    if (sql.startsWith('UPDATE bookings')) return { rows: [{ ...booking, status: 'checked_in' }] };
    if (sql.includes('loyalty_config')) return { rows: [{ value: { enabled: false } }] };
    return { rows: [] };
  });
  let handler;
  const notify = vi.fn(async () => {}), consume = vi.fn(async () => {}), refund = vi.fn(async () => {});
  vm.runInNewContext(source.slice(start, source.indexOf('\n});', start) + 4), {
    app: { put: (_path, _auth, fn) => { handler = fn; } }, adminMiddleware() {}, console,
    pool: { connect: async () => ({ query, release() {} }), query },
    normalizeClassCategory: () => 'pilates', isWalkInClass: () => false,
    membershipIsEligibleForClass: () => eligible, checkPlanTimeRestriction: () => ({ allowed: true }),
    consumeMembershipCredit: consume, refundMembershipCredit: refund, notifyWaitlistPromotion: notify, triggerWalletPassSync() {},
  });
  const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ params: { id: 'b' }, body: { targetStatus } }, res);
  return { res, query, notify, consume, refund };
}
it('promotes, charges once, reconciles occupied seats and notifies after commit', async () => {
  const r = await run();
  expect(r.res.code).toBe(200);
  expect(r.consume).toHaveBeenCalledTimes(1);
  expect(r.query.mock.calls.some(([sql]) => sql.includes('UPDATE classes SET current_bookings='))).toBe(true);
  expect(r.notify).toHaveBeenCalledWith('u', 'c');
  const commit = r.query.mock.calls.findIndex(([sql]) => sql === 'COMMIT');
  expect(r.query.mock.invocationCallOrder[commit]).toBeLessThan(r.notify.mock.invocationCallOrder[0]);
});
it.each([{ occupied: 8 }, { eligible: false }, { status: 'cancelled' }])('rejects unsafe promotion %j', async (options) => {
  const r = await run(options);
  expect(r.res.code).toBe(409);
  expect(r.consume).not.toHaveBeenCalled();
  expect(r.notify).not.toHaveBeenCalled();
});
it.each(['checked_in', 'confirmed'])('does not charge or send promotion for %s', async (status) => {
  const r = await run({ status });
  expect(r.res.code).toBe(200);
  expect(r.consume).not.toHaveBeenCalled();
  expect(r.notify).not.toHaveBeenCalled();
});
it('allows confirmation without recording attendance', async () => {
  const r = await run({ targetStatus: 'confirmed' });
  expect(r.res.code).toBe(200);
  expect(r.query.mock.calls.find(([sql]) => sql.startsWith('UPDATE bookings'))[1]).toEqual(['b', 'confirmed', false]);
  expect(r.consume).toHaveBeenCalledTimes(1);
  expect(r.notify).toHaveBeenCalledTimes(1);
});
it('returns the credit and reconciles seats when moving a confirmed member to waitlist', async () => {
  const r = await run({ status: 'confirmed', targetStatus: 'waitlist' });
  expect(r.res.code).toBe(200);
  expect(r.refund).toHaveBeenCalledTimes(1);
  expect(r.consume).not.toHaveBeenCalled();
  expect(r.notify).not.toHaveBeenCalled();
});
