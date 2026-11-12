import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SUB_PRUEBA_KYROS } from '../src/demo/constantes';
import { DOCUMENTOS_LEGALES, VERSION_LEGAL } from '../src/legal/legal';
import { LEGAL, levantar } from './util';

let t: Awaited<ReturnType<typeof levantar>>;
beforeAll(async () => { t = await levantar(); });
afterAll(async () => { await t.cerrar(); });

const raiz = join(__dirname, '..', '..', '..');
const nuevaIdentidad = async () => {
  const sub = crypto.randomUUID();
  const canje = await t.api().post('/api/v1/auth/kyros-id/sesion').send({ accessToken: t.firmar({ sub }) });
  return { sub, token: canje.body.registroToken as string };
};
const datos = (n: string) => ({ nombre: 'Rosa Quispe', correo: `${crypto.randomUUID()}@t.bo`, restaurante: n, razonSocial: `${n} SRL` });
const alta = (token: string, extra: object) => t.api().post('/api/v1/auth/kyros-id/registro').set('User-Agent', 'prueba/1.0').send({ registroToken: token, ...datos('Legal SRL'), ...extra });

describe('Aceptación de términos', () => {
  it('el alta se rechaza sin aceptación, con casilla en falso o con una versión vieja, y no crea nada', async () => {
    const antes = Number((await t.owner.query(`SELECT count(*)::int n FROM restaurants`)).rows[0].n);
    for (const extra of [{}, { aceptaTerminos: false, versionLegal: VERSION_LEGAL }, { aceptaTerminos: true }, { aceptaTerminos: 'si', versionLegal: VERSION_LEGAL }]) {
      const { token } = await nuevaIdentidad(); const r = await alta(token, extra);
      expect(r.status, JSON.stringify(extra)).toBeGreaterThanOrEqual(400); expect(r.status).toBeLessThan(500);
    }
    const vieja = await alta((await nuevaIdentidad()).token, { aceptaTerminos: true, versionLegal: '2000-01-01' });
    expect(vieja.status).toBe(422); expect(vieja.body.code).toBe('LEGAL_VERSION');
    expect(Number((await t.owner.query(`SELECT count(*)::int n FROM restaurants`)).rows[0].n)).toBe(antes);
  });

  it('con aceptación el alta funciona y deja evidencia: persona, versión, documentos, fecha y huellas (no la IP ni el navegador en claro)', async () => {
    const { sub, token } = await nuevaIdentidad(); const r = await alta(token, LEGAL);
    expect(r.status).toBe(200);
    const f = (await t.owner.query(`SELECT a.*, u.id AS uid FROM legal_acceptances a JOIN kyros_links k ON k.user_id = a.user_id JOIN users u ON u.id = a.user_id WHERE k.sub = $1`, [sub])).rows;
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ version: VERSION_LEGAL, origin: 'registro', kyros_sub: sub, documents: [...DOCUMENTOS_LEGALES] });
    expect(f[0].ip_hash).toMatch(/^[0-9a-f]{64}$/); expect(f[0].ua_hash).toMatch(/^[0-9a-f]{64}$/); expect(JSON.stringify(f[0])).not.toContain('prueba/1.0');
    expect(f[0].accepted_at).toBeInstanceOf(Date);
  });

  it('si cambia la versión se pide aceptar de nuevo (estado → aceptar → ok); una versión equivocada se rechaza', async () => {
    const r = await t.nuevoRestaurante('Reaceptar'); const api = t.con(r.token, r.rid);
    expect((await api.get('/legal/estado')).body).toMatchObject({ version: VERSION_LEGAL, aceptada: true, exenta: false });
    await t.owner.query(`UPDATE legal_acceptances SET version = '2000-01-01' WHERE user_id = $1`, [r.userId]);   // como si hubiera aceptado una versión anterior
    expect((await api.get('/legal/estado')).body.aceptada).toBe(false);
    expect((await api.post('/legal/aceptar', { acepto: true, version: '2000-01-01' })).status).toBe(422);
    expect((await api.post('/legal/aceptar', { acepto: false, version: VERSION_LEGAL })).status).toBe(400);
    expect((await api.post('/legal/aceptar', { acepto: true, version: VERSION_LEGAL })).status).toBe(200);
    expect((await api.get('/legal/estado')).body.aceptada).toBe(true);
    expect((await t.owner.query(`SELECT origin FROM legal_acceptances WHERE user_id = $1 AND version = $2`, [r.userId, VERSION_LEGAL])).rows[0].origin).toBe('reaceptacion');
  });

  it('las cuentas de demostración no pasan por el bloqueo, y la versión vigente es pública', async () => {
    const plat = await t.nuevaPlataforma(); await plat.del('/plataforma/demo'); expect((await plat.post('/plataforma/demo', { dias: 7 })).status).toBe(200);
    try {
      const s = await t.api().post('/api/v1/auth/kyros-id/sesion').send({ accessToken: t.firmar({ sub: SUB_PRUEBA_KYROS }) });
      const d = await t.con(s.body.sesion.accessToken, s.body.sesion.sucursales[0].id).get('/legal/estado');
      expect(d.body).toMatchObject({ aceptada: true, exenta: true });
    } finally { await plat.del('/plataforma/demo'); }
    expect((await t.api().get('/api/v1/public/legal')).body).toEqual({ version: VERSION_LEGAL, documentos: [...DOCUMENTOS_LEGALES] });
  });
});

describe('Textos legales', () => {
  it('existen en es y en, están marcados como borrador, declaran la versión vigente y la copia de la web no se desfasa', () => {
    for (const idioma of ['es', 'en']) for (const d of DOCUMENTOS_LEGALES) {
      const fuente = readFileSync(join(raiz, 'docs/legal', idioma, `${d}.md`), 'utf8'); const copia = readFileSync(join(raiz, 'apps/web/src/legal', idioma, `${d}.md`), 'utf8');
      expect(fuente, `${idioma}/${d}`).toMatch(/BORRADOR|DRAFT/); expect(fuente).toMatch(/TODO-VERIFY|TODO-VERIFICAR/); expect(fuente).toContain(VERSION_LEGAL);
      expect(copia.replace(/\r\n/g, '\n'), `copia ${idioma}/${d}`).toBe(fuente.replace(/\r\n/g, '\n'));
      expect(fuente).not.toMatch(/cumplimos con la ley|cumple con la normativa/i);
    }
  });
});

describe('Lectura pública de los documentos', () => {
  it('GET /public/legal/:doc/vigente sirve título, versión y texto SIN sesión, en es y en; un documento inexistente da 404', async () => {
    for (const idioma of ['es', 'en']) for (const d of DOCUMENTOS_LEGALES) {
      const r = await t.api().get(`/api/v1/public/legal/${d}/vigente`).query({ idioma });
      expect(r.status, `${idioma}/${d}`).toBe(200);
      expect(r.body).toMatchObject({ documento: d, version: VERSION_LEGAL, idioma });
      expect(r.body.titulo.length).toBeGreaterThan(5);
      expect(r.body.markdown.replace(/\r\n/g, '\n')).toBe(readFileSync(join(raiz, 'docs/legal', idioma, `${d}.md`), 'utf8').replace(/\r\n/g, '\n'));
    }
    expect((await t.api().get('/api/v1/public/legal/secretos/vigente')).status).toBe(404);
    expect((await t.api().get('/api/v1/public/legal/terminos/vigente')).body.idioma).toBe('es');   // por defecto español
  });
});
