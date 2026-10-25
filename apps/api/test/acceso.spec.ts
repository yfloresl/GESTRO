import { createHash, createSign, generateKeyPairSync, randomUUID } from 'node:crypto';
import { createServer, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Pool } from 'pg';
import { crearApp } from '../src/main';
import { ConfiguracionService } from '../src/configuracion/configuracion.service';
import { KyrosIdService } from '../src/kyros-id/kyros-id.service';

// ---- Emisor de Kyros ID simulado, con claves efímeras ----
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const KID = 'k1';
let emisorServer: Server;
let EMISOR = '';
const CLIENT = 'gestro-web';

function firmar(extra: Record<string, unknown> = {}, cabecera: Record<string, unknown> = {}) {
  const ahora = Math.floor(Date.now() / 1000);
  const h = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: KID, ...cabecera })).toString('base64url');
  const p = Buffer.from(JSON.stringify({
    iss: EMISOR, typ: 'Bearer', azp: CLIENT, aud: [CLIENT], sub: randomUUID(), jti: randomUUID(), iat: ahora, exp: ahora + 600, auth_time: ahora, ...extra,
  })).toString('base64url');
  const s = createSign('RSA-SHA256').update(`${h}.${p}`).sign(privateKey).toString('base64url');
  return `${h}.${p}.${s}`;
}

let app: Awaited<ReturnType<typeof crearApp>>;
let owner: Pool;
const api = () => request(app.getHttpServer());
const registro = (correo: string) => ({ nombre: 'Rosa Quispe', correo, restaurante: 'Casa Andina', razonSocial: 'Andina SRL', nit: '1020304050' });

async function entrarNuevo(sub = randomUUID(), correo = `${randomUUID()}@t.bo`) {
  const agente = request.agent(app.getHttpServer());
  const canje = await agente.post('/api/v1/auth/kyros-id/sesion').send({ accessToken: firmar({ sub }) });
  const reg = await agente.post('/api/v1/auth/kyros-id/registro').send({ registroToken: canje.body.registroToken, ...registro(correo) });
  return { agente, sub, canje, reg };
}

beforeAll(async () => {
  emisorServer = createServer((req, res) => {
    if (req.url?.endsWith('/protocol/openid-connect/certs')) {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: KID, use: 'sig', alg: 'RS256' }] }));
    } else { res.statusCode = 404; res.end(); }
  });
  await new Promise<void>((ok) => emisorServer.listen(0, '127.0.0.1', ok));
  EMISOR = `http://127.0.0.1:${(emisorServer.address() as AddressInfo).port}/realms/kyros`;

  app = await crearApp();
  await app.init();
  owner = new Pool({ connectionString: process.env.BASE_DE_DATOS, max: 3 });
  await app.get(KyrosIdService).guardar({ activo: true, emisor: EMISOR, clientId: CLIENT, audiencia: CLIENT }, randomUUID());
});
afterAll(async () => { await app.close(); await owner.end(); emisorServer.close(); });

describe('Kyros ID: canje del token', () => {
  it('config pública sin sesión', async () => {
    const r = await api().get('/api/v1/auth/kyros-id/config');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ activo: true, clientId: CLIENT, authorizationEndpoint: `${EMISOR}/protocol/openid-connect/auth` });
  });

  it('rechaza alg none, HS256, otro azp, otra aud, otro emisor, vencido y ID token', async () => {
    const malos = [
      firmar({}, { alg: 'none' }), firmar({}, { alg: 'HS256' }), firmar({ azp: 'otro' }), firmar({ aud: ['otro'] }),
      firmar({ iss: 'https://otro/realms/x' }), firmar({ exp: Math.floor(Date.now() / 1000) - 60 }), firmar({ typ: 'ID' }), firmar({ sub: '' }),
      firmar({}, { kid: 'desconocido' }), 'aaaaaaaaaa.bbbbbbbbbb.cccccccccc',
    ];
    for (const t of malos) expect((await api().post('/api/v1/auth/kyros-id/sesion').send({ accessToken: t })).status).toBe(401);
  });

  it('un jti se canjea una sola vez', async () => {
    const t = firmar({ jti: 'unico-1' });
    expect((await api().post('/api/v1/auth/kyros-id/sesion').send({ accessToken: t })).status).toBe(200);
    expect((await api().post('/api/v1/auth/kyros-id/sesion').send({ accessToken: t })).status).toBe(401);
  });
});

