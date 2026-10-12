import { expect, it } from 'vitest';
import { bookingCutoff } from '../bookingPolicy.js';
it('permite quitar el cierre predeterminado con cero', () => {
  expect(bookingCutoff({ ...cls, booking_cutoff_minutes: 0 }, Date.parse('2026-10-12T23:00:00Z')).allowed).toBe(true);
});
it('configura otro horario y sucursal con anticipación diferente', () => {
  const other = { ...cls, branch_id: 'villa', start_time: '18:30:00', booking_cutoff_minutes: 120 };
  expect(bookingCutoff(other, Date.parse('2026-10-12T21:30:00Z')).allowed).toBe(true);
  expect(bookingCutoff(other, Date.parse('2026-10-12T21:30:01Z')).allowed).toBe(false);
});
const cls = { branch_id: '22222222-2222-4222-8222-222222222222', start_time: '17:30:00', class_start_utc: '2026-10-12T23:30:00Z' };
it.each([
  ['2026-10-12T22:29:59Z', true],
  ['2026-10-12T22:30:00Z', true],
  ['2026-10-12T22:30:01Z', false],
  ['2026-10-12T22:31:00Z', false],
  ['2026-10-12T23:30:00Z', false],
])('Pozos 17:30, frontera de una hora %s', (now, allowed) => {
  expect(bookingCutoff(cls, Date.parse(now)).allowed).toBe(allowed);
});
it('no modifica Villa Magna', () => {
  expect(bookingCutoff({ ...cls, branch_id: '11111111-1111-4111-8111-111111111111' }, Date.parse('2026-10-12T23:29:00Z')).allowed).toBe(true);
});
it.each(['07:00:00', '08:00:00', '18:30:00', '19:30:00'])('no modifica otro horario %s', start_time => {
  expect(bookingCutoff({ ...cls, start_time }, Date.parse('2026-10-12T23:29:00Z')).allowed).toBe(true);
});
