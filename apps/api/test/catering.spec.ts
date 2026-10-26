import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { levantar } from './util';

let t: Awaited<ReturnType<typeof levantar>>;
beforeAll(async () => { t = await levantar(); });
afterAll(async () => { await t.cerrar(); });

const laPaz = (dias: number) => new Date(Date.now() - 4 * 3_600_000 + dias * 86_400_000).toISOString().slice(0, 10);

/** Restaurante con un plato con receta (200 g de carne a Bs 60/kg → costo 12), stock de 10 kg y un plato sin receta. */
async function escenario() {
  const d = await t.nuevoRestaurante();
  const dueno = t.con(d.token, d.rid);
  const alta = async (rol: string) => { const a = await dueno.post('/personal', { nombre: `Persona ${rol}`, correo: `${randomUUID()}@t.bo`, roles: [rol] }); const s = await t.entrarConCodigo(a.body.codigo); return t.con(s.token, d.rid); };
  const [cajero, cocina, contador, mesero, almacen] = [await alta('cajero'), await alta('cocina'), await alta('contador'), await alta('mesero'), await alta('almacen')];
  const carne = (await dueno.post('/insumos', { nombre: 'Carne', unidad: 'kg' })).body.id as string;
  const bodega = (await dueno.post('/almacenes', { nombre: 'Cocina' })).body.id as string;
  const pique = (await dueno.post('/menu/platos', { nombre: 'Pique Macho', precio: 65 })).body.id as string;
  const postre = (await dueno.post('/menu/platos', { nombre: 'Helado', precio: 20 })).body.id as string;
  expect((await cocina.post('/recetas', { platoId: pique, rendimiento: 1, mermaPct: 0, lineas: [{ insumoId: carne, cantidad: 200, unidad: 'g' }] })).status).toBe(201);
  await dueno.post('/stock/movimientos', { tipo: 'compra', almacenId: bodega, insumoId: carne, cantidad: 10, costoUnitario: 60 });
  const prov = (await dueno.post('/proveedores', { nombre: 'Carnes del Valle' })).body.id as string;
  await dueno.patch(`/insumos/${carne}`, { nombre: 'Carne', unidad: 'kg', proveedorPreferidoId: prov });
  return { d, dueno, cajero, cocina, contador, mesero, almacen, carne, bodega, pique, postre, prov };
}
type E = Awaited<ReturnType<typeof escenario>>;
const evento = (extra: object = {}) => ({ nombre: 'Boda Quispe', tipo: 'evento', cliente: 'Familia Quispe', telefono: '70012345', invitados: 100, fecha: laPaz(10), horaInicio: '19:00', horaFin: '23:30', precio: 6500, ...extra });
const crear = async (e: E, extra: object = {}) => (await e.dueno.post('/eventos', evento(extra))).body.id as string;
const conMenu = async (e: E, porciones = 100) => { const id = await crear(e); expect((await e.dueno.put(`/eventos/${id}/menu`, { platos: [{ platoId: e.pique, porciones }, { platoId: e.postre, porciones }] })).status).toBe(200); return id; };
const asientos = async (e: E, origen: string) => (await e.contador.get(`/contabilidad/asientos?origen=${origen}`)).body as { id: string; total: string }[];
const saldoDe = async (e: E, codigo: string) => (await e.contador.get(`/contabilidad/reportes/mayor/${codigo}`)).body.saldoFinal as string;

