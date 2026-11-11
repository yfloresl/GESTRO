import { JwtService } from '@nestjs/jwt';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SecretosService } from '../src/secretos/secretos.service';
import { levantar } from './util';

let t: Awaited<ReturnType<typeof levantar>>;
let plat: Awaited<ReturnType<Awaited<ReturnType<typeof levantar>>['nuevaPlataforma']>>;
beforeAll(async () => { t = await levantar(); plat = await t.nuevaPlataforma(); });
afterAll(async () => { await t.cerrar(); });

const CLAVE = 'KYROS_SERVICE_CLIENT_SECRET';
const SECRETO = 'valor-secreto-de-prueba-0123456789-ABCDEF';

describe('Integraciones / secretos de plataforma', () => {
  it('solo plataforma: un dueño de restaurante no ve ni escribe nada', async () => {
    const r = await t.nuevoRestaurante('Sin Secretos'); const d = t.con(r.token, r.rid);
    expect((await d.get('/plataforma/secretos')).status).toBe(403);
    expect((await d.put(`/plataforma/secretos/${CLAVE}`, { valor: SECRETO })).status).toBe(403);
    expect((await d.del(`/plataforma/secretos/${CLAVE}`)).status).toBe(403);
  });

  it('catálogo cerrado: aparece «no configurada», solo existen claves del catálogo y el valor se valida', async () => {
    const e = await plat.get('/plataforma/secretos');
    expect(e.status).toBe(200); expect(e.body).toHaveLength(1); expect(e.body[0]).toMatchObject({ clave: CLAVE, estado: 'no_configurada' });
    expect((await plat.put('/plataforma/secretos/OTRA_CLAVE', { valor: SECRETO })).status).toBe(404);
    expect((await plat.put(`/plataforma/secretos/${CLAVE}`, { valor: 'corto' })).status).toBe(400);
    expect((await plat.put(`/plataforma/secretos/${CLAVE}`, { valor: SECRETO, otro: 1 })).status).toBe(400);
  });

  it('guardar: queda cifrado y auditado, y NINGUNA ruta ni registro devuelve el valor', async () => {
    const g = await plat.put(`/plataforma/secretos/${CLAVE}`, { valor: SECRETO });
    expect(g.status).toBe(200); expect(JSON.stringify(g.body)).not.toContain(SECRETO);
    const e = await plat.get('/plataforma/secretos');
    expect(e.body[0]).toMatchObject({ clave: CLAVE, estado: 'configurada' }); expect(JSON.stringify(e.body)).not.toContain(SECRETO);
    expect(Object.keys(e.body[0])).not.toContain('valor');
    const fila = (await t.owner.query(`SELECT valor_cifrado FROM app_config WHERE clave = $1`, [`secreto.${CLAVE}`])).rows[0];
    expect(String(fila.valor_cifrado)).not.toContain(SECRETO);
    const aud = (await t.owner.query(`SELECT action, after FROM audit_log WHERE entity = 'secreto'`)).rows;
    expect(aud.map((x) => x.action)).toContain('plataforma.secreto_guardado'); expect(JSON.stringify(aud)).not.toContain(SECRETO);
    // el valor sigue disponible solo para el servidor, no por HTTP
    expect(await t.app.get((await import('../src/integraciones/integraciones')).IntegracionesService).obtener(CLAVE)).toBe(SECRETO);
    for (const ruta of ['/plataforma/ia', '/plataforma/planes', '/plataforma/demo']) expect(JSON.stringify((await plat.get(ruta)).body)).not.toContain(SECRETO);
  });

  it('escribir exige haber confirmado la identidad hace poco (REAUTH_REQUERIDA); leer el estado no', async () => {
    const viejo = await t.app.get(JwtService).signAsync({ plat: true, aat: Math.floor(Date.now() / 1000) - 3600, rids: [], roles: {} },
      { secret: t.app.get(SecretosService).firma('acceso'), algorithm: 'HS256', audience: 'staff', subject: plat.userId, expiresIn: '5m' });
    const api = (m: 'put' | 'delete' | 'get', ruta: string, c?: object) => t.api()[m](`/api/v1${ruta}`).set('Authorization', `Bearer ${viejo}`).send(c);
    const w = await api('put', `/plataforma/secretos/${CLAVE}`, { valor: SECRETO });
    expect(w.status).toBe(401); expect(w.body.code).toBe('REAUTH_REQUERIDA');
    expect((await api('delete', `/plataforma/secretos/${CLAVE}`)).status).toBe(401);
    expect((await api('get', '/plataforma/secretos')).status).toBe(200);
  });

  it('quitar = deshabilitar: el valor se limpia, la fila y la auditoría se conservan', async () => {
    const d = await plat.del(`/plataforma/secretos/${CLAVE}`);
    expect(d.status).toBe(200); expect(d.body.estado).toBe('no_configurada');
    const e = await plat.get('/plataforma/secretos'); expect(e.body[0].estado).toBe('no_configurada'); expect(e.body[0].deshabilitadaEn).toBeTruthy();
    expect(Number((await t.owner.query(`SELECT count(*)::int n FROM app_config WHERE clave = $1`, [`secreto.${CLAVE}`])).rows[0].n)).toBe(1);   // no se borra
    const acc = (await t.owner.query(`SELECT action FROM audit_log WHERE entity = 'secreto' ORDER BY created_at`)).rows.map((x) => x.action);
    expect(acc).toEqual(expect.arrayContaining(['plataforma.secreto_guardado', 'plataforma.secreto_deshabilitado']));
    expect(await t.app.get((await import('../src/integraciones/integraciones')).IntegracionesService).obtener(CLAVE)).toBeNull();
  });
});
