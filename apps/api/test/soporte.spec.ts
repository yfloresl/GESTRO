import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { levantar } from './util';

let t: Awaited<ReturnType<typeof levantar>>;
let plat: Awaited<ReturnType<Awaited<ReturnType<typeof levantar>>['nuevaPlataforma']>>;
beforeAll(async () => { t = await levantar(); plat = await t.nuevaPlataforma(); });
afterAll(async () => { await t.cerrar(); });

describe('Modo de soporte del equipo de plataforma', () => {
  it('entra a cualquier sucursal con vista completa pero solo lectura; el ingreso queda en la auditoría', async () => {
    const a = await t.nuevoRestaurante('Pique Doña Rosa'); const dueno = t.con(a.token, a.rid);
    await dueno.post('/menu/platos', { nombre: 'Pique macho', precio: 78 });
    const b = await t.nuevoRestaurante('Otro Restaurante'); await t.con(b.token, b.rid).post('/menu/platos', { nombre: 'Plato del otro', precio: 10 });

    const entrada = await plat.post('/plataforma/soporte/entrar', { sucursalId: a.rid });
    expect(entrada.status).toBe(200); expect(entrada.body).toMatchObject({ id: a.rid, nombre: 'Pique Doña Rosa' });
    const aud = (await t.owner.query(`SELECT user_id, restaurant_id FROM audit_log WHERE action = 'soporte.ingreso' AND restaurant_id = $1`, [a.rid])).rows;
    expect(aud).toHaveLength(1); expect(aud[0].user_id).toBe(plat.userId);

    const soporte = t.con(plat.token, a.rid);
    const platos = await soporte.get('/menu/platos');
    expect(platos.status).toBe(200); expect(platos.body.map((p: { nombre: string }) => p.nombre)).toEqual(['Pique macho']);            // solo ESA sucursal
    for (const ruta of ['/sucursal', '/estadisticas/resumen', '/contabilidad/cuentas', '/alertas', '/eventos', '/promociones', '/personal', '/suscripcion']) expect((await soporte.get(ruta)).status, ruta).toBe(200);
    expect((await soporte.get('/sucursal')).body).toMatchObject({ id: a.rid, nombre: 'Pique Doña Rosa' });

    expect((await soporte.post('/menu/platos', { nombre: 'Intruso', precio: 1 })).status).toBe(403);
    expect((await soporte.patch('/sucursal/ajustes', { pedidosPorQr: false })).status).toBe(403);
    expect((await soporte.post('/personal', { nombre: 'Persona X', correo: 'x@t.bo', roles: ['mesero'] })).status).toBe(403);
    expect((await soporte.post('/demo/restablecer')).status).toBe(403);                                                              // ni siquiera lo que una demostración permite
    const msg = (await soporte.post('/menu/platos', { nombre: 'Intruso', precio: 1 })).body.message as string;
    expect(msg).toMatch(/Modo de soporte: solo lectura/);
    expect(Number((await t.owner.query(`SELECT count(*)::int AS n FROM menu_items WHERE restaurant_id = $1`, [a.rid])).rows[0].n)).toBe(1);   // nada cambió
  });

  it('una persona común no puede usar el modo de soporte ni mirar sucursales ajenas; un identificador inválido se rechaza', async () => {
    const a = await t.nuevoRestaurante(); const b = await t.nuevoRestaurante();
    expect((await t.con(a.token, b.rid).get('/menu/platos')).status).toBe(403);                                                       // dueño de otra sucursal
    expect((await t.con(a.token, a.rid).post('/plataforma/soporte/entrar', { sucursalId: b.rid })).status).toBe(403);
    expect((await t.con(plat.token, 'no-es-un-uuid').get('/menu/platos')).status).toBe(403);
    expect((await t.con(plat.token, randomUUID()).get('/menu/platos')).status).toBe(403);                                             // sucursal inexistente
    expect((await plat.post('/plataforma/soporte/entrar', { sucursalId: randomUUID() })).status).toBe(404);
    expect((await plat.post('/plataforma/soporte/entrar', { sucursalId: 'x' })).status).toBe(400);
    expect((await plat.post('/plataforma/soporte/entrar', { sucursalId: a.rid, otro: 1 })).status).toBe(400);
  });

  it('quien además es miembro de una sucursal sigue trabajando normal en la suya (no entra en modo soporte)', async () => {
    const a = await t.nuevoRestaurante(); const dueno = t.con(a.token, a.rid);
    expect((await dueno.post('/menu/platos', { nombre: 'Pique', precio: 50 })).status).toBe(201);
    await t.owner.query('UPDATE users SET is_platform_admin = true WHERE id = $1', [a.userId]);
    const nueva = await t.api().post('/api/v1/auth/refrescar'); void nueva;                                                              // el token viejo no tiene el claim: se prueba con una sesión nueva
    const ses = await t.api().post('/api/v1/auth/kyros-id/sesion').send({ accessToken: t.firmar({ sub: a.sub }) });
    expect(ses.status).toBe(200); expect(ses.body.sesion.usuario.esPlataforma).toBe(true);
    const mio = t.con(ses.body.sesion.accessToken, a.rid);
    expect((await mio.post('/menu/platos', { nombre: 'Silpancho', precio: 52 })).status).toBe(201);
  });
});
