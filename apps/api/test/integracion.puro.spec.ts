import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { evaluarEntrega, huellaCoincide, huellaSecreto, mensajePruebaEntrega, vistaEntregas, asegurarWebhook, convencion, empresaExterna, mensajeIntegracion, normalizarEmpresa, pasosDeFacturaSin, RegistroUrlPublica, resumenPrueba, RUTA_WEBHOOK, urlPublica, urlWebhookDe, type PuertoEnlaceWebhook } from '../src/facturacion-kyros/nucleo/integracion';
import { ErrorEnlace, verificarFirmaWebhook } from '../src/facturacion-kyros/nucleo/enlace-facturasin';

const req = (h: Record<string, string>, protocol = 'http') => ({ headers: h, protocol });

describe('urlPublica', () => {
  it('usa X-Forwarded-Proto/Host', () => { expect(urlPublica(req({ 'x-forwarded-proto': 'https', 'x-forwarded-host': 'Hub.Kyros-Tech.com', host: 'api:3000' }))).toEqual({ ok: true, base: 'https://hub.kyros-tech.com', origen: 'x-forwarded' }); });
  it('usa Host si no hay forwarded', () => { expect(urlPublica(req({ host: 'hub.empresa.com' }, 'https'))).toMatchObject({ ok: true, base: 'https://hub.empresa.com', origen: 'host' }); });
  it('toma el primero de una lista', () => { expect(urlPublica(req({ 'x-forwarded-proto': 'https,http', 'x-forwarded-host': 'a.com, b.com' }))).toMatchObject({ ok: true, base: 'https://a.com' }); });
  it('rechaza http', () => { expect(urlPublica(req({ host: 'hub.empresa.com' }, 'http')).ok).toBe(false); });
  it.each(['localhost:5174', 'app.localhost', '10.0.0.5', '192.168.1.2', '172.16.0.1', '127.0.0.1', 'hub', 'servicio.internal', '[::1]:80'])('rechaza %s', (h) => { expect(urlPublica(req({ 'x-forwarded-proto': 'https', host: h })).ok).toBe(false); });
  it('rechaza host con caracteres raros', () => { expect(urlPublica(req({ 'x-forwarded-proto': 'https', host: 'a.com/@evil.com' })).ok).toBe(false); });
  it('en desarrollo acepta http y localhost', () => { expect(urlPublica(req({ host: 'localhost:5174' }), { desarrollo: true })).toMatchObject({ ok: true, base: 'http://localhost:5174' }); });
});

describe('RegistroUrlPublica', () => {
  it('acepta la primera', () => { const r = new RegistroUrlPublica(); expect(r.observar('https://a.com')).toEqual({ cambio: true, base: 'https://a.com' }); });
  it('un cambio suelto no desvía', () => { const r = new RegistroUrlPublica('https://a.com'); expect(r.observar('https://evil.com').cambio).toBe(false); expect(r.base).toBe('https://a.com'); });
  it('cambio por umbral o admin', () => {
    const r = new RegistroUrlPublica('https://a.com');
    r.observar('https://b.com'); r.observar('https://b.com'); expect(r.observar('https://b.com').cambio).toBe(true); expect(r.base).toBe('https://b.com');
    expect(r.observar('https://c.com', true).cambio).toBe(true);
  });
});

describe('convención y empresa (GL-040)', () => {
  it('no duplica el prefijo', () => {
    expect(normalizarEmpresa('glucora', 'glucora:kyros-tech')).toBe('kyros-tech');
    expect(normalizarEmpresa('glucora', 'glucora:glucora:kyros-tech')).toBe('kyros-tech');
    expect(normalizarEmpresa('glucora', ' Kyros-Tech ')).toBe('kyros-tech');
    expect(normalizarEmpresa('hub', '')).toBe('kyros-tech');
    expect(empresaExterna('hub', 'hub:kyros-tech')).toBe('hub:kyros-tech');
  });
  it('defaults', () => { expect(convencion('vet')).toMatchObject({ clientId: 'vet-service', empresaExterna: 'vet:kyros-tech', url: 'https://facturasin.kyros-tech.com/api', codigoProductoSin: '83141', actividadEconomica: '620100', unidadMedida: 58 }); });
});

