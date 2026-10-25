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
  const prov = async (nombre: string, extra: object = {}) => (await dueno.post('/proveedores', { nombre, ...extra })).body.id as string;
  const ins = async (nombre: string, unidad: string, extra: object = {}) => (await dueno.post('/insumos', { nombre, unidad, ...extra })).body.id as string;
  const almacen = (await dueno.post('/almacenes', { nombre: 'Cocina' })).body.id as string;
  const bodega = (await dueno.post('/almacenes', { nombre: 'Bodega' })).body.id as string;
  const andina = await prov('Distribuidora Andina', { diasEntrega: 2, diasCredito: 15 });
  const carnes = await prov('Carnes del Valle', { diasEntrega: 1 });
  const carne = await ins('Carne', 'kg'); const papa = await ins('Papa', 'kg');
  return { d, dueno, almacen, bodega, andina, carnes, carne, papa, almacenista: await alta('almacen'), contador: await alta('contador'), mesero: await alta('mesero'), chef: await alta('cocina') };
}
type E = Awaited<ReturnType<typeof escenario>>;
const orden = (e: E, proveedorId: string, lineas: [string, number, number][], extra: object = {}) => e.almacenista.post('/ordenes-de-compra', { proveedorId, ...extra, lineas: lineas.map(([insumoId, cantidad, costoUnitario]) => ({ insumoId, cantidad, costoUnitario })) });
const enviada = async (e: E, proveedorId: string, lineas: [string, number, number][]) => { const o = await orden(e, proveedorId, lineas); await e.almacenista.post(`/ordenes-de-compra/${o.body.id}/enviar`); return o.body.id as string; };
const recibir = (e: E, id: string, lineas: [string, number, number?][], extra: object = {}) => e.almacenista.post(`/ordenes-de-compra/${id}/recibir`, { almacenId: e.almacen, ...extra, lineas: lineas.map(([insumoId, cantidad, costoUnitario]) => ({ insumoId, cantidad, ...(costoUnitario !== undefined ? { costoUnitario } : {}) })) });
const stock = async (e: E, insumoId: string) => ((await e.dueno.get('/insumos')).body as { id: string; stock: string }[]).find((i) => i.id === insumoId)!.stock;

describe('Proveedores', () => {
  it('alta, edición y roles; nombre repetido 409', async () => {
    const e = await escenario();
    expect((await e.dueno.post('/proveedores', { nombre: 'Distribuidora Andina' })).status).toBe(409);
    expect((await e.dueno.post('/proveedores', { nombre: 'distribuidora andina' })).status).toBe(409); // sin distinguir mayúsculas
    expect((await e.dueno.patch(`/proveedores/${e.andina}`, { nombre: 'Distribuidora Andina', nit: '1020304050', diasEntrega: 3, diasCredito: 30 })).status).toBe(200);
    const lista = (await e.almacenista.get('/proveedores')).body;
    expect(lista.find((p: { id: string }) => p.id === e.andina)).toMatchObject({ nit: '1020304050', diasEntrega: 3, diasCredito: 30 });
    expect((await e.mesero.get('/proveedores')).status).toBe(403);
    expect((await e.mesero.post('/proveedores', { nombre: 'X Y' })).status).toBe(403);
  });
});

