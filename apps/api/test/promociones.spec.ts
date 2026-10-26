import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aplicaAlPlato, enHorario, mejorPrecio, precioConPromo, Promo } from '../src/promociones/motor';
import { levantar } from './util';

const promo = (extra: Partial<Promo> = {}): Promo => ({ id: 'p1', nombre: 'Promo', descuentoPct: '20', precioFijo: null, dias: null, horaDesde: null, horaHasta: null, platos: [], ...extra });

describe('Motor de promociones (puro)', () => {
  it('horario normal, de 24 horas y solo por días', () => {
    const hh = promo({ horaDesde: '17:00', horaHasta: '19:00', dias: [1, 2, 3, 4, 5] });
    expect(enHorario(hh, { diaIso: 2, hora: '17:00' })).toBe(true);
    expect(enHorario(hh, { diaIso: 2, hora: '18:59' })).toBe(true);
    expect(enHorario(hh, { diaIso: 2, hora: '19:00' })).toBe(false);                 // el fin no entra
    expect(enHorario(hh, { diaIso: 6, hora: '18:00' })).toBe(false);                 // sábado
    expect(enHorario(promo({ dias: [6, 7] }), { diaIso: 7, hora: '03:00' })).toBe(true);
    expect(enHorario(promo({ dias: [6, 7] }), { diaIso: 3, hora: '12:00' })).toBe(false);
    expect(enHorario(promo(), { diaIso: 3, hora: '12:00' })).toBe(true);
  });

  it('horario que cruza la medianoche: la madrugada pertenece al día en que empezó', () => {
    const noche = promo({ horaDesde: '22:00', horaHasta: '02:00', dias: [5] });      // viernes 22:00 → sábado 02:00
    expect(enHorario(noche, { diaIso: 5, hora: '23:30' })).toBe(true);
    expect(enHorario(noche, { diaIso: 6, hora: '01:00' })).toBe(true);               // sábado de madrugada: sigue el viernes
    expect(enHorario(noche, { diaIso: 6, hora: '23:30' })).toBe(false);              // sábado en la noche: no
    expect(enHorario(noche, { diaIso: 5, hora: '01:00' })).toBe(false);              // viernes de madrugada: viene del jueves
    expect(enHorario(noche, { diaIso: 5, hora: '12:00' })).toBe(false);
    expect(enHorario(promo({ horaDesde: '22:00', horaHasta: '02:00', dias: [1] }), { diaIso: 2, hora: '00:30' })).toBe(true);
    expect(enHorario(promo({ horaDesde: '22:00', horaHasta: '02:00', dias: [1] }), { diaIso: 1, hora: '00:30' })).toBe(false);   // lunes de madrugada viene del domingo
    expect(enHorario(promo({ horaDesde: '08:00', horaHasta: '08:00' }), { diaIso: 1, hora: '15:00' })).toBe(true);               // 24 horas
  });

  it('a qué platos aplica: lista vacía = todos', () => {
    expect(aplicaAlPlato(promo(), 'x')).toBe(true);
    expect(aplicaAlPlato(promo({ platos: ['a'] }), 'a')).toBe(true);
    expect(aplicaAlPlato(promo({ platos: ['a'] }), 'b')).toBe(false);
  });

  it('descuento por porcentaje o precio fijo, redondeado a 2 decimales y sin subir nunca el precio', () => {
    expect(precioConPromo('100', promo()).toFixed(2)).toBe('80.00');
    expect(precioConPromo('65.50', promo({ descuentoPct: '15' })).toFixed(2)).toBe('55.68');   // 55.675 → 55.68
    expect(precioConPromo('33.33', promo({ descuentoPct: '33.33' })).toFixed(2)).toBe('22.22');
    expect(precioConPromo('40', promo({ descuentoPct: null, precioFijo: '30' })).toFixed(2)).toBe('30.00');
    expect(precioConPromo('25', promo({ descuentoPct: null, precioFijo: '30' })).toFixed(2)).toBe('25.00');   // el fijo es mayor: no sube
    expect(precioConPromo('50', promo({ descuentoPct: '100' })).toFixed(2)).toBe('0.00');
    expect(precioConPromo('50', promo({ descuentoPct: '0' })).toFixed(2)).toBe('50.00');
  });

  it('elige el precio más bajo entre las que aplican e ignora las que no', () => {
    const m = { diaIso: 3, hora: '12:00' };
    const r = mejorPrecio('100', 'plato', [promo({ id: 'a', nombre: '10%', descuentoPct: '10' }), promo({ id: 'b', nombre: '30%', descuentoPct: '30' }), promo({ id: 'c', nombre: 'Otro plato', descuentoPct: '90', platos: ['zzz'] }), promo({ id: 'd', nombre: 'Noche', descuentoPct: '90', horaDesde: '22:00', horaHasta: '23:00' })], m);
    expect(r).toEqual({ precio: '70.00', lista: '100.00', promoId: 'b', promo: '30%' });
    expect(mejorPrecio('100', 'plato', [], m)).toEqual({ precio: '100.00', lista: '100.00', promoId: null, promo: null });
    expect(mejorPrecio('100', 'plato', [promo({ id: 'a', nombre: 'A', descuentoPct: '10' }), promo({ id: 'b', nombre: 'B', descuentoPct: '10' })], m).promoId).toBe('a');   // empate: la primera
    expect(mejorPrecio('100', 'plato', [promo({ descuentoPct: null, precioFijo: '120' })], m).promoId).toBeNull();                                                          // no abarata: no cuenta
  });
});

