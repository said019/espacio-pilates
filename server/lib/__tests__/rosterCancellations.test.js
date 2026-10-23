import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { expect, it, vi } from 'vitest';
it('returns cancellation history separately without changing active roster counts', async () => {
  const source = readFileSync('server/index.js', 'utf8');
  const start = source.indexOf('app.get("/api/classes/:id/roster",');
  let handler;
  const query = vi.fn().mockResolvedValueOnce({ rows: [{ status: 'confirmed' }] })
    .mockResolvedValueOnce({ rows: [{ id: 'class' }] })
    .mockResolvedValueOnce({ rows: [{ booking_id: 'cancelled', cancelled_by: 'user', cancelled_at: '2026-10-22T19:02:28Z' }] });
  vm.runInNewContext(source.slice(start, source.indexOf('\n});', start) + 4), {
    app: { get(path, auth, fn) { handler = fn; } }, adminMiddleware() {}, pool: { query }, camelRow: row => row, console,
  });
  const res = { json: vi.fn() };
  await handler({ params: { id: 'class' } }, res);
  expect(query.mock.calls[0][0]).toContain("b.status != 'cancelled'");
  expect(query.mock.calls[2][0]).toContain("b.status='cancelled'");
  expect(query.mock.calls[2][1]).toEqual(['class']);
  expect(res.json.mock.calls[0][0].data.roster).toHaveLength(1);
  expect(res.json.mock.calls[0][0].data.cancelled).toHaveLength(1);
});
