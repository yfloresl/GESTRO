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
  const [contador, mesero, cajero, almacenista] = [await alta('contador'), await alta('mesero'), await alta('cajero'), await alta('almacen')];
  const carne = (await dueno.post('/insumos', { nombre: 'Carne', unidad: 'kg' })).body.id as string;
  const cocina = (await dueno.post('/almacenes', { nombre: 'Cocina' })).body.id as string;
  const mesa = (await dueno.post('/mesas', { numero: '1', asientos: 4 })).body.id as string;
  const pique = (await dueno.post('/menu/platos', { nombre: 'Pique Macho', precio: 65 })).body.id as string;
  const prov = (await dueno.post('/proveedores', { nombre: 'Carnes del Valle', diasCredito: 15 })).body.id as string;
  return { d, dueno, contador, mesero, cajero, almacenista, carne, cocina, mesa, pique, prov };
}
type E = Awaited<ReturnType<typeof escenario>>;

/** Fecha de hoy en La Paz (UTC-4): la misma que usa el servidor, aunque en UTC ya sea mañana. */
const hoy = () => new Date(Date.now() - 4 * 3_600_000).toISOString().slice(0, 10);
const asientos = async (e: E, q = '') => (await e.contador.get(`/contabilidad/asientos${q}`)).body as { id: string; numero: number | null; fecha: string; glosa: string; origen: string; publicado: boolean; esAnulacion: boolean; contrarrestado: boolean; total: string }[];
const detalle = async (e: E, id: string) => (await e.contador.get(`/contabilidad/asientos/${id}`)).body as { lineas: { cuenta: string; debe: string; haber: string }[] };
const saldoDe = async (e: E, codigo: string) => (await e.contador.get(`/contabilidad/reportes/mayor/${codigo}`)).body.saldoFinal as string;
const comprarDirecto = (e: E, cant: number, costo: number) => e.dueno.post('/stock/movimientos', { tipo: 'compra', almacenId: e.cocina, insumoId: e.carne, cantidad: cant, costoUnitario: costo });

/** Vende un pique macho y lo cobra en efectivo. */
async function vender(e: E, cobro: object = {}) {
  const p = (await e.mesero.post('/pedidos', { tipo: 'mesa', mesaId: e.mesa })).body.pedido;
  await e.mesero.post(`/pedidos/${p.id}/items`, { items: [{ platoId: e.pique, cantidad: 1 }] });
  expect((await e.mesero.post(`/pedidos/${p.id}/enviar`)).status).toBe(200);
  await e.cajero.post('/caja/abrir', { montoInicial: 0 });
  const c = await e.cajero.post(`/pedidos/${p.id}/cobrar`, { metodo: 'efectivo', documento: 'recibo', ...cobro });
  return { pedido: p.id as string, pagoId: c.body.pagoId as string, respuesta: c };
}
/** Receta del pique macho: 200 g de carne. */
async function conReceta(e: E) {
  const a = await e.dueno.post('/personal', { nombre: 'Chef', correo: `${randomUUID()}@t.bo`, roles: ['cocina'] });
  const s = await t.entrarConCodigo(a.body.codigo);
  const chef = t.con(s.token, e.d.rid);
  expect((await chef.post('/recetas', { platoId: e.pique, rendimiento: 1, mermaPct: 0, lineas: [{ insumoId: e.carne, cantidad: 200, unidad: 'g' }] })).status).toBe(201);
}

