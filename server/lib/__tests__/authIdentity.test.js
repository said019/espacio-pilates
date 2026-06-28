import { describe, it, expect } from 'vitest';
import { isEmailIdentifier } from '../authIdentity.js';

describe('isEmailIdentifier', () => {
  it('detecta un correo', () => {
    expect(isEmailIdentifier('espaciopilatesvm@gmail.com')).toBe(true);
  });
  it('un teléfono no es correo', () => {
    expect(isEmailIdentifier('4445480352')).toBe(false);
    expect(isEmailIdentifier('+524445480352')).toBe(false);
  });
  it('maneja vacío y no-strings sin romper', () => {
    expect(isEmailIdentifier('')).toBe(false);
    expect(isEmailIdentifier(null)).toBe(false);
    expect(isEmailIdentifier(undefined)).toBe(false);
    expect(isEmailIdentifier(12345)).toBe(false);
  });
});
