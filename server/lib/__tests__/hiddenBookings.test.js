import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { expect, it, vi } from 'vitest';

// GET /api/bookings alimenta el historial de una clienta (userId) y también la
// lista de alumnas de una clase (classId). Una reserva oculta (hidden_at) solo
// desaparece del historial de la clienta; en la clase sigue contando.
async function listSql(query) {
  const source = readFileSync('server/index.js', 'utf8');
  const start = source.indexOf('app.get("/api/bookings", adminMiddleware,');
  const pool = { query: vi.fn(async () => ({ rows: [] })) };
  let handler;
  vm.runInNewContext(source.slice(start, source.indexOf('\n});', start) + 4), {
    app: { get: (_path, _auth, fn) => { handler = fn; } }, adminMiddleware() {}, console, pool, parseInt, String,
    resolveRequestBranch: async () => ({ id: 'branch' }),
  });
  const res = { status() { return this; }, json(body) { this.body = body; return this; } };
  await handler({ query }, res);
  return pool.query.mock.calls[0][0];
}

it('oculta del historial de la clienta las reservas marcadas con hidden_at', async () => {
  expect(await listSql({ userId: 'u' })).toContain('b.hidden_at IS NULL');
});

it('la lista de una clase sigue mostrando las reservas ocultas', async () => {
  expect(await listSql({ classId: 'c' })).not.toContain('hidden_at');
});

it('la columna hidden_at se crea en el bootstrap', () => {
  const source = readFileSync('server/index.js', 'utf8');
  expect(source).toMatch(/ALTER TABLE bookings ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMP WITH TIME ZONE/);
});
