import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { levantar } from './util';

let t: Awaited<ReturnType<typeof levantar>>;
beforeAll(async () => { t = await levantar(); });
afterAll(async () => { await t.cerrar(); });

const laPaz = (dias: number) => new Date(Date.now() - 4 * 3_600_000 + dias * 86_400_000).toISOString().slice(0, 10);
const horaLaPaz = (minutos: number) => new Date(Date.now() - 4 * 3_600_000 + minutos * 60_000).toISOString().slice(11, 16);

async function escenario() {
  const d = await t.nuevoRestaurante();
  const dueno = t.con(d.token, d.rid);
  const alta = async (rol: string, nombre = `Persona ${rol}`) => { const a = await dueno.post('/personal', { nombre, correo: `${randomUUID()}@t.bo`, roles: [rol] }); const s = await t.entrarConCodigo(a.body.codigo); return { api: t.con(s.token, d.rid), staffId: a.body.id as string }; };
  const mesero = await alta('mesero', 'Marta Mesera'); const otro = await alta('mesero', 'Omar Otro'); const jefe = await alta('area_manager'); const contador = await alta('contador'); const cocina = await alta('cocina');
  const funcion = (await dueno.post('/funciones', { nombre: 'Mesero de salón' })).body.id as string;
  expect((await dueno.patch(`/turnos/personas/${mesero.staffId}`, { funcionId: funcion, costoHora: 12.5 })).status).toBe(200);
  return { d, dueno, mesero, otro, jefe, contador, cocina, funcion };
}
type E = Awaited<ReturnType<typeof escenario>>;
const turno = (e: E, personaId: string, extra: object = {}) => e.jefe.api.post('/turnos', { personaId, fecha: laPaz(1), horaInicio: '09:00', horaFin: '17:00', ...extra });

describe('Funciones y personas', () => {
  it('funciones: únicas, se borran solo si nadie las usa; permisos', async () => {
    const e = await escenario();
    expect((await e.dueno.post('/funciones', { nombre: 'Mesero de salón' })).status).toBe(409);
    expect((await e.jefe.api.post('/funciones', { nombre: 'Barista' })).status).toBe(403);
    expect((await e.jefe.api.get('/funciones')).body.find((f: { nombre: string }) => f.nombre === 'Mesero de salón')).toMatchObject({ personas: 1 });
    expect((await e.dueno.del(`/funciones/${e.funcion}`)).status).toBe(409);
    const libre = (await e.dueno.post('/funciones', { nombre: 'Barista' })).body.id;
    expect((await e.dueno.del(`/funciones/${libre}`)).status).toBe(200);
    expect((await e.dueno.del(`/funciones/${randomUUID()}`)).status).toBe(404);
  });

  it('el costo por hora solo lo ven dueño, administración y contador; se crean eventuales sin usuario', async () => {
    const e = await escenario();
    const conPago = (await e.contador.api.get('/turnos/personas')).body as { id: string; nombre: string; costoHora?: string; funcion: string | null }[];
    expect(conPago.find((p) => p.nombre === 'Marta Mesera')).toMatchObject({ costoHora: '12.50', funcion: 'Mesero de salón' });
    expect(((await e.jefe.api.get('/turnos/personas')).body as { costoHora?: string }[]).every((p) => p.costoHora === undefined)).toBe(true);
    expect((await e.otro.api.get('/turnos/personas')).status).toBe(403);
    const ev = await e.dueno.post('/turnos/personas', { nombre: 'Julio Eventual', telefono: '70011122', costoHora: 15, funcionId: e.funcion });
    expect(ev.status).toBe(201);
    expect(((await e.dueno.get('/turnos/personas')).body as { nombre: string; tipo: string; tieneUsuario: boolean }[]).find((p) => p.nombre === 'Julio Eventual')).toMatchObject({ tipo: 'temporal', tieneUsuario: false });
    expect((await e.dueno.patch(`/turnos/personas/${ev.body.id}`, { costoHora: -1 })).status).toBe(400);
    expect((await e.dueno.patch(`/turnos/personas/${ev.body.id}`, { funcionId: randomUUID() })).status).toBe(400);
    expect((await e.jefe.api.patch(`/turnos/personas/${ev.body.id}`, { costoHora: 20 })).status).toBe(403);
  });
});

