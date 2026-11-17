import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Cuerpo del aviso de FacturaSIN (`POST <prefijo>/v1/webhooks/facturasin`): lleva la factura COMPLETA (ítems, desglose, XML, enlaces), así que puede superar con mucho los 100 kB
 * que admiten por defecto los servidores Express/Nest. Un 413 haría que FacturaSIN reintente en vano y el sistema perdiera el estado final de la factura.
 * Esta ruta —y SOLO esta— acepta hasta 2 MB y conserva el cuerpo CRUDO (`req.rawBody`) para verificar la firma HMAC; un cuerpo mayor se rechaza con 413.
 * Mismo contrato que `aviso-cuerpo.ts` de Hub/Vet/AXION/Glucora (LIMITE_AVISO, RUTA_AVISO, esAviso, analizadorAviso); la ÚNICA diferencia por sistema es `RUTA_AVISO`
 * (el prefijo global de la API) y que aquí el lector es propio (sin dependencia nueva ni cambio de lockfile).
 */
export const LIMITE_AVISO = '2mb';
const LIMITE_BYTES = 2 * 1024 * 1024;
/** Ruta del aviso en ESTE sistema: prefijo global `api/v1` + `webhooks/facturasin`. */
export const RUTA_AVISO = new RegExp('^/api/v1/webhooks/facturasin/?$');
export const esAviso = (metodo: string, ruta: string): boolean => metodo === 'POST' && RUTA_AVISO.test(ruta);

type ConCuerpo = IncomingMessage & { rawBody?: Buffer; body?: unknown; _body?: boolean };
const errorHttp = (status: number, msg: string): Error => Object.assign(new Error(msg), { status, statusCode: status, expose: true });

export const analizadorAviso = (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void): void => {
  const r = req as ConCuerpo;
  if (r._body) return next();
  const declarado = Number(r.headers['content-length']);
  if (Number.isFinite(declarado) && declarado > LIMITE_BYTES) { req.resume(); return next(errorHttp(413, 'El aviso supera 2 MB')); }
  const trozos: Buffer[] = []; let total = 0; let cerrado = false;
  const cerrar = (err?: unknown) => { if (cerrado) return; cerrado = true; if (err) req.resume(); next(err); };
  req.on('data', (c: Buffer) => {
    if (cerrado) return;
    total += c.length;
    if (total > LIMITE_BYTES) return cerrar(errorHttp(413, 'El aviso supera 2 MB'));
    trozos.push(c);
  });
  req.on('end', () => {
    if (cerrado) return;
    const crudo = Buffer.concat(trozos);
    r.rawBody = crudo; r._body = true;
    try { r.body = crudo.length ? JSON.parse(crudo.toString('utf8')) : {}; } catch { return cerrar(errorHttp(400, 'Cuerpo JSON no válido')); }
    cerrar();
  });
  req.on('error', (e) => cerrar(e));
  void res;
};
