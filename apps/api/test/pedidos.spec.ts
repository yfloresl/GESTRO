import { randomUUID } from 'node:crypto';
import { io as cliente, Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { levantar } from './util';

let t: Awaited<ReturnType<typeof levantar>>;
beforeAll(async () => { t = await levantar(); });
afterAll(async () => { await t.cerrar(); });

/** Restaurante con dueño, mesero, cajero, jefe de cocina, una mesa, dos platos (uno agotado) y la sesión de cada uno. */
async function escenario() {
  const d = await t.nuevoRestaurante();
  const dueno = t.con(d.token, d.rid);
  const alta = async (rol: string) => {
    const a = await dueno.post('/personal', { nombre: `Persona ${rol}`, correo: `${randomUUID()}@t.bo`, roles: [rol] });
    const s = await t.entrarConCodigo(a.body.codigo);
    return { api: t.con(s.token, d.rid), userId: s.userId, staffId: a.body.id as string, token: s.token };
  };
  const mesero = await alta('mesero'); const cajero = await alta('cajero'); const cocina = await alta('cocina');
  const mesa = (await dueno.post('/mesas', { numero: '7', asientos: 4 })).body.id as string;
  const mesa2 = (await dueno.post('/mesas', { numero: '8', asientos: 4 })).body.id as string;
  const pique = (await dueno.post('/menu/platos', { nombre: 'Pique Macho', precio: 65.5 })).body.id as string;
  const sopa = (await dueno.post('/menu/platos', { nombre: 'Sopa de Maní', precio: 32 })).body.id as string;
  const trucha = (await dueno.post('/menu/platos', { nombre: 'Trucha', precio: 58, disponible: false })).body.id as string;
  const qr = ((await dueno.get('/mesas')).body.find((m: { id: string }) => m.id === mesa).urlQr as string).split('/m/')[1];
  return { d, dueno, mesero, cajero, cocina, mesa, mesa2, pique, sopa, trucha, qr };
}
type E = Awaited<ReturnType<typeof escenario>>;
const mesaCon = async (qr: string) => { const tk = (await t.api().post('/api/v1/qr/sesion').send({ qrToken: qr })).body.token as string; return { post: (r: string, c: object) => t.api().post(`/api/v1/qr/${r}`).set('Authorization', `Bearer ${tk}`).send(c), get: (r: string) => t.api().get(`/api/v1/qr/${r}`).set('Authorization', `Bearer ${tk}`) }; };
const pedidoDeMesa = async (e: E) => (await e.mesero.api.post('/pedidos', { tipo: 'mesa', mesaId: e.mesa })).body.pedido;

describe('Toma de pedidos del personal', () => {
  it('mesa exige mesa; delivery exige dirección y teléfono; una mesa tiene un solo pedido abierto', async () => {
    const e = await escenario();
    expect((await e.mesero.api.post('/pedidos', { tipo: 'mesa' })).status).toBe(400);
    expect((await e.cajero.api.post('/pedidos', { tipo: 'delivery', cliente: { nombre: 'Ana' } })).status).toBe(400);
    const a = await e.mesero.api.post('/pedidos', { tipo: 'mesa', mesaId: e.mesa });
    expect(a.status).toBe(201); expect(a.body.existente).toBe(false);
    const b = await e.mesero.api.post('/pedidos', { tipo: 'mesa', mesaId: e.mesa });
    expect(b.body.existente).toBe(true); expect(b.body.pedido.id).toBe(a.body.pedido.id);
    expect((await e.cocina.api.post('/pedidos', { tipo: 'mesa', mesaId: e.mesa2 })).status).toBe(403);
  });

  it('el ticket diario es correlativo y sin repetir aunque lleguen pedidos a la vez', async () => {
    const e = await escenario();
    const r = await Promise.all(Array.from({ length: 8 }, () => e.cajero.api.post('/pedidos', { tipo: 'llevar', cliente: { nombre: 'Cliente', telefono: '70000000' } })));
    const nums = r.map((x) => x.body.pedido.ticket as number).sort((x, y) => x - y);
    expect(nums).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('agrega platos con el precio del menú; uno agotado se rechaza; el total sale exacto', async () => {
    const e = await escenario();
    const p = await pedidoDeMesa(e);
    expect((await e.mesero.api.post(`/pedidos/${p.id}/items`, { items: [{ platoId: e.trucha, cantidad: 1 }] })).status).toBe(409);
    const r = await e.mesero.api.post(`/pedidos/${p.id}/items`, { items: [{ platoId: e.pique, cantidad: 3, nota: 'sin cebolla', modificadores: ['punto medio'] }, { platoId: e.sopa, cantidad: 1, tiempo: 1 }] });
    expect(r.status).toBe(201);
    expect(r.body.total).toBe('228.50'); // 3 × 65.50 + 32.00
    expect(r.body.items[0].estado).toBe('borrador');
    // El precio queda copiado: cambiarlo en el menú no altera el pedido.
    await e.dueno.patch(`/menu/platos/${e.pique}`, { precio: 100 });
    expect((await e.mesero.api.get(`/pedidos/${p.id}`)).body.total).toBe('228.50');
  });

  it('enviar pasa los platos a cocina; los enviados no se borran, se anulan con permiso y motivo', async () => {
    const e = await escenario();
    const p = await pedidoDeMesa(e);
    const r = await e.mesero.api.post(`/pedidos/${p.id}/items`, { items: [{ platoId: e.pique, cantidad: 1 }, { platoId: e.sopa, cantidad: 2 }] });
    const [i1, i2] = r.body.items as { id: string }[];
    expect((await e.mesero.api.del(`/items/${i1.id}`)).status).toBe(200); // aún no enviado: se quita
    const env = await e.mesero.api.post(`/pedidos/${p.id}/enviar`);
    expect(env.body.estado).toBe('enviado');
    expect((await e.mesero.api.post(`/pedidos/${p.id}/enviar`)).status).toBe(409);
    expect((await e.mesero.api.del(`/items/${i2.id}`)).status).toBe(409);
    expect((await e.mesero.api.post(`/items/${i2.id}/anular`, { motivo: 'cliente cambió' })).status).toBe(403); // el mesero no anula
    expect((await e.cajero.api.post(`/items/${i2.id}/anular`, {})).status).toBe(400); // motivo obligatorio
    const an = await e.cajero.api.post(`/items/${i2.id}/anular`, { motivo: 'cliente cambió de idea' });
    expect(an.status).toBe(200);
    expect(an.body.total).toBe('0.00');
    const log = await t.owner.query(`SELECT action, after FROM audit_log WHERE restaurant_id = $1 AND action = 'pedido.item_anulado'`, [e.d.rid]);
    expect(log.rowCount).toBe(1);
    const fila = await t.owner.query('SELECT voided_by FROM order_items WHERE id = $1', [i2.id]);
    expect(fila.rows[0].voided_by).toBe(e.cajero.userId);
  });

  it('mover a otra mesa; no a una ocupada', async () => {
    const e = await escenario();
    const p = await pedidoDeMesa(e);
    await e.mesero.api.post('/pedidos', { tipo: 'mesa', mesaId: e.mesa2 });
    expect((await e.mesero.api.post(`/pedidos/${p.id}/mover-mesa`, { mesaId: e.mesa2 })).status).toBe(409);
    const libre = (await e.dueno.post('/mesas', { numero: '9', asientos: 2 })).body.id;
    expect((await e.mesero.api.post(`/pedidos/${p.id}/mover-mesa`, { mesaId: libre })).body.mesaId).toBe(libre);
  });

  it('un plato con pedidos no se puede borrar del menú', async () => {
    const e = await escenario();
    const p = await pedidoDeMesa(e);
    await e.mesero.api.post(`/pedidos/${p.id}/items`, { items: [{ platoId: e.sopa, cantidad: 1 }] });
    expect((await e.dueno.del(`/menu/platos/${e.sopa}`)).status).toBe(409);
  });

  it('otra sucursal no ve ni modifica el pedido', async () => {
    const a = await escenario(); const b = await escenario();
    const p = await pedidoDeMesa(a);
    expect((await b.dueno.get(`/pedidos/${p.id}`)).status).toBe(404);
    expect((await b.dueno.post(`/pedidos/${p.id}/enviar`)).status).toBe(404);
  });
});

describe('Cocina (KDS)', () => {
  const conectar = async (token: string) => { const s = cliente(t.url, { path: '/api/socket.io', auth: { token }, transports: ['websocket'], reconnection: false }); await new Promise<void>((ok, mal) => { s.on('connect', ok); s.on('connect_error', mal); }); return s; };
  const esperar = <T>(s: Socket, ev: string) => new Promise<T>((ok, mal) => { const to = setTimeout(() => mal(new Error(`sin ${ev}`)), 2500); s.once(ev, (d: T) => { clearTimeout(to); ok(d); }); });

  it('la comanda llega a cocina en menos de 2 s, avanza por estados y al quedar lista avisa al mesero', async () => {
    const e = await escenario();
    const sCocina = await conectar(e.cocina.token); const sMesero = await conectar(e.mesero.token);
    const p = await pedidoDeMesa(e);
    await e.mesero.api.post(`/pedidos/${p.id}/items`, { items: [{ platoId: e.pique, cantidad: 2, nota: 'sin ají' }, { platoId: e.sopa, cantidad: 1 }] });
    const nuevo = esperar<{ id: string; estado: string; mesa: string }>(sCocina, 'ticket.nuevo');
    const ini = Date.now();
    await e.mesero.api.post(`/pedidos/${p.id}/enviar`);
    expect(await nuevo).toMatchObject({ id: p.id, estado: 'nuevo', mesa: '7' });
    expect(Date.now() - ini).toBeLessThan(2000);

    const tk = (await e.cocina.api.get('/cocina/tickets')).body;
    expect(tk).toHaveLength(1); expect(tk[0].items).toHaveLength(2);
    expect((await e.mesero.api.get('/cocina/tickets')).status).toBe(403);

    expect((await e.cocina.api.post(`/pedidos/${p.id}/cocina`, { estado: 'en_preparacion' })).body.estado).toBe('en_preparacion');
    const recibidos: { id: string; mesa: string; paraMi: boolean }[] = [];
    sMesero.on('pedido.listo', (d) => recibidos.push(d));
    const fin = await e.cocina.api.post(`/pedidos/${p.id}/cocina`, { estado: 'listo' });
    expect(fin.body.estado).toBe('listo');
    await new Promise((r) => setTimeout(r, 400));
    expect(recibidos.find((d) => d.paraMi)).toMatchObject({ id: p.id, mesa: '7', paraMi: true }); // llega también el aviso general de la sucursal
    expect((await e.cocina.api.get('/cocina/tickets')).body[0].estado).toBe('listo');
    expect((await e.cocina.api.post(`/pedidos/${p.id}/cocina`, { estado: 'listo' })).status).toBe(409);
    const t0 = await t.owner.query(`SELECT started_at, ready_at FROM order_items WHERE order_id = $1`, [p.id]);
    expect(t0.rows.every((r) => r.started_at && r.ready_at)).toBe(true);
    sCocina.close(); sMesero.close();
  });

  it('«Listo parcial»: un plato listo no cierra el ticket', async () => {
    const e = await escenario();
    const p = await pedidoDeMesa(e);
    const r = await e.mesero.api.post(`/pedidos/${p.id}/items`, { items: [{ platoId: e.pique, cantidad: 1 }, { platoId: e.sopa, cantidad: 1 }] });
    await e.mesero.api.post(`/pedidos/${p.id}/enviar`);
    const sopa = (r.body.items as { id: string; nombre: string }[]).find((i) => i.nombre === 'Sopa de Maní')!;
    const x = await t.api().patch(`/api/v1/items/${sopa.id}/cocina`).set('Authorization', `Bearer ${e.cocina.token}`).set('X-Restaurant-Id', e.d.rid).send({ estado: 'listo' });
    expect(x.status).toBe(200);
    expect(x.body.estado).toBe('en_preparacion'); // falta el pique
    const tk = (await e.cocina.api.get('/cocina/tickets')).body[0];
    expect(tk.estado).toBe('en_preparacion');
  });
});

describe('Pedido por QR', () => {
  it('con confirmación: el pedido espera al mesero, que lo confirma con un toque y recién ahí llega a cocina', async () => {
    const e = await escenario();
    const m = await mesaCon(e.qr);
    expect((await m.post('pedidos', { items: [] })).status).toBe(400);
    expect((await m.post('pedidos', { items: [{ platoId: e.trucha, cantidad: 1 }] })).status).toBe(409);
    const r = await m.post('pedidos', { items: [{ platoId: e.pique, cantidad: 2, nota: 'sin cebolla' }], comentario: 'Es alérgico al maní' });
    expect(r.status).toBe(200); expect(r.body.estado).toBe('por_confirmar');
    expect((await e.cocina.api.get('/cocina/tickets')).body).toHaveLength(0);
    const mi = (await m.get('pedido')).body.pedido;
    expect(mi.items[0]).toMatchObject({ nombre: 'Pique Macho', estado: 'por_confirmar' });
    const abiertos = (await e.mesero.api.get('/pedidos')).body;
    expect(abiertos).toHaveLength(1); expect(abiertos[0].total).toBe('0.00'); // sin confirmar no se cobra
    expect(abiertos[0].items[0].porConfirmar).toBe(true);
    const env = await e.mesero.api.post(`/pedidos/${abiertos[0].id}/enviar`);
    expect(env.body.total).toBe('131.00');
    expect((await e.cocina.api.get('/cocina/tickets')).body).toHaveLength(1);
    expect((await m.get('pedido')).body.pedido.items[0].estado).toBe('enviado');
  });

  it('el pedido del mesero y el del cliente se juntan en uno solo por mesa', async () => {
    const e = await escenario();
    const p = await pedidoDeMesa(e);
    await e.mesero.api.post(`/pedidos/${p.id}/items`, { items: [{ platoId: e.sopa, cantidad: 1 }] });
    const m = await mesaCon(e.qr);
    await m.post('pedidos', { items: [{ platoId: e.pique, cantidad: 1 }] });
    const lista = (await e.mesero.api.get('/pedidos')).body;
    expect(lista).toHaveLength(1);
    expect(lista[0].items).toHaveLength(2);
  });

  it('sin confirmación (ajuste de la sucursal) entra directo a cocina; apagado, el QR no recibe pedidos', async () => {
    const e = await escenario();
    expect((await e.dueno.patch('/sucursal/ajustes', { qrSinConfirmacion: true })).status).toBe(200);
    const m = await mesaCon(e.qr);
    expect((await m.post('pedidos', { items: [{ platoId: e.sopa, cantidad: 1 }] })).body.estado).toBe('enviado');
    expect((await e.cocina.api.get('/cocina/tickets')).body).toHaveLength(1);
    await e.dueno.patch('/sucursal/ajustes', { pedidosPorQr: false });
    expect((await m.post('pedidos', { items: [{ platoId: e.sopa, cantidad: 1 }] })).status).toBe(403);
    expect((await e.mesero.api.patch('/sucursal/ajustes', { pedidosPorQr: true })).status).toBe(403);
  });
});

describe('Caja, cobro y recibos', () => {
  async function pedidoListoParaCobrar(e: E) {
    const p = await pedidoDeMesa(e);
    await e.mesero.api.post(`/pedidos/${p.id}/items`, { items: [{ platoId: e.pique, cantidad: 2 }, { platoId: e.sopa, cantidad: 1 }] });
    await e.mesero.api.post(`/pedidos/${p.id}/enviar`);
    return p.id as string;
  }

  it('sin caja abierta no se cobra; abre con monto; un cajero no abre dos', async () => {
    const e = await escenario();
    const id = await pedidoListoParaCobrar(e);
    expect((await e.cajero.api.post(`/pedidos/${id}/cobrar`, { metodo: 'efectivo', documento: 'recibo' })).status).toBe(409);
    expect((await e.mesero.api.post('/caja/abrir', { montoInicial: 100 })).status).toBe(403);
    expect((await e.cajero.api.post('/caja/abrir', { montoInicial: 100.505 })).status).toBe(400);
    expect((await e.cajero.api.post('/caja/abrir', { montoInicial: 100 })).status).toBe(200);
    expect((await e.cajero.api.post('/caja/abrir', { montoInicial: 50 })).status).toBe(409);
  });

  it('cobra con recibo correlativo, rotulado como no fiscal; la factura se rechaza mientras no exista el servicio fiscal', async () => {
    const e = await escenario();
    await e.cajero.api.post('/caja/abrir', { montoInicial: 100 });
    const id = await pedidoListoParaCobrar(e);
    const f = await e.cajero.api.post(`/pedidos/${id}/cobrar`, { metodo: 'efectivo', documento: 'factura' });
    expect(f.status).toBe(422);
    const c = await e.cajero.api.post(`/pedidos/${id}/cobrar`, { metodo: 'efectivo', documento: 'recibo', nombreCliente: 'Juan Pérez' });
    expect(c.status).toBe(200);
    expect(c.body.monto).toBe('163.00'); expect(c.body.recibo).toBe(1);
    expect((await e.cajero.api.post(`/pedidos/${id}/cobrar`, { metodo: 'efectivo', documento: 'recibo' })).status).toBe(409);
    const rid = (await e.cajero.api.get(`/pedidos/${id}/recibo`)).body.id;
    const rec = (await e.cajero.api.get(`/recibos/${rid}`)).body;
    expect(rec).toMatchObject({ numero: 1, monto: '163.00', cliente: 'Juan Pérez', leyenda: 'RECIBO — NO ES UNA FACTURA', anulado: false });
    expect(rec.items).toHaveLength(2);
    // segundo cobro: recibo 2, sin saltos
    const p2 = await e.cajero.api.post('/pedidos', { tipo: 'mostrador' });
    await e.cajero.api.post(`/pedidos/${p2.body.pedido.id}/items`, { items: [{ platoId: e.sopa, cantidad: 1 }] });
    await e.cajero.api.post(`/pedidos/${p2.body.pedido.id}/enviar`);
    expect((await e.cajero.api.post(`/pedidos/${p2.body.pedido.id}/cobrar`, { metodo: 'qr', documento: 'recibo' })).body.recibo).toBe(2);
  });

  it('no cobra con platos sin enviar ni un pedido vacío; «solo contabilizar» no emite recibo', async () => {
    const e = await escenario();
    await e.cajero.api.post('/caja/abrir', { montoInicial: 0 });
    const p = await pedidoDeMesa(e);
    expect((await e.cajero.api.post(`/pedidos/${p.id}/cobrar`, { metodo: 'efectivo', documento: 'ninguno' })).status).toBe(400);
    await e.mesero.api.post(`/pedidos/${p.id}/items`, { items: [{ platoId: e.sopa, cantidad: 1 }] });
    expect((await e.cajero.api.post(`/pedidos/${p.id}/cobrar`, { metodo: 'efectivo', documento: 'ninguno' })).status).toBe(409);
    await e.mesero.api.post(`/pedidos/${p.id}/enviar`);
    const c = await e.cajero.api.post(`/pedidos/${p.id}/cobrar`, { metodo: 'efectivo', documento: 'ninguno' });
    expect(c.status).toBe(200); expect(c.body.recibo).toBeNull();
  });

  it('con la sucursal en «solo contabilizar» no se emiten recibos', async () => {
    const e = await escenario();
    await e.dueno.patch('/sucursal/ajustes', { modoDeCobro: 'ninguno' });
    await e.cajero.api.post('/caja/abrir', { montoInicial: 0 });
    const id = await pedidoListoParaCobrar(e);
    expect((await e.cajero.api.post(`/pedidos/${id}/cobrar`, { metodo: 'efectivo', documento: 'recibo' })).status).toBe(422);
    expect((await e.cajero.api.post(`/pedidos/${id}/cobrar`, { metodo: 'efectivo', documento: 'ninguno' })).status).toBe(200);
  });

  it('el cierre de caja hace arqueo con diferencia; anular una venta exige motivo y rol, y deja el recibo marcado', async () => {
    const e = await escenario();
    await e.cajero.api.post('/caja/abrir', { montoInicial: 100 });
    const a = await pedidoListoParaCobrar(e);
    await e.cajero.api.post(`/pedidos/${a}/cobrar`, { metodo: 'efectivo', documento: 'recibo' });
    const b = await e.cajero.api.post('/pedidos', { tipo: 'llevar', cliente: { nombre: 'X' } });
    await e.cajero.api.post(`/pedidos/${b.body.pedido.id}/items`, { items: [{ platoId: e.sopa, cantidad: 1 }] });
    await e.cajero.api.post(`/pedidos/${b.body.pedido.id}/enviar`);
    const cb = await e.cajero.api.post(`/pedidos/${b.body.pedido.id}/cobrar`, { metodo: 'qr', documento: 'recibo' });
    const act = (await e.cajero.api.get('/caja/actual')).body;
    expect(act.efectivoEsperado).toBe('263.00'); // 100 de apertura + 163 en efectivo (el QR no suma)
    expect(act.cobros).toHaveLength(2);
    expect((await e.cajero.api.post(`/pagos/${cb.body.pagoId}/anular`, { motivo: 'error de cobro' })).status).toBe(403);
    expect((await e.dueno.post(`/pagos/${cb.body.pagoId}/anular`, {})).status).toBe(400);
    expect((await e.dueno.post(`/pagos/${cb.body.pagoId}/anular`, { motivo: 'cobro duplicado' })).status).toBe(200);
    expect((await e.dueno.post(`/pagos/${cb.body.pagoId}/anular`, { motivo: 'otra vez' })).status).toBe(404);
    const rid = (await e.cajero.api.get(`/pedidos/${b.body.pedido.id}/recibo`)).body.id;
    expect((await e.cajero.api.get(`/recibos/${rid}`)).body).toMatchObject({ anulado: true, motivoAnulacion: 'cobro duplicado' });
    const cierre = await e.cajero.api.post('/caja/cerrar', { montoContado: 260 });
    expect(cierre.body).toMatchObject({ efectivoEsperado: '263.00', diferencia: '-3.00' });
    expect((await e.cajero.api.get('/caja/actual')).body).toEqual({ activa: false });
    expect((await e.cajero.api.post('/caja/cerrar', { montoContado: 0 })).status).toBe(409);
  });

  it('GST-001: el efectivo cobrado a un cliente de crédito entra al arqueo de la caja abierta; lo cobrado por banco no', async () => {
    const e = await escenario();
    await e.cajero.api.post('/caja/abrir', { montoInicial: 100 });
    const id = await pedidoListoParaCobrar(e);                                                    // 163,00
    expect((await e.cajero.api.post(`/pedidos/${id}/cobrar`, { metodo: 'credito', documento: 'recibo', nombreCliente: 'QA Cliente Crédito', diasCredito: 15 })).status).toBe(200);
    expect((await e.cajero.api.get('/caja/actual')).body.efectivoEsperado).toBe('100.00');       // la venta a crédito no es efectivo
    const cuenta = (await e.cajero.api.get('/por-cobrar')).body[0];
    expect((await e.cajero.api.post(`/por-cobrar/${cuenta.id}/cobrar`, { monto: 30.25 })).status).toBe(200);                  // efectivo
    expect((await e.cajero.api.post(`/por-cobrar/${cuenta.id}/cobrar`, { monto: 10, via: 'bancos' })).status).toBe(200);     // banco: no es efectivo
    const caja = (await e.cajero.api.get('/caja/actual')).body;
    expect(caja.efectivoEsperado).toBe('130.25');
    expect(caja.cobros).toContainEqual({ metodo: 'cuentas_por_cobrar', total: '30.25', cantidad: 1 });
    const cierre = await e.cajero.api.post('/caja/cerrar', { montoContado: 130.25 });
    expect(cierre.body).toMatchObject({ efectivoEsperado: '130.25', diferencia: '0.00' });
  });

  it('GST-004/005: cantidad +/-, descuento con motivo y tope, propina, efectivo recibido y vuelto; la propina entra al cajón y al asiento como pasivo', async () => {
    const e = await escenario();
    await e.cajero.api.post('/caja/abrir', { montoInicial: 100 });
    const id = await pedidoListoParaCobrar(e);                                                      // 163,00
    const total = Number((await e.cajero.api.get(`/pedidos/${id}`)).body.total);
    expect(total).toBe(163);
    // sin motivo, sobre el tope (30 % = 48,90), efectivo corto: 400
    expect((await e.cajero.api.post(`/pedidos/${id}/cobrar`, { metodo: 'efectivo', descuento: 10 })).status).toBe(400);
    expect((await e.cajero.api.post(`/pedidos/${id}/cobrar`, { metodo: 'efectivo', descuento: 48.91, motivoDescuento: 'Cortesía' })).status).toBe(400);
    expect((await e.cajero.api.post(`/pedidos/${id}/cobrar`, { metodo: 'efectivo', descuento: 13, motivoDescuento: 'Cortesía', propina: 5, efectivoRecibido: 154.99 })).status).toBe(400);
    // 163 − 13 = 150 + propina 5 = 155; recibe 200 → vuelto 45
    const ok = await e.cajero.api.post(`/pedidos/${id}/cobrar`, { metodo: 'efectivo', documento: 'recibo', descuento: 13, motivoDescuento: 'Cortesía', propina: 5, efectivoRecibido: 200 });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ monto: '150.00', descuento: '13.00', propina: '5.00', aCobrar: '155.00', recibido: '200.00', vuelto: '45.00' });
    const caja = (await e.cajero.api.get('/caja/actual')).body;
    expect(caja.efectivoEsperado).toBe('255.00');                                                   // 100 + 150 + 5 de propina
    expect(caja.propinas).toBe('5.00');
    const rec = (await e.cajero.api.get(`/pedidos/${id}/recibo`)).body.id;
    expect((await e.cajero.api.get(`/recibos/${rec}`)).body).toMatchObject({ monto: '150.00', propina: '5.00', descuento: '13.00', recibido: '200.00', vuelto: '45.00' });
    const asiento = await t.owner.query(`SELECT a.system_key, l.debit::text AS d, l.credit::text AS c FROM journal_lines l JOIN chart_of_accounts a ON a.id = l.account_id JOIN journal_entries j ON j.id = l.entry_id WHERE j.restaurant_id = $1 AND j.source = 'venta'`, [e.d.rid]);
    expect(asiento.rows).toContainEqual({ system_key: 'caja', d: '155.00', c: '0.00' });
    expect(asiento.rows).toContainEqual({ system_key: 'ventas', d: '0.00', c: '150.00' });
    expect(asiento.rows).toContainEqual({ system_key: 'propinas', d: '0.00', c: '5.00' });
    const cierre = await e.cajero.api.post('/caja/cerrar', { montoContado: 255 });
    expect(cierre.body).toMatchObject({ efectivoEsperado: '255.00', diferencia: '0.00' });
  });

  it('GST-010: los topes de descuento y propina se configuran por restaurante, con validación, motivo al subir, auditoría y efecto inmediato en el cobro', async () => {
    const e = await escenario();
    await e.cajero.api.post('/caja/abrir', { montoInicial: 0 });
    // por defecto 30 / 30; lo lee quien cobra, no un mesero; solo dueño/administrador cambian
    expect((await e.cajero.api.get('/cobro/topes')).body).toEqual({ descuentoMaxPct: 30, propinaMaxPct: 30 });
    expect((await e.mesero.api.get('/cobro/topes')).status).toBe(403);
    expect((await e.cajero.api.patch('/sucursal/ajustes', { descuentoMaxPct: 10 })).status).toBe(403);
    // validación en el servidor
    for (const malo of [101, -1, 12.345, '20', null]) expect((await e.dueno.patch('/sucursal/ajustes', { descuentoMaxPct: malo })).status).toBe(400);
    expect((await e.dueno.patch('/sucursal/ajustes', { propinaMaxPct: 100.01 })).status).toBe(400);
    // subir exige motivo; sin motivo no cambia nada
    expect((await e.dueno.patch('/sucursal/ajustes', { descuentoMaxPct: 50 })).status).toBe(400);
    expect((await e.dueno.patch('/sucursal/ajustes', { descuentoMaxPct: 50, motivoCambioTopes: 'a' })).status).toBe(400);
    expect((await e.cajero.api.get('/cobro/topes')).body.descuentoMaxPct).toBe(30);
    const id1 = await pedidoListoParaCobrar(e);                                                      // 163,00
    expect((await e.cajero.api.post(`/pedidos/${id1}/cobrar`, { metodo: 'tarjeta', descuento: 48.91, motivoDescuento: 'Cortesía' })).status).toBe(400);
    expect((await e.dueno.patch('/sucursal/ajustes', { descuentoMaxPct: 50, motivoCambioTopes: 'Promoción de aniversario' })).status).toBe(200);
    // efecto inmediato: 50 % de 163,00 = 81,50; 81,51 se rechaza
    expect((await e.cajero.api.get('/cobro/topes')).body).toEqual({ descuentoMaxPct: 50, propinaMaxPct: 30 });
    expect((await e.cajero.api.post(`/pedidos/${id1}/cobrar`, { metodo: 'tarjeta', descuento: 81.51, motivoDescuento: 'Cortesía' })).status).toBe(400);
    const ok = await e.cajero.api.post(`/pedidos/${id1}/cobrar`, { metodo: 'tarjeta', descuento: 81.5, motivoDescuento: 'Cortesía' });
    expect(ok.status).toBe(200); expect(ok.body).toMatchObject({ descuento: '81.50', monto: '81.50' });
    // bajar no pide motivo; con decimales: 12,5 % de 163,00 = 20,375 → 20,37 (se redondea hacia abajo)
    expect((await e.dueno.patch('/sucursal/ajustes', { descuentoMaxPct: 12.5, propinaMaxPct: 0 })).status).toBe(200);
    const id2 = await pedidoListoParaCobrar(e);
    expect((await e.cajero.api.post(`/pedidos/${id2}/cobrar`, { metodo: 'tarjeta', descuento: 20.38, motivoDescuento: 'Cortesía' })).status).toBe(400);
    expect((await e.cajero.api.post(`/pedidos/${id2}/cobrar`, { metodo: 'tarjeta', propina: 0.01 })).status).toBe(400);
    const ok2 = await e.cajero.api.post(`/pedidos/${id2}/cobrar`, { metodo: 'tarjeta', descuento: 20.37, motivoDescuento: 'Cortesía' });
    expect(ok2.status).toBe(200); expect(ok2.body).toMatchObject({ descuento: '20.37', monto: '142.63' });
    // rastro: cada cambio guarda quién, antes, después y motivo
    const rastro = (await t.owner.query(`SELECT user_id, before, after FROM audit_log WHERE restaurant_id = $1 AND action = 'sucursal.topes_cobro' ORDER BY id`, [e.d.rid])).rows;
    expect(rastro).toHaveLength(2);
    expect(rastro[0]).toMatchObject({ before: { descuentoMaxPct: 30, propinaMaxPct: 30 }, after: { descuentoMaxPct: 50, propinaMaxPct: 30, motivo: 'Promoción de aniversario' } });
    expect(rastro[1]).toMatchObject({ before: { descuentoMaxPct: 50, propinaMaxPct: 30 }, after: { descuentoMaxPct: 12.5, propinaMaxPct: 0, motivo: null } });
    expect(rastro[0].user_id).toBeTruthy();
    const aj = (await e.dueno.get('/sucursal/ajustes')).body;
    expect(aj).toMatchObject({ descuentoMaxPct: 12.5, propinaMaxPct: 0, ultimoCambioTopes: { antes: { descuentoMaxPct: 50, propinaMaxPct: 30 } } });
    // otro restaurante no se ve afectado
    const otro = await t.nuevoRestaurante();
    expect((await t.con(otro.token, otro.rid).get('/sucursal/ajustes')).body).toMatchObject({ descuentoMaxPct: 30, propinaMaxPct: 30, ultimoCambioTopes: null });
  });

  it('GST-005: cambiar la cantidad de un plato sin enviar recalcula el total; uno ya enviado no se puede cambiar', async () => {
    const e = await escenario();
    const p = await pedidoDeMesa(e);
    const v = await e.mesero.api.post(`/pedidos/${p.id}/items`, { items: [{ platoId: e.pique, cantidad: 1 }] });
    const item = v.body.items[0].id as string;
    const m = await e.mesero.api.patch(`/items/${item}/cantidad`, { cantidad: 3 });
    expect(m.status).toBe(200); expect(m.body.total).toBe('196.50');                                // 3 × 65,50
    expect((await e.mesero.api.patch(`/items/${item}/cantidad`, { cantidad: 0 })).status).toBe(400);
    await e.mesero.api.post(`/pedidos/${p.id}/enviar`);
    expect((await e.mesero.api.patch(`/items/${item}/cantidad`, { cantidad: 2 })).status).toBe(409);
  });

  it('«nada se borra»: al quitar un plato sin enviar y al borrar un plato del menú queda la copia en archived_records', async () => {
    const e = await escenario();
    const p = await pedidoDeMesa(e);
    const item = (await e.mesero.api.post(`/pedidos/${p.id}/items`, { items: [{ platoId: e.sopa, cantidad: 2 }] })).body.items[0].id as string;
    expect((await e.mesero.api.del(`/items/${item}`)).status).toBeLessThan(300);
    const nuevo = (await e.dueno.post('/menu/platos', { nombre: 'Plato a borrar', precio: 10 })).body.id as string;
    expect((await e.dueno.del(`/menu/platos/${nuevo}`)).status).toBeLessThan(300);
    const r = await t.owner.query(`SELECT entity, snapshot->>'name' AS nombre, deleted_by FROM archived_records WHERE restaurant_id = $1 ORDER BY entity`, [e.d.rid]);
    expect(r.rows.map((x: { entity: string }) => x.entity)).toEqual(['menu_items', 'order_items']);
    expect(r.rows[0].nombre).toBe('Plato a borrar'); expect(r.rows[0].deleted_by).toBeTruthy();
  });

  it('el RLS aísla pagos y recibos entre sucursales', async () => {
    const a = await escenario(); const b = await escenario();
    await a.cajero.api.post('/caja/abrir', { montoInicial: 0 });
    const id = await pedidoListoParaCobrar(a);
    const c = await a.cajero.api.post(`/pedidos/${id}/cobrar`, { metodo: 'efectivo', documento: 'recibo' });
    const rid = (await a.cajero.api.get(`/pedidos/${id}/recibo`)).body.id;
    expect((await b.dueno.get(`/recibos/${rid}`)).status).toBe(404);
    expect((await b.dueno.post(`/pagos/${c.body.pagoId}/anular`, { motivo: 'intento ajeno' })).status).toBe(404);
  });
});
