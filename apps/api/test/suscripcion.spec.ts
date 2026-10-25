import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SuscripcionService } from '../src/suscripcion/suscripcion.service';
import { levantar } from './util';

let t: Awaited<ReturnType<typeof levantar>>;
beforeAll(async () => { t = await levantar(); });
afterAll(async () => { await t.cerrar(); });

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const subir = (token: string, rid: string | null, ruta: string, cuerpo: Buffer | string, tipo = 'image/png') => {
  const q = t.api().put(`/api/v1${ruta}`).set('Authorization', `Bearer ${token}`).set('Content-Type', tipo);
  return (rid ? q.set('X-Restaurant-Id', rid) : q).send(cuerpo);
};

async function escenario() {
  const d = await t.nuevoRestaurante();
  const dueno = t.con(d.token, d.rid);
  const kyros = await t.nuevaPlataforma();
  const plan = (await kyros.post('/plataforma/planes', { codigo: `P${randomUUID().slice(0, 6)}`, nombre: 'Plan B', precioMensual: 200 })).body.id as string;
  await kyros.patch(`/plataforma/sucursales/${d.rid}`, { planId: plan, motivo: 'alta del plan' });
  return { d, dueno, kyros, plan };
}
const ref = () => `REF-${randomUUID().slice(0, 8)}`;
type E = Awaited<ReturnType<typeof escenario>>;
async function pagoConVoucher(e: E, meses: number, monto: number) {
  const p = await e.dueno.post('/suscripcion/pagos', { meses, monto, referencia: ref(), banco: 'Banco Unión' });
  await subir(e.d.token, e.d.rid, `/suscripcion/pagos/${p.body.id}/voucher`, PNG);
  return p.body as { id: string; mesesDeRegalo: number };
}

describe('Consola de plataforma', () => {
  it('solo el equipo de Kyros-Tech entra; un dueño de restaurante no', async () => {
    const e = await escenario();
    expect((await t.api().get('/api/v1/plataforma/pagos').set('Authorization', `Bearer ${e.d.token}`)).status).toBe(403);
    expect((await e.kyros.get('/plataforma/pagos')).status).toBe(200);
    expect((await t.api().get('/api/v1/plataforma/pagos')).status).toBe(401);
  });

  it('planes y promociones: el cálculo aplica la mejor promoción vigente', async () => {
    const e = await escenario();
    const hoy = (await t.owner.query(`SELECT (now() AT TIME ZONE 'America/La_Paz')::date::text AS d, ((now() AT TIME ZONE 'America/La_Paz')::date + 30)::text AS h`)).rows[0];
    expect((await e.kyros.post('/plataforma/promociones', { nombre: 'Mal', mesesRequeridos: 3, mesesDeRegalo: 1, descuentoPct: 10, desde: hoy.h, hasta: hoy.d })).status).toBe(400);
    const promo = await e.kyros.post('/plataforma/promociones', { nombre: 'Paga 3, lleva 4', mesesRequeridos: 3, mesesDeRegalo: 1, descuentoPct: 10, desde: hoy.d, hasta: hoy.h });
    expect(promo.status).toBe(201);
    const tres = (await e.dueno.get('/suscripcion/calculo?meses=3')).body;
    expect(tres).toMatchObject({ meses: 3, precioMensual: '200.00', montoEsperado: '540.00', promocion: { nombre: 'Paga 3, lleva 4', mesesDeRegalo: 1 } });
    const dos = (await e.dueno.get('/suscripcion/calculo?meses=2')).body;
    expect(dos.montoEsperado).toBe('400.00'); expect(dos.promocion).toBeNull();
    await e.kyros.patch(`/plataforma/promociones/${promo.body.id}`, { nombre: 'Paga 3, lleva 4', mesesRequeridos: 3, mesesDeRegalo: 1, descuentoPct: 10, desde: hoy.d, hasta: hoy.h, activa: false });
    expect((await e.dueno.get('/suscripcion/calculo?meses=3')).body.promocion).toBeNull();
    expect((await e.dueno.get('/suscripcion/calculo?meses=0')).status).toBe(400);
  });
});