describe('Registro y vínculo', () => {
  it('identidad recién creada: abre su restaurante, queda vinculada y vuelve a entrar sin registrarse', async () => {
    const { agente, sub, canje, reg } = await entrarNuevo();
    expect(canje.body).toMatchObject({ estado: 'sin_vinculo', puedeRegistrarse: true });
    expect(reg.status).toBe(200);
    expect(reg.body.sucursales).toHaveLength(1);
    expect(reg.body.sucursales[0].roles).toEqual(['owner']);
    const cobro = await owner.query('SELECT billing_mode FROM restaurants WHERE id = $1', [reg.body.sucursales[0].id]);
    expect(cobro.rows[0].billing_mode).toBe('recibo'); // sin Servicio Fiscal, se opera con recibos
    expect((reg.headers['set-cookie'] as unknown as string[]).join(';')).toMatch(/gestro_rt=.*HttpOnly.*SameSite=Strict/i);
    const otra = await agente.post('/api/v1/auth/kyros-id/sesion').send({ accessToken: firmar({ sub }) });
    expect(otra.body.estado).toBe('sesion');
    expect(otra.body.sesion.sucursales[0].id).toBe(reg.body.sucursales[0].id);
  });

  it('identidad antigua no puede registrar un restaurante (solo «Crear mi cuenta»)', async () => {
    const viejo = Math.floor(Date.now() / 1000) - 3600;
    const canje = await api().post('/api/v1/auth/kyros-id/sesion').send({ accessToken: firmar({ auth_time: viejo }) });
    expect(canje.body.puedeRegistrarse).toBe(false);
    const r = await api().post('/api/v1/auth/kyros-id/registro').send({ registroToken: canje.body.registroToken, ...registro('viejo@t.bo') });
    expect(r.status).toBe(403);
  });

  it('el personal se vincula con el código de invitación, una sola vez, nunca por correo', async () => {
    const dueno = await entrarNuevo();
    const rid = dueno.reg.body.sucursales[0].id;
    const correo = `${randomUUID()}@t.bo`;
    const u = (await owner.query(`INSERT INTO users (email, full_name, account_id) VALUES ($1,'Mesero Uno',(SELECT account_id FROM restaurants WHERE id=$2)) RETURNING id`, [correo, rid])).rows[0].id;
    await owner.query(`INSERT INTO user_roles (restaurant_id, user_id, role_id) SELECT $1,$2,id FROM roles WHERE code='mesero'`, [rid, u]);
    const codigo = `inv-${randomUUID()}-${randomUUID()}`;
    await owner.query(`INSERT INTO user_invitations (user_id, token_hash, expires_at) VALUES ($1,$2, now() + interval '1 day')`, [u, createHash('sha256').update(codigo).digest('hex')]);

    // Un `sub` que tenga el MISMO correo no entra solo por eso.
    const sub = randomUUID();
    const c = await api().post('/api/v1/auth/kyros-id/sesion').send({ accessToken: firmar({ sub, email: correo, email_verified: true }) });
    expect(c.body.estado).toBe('sin_vinculo');
    const mal = await api().post('/api/v1/auth/kyros-id/vincular').send({ registroToken: c.body.registroToken, codigo: 'x'.repeat(40) });
    expect(mal.status).toBe(400);
    const bien = await api().post('/api/v1/auth/kyros-id/vincular').send({ registroToken: c.body.registroToken, codigo });
    expect(bien.status).toBe(200);
    expect(bien.body.sucursales[0].roles).toEqual(['mesero']);
    const repetido = await api().post('/api/v1/auth/kyros-id/vincular').send({ registroToken: c.body.registroToken, codigo });
    expect(repetido.status).toBe(400);
  });

  it('usuario desactivado con vínculo no entra', async () => {
    const { sub } = await entrarNuevo();
    await owner.query(`UPDATE users SET active = false WHERE id = (SELECT user_id FROM kyros_links WHERE sub = $1)`, [sub]);
    const r = await api().post('/api/v1/auth/kyros-id/sesion').send({ accessToken: firmar({ sub }) });
    expect(r.status).toBe(403);
  });
});

