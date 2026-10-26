import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { levantar } from './util';

let t: Awaited<ReturnType<typeof levantar>>;
beforeAll(async () => { t = await levantar(); });
afterAll(async () => { await t.cerrar(); });

const laPaz = (dias: number) => new Date(Date.now() - 4 * 3_600_000 + dias * 86_400_000).toISOString().slice(0, 10);

async function base() {
  const d = await t.nuevoRestaurante();
  const dueno = t.con(d.token, d.rid);
  const alta = async (rol: string) => { const a = await dueno.post('/personal', { nombre: `Persona ${rol}`, correo: `${randomUUID()}@t.bo`, roles: [rol] }); const s = await t.entrarConCodigo(a.body.codigo); return t.con(s.token, d.rid); };
  const [mesero, contador, cocina] = [await alta('mesero'), await alta('contador'), await alta('cocina')];
  const plato = async (nombre: string, precio: number, prep?: number) => (await dueno.post('/menu/platos', { nombre, precio, ...(prep ? { minutosPreparacion: prep } : {}) })).body.id as string;
  return { d, dueno, mesero, contador, cocina, plato };
}
type B = Awaited<ReturnType<typeof base>>;
const abiertas = async (b: B, tipo?: string) => (await b.dueno.get(`/alertas${tipo ? `?tipo=${tipo}` : ''}`)).body as { id: string; tipo: string; severidad: string; mensaje: string; datos: Record<string, unknown>; resuelta: string | null }[];

/** Venta cobrada ya hecha (como dueño de la base, para armar historia sin esperar). */
async function venta(b: B, dia: number, monto: number, hora = '13:00') {
  const ts = `${laPaz(dia)}T${hora}:00-04:00`;
  const o = (await t.owner.query(`INSERT INTO orders (restaurant_id, channel, order_type, status, subtotal, total, opened_at, sent_at, closed_at) VALUES ($1,'caja','mostrador','cobrado',$2,$2,$3::timestamptz,$3::timestamptz,$3::timestamptz) RETURNING id`, [b.d.rid, monto.toFixed(2), ts])).rows[0].id as string;
  await t.owner.query(`INSERT INTO sales_payments (restaurant_id, order_id, method, amount, document, paid_at) VALUES ($1,$2,'efectivo',$3,'ninguno',$4::timestamptz)`, [b.d.rid, o, monto.toFixed(2), ts]);
}

