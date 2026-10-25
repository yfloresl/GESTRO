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
  const almacen = (await dueno.post('/almacenes', { nombre: 'Cocina' })).body.id as string;
  const bodega = (await dueno.post('/almacenes', { nombre: 'Bodega seca' })).body.id as string;
  const carne = (await dueno.post('/insumos', { nombre: 'Lomo de res', unidad: 'kg', minimo: 5, categoria: 'Carnes' })).body.id as string;
  return { d, dueno, almacen, bodega, carne, almacenista: await alta('almacen'), mesero: await alta('mesero'), cocina: await alta('cocina') };
}
type E = Awaited<ReturnType<typeof escenario>>;
const compra = (e: E, cantidad: number, costoUnitario: number, extra: object = {}) => e.dueno.post('/stock/movimientos', { tipo: 'compra', almacenId: e.almacen, insumoId: e.carne, cantidad, costoUnitario, ...extra });
const nivel = async (e: E, almacenId = e.almacen) => ((await e.dueno.get(`/stock/niveles?almacenId=${almacenId}`)).body as { insumoId: string; cantidad: string; costoPromedio: string }[]).find((n) => n.insumoId === e.carne);

describe('Insumos y almacenes', () => {
  it('crea insumos con unidad válida; nombre repetido 409; el almacenista gestiona y el mesero no', async () => {
    const e = await escenario();
    expect((await e.dueno.post('/insumos', { nombre: 'Sal', unidad: 'cucharon' })).status).toBe(400);
    expect((await e.dueno.post('/insumos', { nombre: 'Lomo de res', unidad: 'kg' })).status).toBe(409);
    expect((await e.almacenista.post('/insumos', { nombre: 'Papa', unidad: 'kg', minimo: 20, perecedero: true })).status).toBe(201);
    expect((await e.mesero.get('/insumos')).status).toBe(403);
    expect((await e.mesero.post('/insumos', { nombre: 'X', unidad: 'kg' })).status).toBe(403);
    expect((await e.cocina.get('/insumos')).status).toBe(200);
    expect((await e.cocina.post('/stock/movimientos', { tipo: 'compra', almacenId: e.almacen, insumoId: e.carne, cantidad: 1, costoUnitario: 1 })).status).toBe(403);
    expect((await e.dueno.post('/almacenes', { nombre: 'Cocina' })).status).toBe(409);
    expect((await e.dueno.get('/unidades')).body.map((u: { codigo: string }) => u.codigo)).toEqual(expect.arrayContaining(['kg', 'g', 'lb', 'l', 'ml', 'un']));
  });

  it('un insumo con historial no se borra, se desactiva; sin historial sí se borra', async () => {
    const e = await escenario();
    const libre = (await e.dueno.post('/insumos', { nombre: 'Orégano', unidad: 'g' })).body.id;
    expect((await e.dueno.del(`/insumos/${libre}`)).status).toBe(200);
    await compra(e, 1, 10);
    expect((await e.dueno.del(`/insumos/${e.carne}`)).status).toBe(409);
    expect((await e.dueno.patch(`/insumos/${e.carne}`, { nombre: 'Lomo de res', unidad: 'lb', minimo: 5 })).status).toBe(409); // cambiar la unidad con historial
    expect((await e.dueno.patch(`/insumos/${e.carne}`, { nombre: 'Lomo de res', unidad: 'kg', minimo: 5, activo: false })).status).toBe(200);
    expect((await compra(e, 1, 10)).status).toBe(404); // desactivado: ya no recibe movimientos
  });
});

