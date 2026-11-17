import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { asegurarWebhook, convencion, empresaExterna, mensajeIntegracion, normalizarEmpresa, pasosDeFacturaSin, RegistroUrlPublica, resumenPrueba, RUTA_WEBHOOK, urlPublica, urlWebhookDe, type PuertoEnlaceWebhook } from '../src/facturacion-kyros/nucleo/integracion';
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

/* ------------------------------ Fase 4: entregas del aviso, huella, registro local y contrato de firma ------------------------------ */
import { createHmac as hmac } from 'node:crypto';
import { vistaParaGuardar, resumirPrueba, latenciaReceptor, AvisosFacturaSin, cruzarEntregas, datosDeEvento, describirPruebaEntrega, huellaCoincide, huellaSecreto, leerRegistroEntregas, puertoConHuella, registrarEntregaLocal } from '../src/facturacion-kyros/nucleo/integracion';

describe('huella del secreto de firma', () => {
  it('es el SHA-256 truncado a 8 hex (igual que FacturaSIN) y compara sin mostrar el secreto', () => {
    expect(huellaSecreto('abc')).toBe('ba7816bf');
    expect(huellaCoincide('ba7816bf', 'abc')).toBe(true);
    expect(huellaCoincide('ba7816bf', 'otro')).toBe(false);
    expect(huellaCoincide(null, 'abc')).toBe(false);
  });
});

describe('asegurarWebhook: no rota el secreto en cada pulsación; solo si la huella no coincide', () => {
  const url = urlWebhookDe('https://hub.kyros-tech.com');
  function puerto(huellaRemota: string | null) {
    const llamadas: Array<{ rotar: boolean }> = [];
    const p = { huellaRemota: async () => huellaRemota, asegurarWebhook: async (_u: string, _t?: string, o?: { rotarSecreto?: boolean }) => { llamadas.push({ rotar: !!o?.rotarSecreto }); return { suscripciones: [{ id: 'w', tenantId: '*', url, estado: 'sin_cambios' }], secreto: o?.rotarSecreto ? 'nuevo-secreto' : null }; } };
    return { p, llamadas };
  }
  it('huella igual → ninguna rotación (Verificar repetido no cambia nada)', async () => {
    const f = puerto(huellaSecreto('guardado'));
    for (let i = 0; i < 3; i++) { const r = await asegurarWebhook(f.p, { url, secretoGuardado: true, huellaLocal: huellaSecreto('guardado') }); expect(r.accion).toBe('sin_cambios'); }
    expect(f.llamadas.every((l) => !l.rotar)).toBe(true);
  });
  it('huella distinta (el secreto local no es el que usa FacturaSIN) → se re-sincroniza UNA vez', async () => {
    const f = puerto(huellaSecreto('el-de-facturasin'));
    const r = await asegurarWebhook(f.p, { url, secretoGuardado: true, huellaLocal: huellaSecreto('viejo') });
    expect(r).toMatchObject({ accion: 'secreto_renovado', secreto: 'nuevo-secreto' });
    expect(f.llamadas.filter((l) => l.rotar)).toHaveLength(1);
  });
  it('si no se puede leer la huella remota no rota (no se rompe lo que funciona)', async () => {
    const p = { huellaRemota: async (): Promise<string | null> => { throw new Error('x'); }, asegurarWebhook: async () => ({ suscripciones: [{ id: 'w', tenantId: '*', url, estado: 'sin_cambios' }], secreto: null }) };
    expect((await asegurarWebhook(p, { url, secretoGuardado: true, huellaLocal: 'aaaaaaaa' })).accion).toBe('sin_cambios');
  });
});