describe('Pago de la suscripción (voucher manual)', () => {
  it('el restaurante declara el pago; una referencia repetida da 409; el voucher se valida por su contenido', async () => {
    const e = await escenario();
    const r = ref();
    expect((await e.dueno.post('/suscripcion/pagos', { meses: 1, monto: 200.505, referencia: r })).status).toBe(400);
    const p = await e.dueno.post('/suscripcion/pagos', { meses: 1, monto: 200, referencia: r, banco: 'BNB' });
    expect(p.status).toBe(201);
    expect((await e.dueno.post('/suscripcion/pagos', { meses: 1, monto: 200, referencia: r })).status).toBe(409);
    expect((await subir(e.d.token, e.d.rid, `/suscripcion/pagos/${p.body.id}/voucher`, '<svg xmlns="http://www.w3.org/2000/svg"/>')).status).toBe(400);
    expect((await subir(e.d.token, e.d.rid, `/suscripcion/pagos/${p.body.id}/voucher`, PNG)).status).toBe(200);
    const mia = (await e.dueno.get('/suscripcion')).body;
    expect(mia.pagos[0]).toMatchObject({ meses: 1, monto: '200.00', esperado: '200.00', estado: 'pendiente', tieneVoucher: true });
    expect((await t.api().get(`/api/v1/suscripcion/pagos/${p.body.id}/voucher`).set('Authorization', `Bearer ${e.d.token}`).set('X-Restaurant-Id', e.d.rid)).headers['content-type']).toBe('image/png');
    const otro = await t.nuevoRestaurante();
    expect((await t.api().get(`/api/v1/suscripcion/pagos/${p.body.id}/voucher`).set('Authorization', `Bearer ${otro.token}`).set('X-Restaurant-Id', otro.rid)).status).toBe(404);
  });

  it('aprobar: sin voucher no; con voucher habilita desde max(hoy, vencimiento+1) por meses pagados + regalo; no se aprueba dos veces', async () => {
    const e = await escenario();
    const hoy = (await t.owner.query(`SELECT (now() AT TIME ZONE 'America/La_Paz')::date::text AS d, ((now() AT TIME ZONE 'America/La_Paz')::date + 60)::text AS h`)).rows[0];
    await e.kyros.post('/plataforma/promociones', { nombre: 'Regalo', mesesRequeridos: 3, mesesDeRegalo: 1, descuentoPct: 0, desde: hoy.d, hasta: hoy.h });
    const sin = await e.dueno.post('/suscripcion/pagos', { meses: 3, monto: 600, referencia: ref() });
    expect((await e.kyros.post(`/plataforma/pagos/${sin.body.id}/aprobar`)).status).toBe(400); // todavía sin comprobante
    const antes = (await t.owner.query('SELECT paid_until::text AS h FROM restaurants WHERE id = $1', [e.d.rid])).rows[0].h as string;
    await subir(e.d.token, e.d.rid, `/suscripcion/pagos/${sin.body.id}/voucher`, PNG);
    const lista = (await e.kyros.get('/plataforma/pagos?estado=pendiente')).body as { id: string; coincide: boolean; mesesDeRegalo: number }[];
    expect(lista.find((x) => x.id === sin.body.id)).toMatchObject({ coincide: true, mesesDeRegalo: 1 });
    const ok = await e.kyros.post(`/plataforma/pagos/${sin.body.id}/aprobar`);
    expect(ok.status).toBe(200);
    const esperado = (await t.owner.query(`SELECT (($1::date + 1 + make_interval(months => 4))::date - 1)::text AS h`, [antes])).rows[0].h;
    expect(ok.body.hasta).toBe(esperado);
    expect((await t.owner.query('SELECT paid_until::text AS h FROM restaurants WHERE id = $1', [e.d.rid])).rows[0].h).toBe(esperado);
    expect((await e.kyros.post(`/plataforma/pagos/${sin.body.id}/aprobar`)).status).toBe(409);
    const log = await t.owner.query(`SELECT user_id FROM audit_log WHERE restaurant_id = $1 AND action = 'suscripcion.pago_aprobado'`, [e.d.rid]);
    expect(log.rows[0].user_id).toBe(e.kyros.userId);
    expect((await e.dueno.post(`/plataforma/pagos/${sin.body.id}/aprobar`)).status).toBe(403); // el dueño del restaurante no valida sus propios pagos
  });

  it('rechazar exige motivo y avisa; la misma referencia se puede volver a usar', async () => {
    const e = await escenario();
    const p = await pagoConVoucher(e, 1, 150);
    expect((await e.kyros.post(`/plataforma/pagos/${p.id}/rechazar`, {})).status).toBe(400);
    expect((await e.kyros.post(`/plataforma/pagos/${p.id}/rechazar`, { motivo: 'El monto no coincide' })).status).toBe(200);
    expect((await e.kyros.post(`/plataforma/pagos/${p.id}/aprobar`)).status).toBe(409);
    const mia = (await e.dueno.get('/suscripcion')).body;
    expect(mia.pagos[0]).toMatchObject({ estado: 'rechazado', motivo: 'El monto no coincide' });
    const fila = await t.owner.query('SELECT bank_reference FROM subscription_payments WHERE id = $1', [p.id]);
    expect((await e.dueno.post('/suscripcion/pagos', { meses: 1, monto: 200, referencia: fila.rows[0].bank_reference })).status).toBe(201);
  });

  it('vencida: la sucursal queda en solo lectura pero puede pagar; al aprobar vuelve a escribir', async () => {
    const e = await escenario();
    await t.owner.query(`UPDATE restaurants SET paid_until = (now() AT TIME ZONE 'America/La_Paz')::date - 30 WHERE id = $1`, [e.d.rid]);
    const mia = (await e.dueno.get('/suscripcion')).body;
    expect(mia.estado).toBe('vencida'); expect(mia.diasRestantes).toBeLessThan(0);
    expect((await e.dueno.post('/menu/categorias', { nombre: 'X' })).status).toBe(402);
    expect((await e.dueno.get('/menu/categorias')).status).toBe(200);
    const p = await pagoConVoucher(e, 1, 200);
    expect((await e.kyros.post(`/plataforma/pagos/${p.id}/aprobar`)).status).toBe(200);
    expect((await e.dueno.post('/menu/categorias', { nombre: 'Ya puedo escribir' })).status).toBe(201);
    expect((await e.dueno.get('/suscripcion')).body.diasRestantes).toBeGreaterThan(0);
  });

  it('un mesero no ve ni paga la suscripción', async () => {
    const e = await escenario();
    const a = await e.dueno.post('/personal', { nombre: 'Carlos Mesero', correo: `${randomUUID()}@t.bo`, roles: ['mesero'] });
    const m = await t.entrarConCodigo(a.body.codigo);
    expect((await t.con(m.token, e.d.rid).get('/suscripcion')).status).toBe(403);
    expect((await t.con(m.token, e.d.rid).post('/suscripcion/pagos', { meses: 1, monto: 1, referencia: 'ABC123' })).status).toBe(403);
  });

  it('QR e instrucciones de cobro: las carga la plataforma y las ve el restaurante', async () => {
    const e = await escenario();
    expect((await e.kyros.put('/plataforma/cobro', { instrucciones: 'Paga al QR y sube tu comprobante.' })).status).toBe(200);
    expect((await subir(e.kyros.token, null, '/plataforma/cobro/qr', PNG)).status).toBe(200);
    const mia = (await e.dueno.get('/suscripcion')).body;
    expect(mia.cobro).toEqual({ instrucciones: 'Paga al QR y sube tu comprobante.', tieneQr: true });
    const qr = await t.api().get('/api/v1/suscripcion/cobro/qr').set('Authorization', `Bearer ${e.d.token}`).set('X-Restaurant-Id', e.d.rid);
    expect(qr.headers['content-type']).toBe('image/png');
    expect((await subir(e.d.token, e.d.rid, '/plataforma/cobro/qr', PNG)).status).toBe(403);
  });

  it('avisos de vencimiento: salen una sola vez por sucursal y fecha (5 días, 1 día y el día)', async () => {
    const e = await escenario();
    const svc = t.app.get(SuscripcionService);
    for (const dias of [5, 1, 0]) {
      await t.owner.query(`UPDATE restaurants SET paid_until = (now() AT TIME ZONE 'America/La_Paz')::date + $2::int WHERE id = $1`, [e.d.rid, dias]);
      await svc.avisarVencimientos();
      await svc.avisarVencimientos(); // el segundo no repite
    }
    const n = await t.owner.query(`SELECT kind FROM subscription_notices WHERE restaurant_id = $1 ORDER BY kind`, [e.d.rid]);
    expect(n.rows.map((r) => r.kind)).toEqual(['d0', 'd1', 'd5']);
  });

  it('ajuste manual de plataforma: exige motivo y queda auditado', async () => {
    const e = await escenario();
    expect((await e.kyros.patch(`/plataforma/sucursales/${e.d.rid}`, { estado: 'suspendido' })).status).toBe(400);
    expect((await e.kyros.patch(`/plataforma/sucursales/${e.d.rid}`, { estado: 'suspendido', motivo: 'falta de pago' })).status).toBe(200);
    const lista = (await e.kyros.get('/plataforma/sucursales')).body as { id: string; estado: string }[];
    expect(lista.find((s) => s.id === e.d.rid)?.estado).toBe('suspendido');
    const log = await t.owner.query(`SELECT 1 FROM audit_log WHERE restaurant_id = $1 AND action = 'plataforma.sucursal_ajustada'`, [e.d.rid]);
    expect(log.rowCount).toBeGreaterThan(0);
  });
});

