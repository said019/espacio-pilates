import { describe, it, expect } from 'vitest';
import { endOfPurchaseMonth } from '../bookingPolicy.js';

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
