import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { endOfPurchaseMonth } from '../bookingPolicy.js';
import { membershipCanBookClass } from '../classAccess.js';

const source = readFileSync('server/index.js', 'utf8');
function extract(name) {
  const start = source.indexOf(`function ${name}(`);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
const scope = { console, endOfPurchaseMonth, isPackagePlan: () => true };
vm.createContext(scope);
vm.runInContext(['checkPlanTimeRestriction', 'sanitizeTimeRestriction', 'calcMembershipEndDate'].map(extract).join('\n'), scope);
const restriction = { days_of_week: [1, 3, 5], hour_range: ['08:00', '08:00'], fixed_schedule: true };

describe('Promo horario fijo', () => {
  it.each(['2026-10-05', '2026-10-07', '2026-10-09'])('acepta L/M/V 8 AM: %s', (date) => {
    expect(scope.checkPlanTimeRestriction({ time_restriction: restriction }, date, '08:00:00').allowed).toBe(true);
  });
  it.each([
    ['2026-10-06', '08:00'], ['2026-10-08', '08:00'], ['2026-10-10', '08:00'],
    ['2026-10-11', '08:00'], ['2026-10-05', '07:00'], ['2026-10-05', '08:01'],
    ['2026-10-05', '20:00'], [null, '08:00'], ['2026-10-05', null],
  ])('rechaza otro horario o datos faltantes: %s %s', (date, time) => {
    expect(scope.checkPlanTimeRestriction({ time_restriction: restriction }, date, time).allowed).toBe(false);
  });
  it.each(['2026-10-05', '2026-10-26', '2026-10-31'])('vence en octubre, sin gracia: %s', (date) => {
    expect(scope.calcMembershipEndDate(date, { time_restriction: restriction })).toBe('2026-10-31');
  });
  it('no cambia la gracia de otros paquetes', () => {
    expect(scope.calcMembershipEndDate('2026-10-26', {})).toBe('2026-11-30');
  });
  it('conserva la restricción al editar el plan', () => {
    expect(scope.sanitizeTimeRestriction(restriction)).toMatchObject(restriction);
  });
  it('respeta sucursal y programa', () => {
    const membership = { branch_id: 'pozos', program: 'functional', class_category: 'funcional', plan_kind: 'package' };
    expect(membershipCanBookClass(membership, { branch_id: 'pozos', class_category: 'funcional' })).toBe(true);
    expect(membershipCanBookClass(membership, { branch_id: 'villa', class_category: 'funcional' })).toBe(false);
    expect(membershipCanBookClass(membership, { branch_id: 'pozos', class_category: 'reformer' })).toBe(false);
  });
  it.each([false, true])('el endpoint impide reagendar incluso hacia walk-in=%s', async (walkIn) => {
    let handler;
    const query = vi.fn(async () => ({ rows: [{ status: 'confirmed', class_id: 'old', fixed_schedule: true, old_is_walk_in: walkIn }] }));
    const start = source.indexOf('app.put("/api/bookings/:id/reschedule",');
    vm.runInNewContext(source.slice(start, source.indexOf('\n});', start) + 4), {
      app: { put: (_path, _auth, _consent, fn) => { handler = fn; } },
      authMiddleware() {}, consentGuard() {}, pool: { query }, console,
    });
    const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await handler({ params: { id: 'booking' }, userId: 'user', body: { new_class_id: 'new' } }, res);
    expect(res.code).toBe(403);
    expect(res.body.code).toBe('FIXED_SCHEDULE_NO_RESCHEDULE');
    expect(query).toHaveBeenCalledTimes(1);
  });
});