describe('Cotización', () => {
  it('crea el evento cotizado; la cotización usa el costo de las recetas, el margen del precio pactado y avisa lo que no tiene receta', async () => {
    const e = await escenario(); const id = await conMenu(e, 100);
    const d = (await e.dueno.get(`/eventos/${id}`)).body;
    expect(d).toMatchObject({ estado: 'cotizado', nombre: 'Boda Quispe', invitados: 100, fecha: laPaz(10), horaInicio: '19:00', horaFin: '23:30', precio: '6500.00', pagado: '0.00', saldo: '6500.00' });
    expect(d.cotizacion).toMatchObject({ ventaACarta: '8500.00', costo: '1200.00', precioPactado: '6500.00', utilidad: '5300.00', margenPct: '81.54', porInvitado: '65.00', sinReceta: ['Helado'], hayFaltantes: true });
    const carne = d.cotizacion.insumos.find((i: { insumo: string }) => i.insumo === 'Carne');
    expect(carne).toMatchObject({ requerido: '20.000', stock: '10.000', faltante: '10.000', alcanza: false });   // 100 × 200 g = 20 kg, hay 10
  });

  it('valida datos, horas y permisos', async () => {
    const e = await escenario();
    expect((await e.dueno.post('/eventos', evento({ horaFin: '18:00' }))).status).toBe(400);
    expect((await e.dueno.post('/eventos', evento({ invitados: 0 }))).status).toBe(400);
    expect((await e.dueno.post('/eventos', evento({ precio: 10.555 }))).status).toBe(400);
    expect((await e.dueno.post('/eventos', evento({ tipo: 'fiesta' }))).status).toBe(400);
    expect((await e.dueno.post('/eventos', evento({ estado: 'cerrado' }))).status).toBe(400);   // .strict()
    expect((await e.cajero.post('/eventos', evento())).status).toBe(403);
    expect((await e.mesero.get('/eventos')).status).toBe(403);
    expect((await e.cocina.get('/eventos')).status).toBe(200);
    const id = await crear(e);
    expect((await e.dueno.put(`/eventos/${id}/menu`, { platos: [{ platoId: e.pique, porciones: 5 }, { platoId: e.pique, porciones: 6 }] })).status).toBe(400);
    expect((await e.dueno.put(`/eventos/${id}/menu`, { platos: [{ platoId: randomUUID(), porciones: 5 }] })).status).toBe(400);
    expect((await e.dueno.put(`/eventos/${id}`, evento({ nombre: 'Boda Quispe Rojas', invitados: 120 }))).status).toBe(200);
    expect((await e.dueno.get(`/eventos/${id}`)).body).toMatchObject({ nombre: 'Boda Quispe Rojas', invitados: 120 });
  });

  it('genera órdenes de compra en borrador con lo que falta; si el stock alcanza, avisa', async () => {
    const e = await escenario(); const id = await conMenu(e, 100);
    const r = await e.almacen.post(`/eventos/${id}/ordenes-de-compra`);
    expect(r.status).toBe(200);
    expect(r.body.ordenes).toHaveLength(1);
    expect(r.body.ordenes[0]).toMatchObject({ proveedor: 'Carnes del Valle', lineas: 1 });
    const orden = (await e.dueno.get(`/ordenes-de-compra/${r.body.ordenes[0].id}`)).body;
    expect(orden.lineas[0]).toMatchObject({ insumo: 'Carne', pedido: '10.000' });
    const chico = await conMenu(e, 10);                               // 2 kg: alcanza
    expect((await e.almacen.post(`/eventos/${chico}/ordenes-de-compra`)).status).toBe(400);
  });
});

