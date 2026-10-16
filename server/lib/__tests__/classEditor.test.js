import { expect, it, vi } from 'vitest';
import { registerClassEditor, validateClassEdit } from '../classEditor.js';
const id = '11111111-1111-4111-8111-111111111111';
const body = { date: '2026-10-19', startTime: '08:00', endTime: '08:55', maxCapacity: 8, instructorId: id, classTypeId: id, revision: 'rev' };
it.each([
  { date: '2026-02-30' }, { date: 'bad' }, { startTime: '25:00' }, { endTime: '07:55' },
  { maxCapacity: 0 }, { maxCapacity: 2.5 }, { maxCapacity: '8' }, { instructorId: 'bad' }, { revision: '' },
])('rejects invalid edits %j', patch => expect(validateClassEdit({ ...body, ...patch })).toBeTruthy());
it('accepts valid edit', () => expect(validateClassEdit(body)).toBeNull());
async function request({ occupied = 3, revision = 'rev', status = 'scheduled', missing = false, patch = {} } = {}) {
  const routes = {};
  const query = vi.fn(async sql => {
    if (sql.includes('FOR UPDATE')) return { rows: missing ? [] : [{ revision, status }] };
    if (sql.includes('COUNT')) return { rows: [{ count: occupied }] };
    if (sql.includes('FROM instructors')) return { rows: [{ id }] };
    if (sql.includes('FROM class_types')) return { rows: [{ id, name: 'Pilates', category: 'pilates' }] };
    return { rows: [] };
  });
  const release = vi.fn();
  const auth = () => {};
  registerClassEditor({ get() {}, put(path, middleware, handler) { expect(middleware).toBe(auth); routes.put = handler; } }, {
    pool: { connect: async () => ({ query, release }) }, adminMiddleware: auth,
    resolveRequestBranch: async () => ({ id, code: 'villa-magna' }),
  });
  const res = { code: 200, status(code) { this.code = code; return this; }, json(data) { this.body = data; return this; } };
  await routes.put({ params: { id }, body: { ...body, ...patch } }, res);
  return { res, query, release };
}
it('updates only the existing class and keeps reservations and credits untouched', async () => {
  const { res, query, release } = await request();
  expect(res.code).toBe(200);
  const writes = query.mock.calls.filter(([sql]) => /UPDATE|DELETE|INSERT/.test(sql) && !sql.includes('FOR UPDATE'));
  expect(writes).toHaveLength(1);
  expect(writes[0][0]).toMatch(/^UPDATE classes/);
  expect(writes[0][0]).toContain('WHERE id=$1 AND branch_id=$2');
  expect(writes[0][1]).toEqual([id, id, id, id, '2026-10-19', '08:00', '08:55', 8]);
  expect(query).toHaveBeenCalledWith('COMMIT');
  expect(release).toHaveBeenCalled();
});
it.each([{ occupied: 9 }, { revision: 'new' }, { status: 'cancelled' }])('protects conflicting edit %j', async options => {
  const { res, query } = await request(options);
  expect(res.code).toBe(409);
  expect(query).toHaveBeenCalledWith('ROLLBACK');
  expect(query.mock.calls.some(([sql]) => sql.startsWith('UPDATE'))).toBe(false);
});
it('allows capacity exactly equal to occupied seats', async () => expect((await request({ occupied: 8 })).res.code).toBe(200));
it('rejects another branch or missing class', async () => expect((await request({ missing: true })).res.code).toBe(404));