describe('Programación de turnos', () => {
  it('crea turnos, impide cruces de la misma persona (la base lo decide) y permite turnos nocturnos que cruzan la medianoche', async () => {
    const e = await escenario();
    expect((await turno(e, e.mesero.staffId)).status).toBe(201);
    expect((await turno(e, e.mesero.staffId, { horaInicio: '16:00', horaFin: '20:00' })).status).toBe(409);   // se cruza 16–17
    expect((await turno(e, e.mesero.staffId, { horaInicio: '17:00', horaFin: '20:00' })).status).toBe(201);   // empieza justo al terminar
    expect((await turno(e, e.otro.staffId, { horaInicio: '16:00', horaFin: '20:00' })).status).toBe(201);     // otra persona sí
    const noche = await turno(e, e.mesero.staffId, { fecha: laPaz(2), horaInicio: '22:00', horaFin: '02:00' });
    expect(noche.status).toBe(201);
    const lista = (await e.jefe.api.get(`/turnos?desde=${laPaz(1)}&hasta=${laPaz(3)}`)).body as { persona: string; fecha: string; horaInicio: string; horaFin: string; cruzaDia: boolean; horas: string; costoPlanificado?: string }[];
    const n = lista.find((x) => x.horaInicio === '22:00')!;
    expect(n).toMatchObject({ persona: 'Marta Mesera', fecha: laPaz(2), horaFin: '02:00', cruzaDia: true, horas: '4.00' });
    expect(n.costoPlanificado).toBeUndefined();                                                                // el jefe de área no ve costos
    expect(lista.find((x) => x.horaInicio === '09:00')).toMatchObject({ horas: '8.00', cruzaDia: false });
    expect((await turno(e, e.mesero.staffId, { fecha: laPaz(3), horaInicio: '01:00', horaFin: '03:00' })).status).toBe(409);   // cruza con el nocturno
  });

  it('valida persona, función, evento, formato y permisos; editar y borrar mientras no haya asistencia', async () => {
    const e = await escenario();
    expect((await turno(e, randomUUID())).status).toBe(400);
    expect((await turno(e, e.mesero.staffId, { funcionId: randomUUID() })).status).toBe(400);
    expect((await turno(e, e.mesero.staffId, { eventoId: randomUUID() })).status).toBe(400);
    expect((await turno(e, e.mesero.staffId, { horaInicio: '9:00' })).status).toBe(400);
    expect((await turno(e, e.mesero.staffId, { horaFin: '09:00' })).status).toBe(400);                         // cero horas
    expect((await turno(e, e.mesero.staffId, { estado: 'x' })).status).toBe(400);                              // .strict()
    expect((await e.mesero.api.post('/turnos', { personaId: e.mesero.staffId, fecha: laPaz(1), horaInicio: '09:00', horaFin: '17:00' })).status).toBe(403);
    const id = (await turno(e, e.mesero.staffId)).body.id as string;
    expect((await e.jefe.api.put(`/turnos/${id}`, { personaId: e.mesero.staffId, fecha: laPaz(1), horaInicio: '10:00', horaFin: '18:00' })).status).toBe(200);
    expect((await e.jefe.api.get(`/turnos?desde=${laPaz(1)}&hasta=${laPaz(1)}`)).body[0]).toMatchObject({ horaInicio: '10:00', horaFin: '18:00' });
    expect((await e.jefe.api.del(`/turnos/${id}`)).status).toBe(200);
    expect((await e.jefe.api.del(`/turnos/${id}`)).status).toBe(404);
    expect((await e.jefe.api.get('/turnos?desde=2026-02-01&hasta=2026-06-01')).status).toBe(400);              // rango demasiado largo
    expect((await e.jefe.api.get('/turnos?desde=2026-02-10&hasta=2026-02-01')).status).toBe(400);
  });

  it('un turno ligado a un evento suma su costo de personal a la cotización del evento', async () => {
    const e = await escenario();
    const ev = (await e.dueno.post('/eventos', { nombre: 'Matrimonio', tipo: 'evento', invitados: 80, fecha: laPaz(5), horaInicio: '19:00', horaFin: '23:00', precio: 4000 })).body.id as string;
    expect((await turno(e, e.mesero.staffId, { fecha: laPaz(5), horaInicio: '18:00', horaFin: '24:00'.replace('24:00', '23:59'), eventoId: ev })).status).toBe(201);
    const c = (await e.dueno.get(`/eventos/${ev}`)).body.cotizacion;
    expect(c.personal).toHaveLength(1);
    expect(c.personal[0]).toMatchObject({ persona: 'Marta Mesera', funcion: 'Mesero de salón' });
    expect(Number(c.costoPersonal)).toBeCloseTo(5.98 * 12.5, 1);   // 5 h 59 min × Bs 12.50
    expect(Number(c.utilidad)).toBeCloseTo(4000 - Number(c.costoTotal), 2);
    await e.dueno.post(`/eventos/${ev}/cancelar`, { motivo: 'prueba' });
    expect((await turno(e, e.otro.staffId, { fecha: laPaz(5), eventoId: ev })).status).toBe(409);               // evento cancelado
  });
});