describe('Confirmación, cobros y cierre', () => {
  it('flujo completo: anticipo → confirmar → iniciar (consume insumos) → saldo → cerrar; los asientos cuadran', async () => {
    const e = await escenario(); const id = await conMenu(e, 50);   // 10 kg de carne = justo el stock; costo 600
    expect((await e.dueno.post(`/eventos/${id}/estado`, { accion: 'iniciar' })).status).toBe(409);   // aún cotizado
    expect((await e.cajero.post(`/eventos/${id}/cobros`, { monto: 2000, via: 'bancos' })).status).toBe(200);
    expect(await saldoDe(e, '2.1.04')).toBe('2000.00');                 // anticipos de clientes (pasivo)
    expect(await saldoDe(e, '4.1.01')).toBe('0.00');                    // todavía no es venta
    expect((await e.cocina.post(`/eventos/${id}/estado`, { accion: 'confirmar' })).status).toBe(403);   // cocina no confirma
    expect((await e.dueno.post(`/eventos/${id}/estado`, { accion: 'confirmar' })).status).toBe(200);
    expect((await e.dueno.post(`/eventos/${id}/cerrar`, {})).status).toBe(409);                           // no está en curso
    const ini = await e.cocina.post(`/eventos/${id}/estado`, { accion: 'iniciar' });
    expect(ini.status).toBe(200); expect(ini.body).toMatchObject({ estado: 'en_curso', insumosDescontados: 1 });
    expect(((await e.dueno.get('/insumos')).body as { id: string; stock: string }[]).find((i) => i.id === e.carne)!.stock).toBe('0.000');
    expect((await asientos(e, 'costo_evento'))[0].total).toBe('600.00');
    expect((await e.dueno.post(`/eventos/${id}/estado`, { accion: 'iniciar' })).status).toBe(409);        // una sola vez
    const saldo = await e.cajero.post(`/eventos/${id}/cobros`, { monto: 2500, via: 'caja' });
    expect(saldo.status).toBe(200); expect(saldo.body.saldo).toBe('2000.00');
    expect((await e.dueno.get(`/eventos/${id}`)).body.pagos.map((p: { tipo: string }) => p.tipo)).toEqual(['anticipo', 'saldo']);
    const c = await e.dueno.post(`/eventos/${id}/cerrar`, { diasCredito: 10 });
    expect(c.status).toBe(200); expect(c.body.porCobrar).toBe('2000.00');
    expect(await saldoDe(e, '4.1.01')).toBe('6500.00');                 // ingreso reconocido al cerrar
    expect(await saldoDe(e, '2.1.04')).toBe('0.00');                    // los anticipos pasaron a ventas
    expect(await saldoDe(e, '1.1.03')).toBe('2000.00');                 // el resto, por cobrar al cliente
    const cuenta = (await e.contador.get('/por-cobrar')).body[0];
    expect(cuenta).toMatchObject({ cliente: 'Familia Quispe', saldo: '2000.00', dias: 10 });
    expect((await e.contador.post(`/por-cobrar/${cuenta.id}/cobrar`, { via: 'bancos' })).status).toBe(200);
    expect((await e.contador.get('/contabilidad/reportes/comprobacion')).body.cuadra).toBe(true);
    expect((await e.contador.get('/contabilidad/reportes/balance')).body.cuadra).toBe(true);
    expect((await e.dueno.post(`/eventos/${id}/cobros`, { monto: 1 })).status).toBe(409);                 // cerrado
    expect((await e.dueno.put(`/eventos/${id}`, evento())).status).toBe(409);
  });

  it('confirmar exige precio; los cobros no superan el precio ni se aceptan sin precio', async () => {
    const e = await escenario();
    const sin = await crear(e, { precio: null });
    expect((await e.dueno.post(`/eventos/${sin}/estado`, { accion: 'confirmar' })).status).toBe(400);
    expect((await e.cajero.post(`/eventos/${sin}/cobros`, { monto: 100 })).status).toBe(400);
    const id = await crear(e, { precio: 1000 });
    expect((await e.cajero.post(`/eventos/${id}/cobros`, { monto: 1000.01 })).status).toBe(400);
    expect((await e.cajero.post(`/eventos/${id}/cobros`, { monto: 0 })).status).toBe(400);
    expect((await e.cajero.post(`/eventos/${id}/cobros`, { monto: 600 })).status).toBe(200);
    expect((await e.cajero.post(`/eventos/${id}/cobros`, { monto: 500 })).status).toBe(400);   // supera el saldo (400)
    expect((await e.dueno.put(`/eventos/${id}`, evento({ precio: 500 }))).status).toBe(400);   // menos de lo ya cobrado
    expect((await e.cocina.post(`/eventos/${id}/cobros`, { monto: 10 })).status).toBe(403);
  });

  it('cancelar con cobros exige devolverlos: el cobro queda anulado y su asiento contrarrestado', async () => {
    const e = await escenario(); const id = await crear(e, { precio: 3000 });
    await e.cajero.post(`/eventos/${id}/cobros`, { monto: 1000, via: 'caja' });
    expect((await e.dueno.post(`/eventos/${id}/cancelar`, { motivo: 'cliente desistió' })).status).toBe(409);
    const c = await e.dueno.post(`/eventos/${id}/cancelar`, { motivo: 'cliente desistió', devolver: true });
    expect(c.status).toBe(200); expect(c.body.devuelto).toBe('1000.00');
    const d = (await e.dueno.get(`/eventos/${id}`)).body;
    expect(d).toMatchObject({ estado: 'cancelado', pagado: '0.00' }); expect(d.pagos[0].anulado).toBe(true);
    expect(await saldoDe(e, '2.1.04')).toBe('0.00'); expect(await saldoDe(e, '1.1.01')).toBe('-600.00');   // solo queda la compra de carne: el cobro se devolvió
    expect((await e.dueno.post(`/eventos/${id}/cancelar`, { motivo: 'otra vez', devolver: true })).status).toBe(409);
    expect((await e.dueno.post('/eventos', evento())).status).toBe(201);
  });

  it('un evento en curso no se cancela (ya consumió insumos) y otra sucursal no lo ve (RLS)', async () => {
    const e = await escenario(); const o = await escenario();
    const id = await conMenu(e, 10);
    await e.dueno.post(`/eventos/${id}/estado`, { accion: 'confirmar' }); await e.dueno.post(`/eventos/${id}/estado`, { accion: 'iniciar' });
    expect((await e.dueno.post(`/eventos/${id}/cancelar`, { motivo: 'ya empezó' })).status).toBe(409);
    expect((await o.dueno.get(`/eventos/${id}`)).status).toBe(404);
    expect((await o.dueno.post(`/eventos/${id}/cobros`, { monto: 10 })).status).toBe(404);
    expect((await o.dueno.get('/eventos')).body).toHaveLength(0);
    expect((await e.dueno.get('/eventos?estado=en_curso')).body).toHaveLength(1);
    expect((await e.dueno.get('/eventos?estado=raro')).status).toBe(400);
  });
});