describe('Plan de cuentas y permisos', () => {
  it('nace con la plantilla; solo dueño, administración y contador entran; cuentas del sistema no se desactivan', async () => {
    const e = await escenario();
    const c = (await e.contador.get('/contabilidad/cuentas')).body as { id: string; codigo: string; claveDelSistema: string | null; aceptaAsientos: boolean }[];
    expect(c.find((x) => x.codigo === '1.1.01')).toMatchObject({ claveDelSistema: 'caja', aceptaAsientos: true });
    expect(c.find((x) => x.codigo === '1')).toMatchObject({ aceptaAsientos: false });
    for (const rol of [e.mesero, e.cajero, e.almacenista]) expect((await rol.get('/contabilidad/cuentas')).status).toBe(403);
    expect((await e.contador.patch(`/contabilidad/cuentas/${c.find((x) => x.codigo === '1.1.01')!.id}`, { activa: false })).status).toBe(409);
    expect((await e.contador.post('/contabilidad/cuentas', { codigo: '5.2.05', nombre: 'Marketing', tipo: 'gasto', codigoPadre: '5.2' })).status).toBe(201);
    expect((await e.contador.post('/contabilidad/cuentas', { codigo: '5.2.05', nombre: 'Otra', tipo: 'gasto', codigoPadre: '5.2' })).status).toBe(409);
    expect((await e.contador.post('/contabilidad/cuentas', { codigo: 'abc', nombre: 'Mala', tipo: 'gasto' })).status).toBe(400);
  });
});

describe('Asientos automáticos del negocio', () => {
  it('compra directa, consumo al enviar a cocina y venta cobrada: todo cuadra y los reportes concuerdan', async () => {
    const e = await escenario(); await conReceta(e);
    await comprarDirecto(e, 10, 60);
    await vender(e);
    const lista = await asientos(e);
    expect(lista.map((a) => a.origen).sort()).toEqual(['compra_directa', 'costo_consumo', 'venta']);
    expect(lista.every((a) => a.publicado && a.numero !== null)).toBe(true);
    const venta = lista.find((a) => a.origen === 'venta')!;
    expect((await detalle(e, venta.id)).lineas.map((l) => [l.cuenta, l.debe, l.haber])).toEqual([['1.1.01', '65.00', '0.00'], ['4.1.01', '0.00', '65.00']]);
    expect(lista.find((a) => a.origen === 'costo_consumo')!.total).toBe('12.00');
    const comp = (await e.contador.get('/contabilidad/reportes/comprobacion')).body;
    expect(comp.cuadra).toBe(true); expect(comp.totalDebe).toBe(comp.totalHaber);
    const res = (await e.contador.get('/contabilidad/reportes/resultados')).body;
    expect(res).toMatchObject({ ingresos: '65.00', costos: '12.00', utilidadBruta: '53.00', gastos: '0.00', resultado: '53.00', margenBrutoPct: '81.54' });
    const bal = (await e.contador.get('/contabilidad/reportes/balance')).body;
    expect(bal.cuadra).toBe(true);
    expect(bal.resultadoDelEjercicio).toBe('53.00');
    expect(await saldoDe(e, '1.1.04')).toBe('588.00');
    expect(await saldoDe(e, '1.1.01')).toBe('-535.00');
    expect((await e.contador.get('/contabilidad/reportes/flujo-de-caja')).body).toMatchObject({ entradas: '65.00', salidas: '600.00', saldoFinal: '-535.00' });
  });

  it('anular la venta la contrarresta con otro asiento (no se borra nada) y el resultado vuelve a cero', async () => {
    const e = await escenario(); await conReceta(e); await comprarDirecto(e, 10, 60);
    const v = await vender(e);
    expect((await e.dueno.post(`/pagos/${v.pagoId}/anular`, { motivo: 'cobro duplicado' })).status).toBe(200);
    const lista = await asientos(e, '?origen=venta');
    expect(lista).toHaveLength(2);
    expect(lista.find((a) => a.esAnulacion)).toMatchObject({ publicado: true });
    expect(lista.find((a) => !a.esAnulacion)!.contrarrestado).toBe(true);
    expect((await e.contador.get('/contabilidad/reportes/resultados')).body.ingresos).toBe('0.00');
    expect((await e.contador.get('/contabilidad/reportes/comprobacion')).body.cuadra).toBe(true);
    expect((await e.dueno.post(`/pagos/${v.pagoId}/anular`, { motivo: 'otra vez' })).status).toBe(404);
  });

  it('un plato sin receta se vende sin generar costo', async () => {
    const e = await escenario();
    await vender(e);
    expect((await asientos(e)).map((a) => a.origen)).toEqual(['venta']);
  });

  it('compra recibida con IVA separa el crédito fiscal; el libro de compras y los impuestos lo reflejan; el pago a proveedor sale de bancos', async () => {
    const e = await escenario();
    const o = (await e.almacenista.post('/ordenes-de-compra', { proveedorId: e.prov, lineas: [{ insumoId: e.carne, cantidad: 10, costoUnitario: 11.3 }] })).body.id as string;
    await e.almacenista.post(`/ordenes-de-compra/${o}/enviar`);
    const r = await e.almacenista.post(`/ordenes-de-compra/${o}/recibir`, { almacenId: e.cocina, factura: 'F-77', conIva: true, lineas: [{ insumoId: e.carne, cantidad: 10 }] });
    expect(r.status).toBe(200); expect(r.body.totalRecibido).toBe('113.00');
    const a = (await asientos(e, '?origen=compra'))[0];
    expect((await detalle(e, a.id)).lineas.map((l) => [l.cuenta, l.debe, l.haber])).toEqual([['1.1.04', '100.00', '0.00'], ['1.1.05', '13.00', '0.00'], ['2.1.01', '0.00', '113.00']]);
    const libro = (await e.contador.get('/contabilidad/reportes/libro-de-compras')).body;
    expect(libro.filas).toHaveLength(1);
    expect(libro.filas[0]).toMatchObject({ factura: 'F-77', proveedor: 'Carnes del Valle', importe: '113.00', iva: '13.00' });
    expect(libro.totalIva).toBe('13.00');
    expect((await e.contador.get('/contabilidad/reportes/impuestos')).body).toMatchObject({ creditoFiscal: '13.00', debitoFiscal: '0.00', ivaAPagar: '-13.00', referencial: true });
    const cxp = (await e.contador.get('/por-pagar')).body[0];
    expect((await e.contador.post(`/por-pagar/${cxp.id}/pagar`, { metodo: 'bancos' })).status).toBe(200);
    expect(await saldoDe(e, '1.1.02')).toBe('-113.00');
    expect(await saldoDe(e, '2.1.01')).toBe('0.00');
  });

  it('merma y conteo físico se contabilizan al costo promedio', async () => {
    const e = await escenario();
    await comprarDirecto(e, 10, 60);
    expect((await e.dueno.post('/stock/movimientos', { tipo: 'merma', almacenId: e.cocina, insumoId: e.carne, cantidad: 2, motivo: 'se echó a perder' })).status).toBe(200);
    expect(await saldoDe(e, '5.1.02')).toBe('120.00');
    const c = await e.dueno.post('/stock/conteos', { almacenId: e.cocina, lineas: [{ insumoId: e.carne, contado: 7 }] });
    expect(c.status).toBe(200); expect(c.body.valorDiferencia).toBe('-60.00');
    expect(await saldoDe(e, '5.1.03')).toBe('60.00');
    expect(await saldoDe(e, '1.1.04')).toBe('420.00');
    expect((await e.contador.get('/contabilidad/reportes/comprobacion')).body.cuadra).toBe(true);
  });
});

