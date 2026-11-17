import { describe, expect, it } from 'vitest';
import { CONVENCION, cabeceraEmpresa, empresaExterna } from '../src/facturacion-kyros/integracion/convencion';
import { ausente, enlazarSistema, puertoWebhooks } from '../src/facturacion-kyros/integracion/enlace';
import { derivarUrlPublica, esHostLocalOPrivado, urlPublicaValida } from '../src/facturacion-kyros/integracion/url-publica';
import { _reiniciarUrlPublica, configurarDesarrollo, urlPublica, urlPublicaConocida } from '../src/facturacion-kyros/integracion/url-publica-estado';
import { asegurarWebhookCon, mensajeWebhook, type PuertoWebhooks, type SuscripcionRemota } from '../src/facturacion-kyros/integracion/webhook';

const prod = { desarrollo: false };
const dev = { desarrollo: true };

describe('urlPublica (R1)', () => {
  it('usa X-Forwarded-Proto/Host y exige https', () => {
    expect(derivarUrlPublica({ headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'dental.kyros-tech.com', host: 'api:3100' } }, prod)).toEqual({ ok: true, url: 'https://dental.kyros-tech.com' });
  });
  it('cae a Host + protocolo de Express (trust proxy)', () => {
    expect(derivarUrlPublica({ headers: { host: 'Dental.Kyros-Tech.com' }, protocol: 'https' }, prod)).toEqual({ ok: true, url: 'https://dental.kyros-tech.com' });
  });
  it('toma el primer valor de listas separadas por coma', () => {
    expect(derivarUrlPublica({ headers: { 'x-forwarded-proto': 'https, http', 'x-forwarded-host': 'a.example.com, b.example.com' } }, prod)).toEqual({ ok: true, url: 'https://a.example.com' });
  });
  it('rechaza http en produccion pero lo acepta en desarrollo', () => {
    expect(derivarUrlPublica({ headers: { host: 'dental.kyros-tech.com' }, protocol: 'http' }, prod).ok).toBe(false);
    expect(derivarUrlPublica({ headers: { host: 'localhost:5174' }, protocol: 'http' }, dev)).toEqual({ ok: true, url: 'http://localhost:5174' });
  });
  it('rechaza localhost e IP privadas en produccion', () => {
    for (const h of ['localhost', 'localhost:3100', '127.0.0.1', '10.0.0.5', '192.168.1.10', '172.16.0.1', '169.254.1.1', '[::1]', 'dental-api']) {
      expect(derivarUrlPublica({ headers: { host: h }, protocol: 'https' }, prod).ok).toBe(false);
    }
  });
  it('rechaza hosts ajenos o manipulados (ruta, credenciales, espacios, esquema)', () => {
    for (const h of ['evil.com/x', 'a@evil.com', 'evil.com evil2.com', 'https://evil.com', 'evil.com?x=1', 'ev il.com', '']) {
      expect(derivarUrlPublica({ headers: { 'x-forwarded-host': h || undefined, host: undefined }, protocol: 'https' }, prod).ok).toBe(false);
    }
  });
  it('esHostLocalOPrivado distingue publicas de privadas', () => {
    expect(esHostLocalOPrivado('8.8.8.8')).toBe(false);
    expect(esHostLocalOPrivado('172.32.0.1')).toBe(false);
    expect(esHostLocalOPrivado('dental.kyros-tech.com')).toBe(false);
    expect(esHostLocalOPrivado('172.31.0.1')).toBe(true);
  });
  it('urlPublicaValida: solo https publica sin ruta ni credenciales', () => {
    expect(urlPublicaValida('https://dental.kyros-tech.com', prod)).toBe(true);
    expect(urlPublicaValida('http://dental.kyros-tech.com', prod)).toBe(false);
    expect(urlPublicaValida('https://localhost', prod)).toBe(false);
    expect(urlPublicaValida('https://x.com/otra', prod)).toBe(false);
    expect(urlPublicaValida('https://u:p@x.com', prod)).toBe(false);
    expect(urlPublicaValida('http://localhost:5174', dev)).toBe(true);
  });
  it('guarda la ultima URL conocida, detecta el cambio de dominio y no la pisa con una peticion invalida', () => {
    configurarDesarrollo(() => false);
    try {
      _reiniciarUrlPublica(null);
      expect(urlPublica({ headers: { host: 'dental.kyros-tech.com' }, protocol: 'https' })).toBe('https://dental.kyros-tech.com');
      expect(urlPublica({ headers: { host: 'localhost' }, protocol: 'http' })).toBe('https://dental.kyros-tech.com');
      expect(urlPublica({ headers: { host: 'odonto.example.bo' }, protocol: 'https' })).toBe('https://odonto.example.bo');
      expect(urlPublicaConocida()).toBe('https://odonto.example.bo');
    } finally { _reiniciarUrlPublica(null); }
  });
});

