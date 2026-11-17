import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TipoCambioService } from '../src/suscripcion/planes-publicos';
import { ConfiguracionService } from '../src/configuracion/configuracion.service';
import { FacturacionKyrosService } from '../src/facturacion-kyros/facturacion-kyros.service';
import { levantarFacturaSin } from './facturasin-doble';
import { levantar } from './util';

let t: Awaited<ReturnType<typeof levantar>>;
let fs: Awaited<ReturnType<typeof levantarFacturaSin>>;
let kyros: Awaited<ReturnType<Awaited<ReturnType<typeof levantar>>['nuevaPlataforma']>>;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const P = '/plataforma/facturacion-kyros';
const ref = () => `REF-${randomUUID().slice(0, 8)}`;
const esperar = async <T>(f: () => Promise<T | null | undefined | false>, ms = 8000): Promise<T> => { const fin = Date.now() + ms; for (;;) { const v = await f(); if (v) return v; if (Date.now() > fin) throw new Error('Tiempo agotado esperando la condición'); await new Promise((r) => setTimeout(r, 50)); } };

beforeAll(async () => {
  t = await levantar(); fs = await levantarFacturaSin(); kyros = await t.nuevaPlataforma();
  // TCO del día fijo (11,67; nunca 6,96) en lugar de llamar a kyros-tech.com.
  t.app.get(TipoCambioService).actual = async () => ({ bob: 11.67, fecha: '2026-11-15', vigente: true, fuente: 'dato de prueba' });
  // El secreto del client gestro-service se guarda como lo hace la consola de integraciones (cifrado en app_config); aquí es un valor de prueba.
  await t.app.get(ConfiguracionService).guardar('secreto.KYROS_SERVICE_CLIENT_SECRET', { valor: 'secreto-de-prueba-0123456789', actualizado: new Date().toISOString(), versiones: 1 }, null);
  const r = await kyros.put(`${P}/integracion`, { activo: true, url: fs.apiUrl, issuer: fs.issuer });
  expect(r.status).toBe(200);
});
afterAll(async () => {
  // La base de pruebas se comparte entre archivos: no dejes el secreto ni la configuración (integraciones.spec espera «no configurada»).
  await t.owner.query("DELETE FROM app_config WHERE clave IN ('secreto.KYROS_SERVICE_CLIENT_SECRET','facturacion.kyros','facturacion.kyros.webhook')");
  await fs.cerrar(); await t.cerrar();
});

/** Restaurante nuevo con plan en USD (10 x TCO 11,67 = Bs 116,70) y su pago ya subido con voucher, listo para aprobar. */
async function escenario(o: { nit?: string | null; razon?: string; monto?: number; meses?: number } = {}) {
  const d = await t.nuevoRestaurante(o.razon ?? 'Casa Andina');
  const dueno = t.con(d.token, d.rid);
  const plan = (await kyros.post('/plataforma/planes', { codigo: `P${randomUUID().slice(0, 6)}`, nombre: 'Plan Pro', precioMensual: 116.7 })).body.id as string;
  await t.owner.query(`UPDATE plans SET monthly_price_usd = 10 WHERE id = $1`, [plan]);
  await t.owner.query(`UPDATE restaurants SET plan_id = $1 WHERE id = $2`, [plan, d.rid]);
  if (o.nit !== null) expect((await dueno.put('/suscripcion/datos-fiscales', { tipo: 'NIT', numero: o.nit ?? '1020304050', razonSocial: o.razon ?? 'Casa Andina SRL' })).status).toBe(200);
  const p = await dueno.post('/suscripcion/pagos', { meses: o.meses ?? 1, monto: o.monto ?? 116.7, referencia: ref(), banco: 'BNB' });
  await t.api().put(`/api/v1/suscripcion/pagos/${p.body.id}/voucher`).set('Authorization', `Bearer ${d.token}`).set('X-Restaurant-Id', d.rid).set('Content-Type', 'image/png').send(PNG);
  await t.owner.query(`UPDATE subscription_payments SET fx_usd_bob = 11.67, fx_fecha = '2026-11-15', fx_fuente = 'dato de prueba' WHERE id = $1`, [p.body.id]);
  return { d, dueno, pagoId: p.body.id as string };
}
type E = Awaited<ReturnType<typeof escenario>>;
const aprobar = async (e: E) => { const r = await kyros.post(`/plataforma/pagos/${e.pagoId}/aprobar`); expect(r.status).toBe(200); return r.body; };
const fila = async (pagoId: string) => (await t.owner.query('SELECT * FROM kyros_invoices WHERE payment_id = $1', [pagoId])).rows[0];
const finalizada = (pagoId: string) => esperar(async () => { const f = await fila(pagoId); return f && f.status !== 'emitiendo' ? f : null; });
const enListado = async (pagoId: string, q = '') => ((await kyros.get(`${P}?limite=500${q}`)).body.filas as any[]).find((x) => x.pagoId === pagoId);
const llamadasPost = () => fs.llamadas.filter((l) => l.metodo === 'POST' && l.ruta === '/api/v1/invoices');

