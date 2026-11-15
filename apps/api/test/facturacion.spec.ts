import { createHmac, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConfiguracionService } from '../src/configuracion/configuracion.service';
import { FacturacionEmisorService } from '../src/facturacion-emisor/facturacion-emisor.service';
import { levantarDoble } from './facturasin-doble-emisor';
import { levantar } from './util';

const SECRETO_SERVICIO = 'secreto-de-gestro-service-0123456789';
const TOKEN_EMISOR = 'TOKEN-DELEGADO-DEL-EMISOR-ULTRA-SECRETO-777';
let t: Awaited<ReturnType<typeof levantar>>;
let fs: Awaited<ReturnType<typeof levantarDoble>>;

beforeAll(async () => {
  fs = await levantarDoble(SECRETO_SERVICIO);
  process.env.FACTURASIN_URL = fs.api; process.env.KYROS_ID_EMISOR_SERVICIO = fs.emisor; process.env.URL_PUBLICA = 'https://gestro.prueba.bo';
  t = await levantar();
  fs.estado.caido = false;
  await t.app.get(ConfiguracionService).guardar('secreto.KYROS_SERVICE_CLIENT_SECRET', { valor: SECRETO_SERVICIO, actualizado: new Date().toISOString(), versiones: 1 }, null);
});
afterAll(async () => { await t.owner.query(`DELETE FROM app_config WHERE clave = 'secreto.KYROS_SERVICE_CLIENT_SECRET'`); await t.cerrar(); await fs.cerrar(); });

