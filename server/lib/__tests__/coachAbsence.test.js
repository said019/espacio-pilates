import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { expect, it, vi } from 'vitest';
const source = readFileSync('server/index.js', 'utf8');
async function run(action, status) {
  const routes = {};
  const query = vi.fn(async (sql, params) => {
    if (sql.startsWith('UPDATE')) return { rows: status === params[2] ? [{ id: 'booking', status: params[1] }] : [] };
    return { rows: status ? [{ status }] : [] };
  });
  vm.runInNewContext(source.slice(source.indexOf('// Coach absence transitions'), source.indexOf('// GET /api/plans')), {
    app: { put: (path, auth, fn) => { routes[path] = fn; } }, coachMiddleware() {},
    pool: { query }, triggerWalletPassSync() {}, console,
  });
  const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await routes[`/api/coach/bookings/:id/${action}`]({ params: { id: 'booking' } }, res);
  return { res, query };
}
it('marks absence only from confirmed without credit or loyalty changes', async () => {
  const { res, query } = await run('no-show', 'confirmed');
  expect(res.body.data.status).toBe('no_show');
  expect(query).toHaveBeenCalledTimes(1);
  expect(query.mock.calls[0][1]).toEqual(['booking', 'no_show', 'confirmed']);
});
it('undoes absence back to confirmed', async () => {
  expect((await run('undo-no-show', 'no_show')).res.body.data.status).toBe('confirmed');
});
it.each(['checked_in', 'waitlist', 'cancelled'])('rejects %s', async status => {
  expect((await run('no-show', status)).res.code).toBe(409);
});
it('is idempotent', async () => {
  expect((await run('no-show', 'no_show')).res.code).toBe(200);
});
it('returns 404 for missing booking', async () => {
  expect((await run('no-show', null)).res.code).toBe(404);
});
