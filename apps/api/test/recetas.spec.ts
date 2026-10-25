import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { levantar } from './util';

let t: Awaited<ReturnType<typeof levantar>>;
beforeAll(async () => { t = await levantar(); });
afterAll(async () => { await t.cerrar(); });

async function escenario() {
  const d = await t.nuevoRestaurante();
  const dueno = t.con(d.token, d.rid);
  const alta = async (rol: string) => { const a = await dueno.post('/personal', { nombre: `Persona ${rol}`, correo: `${randomUUID()}@t.bo`, roles: [rol] }); const s = await t.entrarConCodigo(a.body.codigo); return t.con(s.token, d.rid); };
  const ins = async (nombre: string, unidad: string) => (await dueno.post('/insumos', { nombre, unidad })).body.id as string;
  const [carne, papa, tomate, huevo, salsa, caldo] = [await ins('Carne', 'kg'), await ins('Papa', 'kg'), await ins('Tomate', 'kg'), await ins('Huevo', 'un'), await ins('Salsa criolla', 'l'), await ins('Caldo base', 'l')];
  const cocina = (await dueno.post('/almacenes', { nombre: 'Cocina' })).body.id as string;
  const camara = (await dueno.post('/almacenes', { nombre: 'Cámara fría' })).body.id as string;
  const plato = async (nombre: string, precio: number) => (await dueno.post('/menu/platos', { nombre, precio })).body.id as string;
  const [pique, milanesa, sopa] = [await plato('Pique Macho', 65), await plato('Milanesa', 48), await plato('Sopa de maní', 32)];
  return { d, dueno, carne, papa, tomate, huevo, salsa, caldo, cocina, camara, pique, milanesa, sopa, chef: await alta('cocina'), mesero: await alta('mesero') };
}
type E = Awaited<ReturnType<typeof escenario>>;
const comprar = (e: E, insumoId: string, cantidad: number, costoUnitario: number, almacenId = e.cocina) => e.dueno.post('/stock/movimientos', { tipo: 'compra', almacenId, insumoId, cantidad, costoUnitario });
const receta = (e: E, destino: object, lineas: [string, number, string][], extra: object = {}) => e.chef.post('/recetas', { ...destino, rendimiento: 1, mermaPct: 0, ...extra, lineas: lineas.map(([insumoId, cantidad, unidad]) => ({ insumoId, cantidad, unidad })) });

