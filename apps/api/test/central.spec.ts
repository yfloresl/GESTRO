import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KyrosIdService } from '../src/kyros-id/kyros-id.service';
import { CLIENT, levantar } from './util';

let t: Awaited<ReturnType<typeof levantar>>;
const PA = ['kyros-platform-admin'];
const ahora = () => Math.floor(Date.now() / 1000);
const canje = (token: string) => t.api().post('/api/v1/auth/kyros-id/sesion').send({ accessToken: token });
const encender = (plataformaSso: boolean, plataformaMax?: number) => t.app.get(KyrosIdService).guardar({ activo: true, emisor: t.emisor, clientId: CLIENT, audiencia: CLIENT, plataformaSso, plataformaMax }, randomUUID());
const limpiar = async () => {
  const ids = `SELECT user_id FROM kyros_links WHERE origen = 'PLATAFORMA'`;
  await t.owner.query(`DELETE FROM refresh_tokens WHERE user_id IN (${ids})`);
  await t.owner.query(`DELETE FROM users WHERE id IN (${ids})`);
};
const consola = (token: string) => t.api().get('/api/v1/plataforma/pagos').set('Authorization', `Bearer ${token}`);
const motivos = async () => (await t.owner.query(`SELECT after FROM audit_log WHERE action = 'plataforma.ingreso_superadmin_central_rechazado'`)).rows.map((f) => f.after.motivo as string);

beforeAll(async () => { t = await levantar(); await limpiar(); });
afterAll(async () => { await t.cerrar(); });

