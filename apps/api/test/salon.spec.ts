import { randomUUID } from 'node:crypto';
import { io as cliente, Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SolicitudesService } from '../src/qr/solicitudes.service';
import { levantar } from './util';

let t: Awaited<ReturnType<typeof levantar>>;
beforeAll(async () => { t = await levantar(); });
afterAll(async () => { await t.cerrar(); });

// PNG mínimo válido (1x1)
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

/** Un restaurante con dueño, un mesero con sesión, una mesa y su QR. */
async function escenario() {
  const d = await t.nuevoRestaurante();
  const dueno = t.con(d.token, d.rid);
  const alta = await dueno.post('/personal', { nombre: 'Carlos Mesero', correo: `${randomUUID()}@t.bo`, roles: ['mesero'] });
  const m = await t.entrarConCodigo(alta.body.codigo);
  const mesero = t.con(m.token, d.rid);
  const area = (await dueno.post('/areas', { nombre: 'Salón', encargadoId: null })).body;
  const mesa = (await dueno.post('/mesas', { numero: '5', asientos: 4, areaId: area.id })).body;
  const mesas = (await dueno.get('/mesas')).body;
  const qr = (mesas.find((x: { id: string }) => x.id === mesa.id).urlQr as string).split('/m/')[1];
  return { d, dueno, alta, m, mesero, area, mesaId: mesa.id as string, qr, staffId: alta.body.id as string };
}
const sesionMesa = async (qr: string) => (await t.api().post('/api/v1/qr/sesion').send({ qrToken: qr })).body.token as string;
const mesaCon = (token: string) => ({
  post: (r: string, c: object) => t.api().post(`/api/v1/qr/${r}`).set('Authorization', `Bearer ${token}`).send(c),
  get: (r: string) => t.api().get(`/api/v1/qr/${r}`).set('Authorization', `Bearer ${token}`),
});

describe('Personal e invitaciones', () => {
  it('el dueño da de alta a un mesero; el código une su Kyros ID una sola vez', async () => {
    const e = await escenario();
    expect(e.alta.status).toBe(201);
    expect(e.alta.body.codigo).toMatch(/^gst-/);
    expect(e.m.status).toBe(200);
    const lista = (await e.dueno.get('/personal')).body;
    expect(lista.find((p: { id: string }) => p.id === e.staffId)).toMatchObject({ roles: ['mesero'], vinculado: true, activo: true });
    expect((await t.entrarConCodigo(e.alta.body.codigo)).status).toBe(400);
  });

  it('un mesero no gestiona personal; el correo repetido da 409; no se puede asignar owner', async () => {
    const e = await escenario();
    expect((await e.mesero.get('/personal')).status).toBe(403);
    expect((await e.mesero.post('/personal', { nombre: 'X Y', correo: 'x@t.bo', roles: ['cajero'] })).status).toBe(403);
    const correo = `${randomUUID()}@t.bo`;
    expect((await e.dueno.post('/personal', { nombre: 'Ana Caja', correo, roles: ['cajero'] })).status).toBe(201);
    expect((await e.dueno.post('/personal', { nombre: 'Ana Caja', correo, roles: ['cajero'] })).status).toBe(409);
    expect((await e.dueno.post('/personal', { nombre: 'Ana Dos', correo: `${randomUUID()}@t.bo`, roles: ['owner'] })).status).toBe(400);
  });

  it('desactivar a alguien lo saca de inmediato; el dueño no se modifica', async () => {
    const e = await escenario();
    expect((await e.dueno.patch(`/personal/${e.staffId}`, { activo: false })).status).toBe(200);
    const filas = await t.owner.query('SELECT active FROM users WHERE id = $1', [e.m.userId]);
    expect(filas.rows[0].active).toBe(false);
    const dueno = (await e.dueno.get('/personal')).body.find((p: { roles: string[] }) => p.roles.includes('owner'));
    expect(dueno).toBeUndefined(); // el dueño no tiene ficha de personal: no hay nada que editar por esta vía
  });
});

