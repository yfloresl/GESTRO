import { randomUUID } from 'node:crypto';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Doble FIEL de FacturaSIN (contrato de `docs/integracion-sistemas.md`, commit 201c759): mismas rutas, cabeceras, errores `{codigo, mensaje, detalle}`,
 * idempotencia por `Idempotency-Key` + huella del cuerpo, `X-Empresa-Externa`, estados y totales con aritmética exacta (BigInt, mitad hacia arriba;
 * IVA 13 % del importe, como `ivaIncluidoCentavos`). Escrito de forma independiente al código de GESTRO para que el contraste sea real.
 */
interface Empresa { id: string; nit: string; razonSocial: string; modoSiat: 'simulado'; nitDePrueba: boolean; enlaces: { sistema: string; idExterno: string }[]; credencial: boolean }
interface FacturaDoble { id: string; numero: number; cuf: string; estado: string; idExterno: string; clave: string; huella: string; body: Record<string, any>; totales: { montoTotal: number; ivaReferencial: number }; empresaId: string }

const half = (a: bigint, b: bigint) => (2n * a + b) / (2n * b);
function cent(n: number): bigint { const s = String(n); const [e, d = ''] = s.split('.'); return d.length <= 2 ? BigInt(e + d) * 10n ** BigInt(2 - d.length) : half(BigInt(e + d), 10n ** BigInt(d.length - 2)); }
function linea(c: number, p: number): bigint { const q = String(c).split('.'); const w = String(p).split('.'); const e = (q[1]?.length ?? 0) + (w[1]?.length ?? 0); const m = BigInt(q.join('')) * BigInt(w.join('')); return e <= 2 ? m * 10n ** BigInt(2 - e) : half(m, 10n ** BigInt(e - 2)); }
export const num = (c: bigint) => Number(c) / 100;

