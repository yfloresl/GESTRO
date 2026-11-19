import { describe, expect, it } from 'vitest';
import { ALIAS_NOTIFICACIONES, enmascarar, funcionalidadesSinPrecio, lineasVistaPrevia, mensajeErrorAceptacion, textoVigencia, validarAceptacion } from './kyros-local';
import { desgloseIva } from './kyros-estandar';

describe('lo propio de Gestro sobre el estándar Kyros v1.1', () => {
  it('S-07: mensaje claro sin casilla y errores legibles', () => {
    expect(validarAceptacion(false)).toBe('Marca la casilla para continuar.');
    expect(validarAceptacion(true)).toBeNull();
    expect(mensajeErrorAceptacion(403)).toContain('sesión venció');
    expect(mensajeErrorAceptacion(500, 'INTERNAL_ERROR')).toContain('No pudimos registrar');
    expect(mensajeErrorAceptacion(409, 'Ya aceptaste esta versión.')).toBe('Ya aceptaste esta versión.');
  });
  it('S-11: la contraseña demo nunca va en claro', () => {
    expect(enmascarar('Secreta-Demo-1')).not.toContain('Secreta');
    expect(enmascarar('x').length).toBe(8);
  });
  it('S-12: alias de notificaciones', () => { expect(ALIAS_NOTIFICACIONES).toContain('/avisos'); });
  it('S-08: vigencia visible con el texto del estándar', () => {
    const ahora = new Date('2026-11-18T12:00:00Z');
    expect(textoVigencia('2026-11-25T12:00:00Z', ahora)).toBe('Vence en 7 días');
    expect(textoVigencia('2026-11-17T12:00:00Z', ahora)).toBe('Vencida');
    expect(textoVigencia(null)).toBe('Sin fecha de vencimiento');
  });
  it('S-06: vista previa en días; el crédito sobrante lleva Neto / IVA 13 % / Total', () => {
    const l = lineasVistaPrevia({ fechaEfectiva: '2026-11-10', vigenciaNueva: '2026-12-01', diasRestantes: 21, diasExtra: 0, creditoSobranteCentavos: 80000 });
    expect(l).toContain('Días que te quedan: 21');
    expect(l.join('|')).toMatch(/Neto Bs 696,00 · IVA 13 % Bs 104,00 · Total Bs 800,00/);
    expect(l[l.length - 1]).toBe('No pierdes ningún día ya pagado.');
    expect(lineasVistaPrevia({ fechaEfectiva: '2026-11-10', vigenciaNueva: null, diasRestantes: 3, diasExtra: 0 }).join('|')).not.toContain('IVA');
  });
  it('S-06: desglose de IVA contra BigInt en bordes (1 centavo, impares, totales grandes)', () => {
    for (const t of [0, 1, 3, 5, 7, 99, 12_345, 80_000, 123_456_789, 9_007_199_254_740_000]) {
      const iva = Number((BigInt(t) * 13n * 2n + 100n) / 200n);
      expect(desgloseIva(t)).toEqual({ netoCentavos: t - iva, ivaCentavos: iva, totalCentavos: t });
    }
  });
  it('S-06b: la lista sin precio es solo para SuperAdmin', () => {
    const items = [{ nombre: 'IA', precio: null }, { nombre: 'Agenda', precio: 10 }];
    expect(funcionalidadesSinPrecio(items, false)).toEqual([]);
    expect(funcionalidadesSinPrecio(items, true)).toEqual(['IA']);
  });
});