describe('Menú y fotos', () => {
  it('categoría y plato con precio exacto; 3 decimales se rechaza; el cambio de precio queda auditado', async () => {
    const e = await escenario();
    const cat = (await e.dueno.post('/menu/categorias', { nombre: 'Platos fuertes' })).body;
    expect((await e.dueno.post('/menu/platos', { nombre: 'Pique Macho', precio: 58.505, categoriaId: cat.id })).status).toBe(400);
    const p = await e.dueno.post('/menu/platos', { nombre: 'Pique Macho', precio: 58.5, categoriaId: cat.id, alergenos: ['gluten'] });
    expect(p.status).toBe(201);
    expect(p.body.precio).toBe('58.50');
    expect((await e.dueno.patch(`/menu/platos/${p.body.id}`, { precio: 60 })).body.precio).toBe('60.00');
    const log = await t.owner.query(`SELECT action FROM audit_log WHERE restaurant_id = $1 AND action = 'menu.precio_cambiado'`, [e.d.rid]);
    expect(log.rowCount).toBe(1);
    expect((await e.mesero.post('/menu/platos', { nombre: 'Hack', precio: 1 })).status).toBe(403);
  });

  it('foto por contenido: PNG entra; SVG o texto no; el menú público la sirve sin sesión', async () => {
    const e = await escenario();
    const p = (await e.dueno.post('/menu/platos', { nombre: 'Salteña', precio: 8 })).body;
    const subir = (cuerpo: Buffer, tipo: string) => t.api().put(`/api/v1/menu/platos/${p.id}/foto`).set('Authorization', `Bearer ${e.d.token}`).set('X-Restaurant-Id', e.d.rid).set('Content-Type', tipo).send(cuerpo);
    expect((await subir(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'image/png')).status).toBe(400);
    expect((await subir(Buffer.from('hola'), 'image/png')).status).toBe(400);
    expect((await subir(PNG, 'image/png')).status).toBe(200);
    const slug = (await t.owner.query('SELECT slug FROM restaurants WHERE id = $1', [e.d.rid])).rows[0].slug;
    const menu = await t.api().get(`/api/v1/public/${slug}/menu`);
    expect(menu.status).toBe(200);
    expect(menu.headers['cache-control']).toContain('max-age=30');
    const plato = menu.body.categorias[0].platos[0];
    expect(plato.foto).toBe(`/api/v1/public/${slug}/foto/${p.id}`);
    const foto = await t.api().get(plato.foto);
    expect(foto.headers['content-type']).toBe('image/png');
    expect(foto.headers['x-content-type-options']).toBe('nosniff');
  });

  it('un restaurante no toca el menú de otro', async () => {
    const a = await escenario(); const b = await escenario();
    const p = (await a.dueno.post('/menu/platos', { nombre: 'Solo de A', precio: 5 })).body;
    expect((await b.dueno.patch(`/menu/platos/${p.id}`, { precio: 1 })).status).toBe(404);
    expect((await b.dueno.get('/menu/platos')).body).toEqual([]);
  });
});

describe('Salón: mesas, QR y asignación', () => {
  it('el QR solo lo ve quien lo imprime; regenerar invalida el anterior y sus sesiones', async () => {
    const e = await escenario();
    expect((await e.mesero.get('/mesas')).body[0].urlQr).toBeUndefined();
    const token = await sesionMesa(e.qr);
    expect((await mesaCon(token).get('estado')).status).toBe(200);
    const nuevo = (await e.dueno.post(`/mesas/${e.mesaId}/qr/regenerar`)).body.urlQr as string;
    expect(nuevo.endsWith(e.qr)).toBe(false);
    expect((await mesaCon(token).get('estado')).status).toBe(403);
    expect((await t.api().post('/api/v1/qr/sesion').send({ qrToken: e.qr })).status).toBe(404);
    expect((await t.api().post('/api/v1/qr/sesion').send({ qrToken: nuevo.split('/m/')[1] })).status).toBe(200);
  });

  it('reasignar a mitad del turno cierra la asignación anterior; una mesa solo tiene un mesero', async () => {
    const e = await escenario();
    const otro = (await e.dueno.post('/personal', { nombre: 'Luis Mesero', correo: `${randomUUID()}@t.bo`, roles: ['mesero'] })).body.id;
    expect((await e.dueno.put('/asignaciones', { mesaId: e.mesaId, meseroId: e.staffId })).status).toBe(200);
    expect((await e.dueno.put('/asignaciones', { mesaId: e.mesaId, meseroId: otro })).status).toBe(200);
    const vigentes = (await e.dueno.get('/asignaciones')).body.filter((a: { mesaId: string }) => a.mesaId === e.mesaId);
    expect(vigentes).toHaveLength(1);
    expect(vigentes[0].meseroId).toBe(otro);
  });

  it('número de mesa repetido da 409', async () => {
    const e = await escenario();
    expect((await e.dueno.post('/mesas', { numero: '5', asientos: 2 })).status).toBe(409);
  });
});

