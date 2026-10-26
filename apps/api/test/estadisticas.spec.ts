import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { diaIso, escenario as calcEscenario, proyectar, sumarDias } from '../src/estadisticas/proyeccion';
import { levantar } from './util';

const serie = (dias: number, f: (fecha: string, i: number) => number, fin = '2026-03-01'): { fecha: string; valor: number }[] =>
  Array.from({ length: dias }, (_, i) => { const fecha = sumarDias(fin, -(dias - 1 - i)); return { fecha, valor: f(fecha, i) }; });
const PATRON: Record<number, number> = { 1: 100, 2: 120, 3: 140, 4: 160, 5: 300, 6: 400, 7: 250 };   // lunes … domingo

describe('Proyección (pura)', () => {
  it('con menos de 8 semanas dice «datos insuficientes» en vez de inventar cifras', () => {
    const p = proyectar(serie(55, () => 100), '2026-03-02');
    expect(p).toMatchObject({ suficiente: false, semanasHistoria: 7, minimoSemanas: 8 });
    expect((p as { motivo: string }).motivo).toMatch(/necesitan al menos 8/);
    expect(proyectar([], '2026-03-02').suficiente).toBe(false);
  });

  it('respeta la estacionalidad semanal: cada día proyectado sigue su patrón; sin variación no hay banda', () => {
    const p = proyectar(serie(84, (f) => PATRON[diaIso(f)]), '2026-03-02');
    expect(p.suficiente).toBe(true);
    if (!p.suficiente) return;
    expect(p.diario).toHaveLength(28);
    for (const d of p.diario) { expect(d.valor).toBe(PATRON[diaIso(d.fecha)]); expect(d.bajo).toBe(d.valor); expect(d.alto).toBe(d.valor); }
    expect(p.semanas[0]).toMatchObject({ desde: '2026-03-02', hasta: '2026-03-08', valor: 1470 });
    expect(p.total.valor).toBe(1470 * 4);
    expect(p).toMatchObject({ confianza: 'alta', crecimientoSemanalPct: 0 });
  });

  it('con ruido aparece una banda que se ensancha con el horizonte, y la confianza baja si las semanas son muy dispares', () => {
    let s = 7;
    const azar = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const p = proyectar(serie(84, (f) => PATRON[diaIso(f)] * (0.7 + azar() * 0.6)), '2026-03-02');
    if (!p.suficiente) throw new Error('debería alcanzar');
    expect(p.diario.every((d) => d.bajo <= d.valor && d.valor <= d.alto)).toBe(true);
    const ancho = (i: number) => p.diario[i].alto - p.diario[i].bajo;
    expect(ancho(21)).toBeGreaterThan(ancho(0) * 0.99);                                      // mismo día de la semana, más lejos
    expect(p.semanas.every((w) => w.bajo < w.valor && w.alto > w.valor)).toBe(true);
    const loco = proyectar(serie(84, (f, i) => PATRON[diaIso(f)] * (Math.floor(i / 7) % 2 === 0 ? 0.2 : 2)), '2026-03-02');
    expect(loco.suficiente && loco.confianza).toBe('baja');
    const corto = proyectar(serie(63, (f) => PATRON[diaIso(f)]), '2026-03-02');              // 9 semanas, parejas: media (no alta)
    expect(corto.suficiente && corto.confianza).toBe('media');
  });

  it('la tendencia semanal se acota a ±5 % y los valores nunca son negativos', () => {
    const sube = proyectar(serie(84, (f, i) => PATRON[diaIso(f)] * 1.1 ** (i / 7)), '2026-03-02');
    const baja = proyectar(serie(84, (f, i) => PATRON[diaIso(f)] * 0.7 ** (i / 7)), '2026-03-02');
    if (!sube.suficiente || !baja.suficiente) throw new Error('debería alcanzar');
    expect(sube.crecimientoSemanalPct).toBe(5); expect(baja.crecimientoSemanalPct).toBe(-5);
    expect(baja.diario.every((d) => d.bajo >= 0 && d.valor >= 0)).toBe(true);
    const cero = proyectar(serie(84, () => 0), '2026-03-02');
    expect(cero.suficiente && cero.total.valor).toBe(0);
  });

  it('escenarios: el precio mueve ingresos y utilidad; la demanda mueve también el costo', () => {
    expect(calcEscenario({ ingresos: 1000, costo: 300 }, 5, 0)).toEqual({ ingresos: 1050, costo: 300, utilidadBruta: 750, ingresosVariacion: 50, utilidadVariacion: 50 });
    expect(calcEscenario({ ingresos: 1000, costo: 300 }, 10, -10)).toEqual({ ingresos: 990, costo: 270, utilidadBruta: 720, ingresosVariacion: -10, utilidadVariacion: 20 });
    expect(calcEscenario({ ingresos: 1000, costo: 300 }, 0, 0).utilidadVariacion).toBe(0);
  });
});