describe('Sesión: refresco rotativo y cierre global', () => {
  it('cada uso rota el refresco; reutilizar uno viejo revoca TODA la familia', async () => {
    const { reg } = await entrarNuevo();
    const cookie1 = (reg.headers['set-cookie'] as unknown as string[])[0].split(';')[0];
    const r2 = await api().post('/api/v1/auth/refrescar').set('Cookie', cookie1);
    expect(r2.status).toBe(200);
    const cookie2 = (r2.headers['set-cookie'] as unknown as string[])[0].split(';')[0];
    expect(cookie2).not.toBe(cookie1);
    // Carrera legítima (dos pestañas): el reuso inmediato se rechaza, pero NO revoca la sesión vigente.
    expect((await api().post('/api/v1/auth/refrescar').set('Cookie', cookie1)).status).toBe(401);
    const r3 = await api().post('/api/v1/auth/refrescar').set('Cookie', cookie2);
    expect(r3.status).toBe(200);
    const cookie3 = (r3.headers['set-cookie'] as unknown as string[])[0].split(';')[0];
    // Robo: el primero se reutiliza pasada la ventana de gracia.
    await owner.query(`UPDATE refresh_tokens SET used_at = now() - interval '1 minute' WHERE used_at IS NOT NULL AND family_id = (SELECT family_id FROM refresh_tokens ORDER BY issued_at DESC LIMIT 1)`);
    expect((await api().post('/api/v1/auth/refrescar').set('Cookie', cookie1)).status).toBe(401);
    // La familia completa quedó revocada, incluido el refresco legítimo más nuevo.
    expect((await api().post('/api/v1/auth/refrescar').set('Cookie', cookie3)).status).toBe(401);
  });

  it('salir revoca la sesión; back-channel logout revoca por sub', async () => {
    const { reg, sub } = await entrarNuevo();
    const cookie = (reg.headers['set-cookie'] as unknown as string[])[0].split(';')[0];
    const ahora = Math.floor(Date.now() / 1000);
    const h = Buffer.from(JSON.stringify({ alg: 'RS256', kid: KID })).toString('base64url');
    const p = Buffer.from(JSON.stringify({ iss: EMISOR, aud: CLIENT, iat: ahora, jti: randomUUID(), sub, events: { 'http://schemas.openid.net/event/backchannel-logout': {} } })).toString('base64url');
    const logout = `${h}.${p}.${createSign('RSA-SHA256').update(`${h}.${p}`).sign(privateKey).toString('base64url')}`;
    const r = await api().post('/api/v1/auth/kyros-id/backchannel-logout').type('form').send({ logout_token: logout });
    expect(r.status).toBe(200);
    expect((await api().post('/api/v1/auth/refrescar').set('Cookie', cookie)).status).toBe(401);
    expect((await api().post('/api/v1/auth/kyros-id/backchannel-logout').type('form').send({ logout_token: 'basura' })).status).toBe(400);
  });
});