let t: Awaited<ReturnType<typeof levantar>>;
beforeAll(async () => { t = await levantar(); });
afterAll(async () => { await t.cerrar(); });

const laPaz = (dias: number) => new Date(Date.now() - 4 * 3_600_000 + dias * 86_400_000).toISOString().slice(0, 10);
const horaLaPaz = (min: number) => new Date(Date.now() - 4 * 3_600_000 + min * 60_000).toISOString().slice(11, 16);
const diaIso = (dias: number) => { const d = new Date(`${laPaz(dias)}T12:00:00Z`).getUTCDay(); return d === 0 ? 7 : d; };

async function escenario() {
  const d = await t.nuevoRestaurante();
  const dueno = t.con(d.token, d.rid);
  const alta = async (rol: string) => { const a = await dueno.post('/personal', { nombre: `Persona ${rol}`, correo: `${randomUUID()}@t.bo`, roles: [rol] }); const s = await t.entrarConCodigo(a.body.codigo); return t.con(s.token, d.rid); };
  const [mesero, cajero, cocina, contador] = [await alta('mesero'), await alta('cajero'), await alta('cocina'), await alta('contador')];
  const mesa = (await dueno.post('/mesas', { numero: '1', asientos: 4 })).body.id as string;
  const pique = (await dueno.post('/menu/platos', { nombre: 'Pique Macho', precio: 100 })).body.id as string;
  const sopa = (await dueno.post('/menu/platos', { nombre: 'Sopa de Maní', precio: 40 })).body.id as string;
  const slug = (await t.owner.query('SELECT slug FROM restaurants WHERE id = $1', [d.rid])).rows[0].slug as string;
  return { d, dueno, mesero, cajero, cocina, contador, mesa, pique, sopa, slug };
}
type E = Awaited<ReturnType<typeof escenario>>;
const promocion = (extra: object = {}) => ({ nombre: 'Semana del pique', descuentoPct: 20, desde: laPaz(-1), hasta: laPaz(7), ...extra });
const vigente = async (e: E, platoId: string) => ((await e.mesero.get('/menu/platos')).body as { id: string; precio: string; precioVigente: string; promocion: string | null }[]).find((p) => p.id === platoId)!;
async function pedido(e: E, platos: [string, number][]) {
  const p = (await e.mesero.post('/pedidos', { tipo: 'mesa', mesaId: e.mesa })).body.pedido;
  const r = await e.mesero.post(`/pedidos/${p.id}/items`, { items: platos.map(([platoId, cantidad]) => ({ platoId, cantidad })) });
  return { id: p.id as string, r };
}