describe('Biblioteca de recetas', () => {
  it('crea la versión 1 activa con costo por porción y margen contra el precio del menú', async () => {
    const e = await escenario();
    await comprar(e, e.carne, 10, 60); await comprar(e, e.huevo, 30, 1.2);
    const r = await receta(e, { platoId: e.milanesa }, [[e.carne, 200, 'g'], [e.huevo, 1, 'un']], { mermaPct: 5 });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ version: 1, activa: true, rendimiento: '1.00', mermaPct: '5.00', costoPorPorcion: '13.8600', precio: '48.00', margen: '71.13' });
    expect(r.body.lineas).toHaveLength(2);
    const lista = (await e.chef.get('/recetas')).body;
    expect(lista.platos.find((p: { platoId: string }) => p.platoId === e.milanesa)).toMatchObject({ tieneReceta: true, costo: '13.86', margen: '71.13', bajoMinimo: false, version: 1 });
    expect(lista.platos.find((p: { platoId: string }) => p.platoId === e.sopa)).toMatchObject({ tieneReceta: false, costo: null });
  });

  it('un cambio crea una versión nueva y deja una sola activa; se puede volver a una anterior', async () => {
    const e = await escenario();
    const v1 = await receta(e, { platoId: e.pique }, [[e.carne, 300, 'g']]);
    const v2 = await receta(e, { platoId: e.pique }, [[e.carne, 250, 'g'], [e.papa, 200, 'g']]);
    expect(v2.body.version).toBe(2);
    const vs = (await e.chef.get(`/recetas/plato/${e.pique}/versiones`)).body;
    expect(vs.map((v: { version: number; activa: boolean }) => `${v.version}:${v.activa}`)).toEqual(['2:true', '1:false']);
    expect((await e.chef.post(`/recetas/${v1.body.id}/activar`)).body).toMatchObject({ version: 1, activa: true });
    const act = await t.owner.query(`SELECT count(*)::int AS n FROM recipes WHERE menu_item_id = $1 AND active`, [e.pique]);
    expect(act.rows[0].n).toBe(1);
    expect((await e.chef.get(`/recetas/${v2.body.id}`)).body.activa).toBe(false);
  });

  it('valida: unidad incompatible, insumo repetido, plato inexistente y destino ambiguo', async () => {
    const e = await escenario();
    expect((await receta(e, { platoId: e.pique }, [[e.carne, 1, 'l']])).status).toBe(400);
    expect((await receta(e, { platoId: e.pique }, [[e.carne, 1, 'kg'], [e.carne, 2, 'kg']])).status).toBe(400);
    expect((await receta(e, { platoId: randomUUID() }, [[e.carne, 1, 'kg']])).status).toBe(404);
    expect((await receta(e, { platoId: e.pique, insumoId: e.salsa }, [[e.carne, 1, 'kg']])).status).toBe(400);
    expect((await receta(e, {}, [[e.carne, 1, 'kg']])).status).toBe(400);
    expect((await receta(e, { platoId: e.pique }, [[e.carne, 1, 'kg']], { rendimiento: 0 })).status).toBe(400);
    expect((await receta(e, { platoId: e.pique }, [[e.carne, 1, 'taza']])).status).toBe(400);
    expect((await e.mesero.get('/recetas')).status).toBe(403);
    expect((await e.mesero.post('/recetas', {})).status).toBe(403);
  });

  it('sub-recetas: la salsa produce un insumo y el plato la usa; un ciclo se rechaza con 409', async () => {
    const e = await escenario();
    await comprar(e, e.tomate, 10, 10);
    expect((await receta(e, { insumoId: e.salsa }, [[e.tomate, 1, 'kg']], { rendimiento: 2 })).status).toBe(201); // 2 l con 1 kg de tomate
    const pique = await receta(e, { platoId: e.pique }, [[e.salsa, 100, 'ml']]);
    expect(pique.body.costoPorPorcion).toBe('0.5000'); // 0.1 l = 0.05 kg × 10
    // caldo usa salsa y salsa (nueva versión) usa caldo: ciclo
    expect((await receta(e, { insumoId: e.caldo }, [[e.salsa, 1, 'l']])).status).toBe(201);
    const ciclo = await receta(e, { insumoId: e.salsa }, [[e.caldo, 1, 'l']]);
    expect(ciclo.status).toBe(409); expect(ciclo.body.message).toMatch(/ciclo/i);
    const vs = (await e.chef.get(`/recetas/insumo/${e.salsa}/versiones`)).body;
    expect(vs).toHaveLength(1); // la receta con ciclo no se guardó
  });

  it('subir el precio de la carne sube el costo de todos los platos y marca los que bajan del margen mínimo', async () => {
    const e = await escenario();
    await comprar(e, e.carne, 10, 60);
    await receta(e, { platoId: e.pique }, [[e.carne, 200, 'g']]); // 12.00 → margen 81.54 % sobre Bs 65
    await receta(e, { platoId: e.milanesa }, [[e.carne, 150, 'g']]); // 9.00 → 81.25 % sobre Bs 48
    expect((await e.dueno.patch('/sucursal/ajustes', { margenMinimo: 75 })).status).toBe(200);
    expect((await e.dueno.get('/sucursal/ajustes')).body.margenMinimo).toBe(75);
    let l = (await e.chef.get('/recetas')).body;
    expect(l.platos.filter((p: { bajoMinimo: boolean }) => p.bajoMinimo)).toHaveLength(0);
    await comprar(e, e.carne, 10, 150); // promedio ponderado: (10×60 + 10×150) ÷ 20 = 105
    l = (await e.chef.get('/recetas')).body;
    const pq = l.platos.find((p: { platoId: string }) => p.platoId === e.pique); const ml = l.platos.find((p: { platoId: string }) => p.platoId === e.milanesa);
    expect(pq).toMatchObject({ costo: '21.00', margen: '67.69', bajoMinimo: true });
    expect(ml).toMatchObject({ costo: '15.75', margen: '67.19', bajoMinimo: true });
  });

  it('el costo puede ir por «último costo» en vez de promedio', async () => {
    const e = await escenario();
    await comprar(e, e.carne, 10, 60); await comprar(e, e.carne, 10, 100);
    await e.dueno.patch(`/insumos/${e.carne}`, { nombre: 'Carne', unidad: 'kg', minimo: 0, metodoCosto: 'ultimo' });
    const r = await receta(e, { platoId: e.pique }, [[e.carne, 1000, 'g']]);
    expect(r.body.costoPorPorcion).toBe('100.0000');
  });

  it('un insumo de una receta activa no se borra ni se desactiva', async () => {
    const e = await escenario();
    await receta(e, { platoId: e.pique }, [[e.papa, 300, 'g']]);
    expect((await e.dueno.del(`/insumos/${e.papa}`)).status).toBe(409);
    expect((await e.dueno.patch(`/insumos/${e.papa}`, { nombre: 'Papa', unidad: 'kg', minimo: 0, activo: false })).status).toBe(409);
  });

  it('una sucursal no ve ni usa las recetas de otra', async () => {
    const a = await escenario(); const b = await escenario();
    const r = await receta(a, { platoId: a.pique }, [[a.papa, 1, 'kg']]);
    expect((await b.chef.get(`/recetas/${r.body.id}`)).status).toBe(404);
    expect((await b.chef.post(`/recetas/${r.body.id}/activar`)).status).toBe(404);
    expect((await receta(b, { platoId: a.pique }, [[b.papa, 1, 'kg']])).status).toBe(404);
  });
});