describe('Órdenes de compra y recepción', () => {
  it('crea la orden en borrador con el total exacto; hay que enviarla antes de recibir', async () => {
    const e = await escenario();
    const o = await orden(e, e.andina, [[e.carne, 10, 20.5], [e.papa, 5, 8]]);
    expect(o.status).toBe(201);
    expect(o.body).toMatchObject({ estado: 'borrador', total: '245.00', proveedor: 'Distribuidora Andina' });
    expect(o.body.lineas).toHaveLength(2);
    expect((await recibir(e, o.body.id, [[e.carne, 1]])).status).toBe(409);
    expect((await e.almacenista.post(`/ordenes-de-compra/${o.body.id}/enviar`)).body.estado).toBe('enviada');
    expect((await e.almacenista.post(`/ordenes-de-compra/${o.body.id}/enviar`)).status).toBe(409);
  });

  it('valida: insumo repetido, proveedor ajeno, cantidades con más decimales', async () => {
    const e = await escenario();
    expect((await orden(e, e.andina, [[e.carne, 1, 1], [e.carne, 2, 1]])).status).toBe(400);
    expect((await orden(e, randomUUID(), [[e.carne, 1, 1]])).status).toBe(400);
    expect((await orden(e, e.andina, [[e.carne, 1.2345, 1]])).status).toBe(400);
    expect((await orden(e, e.andina, [[randomUUID(), 1, 1]])).status).toBe(400);
  });

  it('recepción parcial: entra al kardex, la orden queda abierta por el saldo y nace la cuenta por pagar', async () => {
    const e = await escenario();
    const id = await enviada(e, e.andina, [[e.carne, 10, 20]]);
    const r1 = await recibir(e, id, [[e.carne, 6]], { factura: 'F-0012' });
    expect(r1.status).toBe(200);
    expect(r1.body.totalRecibido).toBe('120.00');
    expect(r1.body.orden.estado).toBe('parcial');
    expect(r1.body.orden.lineas[0]).toMatchObject({ pedido: '10.000', recibido: '6.000', pendiente: '4.000' });
    expect(await stock(e, e.carne)).toBe('6.000');
    const pp = (await e.contador.get('/por-pagar')).body;
    expect(pp).toHaveLength(1);
    expect(pp[0]).toMatchObject({ proveedor: 'Distribuidora Andina', monto: '120.00', saldo: '120.00', documento: 'F-0012', vencida: false });
    expect(pp[0].dias).toBe(15); // plazo de crédito del proveedor
    const r2 = await recibir(e, id, [[e.carne, 4, 22]]);
    expect(r2.body.orden.estado).toBe('recibida');
    expect(await stock(e, e.carne)).toBe('10.000');
    expect(r2.body.orden.recepciones).toHaveLength(2);
    const costo = (await e.dueno.get('/insumos')).body.find((i: { id: string }) => i.id === e.carne);
    expect(costo.costoPromedio).toBe('20.8000'); // (6×20 + 4×22) ÷ 10
    expect((await recibir(e, id, [[e.carne, 1]])).status).toBe(409); // ya cerrada
    const dif = await t.owner.query(`SELECT ordered_qty::text, pending_before::text, received_qty::text FROM purchase_receipt_lines ORDER BY received_qty ASC LIMIT 1`);
    expect(dif.rows[0]).toMatchObject({ ordered_qty: '10.000', pending_before: '4.000', received_qty: '4.000' });
  });

  it('se puede recibir más de lo pedido (queda registrado); un insumo que no está en la orden no entra', async () => {
    const e = await escenario();
    const id = await enviada(e, e.andina, [[e.carne, 5, 20]]);
    expect((await recibir(e, id, [[e.papa, 1]])).status).toBe(400);
    const r = await recibir(e, id, [[e.carne, 7]]);
    expect(r.body.orden.estado).toBe('recibida');
    expect(r.body.orden.lineas[0]).toMatchObject({ pedido: '5.000', recibido: '7.000', pendiente: '0.000' });
  });

  it('cancelar solo antes de recibir; una orden con recepciones no se cancela', async () => {
    const e = await escenario();
    const a = await orden(e, e.andina, [[e.carne, 1, 1]]);
    expect((await e.almacenista.post(`/ordenes-de-compra/${a.body.id}/cancelar`)).body.estado).toBe('cancelada');
    const id = await enviada(e, e.andina, [[e.carne, 5, 20]]);
    await recibir(e, id, [[e.carne, 2]]);
    expect((await e.almacenista.post(`/ordenes-de-compra/${id}/cancelar`)).status).toBe(409);
  });

  it('el historial de precios compara proveedores y alerta un alza mayor al 10 %', async () => {
    const e = await escenario();
    await recibir(e, await enviada(e, e.andina, [[e.carne, 5, 20]]), [[e.carne, 5]]);
    await recibir(e, await enviada(e, e.carnes, [[e.carne, 5, 18]]), [[e.carne, 5]]);
    const sube5 = await recibir(e, await enviada(e, e.andina, [[e.carne, 1, 21]]), [[e.carne, 1]]); // +5 %
    expect(sube5.body.alertasDePrecio).toEqual([]);
    const sube = await recibir(e, await enviada(e, e.andina, [[e.carne, 1, 25]]), [[e.carne, 1]]); // 21 → 25 = +19.05 %
    expect(sube.body.alertasDePrecio[0]).toMatchObject({ insumo: 'Carne', anterior: '21.0000', nuevo: '25.0000', alzaPct: '19.05' });
    const al = await t.owner.query(`SELECT message FROM alerts WHERE restaurant_id = $1 AND kind = 'precio_alto'`, [e.d.rid]);
    expect(al.rowCount).toBe(1);
    const p = (await e.almacenista.get(`/insumos/${e.carne}/precios`)).body;
    expect(p.historial).toHaveLength(4);
    expect(p.comparacion.map((x: { proveedor: string; costo: string }) => `${x.proveedor}:${Number(x.costo)}`)).toEqual(['Carnes del Valle:18', 'Distribuidora Andina:25']);
  });

  it('otra sucursal no ve ni recibe mi orden', async () => {
    const a = await escenario(); const b = await escenario();
    const id = await enviada(a, a.andina, [[a.carne, 1, 1]]);
    expect((await b.almacenista.get(`/ordenes-de-compra/${id}`)).status).toBe(404);
    expect((await recibir(b, id, [[b.carne, 1]])).status).toBe(404);
    expect((await b.almacenista.get('/ordenes-de-compra')).body).toEqual([]);
  });
});