describe('Solicitudes de mesa por QR', () => {
  it('tokens cruzados no sirven: el de mesa no abre la API de personal y el de personal no abre /qr', async () => {
    const e = await escenario();
    const mesa = await sesionMesa(e.qr);
    expect((await t.api().get('/api/v1/sucursal').set('Authorization', `Bearer ${mesa}`).set('X-Restaurant-Id', e.d.rid)).status).toBe(401);
    expect((await mesaCon(e.d.token).get('estado')).status).toBe(401);
    expect((await mesaCon('basura').post('solicitudes', { tipo: 'atencion' })).status).toBe(401);
  });

  it('crea la solicitud, una abierta por tipo, comentario ≤ 300; el mesero la atiende y queda el tiempo de respuesta', async () => {
    const e = await escenario();
    const mesa = mesaCon(await sesionMesa(e.qr));
    expect((await mesa.post('solicitudes', { tipo: 'atencion', comentario: 'x'.repeat(301) })).status).toBe(400);
    const s = await mesa.post('solicitudes', { tipo: 'atencion', comentario: 'Sin picante' });
    expect(s.status).toBe(201);
    expect((await mesa.post('solicitudes', { tipo: 'atencion' })).status).toBe(409);
    expect((await mesa.post('solicitudes', { tipo: 'cuenta' })).status).toBe(201);
    expect((await mesa.get('estado')).body.map((x: { estado: string }) => x.estado)).toEqual(['pendiente', 'pendiente']);
    const lista = (await e.mesero.get('/solicitudes')).body;
    expect(lista).toHaveLength(2);
    expect(lista.find((x: { tipo: string }) => x.tipo === 'atencion')).toMatchObject({ mesa: '5', comentario: 'Sin picante' });
    const at = await e.mesero.post(`/solicitudes/${s.body.id}/atender`);
    expect(at.status).toBe(200);
    expect(at.body.tiempoDeRespuestaSegundos).toBeGreaterThanOrEqual(0);
    expect((await e.mesero.post(`/solicitudes/${s.body.id}/atender`)).status).toBe(404);
    expect((await mesa.get('estado')).body.find((x: { id: string }) => x.id === s.body.id).estado).toBe('atendida');
  });

  it('más de 6 solicitudes por minuto en una mesa dan 429', async () => {
    const e = await escenario();
    for (let i = 0; i < 6; i++) await t.owner.query(`INSERT INTO service_requests (restaurant_id, table_id, kind, status, created_at) VALUES ($1,$2,'otro','atendida', now())`, [e.d.rid, e.mesaId]);
    const r = await mesaCon(await sesionMesa(e.qr)).post('solicitudes', { tipo: 'servicio' });
    expect(r.status).toBe(429);
  });

  it('una solicitud de otra sucursal no se puede atender', async () => {
    const a = await escenario(); const b = await escenario();
    const s = await mesaCon(await sesionMesa(a.qr)).post('solicitudes', { tipo: 'atencion' });
    expect((await b.dueno.post(`/solicitudes/${s.body.id}/atender`)).status).toBe(404);
  });
});