describe('Flujo 1: pago validado -> factura de Kyros-Tech al restaurante', () => {
  it('al validar el pago se emite sola: Bs 116,70, IVA 15,17, simulada, con clave = id de pago', async () => {
    const e = await escenario(); const antes = llamadasPost().length;
    const ap = await aprobar(e);
    expect(ap.hasta).toBeTruthy(); // la activación ocurre igual
    const f = await finalizada(e.pagoId);
    expect(f).toMatchObject({ status: 'emitida', total_bob_cent: '11670', iva_bob_cent: '1517', iva_fs_cent: '1517', test_environment: true, buyer_doc_number: '1020304050', buyer_fallback: false });
    expect(f.idempotency_key).toBe(`gestro:suscripcion-${e.pagoId}`);
    expect(f.cuf).toBeTruthy(); expect(Number(f.invoice_number)).toBeGreaterThan(0);
    expect(llamadasPost().length).toBe(antes + 1);
    const ult = fs.llamadas.filter((l) => l.metodo === 'POST').pop()!;
    expect(ult).toMatchObject({ empresa: 'gestro:kyros-tech', clave: `gestro:suscripcion-${e.pagoId}` });
    const body = fs.facturas.find((x) => x.clave === ult.clave)!.cuerpo;
    expect(body.items[0]).toMatchObject({ codigoProducto: 'SUSC-MENSUAL', cantidad: 1, precioUnitario: 116.7 });
    expect(body.extras).toMatchObject({ precioUsd: '10.00', tcoUsdBob: '11.670000' });
    expect(body.metodoPago).toBe(7); expect(body.comprador).toMatchObject({ tipoDocumento: 5, numeroDocumento: '1020304050' });
    const v = await enListado(e.pagoId);
    expect(v).toMatchObject({ estado: 'emitida', simulada: true, total: '116.70', iva: '15.17', sinFactura: false });
    expect((await kyros.get(`${P}?estado=simulada&limite=500`)).body.filas.some((x: any) => x.pagoId === e.pagoId)).toBe(true);
  });

  it('un pago NO validado no se factura (sin pago validado no hay factura)', async () => {
    const e = await escenario();
    const r = await kyros.post(`${P}/pagos/${e.pagoId}/emitir`, {});
    expect(r.status).toBe(409);
    expect(await fila(e.pagoId)).toBeUndefined();
  });

  it('reintento idempotente: misma clave, la misma factura, nunca dos', async () => {
    const e = await escenario(); await aprobar(e); const f1 = await finalizada(e.pagoId);
    const antes = fs.facturas.length;
    const otra = await kyros.post(`${P}/pagos/${e.pagoId}/reintentar`, {});
    expect(otra.body).toMatchObject({ ok: true, estado: 'emitida', yaExistia: true });
    // Respuesta perdida: GESTRO cree que no emitió; FacturaSIN ya la tenía. Misma clave -> misma factura.
    await t.owner.query(`UPDATE kyros_invoices SET status = 'pendiente', facturasin_id = NULL, cuf = NULL, invoice_number = NULL WHERE payment_id = $1`, [e.pagoId]);
    const r = await kyros.post(`${P}/pagos/${e.pagoId}/reintentar`, {});
    expect(r.body).toMatchObject({ ok: true, estado: 'emitida' });
    expect(fs.facturas.length).toBe(antes);
    const f2 = await fila(e.pagoId);
    expect(f2.cuf).toBe(f1.cuf); expect(f2.invoice_number).toBe(f1.invoice_number);
    // y se auditó cada acción
    const aud = (await t.owner.query(`SELECT action FROM audit_log WHERE entity = 'kyros_invoice' AND entity_id = $1`, [e.pagoId])).rows.map((x) => x.action);
    expect(aud).toEqual(expect.arrayContaining(['facturacion_kyros.emision_automatica', 'facturacion_kyros.reintentar']));
  });

  it('FacturaSIN caído: el pago se activa igual, queda pendiente con alerta y el ciclo la emite al volver', async () => {
    const e = await escenario(); fs.modo.caido = true;
    try {
      const antesAlertas = (await kyros.get(`${P}/alertas`)).body;
      const ap = await aprobar(e); expect(ap.hasta).toBeTruthy();
      const f = await finalizada(e.pagoId);
      expect(f).toMatchObject({ status: 'pendiente', last_error_code: 'SIAT_NO_DISPONIBLE', retryable: true });
      const hab = (await e.dueno.get('/suscripcion')).body; expect(hab.habilitadaHasta).toBeTruthy(); expect(hab.pagos[0].estado).toBe('validado');
      expect(await enListado(e.pagoId)).toMatchObject({ estado: 'pendiente', sinFactura: true });
      expect((await kyros.get(`${P}/alertas`)).body.sinFactura).toBe(antesAlertas.sinFactura + 1);
      expect((await kyros.get(`${P}?estado=pendiente&limite=500`)).body.filas.some((x: any) => x.pagoId === e.pagoId)).toBe(true);
    } finally { fs.modo.caido = false; }
    const ser = t.app.get(FacturacionKyrosService);
    expect((await ser.ciclo()).reintentadas).toBe(0); // todavía dentro de la espera
    await t.owner.query(`UPDATE kyros_invoices SET last_attempt_at = now() - interval '2 hours' WHERE payment_id = $1`, [e.pagoId]);
    await ser.ciclo();
    expect(await fila(e.pagoId)).toMatchObject({ status: 'emitida', last_error_code: null });
  });

  it('rechazo del SIN: queda rechazada con el motivo; reintentar usa otra clave y emite', async () => {
    const e = await escenario(); fs.modo.rechazar = true;
    try { await aprobar(e); const f = await finalizada(e.pagoId); expect(f).toMatchObject({ status: 'rechazada', last_error_code: 'SIAT_RECHAZO' }); }
    finally { fs.modo.rechazar = false; }
    expect((await kyros.get(`${P}?estado=rechazada&limite=500`)).body.filas.some((x: any) => x.pagoId === e.pagoId)).toBe(true);
    const r = await kyros.post(`${P}/pagos/${e.pagoId}/reintentar`, {});
    expect(r.body).toMatchObject({ ok: true, estado: 'emitida' });
    const f = await fila(e.pagoId);
    expect(f.idempotency_key).toBe(`gestro:suscripcion-${e.pagoId}:r2`); expect(Number(f.attempts)).toBe(2);
  });

  it('estado «pendiente» del SIN: queda en proceso y la conciliación la cierra', async () => {
    const e = await escenario(); fs.modo.estadoNuevo = 'pendiente';
    try { await aprobar(e); expect(await finalizada(e.pagoId)).toMatchObject({ status: 'en_proceso' }); } finally { fs.modo.estadoNuevo = 'validada'; }
    fs.facturas.find((x) => x.clave === `gestro:suscripcion-${e.pagoId}`)!.estado = 'validada';
    expect((await kyros.post(`${P}/conciliar`, {})).body.conciliadas).toBeGreaterThanOrEqual(1);
    expect(await fila(e.pagoId)).toMatchObject({ status: 'emitida' });
  });

  it('sin datos fiscales: alerta, no bloqueo; consumidor final solo si una persona lo pide y queda marcado', async () => {
    const e = await escenario({ nit: null }); const antes = llamadasPost().length;
    await aprobar(e); await new Promise((r) => setTimeout(r, 300));
    expect(await fila(e.pagoId)).toBeUndefined(); expect(llamadasPost().length).toBe(antes);
    expect(await enListado(e.pagoId)).toMatchObject({ estado: 'pendiente', errorCodigo: 'SIN_DATOS_FISCALES', sinFactura: true });
    const r = await kyros.post(`${P}/pagos/${e.pagoId}/emitir`, {});
    expect(r.body).toMatchObject({ ok: false, codigo: 'SIN_DATOS_FISCALES' });
    const cf = await kyros.post(`${P}/pagos/${e.pagoId}/emitir`, { consumidorFinal: true });
    expect(cf.body).toMatchObject({ ok: true, estado: 'emitida' });
    expect(await fila(e.pagoId)).toMatchObject({ buyer_fallback: true, buyer_doc_number: '0', buyer_name: 'S/N' });
    expect((await enListado(e.pagoId)).comprador).toMatchObject({ consumidorFinal: true });
  });

  it('datos fiscales inválidos guardados antes: no sale ninguna llamada y queda la alerta', async () => {
    const e = await escenario({ nit: '99999' });
    await t.owner.query(`UPDATE accounts SET nit = '0999' WHERE id = (SELECT account_id FROM restaurants WHERE id = $1)`, [e.d.rid]); // dato viejo inválido
    await aprobar(e); await new Promise((r) => setTimeout(r, 300));
    expect(await enListado(e.pagoId)).toMatchObject({ errorCodigo: 'SIN_DATOS_FISCALES' });
  });

  it('anulación con motivo: solo emitidas, auditada, no se repite', async () => {
    const e = await escenario(); await aprobar(e); const f = await finalizada(e.pagoId);
    expect((await kyros.post(`${P}/facturas/${f.id}/anular`, { motivo: 1 })).status).toBe(400);
    expect((await kyros.post(`${P}/facturas/${f.id}/anular`, { motivo: 9, comentario: 'mal' })).status).toBe(400);
    const r = await kyros.post(`${P}/facturas/${f.id}/anular`, { motivo: 1, comentario: 'Pago devuelto al cliente' });
    expect(r.body).toMatchObject({ ok: true, estado: 'anulada' });
    expect(await fila(e.pagoId)).toMatchObject({ status: 'anulada', void_reason_code: 1, void_comment: 'Pago devuelto al cliente' });
    expect(fs.facturas.find((x) => x.id === f.facturasin_id)!.estado).toBe('anulada');
    expect((await kyros.post(`${P}/facturas/${f.id}/anular`, { motivo: 1, comentario: 'otra vez' })).status).toBe(409);
    const a = (await t.owner.query(`SELECT user_id FROM audit_log WHERE action = 'facturacion_kyros.anulada' AND entity_id = $1`, [f.id])).rows;
    expect(a).toHaveLength(1); expect(a[0].user_id).toBe(kyros.userId);
    expect(await enListado(e.pagoId)).toMatchObject({ estado: 'anulada', sinFactura: false });
    // no se puede reemitir lo anulado sin querer
    expect((await kyros.post(`${P}/pagos/${e.pagoId}/reintentar`, {})).body).toMatchObject({ ok: true, estado: 'anulada', yaExistia: true });
  });
});

