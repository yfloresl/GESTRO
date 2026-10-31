import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { levantar } from './util';

let t: Awaited<ReturnType<typeof levantar>>;
let plat: Awaited<ReturnType<Awaited<ReturnType<typeof levantar>>['nuevaPlataforma']>>;
beforeAll(async () => { t = await levantar(); plat = await t.nuevaPlataforma(); });
afterAll(async () => { await t.cerrar(); });

const plan = async (codigo: string) => (await t.owner.query(`SELECT id FROM plans WHERE code = $1`, [codigo])).rows[0].id as string;
const asignar = (rid: string, id: string) => t.owner.query(`UPDATE restaurants SET plan_id = $2 WHERE id = $1`, [rid, id]);

describe('Paquetes por módulo', () => {
  it('el catálogo trae Esencial/Profesional/Cadena y por defecto NO se aplica nada', async () => {
    const r = await plat.get('/plataforma/planes');
    const por = Object.fromEntries((r.body as { codigo: string; modulos: string[] | null; aplicado: boolean }[]).map((p) => [p.codigo, p]));
    expect(por.esencial.modulos).toEqual(['menu_salon', 'caja', 'cierre']); expect(por.profesional.modulos).toContain('cocina'); expect(por.cadena.modulos).toContain('contabilidad');
    expect([por.esencial, por.profesional, por.cadena].every((p) => p.aplicado === false)).toBe(true);
    const a = await t.nuevoRestaurante('Sin Limite'); await asignar(a.rid, await plan('esencial'));
    expect((await t.con(a.token, a.rid).get('/contabilidad/reportes/balance')).status).not.toBe(402);   // apagado: nada se bloquea
    const al = await t.con(a.token, a.rid).get('/suscripcion/alcance');
    expect(al.status).toBe(200); expect(al.body.aplicado).toBe(false); expect(al.body.modulos.every((m: { incluido: boolean }) => m.incluido)).toBe(true);
  });

  it('encendido: Esencial bloquea cocina/inventario/contabilidad con 402 PLAN_SIN_MODULO y deja menú y caja; Cadena lo permite todo', async () => {
    const esencial = await plan('esencial'); const cadena = await plan('cadena');
    const a = await t.nuevoRestaurante('Solo Esencial'); await asignar(a.rid, esencial);
    expect((await plat.patch(`/plataforma/planes/${esencial}/paquete`, { aplicar: true })).status).toBe(200);
    try {
      const api = t.con(a.token, a.rid);
      for (const ruta of ['/cocina/tickets', '/insumos', '/contabilidad/reportes/balance', '/reservas', '/por-cobrar', '/ordenes-de-compra']) {
        const r = await api.get(ruta); expect(r.status, ruta).toBe(402); expect(r.body.code).toBe('PLAN_SIN_MODULO');
      }
      expect((await api.get('/menu/platos')).status).toBe(200);
      expect((await api.get('/mesas')).status).toBe(200);
      const al = await api.get('/suscripcion/alcance'); expect(al.body.aplicado).toBe(true);
      expect(al.body.modulos.filter((m: { incluido: boolean }) => m.incluido).map((m: { codigo: string }) => m.codigo)).toEqual(['menu_salon', 'caja', 'cierre']);
      expect((await plat.patch(`/plataforma/planes/${cadena}/paquete`, { aplicar: true })).status).toBe(200);
      await asignar(a.rid, cadena);
      expect((await api.get('/contabilidad/reportes/balance')).status).not.toBe(402);
      expect((await api.get('/cocina/tickets')).status).not.toBe(402);
    } finally { for (const p of [esencial, cadena]) await plat.patch(`/plataforma/planes/${p}/paquete`, { aplicar: false }); }
  });

  it('comensales y terceros nunca se bloquean (QR/reservas web), y la consola de plataforma exige plataforma', async () => {
    const esencial = await plan('esencial'); const a = await t.nuevoRestaurante('Publico Libre'); await asignar(a.rid, esencial);
    await plat.patch(`/plataforma/planes/${esencial}/paquete`, { aplicar: true });
    try {
      const slug = (await t.owner.query(`SELECT slug FROM restaurants WHERE id = $1`, [a.rid])).rows[0].slug;
      expect((await t.api().get(`/api/v1/public/${slug}/reservas`)).status).not.toBe(402);
      expect((await t.con(a.token, a.rid).patch(`/plataforma/planes/${esencial}/paquete`, { aplicar: false })).status).toBe(403);
      expect((await plat.patch(`/plataforma/planes/${esencial}/paquete`, { aplicar: 'si' })).status).toBe(400);
    } finally { await plat.patch(`/plataforma/planes/${esencial}/paquete`, { aplicar: false }); }
  });
});