let t: Awaited<ReturnType<typeof levantar>>;
beforeAll(async () => { t = await levantar(); });
afterAll(async () => { await t.cerrar(); });

const laPaz = (dias: number) => new Date(Date.now() - 4 * 3_600_000 + dias * 86_400_000).toISOString().slice(0, 10);

async function base() {
  const d = await t.nuevoRestaurante();
  const dueno = t.con(d.token, d.rid);
  const alta = async (rol: string, nombre = `Persona ${rol}`) => { const a = await dueno.post('/personal', { nombre, correo: `${randomUUID()}@t.bo`, roles: [rol] }); const s = await t.entrarConCodigo(a.body.codigo); return { api: t.con(s.token, d.rid), staffId: a.body.id as string }; };
  const mesero = await alta('mesero', 'Marta Mesera'); const contador = await alta('contador'); const jefe = await alta('area_manager'); const cocina = await alta('cocina');
  const cat = (await dueno.post('/menu/categorias', { nombre: 'Platos de fondo' })).body.id as string;
  const mesa = (await dueno.post('/mesas', { numero: '1', asientos: 4 })).body.id as string;
  const plato = async (nombre: string, precio: number, categoriaId?: string) => (await dueno.post('/menu/platos', { nombre, precio, ...(categoriaId ? { categoriaId } : {}) })).body.id as string;
  return { d, dueno, mesero, contador, jefe, cocina, cat, mesa, plato };
}
type B = Awaited<ReturnType<typeof base>>;

/** Inserta una venta ya cobrada con sus platos y su pago (como dueño de la base: es la forma de armar historia sin esperar semanas). */
async function venta(b: B, o: { dia: number; hora?: string; plato?: string; cant?: number; precio: number; mesero?: string; canal?: string; tipo?: string; prepMin?: number }) {
  const hora = o.hora ?? '13:00'; const ts = `${laPaz(o.dia)}T${hora}:00-04:00`;
  const ord = (await t.owner.query(`INSERT INTO orders (restaurant_id, table_id, waiter_id, channel, order_type, status, subtotal, total, opened_at, sent_at, closed_at, customer_phone, delivery_address) VALUES ($1,$7,$2,$3,$4,'cobrado',$5,$5,$6::timestamptz,$6::timestamptz,$6::timestamptz,NULL,NULL) RETURNING id`,
    [b.d.rid, o.mesero ?? null, o.canal ?? 'caja', o.tipo ?? 'mostrador', (o.precio * (o.cant ?? 1)).toFixed(2), ts, o.tipo === 'mesa' ? b.mesa : null])).rows[0].id as string;
  if (o.plato) await t.owner.query(`INSERT INTO order_items (restaurant_id, order_id, menu_item_id, qty, unit_price, status, sent_at, ready_at) VALUES ($1,$2,$3,$4,$5,'servido',$6::timestamptz,$6::timestamptz + ($7 || ' minutes')::interval)`, [b.d.rid, ord, o.plato, o.cant ?? 1, o.precio, ts, String(o.prepMin ?? 12)]);
  await t.owner.query(`INSERT INTO sales_payments (restaurant_id, order_id, method, amount, document, paid_at) VALUES ($1,$2,'efectivo',$3,'ninguno',$4::timestamptz)`, [b.d.rid, ord, (o.precio * (o.cant ?? 1)).toFixed(2), ts]);
}
const get = async (b: B, ruta: string, quien: 'dueno' | 'contador' | 'jefe' = 'dueno') => (quien === 'dueno' ? b.dueno : quien === 'contador' ? b.contador.api : b.jefe.api).get(ruta);