const nitUnico = () => `2${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
const CONFIG = (nit: string) => ({ nit, razonSocial: 'Restaurante Ñandú Café S.R.L.', actividades: ['561011'], sucursal: 0, puntoVenta: 0, municipio: 'Santa Cruz de la Sierra', direccion: 'Av. San Martín #123, Equipetrol', leyenda: 'Gracias por su preferencia', modalidad: 'simulado', codigoSinPorDefecto: '63111', unidadPorDefecto: 57, permiteConsumidorFinal: true, habilitada: true, tokenDelegado: TOKEN_EMISOR, tokenVenceEn: '2027-06-30' });

/** Restaurante con dueño y cajero, facturación configurada y conectada al doble de FacturaSIN. */
async function escenario(conectar = true) {
  const d = await t.nuevoRestaurante('Casa Ñandú');
  const dueno = t.con(d.token, d.rid);
  const a = await dueno.post('/personal', { nombre: 'Caja Uno', correo: `${randomUUID()}@t.bo`, roles: ['cajero'] });
  const s = await t.entrarConCodigo(a.body.codigo); const cajero = t.con(s.token, d.rid);
  const nit = nitUnico();
  const pique = (await dueno.post('/menu/platos', { nombre: 'Pique Macho', precio: 65.5, codigoSin: '99001', unidadSin: 58 })).body.id as string;
  const sopa = (await dueno.post('/menu/platos', { nombre: 'Sopa de Maní', precio: 32 })).body.id as string;
  await cajero.post('/caja/abrir', { montoInicial: 100 });
  let cfg;
  if (conectar) { cfg = await dueno.put('/facturacion/config', CONFIG(nit)); expect(cfg.status).toBe(200); const c = await dueno.post('/facturacion/conectar'); expect(c.body.ok, JSON.stringify(c.body)).toBe(true); }
  return { d, dueno, cajero, nit, pique, sopa, cfg };
}
type E = Awaited<ReturnType<typeof escenario>>;

/** Pedido de 163,00 (2 × 65,50 + 1 × 32,00) enviado y listo para cobrar. */
async function pedido(e: E) {
  const p = await e.cajero.post('/pedidos', { tipo: 'llevar', cliente: { nombre: 'Mostrador', telefono: '70000000' } });
  const id = p.body.pedido.id as string;
  await e.cajero.post(`/pedidos/${id}/items`, { items: [{ platoId: e.pique, cantidad: 2 }, { platoId: e.sopa, cantidad: 1 }] });
  await e.cajero.post(`/pedidos/${id}/enviar`);
  return id;
}
const CLIENTE = { comprador: { tipo: 'nit', numero: '1020304050', razonSocial: 'Constructora Ñuflo S.R.L.', correo: 'compras@nuflo.bo' } };
const cobrarConFactura = (e: E, id: string, extra: object = {}, factura: object = CLIENTE) => e.cajero.post(`/pedidos/${id}/cobrar`, { metodo: 'efectivo', documento: 'factura', descuento: 13, motivoDescuento: 'Cumpleaños', propina: 10, efectivoRecibido: 200, factura, ...extra });
const forzarReintento = (id: string) => t.owner.query(`UPDATE fiscal_invoices SET next_retry_at = now() - interval '1 second' WHERE id = $1`, [id]);

describe('Facturación: configuración del restaurante', () => {
  it('solo el dueño la ve y la cambia; valida NIT, vacíos, símbolos y modalidad; conserva tildes y ñ', async () => {
    const e = await escenario(false);
    expect((await e.cajero.get('/facturacion/config')).status).toBe(403);
    expect((await e.cajero.put('/facturacion/config', CONFIG(e.nit))).status).toBe(403);
    const sin = await e.dueno.get('/facturacion/config');
    expect(sin.body.configurada).toBe(false); expect(sin.body.aviso).toMatch(/sin validez fiscal/); expect(sin.body.modalidad).toBe('simulado');
    for (const nit of ['', '1234', '12AB5678', '123-456-789', '12345678901234']) expect((await e.dueno.put('/facturacion/config', { ...CONFIG(e.nit), nit })).status, `NIT ${nit}`).toBe(422);
    expect((await e.dueno.put('/facturacion/config', { ...CONFIG(e.nit), razonSocial: '   ' })).status).toBe(422);
    expect((await e.dueno.put('/facturacion/config', { ...CONFIG(e.nit), razonSocial: '<script>x</script>' })).status).toBe(422);
    expect((await e.dueno.put('/facturacion/config', { ...CONFIG(e.nit), municipio: '' })).status).toBe(422);
    expect((await e.dueno.put('/facturacion/config', { ...CONFIG(e.nit), actividades: [] })).status).toBe(400);
    expect((await e.dueno.put('/facturacion/config', { ...CONFIG(e.nit), actividades: ['abc'] })).status).toBe(400);
    expect((await e.dueno.put('/facturacion/config', { ...CONFIG(e.nit), otraCosa: 1 })).status).toBe(400);
    expect((await e.dueno.put('/facturacion/config', { ...CONFIG(e.nit), modalidad: 'real' })).status).toBe(422);
    const ok = await e.dueno.put('/facturacion/config', CONFIG(e.nit));
    expect(ok.status).toBe(200); expect(ok.body.razonSocial).toBe('Restaurante Ñandú Café S.R.L.'); expect(ok.body.direccion).toContain('San Martín');
    expect(ok.body.tokenRegistrado).toBe(true); expect(ok.body.ambientePruebas).toBe(true); expect(ok.body.modalidad).toBe('simulado');
    // El mismo NIT no lo puede reclamar otra cuenta.
    const otro = await escenario(false);
    expect((await otro.dueno.put('/facturacion/config', CONFIG(e.nit))).status).toBe(409);
  });

  it('el token delegado nunca sale: ni en la API, ni en auditoría, ni en alertas, ni en claro en la base', async () => {
    const e = await escenario();
    const g = await e.dueno.get('/facturacion/config');
    expect(JSON.stringify(g.body)).not.toContain(TOKEN_EMISOR); expect(JSON.stringify(e.cfg!.body)).not.toContain(TOKEN_EMISOR);
    expect(JSON.stringify((await e.dueno.post('/facturacion/probar')).body)).not.toContain(SECRETO_SERVICIO);
    const cfg = await t.owner.query(`SELECT valor_cifrado FROM app_config WHERE clave = $1`, [`facturacion.token.${e.d.rid}`]);
    expect(cfg.rows[0].valor_cifrado).not.toContain(TOKEN_EMISOR);
    expect(await t.app.get(ConfiguracionService).leer<{ valor: string }>(`facturacion.token.${e.d.rid}`)).toMatchObject({ valor: TOKEN_EMISOR });
    const aud = await t.owner.query(`SELECT after::text AS a FROM audit_log WHERE restaurant_id = $1`, [e.d.rid]);
    expect(aud.rows.map((r) => r.a).join('\n')).not.toContain(TOKEN_EMISOR);
    const bd = await t.owner.query(`SELECT to_jsonb(b)::text AS j FROM billing_settings b WHERE restaurant_id = $1`, [e.d.rid]);
    expect(bd.rows[0].j).not.toContain(TOKEN_EMISOR);
    // FacturaSIN recibió el token solo como credencial del emisor, nunca en facturas.
    expect(fs.log.filter((l) => l.ruta.endsWith('/invoices')).map((l) => l.cuerpo).join('')).not.toContain(TOKEN_EMISOR);
    // Quitarlo limpia el valor.
    expect((await e.dueno.put('/facturacion/config', { ...CONFIG(e.nit), tokenDelegado: undefined, quitarToken: true })).body.tokenRegistrado).toBe(false);
    expect((await t.app.get(ConfiguracionService).leer<{ valor: string | null }>(`facturacion.token.${e.d.rid}`))?.valor).toBeNull();
  });

  it('«Probar conexión» y «Conectar»: sin credencial de servicio falla con mensaje claro; conectada, todo en verde y con el webhook suscrito', async () => {
    const e = await escenario(false);
    await e.dueno.put('/facturacion/config', CONFIG(e.nit));
    const antes = await t.app.get(ConfiguracionService).leer<object>('secreto.KYROS_SERVICE_CLIENT_SECRET');
    await t.app.get(ConfiguracionService).guardar('secreto.KYROS_SERVICE_CLIENT_SECRET', { valor: null }, null);
    const p0 = await e.dueno.post('/facturacion/probar'); expect(p0.body.ok).toBe(false); expect(JSON.stringify(p0.body)).toMatch(/credencial/i);
    await t.app.get(ConfiguracionService).guardar('secreto.KYROS_SERVICE_CLIENT_SECRET', antes, null);
    const p1 = await e.dueno.post('/facturacion/probar'); expect(p1.body.ok).toBe(false); expect(JSON.stringify(p1.body)).toMatch(/todavía no está en FacturaSIN/);
    const c = await e.dueno.post('/facturacion/conectar'); expect(c.body.ok).toBe(true);
    expect(c.body.pasos.map((x: { paso: string }) => x.paso)).toContain('Aviso de estados (webhook)');
    const p2 = await e.dueno.post('/facturacion/probar'); expect(p2.body.ok).toBe(true); expect(p2.body.aviso).toMatch(/sin validez fiscal/);
    expect(fs.webhooks.at(-1)?.url).toBe(`https://gestro.prueba.bo/api/v1/public/facturasin/webhook/${e.d.rid}`);
    const cfg = await e.dueno.get('/facturacion/config'); expect(cfg.body.webhookRegistrado).toBe(true); expect(cfg.body.ultimaPrueba.ok).toBe(true);
    // Credencial rechazada por FacturaSIN: no rompe la conexión y avisa.
    fs.estado.permitirCredenciales = false; const e2 = await escenario(false); await e2.dueno.put('/facturacion/config', CONFIG(nitUnico()));
    const c2 = await e2.dueno.post('/facturacion/conectar'); expect(c2.body.pasos.find((x: { paso: string }) => x.paso === 'Credencial del emisor').ok).toBe(false); fs.estado.permitirCredenciales = true;
  });
});