/** Doble del núcleo de enlace de FacturaSIN: upsert por (sistema, empresa), secreto ÚNICO por sistema que solo se entrega la 1.ª vez o al rotar. */
function falso(urls: string[] = []) {
  let url: string | null = urls[0] ?? null; let secreto: string | null = urls.length ? 'ya-existente' : null; let n = 0; const llamadas: Array<{ url: string; rotar: boolean }> = [];
  const p: PuertoEnlaceWebhook = {
    asegurarWebhook: async (u, _t, o) => {
      llamadas.push({ url: u, rotar: !!o?.rotarSecreto });
      const estado = url === null ? 'creada' : url === u ? 'sin_cambios' : 'actualizada';
      url = u; let sec: string | null = null;
      if (secreto === null || o?.rotarSecreto) { secreto = `s${++n}`; sec = secreto; }
      return { suscripciones: [{ id: 'w1', tenantId: 'kyros-tech', url: u, estado }], secreto: sec };
    },
  };
  return { p, llamadas, get url() { return url; } };
}
describe('asegurarWebhook (sobre el núcleo de enlace)', () => {
  const url = urlWebhookDe('https://hub.kyros-tech.com');
  it('crea si no hay y devuelve el secreto', async () => { const f = falso(); const r = await asegurarWebhook(f.p, { url, secretoGuardado: false }); expect(r).toMatchObject({ accion: 'creado', secreto: 's1' }); expect(f.url).toBe(url); });
  it('idempotente: segunda vez no cambia ni pide secreto', async () => { const f = falso(); await asegurarWebhook(f.p, { url, secretoGuardado: false }); const r = await asegurarWebhook(f.p, { url, secretoGuardado: true }); expect(r.accion).toBe('sin_cambios'); expect(r.secreto).toBeUndefined(); });
  it('cambio de dominio: actualiza la misma suscripción (sin duplicar)', async () => { const f = falso([urlWebhookDe('https://viejo.com')]); const r = await asegurarWebhook(f.p, { url, secretoGuardado: true }); expect(r.accion).toBe('actualizado'); expect(f.url).toBe(url); });
  it('si ya existía y no hay secreto local, lo renueva (migración)', async () => { const f = falso([url]); const r = await asegurarWebhook(f.p, { url, secretoGuardado: false }); expect(r).toMatchObject({ accion: 'secreto_renovado', secreto: 's1' }); expect(f.llamadas.at(-1)!.rotar).toBe(true); });
  it('la ruta es la estándar de FacturaSIN', () => { expect(url.endsWith(RUTA_WEBHOOK)).toBe(true); expect(RUTA_WEBHOOK).toBe('/api/v1/webhooks/facturasin'); });
});

describe('firma del webhook (una sola verificación: la del núcleo de enlace)', () => {
  const cuerpo = '{"a":1}'; const sec = 'x'.repeat(40); const ts = 1_700_000_000;
  const firma = (s: string) => `t=${ts},v1=${createHmac('sha256', s).update(`${ts}.${cuerpo}`).digest('hex')}`;
  it('acepta la buena, rechaza cuerpo alterado, secreto ajeno y firma vieja', () => {
    expect(verificarFirmaWebhook(sec, firma(sec), cuerpo, ts * 1000)).toBe(true);
    expect(verificarFirmaWebhook(sec, firma(sec), cuerpo + ' ', ts * 1000)).toBe(false);
    expect(verificarFirmaWebhook(sec, firma('otro'), cuerpo, ts * 1000)).toBe(false);
    expect(verificarFirmaWebhook(sec, firma(sec), cuerpo, (ts + 3600) * 1000)).toBe(false);
  });
});

describe('mensajes', () => {
  it('nunca HTTP crudo ni pide Keycloak', () => {
    for (const e of [{ codigo: 'EMPRESA_NO_ENCONTRADA', estado: 400 }, { estado: 401 }, { estado: 0, message: 'fetch failed' }, { estado: 422 }, { codigo: 'X', estado: 418 }, new ErrorEnlace(409, 'REQUIERE_ELEGIR_RUBRO', 'x'), new ErrorEnlace(409, 'NIT_EN_USO', 'x'), new ErrorEnlace(0, 'SIN_ARRANQUE', 'x')]) {
      const m = mensajeIntegracion(e).mensaje; expect(m).not.toMatch(/HTTP \d/); expect(m).not.toMatch(/ve a Keycloak|entra a Keycloak/i); expect(m.length).toBeGreaterThan(30);
    }
  });
  it('resumen de prueba y pasos de FacturaSIN (solo «error» bloquea)', () => {
    expect(resumenPrueba([{ clave: 'a', ok: true, detalle: '' }]).listo).toBe(true);
    expect(resumenPrueba([{ clave: 'a', ok: false, detalle: 'x' }]).resumen).toBe('Falta: x');
    const p = pasosDeFacturaSin([{ id: 'rubro', titulo: 'Rubro', estado: 'aviso', detalle: 'd' }, { id: 'catalogo', titulo: 'Catálogo', estado: 'error', detalle: 'e' }, { id: 'f', titulo: 'F', estado: 'omitido', detalle: '' }]);
    expect(p.map((x) => x.ok)).toEqual([true, false, true]);
  });
});

