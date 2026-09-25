import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { expect, it, vi } from 'vitest';

async function run({ status = 'waitlist', occupied = 7, eligible = true } = {}) {
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
  const notify = vi.fn(async () => {}), consume = vi.fn(async () => {});
  vm.runInNewContext(source.slice(start, source.indexOf('\n});', start) + 4), {
    app: { put: (_path, _auth, fn) => { handler = fn; } }, adminMiddleware() {}, console,
    pool: { connect: async () => ({ query, release() {} }), query },
    normalizeClassCategory: () => 'pilates', isWalkInClass: () => false,
    membershipIsEligibleForClass: () => eligible, checkPlanTimeRestriction: () => ({ allowed: true }),
    consumeMembershipCredit: consume, notifyWaitlistPromotion: notify, triggerWalletPassSync() {},
  });
  const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ params: { id: 'b' } }, res);
  return { res, query, notify, consume };
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
