import { describe, it, expect } from 'vitest';
import { endOfPurchaseMonth, canCancel, canReschedule, membershipStartDate } from '../bookingPolicy.js';

describe('endOfPurchaseMonth', () => {
  it('devuelve el último día del mes de compra', () => {
    expect(endOfPurchaseMonth('2026-06-15')).toBe('2026-06-30');
  });
  it('maneja febrero', () => {
    expect(endOfPurchaseMonth('2026-02-10')).toBe('2026-02-28');
  });
  it('maneja compra el último día', () => {
    expect(endOfPurchaseMonth('2026-01-31')).toBe('2026-01-31');
  });
});

const H = 3600_000;
const start = 100 * H; // referencia

describe('canCancel', () => {
  it('≥12h: cancela y devuelve crédito', () => {
    expect(canCancel({ nowMs: start - 13*H, classStartMs: start })).toEqual({ allowed: true, refundCredit: true });
  });
  it('entre 3 y 12h: cancela pero NO devuelve crédito (penalización)', () => {
    expect(canCancel({ nowMs: start - 5*H, classStartMs: start })).toEqual({ allowed: true, refundCredit: false });
  });
  it('<3h: no cancela', () => {
    expect(canCancel({ nowMs: start - 1*H, classStartMs: start })).toEqual({ allowed: false, refundCredit: false });
  });
  it('exactamente 12h: devuelve crédito (>=)', () => {
    expect(canCancel({ nowMs: start - 12*H, classStartMs: start })).toEqual({ allowed: true, refundCredit: true });
  });
  it('exactamente 3h: permite cancelar (>=)', () => {
    expect(canCancel({ nowMs: start - 3*H, classStartMs: start })).toEqual({ allowed: true, refundCredit: false });
  });
});

describe('canReschedule', () => {
  it('≥12h: reagenda', () => {
    expect(canReschedule({ nowMs: start - 13*H, classStartMs: start })).toEqual({ allowed: true });
  });
  it('entre 3 y 12h: sí reagenda', () => {
    expect(canReschedule({ nowMs: start - 5*H, classStartMs: start })).toEqual({ allowed: true });
  });
  it('<3h: no reagenda', () => {
    expect(canReschedule({ nowMs: start - 2*H, classStartMs: start })).toEqual({ allowed: false });
  });
});

describe('membershipStartDate', () => {
  const prenatal = { starts_on: '2026-08-01' };

  it('starts Prenatal on August 1 when purchased in July', () => {
    expect(membershipStartDate('2026-07-15', prenatal)).toBe('2026-08-01');
  });

  it('keeps the purchase date after the launch', () => {
    expect(membershipStartDate('2026-09-03', prenatal)).toBe('2026-09-03');
  });

  it('does not change regular plans', () => {
    expect(membershipStartDate('2026-07-15', {})).toBe('2026-07-15');
  });
});