describe('Cuentas por pagar', () => {
  it('pago parcial y total; no se paga de más; el mesero no entra', async () => {
    const e = await escenario();
    await recibir(e, await enviada(e, e.carnes, [[e.carne, 10, 30]]), [[e.carne, 10]]);
    const id = (await e.contador.get('/por-pagar')).body[0].id as string;
    expect((await e.contador.post(`/por-pagar/${id}/pagar`, { monto: 400 })).status).toBe(400);
    expect((await e.contador.post(`/por-pagar/${id}/pagar`, { monto: 100 })).body.saldo).toBe('200.00');
    expect((await e.contador.get('/por-pagar')).body[0]).toMatchObject({ pagado: '100.00', saldo: '200.00' });
    expect((await e.contador.post(`/por-pagar/${id}/pagar`, {})).body.saldo).toBe('0.00');
    expect((await e.contador.get('/por-pagar')).body).toEqual([]);
    expect((await e.contador.get('/por-pagar?todas=1')).body).toHaveLength(1);
    expect((await e.contador.post(`/por-pagar/${id}/pagar`, {})).status).toBe(409);
    expect((await e.mesero.get('/por-pagar')).status).toBe(403);
    expect((await e.almacenista.post(`/por-pagar/${id}/pagar`, {})).status).toBe(403);
    const log = await t.owner.query(`SELECT 1 FROM audit_log WHERE restaurant_id = $1 AND action = 'compras.pago_proveedor'`, [e.d.rid]);
    expect(log.rowCount).toBe(2);
  });
});