describe('Plan del día', () => {
  async function conPlatos(e: E) {
    await receta(e, { platoId: e.milanesa }, [[e.carne, 200, 'g'], [e.huevo, 1, 'un']], { mermaPct: 5 });
    await receta(e, { platoId: e.sopa }, [[e.papa, 100, 'g'], [e.tomate, 50, 'g']]);
  }
  const fecha = '2030-06-15';

  it('40 milanesas y 25 sopas dan una lista consolidada por insumo; sin stock todo falta', async () => {
    const e = await escenario(); await conPlatos(e);
    const r = await e.chef.put(`/plan-del-dia/${fecha}`, { items: [{ platoId: e.milanesa, porciones: 40 }, { platoId: e.sopa, porciones: 25 }] });
    expect(r.status).toBe(200);
    const ins = (n: string) => r.body.insumos.find((i: { insumo: string }) => i.insumo === n);
    expect(ins('Carne')).toMatchObject({ requerido: '8.400', unidad: 'kg', faltante: '8.400', alcanza: false });
    expect(ins('Huevo')).toMatchObject({ requerido: '42.000', unidad: 'un' });
    expect(ins('Papa')).toMatchObject({ requerido: '2.500' }); expect(ins('Tomate')).toMatchObject({ requerido: '1.250' });
    expect(r.body.hayFaltantes).toBe(true); expect(r.body.sinReceta).toEqual([]);
    const guardado = await t.owner.query(`SELECT requirements, computed_at FROM production_plans WHERE restaurant_id = $1 AND plan_date = $2`, [e.d.rid, fecha]);
    expect(guardado.rows[0].computed_at).toBeTruthy(); expect(guardado.rows[0].requirements).toHaveLength(4);
  });

  it('con stock suficiente (aunque esté repartido en dos almacenes) no hay faltantes', async () => {
    const e = await escenario(); await conPlatos(e);
    await comprar(e, e.carne, 5, 60, e.cocina); await comprar(e, e.carne, 4, 60, e.camara);
    await comprar(e, e.huevo, 50, 1); await comprar(e, e.papa, 3, 5); await comprar(e, e.tomate, 2, 8);
    const r = (await e.chef.put(`/plan-del-dia/${fecha}`, { items: [{ platoId: e.milanesa, porciones: 40 }, { platoId: e.sopa, porciones: 25 }] })).body;
    const carne = r.insumos.find((i: { insumo: string }) => i.insumo === 'Carne');
    expect(carne).toMatchObject({ stock: '9.000', faltante: '0.000', alcanza: true });
    expect(carne.porAlmacen).toHaveLength(2);
    expect(r.hayFaltantes).toBe(false);
    expect(Number(r.costoEstimado)).toBeGreaterThan(0);
  });

  it('con poco stock, falta solo la diferencia; el plan se reemplaza al guardarlo de nuevo', async () => {
    const e = await escenario(); await conPlatos(e);
    await comprar(e, e.carne, 5, 60);
    const r = (await e.chef.put(`/plan-del-dia/${fecha}`, { items: [{ platoId: e.milanesa, porciones: 40 }] })).body;
    expect(r.insumos.find((i: { insumo: string }) => i.insumo === 'Carne')).toMatchObject({ requerido: '8.400', stock: '5.000', faltante: '3.400' });
    const otra = (await e.chef.put(`/plan-del-dia/${fecha}`, { items: [{ platoId: e.sopa, porciones: 10 }] })).body;
    expect(otra.platos).toHaveLength(1); expect(otra.insumos.find((i: { insumo: string }) => i.insumo === 'Carne')).toBeUndefined();
    expect((await e.chef.get(`/plan-del-dia/${fecha}`)).body.platos[0].nombre).toBe('Sopa de maní');
  });

  it('un plato sin receta se avisa aparte; el plan no se rompe', async () => {
    const e = await escenario(); await conPlatos(e);
    const r = (await e.chef.put(`/plan-del-dia/${fecha}`, { items: [{ platoId: e.pique, porciones: 5 }, { platoId: e.sopa, porciones: 5 }] })).body;
    expect(r.sinReceta).toEqual([{ platoId: e.pique, nombre: 'Pique Macho' }]);
    expect(r.insumos.length).toBeGreaterThan(0);
  });

  it('validaciones y permisos', async () => {
    const e = await escenario(); await conPlatos(e);
    expect((await e.chef.put('/plan-del-dia/15-06-2030', { items: [] })).status).toBe(400);
    expect((await e.chef.put(`/plan-del-dia/${fecha}`, { items: [{ platoId: e.sopa, porciones: 0 }] })).status).toBe(400);
    expect((await e.chef.put(`/plan-del-dia/${fecha}`, { items: [{ platoId: e.sopa, porciones: 1 }, { platoId: e.sopa, porciones: 2 }] })).status).toBe(400);
    expect((await e.chef.put(`/plan-del-dia/${fecha}`, { items: [{ platoId: randomUUID(), porciones: 1 }] })).status).toBe(400);
    expect((await e.mesero.get(`/plan-del-dia/${fecha}`)).status).toBe(403);
    expect((await e.mesero.put(`/plan-del-dia/${fecha}`, { items: [] })).status).toBe(403);
    expect((await e.chef.get('/plan-del-dia/2031-01-01')).body.insumos).toEqual([]);
  });
});