describe('Resumen y ventas', () => {
  it('totales del período con ticket promedio, comparación con el período anterior y serie diaria', async () => {
    const b = await base(); const p = await b.plato('Pique', 100);
    await venta(b, { dia: 0, plato: p, precio: 100 }); await venta(b, { dia: 0, plato: p, precio: 50, prepMin: 20 }); await venta(b, { dia: -1, plato: p, precio: 150, prepMin: 10 });
    await venta(b, { dia: -8, plato: p, precio: 100 });                                    // período anterior
    const r = (await get(b, `/estadisticas/resumen?desde=${laPaz(-6)}&hasta=${laPaz(0)}`)).body;
    expect(r.actual).toMatchObject({ ingresos: '300.00', pedidos: 3, ticketPromedio: '100.00', costo: '0.00', costoAlimentosPct: '0.00', utilidadBruta: '300.00' });
    expect(r.anterior).toMatchObject({ ingresos: '100.00', pedidos: 1 });
    expect(r.variacion).toMatchObject({ ingresosPct: '200.00', pedidosPct: '200.00', ticketPct: '0.00' });
    expect(r.dias).toBe(7);
    expect(r.serie).toHaveLength(7);
    expect(r.serie.find((s: { fecha: string }) => s.fecha === laPaz(0))).toMatchObject({ ingresos: '150.00', pedidos: 2 });
    expect(r.serie.find((s: { fecha: string }) => s.fecha === laPaz(-3))).toMatchObject({ ingresos: '0.00', pedidos: 0 });   // días sin ventas, con ceros
    expect(r.actual.minutosPreparacion).toBe('14.0');                                      // (12 + 20 + 10) / 3
  });

  it('una venta anulada deja de contar', async () => {
    const b = await base(); const p = await b.plato('Pique', 100);
    await venta(b, { dia: 0, plato: p, precio: 100 }); await venta(b, { dia: 0, plato: p, precio: 60 });
    await t.owner.query(`UPDATE sales_payments SET voided_at = now(), void_reason = 'prueba' WHERE restaurant_id = $1 AND amount = 60`, [b.d.rid]);
    expect((await get(b, `/estadisticas/resumen?desde=${laPaz(0)}&hasta=${laPaz(0)}`)).body.actual).toMatchObject({ ingresos: '100.00', pedidos: 1 });
  });

  it('el costo sale del consumo valorizado y da el costo de alimentos', async () => {
    const b = await base(); const p = await b.plato('Pique', 100);
    const carne = (await b.dueno.post('/insumos', { nombre: 'Carne', unidad: 'kg' })).body.id as string; const bod = (await b.dueno.post('/almacenes', { nombre: 'Cocina' })).body.id as string;
    await b.dueno.post('/stock/movimientos', { tipo: 'compra', almacenId: bod, insumoId: carne, cantidad: 10, costoUnitario: 60 });
    await t.owner.query(`INSERT INTO stock_movements (restaurant_id, warehouse_id, ingredient_id, kind, qty, unit_cost) VALUES ($1,$2,$3,'consumo',-1,60)`, [b.d.rid, bod, carne]);
    await t.owner.query(`INSERT INTO stock_movements (restaurant_id, warehouse_id, ingredient_id, kind, qty, unit_cost, reason) VALUES ($1,$2,$3,'merma',-0.5,60,'se echó a perder')`, [b.d.rid, bod, carne]);
    await venta(b, { dia: 0, plato: p, precio: 100, cant: 2 });
    const r = (await get(b, `/estadisticas/resumen?desde=${laPaz(0)}&hasta=${laPaz(0)}`)).body.actual;
    expect(r).toMatchObject({ ingresos: '200.00', costo: '60.00', costoAlimentosPct: '30.00', merma: '30.00', utilidadBruta: '140.00' });
  });

  it('agrupa por hora, día de la semana, plato, categoría, mesero, canal y tipo, con participación', async () => {
    const b = await base(); const a = await b.plato('Pique', 100, b.cat); const s = await b.plato('Sopa', 40);
    await venta(b, { dia: 0, hora: '13:10', plato: a, precio: 100, cant: 2, mesero: b.mesero.staffId, canal: 'mesero', tipo: 'mesa' });
    await venta(b, { dia: 0, hora: '13:50', plato: s, precio: 40, cant: 5, canal: 'qr_mesa', tipo: 'llevar' });
    await venta(b, { dia: 0, hora: '20:05', plato: a, precio: 100, cant: 1, mesero: b.mesero.staffId, canal: 'mesero', tipo: 'mesa' });
    const q = async (g: string) => (await get(b, `/estadisticas/ventas?grupo=${g}&desde=${laPaz(0)}&hasta=${laPaz(0)}`)).body;
    expect((await q('plato')).filas.map((f: { etiqueta: string; ventas: string; cantidad: string }) => [f.etiqueta, f.ventas, f.cantidad])).toEqual([['Pique', '300.00', '3.00'], ['Sopa', '200.00', '5.00']]);
    const hora = await q('hora');
    expect(hora.filas.map((f: { etiqueta: string; ventas: string }) => [f.etiqueta, f.ventas])).toEqual([['13:00', '400.00'], ['20:00', '100.00']]);
    expect(hora.unidad).toBe('pedidos'); expect(hora.total).toBe('500.00');
    expect((await q('dia_semana')).filas).toHaveLength(1);
    expect((await q('categoria')).filas.map((f: { etiqueta: string }) => f.etiqueta).sort()).toEqual(['Platos de fondo', 'Sin categoría']);
    expect((await q('mesero')).filas.find((f: { etiqueta: string }) => f.etiqueta === 'Marta Mesera')).toMatchObject({ ventas: '300.00', participacionPct: '60.00' });
    expect((await q('canal')).filas.map((f: { etiqueta: string }) => f.etiqueta).sort()).toEqual(['Mesero', 'QR de mesa']);
    expect((await q('tipo')).filas.map((f: { etiqueta: string }) => f.etiqueta).sort()).toEqual(['Mesa', 'Para llevar']);
  });

  it('valida parámetros y permisos; otra sucursal no ve estas ventas', async () => {
    const b = await base(); const o = await base(); const p = await b.plato('Pique', 100);
    await venta(b, { dia: 0, plato: p, precio: 100 });
    expect((await get(b, '/estadisticas/ventas?grupo=xx')).status).toBe(400);
    expect((await get(b, '/estadisticas/ventas')).status).toBe(400);
    expect((await get(b, `/estadisticas/resumen?desde=${laPaz(-200)}&hasta=${laPaz(0)}`)).status).toBe(400);   // más de 92 días
    expect((await get(b, `/estadisticas/resumen?desde=${laPaz(0)}&hasta=${laPaz(-3)}`)).status).toBe(400);
    expect((await get(b, '/estadisticas/resumen?desde=hoy')).status).toBe(400);
    expect((await b.mesero.api.get('/estadisticas/resumen')).status).toBe(403);
    expect((await b.cocina.api.get('/estadisticas/menu')).status).toBe(403);
    expect((await get(b, '/estadisticas/resumen', 'jefe')).status).toBe(200);
    expect((await get(b, '/estadisticas/proyeccion', 'jefe')).status).toBe(403);          // proyecciones: dueño, administración y contador
    expect((await get(b, '/estadisticas/proyeccion', 'contador')).status).toBe(200);
    expect((await get(o, `/estadisticas/resumen?desde=${laPaz(0)}&hasta=${laPaz(0)}`)).body.actual).toMatchObject({ ingresos: '0.00', pedidos: 0 });
  });
});