describe('Asistencia y costo', () => {
  /** Turno que está ocurriendo ahora (empezó hace 5 min) y dura 2 h, para marcar entrada sin esperar. */
  async function turnoAhora(e: E, persona: string, inicioEnMin = -5) {
    const ini = horaLaPaz(inicioEnMin); const fin = horaLaPaz(inicioEnMin + 120);
    const r = await e.jefe.api.post('/turnos', { personaId: persona, fecha: laPaz(0), horaInicio: ini, horaFin: fin });
    return { id: r.body.id as string, status: r.status };
  }

  it('la persona marca sus propias entrada y salida; la salida calcula el pago por horas; no marca las ajenas', async () => {
    const e = await escenario();
    const tn = await turnoAhora(e, e.mesero.staffId); expect(tn.status).toBe(201);
    expect((await e.otro.api.post(`/turnos/${tn.id}/entrada`)).status).toBe(403);                  // ajeno
    expect((await e.mesero.api.post(`/turnos/${tn.id}/salida`)).status).toBe(409);                 // sin entrada
    expect((await e.mesero.api.post(`/turnos/${tn.id}/entrada`)).status).toBe(200);
    expect((await e.mesero.api.post(`/turnos/${tn.id}/entrada`)).status).toBe(409);
    expect((await e.mesero.api.put?.(`/turnos/${tn.id}`, {}) ?? { status: 403 }).status).toBe(403);
    expect((await e.jefe.api.del(`/turnos/${tn.id}`)).status).toBe(409);                           // ya tiene asistencia
    await t.owner.query(`UPDATE shifts SET check_in = now() - interval '2 hours' WHERE id = $1`, [tn.id]);   // simula 2 h trabajadas
    const s = await e.mesero.api.post(`/turnos/${tn.id}/salida`);
    expect(s.status).toBe(200); expect(s.body.horas).toBe('2.00'); expect(s.body.pago).toBeUndefined();   // la persona no ve montos
    expect((await e.mesero.api.post(`/turnos/${tn.id}/salida`)).status).toBe(409);
    const mis = (await e.mesero.api.get('/turnos/mis')).body as { id: string; entrada: string | null; salida: string | null; pago?: string }[];
    expect(mis.find((x) => x.id === tn.id)).toMatchObject({ entrada: expect.any(String), salida: expect.any(String) });
    expect(mis.every((x) => x.pago === undefined)).toBe(true);
    expect(((await e.otro.api.get('/turnos/mis')).body as unknown[]).length).toBe(0);              // cada quien ve los suyos
    const pago = (await t.owner.query('SELECT pay_amount::text AS p FROM shifts WHERE id = $1', [tn.id])).rows[0].p;
    expect(pago).toBe('25.00');                                                                    // 2 h × Bs 12.50
  });

  it('solo desde una hora antes del turno; dueño y jefe pueden marcar por cualquiera', async () => {
    const e = await escenario();
    const lejos = await e.jefe.api.post('/turnos', { personaId: e.mesero.staffId, fecha: laPaz(1), horaInicio: '09:00', horaFin: '17:00' });
    expect((await e.mesero.api.post(`/turnos/${lejos.body.id}/entrada`)).status).toBe(409);        // es mañana
    expect((await e.jefe.api.post(`/turnos/${lejos.body.id}/entrada`)).status).toBe(200);          // el jefe sí puede registrarla
    const pronto = await turnoAhora(e, e.otro.staffId, 30);                                        // empieza en 30 min: dentro de la hora previa
    expect((await e.otro.api.post(`/turnos/${pronto.id}/entrada`)).status).toBe(200);
  });

  it('el reporte de costo suma horas y pagos por persona y por evento, y solo lo ven dueño, administración y contador', async () => {
    const e = await escenario();
    const ev = (await e.dueno.post('/eventos', { nombre: 'Bautizo', tipo: 'evento', invitados: 40, fecha: laPaz(1), horaInicio: '12:00', horaFin: '16:00' })).body.id as string;
    await turno(e, e.mesero.staffId, { horaInicio: '10:00', horaFin: '14:00', eventoId: ev });
    await turno(e, e.otro.staffId, { horaInicio: '10:00', horaFin: '18:00' });
    const c = (await e.contador.api.get(`/turnos/costo?desde=${laPaz(1)}&hasta=${laPaz(1)}`)).body;
    expect(c.personas.find((p: { persona: string }) => p.persona === 'Marta Mesera')).toMatchObject({ turnos: 1, horasProgramadas: '4.00', costoPlanificado: '50.00' });
    expect(c.personas.find((p: { persona: string }) => p.persona === 'Omar Otro')).toMatchObject({ horasProgramadas: '8.00', costoPlanificado: '0.00' });   // sin costo por hora
    expect(c.porEvento).toEqual([{ eventoId: ev, evento: 'Bautizo', horas: '4.00', costoPlanificado: '50.00' }]);
    expect(c.totalPlanificado).toBe('50.00');
    expect((await e.jefe.api.get('/turnos/costo')).status).toBe(403);
    expect((await e.cocina.api.get('/turnos')).status).toBe(403);
  });

  it('otra sucursal no ve ni toca estos turnos (RLS)', async () => {
    const e = await escenario(); const o = await escenario();
    const id = (await turno(e, e.mesero.staffId)).body.id;
    expect((await o.dueno.put(`/turnos/${id}`, { personaId: o.mesero.staffId, fecha: laPaz(1), horaInicio: '10:00', horaFin: '11:00' })).status).toBe(404);
    expect((await o.dueno.post(`/turnos/${id}/entrada`)).status).toBe(404);
    expect((await o.dueno.get(`/turnos?desde=${laPaz(1)}&hasta=${laPaz(1)}`)).body).toHaveLength(0);
    expect((await o.dueno.post('/turnos', { personaId: e.mesero.staffId, fecha: laPaz(1), horaInicio: '10:00', horaFin: '11:00' })).status).toBe(400);   // persona de otra sucursal
  });
});
