import { describe, expect, it } from 'vitest';
import { centavosDeDiferencia } from './cierre-caja';

describe('centavosDeDiferencia (GST-C03)', () => {
  it.each([
    ['150', '150.00', 0],
    ['150,00', '150.00', 0],
    ['149.9', '150.00', -10],
    ['150.05', '150.00', 5],
    ['0,30', '0.10', 20],
    ['1000000.00', '999999.99', 1],
  ])('contado %s esperado %s = %i centavos', (contado, esperado, dif) => expect(centavosDeDiferencia(contado, esperado)).toBe(dif));

  it('un monto aún no válido no cuenta como diferencia', () => {
    expect(centavosDeDiferencia('', '10.00')).toBeNull();
    expect(centavosDeDiferencia('12,', '10.00')).toBeNull();
    expect(centavosDeDiferencia('-5', '10.00')).toBeNull();
    expect(centavosDeDiferencia('1.234', '10.00')).toBeNull();
  });
});