describe('registro local de entregas recibidas', () => {
  const e = (o: Partial<{ resultado: string; firmaValida: boolean; facturaId: string | null; evento: string; eventoId: string }> = {}) => ({ fecha: '2026-11-17T15:00:00Z', evento: 'factura.validada', eventoId: 'ev-1', facturaId: 'f1', resultado: 'aplicado', firmaValida: true, ...o });
  it('cuenta, guarda las últimas 20 y lee texto u objeto', () => {
    let r = leerRegistroEntregas(null); expect(r).toEqual({ total: 0, firmaInvalida: 0, ultimas: [] });
    for (let i = 0; i < 25; i++) r = registrarEntregaLocal(r, e({ eventoId: `ev-${i}`, firmaValida: i % 5 !== 0, resultado: i % 5 !== 0 ? 'aplicado' : 'firma_invalida' }));
    expect(r.total).toBe(25); expect(r.firmaInvalida).toBe(5); expect(r.ultimas).toHaveLength(20); expect(r.ultimas[0]!.eventoId).toBe('ev-24');
    expect(leerRegistroEntregas(JSON.stringify(r))).toEqual(r); expect(leerRegistroEntregas(r)).toEqual(r); expect(leerRegistroEntregas('basura').total).toBe(0);
  });
  it('datosDeEvento no confía en el cuerpo y no lanza', () => {
    expect(datosDeEvento('{"id":"e1","tipo":"factura.validada","datos":{"facturaId":"f9"}}')).toEqual({ evento: 'factura.validada', eventoId: 'e1', facturaId: 'f9' });
    expect(datosDeEvento('no json', 'cab-1')).toEqual({ evento: '—', eventoId: 'cab-1', facturaId: null });
  });
  it('cruza lo que FacturaSIN entregó con lo que el sistema registró (firma válida y misma factura/evento)', () => {
    const rem = [{ id: '1', facturaId: 'f1', tipo: 'factura.validada', estado: 'entregada', intentos: 1, ultimoCodigoHttp: 200, ultimoIntentoEn: 'x' }, { id: '2', facturaId: 'f2', tipo: 'factura.validada', estado: 'pendiente', intentos: 2, ultimoCodigoHttp: 401, ultimoIntentoEn: 'x' }];
    const cr = cruzarEntregas(rem, [e({ facturaId: 'f1' }), e({ facturaId: 'f2', firmaValida: false, resultado: 'firma_invalida' })]);
    expect(cr.map((x) => x.registrada)).toEqual([true, false]);
  });
});

describe('«Probar entrega» en lenguaje simple', () => {
  const url = 'https://hub.kyros-tech.com/api/v1/webhooks/facturasin';
  it('éxito y fallos con HTTP real', () => {
    expect(describirPruebaEntrega({ ok: true, codigoHttp: 204, ms: 120, url }).mensaje).toBe('FacturaSIN pudo avisarte (HTTP 204, 120 ms).');
    expect(describirPruebaEntrega({ ok: false, codigoHttp: 404, url }).mensaje).toContain('FacturaSIN no pudo llegar a /api/v1/webhooks/facturasin: HTTP 404');
    expect(describirPruebaEntrega({ ok: false, codigoHttp: 401, url }).mensaje).toContain('firma');
    expect(describirPruebaEntrega({ ok: false, codigoHttp: 413, url }).mensaje).toContain('más grande');
    expect(describirPruebaEntrega({ ok: false, codigoHttp: null, error: 'ECONNREFUSED', url }).mensaje).toContain('ECONNREFUSED');
  });
});

describe('AvisosFacturaSin (auditoría con la credencial propia)', () => {
  it('consulta entregas, huella y prueba; ante 401 se re-enlaza UNA vez', async () => {
    let enlaces = 0; let cred = 'viejo';
    const enlace = { credencial: async () => cred, enlazar: async () => { enlaces++; cred = 'nuevo'; return cred; } };
    const visto: string[] = [];
    const f = (async (u: string, i: { method: string; headers: Record<string, string> }) => {
      visto.push(`${i.method} ${u.replace('https://fs.test/api', '')} ${i.headers.authorization}`);
      if (i.headers.authorization === 'Bearer viejo') return new Response('{"codigo":"NO_AUTENTICADO","mensaje":"x"}', { status: 401 });
      if (u.includes('/reintentar')) return Response.json({ ok: true });
      if (u.includes('/entregas')) return Response.json([{ id: '1', facturaId: 'f1', tipo: 'factura.validada', estado: 'entregada', intentos: 1, ultimoCodigoHttp: 200, ultimoIntentoEn: 't' }]);
      if (u.endsWith('/probar')) return Response.json({ empresa: 'x:kyros-tech', resultados: [{ webhookId: 'w', url: 'https://x/y', ok: true, codigoHttp: 204, ms: 9, error: null, secretoHuella: 'abcd1234' }] });
      return Response.json([{ id: 'w', tenantId: 'kyros-tech', url: 'https://x', activo: true, secretoHuella: 'abcd1234' }]);
    }) as unknown as typeof fetch;
    const a = new AvisosFacturaSin(enlace, 'https://fs.test/api', f);
    expect((await a.entregas(5))[0]!.facturaId).toBe('f1');
    expect(enlaces).toBe(1);
    expect(await a.huellaRemota()).toBe('abcd1234');
    expect((await a.probarEntrega())).toMatchObject({ ok: true, codigoHttp: 204 });
    expect(await a.reintentarEntrega('en-1')).toEqual({ ok: true });
    expect(visto[0]).toContain('/v1/integraciones/webhooks/entregas?limite=5');
    const p = puertoConHuella({ asegurarWebhook: async () => ({ suscripciones: [], secreto: null }) }, a);
    expect(await p.huellaRemota!()).toBe('abcd1234');
  });
});

