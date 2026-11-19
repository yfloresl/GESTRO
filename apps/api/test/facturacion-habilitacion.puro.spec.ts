import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { FacturacionEmisorService } from '../src/facturacion-emisor/facturacion-emisor.service';

/** Defecto QA 19/11: un interruptor GLOBAL (lo que FacturaSIN conteste de vuelta) no debe ocultar el Flujo 2 a un cliente habilitado por el estándar «pago + interruptor». */
function servicio(o: { override: boolean | null; pago: boolean; globalApagado: boolean }) {
  const declarado: unknown[] = [];
  const enlace = {
    declararHabilitacion: async (...a: unknown[]) => { declarado.push(a); },
    habilitacion: async () => ({ habilitada: !o.globalApagado, origen: 'global', motivo: null, mensaje: 'La facturación electrónica no está habilitada para tu cuenta.' }),
  };
  const s = new FacturacionEmisorService(
    {} as never, { execute: async () => ({ rows: [{ pago: o.pago }] }) } as never,
    { leer: async () => (o.override === null ? null : { valor: o.override }) } as never,
    { conectada: async () => true, puedeEnlazar: async () => true, enlace: async () => enlace } as never,
  );
  return { s, declarado };
}
const t = { restaurantId: '00000000-0000-0000-0000-000000000001' } as never;

describe('Flujo 2: habilitación por cliente, sin que mande el global', () => {
  it('plan de pago vigente + global apagado: habilitada', async () => {
    const { s, declarado } = servicio({ override: null, pago: true, globalApagado: true });
    expect(await s.habilitacion(t)).toMatchObject({ habilitada: true, mensaje: null, motivo: 'por_plan' });
    expect(declarado.length).toBe(1);
  });
  it('override del SuperAdmin encendido + global apagado: habilitada', async () => {
    const { s } = servicio({ override: true, pago: false, globalApagado: true });
    expect(await s.habilitacion(t)).toMatchObject({ habilitada: true, motivo: 'habilitada_por_admin' });
  });
  it('sin plan de pago ni override: «No incluida en tu plan»; override apagado: «Desactivada por el administrador»', async () => {
    const a = await servicio({ override: null, pago: false, globalApagado: false }).s.habilitacion(t);
    expect(a).toMatchObject({ habilitada: false, motivo: 'no_incluida' });
    const b = await servicio({ override: false, pago: true, globalApagado: false }).s.habilitacion(t);
    expect(b).toMatchObject({ habilitada: false, motivo: 'desactivada_por_admin' });
  });
});