describe('Documentos, listado, totales y exportación', () => {
  it('PDF, XML y QR llegan por GESTRO (sin exponer FacturaSIN) y el cliente solo ve los suyos', async () => {
    const e = await escenario(); await aprobar(e); const f = await finalizada(e.pagoId);
    const pdf = await t.api().get(`/api/v1${P}/facturas/${f.id}/pdf`).set('Authorization', `Bearer ${kyros.token}`).buffer(true).parse((r, cb) => { const c: Buffer[] = []; r.on('data', (d: Buffer) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); });
    expect(pdf.status).toBe(200); expect(pdf.headers['content-type']).toBe('application/pdf'); expect(String(pdf.body).startsWith('%PDF')).toBe(true); expect(pdf.headers['x-ambiente-fiscal']).toContain('pruebas');
    expect((await kyros.get(`${P}/facturas/${f.id}/xml`)).text).toContain('facturaElectronica');
    expect((await kyros.get(`${P}/facturas/${f.id}/qr`)).headers['content-type']).toBe('image/png');
    const mias = (await e.dueno.get('/suscripcion/facturas')).body;
    expect(mias).toHaveLength(1); expect(mias[0]).toMatchObject({ estado: 'emitida', total: '116.70', iva: '15.17', simulada: true });
    expect((await t.api().get(`/api/v1/suscripcion/facturas/${f.id}/pdf`).set('Authorization', `Bearer ${e.d.token}`).set('X-Restaurant-Id', e.d.rid)).status).toBe(200);
    const otro = await t.nuevoRestaurante('Otro');
    expect((await t.con(otro.token, otro.rid).get('/suscripcion/facturas')).body).toHaveLength(0);
    expect((await t.api().get(`/api/v1/suscripcion/facturas/${f.id}/pdf`).set('Authorization', `Bearer ${otro.token}`).set('X-Restaurant-Id', otro.rid)).status).toBe(404);
  });

  it('totales exactos: cobrado, facturado, IVA recalculado y por facturar; cuadran con la suma independiente', async () => {
    const razon = `Totales ${randomUUID().slice(0, 6)}`;
    const a = await escenario({ razon, monto: 116.7 }); const b = await escenario({ razon: `${razon} B`, monto: 408.45, nit: '2030405060' }); const c = await escenario({ razon: `${razon} C`, nit: null, monto: 233.4 });
    await aprobar(a); await aprobar(b); await aprobar(c); await finalizada(a.pagoId); await finalizada(b.pagoId); await new Promise((r) => setTimeout(r, 200));
    const r = (await kyros.get(`${P}?cliente=${encodeURIComponent(razon)}`)).body;
    expect(r.filas).toHaveLength(3);
    expect(r.totales).toMatchObject({ pagos: 3, cobrado: '758.55', facturado: '525.15', iva: '68.27', ivaRecalculado: '68.27', porFacturar: '233.40', anulado: '0.00' });
    expect(r.totales.control).toMatchObject({ ivaCoincide: true, filasIvaDistinto: 0, filasIvaDistintoDeFacturaSin: 0, filasTotalDistintoDelPago: 0 });
    // 15,17 (116,70) + 53,10 (408,45) = 68,27
    // filtros
    expect((await kyros.get(`${P}?cliente=${encodeURIComponent(razon)}&estado=pendiente`)).body.filas).toHaveLength(1);
    expect((await kyros.get(`${P}?cliente=${encodeURIComponent(razon)}&estado=emitida`)).body.filas).toHaveLength(2);
    expect((await kyros.get(`${P}?cliente=%25&estado=emitida&limite=5`)).body.filas.length).toBeLessThanOrEqual(5); // % se escapa, no es comodín
    expect((await kyros.get(`${P}?mes=2020-01&cliente=${encodeURIComponent(razon)}`)).body.filas).toHaveLength(0);
    expect((await kyros.get(`${P}?estado=raro`)).status).toBe(400);
    expect((await kyros.get(`${P}?mes=2026-13`)).status).toBe(400);
  });

  it('CSV: cabecera, totales y sin inyección de fórmulas', async () => {
    const e = await escenario({ razon: '=HYPERLINK("http://x","clic")', nit: '3040506070' });
    await aprobar(e); await finalizada(e.pagoId);
    const r = await kyros.get(`${P}/exportar.csv?cliente=HYPERLINK`);
    expect(r.status).toBe(200); expect(r.headers['content-type']).toContain('text/csv'); expect(r.headers['content-disposition']).toContain('attachment');
    expect(r.text).toContain('"Pago","Cliente"'); expect(r.text).toContain('"\'=HYPERLINK(""http://x"",""clic"")"'); expect(r.text).toContain('116.70,15.17,116.70');
    expect(r.text.split('\r\n').some((l) => /^"?[=+@]/.test(l))).toBe(false);
    for (const celda of r.text.match(/"(?:[^"]|"")*"/g) ?? []) expect(celda.startsWith('"=') || celda.startsWith('"+') || celda.startsWith('"@')).toBe(false);
  });
});

describe('Webhook de retorno', () => {
  let secreto = ''; let destino = '';
  beforeAll(async () => {
    // Cero configuracion: no hay ruta que reciba una URL ni un secreto; el servidor deriva la URL de la peticion y suscribe solo.
    expect((await kyros.post(`${P}/webhook/suscribir`, { url: 'https://otro-dominio.test/x' })).status).toBe(404);
    expect((await kyros.put(`${P}/webhook/secreto`, { valor: 'a'.repeat(64) })).status).toBe(404);
    const s = await kyros.post(`${P}/integracion/verificar`, {});
    expect(s.status).toBe(200); expect(s.body.ok).toBe(true); expect(JSON.stringify(s.body)).not.toMatch(/"secreto"|secretos/i); // el secreto no vuelve por la API
    expect(fs.webhooks).toHaveLength(1); expect((await kyros.post(`${P}/integracion/verificar`, {})).status).toBe(200); expect(fs.webhooks).toHaveLength(1); // idempotente: sin duplicados
    secreto = fs.webhooks.at(-1)!.secreto; destino = `${t.url}/api/v1/webhooks/facturasin`;
  });

  it('firma inválida, cuerpo alterado, sin firma y firma vieja: 401 y nada cambia', async () => {
    fs.modo.estadoNuevo = 'pendiente'; const e = await escenario(); try { await aprobar(e); await finalizada(e.pagoId); } finally { fs.modo.estadoNuevo = 'validada'; }
    const hecho = fs.facturas.find((x) => x.clave === `gestro:suscripcion-${e.pagoId}`)!;
    expect((await fs.enviarEvento(destino, 'f'.repeat(64), 'factura.validada', hecho)).status).toBe(401);
    const malo = await fs.enviarEvento(destino, secreto, 'factura.validada', hecho, { t: Math.floor(Date.now() / 1000) - 400 }); expect(malo.status).toBe(401);
    expect((await fetch(destino, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"id":"x"}' })).status).toBe(401);
    expect(await fila(e.pagoId)).toMatchObject({ status: 'en_proceso' });
  });

  it('firma válida: actualiza el estado; el evento repetido se ignora; el desordenado no retrocede', async () => {
    fs.modo.estadoNuevo = 'pendiente'; const e = await escenario(); try { await aprobar(e); await finalizada(e.pagoId); } finally { fs.modo.estadoNuevo = 'validada'; }
    const hecho = fs.facturas.find((x) => x.clave === `gestro:suscripcion-${e.pagoId}`)!; const evId = randomUUID();
    const r1 = await fs.enviarEvento(destino, secreto, 'factura.validada', hecho, { id: evId }); expect(r1.status).toBe(200); expect((await r1.json() as any).resultado).toBe('aplicado');
    expect(await fila(e.pagoId)).toMatchObject({ status: 'emitida' });
    expect((await (await fs.enviarEvento(destino, secreto, 'factura.validada', hecho, { id: evId })).json() as any).resultado).toBe('duplicado');
    expect((await (await fs.enviarEvento(destino, secreto, 'factura.pendiente', hecho)).json() as any).resultado).toBe('sin_cambio'); // llegó tarde
    expect(await fila(e.pagoId)).toMatchObject({ status: 'emitida' });
    expect((await (await fs.enviarEvento(destino, secreto, 'factura.anulada', hecho)).json() as any).resultado).toBe('aplicado');
    expect(await fila(e.pagoId)).toMatchObject({ status: 'anulada' });
    expect((await (await fs.enviarEvento(destino, secreto, 'factura.validada', hecho)).json() as any).resultado).toBe('sin_cambio'); // anulada manda
    const ajeno = { ...hecho, id: randomUUID(), idExterno: 'otro:1' };
    expect((await (await fs.enviarEvento(destino, secreto, 'factura.validada', ajeno as any)).json() as any).resultado).toBe('factura_desconocida');
  });
});

describe('Permisos y configuración', () => {
  it('el panel es solo del equipo de Kyros-Tech: un dueño de restaurante 403, sin sesión 401', async () => {
    const e = await escenario();
    const rutas: Array<['get' | 'post' | 'put', string, object?]> = [['get', P], ['get', `${P}/alertas`], ['get', `${P}/exportar.csv`], ['get', `${P}/integracion`], ['put', `${P}/integracion`, { activo: false }], ['post', `${P}/pagos/${e.pagoId}/emitir`, {}], ['post', `${P}/pagos/${e.pagoId}/reintentar`, {}], ['post', `${P}/facturas/${randomUUID()}/anular`, { motivo: 1, comentario: 'xyz' }], ['post', `${P}/conciliar`, {}], ['post', `${P}/webhook/suscribir`, { url: 'https://a.test/x' }], ['get', `${P}/facturas/${randomUUID()}/pdf`]];
    for (const [m, ruta, cuerpo] of rutas) {
      const con = await t.api()[m](`/api/v1${ruta}`).set('Authorization', `Bearer ${e.d.token}`).set('X-Restaurant-Id', e.d.rid).send(cuerpo);
      expect(con.status, `${m} ${ruta} (dueño)`).toBe(403);
      const sin = await t.api()[m](`/api/v1${ruta}`).send(cuerpo);
      expect(sin.status, `${m} ${ruta} (sin sesión)`).toBe(401);
    }
  });

  it('el estado de la integración nunca devuelve secretos; la URL insegura se rechaza', async () => {
    const r = await kyros.get(`${P}/integracion`);
    expect(r.body).toMatchObject({ secretoConfigurado: true, lista: true }); expect(JSON.stringify(r.body)).not.toContain('secreto-de-prueba');
    expect((await kyros.put(`${P}/integracion`, { url: 'http://evil.example.com/api' })).status).toBe(400);
    expect((await kyros.put(`${P}/integracion`, { url: 'javascript:alert(1)' })).status).toBe(400);
    expect((await kyros.put(`${P}/integracion`, { clave: 'x' })).status).toBe(400);
  });

  it('con la integración apagada no sale nada hacia FacturaSIN y el pago se valida igual', async () => {
    await kyros.put(`${P}/integracion`, { activo: false });
    try {
      const e = await escenario(); const antes = fs.llamadas.length; const ap = await aprobar(e);
      expect(ap.hasta).toBeTruthy(); await new Promise((r) => setTimeout(r, 300));
      expect(fs.llamadas.length).toBe(antes); expect(await fila(e.pagoId)).toBeUndefined();
      expect((await kyros.post(`${P}/pagos/${e.pagoId}/emitir`, {})).body).toMatchObject({ ok: false, codigo: 'NO_CONFIGURADO' });
    } finally { await kyros.put(`${P}/integracion`, { activo: true }); }
  });

  it('datos fiscales del cliente: validación y auditoría', async () => {
    const e = await escenario({ nit: null });
    for (const n of ['0123456', '123', 'ABCDEFG']) expect((await e.dueno.put('/suscripcion/datos-fiscales', { tipo: 'NIT', numero: n, razonSocial: 'Casa SRL' })).status).toBe(400);
    expect((await e.dueno.put('/suscripcion/datos-fiscales', { tipo: 'NIT', numero: '1020304050', razonSocial: 'X' })).status).toBe(400);
    expect((await e.dueno.put('/suscripcion/datos-fiscales', { tipo: 'NIT', numero: '1020304050', razonSocial: 'Casa SRL', extra: 1 })).status).toBe(400);
    expect((await e.dueno.put('/suscripcion/datos-fiscales', { tipo: 'NIT', numero: '1.020.304-050', razonSocial: '  Casa   Andina  SRL ', correo: 'Fact@Casa.BO' })).status).toBe(200);
    expect((await e.dueno.get('/suscripcion/datos-fiscales')).body).toEqual({ tipo: 'NIT', numero: '1020304050', complemento: null, razonSocial: 'Casa Andina SRL', correo: 'fact@casa.bo' });
    // el cocinero/mesero no los toca (solo owner/admin): comprobado por el guard @DeSucursalSiempre(owner, admin)
    expect((await t.api().put('/api/v1/suscripcion/datos-fiscales').set('Authorization', 'Bearer x').send({})).status).toBe(401);
  });
});