describe('Sugerencias y plan del día → órdenes', () => {
  it('stock bajo mínimo: agrupa por proveedor preferido; lo que no tiene proveedor se avisa aparte', async () => {
    const e = await escenario();
    await e.dueno.patch(`/insumos/${e.carne}`, { nombre: 'Carne', unidad: 'kg', minimo: 10, proveedorPreferidoId: e.carnes });
    await e.dueno.patch(`/insumos/${e.papa}`, { nombre: 'Papa', unidad: 'kg', minimo: 20 }); // sin proveedor preferido
    await e.dueno.post('/stock/movimientos', { tipo: 'compra', almacenId: e.almacen, insumoId: e.carne, cantidad: 2, costoUnitario: 30 });
    const s = (await e.almacenista.get('/compras/sugerencias')).body;
    expect(s.proveedores).toHaveLength(1);
    expect(s.proveedores[0]).toMatchObject({ proveedor: 'Carnes del Valle', lineas: [{ insumo: 'Carne', cantidad: '8.000', costoUnitario: '30.0000' }] });
    expect(s.sinProveedor[0]).toMatchObject({ insumo: 'Papa', cantidad: '20.000' });
    const gen = (await e.almacenista.post('/compras/sugerencias/ordenes')).body;
    expect(gen.ordenes).toHaveLength(1);
    expect(gen.ordenes[0]).toMatchObject({ proveedor: 'Carnes del Valle', total: '240.00', lineas: 1 });
    const hoyMas1 = (await t.owner.query(`SELECT ((now() AT TIME ZONE 'America/La_Paz')::date + 1)::text AS d`)).rows[0].d;
    expect(gen.ordenes[0].esperadaEl).toBe(hoyMas1); // días de entrega del proveedor
    expect((await e.almacenista.get(`/ordenes-de-compra/${gen.ordenes[0].id}`)).body.estado).toBe('borrador');
  });

  it('desde el plan del día: una orden por proveedor con lo que falta; marca si llega tarde; sin faltantes no hay orden', async () => {
    const e = await escenario();
    await e.dueno.patch(`/insumos/${e.carne}`, { nombre: 'Carne', unidad: 'kg', minimo: 0, proveedorPreferidoId: e.andina }); // entrega en 2 días
    const plato = (await e.dueno.post('/menu/platos', { nombre: 'Milanesa', precio: 48 })).body.id;
    await e.chef.post('/recetas', { platoId: plato, rendimiento: 1, mermaPct: 0, lineas: [{ insumoId: e.carne, cantidad: 200, unidad: 'g' }] });
    const hoy = (await t.owner.query(`SELECT (now() AT TIME ZONE 'America/La_Paz')::date::text AS d`)).rows[0].d;
    await e.chef.put(`/plan-del-dia/${hoy}`, { items: [{ platoId: plato, porciones: 40 }] });
    const r = await e.almacenista.post(`/plan-del-dia/${hoy}/ordenes-de-compra`);
    expect(r.status).toBe(200);
    expect(r.body.ordenes[0]).toMatchObject({ proveedor: 'Distribuidora Andina', tarde: true, lineas: 1 }); // el plan es hoy y llega en 2 días
    const det = (await e.almacenista.get(`/ordenes-de-compra/${r.body.ordenes[0].id}`)).body;
    expect(det.lineas[0]).toMatchObject({ insumo: 'Carne', pedido: '8.000' });
    expect(det.planDelDia).toBe(hoy);
    await e.dueno.post('/stock/movimientos', { tipo: 'compra', almacenId: e.almacen, insumoId: e.carne, cantidad: 20, costoUnitario: 30 });
    expect((await e.almacenista.post(`/plan-del-dia/${hoy}/ordenes-de-compra`)).status).toBe(400);
    expect((await e.chef.post(`/plan-del-dia/${hoy}/ordenes-de-compra`)).status).toBe(403); // cocina planifica, no compra
  });
});