describe('Guards de sucursal', () => {
  it('sin sesión 401; header ajeno o ausente 403; el rol decide; vencida = solo lectura (402)', async () => {
    const a = await entrarNuevo();
    const b = await entrarNuevo();
    const tokenA = a.reg.body.accessToken as string;
    const ridA = a.reg.body.sucursales[0].id as string;
    const ridB = b.reg.body.sucursales[0].id as string;
    const con = (m: 'get' | 'patch', rid?: string, t = tokenA) => { const q = api()[m]('/api/v1/sucursal').set('Authorization', `Bearer ${t}`); return rid ? q.set('X-Restaurant-Id', rid) : q; };

    expect((await api().get('/api/v1/sucursal')).status).toBe(401);
    expect((await con('get')).status).toBe(403);
    expect((await con('get', ridB)).status).toBe(403);
    const ok = await con('get', ridA);
    expect(ok.status).toBe(200);
    expect(ok.body.nombre).toBe('Casa Andina');

    expect((await con('patch', ridA).send({ name: 'Casa Andina Centro' })).status).toBe(200);
    expect((await con('patch', ridA).send({ name: 'Casa Andina Centro', extra: 1 })).status).toBe(400);
    const log = await owner.query(`SELECT action FROM audit_log WHERE restaurant_id = $1`, [ridA]);
    expect(log.rows.map((x) => x.action)).toContain('sucursal.renombrada');

    await owner.query(`UPDATE restaurants SET paid_until = current_date - 30 WHERE id = $1`, [ridA]);
    const vencida = await con('patch', ridA).send({ name: 'Otro' });
    expect(vencida.status).toBe(402);
    expect(vencida.body.code).toBe('SUBSCRIPTION_EXPIRED');
    expect((await con('get', ridA)).status).toBe(200);
  });

  it('un cajero no puede renombrar la sucursal; un token de otra audiencia no sirve', async () => {
    const d = await entrarNuevo();
    const rid = d.reg.body.sucursales[0].id as string;
    const u = (await owner.query(`INSERT INTO users (email, full_name) VALUES ($1,'Caja') RETURNING id`, [`${randomUUID()}@t.bo`])).rows[0].id;
    await owner.query(`INSERT INTO user_roles (restaurant_id, user_id, role_id) SELECT $1,$2,id FROM roles WHERE code='cajero'`, [rid, u]);
    const sub = randomUUID();
    await owner.query(`INSERT INTO kyros_links (issuer, sub, user_id) VALUES ($1,$2,$3)`, [EMISOR, sub, u]);
    const sesion = await api().post('/api/v1/auth/kyros-id/sesion').send({ accessToken: firmar({ sub }) });
    const t = sesion.body.sesion.accessToken as string;
    expect((await api().patch('/api/v1/sucursal').set('Authorization', `Bearer ${t}`).set('X-Restaurant-Id', rid).send({ name: 'Hack' })).status).toBe(403);
    expect((await api().get('/api/v1/sucursal').set('Authorization', `Bearer ${t}`).set('X-Restaurant-Id', rid)).status).toBe(200);
    // El token de registro (aud "registro") no abre la API de personal.
    const reg = await api().post('/api/v1/auth/kyros-id/sesion').send({ accessToken: firmar({}) });
    expect((await api().get('/api/v1/sucursal').set('Authorization', `Bearer ${reg.body.registroToken}`).set('X-Restaurant-Id', rid)).status).toBe(401);
  });

  it('salud y ready son públicos', async () => {
    expect((await api().get('/api/v1/salud')).status).toBe(200);
    expect((await api().get('/api/v1/ready')).status).toBe(200);
  });

  it('la configuración queda cifrada en la base', async () => {
    await app.get(ConfiguracionService).guardar('prueba', { clave: 'sk-ultra-secreta' }, null);
    const r = await owner.query(`SELECT valor_cifrado FROM app_config WHERE clave = 'prueba'`);
    expect(r.rows[0].valor_cifrado).not.toContain('sk-ultra-secreta');
    expect(await app.get(ConfiguracionService).leer('prueba')).toEqual({ clave: 'sk-ultra-secreta' });
  });
});
