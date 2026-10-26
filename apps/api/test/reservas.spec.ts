import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { levantar } from './util';

let t: Awaited<ReturnType<typeof levantar>>;
beforeAll(async () => { t = await levantar(); });
afterAll(async () => { await t.cerrar(); });

const laPaz = (dias: number) => new Date(Date.now() - 4 * 3_600_000 + dias * 86_400_000).toISOString().slice(0, 10);

/** Restaurante con dos mesas (4 y 2 asientos), reservas habilitadas de 11:00 a 22:00, duración 90 min. */
async function escenario(ajustes: object = {}) {
  const d = await t.nuevoRestaurante();
  const dueno = t.con(d.token, d.rid);
  const alta = async (rol: string) => { const a = await dueno.post('/personal', { nombre: `Persona ${rol}`, correo: `${randomUUID()}@t.bo`, roles: [rol] }); const s = await t.entrarConCodigo(a.body.codigo); return t.con(s.token, d.rid); };
  const grande = (await dueno.post('/mesas', { numero: '1', asientos: 4 })).body.id as string;
  const chica = (await dueno.post('/mesas', { numero: '2', asientos: 2 })).body.id as string;
  const slug = (await t.owner.query('SELECT slug FROM restaurants WHERE id = $1', [d.rid])).rows[0].slug as string;
  const mesero = await alta('mesero'); const cocina = await alta('cocina');
  expect((await dueno.put('/reservas/ajustes', { habilitadas: true, abre: '11:00', cierra: '22:00', duracionMin: 90, ...ajustes })).status).toBe(200);
  const web = (ruta: string) => t.api().get(`/api/v1/public/${slug}/reservas${ruta}`);
  const reservar = (cuerpo: object) => t.api().post(`/api/v1/public/${slug}/reservas`).send({ cliente: 'Ana Mamani', telefono: '70011122', personas: 2, fecha: laPaz(1), hora: '12:00', ...cuerpo });
  return { d, dueno, mesero, cocina, grande, chica, slug, web, reservar };
}
type E = Awaited<ReturnType<typeof escenario>>;
const horas = async (e: E, personas: number, fecha = laPaz(1)) => (await e.web(`/disponibilidad?fecha=${fecha}&personas=${personas}`)).body.horas as string[];
const dia = async (e: E, fecha = laPaz(1)) => (await e.mesero.get(`/reservas?fecha=${fecha}`)).body as { id: string; codigo: string; cliente: string; estado: string; mesa: string; mesaId: string; hora: string; hasta: string; origen: string; personas: number }[];

