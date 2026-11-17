import { createHash, createHmac, randomUUID } from 'node:crypto';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Doble fiel de FacturaSIN (contrato de docs/integracion-sistemas.md, Fase 1) y de Kyros ID (client_credentials).
 * Reproduce: Bearer obligatorio, Idempotency-Key obligatoria (misma clave + mismo cuerpo = misma factura; otro cuerpo = 409),
 * idExterno repetido con otra clave = factura viva, 422 VALIDACION, 422 SIAT_RECHAZO (libera el idExterno), 503 SIAT_NO_DISPONIBLE,
 * IVA referencial = 13 % del total mitad hacia arriba, ambientePruebas, anulación solo de `validada`, PDF/XML/QR y webhooks firmados.
 */
interface Fact { id: string; numero: number; cuf: string; estado: string; idExterno: string; clave: string; huella: string; cuerpo: any; empresa: string; fechaEmision: string; motivoAnulacion?: number }

export async function levantarFacturaSin() {
  const facturas: Fact[] = [];
  const llamadas: Array<{ metodo: string; ruta: string; empresa: string | null; clave: string | null; auth: string | null }> = [];
  const modo = { caido: false, rechazar: false, estadoNuevo: 'validada' as 'validada' | 'pendiente', sinToken: false };
  const webhooks: Array<{ id: string; url: string; secreto: string }> = [];
  let numero = 0;

  const json = (res: ServerResponse, st: number, o: unknown) => { res.statusCode = st; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
  const err = (res: ServerResponse, st: number, codigo: string, mensaje: string, detalle?: unknown) => json(res, st, { codigo, mensaje, detalle });
  const iva = (totalCent: bigint) => (totalCent * 1300n + 5000n) / 10000n;
  const vista = (f: Fact) => {
    const total = f.cuerpo.items.reduce((a: bigint, i: any) => a + BigInt(Math.round(i.cantidad * i.precioUnitario * 100)) - BigInt(Math.round((i.descuento ?? 0) * 100)), 0n);
    const base = `/api/v1/invoices/${f.id}`;
    return {
      id: f.id, numero: f.numero, cuf: f.cuf, estado: f.estado, idExterno: f.idExterno, fechaEmision: f.fechaEmision, motivoAnulacion: f.motivoAnulacion ?? null,
      totales: { subtotal: Number(total) / 100, montoTotal: Number(total) / 100, ivaReferencial: Number(iva(total)) / 100, tipoCambio: 1, montoTotalMoneda: Number(total) / 100 },
      modoSiat: 'simulado', ambientePruebas: true, avisoFiscal: 'Ambiente de pruebas / sin validez fiscal · NIT de prueba, sin validez fiscal',
      enlaces: { detalle: base, pdf: `${base}/pdf`, pdfRollo: `${base}/pdf?formato=rollo`, xml: `${base}/xml`, qr: `${base}/qr` },
      qrTexto: `https://pilotosiat.impuestos.gob.bo/consulta/QR?nit=1000000001&cuf=${f.cuf}&numero=${f.numero}&t=2`,
    };
  };
  const leer = (req: IncomingMessage) => new Promise<string>((ok) => { const c: Buffer[] = []; req.on('data', (d) => c.push(d)); req.on('end', () => ok(Buffer.concat(c).toString('utf8'))); });

  const srv: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x'); const ruta = url.pathname; const crudo = await leer(req);
    const empresa = (req.headers['x-empresa-externa'] as string) ?? null; const clave = (req.headers['idempotency-key'] as string) ?? null; const auth = (req.headers.authorization as string) ?? null;
    if (ruta.endsWith('/protocol/openid-connect/token')) {
      const p = new URLSearchParams(crudo);
      if (modo.sinToken || p.get('grant_type') !== 'client_credentials' || !p.get('client_secret')) return err(res, 401, 'invalid_client', 'Credenciales inválidas');
      return json(res, 200, { access_token: `doble.${p.get('client_id')}.${randomUUID()}`, expires_in: 300 });
    }
    llamadas.push({ metodo: req.method ?? '', ruta, empresa, clave, auth });
    if (!auth?.startsWith('Bearer doble.')) return err(res, 401, 'NO_AUTENTICADO', 'Token requerido');
    if (ruta.startsWith('/api/v1/integraciones')) return err(res, 404, 'NO_ENCONTRADO', 'El enlace automatico aun no esta publicado'); // el sistema cae al adaptador de compatibilidad
    if (empresa !== 'gestro:kyros-tech' && !ruta.startsWith('/api/v1/webhooks')) return err(res, 403, 'SIN_PERMISO', 'Empresa no enlazada a este sistema');
    if (modo.caido && req.method === 'POST' && ruta === '/api/v1/invoices') return err(res, 503, 'SIAT_NO_DISPONIBLE', 'El SIN no responde');

    if (req.method === 'POST' && ruta === '/api/v1/invoices') {
      if (!clave) return err(res, 400, 'IDEMPOTENCIA_REQUERIDA', 'Falta Idempotency-Key');
      let cuerpo: any; try { cuerpo = JSON.parse(crudo); } catch { return err(res, 422, 'VALIDACION', 'JSON inválido'); }
      const huella = createHash('sha256').update(crudo).digest('hex');
      const previa = facturas.find((f) => f.clave === clave);
      if (previa) return previa.huella === huella ? json(res, 201, vista(previa)) : err(res, 409, 'IDEMPOTENCIA_CONFLICTO', 'La clave ya se usó con otro contenido');
      const viva = facturas.find((f) => f.idExterno === cuerpo.idExterno && f.estado !== 'rechazada');
      if (viva) return json(res, 201, vista(viva));
      if (!Array.isArray(cuerpo.items) || !cuerpo.items.length || cuerpo.items.some((i: any) => !(i.cantidad > 0) || !(i.precioUnitario > 0))) return err(res, 422, 'VALIDACION', 'Ítems inválidos');
      if (cuerpo.comprador?.tipoDocumento === 5 && !/^[1-9]\d{4,12}$/.test(cuerpo.comprador.numeroDocumento) && cuerpo.comprador.codigoExcepcion !== 1) return err(res, 422, 'VALIDACION', 'NIT del comprador inexistente');
      const f: Fact = { id: randomUUID(), numero: 0, cuf: randomUUID().replace(/-/g, '').toUpperCase(), estado: modo.rechazar ? 'rechazada' : modo.estadoNuevo, idExterno: cuerpo.idExterno, clave, huella, cuerpo, empresa: empresa!, fechaEmision: new Date().toISOString() };
      if (!modo.rechazar) f.numero = ++numero;
      facturas.push(f);
      if (modo.rechazar) return err(res, 422, 'SIAT_RECHAZO', 'El SIN rechazó la factura (simulado)', { factura: vista(f), mensajes: ['Error de cálculo simulado'] });
      return json(res, 201, vista(f));
    }
    const porExterno = /^\/api\/v1\/invoices\/by-external\/gestro\/(.+)$/.exec(ruta);
    if (req.method === 'GET' && porExterno) { const f = facturas.find((x) => x.idExterno === decodeURIComponent(porExterno[1]!) && x.estado !== 'rechazada'); return f ? json(res, 200, vista(f)) : err(res, 404, 'FACTURA_NO_ENCONTRADA', 'No existe'); }
    const m = /^\/api\/v1\/invoices\/([0-9a-f-]{36})(?:\/(pdf|xml|qr|void))?$/.exec(ruta);
    if (m) {
      const f = facturas.find((x) => x.id === m[1]); if (!f) return err(res, 404, 'FACTURA_NO_ENCONTRADA', 'No existe');
      if (req.method === 'GET' && !m[2]) return json(res, 200, vista(f));
      if (req.method === 'GET' && m[2] === 'pdf') { res.setHeader('content-type', 'application/pdf'); return void res.end(Buffer.from(`%PDF-1.4 doble ${f.numero} AMBIENTE DE PRUEBAS`)); }
      if (req.method === 'GET' && m[2] === 'xml') { res.setHeader('content-type', 'application/xml'); return void res.end(`<facturaElectronica><numero>${f.numero}</numero></facturaElectronica>`); }
      if (req.method === 'GET' && m[2] === 'qr') { res.setHeader('content-type', 'image/png'); return void res.end(Buffer.from('89504e470d0a1a0a', 'hex')); }
      if (req.method === 'POST' && m[2] === 'void') {
        const d = JSON.parse(crudo || '{}');
        if (f.estado !== 'validada') return err(res, 409, 'FACTURA_ESTADO_INVALIDO', 'Solo se anula una factura validada');
        if (![1, 2, 3, 4].includes(d.motivo)) return err(res, 422, 'VALIDACION', 'Motivo inválido');
        f.estado = 'anulada'; f.motivoAnulacion = d.motivo; return json(res, 200, vista(f));
      }
    }
    if (req.method === 'GET' && ruta === '/api/v1/webhooks') return json(res, 200, webhooks.map((w) => ({ id: w.id, url: w.url, activo: true })));
    if (req.method === 'DELETE' && ruta.startsWith('/api/v1/webhooks/')) { const i = webhooks.findIndex((w) => w.id === ruta.split('/').pop()); if (i >= 0) webhooks.splice(i, 1); return json(res, 200, { deshabilitado: true }); }
    if (req.method === 'POST' && ruta === '/api/v1/webhooks') { const w = { id: randomUUID(), url: JSON.parse(crudo).url as string, secreto: createHash('sha256').update(randomUUID()).digest('hex') }; webhooks.push(w); return json(res, 201, { id: w.id, secreto: w.secreto }); }
    err(res, 404, 'NO_ENCONTRADO', `${req.method} ${ruta}`);
  });
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;

  /** Entrega un evento firmado como lo haría FacturaSIN (X-FacturaSIN-Signature = t=<epoch>,v1=<HMAC(secreto, "t.cuerpo")>). */
  async function enviarEvento(destino: string, secreto: string, tipo: string, f: Fact, extra: { t?: number; id?: string; cuerpo?: string } = {}) {
    const cuerpo = extra.cuerpo ?? JSON.stringify({ id: extra.id ?? randomUUID(), tipo, empresaId: 'e1', creadoEn: new Date().toISOString(), datos: { facturaId: f.id, cuf: f.cuf, numero: f.numero, estado: tipo.replace('factura.', ''), idExterno: f.idExterno, ambientePruebas: true } });
    const t = extra.t ?? Math.floor(Date.now() / 1000);
    const evId = (JSON.parse(cuerpo).id as string) ?? randomUUID();
    const firma = `t=${t},v1=${createHmac('sha256', secreto).update(`${t}.${cuerpo}`).digest('hex')}`;
    return fetch(destino, { method: 'POST', headers: { 'content-type': 'application/json', 'x-facturasin-signature': firma, 'x-facturasin-event-id': evId }, body: cuerpo });
  }
  return { base, facturas, llamadas, modo, webhooks, enviarEvento, cerrar: () => new Promise<void>((ok) => srv.close(() => ok())), issuer: `${base}/realms/kyros`, apiUrl: `${base}/api` };
}