describe('Movimientos y costo promedio', () => {
  it('compras suben el stock y recalculan el promedio ponderado; el último costo es el de la última compra', async () => {
    const e = await escenario();
    expect((await compra(e, 10, 20)).status).toBe(200);
    expect(await nivel(e)).toMatchObject({ cantidad: '10.000', costoPromedio: '20.0000' });
    await compra(e, 10, 30);
    expect(await nivel(e)).toMatchObject({ cantidad: '20.000', costoPromedio: '25.0000' });
    const lista = (await e.dueno.get('/insumos')).body.find((i: { id: string }) => i.id === e.carne);
    expect(lista).toMatchObject({ stock: '20.000', ultimoCosto: '30.0000', costoPromedio: '25.0000', valor: '500.00', estado: 'optimo' });
  });

  it('convierte unidades compatibles (g, lb → kg) y rechaza las incompatibles', async () => {
    const e = await escenario();
    const r = await compra(e, 500, 0.04, { unidad: 'g' }); // 500 g a Bs 0.04 el gramo = 0.5 kg a Bs 40 el kg
    expect(r.body).toMatchObject({ cantidadEnUnidadDelInsumo: '0.500', unidad: 'kg' });
    expect(await nivel(e)).toMatchObject({ cantidad: '0.500', costoPromedio: '40.0000' });
    await compra(e, 2, 10, { unidad: 'lb' }); // 2 lb = 0.907 kg
    expect((await nivel(e))!.cantidad).toBe('1.407');
    expect((await compra(e, 1, 5, { unidad: 'l' })).status).toBe(400);
    expect((await compra(e, 1, 5, { unidad: 'furlong' })).status).toBe(400);
  });

  it('merma y ajuste exigen motivo; el kardex lleva el saldo corrido', async () => {
    const e = await escenario();
    await compra(e, 10, 20);
    const m = (cuerpo: object) => e.dueno.post('/stock/movimientos', { almacenId: e.almacen, insumoId: e.carne, ...cuerpo });
    expect((await m({ tipo: 'merma', cantidad: 1 })).status).toBe(400);
    expect((await m({ tipo: 'ajuste', cantidad: 1, motivo: 'diferencia' })).status).toBe(400); // falta el sentido
    expect((await m({ tipo: 'merma', cantidad: 1.5, motivo: 'Maduración' })).status).toBe(200);
    expect((await m({ tipo: 'ajuste', cantidad: 0.5, sentido: 'entrada', motivo: 'Sobrante del conteo' })).status).toBe(200);
    expect((await nivel(e))!.cantidad).toBe('9.000');
    const k = (await e.dueno.get(`/stock/kardex/${e.carne}?almacenId=${e.almacen}`)).body as { tipo: string; cantidad: string; saldo: string; motivo: string | null }[];
    expect(k.map((x) => `${x.tipo}:${x.cantidad}:${x.saldo}`)).toEqual(['ajuste:0.500:9.000', 'merma:-1.500:8.500', 'compra:10.000:10.000']);
    expect(k[1].motivo).toBe('Maduración');
    const log = await t.owner.query(`SELECT action FROM audit_log WHERE restaurant_id = $1 AND action IN ('inventario.merma','inventario.ajuste')`, [e.d.rid]);
    expect(log.rowCount).toBe(2);
  });

  it('el stock puede quedar en negativo: no frena, genera alerta', async () => {
    const e = await escenario();
    await compra(e, 2, 20);
    await e.dueno.post('/stock/movimientos', { tipo: 'merma', almacenId: e.almacen, insumoId: e.carne, cantidad: 5, motivo: 'Se descompuso' });
    expect((await nivel(e))!.cantidad).toBe('-3.000');
    const a = (await e.dueno.get('/stock/alertas')).body;
    expect(a.negativos[0]).toMatchObject({ insumo: 'Lomo de res', cantidad: '-3.000' });
    expect(a.bajoMinimo[0]).toMatchObject({ insumo: 'Lomo de res', minimo: '5.000' });
    // El promedio no se contamina con el saldo negativo: la siguiente compra parte de cero.
    await compra(e, 7, 40);
    expect(await nivel(e)).toMatchObject({ cantidad: '4.000', costoPromedio: '40.0000' });
  });

  it('salida con FEFO: consume primero el lote que vence antes', async () => {
    const e = await escenario();
    await compra(e, 5, 20, { lote: 'A', vence: '2030-02-01' });
    await compra(e, 5, 20, { lote: 'B', vence: '2030-01-01' });
    await e.dueno.post('/stock/movimientos', { tipo: 'merma', almacenId: e.almacen, insumoId: e.carne, cantidad: 6, motivo: 'Cocción excesiva' });
    const f = await t.owner.query(`SELECT lot, sum(qty)::text AS saldo FROM stock_movements WHERE ingredient_id = $1 AND lot IS NOT NULL GROUP BY lot ORDER BY lot`, [e.carne]);
    expect(f.rows).toEqual([{ lot: 'A', saldo: '4.000' }, { lot: 'B', saldo: '0.000' }]);
    expect((await nivel(e))!.cantidad).toBe('4.000');
    expect((await e.dueno.post('/stock/movimientos', { tipo: 'merma', almacenId: e.almacen, insumoId: e.carne, cantidad: 1, motivo: 'x y z', lote: 'A' })).status).toBe(400);
  });

  it('alerta lotes por vencer', async () => {
    const e = await escenario();
    const en = (await t.owner.query(`SELECT ((now() AT TIME ZONE 'America/La_Paz')::date + 3)::text AS d`)).rows[0].d;
    await compra(e, 5, 20, { lote: 'L-1', vence: en });
    await compra(e, 5, 20, { lote: 'L-2', vence: '2035-01-01' });
    const a = (await e.dueno.get('/stock/alertas')).body.porVencer;
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ lote: 'L-1', dias: 3, saldo: '5.000' });
  });
});