describe('Tarjeta del Portal Kyros (portal/summary y portal/account)', () => {
  const portal = (sub: string, extra: Record<string, unknown> = {}) => t.firmar({ sub, azp: 'portal-web', aud: ['gestro-portal'], ...extra });
  const pedir = (ruta: string, token?: string, origen?: string) => { let q = t.api().get(`/api/v1/portal/${ruta}`); if (token) q = q.set('Authorization', `Bearer ${token}`); if (origen) q = q.set('Origin', origen); return q; };

  it('con el token del Portal devuelve el resumen del usuario vinculado, sin caché y con CORS solo para el Portal', async () => {
    const e = await escenario();
    const r = await pedir('summary', portal(e.d.sub), 'https://portal.kyros-tech.com');
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.headers['access-control-allow-origin']).toBe('https://portal.kyros-tech.com');
    expect(r.body).toMatchObject({ vinculado: true, nombreMostrado: 'Rosa Quispe', rol: 'Dueño' });
    expect(r.body.entrar).toMatch(/\/entrar$/);
    expect(r.body.tableros.map((x: { etiqueta: string }) => x.etiqueta)).toEqual(['Llamados de mesa', 'Pedidos en curso', 'Suscripción']);
    expect(r.body.perfiles).toHaveLength(1);
    expect(JSON.stringify(r.body)).not.toMatch(/correo|@t\.bo|telefono/); // sin datos personales
    expect((await pedir('summary', portal(e.d.sub), 'https://evil.example')).headers['access-control-allow-origin']).toBeUndefined();
    const pre = await t.api().options('/api/v1/portal/summary').set('Origin', 'https://portal.kyros-tech.com');
    expect(pre.status).toBe(204); expect(pre.headers['access-control-allow-origin']).toBe('https://portal.kyros-tech.com');
  });

  it('refleja lo pendiente: llamados sin atender y suscripción por vencer', async () => {
    const e = await escenario();
    const mesa = (await e.dueno.post('/mesas', { numero: '1', asientos: 2 })).body.id;
    await t.owner.query(`INSERT INTO service_requests (restaurant_id, table_id, kind) VALUES ($1,$2,'atencion')`, [e.d.rid, mesa]);
    await t.owner.query(`UPDATE restaurants SET paid_until = (now() AT TIME ZONE 'America/La_Paz')::date + 3 WHERE id = $1`, [e.d.rid]);
    const r = await pedir('summary', portal(e.d.sub));
    const p = r.body.pendientes as { etiqueta: string; cantidad: number; urgencia: string; destino: string }[];
    expect(p.find((x) => x.etiqueta.startsWith('Llamados'))).toMatchObject({ cantidad: 1, destino: '/app/salon' });
    expect(p.find((x) => x.etiqueta === 'Suscripción por vencer')).toMatchObject({ urgencia: 'atencion', destino: '/app/suscripcion' });
    expect(r.body.proximos[0]).toMatchObject({ titulo: 'Vence la suscripción', destino: '/app/suscripcion' });
  });

  it('account lista las suscripciones del titular y manda a «Mi suscripción»; un mesero no las ve', async () => {
    const e = await escenario();
    const c = await pedir('account', portal(e.d.sub));
    expect(c.status).toBe(200);
    expect(c.body).toMatchObject({ vinculado: true, estadoCuenta: 'ACTIVA', gestionarPerfil: '/app/panel' });
    expect(c.body.suscripciones[0]).toMatchObject({ plan: 'Plan B', estado: 'ACTIVA', gestionar: '/app/suscripcion' });
    const a = await e.dueno.post('/personal', { nombre: 'Carlos Mesero', correo: `${randomUUID()}@t.bo`, roles: ['mesero'] });
    const subM = randomUUID();
    const canje = await t.api().post('/api/v1/auth/kyros-id/sesion').send({ accessToken: t.firmar({ sub: subM }) });
    await t.api().post('/api/v1/auth/kyros-id/vincular').send({ registroToken: canje.body.registroToken, codigo: a.body.codigo });
    const m = await pedir('account', portal(subM));
    expect(m.body.rol).toBe('Mesero'); expect(m.body.suscripciones).toEqual([]);
  });

  it('sin vínculo responde vinculado:false (sin revelar nada); tokens ajenos, vencidos o sin token dan 401', async () => {
    const sinVinculo = await pedir('summary', portal(randomUUID()));
    expect(sinVinculo.status).toBe(200); expect(sinVinculo.body.vinculado).toBe(false); expect(Object.keys(sinVinculo.body).sort()).toEqual(['entrar', 'vinculado']);
    const e = await escenario();
    const malos = [
      t.firmar({ sub: e.d.sub }), // token de la app (azp y audiencia de gestro-web)
      portal(e.d.sub, { aud: ['otra-audiencia'] }), portal(e.d.sub, { azp: 'otro-client' }), portal(e.d.sub, { typ: 'ID' }),
      portal(e.d.sub, { exp: Math.floor(Date.now() / 1000) - 60 }), portal(e.d.sub, { iss: 'https://otro/realms/x' }),
    ];
    for (const m of malos) expect((await pedir('summary', m)).status).toBe(401);
    expect((await pedir('summary')).status).toBe(401);
    // Y al revés: un token del Portal no abre la API del personal ni el canje de sesión.
    expect((await t.api().get('/api/v1/sucursal').set('Authorization', `Bearer ${portal(e.d.sub)}`).set('X-Restaurant-Id', e.d.rid)).status).toBe(401);
    expect((await t.api().post('/api/v1/auth/kyros-id/sesion').send({ accessToken: portal(randomUUID()) })).status).toBe(401);
  });
});