describe('Asientos manuales e inmutabilidad', () => {
  const lineas = (m: number) => [{ cuenta: '5.2.03', debe: m }, { cuenta: '1.1.01', haber: m }];

  it('borrador editable; no se publica si no cuadra; al publicar recibe el correlativo; publicado no se edita ni se borra', async () => {
    const e = await escenario();
    const malo = await e.contador.post('/contabilidad/asientos', { fecha: hoy(), glosa: 'Pago de alquiler', lineas: [{ cuenta: '5.2.03', debe: 500 }, { cuenta: '1.1.01', haber: 400 }] });
    expect(malo.status).toBe(201);
    expect((await e.contador.post(`/contabilidad/asientos/${malo.body.id}/publicar`)).status).toBe(400);
    expect((await e.contador.put(`/contabilidad/asientos/${malo.body.id}`, { fecha: hoy(), glosa: 'Pago de alquiler', lineas: lineas(500) })).status).toBe(200);
    expect((await asientos(e, '?estado=borrador'))[0].numero).toBeNull();
    const pub = await e.contador.post(`/contabilidad/asientos/${malo.body.id}/publicar`);
    expect(pub.status).toBe(200); expect(pub.body.numero).toBe(1);
    const otro = (await e.contador.post('/contabilidad/asientos', { fecha: hoy(), glosa: 'Luz y agua', lineas: [{ cuenta: '5.2.02', debe: 80 }, { cuenta: '1.1.01', haber: 80 }] })).body.id;
    expect((await e.contador.post(`/contabilidad/asientos/${otro}/publicar`)).body.numero).toBe(2);
    expect((await e.contador.put(`/contabilidad/asientos/${malo.body.id}`, { fecha: hoy(), glosa: 'x y z', lineas: lineas(1) })).status).toBe(409);
    expect((await e.contador.del(`/contabilidad/asientos/${malo.body.id}`)).status).toBe(409);
    const soloDebe = await e.contador.post('/contabilidad/asientos', { fecha: hoy(), glosa: 'Solo debe', lineas: [{ cuenta: '5.2.03', debe: 10 }, { cuenta: '1.1.01', debe: 10 }] });
    expect(soloDebe.status).toBe(201);   // un borrador puede estar incompleto...
    expect((await e.contador.post(`/contabilidad/asientos/${soloDebe.body.id}/publicar`)).status).toBe(400);   // ...pero no se publica si no cuadra
    expect((await e.contador.post('/contabilidad/asientos', { fecha: hoy(), glosa: 'Cuenta de grupo', lineas: [{ cuenta: '5.2', debe: 10 }, { cuenta: '1.1.01', haber: 10 }] })).status).toBe(400);
    expect((await e.contador.post('/contabilidad/asientos', { fecha: hoy(), glosa: 'Cuenta inexistente', lineas: [{ cuenta: '9.9.9', debe: 10 }, { cuenta: '1.1.01', haber: 10 }] })).status).toBe(400);
  });

  it('la base lo impide aunque se salte la API: editar o borrar un asiento publicado, o sus líneas, falla', async () => {
    const e = await escenario();
    const id = (await e.contador.post('/contabilidad/asientos', { fecha: hoy(), glosa: 'Pago de alquiler', lineas: lineas(500) })).body.id;
    await e.contador.post(`/contabilidad/asientos/${id}/publicar`);
    await expect(t.owner.query(`UPDATE journal_entries SET memo = 'manipulado' WHERE id = $1`, [id])).rejects.toThrow(/no se edita/);
    await expect(t.owner.query(`DELETE FROM journal_entries WHERE id = $1`, [id])).rejects.toThrow(/no se borra/);
    await expect(t.owner.query(`UPDATE journal_lines SET debit = 1 WHERE entry_id = $1 AND debit > 0`, [id])).rejects.toThrow(/no se modifican/);
    await expect(t.owner.query(`DELETE FROM journal_lines WHERE entry_id = $1`, [id])).rejects.toThrow(/no se modifican/);
  });

  it('se corrige contrarrestando: una sola vez, y el mayor muestra el saldo corrido', async () => {
    const e = await escenario();
    const id = (await e.contador.post('/contabilidad/asientos', { fecha: hoy(), glosa: 'Pago de alquiler', lineas: lineas(500) })).body.id;
    await e.contador.post(`/contabilidad/asientos/${id}/publicar`);
    expect(await saldoDe(e, '5.2.03')).toBe('500.00');
    const c = await e.contador.post(`/contabilidad/asientos/${id}/contrarrestar`, { motivo: 'monto equivocado' });
    expect(c.status).toBe(200);
    expect((await e.contador.post(`/contabilidad/asientos/${id}/contrarrestar`)).status).toBe(409);
    expect((await e.contador.post(`/contabilidad/asientos/${c.body.id}/contrarrestar`)).status).toBe(404);
    expect(await saldoDe(e, '5.2.03')).toBe('0.00');
    const mayor = (await e.contador.get('/contabilidad/reportes/mayor/5.2.03')).body;
    expect(mayor.movimientos.map((m: { saldo: string }) => m.saldo)).toEqual(['500.00', '0.00']);
    expect(mayor.movimientos[1].glosa).toMatch(/monto equivocado/);
  });

  it('otra sucursal no ve ni toca estos asientos (RLS)', async () => {
    const e = await escenario(); const o = await escenario();
    const id = (await e.contador.post('/contabilidad/asientos', { fecha: hoy(), glosa: 'Pago de alquiler', lineas: lineas(500) })).body.id;
    expect((await o.contador.get(`/contabilidad/asientos/${id}`)).status).toBe(404);
    expect((await o.contador.post(`/contabilidad/asientos/${id}/publicar`)).status).toBe(404);
    expect(await asientos(o)).toHaveLength(0);
  });
});

