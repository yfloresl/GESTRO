import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analizadorAviso, esAviso, LIMITE_AVISO } from '../src/facturacion-kyros/aviso-cuerpo';
import { verificarFirmaWebhook } from '../src/facturacion-kyros/nucleo/enlace-facturasin';

const SECRETO = 'c'.repeat(64);
const firmar = (cuerpo: string, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${createHmac('sha256', SECRETO).update(`${t}.${cuerpo}`).digest('hex')}`;
const aviso = (kb: number) => JSON.stringify({ id: 'ev-1', tipo: 'factura.validada', datos: { facturaId: 'f1', estado: 'validada', factura: { items: [{ descripcion: 'Suscripción — Ñandú «plan» ✓' }] }, xml: '<f>' + 'x'.repeat(kb * 1024) + '</f>' } });

let srv: Server; let url = '';
beforeAll(async () => {
  // Mismo analizador que usa cada sistema en su ruta del aviso; el «endpoint» solo verifica la firma sobre el cuerpo CRUDO.
  srv = createServer((req, res) => {
    analizadorAviso(req as never, res as never, (err?: unknown) => {
      if (err) { res.statusCode = (err as { status?: number }).status ?? 500; res.end(); return; }
      const raw = (req as unknown as { rawBody?: Buffer }).rawBody;
      const ok = !!raw && verificarFirmaWebhook(SECRETO, String(req.headers['x-facturasin-signature'] ?? ''), raw.toString('utf8'));
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ bytes: raw?.length ?? 0, firmaValida: ok, tipo: (req as unknown as { body?: { tipo?: string } }).body?.tipo }));
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/`;
});
afterAll(() => new Promise<void>((r) => srv.close(() => r())));

const enviar = (cuerpo: string) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-facturasin-signature': firmar(cuerpo) }, body: cuerpo });

describe('ruta del aviso: hasta 2 MB con cuerpo crudo para la firma', () => {
  it('solo la ruta del aviso (POST /api/v1/webhooks/facturasin) usa el límite ampliado', () => {
    expect(LIMITE_AVISO).toBe('2mb');
    expect(esAviso('POST', '/api/v1/webhooks/facturasin')).toBe(true);
    expect(esAviso('POST', '/api/v1/webhooks/facturasin/')).toBe(true);
    expect(esAviso('GET', '/api/v1/webhooks/facturasin')).toBe(false);
    expect(esAviso('POST', '/api/v1/webhooks/facturasin/kyros')).toBe(false);
    expect(esAviso('POST', '/api/v1/auth/entrar')).toBe(false);
  });
  it('acepta un aviso firmado de ~300 kB (más que los 100 kB por defecto) y la firma vale sobre el cuerpo crudo', async () => {
    const cuerpo = aviso(300);
    expect(Buffer.byteLength(cuerpo)).toBeGreaterThan(300 * 1024);
    const r = await enviar(cuerpo);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ firmaValida: true, tipo: 'factura.validada', bytes: Buffer.byteLength(cuerpo) });
  });
  it('acepta uno de ~1,5 MB (cerca del tope)', async () => { expect((await enviar(aviso(1500))).status).toBe(200); });
  it('rechaza con 413 un cuerpo mayor de 2 MB', async () => { expect((await enviar(aviso(2200))).status).toBe(413); });
});
