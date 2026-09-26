import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { expect, it, vi } from 'vitest';

// Cada ajuste manual de créditos queda en membership_credit_log, en la misma
// transacción que el cambio: sin registro no hay cambio.
const source = readFileSync('server/index.js', 'utf8');
const logFn = source.slice(source.indexOf('async function logCreditAdjustment'), source.indexOf('\n}\n', source.indexOf('async function logCreditAdjustment')) + 2);

function runRoute(signature, method, { current = 0, failLog = false } = {}) {
  const start = source.indexOf(signature);
  const query = vi.fn(async (sql) => {
    if (sql.includes('FROM memberships m') && sql.includes('FOR UPDATE')) {
      return { rows: [{ classes_remaining: current, discipline_credits: null, user_id: 'u', branch_id: 'b', plan_name: 'Paquete 14 Clases' }] };
    }
    if (sql.includes('SELECT display_name FROM users')) return { rows: [{ display_name: 'Admin Tu Espacio' }] };
    if (sql.includes('INSERT INTO membership_credit_log') && failLog) throw new Error('log caído');
    if (sql.startsWith('UPDATE memberships SET classes_remaining') || sql.includes('UPDATE memberships SET\n')) {
      return { rows: [{ id: 'm', classes_remaining: 6 }] };
    }
    return { rows: [{ id: 'm', classes_remaining: 6 }] };
  });
  let handler;
  vm.runInNewContext(`${logFn}\n${source.slice(start, source.indexOf('\n});', start) + 4)}`, {
    app: { [method]: (_path, _auth, fn) => { handler = fn; } }, adminMiddleware() {}, console, Number, Math, JSON, Object, Array, String, Date,
    pool: { connect: async () => ({ query, release() {} }), query },
    triggerWalletPassSync() {},
  });
  return { handler: (body) => {
    const res = { code: 200, status(code) { this.code = code; return this; }, json(b) { this.body = b; return this; } };
    return handler({ params: { id: 'm' }, body, userId: 'admin-1' }, res).then(() => res);
  }, query };
}

const logInsert = (query) => query.mock.calls.find(([sql]) => sql.includes('INSERT INTO membership_credit_log'));

it('/credits registra antes → después, admin y motivo, y confirma después del registro', async () => {
  const { handler, query } = runRoute('app.put("/api/memberships/:id/credits",', 'put');
  const res = await handler({ mode: 'add', value: 6, reason: 'Botox' });
  expect(res.code).toBe(200);
  const [, params] = logInsert(query);
  expect(params).toEqual(['m', 'u', 'b', 'Paquete 14 Clases', 'admin-1', 'Admin Tu Espacio', 0, 6, 'Botox', 'admin']);
  const sqls = query.mock.calls.map(([sql]) => sql);
  expect(sqls.indexOf('COMMIT')).toBeGreaterThan(sqls.findIndex((s) => s.includes('INSERT INTO membership_credit_log')));
});

it('/credits no aplica el cambio si no se pudo registrar', async () => {
  const { handler, query } = runRoute('app.put("/api/memberships/:id/credits",', 'put', { failLog: true });
  const res = await handler({ mode: 'set', value: 6 });
  expect(res.code).toBe(500);
  const sqls = query.mock.calls.map(([sql]) => sql);
  expect(sqls).toContain('ROLLBACK');
  expect(sqls).not.toContain('COMMIT');
});

it('PUT /memberships/:id también registra si cambia classesRemaining', async () => {
  const { handler, query } = runRoute('app.put("/api/memberships/:id", adminMiddleware,', 'put', { current: 2 });
  await handler({ classesRemaining: 6 });
  expect(logInsert(query)[1].slice(6, 8)).toEqual([2, 6]);
});

it('PUT /memberships/:id sin créditos no escribe historial', async () => {
  const { handler, query } = runRoute('app.put("/api/memberships/:id", adminMiddleware,', 'put');
  await handler({ endDate: '2026-09-30' });
  expect(logInsert(query)).toBeUndefined();
});

it('la tabla se crea al arrancar y hay endpoint para consultarla', () => {
  expect(source).toContain('CREATE TABLE IF NOT EXISTS membership_credit_log');
  expect(source).toContain('app.get("/api/admin/clients/:id/credit-history"');
});