describe('Cierre de períodos', () => {
  it('cerrado: no se publican asientos manuales ahí, los automáticos se corren al mes siguiente y solo el dueño reabre', async () => {
    const e = await escenario();
    const anio = Number(hoy().slice(0, 4)); const mes = Number(hoy().slice(5, 7));
    const borrador = (await e.contador.post('/contabilidad/asientos', { fecha: hoy(), glosa: 'Pago de alquiler', lineas: [{ cuenta: '5.2.03', debe: 500 }, { cuenta: '1.1.01', haber: 500 }] })).body.id;
    expect((await e.contador.post('/contabilidad/periodos/cerrar', { anio, mes })).status).toBe(409);
    await e.contador.post(`/contabilidad/asientos/${borrador}/publicar`);
    expect((await e.contador.post('/contabilidad/periodos/cerrar', { anio, mes })).status).toBe(200);
    expect((await e.contador.get('/contabilidad/periodos')).body.find((p: { anio: number; mes: number }) => p.anio === anio && p.mes === mes)).toMatchObject({ cerrado: true });
    expect((await e.contador.post('/contabilidad/asientos', { fecha: hoy(), glosa: 'Luz y agua', lineas: [{ cuenta: '5.2.02', debe: 80 }, { cuenta: '1.1.01', haber: 80 }] })).status).toBe(201);
    const b2 = (await asientos(e, '?estado=borrador'))[0].id;
    expect((await e.contador.post(`/contabilidad/asientos/${b2}/publicar`)).status).toBe(409);
    await vender(e);
    const venta = (await asientos(e, '?origen=venta'))[0];
    expect(venta.fecha.slice(0, 7)).not.toBe(hoy().slice(0, 7));
    expect((await e.contador.post('/contabilidad/periodos/reabrir', { anio, mes })).status).toBe(403);
    expect((await e.dueno.post('/contabilidad/periodos/reabrir', { anio, mes })).status).toBe(200);
    expect((await e.contador.post(`/contabilidad/asientos/${b2}/publicar`)).status).toBe(200);
    expect((await e.dueno.post('/contabilidad/periodos/reabrir', { anio, mes })).status).toBe(404);
  });
});