describe('Demora de cocina', () => {
  it('avisa con cuánto lleva el pedido y cuál es el límite; se resuelve sola al salir; no se duplica', async () => {
    const b = await base(); const p = await b.plato('Milanesa', 48, 10);
    const o = (await t.owner.query(`INSERT INTO orders (restaurant_id, channel, order_type, status, ticket_number, subtotal, total, sent_at) VALUES ($1,'caja','mostrador','en_preparacion',7,48,48, now() - interval '40 minutes') RETURNING id`, [b.d.rid])).rows[0].id as string;
    await t.owner.query(`INSERT INTO order_items (restaurant_id, order_id, menu_item_id, qty, unit_price, status, sent_at) VALUES ($1,$2,$3,1,48,'enviado', now() - interval '40 minutes')`, [b.d.rid, o, p]);
    const r1 = await b.dueno.post('/alertas/revisar');
    expect(r1.status).toBe(200); expect(r1.body.nuevas).toBe(1);
    const a = (await abiertas(b, 'demora_cocina'))[0];
    expect(a).toMatchObject({ severidad: 'alta', resuelta: null });
    expect(a.mensaje).toMatch(/#7/); expect(a.mensaje).toMatch(/40 min en cocina/); expect(a.mensaje).toMatch(/«Milanesa» es 15 min/);
    expect(a.datos).toMatchObject({ ticket: 7, minutosEnCocina: 40, limiteMinutos: 15, platoMasLento: 'Milanesa' });
    expect((await b.dueno.post('/alertas/revisar')).body.nuevas).toBe(0);                                  // no se repite
    expect(await abiertas(b, 'demora_cocina')).toHaveLength(1);
    await t.owner.query(`UPDATE order_items SET status = 'listo', ready_at = now() WHERE order_id = $1`, [o]);
    await b.dueno.post('/alertas/revisar');
    expect(await abiertas(b, 'demora_cocina')).toHaveLength(0);                                            // se resolvió sola
    expect(((await b.dueno.get('/alertas?estado=resueltas')).body as { tipo: string }[]).filter((x) => x.tipo === 'demora_cocina')).toHaveLength(1);
  });

  it('un pedido dentro del límite no genera alerta; la severidad es media si pasa poco', async () => {
    const b = await base(); const p = await b.plato('Sopa', 30, 20);                                      // meta 30 min
    const nuevo = async (minutos: number) => {
      const o = (await t.owner.query(`INSERT INTO orders (restaurant_id, channel, order_type, status, subtotal, total, sent_at) VALUES ($1,'caja','mostrador','en_preparacion',30,30, now() - ($2 || ' minutes')::interval) RETURNING id`, [b.d.rid, String(minutos)])).rows[0].id as string;
      await t.owner.query(`INSERT INTO order_items (restaurant_id, order_id, menu_item_id, qty, unit_price, status, sent_at) VALUES ($1,$2,$3,1,30,'enviado', now() - ($4 || ' minutes')::interval)`, [b.d.rid, o, p, String(minutos)]);
    };
    await nuevo(25); await b.dueno.post('/alertas/revisar');
    expect(await abiertas(b, 'demora_cocina')).toHaveLength(0);
    await nuevo(40); await b.dueno.post('/alertas/revisar');
    expect((await abiertas(b, 'demora_cocina')).map((x) => x.severidad)).toEqual(['media']);              // 40 > 30 pero < 60
  });
});

describe('Merma alta', () => {
  it('compara la merma de la semana con las ventas, cita lo que más pesó y se resuelve al bajar', async () => {
    const b = await base();
    const carne = (await b.dueno.post('/insumos', { nombre: 'Carne', unidad: 'kg' })).body.id as string; const bod = (await b.dueno.post('/almacenes', { nombre: 'Cocina' })).body.id as string;
    await b.dueno.post('/stock/movimientos', { tipo: 'compra', almacenId: bod, insumoId: carne, cantidad: 50, costoUnitario: 60 });
    await venta(b, 0, 1000);
    await b.dueno.post('/stock/movimientos', { tipo: 'merma', almacenId: bod, insumoId: carne, cantidad: 1, motivo: 'se echó a perder' });                  // Bs 60 = 6 %
    await b.dueno.post('/alertas/revisar');
    const a = (await abiertas(b, 'merma_alta'))[0];
    expect(a.severidad).toBe('media'); expect(a.mensaje).toMatch(/Bs 60\.00 en los últimos 7 días, 6\.00 % de las ventas \(el límite es 5 %\)/); expect(a.mensaje).toMatch(/Carne \(Bs 60\.00\)/);
    expect(a.datos).toMatchObject({ merma: '60.00', ingresos: '1000.00', mermaPct: '6.00', limitePct: 5 });
    await b.dueno.post('/stock/movimientos', { tipo: 'merma', almacenId: bod, insumoId: carne, cantidad: 1, motivo: 'otra vez' });                          // 12 %
    await b.dueno.post('/alertas/revisar');
    expect((await abiertas(b, 'merma_alta'))[0].severidad).toBe('alta');                                                                                    // más del doble del límite
    await venta(b, 0, 9000);                                                                                                                                  // las ventas suben: 1.2 %
    await b.dueno.post('/alertas/revisar');
    expect(await abiertas(b, 'merma_alta')).toHaveLength(0);
  });

  it('con poco movimiento no alerta (el porcentaje engañaría)', async () => {
    const b = await base();
    const carne = (await b.dueno.post('/insumos', { nombre: 'Carne', unidad: 'kg' })).body.id as string; const bod = (await b.dueno.post('/almacenes', { nombre: 'Cocina' })).body.id as string;
    await b.dueno.post('/stock/movimientos', { tipo: 'compra', almacenId: bod, insumoId: carne, cantidad: 5, costoUnitario: 60 });
    await venta(b, 0, 50); await b.dueno.post('/stock/movimientos', { tipo: 'merma', almacenId: bod, insumoId: carne, cantidad: 1, motivo: 'prueba' });
    await b.dueno.post('/alertas/revisar');
    expect(await abiertas(b, 'merma_alta')).toHaveLength(0);
  });
});

describe('Margen bajo', () => {
  it('detecta platos bajo el margen mínimo, con costo y precio, y se resuelve al corregir el precio', async () => {
    const b = await base();
    const carne = (await b.dueno.post('/insumos', { nombre: 'Carne', unidad: 'kg' })).body.id as string; const bod = (await b.dueno.post('/almacenes', { nombre: 'Cocina' })).body.id as string;
    await b.dueno.post('/stock/movimientos', { tipo: 'compra', almacenId: bod, insumoId: carne, cantidad: 50, costoUnitario: 100 });
    const caro = await b.plato('Pique', 100); const bueno = await b.plato('Milanesa', 100); await b.plato('Sin receta', 10);
    await b.cocina.post('/recetas', { platoId: caro, rendimiento: 1, mermaPct: 0, lineas: [{ insumoId: carne, cantidad: 800, unidad: 'g' }] });   // costo 80 → margen 20 %
    await b.cocina.post('/recetas', { platoId: bueno, rendimiento: 1, mermaPct: 0, lineas: [{ insumoId: carne, cantidad: 300, unidad: 'g' }] });  // costo 30 → margen 70 %
    await b.dueno.post('/alertas/revisar');
    const l = await abiertas(b, 'margen_bajo');
    expect(l).toHaveLength(1);
    expect(l[0].mensaje).toBe('«Pique» tiene margen de 20.00 %, por debajo del mínimo de 60.00 %: cuesta Bs 80.00 y se vende a Bs 100.00.');
    expect(l[0]).toMatchObject({ severidad: 'media', datos: { margenPct: '20.00', minimoPct: '60.00', costoPorPorcion: '80.00' } });
    await t.owner.query('UPDATE menu_items SET price = 40 WHERE id = $1', [caro]);                                                                      // ahora pierde plata
    await b.dueno.post('/alertas/revisar');
    expect((await abiertas(b, 'margen_bajo'))[0]).toMatchObject({ severidad: 'alta' });
    await t.owner.query('UPDATE menu_items SET price = 400 WHERE id = $1', [caro]);
    await b.dueno.post('/alertas/revisar');
    expect(await abiertas(b, 'margen_bajo')).toHaveLength(0);
  });
});

describe('Caída de ventas', () => {
  it('avisa cuando ayer vendió mucho menos de lo habitual del mismo día; queda como aviso', async () => {
    const b = await base();
    for (const k of [7, 14, 21, 28]) await venta(b, -1 - k, 500);                                          // mismo día de la semana, 4 semanas atrás
    await venta(b, -1, 100);
    await b.dueno.post('/alertas/revisar');
    const a = (await abiertas(b, 'ventas_bajas'))[0];
    expect(a.severidad).toBe('media'); expect(a.mensaje).toMatch(/solo el 20\.00 % de lo habitual para ese día \(Bs 500\.00\)/);
    expect(a.datos).toMatchObject({ ventas: '100.00', habitual: '500.00', porcentaje: '20.00', semanasComparadas: 4 });
    expect((await b.dueno.post('/alertas/revisar')).body.nuevas).toBe(0);
    expect(await abiertas(b, 'ventas_bajas')).toHaveLength(1);                                             // no se resuelve sola
  });

  it('un día normal o sin historia suficiente no alerta', async () => {
    const b = await base();
    for (const k of [7, 14]) await venta(b, -1 - k, 500);                                                  // solo 2 semanas: insuficiente
    await b.dueno.post('/alertas/revisar');
    expect(await abiertas(b, 'ventas_bajas')).toHaveLength(0);
    const c = await base();
    for (const k of [7, 14, 21, 28]) await venta(c, -1 - k, 500);
    await venta(c, -1, 400);                                                                               // 80 %: dentro de lo normal
    await c.dueno.post('/alertas/revisar');
    expect(await abiertas(c, 'ventas_bajas')).toHaveLength(0);
  });
});

describe('Permisos, resolución manual y aislamiento', () => {
  it('lee quien administra o lleva las cuentas; revisa y resuelve solo dueño y administración; otra sucursal no ve nada', async () => {
    const b = await base(); const o = await base(); const p = await b.plato('Milanesa', 48, 10);
    const ord = (await t.owner.query(`INSERT INTO orders (restaurant_id, channel, order_type, status, ticket_number, subtotal, total, sent_at) VALUES ($1,'caja','mostrador','en_preparacion',1,48,48, now() - interval '50 minutes') RETURNING id`, [b.d.rid])).rows[0].id as string;
    await t.owner.query(`INSERT INTO order_items (restaurant_id, order_id, menu_item_id, qty, unit_price, status, sent_at) VALUES ($1,$2,$3,1,48,'enviado', now() - interval '50 minutes')`, [b.d.rid, ord, p]);
    expect((await b.mesero.post('/alertas/revisar')).status).toBe(403);
    expect((await b.contador.post('/alertas/revisar')).status).toBe(403);
    expect((await b.mesero.get('/alertas')).status).toBe(403);
    await b.dueno.post('/alertas/revisar');
    expect(((await b.contador.get('/alertas')).body as unknown[]).length).toBe(1);
    expect(await abiertas(o)).toHaveLength(0);
    const id = (await abiertas(b))[0].id;
    expect((await b.contador.post(`/alertas/${id}/resolver`)).status).toBe(403);
    expect((await o.dueno.post(`/alertas/${id}/resolver`)).status).toBe(404);
    expect((await b.dueno.post(`/alertas/${id}/resolver`)).status).toBe(200);
    expect((await b.dueno.post(`/alertas/${id}/resolver`)).status).toBe(404);
    expect((await b.dueno.get('/alertas?estado=raro')).status).toBe(400);
    expect((await b.dueno.get('/alertas?tipo=inventada')).status).toBe(400);
    expect(((await b.dueno.get('/alertas?estado=todas')).body as unknown[]).length).toBe(1);
  });
});