describe('convencion (R3)', () => {
  it('normaliza la empresa sin duplicar el prefijo', () => {
    expect(empresaExterna('dental', 'dental:kyros-tech')).toBe('kyros-tech');
    expect(empresaExterna('dental', 'dental:dental:Kyros Tech')).toBe('kyros-tech');
    expect(empresaExterna('dental', '  KYROS-TECH ')).toBe('kyros-tech');
    expect(cabeceraEmpresa('dental', 'dental:abc-123')).toBe('dental:abc-123');
  });
  it('defaults por convencion', () => {
    expect(CONVENCION.clienteServicio('dental')).toBe('dental-service');
    expect(CONVENCION.tenantKyros).toBe('kyros-tech');
    expect(CONVENCION.codigosProvisionales).toEqual({ productoSin: '83141', actividadEconomica: '620100', unidadMedida: 58 });
    expect(CONVENCION.urlFacturaSin).toBe('https://facturasin.kyros-tech.com/api');
  });
});

/** FacturaSIN falso: guarda suscripciones; `conUpsert` simula que ya publico el enlace. */
function falso(conUpsert: boolean, inicial: SuscripcionRemota[] = []) {
  const subs = [...inicial];
  let n = 100;
  const llamadas: string[] = [];
  const puerto: PuertoWebhooks = {
    async upsert(o) {
      if (!conUpsert) return null;
      llamadas.push('upsert');
      const ex = subs[0];
      if (!ex) { subs.push({ id: 'w1', url: o.url, activo: true }); return { estado: 'creada', id: 'w1', secreto: 'sec-1' }; }
      if (ex.url === o.url) return { estado: 'sin_cambios', id: ex.id, secreto: o.rotarSecreto ? 'sec-rot' : null };
      ex.url = o.url; return { estado: 'actualizada', id: ex.id, secreto: o.rotarSecreto ? 'sec-rot' : null };
    },
    async listar() { llamadas.push('listar'); return subs.map((s) => ({ ...s })); },
    async crear(url) { llamadas.push('crear'); const id = `w${++n}`; subs.push({ id, url, activo: true }); return { id, secreto: `sec-${id}` }; },
    async borrar(id) { llamadas.push(`borrar:${id}`); const i = subs.findIndex((s) => s.id === id); if (i >= 0) subs.splice(i, 1); },
  };
  return { puerto, subs, llamadas };
}
const URL1 = 'https://dental.kyros-tech.com/api/dental/v1/webhooks/facturasin/kyros';
const URL2 = 'https://odonto.example.bo/api/dental/v1/webhooks/facturasin/kyros';
const base = (url: string, local = { url: null as string | null, id: null as string | null, tieneSecreto: false }) => ({ tenantId: 'kyros-tech', urlDestino: url, local });

describe('asegurarWebhook (R2) con upsert del enlace', () => {
  it('crea y devuelve el secreto a guardar', async () => {
    const f = falso(true);
    const r = await asegurarWebhookCon(f.puerto, base(URL1));
    expect(r).toMatchObject({ accion: 'creada', via: 'upsert', secretoNuevo: 'sec-1' });
    expect(f.subs).toHaveLength(1);
  });
  it('es idempotente: la segunda vez no cambia nada ni rota el secreto', async () => {
    const f = falso(true);
    await asegurarWebhookCon(f.puerto, base(URL1));
    const r = await asegurarWebhookCon(f.puerto, base(URL1, { url: URL1, id: 'w1', tieneSecreto: true }));
    expect(r).toMatchObject({ accion: 'sin_cambios', secretoNuevo: null });
    expect(f.subs).toHaveLength(1);
  });
  it('cambio de dominio: migra la suscripcion existente sin duplicar', async () => {
    const f = falso(true);
    await asegurarWebhookCon(f.puerto, base(URL1));
    const r = await asegurarWebhookCon(f.puerto, base(URL2, { url: URL1, id: 'w1', tieneSecreto: true }));
    expect(r.accion).toBe('migrada');
    expect(f.subs).toEqual([{ id: 'w1', url: URL2, activo: true }]);
  });
  it('sin secreto guardado pide rotarlo para poder verificar la firma', async () => {
    const f = falso(true, [{ id: 'w1', url: URL1, activo: true }]);
    const r = await asegurarWebhookCon(f.puerto, base(URL1));
    expect(r.secretoNuevo).toBe('sec-rot');
  });
});