describe('Cuentas por cobrar (ventas a crédito)', () => {
  it('crédito pide nombre; nace la deuda con su vencimiento; los cobros parciales y totales se asientan; cobrada no se cobra otra vez', async () => {
    const e = await escenario();
    const sin = await vender(e, { metodo: 'credito' });
    expect(sin.respuesta.status).toBe(400);
    const v = await vender(e, { metodo: 'credito', nombreCliente: 'Hotel Los Tajibos', telefonoCliente: '70012345', diasCredito: 15 });
    expect(v.respuesta.status).toBe(200);
    const cuentas = (await e.contador.get('/por-cobrar')).body as { id: string; cliente: string; telefono: string; monto: string; saldo: string; dias: number; vencida: boolean }[];
    expect(cuentas).toHaveLength(1);
    expect(cuentas[0]).toMatchObject({ cliente: 'Hotel Los Tajibos', telefono: '70012345', monto: '130.00', saldo: '130.00', dias: 15, vencida: false });
    expect(await saldoDe(e, '1.1.03')).toBe('130.00');                      // cuentas por cobrar (el intento fallido dejó el plato en la mesa y se cobra junto)
    expect(await saldoDe(e, '1.1.01')).toBe('0.00');                        // no entró dinero a caja
    const id = cuentas[0].id;
    expect((await e.mesero.get('/por-cobrar')).status).toBe(403);
    expect((await e.contador.post(`/por-cobrar/${id}/cobrar`, { monto: 500 })).status).toBe(400);
    const p1 = await e.contador.post(`/por-cobrar/${id}/cobrar`, { monto: 25, via: 'caja' });
    expect(p1.status).toBe(200); expect(p1.body.saldo).toBe('105.00');
    const p2 = await e.contador.post(`/por-cobrar/${id}/cobrar`, { via: 'bancos' });
    expect(p2.status).toBe(200); expect(p2.body.saldo).toBe('0.00');
    expect((await e.contador.post(`/por-cobrar/${id}/cobrar`, {})).status).toBe(409);
    expect(await saldoDe(e, '1.1.03')).toBe('0.00');
    expect(await saldoDe(e, '1.1.01')).toBe('25.00');
    expect(await saldoDe(e, '1.1.02')).toBe('105.00');
    expect((await e.contador.get('/por-cobrar')).body).toHaveLength(0);
    expect((await e.contador.get('/por-cobrar?todas=1')).body).toHaveLength(1);
    expect((await asientos(e, '?origen=cobro_cuenta'))).toHaveLength(2);
    expect((await e.contador.get('/contabilidad/reportes/comprobacion')).body.cuadra).toBe(true);
  });

  it('anular una venta a crédito sin cobros retira la deuda; con cobros no se puede anular', async () => {
    const e = await escenario();
    const a = await vender(e, { metodo: 'credito', nombreCliente: 'Cliente A' });
    expect((await e.dueno.post(`/pagos/${a.pagoId}/anular`, { motivo: 'error de carga' })).status).toBe(200);
    expect((await e.contador.get('/por-cobrar')).body).toHaveLength(0);
    expect(await saldoDe(e, '1.1.03')).toBe('0.00');
    const b = await vender(e, { metodo: 'credito', nombreCliente: 'Cliente B' });
    const id = (await e.contador.get('/por-cobrar')).body[0].id;
    await e.contador.post(`/por-cobrar/${id}/cobrar`, { monto: 10 });
    expect((await e.dueno.post(`/pagos/${b.pagoId}/anular`, { motivo: 'error de carga' })).status).toBe(409);
    expect(await saldoDe(e, '1.1.03')).toBe('55.00');
  });
});