describe('Facturación: emisión, cálculos e idempotencia', () => {
  it('cobra con factura: descuento y propina; la propina no se factura; IVA 13 % exacto; CUF, número, aviso de pruebas y enlaces guardados', async () => {
    const e = await escenario(); const id = await pedido(e);
    const c = await cobrarConFactura(e, id);
    expect(c.status).toBe(200); expect(c.body.recibo).toBeNull(); expect(c.body.monto).toBe('150.00'); expect(c.body.propina).toBe('10.00');
    expect(c.body.facturaError).toBeUndefined();
    const f = c.body.factura;
    expect(f.estado).toBe('validada'); expect(f.numero).toBeGreaterThan(0); expect(f.cuf).toMatch(/^[0-9A-F]{32}$/); expect(f.aviso).toMatch(/sin validez fiscal/);
    // Recálculo independiente en centavos: 2 × 6550 + 3200 = 16300; − 1300 = 15000; IVA = 15000 × 13 / 100 = 1950.
    expect([f.subtotal, f.descuento, f.total, f.ivaReferencial, f.propinaNoFacturada]).toEqual(['163.00', '13.00', '150.00', '19.50', '10.00']);
    const enviado = fs.facturas.find((x) => x.idExterno === `gestro:${id}:1`)!;
    expect(enviado.totales).toEqual({ montoTotal: 150, ivaReferencial: 19.5 });
    expect(enviado.body.descuentoAdicional).toBe(13); expect(enviado.body.moneda).toBe(1); expect(JSON.stringify(enviado.body)).not.toMatch(/propina/i);
    expect(enviado.body.items.map((i: { codigoProductoSin: string; unidadMedida: number }) => [i.codigoProductoSin, i.unidadMedida])).toEqual([['99001', 58], ['63111', 57]]);
    expect(enviado.clave).toBe(`gestro:${id}:1`);
    expect(enviado.body.comprador).toMatchObject({ tipoDocumento: 5, numeroDocumento: '1020304050', razonSocial: 'Constructora Ñuflo S.R.L.', codigoExcepcion: 0 });
    // La contabilidad no se duplica ni cambia: una sola venta, sin separar IVA (GS-N02 pendiente).
    const asi = await t.owner.query(`SELECT count(*)::int n FROM journal_entries WHERE restaurant_id = $1 AND source = 'venta'`, [e.d.rid]); expect(asi.rows[0].n).toBe(1);
    const lectura = await e.cajero.get(`/pedidos/${id}/factura`); expect(lectura.body.factura.numero).toBe(f.numero);
    const pdf = await e.cajero.get(`/facturas/${f.id}/pdf`); expect(pdf.status).toBe(200); expect(pdf.headers['content-type']).toMatch(/pdf/);
    expect((await e.cajero.get(`/facturas/${f.id}/xml`)).status).toBe(403);
    expect((await e.dueno.get(`/facturas/${f.id}/xml`)).status).toBe(200);
  });

  it('idempotencia: reenviar la misma factura no duplica; un segundo «Facturar» se rechaza; la clave es pedido+intento', async () => {
    const e = await escenario(); const id = await pedido(e);
    const f = (await cobrarConFactura(e, id)).body.factura;
    expect((await e.cajero.post(`/pedidos/${id}/facturar`, CLIENTE)).status).toBe(409);
    expect((await e.cajero.post(`/facturas/${f.id}/reintentar`)).status).toBe(409);   // ya emitida: nada que reintentar
    // Simula la pérdida de la respuesta: la fila queda «en cola» con la misma clave y FacturaSIN devuelve la MISMA factura.
    await t.owner.query(`UPDATE fiscal_invoices SET status = 'en_cola', fs_invoice_id = NULL, next_retry_at = now() WHERE id = $1`, [f.id]);
    const r = await e.cajero.post(`/facturas/${f.id}/reintentar`);
    expect(r.status).toBe(200); expect(r.body.estado).toBe('validada'); expect(r.body.numero).toBe(f.numero); expect(r.body.cuf).toBe(f.cuf);
    expect(fs.facturas.filter((x) => x.idExterno === `gestro:${id}:1`)).toHaveLength(1);
  });

  it('la venta NUNCA se bloquea: con FacturaSIN caído queda «pendiente de emitir», con alerta y reintento; al volver se emite una sola vez', async () => {
    const e = await escenario(); const id = await pedido(e);
    fs.estado.caido = true; fs.estado.intentosCaidos = 0;
    const c = await cobrarConFactura(e, id);
    expect(c.status).toBe(200); expect(c.body.monto).toBe('150.00');
    expect(c.body.factura.estado).toBe('en_cola'); expect(c.body.factura.pendienteDeEmitir).toBe(true); expect(c.body.factura.error).toMatch(/SIAT_NO_DISPONIBLE|no responde/i);
    expect(fs.estado.intentosCaidos).toBeGreaterThan(1);   // el SDK reintentó con la misma clave
    expect((await e.cajero.get('/caja/actual')).body.activa).toBe(true);
    const pedidoOk = await e.cajero.get(`/pedidos/${id}`); expect(pedidoOk.body.estado).toBe('cobrado');
    expect((await e.cajero.get('/facturacion/estado')).body.pendientesDeEmitir).toBeGreaterThanOrEqual(1);
    // Segunda y tercera falla: aparece la alerta visible para el dueño.
    for (let i = 0; i < 2; i++) { await forzarReintento(c.body.factura.id); await t.app.get(FacturacionEmisorService).procesarPendientes(); }
    const al = await t.owner.query(`SELECT message FROM alerts WHERE restaurant_id = $1 AND kind = 'facturacion' AND resolved_at IS NULL`, [e.d.rid]);
    expect(al.rows.length).toBe(1); expect(al.rows[0].message).toMatch(/pendiente de emitir/);
    // No se reintenta antes de tiempo.
    const antes = fs.estado.intentosCaidos; await t.app.get(FacturacionEmisorService).procesarPendientes(); expect(fs.estado.intentosCaidos).toBe(antes);
    fs.estado.caido = false; await forzarReintento(c.body.factura.id);
    const r = await t.app.get(FacturacionEmisorService).procesarPendientes(); expect(r.enviadas).toBeGreaterThanOrEqual(1);
    const fin = (await e.cajero.get(`/pedidos/${id}/factura`)).body.factura;
    expect(fin.estado).toBe('validada'); expect(fin.numero).toBeGreaterThan(0);
    expect(fs.facturas.filter((x) => x.idExterno === `gestro:${id}:1`)).toHaveLength(1);
    const al2 = await t.owner.query(`SELECT 1 FROM alerts WHERE restaurant_id = $1 AND kind = 'facturacion' AND resolved_at IS NULL`, [e.d.rid]); expect(al2.rows.length).toBe(0);
  });

  it('sin la credencial de servicio la venta se cobra igual y la factura queda pendiente con la causa visible', async () => {
    const e = await escenario(); const id = await pedido(e);
    const cfg = t.app.get(ConfiguracionService); const antes = await cfg.leer<object>('secreto.KYROS_SERVICE_CLIENT_SECRET');
    await cfg.guardar('secreto.KYROS_SERVICE_CLIENT_SECRET', { valor: null }, null);
    try {
      const c = await cobrarConFactura(e, id);
      expect(c.status).toBe(200); expect(c.body.factura.estado).toBe('en_cola'); expect(c.body.factura.error).toMatch(/credencial/i);
      expect(JSON.stringify(c.body)).not.toContain(SECRETO_SERVICIO);
    } finally { await cfg.guardar('secreto.KYROS_SERVICE_CLIENT_SECRET', antes, null); }
  });

  it('errores del SIN: rechazo y NIT inválido no se reintentan; se corrige y se factura de nuevo con otro intento', async () => {
    const e = await escenario(); const id = await pedido(e);
    const r1 = await cobrarConFactura(e, id, {}, { comprador: { tipo: 'nit', numero: '1020304050', razonSocial: 'RECHAZAR ESTA' } });
    expect(r1.status).toBe(200); expect(r1.body.factura.estado).toBe('rechazada'); expect(r1.body.factura.error).toMatch(/rechaz/i);
    expect((await e.cajero.post(`/facturas/${r1.body.factura.id}/reintentar`)).status).toBe(409);
    const r2 = await e.cajero.post(`/pedidos/${id}/facturar`, { comprador: { tipo: 'nit', numero: '9876543210', razonSocial: 'Empresa Fantasma' } });
    expect(r2.body.estado).toBe('error_datos'); expect(r2.body.error).toMatch(/NIT del comprador inválido/);
    const r3 = await e.cajero.post(`/pedidos/${id}/facturar`, { comprador: { tipo: 'nit', numero: '9876543210', razonSocial: 'Empresa Fantasma', nitConExcepcion: true } });
    expect(r3.body.estado).toBe('validada');
    const h = await e.cajero.get(`/pedidos/${id}/factura`); expect(h.body.factura.intento).toBe(3); expect(h.body.historial).toHaveLength(2);
    expect(fs.facturas.map((x) => x.idExterno).filter((x) => x.startsWith(`gestro:${id}:`))).toEqual([`gestro:${id}:3`]);   // los rechazos no crean factura
  });

  it('datos del comensal: se validan ANTES de cobrar; CI, pasaporte y «sin nombre» (si el dueño lo permite)', async () => {
    const e = await escenario(); const id = await pedido(e);
    for (const factura of [{}, { comprador: { tipo: 'nit', numero: '123', razonSocial: 'X' } }, { comprador: { tipo: 'ci', numero: '4567890', razonSocial: '' } }, { comprador: { tipo: 'ci', numero: '4567890', razonSocial: 'Ana<b>' } }, { comprador: { tipo: 'ci', numero: '4567890', razonSocial: 'Ana', correo: 'mal' } }])
      expect((await cobrarConFactura(e, id, {}, factura)).status).toBe(422);
    expect((await e.cajero.get(`/pedidos/${id}`)).body.estado).not.toBe('cobrado');   // nada se cobró
    const ok = await cobrarConFactura(e, id, {}, { comprador: { tipo: 'pasaporte', numero: 'AB123456', razonSocial: 'John Müller' } });
    expect(ok.body.factura.estado).toBe('validada'); expect(ok.body.factura.comprador).toMatchObject({ tipoDocumento: 3, razonSocial: 'John Müller' });
    const id2 = await pedido(e);
    const sn = await cobrarConFactura(e, id2, { descuento: 0, motivoDescuento: undefined, propina: 0, efectivoRecibido: 200 }, { consumidorFinal: true });
    expect(sn.body.factura.comprador).toMatchObject({ tipoDocumento: 1, numeroDocumento: '0', razonSocial: 'S/N', consumidorFinal: true }); expect(sn.body.factura.total).toBe('163.00'); expect(sn.body.factura.ivaReferencial).toBe('21.19');   // 16300 × 13 % = 2119
    await e.dueno.put('/facturacion/config', { ...CONFIG(e.nit), tokenDelegado: undefined, permiteConsumidorFinal: false });
    const id3 = await pedido(e);
    expect((await cobrarConFactura(e, id3, {}, { consumidorFinal: true })).status).toBe(422);
  });

  it('tarjeta pide los 4+4 dígitos; la factura no se hace sin configuración ni con facturación apagada', async () => {
    const e = await escenario(); const id = await pedido(e);
    const c = await e.cajero.post(`/pedidos/${id}/cobrar`, { metodo: 'tarjeta', documento: 'recibo' });
    expect(c.status).toBe(200);
    expect((await e.cajero.post(`/pedidos/${id}/facturar`, CLIENTE)).status).toBe(422);   // falta tarjeta
    const f = await e.cajero.post(`/pedidos/${id}/facturar`, { ...CLIENTE, tarjeta: { primeros4: '4111', ultimos4: '1111' } });
    expect(f.body.estado).toBe('validada'); expect(fs.facturas.find((x) => x.idExterno === `gestro:${id}:1`)!.body.numeroTarjeta).toBe('4111000000001111');
    const sinCfg = await escenario(false); const id2 = await pedido(sinCfg);
    expect((await sinCfg.cajero.post(`/pedidos/${id2}/cobrar`, { metodo: 'efectivo', documento: 'factura', factura: CLIENTE.comprador ? CLIENTE : {} })).status).toBe(422);
    await e.dueno.put('/facturacion/config', { ...CONFIG(e.nit), tokenDelegado: undefined, habilitada: false });
    const id3 = await pedido(e); expect((await cobrarConFactura(e, id3)).status).toBe(422);
    expect((await e.cajero.get('/facturacion/estado')).body.disponible).toBe(false);
  });
});