const firmar = (secreto: string, cuerpo: string, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${createHmac('sha256', secreto).update(`${t}.${cuerpo}`).digest('hex')}`;

describe('entregas del aviso (v2.1.0)', () => {
  it('huella del secreto: 8 hex y coincidencia', () => {
    expect(huellaSecreto('abc')).toMatch(/^[0-9a-f]{8}$/);
    expect(huellaCoincide(huellaSecreto('abc'), 'abc')).toBe(true);
    expect(huellaCoincide(huellaSecreto('abc'), 'otro')).toBe(false);
    expect(huellaCoincide(null, 'abc')).toBe(false);
    expect(huellaCoincide(huellaSecreto('abc'), null)).toBe(false);
  });
  it('vistaEntregas: 5 ultimas y si el sistema la registro', () => {
    const e = (i: number) => ({ id: `d${i}`, eventoId: `ev${i}`, tipo: 'factura.validada', estado: 'entregada', intentos: 1, ultimoIntentoEn: null, ultimoCodigoHttp: 200, ultimoError: null, facturaId: `f${i}`, numero: i, estadoFactura: 'validada', idExterno: null });
    const v = vistaEntregas([1, 2, 3, 4, 5, 6, 7].map(e), new Set(['ev2']));
    expect(v).toHaveLength(5);
    expect(v[1]!.registradaPorElSistema).toBe(true);
    expect(v[0]!.registradaPorElSistema).toBe(false);
    expect(v[0]).toMatchObject({ http: 200, facturaId: 'f1', estadoFactura: 'validada' });
  });
  it('mensajes de la prueba de entrega en lenguaje simple', () => {
    expect(mensajePruebaEntrega([]).ok).toBe(false);
    expect(mensajePruebaEntrega([{ ok: true, codigoHttp: 200, secretoHuella: huellaSecreto('s') }], 's')).toMatchObject({ ok: true });
    expect(mensajePruebaEntrega([{ ok: true, codigoHttp: 200, secretoHuella: huellaSecreto('s') }], 'otro').ok).toBe(false);
    expect(mensajePruebaEntrega([{ ok: false, codigoHttp: 401 }]).mensaje).toMatch(/firma/);
    expect(mensajePruebaEntrega([{ ok: false, codigoHttp: 404 }]).mensaje).toMatch(/ruta/);
    expect(mensajePruebaEntrega([{ ok: false, codigoHttp: 503 }]).mensaje).toMatch(/error interno/);
    expect(mensajePruebaEntrega([{ ok: false, codigoHttp: null, error: 'ECONNREFUSED' }]).mensaje).toMatch(/llegar/);
    for (const r of [401, 404, 500, null]) expect(mensajePruebaEntrega([{ ok: false, codigoHttp: r }]).mensaje).not.toMatch(/Keycloak|variable/i);
  });
  it('contrato: un evento factura.validada firmado con el secreto del sistema se acepta; con otro secreto, alterado o viejo se rechaza', () => {
    const secreto = 'a'.repeat(64);
    const cuerpo = JSON.stringify({ id: 'ev1', tipo: 'factura.validada', empresaId: 'e', creadoEn: new Date().toISOString(), datos: { facturaId: 'f1', estado: 'validada', idExterno: 'x:1', numero: 7, cuf: 'C', factura: { desglose: { neto: 1, iva: 0.13, total: 1.13 } } } });
    const ok = evaluarEntrega([secreto], firmar(secreto, cuerpo), cuerpo);
    expect(ok).toMatchObject({ http: 200, resultado: 'ok' });
    expect(ok.evento).toMatchObject({ id: 'ev1', tipo: 'factura.validada' });
    expect(evaluarEntrega(['b'.repeat(64)], firmar(secreto, cuerpo), cuerpo)).toMatchObject({ http: 401, resultado: 'firma_invalida' });
    expect(evaluarEntrega([secreto], firmar(secreto, cuerpo), cuerpo + ' ')).toMatchObject({ http: 401 });
    expect(evaluarEntrega([secreto], firmar(secreto, cuerpo, Math.floor(Date.now() / 1000) - 3600), cuerpo)).toMatchObject({ http: 401 });
    expect(evaluarEntrega([], firmar(secreto, cuerpo), cuerpo)).toMatchObject({ http: 401 });
    const sinTipo = JSON.stringify({ id: 'ev2', datos: {} });
    expect(evaluarEntrega([secreto], firmar(secreto, sinTipo), sinTipo)).toMatchObject({ http: 400, resultado: 'cuerpo_invalido' });
  });
});
