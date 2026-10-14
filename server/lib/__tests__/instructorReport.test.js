import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { expect, it, vi } from 'vitest';
const source = readFileSync('server/index.js', 'utf8');
async function report(params = {}, fail = false) {
  let handler;
  const query = vi.fn(async () => { if (fail) throw new Error('offline'); return { rows: [] }; });
  const start = source.indexOf('app.get("/api/reports/instructors",');
  vm.runInNewContext(source.slice(start, source.indexOf('\n});', start) + 4), {
    app: { get: (_path, _auth, fn) => { handler = fn; } }, adminMiddleware() {},
    resolveRequestBranch: async () => ({ id: 'branch' }), pool: { query },
    camelRows: rows => rows, console: { error() {} },
  });
  const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ query: params }, res);
  return { res, query };
}
it.each([
  { from: '2026-02-30' }, { from: 'bad' }, { from: '' },
  { from: '2026-10-14', to: '2026-10-01' }, { to: ['2026-10-14'] },
])('rejects invalid dates %j', async params => {
  const { res, query } = await report(params);
  expect(res.code).toBe(400);
  expect(query).not.toHaveBeenCalled();
});
it('filters inclusive dates, branch, completed classes and eligible bookings', async () => {
  const { query } = await report({ from: '2026-10-01', to: '2026-10-14' });
  const [sql, params] = query.mock.calls[0];
  expect(params).toEqual(['branch', '2026-10-01', '2026-10-14']);
  expect(sql).toContain('BETWEEN $2::date AND $3::date');
  expect(sql).toContain("c.status <> 'cancelled'");
  expect(sql).toContain("b.status IN ('confirmed', 'checked_in', 'no_show')");
  expect(sql).toContain("AT TIME ZONE 'America/Mexico_City') <= NOW()");
  expect(sql).toContain('COUNT(DISTINCT c.id)');
  expect(sql).toContain("WHERE timing.ended AND b.status = 'checked_in'");
  expect(sql).toContain('COUNT(DISTINCT c.id) FILTER (WHERE timing.ended)::INT AS class_count');
  expect(sql).toContain('COUNT(DISTINCT c.id) FILTER (WHERE NOT timing.ended)::INT AS pending_class_count');
  expect(sql).not.toContain("AND ((c.date + c.end_time::time)");
});
it('supports all branches without merging branch rows', async () => {
  const { query } = await report({ all_branches: 'true' });
  expect(query.mock.calls[0][1][0]).toBeNull();
  expect(query.mock.calls[0][0]).toContain('GROUP BY i.id, i.display_name, br.id, br.name');
  expect(query.mock.calls[0][1][1]).toMatch(/^\d{4}-\d{2}-01$/);
});
it('returns an error rather than misleading empty results', async () => {
  expect((await report({}, true)).res.code).toBe(500);
});
