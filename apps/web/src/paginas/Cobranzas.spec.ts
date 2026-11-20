import { describe, expect, it } from 'vitest';
import { validarMontoCobro } from './Cobranzas';

// GST-C05: un cobro de cuenta con monto 0 (o inválido) dice qué falla en vez de «Datos inválidos».
describe('validarMontoCobro', () => {
  it('acepta un monto válido con coma o punto y hasta 2 decimales', () => {
    expect(validarMontoCobro('150,50', '200.00')).toEqual({ monto: 150.5, error: null });
    expect(validarMontoCobro('150.5', '200.00').monto).toBe(150.5);
    expect(validarMontoCobro('200', '200.00').error).toBeNull();
  });
  it('rechaza cero y vacío con un mensaje claro', () => {
    expect(validarMontoCobro('0', '200.00').error).toMatch(/mayor a cero/);
    expect(validarMontoCobro('0,00', '200.00').error).toMatch(/mayor a cero/);
    expect(validarMontoCobro('', '200.00').error).toMatch(/en números/);
  });
  it('rechaza letras, negativos y más de 2 decimales', () => {
    for (const malo of ['abc', '-5', '1,234', '1e3']) expect(validarMontoCobro(malo, '200.00').error).toMatch(/en números/);
  });
  it('rechaza más que el saldo, en centavos exactos (200,01 > 200,00; 0,30 no supera 0,30)', () => {
    expect(validarMontoCobro('200,01', '200.00').error).toMatch(/mayor al saldo pendiente \(Bs 200,00\)/);
    expect(validarMontoCobro('0,30', '0.30').error).toBeNull();
  });
});
