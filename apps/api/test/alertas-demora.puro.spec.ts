import { describe, expect, it } from 'vitest';
import { duracion, mensajeDemora } from '../src/alertas/demora';

describe('mensajeDemora (gestro-021)', () => {
  it('una demora normal dice los minutos y el límite', () => {
    expect(mensajeDemora({ ticket: 12, mesa: '4', minutos: 40, umbral: 25, plato: 'Pique' })).toBe('El pedido #12 (mesa 4) lleva 40 min en cocina; el límite para «Pique» es 25 min.');
  });
  it('7511 min ya no se llama «en cocina»: es un pedido abierto hace 5 días', () => {
    const m = mensajeDemora({ ticket: 3, mesa: null, minutos: 7511, umbral: 15, plato: 'Sopa' });
    expect(m).toContain('5 días abierto sin cerrarse'); expect(m).not.toContain('7511');
  });
  it('duración legible', () => { expect([duracion(90), duracion(300), duracion(3000), duracion(7511)]).toEqual(['90 min', '5 h', '2 días', '5 días']); });
});