describe('Reservas por la web pública', () => {
  it('apagadas por defecto: la web responde 404 hasta que la sucursal las habilita', async () => {
    const d = await t.nuevoRestaurante();
    const slug = (await t.owner.query('SELECT slug FROM restaurants WHERE id = $1', [d.rid])).rows[0].slug as string;
    expect((await t.api().get(`/api/v1/public/${slug}/reservas/disponibilidad?fecha=${laPaz(1)}&personas=2`)).status).toBe(404);
    expect((await t.api().post(`/api/v1/public/${slug}/reservas`).send({ cliente: 'Ana', telefono: '700111', personas: 2, fecha: laPaz(1), hora: '12:00' })).status).toBe(404);
    expect((await t.api().get('/api/v1/public/no-existe/reservas')).status).toBe(404);
  });

  it('disponibilidad: cada 30 min dentro del horario, hasta que la reserva termine antes del cierre; grupos grandes sin mesa no ven horas', async () => {
    const e = await escenario();
    const h = await horas(e, 3);
    expect(h[0]).toBe('11:00'); expect(h[h.length - 1]).toBe('20:30');   // 20:30 + 90 min = 22:00
    expect(h).toHaveLength(20);
    expect(await horas(e, 5)).toEqual([]);                                // ninguna mesa de 5
    expect((await e.web(`/disponibilidad?fecha=${laPaz(1)}&personas=13`)).status).toBe(400);   // más del máximo
    expect((await e.web(`/disponibilidad?fecha=${laPaz(1)}&personas=0`)).status).toBe(400);
    expect((await e.web('/disponibilidad?fecha=mañana&personas=2')).status).toBe(400);
    expect((await horas(e, 2, laPaz(-1)))).toEqual([]);                   // ayer: nada
  });

  it('reserva confirmada sola, con la mesa más chica que alcance; la hora ocupada desaparece; sin mesa libre 409', async () => {
    const e = await escenario();
    const a = await e.reservar({ personas: 2 });
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ estado: 'confirmada', fecha: laPaz(1), hora: '12:00', personas: 2, duracionMin: 90 });
    expect(a.body.codigo).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);   // corto y sin caracteres confundibles
    expect((await dia(e))[0]).toMatchObject({ cliente: 'Ana Mamani', mesa: '2', origen: 'web', hora: '12:00', hasta: '13:30' });   // la de 2 asientos
    const b = await e.reservar({ personas: 3, cliente: 'Bruno Rojas', telefono: '70022233' });
    expect(b.status).toBe(201);
    expect((await dia(e)).find((r) => r.cliente === 'Bruno Rojas')!.mesa).toBe('1');
    expect((await e.reservar({ personas: 2, cliente: 'Carla Paz', telefono: '70033344' })).status).toBe(409);   // ya no quedan mesas a las 12:00
    expect(await horas(e, 2)).not.toContain('12:00');
    expect(await horas(e, 2)).not.toContain('12:30');                      // se cruza con la reserva de 12:00-13:30
    expect(await horas(e, 2)).toContain('13:30');                          // justo cuando termina
    expect((await e.reservar({ personas: 2, cliente: 'Carla Paz', telefono: '70033344', hora: '13:30' })).status).toBe(201);
  });

  it('valida horario, múltiplos de 15 min, hora pasada, datos obligatorios y campos desconocidos', async () => {
    const e = await escenario();
    expect((await e.reservar({ hora: '10:30' })).status).toBe(400);        // antes de abrir
    expect((await e.reservar({ hora: '21:00' })).status).toBe(400);        // terminaría después de cerrar
    expect((await e.reservar({ hora: '12:10' })).status).toBe(400);
    expect((await e.reservar({ fecha: laPaz(-1) })).status).toBe(400);     // ayer
    expect((await e.reservar({ personas: 13 })).status).toBe(400);
    expect((await e.reservar({ personas: 0 })).status).toBe(400);
    expect((await e.reservar({ telefono: '1' })).status).toBe(400);
    expect((await e.reservar({ cliente: '' })).status).toBe(400);
    expect((await e.reservar({ estado: 'sentada' })).status).toBe(400);    // .strict(): no se puede forzar el estado
    expect((await e.reservar({ personas: 6 })).status).toBe(409);          // válido pero no hay mesa de 6
  });

  it('dos clientes piden la última mesa a la vez: uno la gana y el otro recibe 409 (lo decide la base)', async () => {
    const e = await escenario();
    await e.reservar({ personas: 3, hora: '13:00', cliente: 'Primero', telefono: '70055566' });  // ocupa la mesa de 4 asientos
    const r = await Promise.all(['Uno', 'Dos', 'Tres'].map((n, i) => e.reservar({ personas: 2, hora: '13:00', cliente: `Cliente ${n}`, telefono: `7007000${i}` })));
    expect(r.map((x) => x.status).sort()).toEqual([201, 409, 409]);
    expect((await dia(e)).filter((x) => x.hora === '13:00')).toHaveLength(2);
  });

  it('el cliente cancela con su código y la mesa se libera; un código malo o repetido da 409', async () => {
    const e = await escenario();
    const a = await e.reservar({ personas: 3, hora: '19:00' });
    await e.reservar({ personas: 2, hora: '19:00', cliente: 'Otra', telefono: '70099900' });
    expect(await horas(e, 3)).not.toContain('19:00');
    const cancelar = (codigo: string) => t.api().post(`/api/v1/public/${e.slug}/reservas/cancelar`).send({ codigo });
    expect((await cancelar('ZZZ999')).status).toBe(409);
    expect((await cancelar('ab')).status).toBe(400);
    expect((await cancelar(` ${a.body.codigo.slice(0, 3).toLowerCase()}-${a.body.codigo.slice(3)} `)).status).toBe(200);   // minúsculas, guion y espacios no importan
    expect((await cancelar(a.body.codigo)).status).toBe(409);
    expect(await horas(e, 3)).toContain('19:00');
  });

  it('con «confirmar a mano» la reserva nace pendiente y el personal la confirma; límite de 3 pendientes por teléfono', async () => {
    const e = await escenario({ autoConfirmar: false });
    const a = await e.reservar({ hora: '12:00' });
    expect(a.body.estado).toBe('pendiente');
    expect((await e.mesero.post(`/reservas/${(await dia(e))[0].id}/estado`, { accion: 'confirmar' })).body.estado).toBe('confirmada');
    await e.reservar({ hora: '15:00', personas: 2 }); await e.reservar({ hora: '17:00', personas: 2 });
    expect((await e.reservar({ hora: '19:00', personas: 2 })).status).toBe(409);
  });
});

