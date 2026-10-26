import { createSign, generateKeyPairSync, randomUUID } from 'node:crypto';
import { createServer, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { Pool } from 'pg';
import { crearApp } from '../src/main';
import { KyrosIdService } from '../src/kyros-id/kyros-id.service';

export const CLIENT = 'gestro-web';

/** App real + emisor de Kyros ID simulado (claves efímeras) + conexión de dueño para preparar datos. */
export async function levantar() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  let emisor = '';
  const srv: Server = createServer((req, res) => {
    if (req.url?.endsWith('/protocol/openid-connect/certs')) {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'k1', use: 'sig', alg: 'RS256' }] }));
    } else { res.statusCode = 404; res.end(); }
  });
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
  emisor = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/realms/kyros`;

  const firmar = (extra: Record<string, unknown> = {}) => {
    const ahora = Math.floor(Date.now() / 1000);
    const h = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'k1' })).toString('base64url');
    const p = Buffer.from(JSON.stringify({ iss: emisor, typ: 'Bearer', azp: CLIENT, aud: [CLIENT], sub: randomUUID(), jti: randomUUID(), iat: ahora, exp: ahora + 600, auth_time: ahora, ...extra })).toString('base64url');
    return `${h}.${p}.${createSign('RSA-SHA256').update(`${h}.${p}`).sign(privateKey).toString('base64url')}`;
  };

  const app = await crearApp();
  await app.listen(0, '127.0.0.1');
  const url = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  const owner = new Pool({ connectionString: process.env.BASE_DE_DATOS, max: 4 });
  await app.get(KyrosIdService).guardar({ activo: true, emisor, clientId: CLIENT, audiencia: CLIENT }, randomUUID());
  const api = () => request(app.getHttpServer());

  /** Abre un restaurante nuevo («Crear mi cuenta») y devuelve su dueño ya con sesión. */
  async function nuevoRestaurante(nombre = 'Casa Andina') {
    const sub = randomUUID();
    const canje = await api().post('/api/v1/auth/kyros-id/sesion').send({ accessToken: firmar({ sub }) });
    const reg = await api().post('/api/v1/auth/kyros-id/registro').send({ registroToken: canje.body.registroToken, nombre: 'Rosa Quispe', correo: `${randomUUID()}@t.bo`, restaurante: nombre, razonSocial: `${nombre} SRL` });
    return { token: reg.body.accessToken as string, rid: reg.body.sucursales[0].id as string, userId: reg.body.usuario.id as string, sub };
  }

  /** Persona del equipo de Kyros-Tech (is_platform_admin), vinculada a su Kyros ID, con sesión abierta. */
  async function nuevaPlataforma() {
    const sub = randomUUID();
    const u = (await owner.query(`INSERT INTO users (email, full_name, is_platform_admin) VALUES ($1,'Equipo Kyros',true) RETURNING id`, [`${randomUUID()}@kyros-tech.com`])).rows[0].id as string;
    await owner.query('INSERT INTO kyros_links (issuer, sub, user_id) VALUES ($1,$2,$3)', [emisor, sub, u]);
    const r = await api().post('/api/v1/auth/kyros-id/sesion').send({ accessToken: firmar({ sub }) });
    const token = r.body.sesion.accessToken as string;
    const pet = (m: 'get' | 'post' | 'put' | 'patch' | 'delete', ruta: string) => api()[m](`/api/v1${ruta}`).set('Authorization', `Bearer ${token}`);
    return { token, userId: u, sub, get: (ruta: string) => pet('get', ruta), post: (ruta: string, c?: object) => pet('post', ruta).send(c), patch: (ruta: string, c?: object) => pet('patch', ruta).send(c), put: (ruta: string, c?: object) => pet('put', ruta).send(c), del: (ruta: string) => pet('delete', ruta) };
  }

  /** Une a una persona invitada con su código y devuelve su sesión. */
  async function entrarConCodigo(codigo: string) {
    const canje = await api().post('/api/v1/auth/kyros-id/sesion').send({ accessToken: firmar() });
    const r = await api().post('/api/v1/auth/kyros-id/vincular').send({ registroToken: canje.body.registroToken, codigo });
    return { token: r.body.accessToken as string, userId: r.body.usuario?.id as string, status: r.status };
  }

  const con = (token: string, rid: string) => ({
    get: (ruta: string) => api().get(`/api/v1${ruta}`).set('Authorization', `Bearer ${token}`).set('X-Restaurant-Id', rid),
    post: (ruta: string, cuerpo?: object) => api().post(`/api/v1${ruta}`).set('Authorization', `Bearer ${token}`).set('X-Restaurant-Id', rid).send(cuerpo),
    put: (ruta: string, cuerpo?: object) => api().put(`/api/v1${ruta}`).set('Authorization', `Bearer ${token}`).set('X-Restaurant-Id', rid).send(cuerpo),
    patch: (ruta: string, cuerpo?: object) => api().patch(`/api/v1${ruta}`).set('Authorization', `Bearer ${token}`).set('X-Restaurant-Id', rid).send(cuerpo),
    del: (ruta: string) => api().delete(`/api/v1${ruta}`).set('Authorization', `Bearer ${token}`).set('X-Restaurant-Id', rid),
  });

  const cerrar = async () => { await app.close(); await owner.end(); srv.close(); };
  return { app, api, owner, url, firmar, nuevoRestaurante, nuevaPlataforma, entrarConCodigo, con, cerrar, emisor };
}
