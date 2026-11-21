import { describe, expect, it } from 'vitest';
import { pendienteDePropina, totalesDePropinas } from '../src/propinas/propinas';

describe('propinas por mesero (gestro-p02)', () => {
  it('pendiente = propina − entregada, en centavos exactos', () => {
    expect(pendienteDePropina('10.30', '0.10')).toBe('10.20');
    expect(pendienteDePropina('0.30', '0.10')).toBe('0.20');   // sin error de flotante
    expect(pendienteDePropina('25.00', '25.00')).toBe('0.00');
  });
  it('nunca queda negativa', () => { expect(pendienteDePropina('5.00', '7.00')).toBe('0.00'); });
  it('totales del reporte', () => {
    expect(totalesDePropinas([{ propina: '10.10', entregada: '10.10', pendiente: '0.00' }, { propina: '4.20', entregada: '0.00', pendiente: '4.20' }])).toEqual({ propina: '14.30', entregada: '10.10', pendiente: '4.20' });
  });
});
