import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { expect, it, vi } from 'vitest';
const source = readFileSync('server/index.js', 'utf8');
async function save(minutes, exists = true) {
  let handler;
  const query = vi.fn(async () => ({ rows: exists ? [{ id: 'class' }] : [] }));
  const start = source.indexOf('app.put("/api/admin/classes/:id/booking-cutoff",');
  vm.runInNewContext(source.slice(start, source.indexOf('\n});', start) + 4), {
    app: { put: (_path, _auth, fn) => { handler = fn; } }, adminMiddleware() {},
    resolveRequestBranch: async () => ({ id: 'branch' }), pool: { query }, console,
  });
  const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ body: { minutes }, params: { id: 'class' } }, res);
  return { res, query };
}
it.each([-1, 10081, 1.5, null, '60'])('rechaza configuración inválida %s', async minutes => {
  const result = await save(minutes);
  expect(result.res.code).toBe(400);
  expect(result.query).not.toHaveBeenCalled();
});
it.each([0, 60, 120])('guarda %s minutos solo en clase y sucursal indicadas', async minutes => {
  const result = await save(minutes);
  expect(result.res.code).toBe(200);
  expect(result.query.mock.calls[0][0]).toContain('WHERE id=$1 AND branch_id=$2');
  expect(result.query.mock.calls[0][1]).toEqual(['class', 'branch', minutes]);
});
it('no informa éxito para otra sucursal', async () => {
  expect((await save(60, false)).res.code).toBe(404);
});