describe('Ingeniería de menú', () => {
  it('clasifica estrella, caballo, puzzle y perro por popularidad contra margen; sin receta no se inventa margen', async () => {
    const b = await base();
    const ins = (await b.dueno.post('/insumos', { nombre: 'Carne', unidad: 'kg' })).body.id as string; const bod = (await b.dueno.post('/almacenes', { nombre: 'Cocina' })).body.id as string;
    await b.dueno.post('/stock/movimientos', { tipo: 'compra', almacenId: bod, insumoId: ins, cantidad: 100, costoUnitario: 100 });          // Bs 100 el kg
    const receta = async (platoId: string, gramos: number) => b.cocina.api.post('/recetas', { platoId, rendimiento: 1, mermaPct: 0, lineas: [{ insumoId: ins, cantidad: gramos, unidad: 'g' }] });
    const estrella = await b.plato('Estrella', 100); const caballo = await b.plato('Caballo', 100); const puzzle = await b.plato('Puzzle', 100); const perro = await b.plato('Perro', 100); const sin = await b.plato('Sin receta', 50);
    await receta(estrella, 200); await receta(caballo, 800); await receta(puzzle, 200); await receta(perro, 800);                              // costo 20 o 80 por porción
    await venta(b, { dia: 0, plato: estrella, precio: 100, cant: 30 }); await venta(b, { dia: 0, plato: caballo, precio: 100, cant: 30 });
    await venta(b, { dia: 0, plato: puzzle, precio: 100, cant: 2 }); await venta(b, { dia: 0, plato: perro, precio: 100, cant: 2 }); await venta(b, { dia: 0, plato: sin, precio: 50, cant: 1 });
    const m = (await get(b, `/estadisticas/menu?desde=${laPaz(0)}&hasta=${laPaz(0)}`)).body;
    const clase = Object.fromEntries(m.platos.map((p: { nombre: string; clase: string }) => [p.nombre, p.clase]));
    expect(clase).toEqual({ Estrella: 'estrella', Caballo: 'caballo', Puzzle: 'puzzle', Perro: 'perro', 'Sin receta': 'sin_receta' });
    expect(m.resumen).toEqual({ estrella: 1, caballo: 1, puzzle: 1, perro: 1, sin_receta: 1 });
    expect(m.platos.find((p: { nombre: string }) => p.nombre === 'Estrella')).toMatchObject({ costoPorPorcion: '20.00', margenPct: '80.00', unidades: '30.00' });
    expect(m.platos.find((p: { nombre: string }) => p.nombre === 'Sin receta').margenPct).toBeNull();
    expect((await get(b, `/estadisticas/menu?desde=${laPaz(-40)}&hasta=${laPaz(-30)}`)).body.platos).toEqual([]);                             // sin ventas
  });
});

