/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { CONFIG_POR_DEFECTO, ConfigFacturacion } from '../src/facturacion-kyros/facturacion-kyros.service';
import { CODIGOS_SIN_PRUEBAS, codigosFiscalesFaltantes, emitirFactura, FacturaSinClient, type AlmacenFacturas, type FilaFactura, type PagoFacturable } from '../src/facturacion-kyros/nucleo';

// Decisión del dueño (16/11): los productos NO se dan de alta en FacturaSIN para los sistemas Kyros; GESTRO ENVÍA los códigos en cada ítem de la factura.
const pago = (): PagoFacturable => ({ pagoId: 'p1', plan: 'Plan Pro', meses: 1, mesesDeRegalo: 0, montoCent: 58350n, desde: null, hasta: null, fiscales: { tipo: 'NIT', numero: '1020304050', razonSocial: 'Cliente SRL' } });
function entorno(emitir: (id: string, d: any, clave?: string) => Promise<any>, extra: Record<string, unknown> = {}) {
  const filas = new Map<string, FilaFactura>();
  const almacen: AlmacenFacturas = {
    obtener: async (id) => filas.get(id) ?? null,
    iniciarIntento: async (p, d) => { const f = { id: `f-${p.pagoId}`, pagoId: p.pagoId, estado: 'emitiendo' as const, intentos: (filas.get(p.pagoId)?.intentos ?? 0) + 1, claveIdempotencia: d.clave, facturasinId: null }; filas.set(p.pagoId, f); return f; },
    guardarResultado: async (id, r) => { const f = filas.get(id)!; filas.set(id, { ...f, estado: r.estado }); },
  };
  return { filas, d: { almacen, cliente: { emitir }, config: { sistema: 'gestro', empresa: 'kyros-tech', sector: 1, sucursal: 0, puntoVenta: 0, metodoPago: 7, codigoProducto: 'SUSC-MENSUAL', codigoProductoSin: '83141', actividadEconomica: '620100', unidadMedida: 58, ...extra } } };
}

describe('Flujo 1 de GESTRO: productos por API (sin alta en FacturaSIN)', () => {
  it('cada ítem lleva codigoProductoSin, actividadEconomica y unidadMedida', async () => {
    let visto: any;
    const { d } = entorno(async (_e, cuerpo) => { visto = cuerpo; return { id: 'x', estado: 'validada', cuf: 'C', numero: 1, totales: {} }; });
    expect(await emitirFactura(d as never, pago())).toMatchObject({ ok: true });
    expect(visto.items[0]).toMatchObject({ codigoProducto: 'SUSC-MENSUAL', codigoProductoSin: '83141', actividadEconomica: '620100', unidadMedida: 58, cantidad: 1, precioUnitario: 583.5 });
  });
  it('sin códigos configurados no llama a FacturaSIN: queda pendiente con aviso de qué configurar y dónde', async () => {
    let llamadas = 0;
    const { d, filas } = entorno(async () => { llamadas++; return {}; }, { codigoProductoSin: '', actividadEconomica: undefined });
    const r = await emitirFactura(d as never, pago());
    expect(llamadas).toBe(0);
    expect(r).toMatchObject({ ok: false, estado: 'pendiente', codigo: 'CODIGOS_SIN_NO_CONFIGURADOS', reintentable: false });
    if (!r.ok) { expect(r.mensaje).toContain('código de producto SIN'); expect(r.mensaje).toContain('actividad económica'); expect(r.mensaje).not.toMatch(/Configuración → Productos/); }
    expect(filas.get('p1')!.estado).toBe('pendiente');
  });
  it('los predeterminados provisionales (NO CONFIRMADO) salen del catálogo simulado de FacturaSIN', () => {
    expect(CODIGOS_SIN_PRUEBAS).toEqual({ codigoProductoSin: '83141', actividadEconomica: '620100' });
    expect(codigosFiscalesFaltantes({ codigoProductoSin: ' ', actividadEconomica: '620100' })).toHaveLength(1);
    expect(codigosFiscalesFaltantes(CODIGOS_SIN_PRUEBAS)).toEqual([]);
    expect(CONFIG_POR_DEFECTO).toMatchObject({ codigoProductoSin: '83141', actividadEconomica: '620100', unidadMedida: 58, codigosConfirmados: false });
    expect(ConfigFacturacion.safeParse(CONFIG_POR_DEFECTO).success).toBe(true);
    expect(ConfigFacturacion.safeParse({ ...CONFIG_POR_DEFECTO, codigoProductoSin: 'ABC' }).success).toBe(false);
  });
  it('el cliente lee un catálogo sincronizado con GET /v1/catalog/{nombre} y la cabecera de la empresa', async () => {
    let url = ''; let cab: any;
    const c = new FacturaSinClient({ baseUrl: 'https://f.test/api', sistema: 'gestro', token: async () => 't', fetchImpl: (async (u: string, i: any) => { url = u; cab = i.headers; return new Response(JSON.stringify({ nombre: 'unidadMedida', sincronizado: true, items: [{ codigoClasificador: 58 }] }), { status: 200 }); }) as never });
    const r = await c.catalogo('kyros-tech', 'unidadMedida');
    expect(url).toBe('https://f.test/api/v1/catalog/unidadMedida');
    expect(cab['x-empresa-externa']).toBe('gestro:kyros-tech');
    expect(r.items).toHaveLength(1);
  });
});