describe('Descuento de insumos al enviar a cocina', () => {
  async function conReceta(e: E) {
    await e.dueno.post('/stock/movimientos', { tipo: 'compra', almacenId: e.almacen, insumoId: e.carne, cantidad: 10, costoUnitario: 60 });
    const mesa = (await e.dueno.post('/mesas', { numero: '1', asientos: 4 })).body.id as string;
    const milanesa = (await e.dueno.post('/menu/platos', { nombre: 'Milanesa', precio: 48 })).body.id as string;
    const agua = (await e.dueno.post('/menu/platos', { nombre: 'Agua', precio: 8 })).body.id as string; // sin receta
    await e.chef.post('/recetas', { platoId: milanesa, rendimiento: 1, mermaPct: 5, lineas: [{ insumoId: e.carne, cantidad: 200, unidad: 'g' }] });
    return { mesa, milanesa, agua };
  }
  const pedir = async (e: E, mesa: string, items: [string, number][]) => {
    const p = (await e.dueno.post('/pedidos', { tipo: 'mesa', mesaId: mesa })).body.pedido;
    await e.dueno.post(`/pedidos/${p.id}/items`, { items: items.map(([platoId, cantidad]) => ({ platoId, cantidad })) });
    return p.id as string;
  };

  it('guardar no descuenta; enviar a cocina sí, con la fórmula de la receta (porciones × cantidad × merma)', async () => {
    const e = await escenario(); const { mesa, milanesa } = await conReceta(e);
    const id = await pedir(e, mesa, [[milanesa, 3]]);
    expect(await stock(e, e.carne)).toBe('10.000');
    expect((await e.dueno.post(`/pedidos/${id}/enviar`)).status).toBe(200);
    expect(await stock(e, e.carne)).toBe('9.370'); // 3 × 0.2 kg × 1.05 = 0.63
    const m = await t.owner.query(`SELECT kind, qty::text, ref_type FROM stock_movements WHERE ingredient_id = $1 AND kind = 'consumo'`, [e.carne]);
    expect(m.rows).toEqual([{ kind: 'consumo', qty: '-0.630', ref_type: 'order_item' }]);
  });

  it('un plato sin receta se vende y no descuenta; reenviar no descuenta dos veces', async () => {
    const e = await escenario(); const { mesa, milanesa, agua } = await conReceta(e);
    const id = await pedir(e, mesa, [[agua, 2]]);
    expect((await e.dueno.post(`/pedidos/${id}/enviar`)).status).toBe(200);
    expect(await stock(e, e.carne)).toBe('10.000');
    await e.dueno.post(`/pedidos/${id}/items`, { items: [{ platoId: milanesa, cantidad: 1 }] });
    await e.dueno.post(`/pedidos/${id}/enviar`);
    expect(await stock(e, e.carne)).toBe('9.790'); // solo la milanesa nueva
    expect((await e.dueno.post(`/pedidos/${id}/enviar`)).status).toBe(409);
    expect(await stock(e, e.carne)).toBe('9.790');
  });

  it('el stock puede quedar en negativo sin frenar la venta, y genera una sola alerta que se resuelve al reponer', async () => {
    const e = await escenario(); const { mesa, milanesa } = await conReceta(e);
    await e.dueno.patch(`/insumos/${e.carne}`, { nombre: 'Carne', unidad: 'kg', minimo: 5, proveedorPreferidoId: e.carnes });
    const id = await pedir(e, mesa, [[milanesa, 60]]); // 60 × 0.21 = 12.6 kg y hay 10
    expect((await e.dueno.post(`/pedidos/${id}/enviar`)).status).toBe(200);
    expect(await stock(e, e.carne)).toBe('-2.600');
    const abiertas = async () => (await t.owner.query(`SELECT severity FROM alerts WHERE restaurant_id = $1 AND kind = 'stock_bajo' AND resolved_at IS NULL`, [e.d.rid])).rows;
    expect(await abiertas()).toEqual([{ severity: 'alta' }]);
    const mesa2 = (await e.dueno.post('/mesas', { numero: '2', asientos: 2 })).body.id as string;
    const id2 = await pedir(e, mesa2, [[milanesa, 1]]);
    await e.dueno.post(`/pedidos/${id2}/enviar`);
    expect(await abiertas()).toHaveLength(1); // sigue siendo una sola alerta abierta
    const oc = await enviada(e, e.carnes, [[e.carne, 30, 60]]);
    await recibir(e, oc, [[e.carne, 30]]);
    expect(await abiertas()).toEqual([]); // se repuso: la alerta se resolvió sola
  });

  it('consume del almacén configurado en el insumo y respeta primero en vencer, primero en salir', async () => {
    const e = await escenario(); const { mesa, milanesa } = await conReceta(e);
    await e.dueno.patch(`/insumos/${e.carne}`, { nombre: 'Carne', unidad: 'kg', minimo: 0, almacenConsumoId: e.bodega });
    await e.dueno.post('/stock/movimientos', { tipo: 'compra', almacenId: e.bodega, insumoId: e.carne, cantidad: 1, costoUnitario: 60, lote: 'TARDE', vence: '2030-05-01' });
    await e.dueno.post('/stock/movimientos', { tipo: 'compra', almacenId: e.bodega, insumoId: e.carne, cantidad: 0.3, costoUnitario: 60, lote: 'PRONTO', vence: '2030-01-01' });
    await e.dueno.post(`/pedidos/${await pedir(e, mesa, [[milanesa, 2]])}/enviar`); // 0.42 kg
    const f = await t.owner.query(`SELECT lot, sum(qty)::text AS saldo FROM stock_movements WHERE ingredient_id = $1 AND lot IS NOT NULL GROUP BY lot ORDER BY lot`, [e.carne]);
    expect(f.rows).toEqual([{ lot: 'PRONTO', saldo: '0.000' }, { lot: 'TARDE', saldo: '0.880' }]);
    const niveles = (await e.dueno.get(`/stock/niveles?almacenId=${e.bodega}`)).body.find((n: { insumoId: string }) => n.insumoId === e.carne);
    expect(niveles.cantidad).toBe('0.880');
  });

  it('con sub-receta descuenta los insumos básicos; el pedido por QR sin confirmación también descuenta', async () => {
    const e = await escenario();
    const tomate = (await e.dueno.post('/insumos', { nombre: 'Tomate', unidad: 'kg' })).body.id as string;
    const salsa = (await e.dueno.post('/insumos', { nombre: 'Salsa', unidad: 'l' })).body.id as string;
    await e.dueno.post('/stock/movimientos', { tipo: 'compra', almacenId: e.almacen, insumoId: tomate, cantidad: 10, costoUnitario: 10 });
    await e.chef.post('/recetas', { insumoId: salsa, rendimiento: 2, mermaPct: 0, lineas: [{ insumoId: tomate, cantidad: 1, unidad: 'kg' }] });
    const plato = (await e.dueno.post('/menu/platos', { nombre: 'Pasta', precio: 40 })).body.id as string;
    await e.chef.post('/recetas', { platoId: plato, rendimiento: 1, mermaPct: 0, lineas: [{ insumoId: salsa, cantidad: 200, unidad: 'ml' }] });
    const mesa = (await e.dueno.post('/mesas', { numero: '9', asientos: 2 })).body.id as string;
    const qr = ((await e.dueno.get('/mesas')).body.find((m: { id: string }) => m.id === mesa).urlQr as string).split('/m/')[1];
    await e.dueno.patch('/sucursal/ajustes', { qrSinConfirmacion: true });
    const tk = (await t.api().post('/api/v1/qr/sesion').send({ qrToken: qr })).body.token;
    const r = await t.api().post('/api/v1/qr/pedidos').set('Authorization', `Bearer ${tk}`).send({ items: [{ platoId: plato, cantidad: 5 }] });
    expect(r.body.estado).toBe('enviado');
    expect(await stock(e, tomate)).toBe('9.500'); // 5 × 0.2 l = 1 l de salsa = 0.5 kg de tomate
    expect(await stock(e, salsa)).toBe('0.000'); // la salsa no se almacena: se expande
  });
});