describe('Facturación: anulación, estados y webhook de retorno', () => {
  it('anula con motivo (solo dueño); el cobro con factura vigente no se puede anular antes; todo queda en la auditoría', async () => {
    const e = await escenario(); const id = await pedido(e);
    const c = await cobrarConFactura(e, id); const f = c.body.factura;
    expect((await e.cajero.post(`/facturas/${f.id}/anular`, { motivo: 1, comentario: 'Datos mal' })).status).toBe(403);
    expect((await e.dueno.post(`/facturas/${f.id}/anular`, { motivo: 1, comentario: 'x' })).status).toBe(400);
    expect((await e.dueno.post(`/pagos/${c.body.pagoId}/anular`, { motivo: 'prueba' })).status).toBe(409);
    const a = await e.dueno.post(`/facturas/${f.id}/anular`, { motivo: 1, comentario: 'NIT del comensal mal digitado' });
    expect(a.status).toBe(200); expect(a.body.estado).toBe('anulada'); expect(a.body.anulacion.motivo).toBe('NIT del comensal mal digitado');
    expect(fs.facturas.find((x) => x.id === f.fsId || x.idExterno === `gestro:${id}:1`)!.estado).toBe('anulada');
    expect((await e.dueno.post(`/facturas/${f.id}/anular`, { motivo: 1, comentario: 'otra vez' })).status).toBe(409);
    const aud = await t.owner.query(`SELECT action FROM audit_log WHERE restaurant_id = $1 AND entity = 'fiscal_invoice'`, [e.d.rid]);
    expect(aud.rows.map((r) => r.action)).toEqual(expect.arrayContaining(['factura.creada', 'factura.respuesta', 'factura.anulada']));
    // Anulada la factura, se puede reemitir (intento 2) y el cobro ya se puede anular.
    const re = await e.cajero.post(`/pedidos/${id}/facturar`, CLIENTE); expect(re.body.estado).toBe('validada'); expect(re.body.intento).toBe(2);
  });

  it('una factura que nunca salió se cancela sin tocar FacturaSIN; si ya había llegado, se concilia en vez de cancelar', async () => {
    const e = await escenario(); const id = await pedido(e);
    fs.estado.caido = true; const c = await cobrarConFactura(e, id); fs.estado.caido = false;
    expect(c.body.factura.estado).toBe('en_cola');
    const a = await e.dueno.post(`/facturas/${c.body.factura.id}/anular`, { motivo: 3, comentario: 'Se cancela antes de emitir' });
    expect(a.status).toBe(200); expect(a.body.estado).toBe('anulada'); expect(fs.facturas.filter((x) => x.idExterno === `gestro:${id}:1`)).toHaveLength(0);
    // Caso «llegó pero no lo supimos»:
    const id2 = await pedido(e); fs.estado.caido = true; const c2 = await cobrarConFactura(e, id2); fs.estado.caido = false;
    await e.cajero.post(`/facturas/${c2.body.factura.id}/reintentar`);   // llegó y quedó validada
    await t.owner.query(`UPDATE fiscal_invoices SET status = 'en_cola', fs_invoice_id = NULL WHERE id = $1`, [c2.body.factura.id]);
    const x = await e.dueno.post(`/facturas/${c2.body.factura.id}/anular`, { motivo: 1, comentario: 'Probando estados' });
    expect(x.status).toBe(409); expect((await e.dueno.get(`/pedidos/${id2}/factura`)).body.factura.estado).toBe('validada');
  });

  it('conciliación: una factura «pendiente» pasa a validada cuando FacturaSIN lo confirma (sin webhook)', async () => {
    const e = await escenario(); const id = await pedido(e);
    fs.estado.estadoInicial = 'pendiente';
    const c = await cobrarConFactura(e, id); fs.estado.estadoInicial = 'validada';
    expect(c.body.factura.estado).toBe('pendiente');
    fs.facturas.find((x) => x.idExterno === `gestro:${id}:1`)!.estado = 'validada';
    await t.owner.query(`UPDATE fiscal_invoices SET updated_at = now() - interval '5 minutes' WHERE id = $1`, [c.body.factura.id]);
    const r = await t.app.get(FacturacionEmisorService).procesarPendientes(); expect(r.conciliadas).toBeGreaterThanOrEqual(1);
    expect((await e.cajero.get(`/pedidos/${id}/factura`)).body.factura.estado).toBe('validada');
    fs.facturas.find((x) => x.idExterno === `gestro:${id}:1`)!.estado = 'contingencia';
    await t.owner.query(`UPDATE fiscal_invoices SET status = 'pendiente', updated_at = now() - interval '5 minutes' WHERE id = $1`, [c.body.factura.id]);
    expect((await e.cajero.post('/facturacion/conciliar')).body.cambiadas).toBeGreaterThanOrEqual(1);
    expect((await e.cajero.get(`/pedidos/${id}/factura`)).body.factura.estado).toBe('contingencia');
  });

  const firmar = (secreto: string, cuerpo: string, ts = Math.floor(Date.now() / 1000)) => `t=${ts},v1=${createHmac('sha256', secreto).update(`${ts}.${cuerpo}`).digest('hex')}`;
  const enviarHook = (rid: string, cuerpo: string, firma?: string, evento = randomUUID()) => {
    let r = t.api().post(`/api/v1/public/facturasin/webhook/${rid}`).set('content-type', 'application/json').set('X-FacturaSIN-Event-Id', evento);
    if (firma) r = r.set('X-FacturaSIN-Signature', firma);
    return r.send(cuerpo);
  };
  const evento = (tipo: string, f: { idExterno: string; cuf?: string; numero?: number }, creadoEn = new Date().toISOString()) => JSON.stringify({ id: randomUUID(), tipo, empresaId: 'e1', creadoEn, datos: { facturaId: 'x', cuf: f.cuf ?? 'CUF1', numero: f.numero ?? 7, estado: tipo.split('.')[1], idExterno: f.idExterno, ambientePruebas: true } });

  it('webhook firmado: actualiza estados; firma inválida, vencida o ausente se rechaza; duplicados y eventos viejos no cambian nada', async () => {
    const e = await escenario(); const id = await pedido(e);
    fs.estado.estadoInicial = 'pendiente'; const c = await cobrarConFactura(e, id); fs.estado.estadoInicial = 'validada';
    const idExterno = `gestro:${id}:1`; const secreto = fs.webhooks.find((w) => w.url.endsWith(e.d.rid))!.secreto;
    const estadoActual = async () => (await e.cajero.get(`/pedidos/${id}/factura`)).body.factura.estado;
    expect(await estadoActual()).toBe('pendiente');
    // Rechazos
    const cuerpo = evento('factura.validada', { idExterno });
    expect((await enviarHook(e.d.rid, cuerpo)).status).toBe(401);                                                   // sin firma
    expect((await enviarHook(e.d.rid, cuerpo, firmar('otro-secreto', cuerpo))).status).toBe(401);                   // firma de otro secreto
    expect((await enviarHook(e.d.rid, cuerpo, firmar(secreto, cuerpo + ' '))).status).toBe(401);                   // cuerpo alterado
    expect((await enviarHook(e.d.rid, cuerpo, firmar(secreto, cuerpo, Math.floor(Date.now() / 1000) - 400))).status).toBe(401);   // más de 5 minutos
    expect((await enviarHook(randomUUID(), cuerpo, firmar(secreto, cuerpo))).status).toBe(401);                    // restaurante sin secreto
    expect((await enviarHook('no-es-uuid', cuerpo, firmar(secreto, cuerpo))).status).toBe(401);
    expect(await estadoActual()).toBe('pendiente');
    // Válido
    const ok = await enviarHook(e.d.rid, cuerpo, firmar(secreto, cuerpo)); expect(ok.status).toBe(200); expect(ok.body.estado).toBe('validada');
    expect(await estadoActual()).toBe('validada');
    // Duplicado (mismo id de evento)
    const dup = evento('factura.anulada', { idExterno }); const idDup = randomUUID();
    expect((await enviarHook(e.d.rid, dup, firmar(secreto, dup), idDup)).body.estado).toBe('anulada');
    expect((await enviarHook(e.d.rid, dup, firmar(secreto, dup), idDup)).body.duplicado).toBe(true);
    // Evento anterior al último aplicado: no retrocede
    const viejo = evento('factura.validada', { idExterno }, new Date(Date.now() - 3_600_000).toISOString());
    expect((await enviarHook(e.d.rid, viejo, firmar(secreto, viejo))).body.ignorado).toMatch(/anterior/);
    expect(await estadoActual()).toBe('anulada');
    // Evento de factura desconocida y evento sin efecto
    const raro = evento('factura.validada', { idExterno: 'gestro:otro:1' }); expect((await enviarHook(e.d.rid, raro, firmar(secreto, raro))).body.ignorado).toMatch(/desconocida/);
    const ajeno = JSON.stringify({ id: randomUUID(), tipo: 'cufd.fallo', datos: { idExterno: 'x' } }); expect((await enviarHook(e.d.rid, ajeno, firmar(secreto, ajeno))).status).toBe(200);
    // Otra sucursal no puede actuar sobre esta factura aunque tenga firma válida de SU secreto
    const e2 = await escenario(); const secreto2 = fs.webhooks.find((w) => w.url.endsWith(e2.d.rid))!.secreto;
    const cruzado = evento('factura.rechazada', { idExterno }); expect((await enviarHook(e2.d.rid, cruzado, firmar(secreto2, cruzado))).body.ignorado).toMatch(/desconocida/);
    expect(await estadoActual()).toBe('anulada'); expect(c.body.factura.estado).toBe('pendiente');
  });

  it('aislamiento: otra sucursal no ve ni descarga facturas ajenas (RLS)', async () => {
    const e = await escenario(); const id = await pedido(e); const f = (await cobrarConFactura(e, id)).body.factura;
    const o = await escenario();
    expect((await o.dueno.get(`/facturas/${f.id}/pdf`)).status).toBe(404);
    expect((await o.dueno.get(`/pedidos/${id}/factura`)).body.factura).toBeNull();
    expect((await o.dueno.get('/facturas')).body).toHaveLength(0);
    expect((await o.dueno.post(`/facturas/${f.id}/anular`, { motivo: 1, comentario: 'intruso' })).status).toBe(404);
    expect((await e.dueno.get('/facturas?estado=validada')).body.length).toBe(1);
  });
});