describe('asegurarWebhook (R2) con la API existente (adaptador crear + borrar)', () => {
  it('crea cuando no hay ninguna', async () => {
    const f = falso(false);
    const r = await asegurarWebhookCon(f.puerto, base(URL1));
    expect(r).toMatchObject({ accion: 'creada', via: 'crear_y_borrar', id: 'w101' });
    expect(f.subs).toHaveLength(1);
  });
  it('no duplica si ya esta suscrita a la URL actual y hay secreto', async () => {
    const f = falso(false, [{ id: 'w1', url: URL1, activo: true }]);
    const r = await asegurarWebhookCon(f.puerto, base(URL1, { url: URL1, id: 'w1', tieneSecreto: true }));
    expect(r).toMatchObject({ accion: 'sin_cambios', secretoNuevo: null });
    expect(f.llamadas).not.toContain('crear');
  });
  it('migra la suscripcion vieja: crea la nueva y borra la anterior (y duplicados)', async () => {
    const f = falso(false, [{ id: 'w1', url: URL1, activo: true }, { id: 'w2', url: URL1, activo: true }]);
    const r = await asegurarWebhookCon(f.puerto, base(URL2, { url: URL1, id: 'w1', tieneSecreto: true }));
    expect(r.accion).toBe('migrada');
    expect(r.secretoNuevo).toMatch(/^sec-/);
    expect(f.subs).toHaveLength(1);
    expect(f.subs[0]!.url).toBe(URL2);
    // la nueva se crea ANTES de borrar: si falla el borrado no se queda sin suscripcion
    expect(f.llamadas.indexOf('crear')).toBeLessThan(f.llamadas.findIndex((x) => x.startsWith('borrar')));
  });
  it('si el borrado de la vieja falla no pierde la nueva', async () => {
    const f = falso(false, [{ id: 'w1', url: URL1, activo: true }]);
    f.puerto.borrar = async () => { throw new Error('boom'); };
    const r = await asegurarWebhookCon(f.puerto, base(URL2, { url: URL1, id: 'w1', tieneSecreto: true }));
    expect(r.ok).toBe(true);
    expect(f.subs.some((s) => s.url === URL2)).toBe(true);
  });
});

describe('adaptador HTTP del enlace (R4)', () => {
  const err = (estado: number) => Object.assign(new Error('x'), { estado });
  it('ausente() reconoce 404/405/501', () => {
    expect(ausente(err(404))).toBe(true);
    expect(ausente(err(405))).toBe(true);
    expect(ausente(err(500))).toBe(false);
  });
  it('enlazarSistema devuelve null si FacturaSIN aun no tiene la interfaz y propaga otros errores', async () => {
    expect(await enlazarSistema(async () => { throw err(404); }, { sistema: 'dental', version: '1' })).toBeNull();
    await expect(enlazarSistema(async () => { throw err(500); }, { sistema: 'dental', version: '1' })).rejects.toBeTruthy();
  });
  it('enlazarSistema extrae la credencial y puertoWebhooks.upsert devuelve null con 404', async () => {
    const r = await enlazarSistema(async () => ({ credencial: { valor: 'fsk_dental_x', id: 'i', prefijo: 'fsk_dental_ab' }, empresaKyros: { externo: 'dental:kyros-tech' } }), { sistema: 'dental', version: '1' });
    expect(r?.credencial?.valor).toBe('fsk_dental_x');
    const p = puertoWebhooks(async () => { throw err(404); }, 'dental:kyros-tech');
    expect(await p.upsert({ tenantId: 'kyros-tech', url: URL1, eventos: ['factura.validada'], rotarSecreto: true })).toBeNull();
  });
});

describe('mensajes (R5)', () => {
  it('nunca muestran HTTP crudo ni mandan a Keycloak/variables', () => {
    for (const e of [{ estado: 400 }, { estado: 401 }, { estado: 404 }, { estado: 422 }, { estado: 503 }, new Error('red')]) {
      const m = mensajeWebhook(e);
      expect(m).not.toMatch(/HTTP \d|Keycloak|variable|URL_BASE|PAYMENTS_RETURN/i);
      expect(m.length).toBeGreaterThan(20);
    }
  });
});