describe('Reservas: gestión del personal', () => {
  it('flujo completo y transiciones inválidas: pendiente → confirmada → sentada → cumplida; no_show y cancelar liberan la mesa', async () => {
    const e = await escenario({ autoConfirmar: false });
    await e.reservar({ hora: '12:00' });
    const id = (await dia(e))[0].id;
    const estado = (accion: string, extra: object = {}) => e.mesero.post(`/reservas/${id}/estado`, { accion, ...extra });
    expect((await estado('cumplir')).status).toBe(409);                    // no se cumple lo que no se sentó
    expect((await estado('confirmar')).status).toBe(200);
    expect((await estado('confirmar')).status).toBe(409);
    expect((await estado('sentar')).body.estado).toBe('sentada');
    expect((await estado('cancelar')).status).toBe(409);                   // ya sentada
    expect((await estado('cumplir')).body.estado).toBe('cumplida');
    expect((await estado('no_show')).status).toBe(409);
    expect((await e.cocina.post(`/reservas/${id}/estado`, { accion: 'cancelar' })).status).toBe(403);
    expect((await estado('inventada')).status).toBe(400);
    // no_show y cancelar dejan la hora libre otra vez
    await e.reservar({ hora: '15:00', personas: 3, cliente: 'Dos', telefono: '70012300' });
    const otra = (await dia(e)).find((r) => r.hora === '15:00')!;
    await e.mesero.post(`/reservas/${otra.id}/estado`, { accion: 'confirmar' });
    expect(await horas(e, 3)).not.toContain('15:00');
    expect((await e.mesero.post(`/reservas/${otra.id}/estado`, { accion: 'no_show' })).body.estado).toBe('no_show');
    expect(await horas(e, 3)).toContain('15:00');
  });

  it('el personal crea reservas confirmadas con o sin mesa elegida, y las mesas chicas o ocupadas se rechazan', async () => {
    const e = await escenario();
    const r = await e.mesero.post('/reservas', { cliente: 'Familia Choque', personas: 4, fecha: laPaz(1), hora: '20:00' });
    expect(r.status).toBe(201);
    expect((await dia(e))[0]).toMatchObject({ estado: 'confirmada', origen: 'personal', mesa: '1' });
    expect((await e.mesero.post('/reservas', { cliente: 'X Y', personas: 4, fecha: laPaz(1), hora: '20:00', mesaId: e.chica })).status).toBe(400);   // la mesa chica no alcanza
    expect((await e.mesero.post('/reservas', { cliente: 'X Y', personas: 2, fecha: laPaz(1), hora: '20:00', mesaId: e.grande })).status).toBe(409);   // ocupada
    expect((await e.mesero.post('/reservas', { cliente: 'X Y', personas: 2, fecha: laPaz(1), hora: '20:00', mesaId: e.chica })).status).toBe(201);
    expect((await e.cocina.post('/reservas', { cliente: 'X Y', personas: 2, fecha: laPaz(1), hora: '18:00' })).status).toBe(403);
    // mover de mesa
    const chica = (await dia(e)).find((x) => x.mesa === '2')!;
    expect((await e.mesero.patch(`/reservas/${chica.id}/mesa`, { mesaId: e.grande })).status).toBe(409);
    expect((await e.mesero.patch(`/reservas/${chica.id}/mesa`, { mesaId: randomUUID() })).status).toBe(400);
    expect((await e.mesero.patch(`/reservas/${chica.id}/mesa`, { mesaId: null })).status).toBe(200);
    expect((await e.mesero.post(`/reservas/${chica.id}/estado`, { accion: 'sentar' })).status).toBe(400);   // sin mesa no se sienta
    expect((await e.mesero.post(`/reservas/${chica.id}/estado`, { accion: 'sentar', mesaId: e.chica })).body.estado).toBe('sentada');
  });

  it('ajustes: solo dueño y administración los cambian; el horario debe alcanzar para una reserva; apagarlas corta la web', async () => {
    const e = await escenario();
    expect((await e.mesero.put('/reservas/ajustes', { habilitadas: false })).status).toBe(403);
    expect((await e.mesero.get('/reservas/ajustes')).body).toMatchObject({ habilitadas: true, duracionMin: 90, abre: '11:00', cierra: '22:00', autoConfirmar: true, maxPersonas: 12 });
    expect((await e.dueno.put('/reservas/ajustes', { abre: '12:00', cierra: '13:00' })).status).toBe(400);   // 60 min < 90
    expect((await e.dueno.put('/reservas/ajustes', { maxPersonas: 3 })).status).toBe(200);
    expect((await e.reservar({ personas: 4 })).status).toBe(400);
    expect((await e.dueno.put('/reservas/ajustes', { habilitadas: false })).status).toBe(200);
    expect((await e.reservar({})).status).toBe(404);
  });

  it('otra sucursal no ve ni modifica estas reservas (RLS)', async () => {
    const e = await escenario(); const o = await escenario();
    await e.reservar({});
    const id = (await dia(e))[0].id;
    expect((await o.mesero.post(`/reservas/${id}/estado`, { accion: 'cancelar' })).status).toBe(404);
    expect((await o.mesero.patch(`/reservas/${id}/mesa`, { mesaId: o.grande })).status).toBe(404);
    expect(await dia(o)).toHaveLength(0);
  });
});
