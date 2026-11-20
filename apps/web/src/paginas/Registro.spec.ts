import { describe, expect, it } from 'vitest';
import { normalizarNit } from './Registro';

// GS-N04: el NIT del registro se valida igual que en la API (kyros-id.service.ts), antes de enviar.
describe('normalizarNit', () => {
  it('vacío es opcional', () => {
    expect(normalizarNit('')).toEqual({ nit: undefined, error: null });
    expect(normalizarNit('   ')).toEqual({ nit: undefined, error: null });
  });
  it('acepta de 5 a 13 dígitos y quita espacios, puntos y guiones', () => {
    expect(normalizarNit('1020304050').nit).toBe('1020304050');
    expect(normalizarNit('1.020.304-050').nit).toBe('1020304050');
    expect(normalizarNit('12345').error).toBeNull();
    expect(normalizarNit('1234567890123').error).toBeNull();
  });
  it('rechaza letras, largos fuera de rango y ceros a la izquierda', () => {
    for (const malo of ['ABC123456', '1234', '12345678901234', '0123456', '12 34a56']) {
      const r = normalizarNit(malo);
      expect(r.nit).toBeUndefined();
      expect(r.error).toMatch(/5 a 13 dígitos/);
    }
  });
});
