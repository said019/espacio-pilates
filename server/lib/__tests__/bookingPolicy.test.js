import { describe, it, expect } from 'vitest';
import { endOfPurchaseMonth, canCancel, canReschedule, membershipStartDate, mexicoCityDate } from '../bookingPolicy.js';

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
  it('entre 8 y 12h: cancela pero NO devuelve crédito (penalización)', () => {
    expect(canCancel({ nowMs: start - 9*H, classStartMs: start })).toEqual({ allowed: true, refundCredit: false });
  });
  it('<8h: no cancela', () => {
    expect(canCancel({ nowMs: start - 7*H, classStartMs: start })).toEqual({ allowed: false, refundCredit: false });
  });
  it('exactamente 12h: devuelve crédito (>=)', () => {
    expect(canCancel({ nowMs: start - 12*H, classStartMs: start })).toEqual({ allowed: true, refundCredit: true });
  });
  it('exactamente 8h: permite cancelar (>=)', () => {
    expect(canCancel({ nowMs: start - 8*H, classStartMs: start })).toEqual({ allowed: true, refundCredit: false });
  });
});

describe('canReschedule', () => {
  it('con más de 8h: reagenda', () => {
    expect(canReschedule({ nowMs: start - 9*H, classStartMs: start })).toEqual({ allowed: true });
  });
  it('exactamente 8h: reagenda', () => {
    expect(canReschedule({ nowMs: start - 8*H, classStartMs: start })).toEqual({ allowed: true });
  });
  it('con menos de 8h: no reagenda', () => {
    expect(canReschedule({ nowMs: start - 7*H, classStartMs: start })).toEqual({ allowed: false });
  });
  it('respeta una ventana configurada por el admin', () => {
    expect(canReschedule({ nowMs: start - 5*H, classStartMs: start, rescheduleHours: 4 })).toEqual({ allowed: true });
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

describe('mexicoCityDate', () => {
  it('conserva el día comercial de CDMX durante la noche UTC', () => {
    // 22:52 del 31-jul en CDMX ya es 1-ago en UTC.
    expect(mexicoCityDate(new Date('2026-08-01T04:52:03.000Z'))).toBe('2026-07-31');
  });

  it('avanza el día después de la medianoche de CDMX', () => {
    expect(mexicoCityDate(new Date('2026-08-01T06:00:00.000Z'))).toBe('2026-08-01');
  });
});