describe('Proyección y escenarios', () => {
  it('con poca historia declara datos insuficientes; con más de 8 semanas proyecta con banda, confianza y compras estimadas', async () => {
    const b = await base(); const p = await b.plato('Pique', 100);
    expect((await get(b, '/estadisticas/proyeccion')).body).toMatchObject({ suficiente: false, minimoSemanas: 8 });
    await venta(b, { dia: -3, plato: p, precio: 100 });
    expect((await get(b, '/estadisticas/proyeccion')).body).toMatchObject({ suficiente: false, semanasHistoria: 0 });
    for (let dia = -70; dia <= -1; dia++) await venta(b, { dia, plato: p, precio: 100 + (dia % 3 === 0 ? 20 : 0) });   // 70 días de ventas
    const r = (await get(b, '/estadisticas/proyeccion?semanas=4')).body;
    expect(r.suficiente).toBe(true);
    expect(r.diario).toHaveLength(28); expect(r.semanas).toHaveLength(4);
    expect(r.desde).toBe(laPaz(0)); expect(r.semanasHistoria).toBeGreaterThanOrEqual(10);
    expect(['alta', 'media', 'baja']).toContain(r.confianza);
    expect(r.total.valor).toBeGreaterThan(2000); expect(r.total.valor).toBeLessThan(4000);                     // ≈ 4 semanas × 7 días × ~105
    expect(r.total.bajo).toBeLessThanOrEqual(r.total.valor); expect(r.total.alto).toBeGreaterThanOrEqual(r.total.valor);
    expect(r).toMatchObject({ costoAlimentosPct: '0.00', comprasEstimadas: '0.00' });
    expect((await get(b, '/estadisticas/proyeccion?semanas=9')).status).toBe(400);
  });

  it('escenario «¿y si subo 5 %?»: aritmética sobre la proyección, con su nota; sin historia, lo declara', async () => {
    const b = await base(); const p = await b.plato('Pique', 100);
    expect((await get(b, '/estadisticas/escenario?precio=5')).body).toMatchObject({ suficiente: false });
    for (let dia = -70; dia <= -1; dia++) await venta(b, { dia, plato: p, precio: 100 });
    const e = (await get(b, '/estadisticas/escenario?precio=5&demanda=0')).body;
    expect(e.suficiente).toBe(true);
    expect(Number(e.escenario.ingresos)).toBeCloseTo(Number(e.base.ingresos) * 1.05, 0);
    expect(Number(e.escenario.utilidadVariacion)).toBeCloseTo(Number(e.base.ingresos) * 0.05, 0);
    expect(e.nota).toMatch(/costo sigue a la demanda/);
    const d = (await get(b, '/estadisticas/escenario?precio=10&demanda=-10')).body;
    expect(Number(d.escenario.ingresos)).toBeCloseTo(Number(d.base.ingresos) * 0.99, 0);
    expect((await get(b, '/estadisticas/escenario?precio=500')).status).toBe(400);
    expect((await get(b, '/estadisticas/escenario?demanda=abc')).status).toBe(400);
  });
});

describe('Comparación entre sucursales', () => {
  it('solo dueños y administradores; muestra las sucursales donde la persona administra', async () => {
    const b = await base(); const p = await b.plato('Pique', 100);
    await venta(b, { dia: 0, plato: p, precio: 80 });
    const c = (await get(b, `/estadisticas/comparacion?desde=${laPaz(0)}&hasta=${laPaz(0)}`)).body;
    expect(c.sucursales).toHaveLength(1);
    expect(c.sucursales[0]).toMatchObject({ nombre: 'Casa Andina', ingresos: '80.00', pedidos: 1 });
    expect((await get(b, '/estadisticas/comparacion', 'contador')).status).toBe(403);
    expect((await b.mesero.api.get('/estadisticas/comparacion')).status).toBe(403);
  });
});