describe('Promociones del restaurante', () => {
  it('con una promoción vigente, el menú muestra el precio vigente y el pedido lo cobra con descuento (el servidor lo decide)', async () => {
    const e = await escenario();
    expect(await vigente(e, e.pique)).toMatchObject({ precio: '100.00', precioVigente: '100.00', promocion: null });
    expect((await e.dueno.post('/promociones', promocion())).status).toBe(201);
    expect(await vigente(e, e.pique)).toMatchObject({ precio: '100.00', precioVigente: '80.00', promocion: 'Semana del pique' });
    const p = await pedido(e, [[e.pique, 2], [e.sopa, 1]]);
    expect(p.r.status).toBe(201);
    expect(p.r.body.total).toBe('192.00');                                            // 2 × 80 + 1 × 32
    expect(p.r.body.items.map((i: { precio: string }) => i.precio).sort()).toEqual(['32.00', '80.00']);
    const fila = (await t.owner.query('SELECT unit_price::text AS u, list_price::text AS l, promotion_id FROM order_items WHERE order_id = $1 AND menu_item_id = $2', [p.id, e.pique])).rows[0];
    expect(fila).toMatchObject({ u: '80.00', l: '100.00' }); expect(fila.promotion_id).toBeTruthy();
    const pub = (await t.api().get(`/api/v1/public/${e.slug}/menu`)).body.categorias.flatMap((c: { platos: unknown[] }) => c.platos) as { nombre: string; precioVigente: string; promocion: string }[];
    expect(pub.find((x) => x.nombre === 'Pique Macho')).toMatchObject({ precioVigente: '80.00', promocion: 'Semana del pique' });
  });

  it('las ventas y la contabilidad registran el precio con descuento; el reporte de uso dice cuánto se dejó de cobrar', async () => {
    const e = await escenario();
    await e.dueno.post('/promociones', promocion());
    const p = await pedido(e, [[e.pique, 1]]);
    await e.mesero.post(`/pedidos/${p.id}/enviar`);
    await e.cajero.post('/caja/abrir', { montoInicial: 0 });
    expect((await e.cajero.post(`/pedidos/${p.id}/cobrar`, { metodo: 'efectivo', documento: 'recibo' })).body.monto).toBe('80.00');
    expect((await e.contador.get('/contabilidad/reportes/resultados')).body.ingresos).toBe('80.00');
    const u = (await e.dueno.get('/promociones/uso')).body;
    expect(u.promociones[0]).toMatchObject({ nombre: 'Semana del pique', unidades: '1.00', vendido: '80.00', descuento: '20.00' });
    expect(u.totalDescuento).toBe('20.00');
  });

  it('gana el precio más bajo: un precio fijo en un plato y un porcentaje general', async () => {
    const e = await escenario();
    await e.dueno.post('/promociones', promocion());                                                               // 20 % a todo
    await e.dueno.post('/promociones', promocion({ nombre: 'Sopa a Bs 30', descuentoPct: null, precioFijo: 30, platos: [e.sopa] }));
    expect(await vigente(e, e.sopa)).toMatchObject({ precioVigente: '30.00', promocion: 'Sopa a Bs 30' });          // 30 < 32
    expect(await vigente(e, e.pique)).toMatchObject({ precioVigente: '80.00' });
  });

  it('respeta fechas, días, horario (happy hour) y el interruptor de activa; el precio de un pedido ya armado no cambia', async () => {
    const e = await escenario();
    await e.dueno.post('/promociones', promocion({ nombre: 'Ayer', desde: laPaz(-5), hasta: laPaz(-1) }));          // vencida
    await e.dueno.post('/promociones', promocion({ nombre: 'Mañana', desde: laPaz(1), hasta: laPaz(5) }));         // programada
    await e.dueno.post('/promociones', promocion({ nombre: 'Otro día', diasSemana: [1, 2, 3, 4, 5, 6, 7].filter((d) => d !== diaIso(0)) }));
    await e.dueno.post('/promociones', promocion({ nombre: 'Más tarde', horaDesde: horaLaPaz(60), horaHasta: horaLaPaz(120) }));
    expect(await vigente(e, e.pique)).toMatchObject({ precioVigente: '100.00', promocion: null });
    const feliz = await e.dueno.post('/promociones', promocion({ nombre: 'Happy hour', descuentoPct: 50, diasSemana: [diaIso(0)], horaDesde: horaLaPaz(-30), horaHasta: horaLaPaz(30) }));
    expect(await vigente(e, e.pique)).toMatchObject({ precioVigente: '50.00', promocion: 'Happy hour' });
    const lista = (await e.dueno.get('/promociones')).body as { nombre: string; estado: string; vigenteAhora: boolean; alcance: string }[];
    expect(Object.fromEntries(lista.map((p) => [p.nombre, p.estado]))).toMatchObject({ Ayer: 'vencida', Mañana: 'programada', 'Otro día': 'fuera_de_horario', 'Más tarde': 'fuera_de_horario', 'Happy hour': 'vigente' });
    expect(lista.find((p) => p.nombre === 'Happy hour')!.alcance).toBe('hora');
    const antes = await pedido(e, [[e.pique, 1]]);
    expect(antes.r.body.total).toBe('50.00');
    expect((await e.dueno.post(`/promociones/${feliz.body.id}/activa`, { activa: false })).status).toBe(200);
    expect(await vigente(e, e.pique)).toMatchObject({ precioVigente: '100.00' });
    expect((await e.mesero.get(`/pedidos/${antes.id}`)).body.total).toBe('50.00');                                  // lo ya pedido conserva su precio
    expect((await e.mesero.post(`/pedidos/${antes.id}/items`, { items: [{ platoId: e.pique, cantidad: 1 }] })).body.total).toBe('150.00');   // 50 + 100
  });

  it('valida las reglas y los permisos', async () => {
    const e = await escenario();
    const malo = async (extra: object) => (await e.dueno.post('/promociones', promocion(extra))).status;
    expect(await malo({ descuentoPct: null })).toBe(400);                                  // sin regla
    expect(await malo({ precioFijo: 10, platos: [e.sopa] })).toBe(400);                    // dos reglas
    expect(await malo({ descuentoPct: null, precioFijo: 10 })).toBe(400);                  // fijo sin platos
    expect(await malo({ descuentoPct: 101 })).toBe(400);
    expect(await malo({ descuentoPct: 0 })).toBe(400);
    expect(await malo({ descuentoPct: 10.555 })).toBe(400);
    expect(await malo({ desde: laPaz(3), hasta: laPaz(1) })).toBe(400);
    expect(await malo({ diasSemana: [8] })).toBe(400);
    expect(await malo({ diasSemana: [1, 1] })).toBe(400);
    expect(await malo({ horaDesde: '17:00' })).toBe(400);                                  // horario incompleto
    expect(await malo({ horaDesde: '25:00', horaHasta: '26:00' })).toBe(400);
    expect(await malo({ platos: [randomUUID()] })).toBe(400);
    expect(await malo({ platos: [e.sopa, e.sopa] })).toBe(400);
    expect(await malo({ activa: true })).toBe(400);                                        // .strict()
    expect((await e.mesero.post('/promociones', promocion())).status).toBe(403);
    expect((await e.cajero.get('/promociones')).status).toBe(200);
    expect((await e.cocina.get('/promociones')).status).toBe(403);
    expect((await e.cajero.get('/promociones/uso')).status).toBe(403);
    expect((await e.dueno.get('/promociones/uso?desde=2026-02-01&hasta=2026-01-01')).status).toBe(400);
  });

  it('editar, borrar (solo sin ventas) y aislamiento entre sucursales', async () => {
    const e = await escenario(); const o = await escenario();
    const id = (await e.dueno.post('/promociones', promocion())).body.id as string;
    expect((await e.dueno.put(`/promociones/${id}`, promocion({ nombre: 'Semana del pique 2', descuentoPct: 25 }))).status).toBe(200);
    expect(await vigente(e, e.pique)).toMatchObject({ precioVigente: '75.00', promocion: 'Semana del pique 2' });
    expect((await o.dueno.put(`/promociones/${id}`, promocion())).status).toBe(404);
    expect((await o.dueno.del(`/promociones/${id}`)).status).toBe(404);
    expect((await o.dueno.post(`/promociones/${id}/activa`, { activa: false })).status).toBe(404);
    expect(((await o.dueno.get('/promociones')).body as unknown[]).length).toBe(0);
    expect((await o.dueno.post('/promociones', promocion({ platos: [e.sopa] }))).status).toBe(400);                  // plato de otra sucursal
    await pedido(e, [[e.pique, 1]]);
    expect((await e.dueno.del(`/promociones/${id}`)).status).toBe(400);                                              // ya tiene ventas
    const libre = (await e.dueno.post('/promociones', promocion({ nombre: 'Sin uso' }))).body.id as string;
    expect((await e.dueno.del(`/promociones/${libre}`)).status).toBe(200);
  });
});