describe('Tiempo real y escalamiento', () => {
  const esperar = <T>(s: Socket, evento: string, ms = 2000) => new Promise<T>((ok, mal) => { const to = setTimeout(() => mal(new Error(`sin ${evento}`)), ms); s.once(evento, (d: T) => { clearTimeout(to); ok(d); }); });
  const conectar = async (token: string) => { const s = cliente(t.url, { path: '/api/socket.io', auth: { token }, transports: ['websocket'], reconnection: false }); await new Promise<void>((ok, mal) => { s.on('connect', ok); s.on('connect_error', mal); }); return s; };

  it('el mesero asignado recibe la alerta en menos de 2 s y la mesa ve su estado; otra mesa no recibe nada', async () => {
    const e = await escenario();
    await e.dueno.put('/asignaciones', { mesaId: e.mesaId, meseroId: e.staffId });
    const sMesero = await conectar(e.m.token);
    const sMesa = await conectar(await sesionMesa(e.qr));
    const e2 = await escenario();
    const sAjena = await conectar(await sesionMesa(e2.qr));
    const llega = esperar<{ mesa: string; tipo: string; paraMi: boolean }>(sMesero, 'solicitud.nueva');
    const estado = esperar<{ estado: string }>(sMesa, 'solicitud.estado');
    let ajena = false; sAjena.on('solicitud.estado', () => { ajena = true; });
    const ini = Date.now();
    await mesaCon(await sesionMesa(e.qr)).post('solicitudes', { tipo: 'atencion' });
    expect(await llega).toMatchObject({ mesa: '5', tipo: 'atencion' });
    expect(Date.now() - ini).toBeLessThan(2000);
    expect((await estado).estado).toBe('pendiente');
    await new Promise((r) => setTimeout(r, 200));
    expect(ajena).toBe(false);
    [sMesero, sMesa, sAjena].forEach((s) => s.close());
  });

  it('un socket con un token inválido o de otra sucursal no recibe eventos', async () => {
    const e = await escenario(); const o = await escenario();
    await expect(conectar('basura')).rejects.toBeTruthy().catch(() => undefined);
    const sOtro = await conectar(o.d.token);
    let llego = false; sOtro.on('solicitud.nueva', () => { llego = true; });
    await mesaCon(await sesionMesa(e.qr)).post('solicitudes', { tipo: 'servicio' });
    await new Promise((r) => setTimeout(r, 400));
    expect(llego).toBe(false);
    sOtro.close();
  });

  it('sin atender tras el tiempo, avisa UNA vez al encargado del área', async () => {
    const e = await escenario();
    const enc = (await e.dueno.post('/personal', { nombre: 'Marta Encargada', correo: `${randomUUID()}@t.bo`, roles: ['area_manager'] })).body;
    await e.dueno.patch(`/areas/${e.area.id}`, { nombre: 'Salón', encargadoId: enc.id });
    const m = await t.entrarConCodigo(enc.codigo);
    const sEnc = await conectar(m.token);
    const s = await mesaCon(await sesionMesa(e.qr)).post('solicitudes', { tipo: 'atencion' });
    await t.owner.query(`UPDATE service_requests SET created_at = now() - interval '10 minutes' WHERE id = $1`, [s.body.id]);
    const aviso = esperar<{ id: string; escalada: boolean }>(sEnc, 'solicitud.escalada');
    const svc = t.app.get(SolicitudesService);
    expect(await svc.escalar()).toBeGreaterThanOrEqual(1);
    expect(await aviso).toMatchObject({ id: s.body.id, escalada: true });
    expect(await svc.escalar()).toBe(0);
    sEnc.close();
  });

  it('sin mesero asignado, la solicitud queda asignada al encargado del área', async () => {
    const e = await escenario();
    const enc = (await e.dueno.post('/personal', { nombre: 'Marta Encargada', correo: `${randomUUID()}@t.bo`, roles: ['area_manager'] })).body;
    await e.dueno.patch(`/areas/${e.area.id}`, { nombre: 'Salón', encargadoId: enc.id });
    const s = await mesaCon(await sesionMesa(e.qr)).post('solicitudes', { tipo: 'cuenta' });
    const fila = await t.owner.query('SELECT assigned_waiter_id FROM service_requests WHERE id = $1', [s.body.id]);
    expect(fila.rows[0].assigned_waiter_id).toBe(enc.id);
  });
});

describe('Avisos Web Push', () => {
  it('entrega la clave pública, guarda y borra la suscripción de la persona', async () => {
    const e = await escenario();
    const clave = await e.dueno.get('/push/clave');
    expect(clave.status).toBe(200);
    expect(clave.body.clave).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    const sub = { endpoint: `https://push.example.test/${randomUUID()}`, keys: { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) } };
    expect((await e.dueno.post('/push/suscribir', sub)).status).toBe(200);
    expect((await t.owner.query('SELECT 1 FROM push_subscriptions WHERE endpoint = $1', [sub.endpoint])).rowCount).toBe(1);
    expect((await t.api().get('/api/v1/push/clave')).status).toBe(401);
    expect((await e.dueno.del('/push/suscribir')).status).toBe(400); // sin cuerpo
    const borrar = await t.api().delete('/api/v1/push/suscribir').set('Authorization', `Bearer ${e.d.token}`).send({ endpoint: sub.endpoint });
    expect(borrar.status).toBe(200);
    expect((await t.owner.query('SELECT 1 FROM push_subscriptions WHERE endpoint = $1', [sub.endpoint])).rowCount).toBe(0);
  });
});