describe('Correlativo de asientos', () => {
  it('borrar borradores no deja huecos: el número se asigna al publicar', async () => {
    const e = await escenario();
    const crear = async (glosa: string) => (await e.contador.post('/contabilidad/asientos', { fecha: hoy(), glosa, lineas: [{ cuenta: '5.2.03', debe: 10 }, { cuenta: '1.1.01', haber: 10 }] })).body.id as string;
    const [a, b, c] = [await crear('Primero'), await crear('Segundo'), await crear('Tercero')];
    expect((await e.contador.del(`/contabilidad/asientos/${b}`)).status).toBe(200);
    expect((await e.contador.post(`/contabilidad/asientos/${c}/publicar`)).body.numero).toBe(1);
    expect((await e.contador.post(`/contabilidad/asientos/${a}/publicar`)).body.numero).toBe(2);
    const d = await crear('Cuarto');
    expect((await e.contador.post(`/contabilidad/asientos/${d}/publicar`)).body.numero).toBe(3);
    const numeros = (await asientos(e, '?estado=publicado')).map((x) => x.numero).sort();
    expect(numeros).toEqual([1, 2, 3]);
  });

  it('un asiento que falla al publicar no consume número', async () => {
    const e = await escenario();
    const malo = (await e.contador.post('/contabilidad/asientos', { fecha: hoy(), glosa: 'Descuadrado', lineas: [{ cuenta: '5.2.03', debe: 10 }, { cuenta: '1.1.01', haber: 9 }] })).body.id;
    expect((await e.contador.post(`/contabilidad/asientos/${malo}/publicar`)).status).toBe(400);
    const bueno = (await e.contador.post('/contabilidad/asientos', { fecha: hoy(), glosa: 'Cuadrado', lineas: [{ cuenta: '5.2.03', debe: 10 }, { cuenta: '1.1.01', haber: 10 }] })).body.id;
    expect((await e.contador.post(`/contabilidad/asientos/${bueno}/publicar`)).body.numero).toBe(1);
  });
});
