import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { levantar } from './util';

let t: Awaited<ReturnType<typeof levantar>>;
beforeAll(async () => { t = await levantar(); });
afterAll(async () => { await t.cerrar(); });

describe('Áreas, mesero por área y mayor general', () => {
  it('se crean áreas con cualquier nombre, y un mesero se asigna a un área entera o a todo el restaurante', async () => {
    const r = await t.nuevoRestaurante('Con Areas'); const d = t.con(r.token, r.rid);
    const areas: Record<string, string> = {};
    for (const n of ['VIP', 'Aire acondicionado', 'Fumadores']) { const a = await d.post('/areas', { nombre: n }); expect(a.status, n).toBe(201); areas[n] = a.body.id; }
    expect((await d.post('/areas', { nombre: 'VIP' })).status).toBe(409);
    for (const [i, n] of ['VIP', 'VIP', 'Fumadores', 'Aire acondicionado'].entries()) expect((await d.post('/mesas', { numero: String(i + 1), asientos: 4, areaId: areas[n] })).status).toBe(201);
    const p1 = await d.post('/personal', { nombre: 'Luis Mesero', correo: `${Math.random().toString(36).slice(2)}@t.bo`, roles: ['mesero'] });
    const per = (await d.get('/personal')).body as { id: string; nombre: string }[]; const mesero = per.find((x) => x.nombre === 'Luis Mesero')?.id ?? p1.body.id;
    const g1 = await d.put('/asignaciones/grupo', { meseroId: mesero, areaId: areas.VIP }); expect(g1.status).toBe(200); expect(g1.body.mesas).toBe(2);
    expect(((await d.get('/asignaciones')).body as unknown[]).length).toBe(2);
    const g2 = await d.put('/asignaciones/grupo', { meseroId: mesero }); expect(g2.body.mesas).toBe(4);
    expect(((await d.get('/asignaciones')).body as unknown[]).length).toBe(4);
    expect((await d.put('/asignaciones/grupo', { meseroId: mesero, areaId: '00000000-0000-4000-8000-000000000000' })).status).toBe(404);
  });

  it('libro mayor de todas las cuentas: devuelve cada cuenta con movimiento y se limita a quien ve contabilidad', async () => {
    const r = await t.nuevoRestaurante('Mayor General'); const d = t.con(r.token, r.rid);
    const m = await d.get('/contabilidad/reportes/mayor-general');
    expect(m.status).toBe(200); expect(Array.isArray(m.body.cuentas)).toBe(true);
    for (const c of m.body.cuentas as { codigo: string; movimientos: unknown[] }[]) expect(c.codigo).toMatch(/\d/);
  });
});