describe('Traspasos y conteo físico', () => {
  it('traspaso entre almacenes: sale de uno, entra al otro con su costo; no al mismo almacén', async () => {
    const e = await escenario();
    await compra(e, 10, 20);
    expect((await e.dueno.post('/stock/traspasos', { origenId: e.almacen, destinoId: e.almacen, insumoId: e.carne, cantidad: 1 })).status).toBe(400);
    expect((await e.dueno.post('/stock/traspasos', { origenId: e.almacen, destinoId: e.bodega, insumoId: e.carne, cantidad: 4 })).status).toBe(200);
    expect((await nivel(e))!.cantidad).toBe('6.000');
    expect(await nivel(e, e.bodega)).toMatchObject({ cantidad: '4.000', costoPromedio: '20.0000' });
    const g = await t.owner.query(`SELECT count(DISTINCT group_id)::int AS n, count(*)::int AS c FROM stock_movements WHERE ingredient_id = $1 AND kind IN ('traspaso_in','traspaso_out')`, [e.carne]);
    expect(g.rows[0]).toEqual({ n: 1, c: 2 });
  });

  it('conteo físico: ajusta la diferencia y la valoriza; sin diferencia no mueve nada', async () => {
    const e = await escenario();
    await compra(e, 10, 20);
    const igual = (await e.dueno.post('/stock/conteos', { almacenId: e.almacen, lineas: [{ insumoId: e.carne, contado: 10 }] })).body;
    expect(igual.valorDiferencia).toBe('0');
    const r = (await e.dueno.post('/stock/conteos', { almacenId: e.almacen, motivo: 'Cierre de turno', lineas: [{ insumoId: e.carne, contado: 7.5 }] })).body;
    expect(r.lineas[0]).toMatchObject({ sistema: '10.000', contado: '7.500', diferencia: '-2.500', valor: '-50.00' });
    expect(r.valorDiferencia).toBe('-50.00');
    expect((await nivel(e))!.cantidad).toBe('7.500');
    const mov = await t.owner.query(`SELECT kind, reason FROM stock_movements WHERE ingredient_id = $1 AND kind = 'ajuste'`, [e.carne]);
    expect(mov.rows).toEqual([{ kind: 'ajuste', reason: 'Conteo físico: Cierre de turno' }]);
  });
});

describe('Reglas de la base', () => {
  it('el stock no se edita a mano: la aplicación no puede escribir en stock_levels ni tocar el kardex', async () => {
    const e = await escenario();
    await compra(e, 3, 10);
    const comoApp = async (sentencia: string) => {
      const c = await t.owner.connect();
      try {
        await c.query('BEGIN'); await c.query('SET LOCAL ROLE app_user');
        await c.query(`SELECT set_config('app.restaurant_id', $1, true)`, [e.d.rid]);
        return await c.query(sentencia);
      } finally { await c.query('ROLLBACK'); c.release(); }
    };
    await expect(comoApp(`UPDATE stock_levels SET qty = 9999`)).rejects.toThrow(/permission denied/i);
    await expect(comoApp(`DELETE FROM stock_levels`)).rejects.toThrow(/permission denied/i);
    await expect(comoApp(`INSERT INTO stock_levels (restaurant_id, warehouse_id, ingredient_id, qty) VALUES ('${e.d.rid}','${e.almacen}','${e.carne}', 5)`)).rejects.toThrow(/permission denied/i);
    await expect(comoApp(`UPDATE stock_movements SET qty = 99`)).rejects.toThrow(/permission denied/i);
    await expect(comoApp(`DELETE FROM stock_movements`)).rejects.toThrow(/permission denied/i);
    expect((await comoApp(`SELECT qty FROM stock_levels`)).rowCount).toBe(1); // sí puede leer
  });

  it('un restaurante no ve ni mueve el inventario de otro', async () => {
    const a = await escenario(); const b = await escenario();
    await compra(a, 5, 10);
    expect((await b.dueno.post('/stock/movimientos', { tipo: 'compra', almacenId: b.almacen, insumoId: a.carne, cantidad: 1, costoUnitario: 1 })).status).toBe(404);
    expect((await b.dueno.post('/stock/movimientos', { tipo: 'compra', almacenId: a.almacen, insumoId: b.carne, cantidad: 1, costoUnitario: 1 })).status).toBe(400);
    expect((await b.dueno.get(`/stock/kardex/${a.carne}`)).body).toEqual([]);
    expect(await nivel(b)).toBeUndefined();
  });

  it('validaciones: cantidades con más de 3 decimales, negativas o la compra sin costo se rechazan', async () => {
    const e = await escenario();
    expect((await compra(e, 1.2345, 10)).status).toBe(400);
    expect((await compra(e, -1, 10)).status).toBe(400);
    expect((await e.dueno.post('/stock/movimientos', { tipo: 'compra', almacenId: e.almacen, insumoId: e.carne, cantidad: 1 })).status).toBe(400);
    expect((await compra(e, 1, 10, { extra: 1 })).status).toBe(400);
  });
});
