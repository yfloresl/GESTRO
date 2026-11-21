import { beforeEach, describe, expect, it } from 'vitest';
import { _limpiarCierres, marcarCierre, tokenCerrado } from '../src/auth/cierres';

describe('cierre global (gestro-p07)', () => {
  beforeEach(() => _limpiarCierres());
  it('sin aviso de cierre, el token vale', () => { expect(tokenCerrado('u1', 1_000)).toBe(false); });
  it('tras el aviso, los tokens emitidos antes dejan de valer; los nuevos sí', () => {
    marcarCierre('u1', 1_000_000_000_000);
    expect(tokenCerrado('u1', 999_999_999)).toBe(true);        // emitido antes
    expect(tokenCerrado('u1', 1_000_000_001)).toBe(false);     // ingresó de nuevo después
  });
  it('solo afecta a esa persona', () => { marcarCierre('u1', 1_000_000_000_000); expect(tokenCerrado('u2', 1)).toBe(false); });
  it('un token sin fecha de emisión se rechaza si hubo cierre', () => { marcarCierre('u1'); expect(tokenCerrado('u1', undefined)).toBe(true); });
});
