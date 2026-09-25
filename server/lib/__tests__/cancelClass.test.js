import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { expect, it, vi } from 'vitest';

// "Cancelar clase" = la clase no se da. Todas sus reservas se cancelan, a quien
// pagó con su paquete se le devuelve el crédito y se avisa a cada alumna.
async function cancel({ classStatus = 'scheduled', bookings = [] } = {}) {
  const source = readFileSync('server/index.js', 'utf8');
  const start = source.indexOf('app.put("/api/classes/:id/cancel",');
  const query = vi.fn(async (sql) => {
    if (sql.includes('FROM classes c') && sql.includes('FOR UPDATE')) {
      return { rows: [{ id: 'c', status: classStatus, class_category: 'reformer' }] };
    }
    if (sql.includes('FROM bookings') && sql.includes('FOR UPDATE')) return { rows: bookings };
    if (sql.startsWith('UPDATE classes')) return { rows: [{ id: 'c', status: 'cancelled' }] };
    return { rows: [], rowCount: 0 };
  });
  const refund = vi.fn(async (_client, membershipId) => (membershipId === 'unlimited' ? 0 : 1));
  const notify = vi.fn(async () => {});
  const wallet = vi.fn();
  let handler;
  vm.runInNewContext(source.slice(start, source.indexOf('\n});', start) + 4), {
    app: { put: (_path, _auth, fn) => { handler = fn; } }, adminMiddleware() {}, console, Boolean, Set,
    pool: { connect: async () => ({ query, release() {} }) },
    normalizeClassCategory: () => 'reformer',
    refundMembershipCredit: refund, notifyClassCancelled: notify, triggerWalletPassSync: wallet,
  });
  const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ params: { id: 'c' }, body: {} }, res);
  return { res, query, refund, notify, wallet };
}

const booking = (id, status, membership_id, user_id = `u-${id}`) => ({ id, status, membership_id, user_id });

it('cancela todas las reservas, devuelve crédito a quien pagó con paquete y avisa', async () => {
  const r = await cancel({ bookings: [
    booking('a', 'confirmed', 'm1'),
    booking('b', 'checked_in', 'm2'),
    booking('w', 'waitlist', 'm3'),     // en espera: nunca pagó crédito
    booking('k', 'confirmed', null),    // walk-in sin paquete
  ] });
  expect(r.res.code).toBe(200);
  expect(r.refund.mock.calls.map((c) => c[1])).toEqual(['m1', 'm2']);
  expect(r.res.body).toMatchObject({ cancelledBookings: 4, refundedCredits: 2 });
  const cancelSql = r.query.mock.calls.find(([sql]) => sql.startsWith('UPDATE bookings'))[0];
  expect(cancelSql).toContain("status = 'cancelled'");
  expect(cancelSql).toContain("'confirmed','checked_in','waitlist'");
  expect(r.query.mock.calls.some(([sql]) => sql.startsWith('UPDATE classes') && sql.includes("status='cancelled'"))).toBe(true);
  expect(r.notify.mock.calls).toEqual([
    ['u-a', 'c', { creditRestored: true }],
    ['u-b', 'c', { creditRestored: true }],
    ['u-w', 'c', { creditRestored: false }],
    ['u-k', 'c', { creditRestored: false }],
  ]);
  const commit = r.query.mock.calls.findIndex(([sql]) => sql === 'COMMIT');
  expect(r.query.mock.invocationCallOrder[commit]).toBeLessThan(r.notify.mock.invocationCallOrder[0]);
});

it('no promete crédito devuelto a una membresía ilimitada', async () => {
  const r = await cancel({ bookings: [booking('a', 'confirmed', 'unlimited')] });
  expect(r.res.body.refundedCredits).toBe(0);
  expect(r.notify).toHaveBeenCalledWith('u-a', 'c', { creditRestored: false });
});

it('es idempotente: una clase ya cancelada no devuelve ni avisa otra vez', async () => {
  const r = await cancel({ classStatus: 'cancelled', bookings: [booking('a', 'confirmed', 'm1')] });
  expect(r.res.code).toBe(200);
  expect(r.refund).not.toHaveBeenCalled();
  expect(r.notify).not.toHaveBeenCalled();
});

it('no avisa a reservas de invitadas sin cuenta', async () => {
  const r = await cancel({ bookings: [booking('g', 'confirmed', null, null)] });
  expect(r.notify).not.toHaveBeenCalled();
  expect(r.wallet).not.toHaveBeenCalled();
});

it('la plantilla class_cancelled existe en el servidor y en el panel', () => {
  const server = readFileSync('server/index.js', 'utf8');
  const panel = readFileSync('src/pages/admin/settings/SettingsPage.tsx', 'utf8');
  expect(server).toMatch(/\n  class_cancelled: \{\n    subject:/);
  expect(server).toMatch(/\n  class_cancelled: "\/app\/bookings",/);
  expect(panel).toContain('key: "class_cancelled"');
});
