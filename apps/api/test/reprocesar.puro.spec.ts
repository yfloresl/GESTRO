import { beforeEach, describe, expect, it } from 'vitest';
import { FacturacionKyrosService } from '../src/facturacion-kyros/facturacion-kyros.service';
import { FacturaSinError } from '../src/facturacion-kyros/nucleo';

/** Base de datos de mentira: registra cada sentencia y responde con la factura de Kyros-Tech «emitida antes del cambio» (sin CUF ni detalle completo). */
const sentencias: string[] = [];
let fila: Record<string, unknown> = {};
let sinVista: Record<string, unknown>[] = [];
const textoDe = (q: { queryChunks?: Array<{ value?: string[] } | unknown> }) => (q.queryChunks ?? []).map((c) => (c && typeof c === 'object' && 'value' in (c as object) ? ((c as { value: string[] }).value ?? []).join('') : '?')).join('');
const bd = {
  execute: async (q: { queryChunks?: Array<{ value?: string[] } | unknown> }) => {
    const texto = textoDe(q);
    sentencias.push(texto);
    if (/^\s*SELECT id, status, restaurant_id, idempotency_key, facturasin_id FROM kyros_invoices/.test(texto) || /^\s*SELECT id FROM kyros_invoices WHERE idempotency_key/.test(texto)) return { rows: [fila] };
    if (/fs_response IS NULL OR cuf IS NULL/.test(texto)) return { rows: sinVista };
    return { rows: [] };
  },
};

const VISTA = { id: 'fs-2', numero: 2, cuf: 'CUF-DE-LA-2', estado: 'validada', fechaEmision: '2026-11-15T14:00:00.000Z', totales: { montoTotal: 100 }, desglose: { neto: 87, iva: 13, total: 100 }, enlaces: { pdf: '/p', xml: '/x', qr: '/q' } };

function servicio(cliente: unknown, integracion: Record<string, unknown> = {}) {
  const cfg = { leer: async () => null, guardar: async () => undefined };
  const conexion = { cliente: async () => cliente };
  const T = FacturacionKyrosService as unknown as new (...a: unknown[]) => FacturacionKyrosService;
  return new T(bd, {}, cfg, integracion, conexion, {});
}
const actor = { sub: '00000000-0000-0000-0000-000000000001' } as never;

beforeEach(() => {
  sentencias.length = 0;
  sinVista = [];
  fila = { id: 'inv-2', status: 'emitida', restaurant_id: 'r1', idempotency_key: 'gestro:suscripcion-pago-2', facturasin_id: 'fs-2' };
});

describe('«Reprocesar»: factura emitida ANTES del cambio (sin CUF ni detalle completo)', () => {
  it('busca por el id que FacturaSIN le dio, rellena CUF/numero/fecha aunque el estado ya sea «emitida» y guarda la vista completa sin alterar totales', async () => {
    const llamadas: string[] = [];
    const s = servicio({ obtener: async (e: string, id: string) => { llamadas.push(`obtener ${e} ${id}`); return VISTA; }, porIdExterno: async () => { throw new Error('no deberia hacer falta'); } });
    const r = await s.reprocesar(actor, 'inv-2');
    expect(r).toMatchObject({ ok: true, estado: 'emitida', registrada: true });
    expect(r.mensaje).toBe('Factura registrada (emitida).');
    expect(llamadas).toEqual(['obtener kyros-tech fs-2']);
    expect(sentencias.find((t) => /SET facturasin_id = COALESCE.*cuf = COALESCE\(cuf,/.test(t))).toBeTruthy();
    const vista = sentencias.find((t) => /SET fs_response = /.test(t));
    expect(vista).toMatch(/emitted_at = COALESCE\(emitted_at,/);
    expect(vista).toMatch(/verified_at = now\(\)/);
  });

  it('si no hay facturasin_id busca por el id externo REAL con que se emitio y, si no, sin el prefijo del sistema', async () => {
    fila = { ...fila, facturasin_id: null };
    const vistos: string[] = [];
    const s = servicio({ obtener: async () => { throw new Error('sin id'); }, porIdExterno: async (id: string) => { vistos.push(id); if (id.startsWith('gestro:')) throw new FacturaSinError(404, 'NO_ENCONTRADO', 'x'); return VISTA; } });
    const r = await s.reprocesar(actor, 'inv-2');
    expect(vistos).toEqual(['gestro:suscripcion-pago-2', 'suscripcion-pago-2']);
    expect(r).toMatchObject({ ok: true, registrada: true });
  });

  it('si FacturaSIN no la devuelve, el mensaje dice que respondio y que hace el sistema (nunca queda mudo)', async () => {
    const s = servicio({ obtener: async () => { throw new FacturaSinError(404, 'NO_ENCONTRADO', 'no existe'); }, porIdExterno: async () => { throw new FacturaSinError(404, 'NO_ENCONTRADO', 'no existe'); } });
    const r = await s.reprocesar(actor, 'inv-2');
    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/HTTP 404/);
    expect(r.mensaje).toMatch(/reintenta solo/);
  });

  it('desde una ENTREGA no registrada: si no se puede leer la factura, pide a FacturaSIN reenviar esa entrega y lo dice', async () => {
    const reenviadas: string[] = [];
    const s = servicio({ obtener: async () => { throw new FacturaSinError(503, 'X', 'caido'); }, porIdExterno: async () => { throw new FacturaSinError(503, 'X', 'caido'); } }, { reintentarEntrega: async (id: string) => { reenviadas.push(id); } });
    const r = await s.reprocesarEntrega(actor, { idExterno: 'gestro:suscripcion-pago-2', entregaId: 'ent-9' });
    expect(reenviadas).toEqual(['ent-9']);
    expect(r.ok).toBe(true);
    expect(r.mensaje).toMatch(/reenvie esa entrega/);
  });

  it('completarVistas registra las facturas sin vista sin depender de interruptores', async () => {
    sinVista = [fila];
    let consultas = 0;
    const s = servicio({ obtener: async () => { consultas++; return VISTA; } });
    expect(await s.completarVistas()).toBe(1);
    expect(consultas).toBe(1);
  });
});