describe('contrato de firma: evento factura.validada real firmado como FacturaSIN', () => {
  /** Misma construcción que FacturaSIN: `X-FacturaSIN-Signature: t=<epoch>,v1=HMAC-SHA256(secreto, "t.cuerpoCrudo")`. */
  const firmar = (secreto: string, cuerpo: string, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${hmac('sha256', secreto).update(`${t}.${cuerpo}`).digest('hex')}`;
  const evento = (xml: string) => JSON.stringify({ id: 'ev-9', tipo: 'factura.validada', empresaId: 'e1', creadoEn: new Date().toISOString(), datos: { facturaId: 'f-9', cuf: 'ABC123', numero: 14, estado: 'validada', idExterno: 'hub:factura-1', ambientePruebas: true, version: 1, factura: { fechaEmision: '2026-11-17T15:30:00.000Z', totales: { montoTotal: 1969.93 }, items: [{ descripcion: 'Suscripción Hub — Ñandú «plan» ✓', cantidad: 1, precioUnitario: 1969.93 }] }, enlaces: { pdf: '/p', xml: '/x', qr: null }, xml } });
  it('la firma vale sobre el cuerpo CRUDO (con acentos, ñ, comillas y un XML grande), y falla con otro secreto, cuerpo alterado o reenvío viejo', async () => {
    const { verificarFirmaWebhook } = await import('../src/facturacion-kyros/nucleo/enlace-facturasin');
    const secreto = 'a'.repeat(64); const grande = evento('<facturaElectronica>' + 'x'.repeat(300_000) + '</facturaElectronica>');
    expect(Buffer.byteLength(grande)).toBeGreaterThan(300_000); // más que el límite por defecto (100 kB) de los servidores Express/Nest
    expect(verificarFirmaWebhook(secreto, firmar(secreto, grande), grande)).toBe(true);
    expect(verificarFirmaWebhook(secreto, firmar(secreto, grande), grande.replace('1969.93', '1.00'))).toBe(false);
    expect(verificarFirmaWebhook('b'.repeat(64), firmar(secreto, grande), grande)).toBe(false);
    expect(verificarFirmaWebhook(secreto, firmar(secreto, grande, 1_000_000_000), grande)).toBe(false);
    expect(verificarFirmaWebhook(['b'.repeat(64), secreto], firmar(secreto, grande), grande)).toBe(true); // rotación con dos secretos
  });
});

describe('v2.2: «Probar entrega» sin mensajes contradictorios, latencia del receptor y vista completa', () => {
  it('resumirPrueba lee {resultados:[…]} (respuesta real de FacturaSIN): ok con HTTP real; el primer fallo gana; sin resultados es un error explícito', () => {
    expect(resumirPrueba({ empresa: 'e', resultados: [{ webhookId: 'w', url: 'u', ok: true, codigoHttp: 204, ms: 12, error: null, secretoHuella: 'abcd1234' }] })).toMatchObject({ ok: true, codigoHttp: 204, ms: 12 });
    expect(resumirPrueba({ resultados: [{ ok: true, codigoHttp: 204 }, { ok: false, codigoHttp: 401, error: 'firma' }] })).toMatchObject({ ok: false, codigoHttp: 401 });
    expect(resumirPrueba({ ok: true, codigoHttp: 200 })).toMatchObject({ ok: true, codigoHttp: 200 });
    const vacio = resumirPrueba({ empresa: 'e', resultados: [] });
    expect(vacio.ok).toBe(false); expect(vacio.error).toMatch(/no devolvió/);
    expect(describirPruebaEntrega(resumirPrueba({ resultados: [{ ok: true, codigoHttp: 204, ms: 9 }] })).ok).toBe(true);
  });
  it('latenciaReceptor resume lo medido (última, máxima, promedio) y tolera registros sin medida', () => {
    const l = (ms?: number) => ({ fecha: 'x', evento: 'e', eventoId: 'i', facturaId: null, resultado: 'aplicado', firmaValida: true, ms });
    expect(latenciaReceptor([l(40), l(10), l()])).toEqual({ ultimaMs: 40, maxMs: 40, promedioMs: 25 });
    expect(latenciaReceptor([])).toEqual({ ultimaMs: null, maxMs: null, promedioMs: null });
  });
  it('vistaParaGuardar conserva la factura tal cual (sin alterar totales) y completa enlaces/estado/CUF/número; fecha solo si es válida', () => {
    const f = { fechaEmision: '2026-11-17T15:30:00.000Z', totales: { montoTotal: 1969.93 }, items: [{ descripcion: 'x' }] };
    const v = vistaParaGuardar(f, { enlaces: { pdf: '/p' }, estado: 'validada', cuf: 'ABC', numero: 14 })!;
    expect(v.respuesta).toMatchObject({ totales: { montoTotal: 1969.93 }, enlaces: { pdf: '/p' }, estado: 'validada', cuf: 'ABC', numero: 14 });
    expect(v.fechaEmision).toBe('2026-11-17T15:30:00.000Z');
    expect(vistaParaGuardar({ fechaEmision: 'nada', a: 1 })!.fechaEmision).toBeNull();
    expect(vistaParaGuardar(null)).toBeNull(); expect(vistaParaGuardar({})).toBeNull(); expect(vistaParaGuardar([1])).toBeNull();
  });
});

import { facturacionHabilitada } from '../src/facturacion-kyros/nucleo/integracion';

describe('v2.3: facturacionHabilitada «pago + interruptor» (override del SuperAdmin, luego plan de pago, luego no incluida)', () => {
  it('1) el override del SuperAdmin manda sobre el plan: encendido aunque no haya pago, apagado aunque haya pago', () => {
    expect(facturacionHabilitada({ override: true, planDePagoVigente: false })).toMatchObject({ habilitada: true, motivo: 'habilitada_por_admin', origen: 'superadmin', etiqueta: 'Habilitada por el administrador', mensaje: null });
    const apagada = facturacionHabilitada({ override: false, planDePagoVigente: true });
    expect(apagada).toMatchObject({ habilitada: false, motivo: 'desactivada_por_admin', origen: 'superadmin', etiqueta: 'Desactivada por el administrador' });
    expect(apagada.mensaje).toMatch(/desactivada/);
  });
  it('2) sin override, un plan de pago vigente la habilita por defecto', () => {
    expect(facturacionHabilitada({ planDePagoVigente: true })).toMatchObject({ habilitada: true, motivo: 'por_plan', origen: 'plan', etiqueta: 'Por plan', mensaje: null });
    expect(facturacionHabilitada({ override: null, planDePagoVigente: true }).habilitada).toBe(true);
  });
  it('3) sin override y sin plan de pago (prueba gratuita, demostración, vencido): «No incluida en tu plan» + cómo pedirla', () => {
    const r = facturacionHabilitada({ override: null, planDePagoVigente: false });
    expect(r).toMatchObject({ habilitada: false, motivo: 'no_incluida', etiqueta: 'No incluida' });
    expect(r.mensaje).toMatch(/No incluida en tu plan/);
    expect(r.mensaje).toMatch(/administracion@kyros-tech\.com/);
    expect(facturacionHabilitada({ planDePagoVigente: false }).habilitada).toBe(false);
  });
});