describe('SuperAdmin central de Kyros ID', () => {
  it('con el interruptor APAGADO (por defecto) el claim se ignora: flujo normal sin vínculo y sin crear nada', async () => {
    await encender(false);
    const r = await canje(t.firmar({ kyros_pa: PA, acr: '1' }));
    expect(r.status).toBe(200); expect(r.body.estado).toBe('sin_vinculo');
    expect(Number((await t.owner.query(`SELECT count(*)::int n FROM kyros_links WHERE origen = 'PLATAFORMA'`)).rows[0].n)).toBe(0);
  });

  it('encendido: claim exacto con acr=1 y auth_time reciente crea el usuario central (sin is_platform_admin persistido) y entra a la consola', async () => {
    await encender(true);
    const sub = randomUUID();
    const r = await canje(t.firmar({ sub, kyros_pa: PA, acr: '1', email: 'real@kyros.com', realm_access: { roles: ['x'] } }));
    expect(r.status).toBe(200); expect(r.body.estado).toBe('sesion');
    expect(r.body.sesion.usuario.esPlataforma).toBe(true); expect(r.body.sesion.sucursales).toEqual([]);
    const u = (await t.owner.query(`SELECT u.email, u.is_platform_admin, u.active, k.origen FROM users u JOIN kyros_links k ON k.user_id = u.id WHERE k.sub = $1`, [sub])).rows[0];
    expect(u).toMatchObject({ is_platform_admin: false, active: true, origen: 'PLATAFORMA' });
    expect(u.email).toMatch(/^pa-[0-9a-f]+@kyros-id\.invalid$/);
    expect((await consola(r.body.sesion.accessToken)).status).toBe(200);
    const aud = (await t.owner.query(`SELECT after FROM audit_log WHERE action = 'plataforma.ingreso_superadmin_central' AND user_id = $1`, [r.body.sesion.usuario.id])).rows;
    expect(aud).toHaveLength(1); expect(aud[0].after).toMatchObject({ creado: true, acr: '1' });
    const texto = JSON.stringify(aud[0].after);
    expect(texto).not.toContain(sub); expect(texto).not.toContain('real@');
  });

  it('formas inválidas del claim, acr o auth_time no crean nada', async () => {
    await encender(true);
    for (const kyros_pa of [true, 'kyros-platform-admin', ['kyros-platform-admin', 'otro'], ['otro'], [], undefined]) {
      const r = await canje(t.firmar({ kyros_pa, acr: '1' }));
      expect(r.body.estado, JSON.stringify(kyros_pa)).toBe('sin_vinculo');
    }
    for (const extra of [{ acr: '0' }, { acr: undefined }, { acr: '2' }, { acr: '1', auth_time: ahora() - 400 }]) {
      const r = await canje(t.firmar({ kyros_pa: PA, ...extra }));
      expect(r.status, JSON.stringify(extra)).toBe(401); expect(r.body.code).toBe('PLATAFORMA_REAUTH');
    }
    expect(await motivos()).toEqual(expect.arrayContaining(['acr', 'auth_time']));
  });

  it('el claim solo cuenta en un token válido para ESTE client: otro azp o audiencia no entra', async () => {
    await encender(true);
    expect((await canje(t.firmar({ kyros_pa: PA, acr: '1', azp: 'portal-web' }))).status).toBe(401);
    expect((await canje(t.firmar({ kyros_pa: PA, acr: '1', aud: ['otro'] }))).status).toBe(401);
  });

  it('reentrar: acepta acr=0 (SSO) hasta 10 h; más viejo pide reautenticación; sin claim o suspendido no entra', async () => {
    await encender(true);
    const sub = randomUUID();
    expect((await canje(t.firmar({ sub, kyros_pa: PA, acr: '1' }))).status).toBe(200);
    const sso = await canje(t.firmar({ sub, kyros_pa: PA, acr: '0', auth_time: ahora() - 3 * 3600 }));
    expect(sso.status).toBe(200); expect(sso.body.sesion.usuario.esPlataforma).toBe(true);
    const viejo = await canje(t.firmar({ sub, kyros_pa: PA, acr: '0', auth_time: ahora() - 11 * 3600 }));
    expect(viejo.status).toBe(401); expect(viejo.body.code).toBe('PLATAFORMA_REAUTH');
    expect((await canje(t.firmar({ sub, acr: '1' }))).status).toBe(401);   // rol retirado: sin privilegio
    await t.owner.query(`UPDATE users SET active = false WHERE id = (SELECT user_id FROM kyros_links WHERE sub = $1)`, [sub]);
    expect((await canje(t.firmar({ sub, kyros_pa: PA, acr: '1' }))).status).toBe(403);
    expect(await motivos()).toContain('cuenta_suspendida');
  });

  it('no escala cuentas existentes: un dueño vinculado con el claim entra como dueño y se audita el rechazo', async () => {
    await encender(true);
    const a = await t.nuevoRestaurante('Sin Escalar');
    const r = await canje(t.firmar({ sub: a.sub, kyros_pa: PA, acr: '1' }));
    expect(r.status).toBe(200); expect(r.body.sesion.usuario.esPlataforma).toBe(false);
    expect((await consola(r.body.sesion.accessToken)).status).toBe(403);
    expect(await motivos()).toContain('sub_vinculado_a_cuenta_no_superadmin');
  });

  it('tope de identidades centrales y cerrojo contra carreras', async () => {
    await limpiar();
    await encender(true, 2);
    const sub = randomUUID();
    const dos = await Promise.all([canje(t.firmar({ sub, kyros_pa: PA, acr: '1' })), canje(t.firmar({ sub, kyros_pa: PA, acr: '1' }))]);
    expect(dos.map((x) => x.status)).toEqual([200, 200]);
    expect(Number((await t.owner.query(`SELECT count(*)::int n FROM kyros_links WHERE sub = $1`, [sub])).rows[0].n)).toBe(1);
    expect((await canje(t.firmar({ kyros_pa: PA, acr: '1' }))).status).toBe(200);
    expect((await canje(t.firmar({ kyros_pa: PA, acr: '1' }))).status).toBe(403);
    expect(Number((await t.owner.query(`SELECT count(*)::int n FROM kyros_links WHERE origen = 'PLATAFORMA'`)).rows[0].n)).toBe(2);
    expect(await motivos()).toContain('tope');
  });

  it('la sesión central dura 60 min absolutos, hereda el tope al renovar y se corta con el interruptor apagado', async () => {
    await limpiar();
    await encender(true);
    const agente = supertest.agent(t.app.getHttpServer());
    const sub = randomUUID();
    const r = await agente.post('/api/v1/auth/kyros-id/sesion').send({ accessToken: t.firmar({ sub, kyros_pa: PA, acr: '1' }) });
    expect(r.status).toBe(200);
    const fila = (await t.owner.query(`SELECT central_hasta, expires_at FROM refresh_tokens WHERE kyros_sub = $1`, [sub])).rows[0];
    expect(new Date(fila.central_hasta).getTime() - Date.now()).toBeLessThanOrEqual(60 * 60_000);
    expect(new Date(fila.expires_at).getTime()).toBe(new Date(fila.central_hasta).getTime());
    const ok = await agente.post('/api/v1/auth/refrescar');
    expect(ok.status).toBe(200); expect(ok.body.usuario.esPlataforma).toBe(true);
    const ultimo = (await t.owner.query(`SELECT central_hasta FROM refresh_tokens WHERE kyros_sub = $1 ORDER BY issued_at DESC LIMIT 1`, [sub])).rows[0];
    expect(new Date(ultimo.central_hasta).getTime()).toBe(new Date(fila.central_hasta).getTime());   // no se extiende
    await encender(false);
    expect((await agente.post('/api/v1/auth/refrescar')).status).toBe(401);
    expect((await t.owner.query(`SELECT 1 FROM audit_log WHERE action = 'plataforma.sesion_central_revocada'`)).rowCount).toBeGreaterThan(0);
  });

  it('el usuario central no obtiene permisos extra: en una sucursal ajena solo lee', async () => {
    await limpiar();
    await encender(true);
    const a = await t.nuevoRestaurante('Soporte Central');
    const tok = (await canje(t.firmar({ kyros_pa: PA, acr: '1' }))).body.sesion.accessToken as string;
    expect((await t.con(tok, a.rid).get('/menu/platos')).status).toBe(200);
    expect((await t.con(tok, a.rid).post('/menu/platos', { nombre: 'X', precio: 1 })).status).toBe(403);
  });
});