export async function levantarDoble(secretoClient: string) {
  const empresas: Empresa[] = []; const facturas: FacturaDoble[] = []; const webhooks: { url: string; secreto: string; empresaId: string }[] = [];
  const log: { metodo: string; ruta: string; cab: Record<string, string | string[] | undefined>; cuerpo: string }[] = [];
  const estado = { caido: false, permitirCredenciales: true, estadoInicial: 'validada' as 'validada' | 'pendiente', sinConexionSoloEmisiones: false, token: 'tok-1', tokensEmitidos: 0, intentosCaidos: 0 };
  let numero = 0;

  const json = (res: ServerResponse, st: number, o: unknown) => { res.statusCode = st; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
  const err = (res: ServerResponse, st: number, codigo: string, mensaje: string, detalle?: unknown) => json(res, st, { codigo, mensaje, ...(detalle !== undefined ? { detalle } : {}) });
  const vista = (f: FacturaDoble) => ({
    id: f.id, numero: f.numero, cuf: f.cuf, estado: f.estado, idExterno: f.idExterno, fechaEmision: new Date().toISOString(), totales: { subtotal: f.totales.montoTotal, montoTotal: f.totales.montoTotal, ivaReferencial: f.totales.ivaReferencial, tipoCambio: 1 },
    modoSiat: 'simulado', ambientePruebas: true, avisoFiscal: 'Ambiente de pruebas / sin validez fiscal · NIT de prueba, sin validez fiscal',
    enlaces: { detalle: `/api/v1/invoices/${f.id}`, pdf: `/api/v1/invoices/${f.id}/pdf`, pdfRollo: `/api/v1/invoices/${f.id}/pdf?formato=rollo`, xml: `/api/v1/invoices/${f.id}/xml`, qr: `/api/v1/invoices/${f.id}/qr` },
    qrTexto: `https://pilotosiat.impuestos.gob.bo/consulta/QR?nit=0&cuf=${f.cuf}&numero=${f.numero}&t=2`,
  });

  const srv: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const trozos: Buffer[] = [];
    req.on('data', (c) => trozos.push(c));
    req.on('end', () => {
      const cuerpoTxt = Buffer.concat(trozos).toString('utf8'); const url = new URL(req.url ?? '/', 'http://x'); const ruta = url.pathname; const m = req.method ?? 'GET';
      log.push({ metodo: m, ruta, cab: { ...req.headers, authorization: req.headers.authorization ? '***' : undefined }, cuerpo: ruta.includes('openid-connect/token') ? '***' : cuerpoTxt });
      // ---- Kyros ID falso
      if (ruta.endsWith('/protocol/openid-connect/token')) {
        const p = new URLSearchParams(cuerpoTxt);
        if (p.get('grant_type') !== 'client_credentials' || p.get('client_id') !== 'gestro-service' || p.get('client_secret') !== secretoClient) return json(res, 401, { error: 'unauthorized_client' });
        estado.tokensEmitidos++; return json(res, 200, { access_token: estado.token, expires_in: 300 });
      }
      if (!ruta.startsWith('/api/v1/')) return json(res, 404, {});
      if (ruta === '/api/v1/health') return json(res, 200, { ok: true });
      if (req.headers.authorization !== `Bearer ${estado.token}`) return err(res, 401, 'NO_AUTENTICADO', 'Token vencido o no válido');
      if (estado.caido) { estado.intentosCaidos++; return err(res, 503, 'SIAT_NO_DISPONIBLE', 'El SIN no responde'); }
      const r = ruta.slice('/api/v1'.length); let body: any = {};
      if (cuerpoTxt) { try { body = JSON.parse(cuerpoTxt); } catch { return err(res, 400, 'VALIDACION', 'JSON inválido'); } }
      const ext = req.headers['x-empresa-externa'] as string | undefined;
      const empresaDe = (): Empresa | null => { if (!ext) return null; const [s, ...i] = ext.split(':'); return empresas.find((e) => e.enlaces.some((l) => l.sistema === s && l.idExterno === i.join(':'))) ?? null; };

      if (r === '/tenants' && m === 'GET') return json(res, 200, empresas.filter((e) => e.enlaces.some((l) => l.sistema === 'gestro')));
      if (r === '/tenants' && m === 'POST') {
        if (!/^\d{5,13}$/.test(body.nit ?? '')) return err(res, 422, 'VALIDACION', 'NIT inválido');
        if (!body.municipio) return err(res, 422, 'VALIDACION', 'El municipio es obligatorio');
        if (empresas.some((e) => e.nit === body.nit)) return err(res, 409, 'VALIDACION', 'Ya existe una empresa con ese NIT');
        const e: Empresa = { id: randomUUID(), nit: body.nit, razonSocial: body.razonSocial, modoSiat: 'simulado', nitDePrueba: body.nit.startsWith('1000000'), enlaces: body.idsExternos.map((x: any) => ({ sistema: x.sistema, idExterno: x.id })), credencial: false };
        empresas.push(e); return json(res, 201, e);
      }
      let mt = /^\/tenants\/([^/]+)\/(systems|branches|pos|credentials)$/.exec(r);
      if (mt) {
        const e = empresas.find((x) => x.id === mt![1]); if (!e) return err(res, 404, 'EMPRESA_NO_ENCONTRADA', 'Empresa no encontrada');
        if (mt[2] === 'systems' && m === 'GET') return json(res, 200, e.enlaces);
        if (mt[2] === 'systems' && m === 'POST') { if (!e.enlaces.some((l) => l.sistema === body.sistema && l.idExterno === body.id)) e.enlaces.push({ sistema: body.sistema, idExterno: body.id }); return json(res, 201, { sistema: body.sistema, id: body.id }); }
        if (mt[2] === 'branches') return json(res, 200, [{ codigo: 0, nombre: 'Casa Matriz' }]);
        if (mt[2] === 'pos') return json(res, 200, [{ sucursal: 0, codigo: 0, nombre: 'Punto de Venta 0' }]);
        if (mt[2] === 'credentials') { if (!estado.permitirCredenciales) return err(res, 403, 'SIN_PERMISO', 'Falta el permiso credenciales'); e.credencial = true; return json(res, 200, { tokenRegistrado: true }); }
      }
      if (r === '/webhooks' && m === 'POST') {
        const e = empresaDe(); if (!e) return err(res, 404, 'EMPRESA_NO_ENCONTRADA', 'Empresa no encontrada');
        if (!/^https:\/\//.test(body.url)) return err(res, 422, 'VALIDACION', 'URL de webhook no permitida: debe ser https');
        const w = { url: body.url, secreto: randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, ''), empresaId: e.id }; webhooks.push(w); return json(res, 201, { id: randomUUID(), secreto: w.secreto });
      }
      if (r === '/invoices' && m === 'POST') {
        const e = empresaDe(); if (!e) return err(res, 404, 'EMPRESA_NO_ENCONTRADA', 'Empresa no encontrada');
        const clave = req.headers['idempotency-key'] as string | undefined; if (!clave) return err(res, 400, 'IDEMPOTENCIA_REQUERIDA', 'Envía el encabezado Idempotency-Key');
        const huella = JSON.stringify(body);
        const previa = facturas.find((f) => f.empresaId === e.id && f.clave === clave);
        if (previa) return previa.huella === huella ? json(res, 201, vista(previa)) : err(res, 409, 'IDEMPOTENCIA_CONFLICTO', 'Esa Idempotency-Key ya se usó con otro contenido');
        const mismo = facturas.find((f) => f.empresaId === e.id && f.idExterno === body.idExterno && f.estado !== 'rechazada'); if (mismo) return json(res, 201, vista(mismo));
        if (!Array.isArray(body.items) || !body.items.length) return err(res, 422, 'VALIDACION', 'Debe haber al menos un ítem');
        for (const i of body.items) { if (!(i.cantidad > 0) || i.precioUnitario < 0) return err(res, 422, 'VALIDACION', 'Cantidad o precio inválido'); if (!i.codigoProductoSin || !i.actividadEconomica) return err(res, 422, 'VALIDACION', `El producto "${i.codigoProducto}" no está homologado`); }
        if (body.metodoPago === 2 && !body.numeroTarjeta) return err(res, 422, 'VALIDACION', 'El método de pago tarjeta requiere numeroTarjeta');
        const c = body.comprador; if (c.tipoDocumento === 5 && c.codigoExcepcion === 0 && String(c.numeroDocumento).startsWith('9')) return err(res, 422, 'VALIDACION', 'NIT del comprador inválido (el SIN no lo conoce). Si corresponde, reintenta con codigoExcepcion=1');
        let suma = 0n; for (const i of body.items) suma += linea(i.cantidad, i.precioUnitario - 0) - cent(i.descuento ?? 0);
        const total = suma - cent(body.descuentoAdicional ?? 0); if (total <= 0n) return err(res, 422, 'VALIDACION', 'El total debe ser mayor que cero');
        const iva = half(total * 13n, 100n);
        if (String(c.razonSocial).includes('RECHAZAR')) return err(res, 422, 'SIAT_RECHAZO', 'El SIN rechazó la factura', { mensajes: ['Código 1037: razón social no válida'], factura: { estado: 'rechazada' } });
        const f: FacturaDoble = { id: randomUUID(), numero: ++numero, cuf: randomUUID().replace(/-/g, '').toUpperCase(), estado: estado.estadoInicial, idExterno: body.idExterno, clave, huella, body, totales: { montoTotal: num(total), ivaReferencial: num(iva) }, empresaId: e.id };
        facturas.push(f); return json(res, 201, vista(f));
      }
      mt = /^\/invoices\/by-external\/gestro\/(.+)$/.exec(r);
      if (mt && m === 'GET') { const id = decodeURIComponent(mt[1]!); const f = facturas.find((x) => x.idExterno === id || x.idExterno === `gestro:${id}`); return f ? json(res, 200, vista(f)) : err(res, 404, 'FACTURA_NO_ENCONTRADA', 'No existe'); }
      mt = /^\/invoices\/([^/]+)\/(void|pdf|xml)$/.exec(r);
      if (mt) {
        const f = facturas.find((x) => x.id === mt![1]); if (!f) return err(res, 404, 'FACTURA_NO_ENCONTRADA', 'No existe');
        if (mt[2] === 'void') { if (f.estado !== 'validada') return err(res, 409, 'FACTURA_ESTADO_INVALIDO', 'Solo se anula una factura validada'); f.estado = 'anulada'; return json(res, 200, vista(f)); }
        if (mt[2] === 'pdf') { res.setHeader('content-type', 'application/pdf'); res.statusCode = 200; return void res.end(Buffer.from(`%PDF-1.4 doble ${f.cuf}`)); }
        res.setHeader('content-type', 'application/xml'); res.statusCode = 200; return void res.end(`<facturaElectronicaCompraVenta><cuf>${f.cuf}</cuf></facturaElectronicaCompraVenta>`);
      }
      return err(res, 404, 'NO_ENCONTRADO', `Ruta no existe: ${m} ${r}`);
    });
  });
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
  const puerto = (srv.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${puerto}`;
  return { base, api: `${base}/api`, emisor: `${base}/realms/kyros`, empresas, facturas, webhooks, log, estado, cerrar: () => new Promise<void>((ok) => srv.close(() => ok())), semilla: (nit: string, rid: string) => { empresas.push({ id: randomUUID(), nit, razonSocial: 'Sembrada', modoSiat: 'simulado', nitDePrueba: true, enlaces: [{ sistema: 'gestro', idExterno: rid }], credencial: false }); } };
}
