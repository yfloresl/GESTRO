import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { z } from 'zod';
import { auditar, esDuplicado } from '../comun/auditoria';
import { Bd, Tenant, TenantDb } from '../database/database.module';

const Fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha AAAA-MM-DD').refine((s) => !Number.isNaN(Date.parse(s)), 'Fecha inválida');
const Hora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora HH:MM');
const Dinero = z.number().min(0).max(1_000_000).refine((n) => Math.round(n * 100) / 100 === n, 'Máximo 2 decimales');

export const Funcion = z.object({ nombre: z.string().trim().min(2).max(60), descripcion: z.string().trim().max(200).nullable().optional() }).strict();
export const Eventual = z.object({ nombre: z.string().trim().min(2).max(120), telefono: z.string().trim().max(30).nullable().optional(), documento: z.string().trim().max(30).nullable().optional(), funcionId: z.string().uuid().nullable().optional(), costoHora: Dinero.nullable().optional() }).strict();
export const DatosLaborales = z.object({ funcionId: z.string().uuid().nullable().optional(), costoHora: Dinero.nullable().optional(), sueldoMensual: Dinero.nullable().optional(), documento: z.string().trim().max(30).nullable().optional() }).strict();
export const NuevoTurno = z.object({
  personaId: z.string().uuid(), funcionId: z.string().uuid().nullable().optional(), eventoId: z.string().uuid().nullable().optional(),
  fecha: Fecha, horaInicio: Hora, horaFin: Hora, notas: z.string().trim().max(200).nullable().optional(),
}).strict();
export { Fecha };

const esChoque = (e: unknown) => { const x = e as { code?: string; cause?: { code?: string } }; return x?.code === '23P01' || x?.cause?.code === '23P01'; };

/**
 * Turnos y asistencia del personal. Un turno que termina antes de lo que empieza cruza la medianoche. La base impide que una persona
 * tenga dos turnos que se crucen. La entrada y la salida las marca la propia persona (o dueño/administración) y la salida calcula el pago
 * por horas trabajadas cuando la persona tiene costo por hora.
 */
@Injectable()
export class TurnosService {
  constructor(@Inject(TenantDb) private readonly db: TenantDb) {}

  private async tz(tx: Bd, t: Tenant) { return ((await tx.execute(sql`SELECT timezone FROM restaurants WHERE id = ${t.restaurantId}`)).rows[0] as { timezone: string }).timezone; }

  /* ---------------- funciones ---------------- */

  funciones(t: Tenant) {
    return this.db.run(t, async (tx) => (await tx.execute(sql`SELECT f.id, f.name AS nombre, f.description AS descripcion, (SELECT count(*)::int FROM staff_members s WHERE s.function_id = f.id AND s.active) AS personas FROM staff_functions f WHERE f.restaurant_id = ${t.restaurantId} ORDER BY f.name`)).rows);
  }
  crearFuncion(t: Tenant, por: string, d: z.infer<typeof Funcion>) {
    return this.db.run(t, async (tx) => {
      try {
        const r = (await tx.execute(sql`INSERT INTO staff_functions (restaurant_id, name, description) VALUES (${t.restaurantId}, ${d.nombre}, ${d.descripcion ?? null}) RETURNING id`)).rows[0] as { id: string };
        await auditar(tx, t.restaurantId, por, 'turnos.funcion_creada', 'staff_function', r.id, d);
        return { id: r.id };
      } catch (e) { if (esDuplicado(e)) throw new ConflictException('Ya existe una función con ese nombre.'); throw e; }
    });
  }
  borrarFuncion(t: Tenant, por: string, id: string) {
    return this.db.run(t, async (tx) => {
      const uso = (await tx.execute(sql`SELECT (SELECT count(*) FROM staff_members WHERE function_id = ${id}) + (SELECT count(*) FROM shifts WHERE function_id = ${id}) AS n`)).rows[0] as { n: string };
      if (Number(uso.n) > 0) throw new ConflictException('Hay personas o turnos con esta función: quítala de ellos primero.');
      const r = await tx.execute(sql`DELETE FROM staff_functions WHERE id = ${id} AND restaurant_id = ${t.restaurantId} RETURNING id`);
      if (!r.rows.length) throw new NotFoundException('Función no encontrada.');
      await auditar(tx, t.restaurantId, por, 'turnos.funcion_borrada', 'staff_function', id);
      return { ok: true };
    });
  }

  private async funcionValida(tx: Bd, t: Tenant, id: string | null | undefined) {
    if (!id) return;
    if (!(await tx.execute(sql`SELECT 1 FROM staff_functions WHERE id = ${id} AND restaurant_id = ${t.restaurantId}`)).rows.length) throw new BadRequestException('La función no existe en esta sucursal.');
  }

  /* ---------------- personas ---------------- */

  /** Personal con su función. El costo por hora y el sueldo solo los ve quien administra o lleva las cuentas. */
  personas(t: Tenant, verPago: boolean) {
    return this.db.run(t, async (tx) => {
      const r = await tx.execute(sql`SELECT s.id, s.full_name, s.phone, s.document_id, s.kind::text AS kind, s.active, s.function_id, f.name AS funcion, s.hourly_cost::text AS hourly_cost, s.monthly_salary::text AS monthly_salary, (s.user_id IS NOT NULL) AS tiene_usuario
        FROM staff_members s LEFT JOIN staff_functions f ON f.id = s.function_id WHERE s.restaurant_id = ${t.restaurantId} ORDER BY s.active DESC, s.full_name`);
      return (r.rows as { id: string; full_name: string; phone: string | null; document_id: string | null; kind: string; active: boolean; function_id: string | null; funcion: string | null; hourly_cost: string | null; monthly_salary: string | null; tiene_usuario: boolean }[])
        .map((p) => ({ id: p.id, nombre: p.full_name, telefono: p.phone, documento: p.document_id, tipo: p.kind, activo: p.active, funcionId: p.function_id, funcion: p.funcion, tieneUsuario: p.tiene_usuario, ...(verPago ? { costoHora: p.hourly_cost, sueldoMensual: p.monthly_salary } : {}) }));
    });
  }

  /** Persona eventual (sin usuario del sistema): para eventos y reemplazos. */
  crearEventual(t: Tenant, por: string, d: z.infer<typeof Eventual>) {
    return this.db.run(t, async (tx) => {
      await this.funcionValida(tx, t, d.funcionId);
      const r = (await tx.execute(sql`INSERT INTO staff_members (restaurant_id, full_name, phone, document_id, kind, function_id, hourly_cost) VALUES (${t.restaurantId}, ${d.nombre}, ${d.telefono ?? null}, ${d.documento ?? null}, 'temporal', ${d.funcionId ?? null}, ${d.costoHora ?? null}::numeric) RETURNING id`)).rows[0] as { id: string };
      await auditar(tx, t.restaurantId, por, 'turnos.eventual_creado', 'staff', r.id, { nombre: d.nombre });
      return { id: r.id };
    });
  }

  datosLaborales(t: Tenant, por: string, id: string, d: z.infer<typeof DatosLaborales>) {
    return this.db.run(t, async (tx) => {
      await this.funcionValida(tx, t, d.funcionId);
      const s = (await tx.execute(sql`SELECT function_id, hourly_cost::text AS hc, monthly_salary::text AS ms, document_id FROM staff_members WHERE id = ${id} AND restaurant_id = ${t.restaurantId} FOR UPDATE`)).rows[0] as { function_id: string | null; hc: string | null; ms: string | null; document_id: string | null } | undefined;
      if (!s) throw new NotFoundException('Persona no encontrada.');
      await tx.execute(sql`UPDATE staff_members SET function_id = ${d.funcionId !== undefined ? d.funcionId : s.function_id}, hourly_cost = ${d.costoHora !== undefined ? d.costoHora : s.hc}::numeric,
        monthly_salary = ${d.sueldoMensual !== undefined ? d.sueldoMensual : s.ms}::numeric, document_id = ${d.documento !== undefined ? d.documento : s.document_id} WHERE id = ${id}`);
      await auditar(tx, t.restaurantId, por, 'turnos.datos_laborales', 'staff', id, { funcionId: d.funcionId, costoHora: d.costoHora, sueldoMensual: d.sueldoMensual });
      return { ok: true };
    });
  }

  /* ---------------- turnos ---------------- */

  private async rango(tx: Bd, tz: string, fecha: string, ini: string, fin: string) {
    if (fin === ini) throw new BadRequestException('El turno no puede durar cero horas.');
    return (await tx.execute(sql`SELECT ((${fecha}::date + ${ini}::time)::timestamp AT TIME ZONE ${tz})::text AS ini,
      (((${fecha}::date + ${ini === fin ? '00:00' : fin}::time)::timestamp + CASE WHEN ${fin}::time <= ${ini}::time THEN interval '1 day' ELSE interval '0' END) AT TIME ZONE ${tz})::text AS fin`)).rows[0] as { ini: string; fin: string };
  }

  private async validarTurno(tx: Bd, t: Tenant, d: z.infer<typeof NuevoTurno>) {
    const p = (await tx.execute(sql`SELECT active, function_id FROM staff_members WHERE id = ${d.personaId} AND restaurant_id = ${t.restaurantId}`)).rows[0] as { active: boolean; function_id: string | null } | undefined;
    if (!p) throw new BadRequestException('La persona no existe en esta sucursal.');
    if (!p.active) throw new BadRequestException('La persona está desactivada.');
    await this.funcionValida(tx, t, d.funcionId);
    if (d.eventoId) {
      const e = (await tx.execute(sql`SELECT status FROM events WHERE id = ${d.eventoId} AND restaurant_id = ${t.restaurantId}`)).rows[0] as { status: string } | undefined;
      if (!e) throw new BadRequestException('El evento no existe en esta sucursal.');
      if (['cerrado', 'cancelado'].includes(e.status)) throw new ConflictException('Ese evento ya terminó o se canceló.');
    }
    return d.funcionId ?? p.function_id;
  }

  crear(t: Tenant, por: string, d: z.infer<typeof NuevoTurno>) {
    return this.db.run(t, async (tx) => {
      const funcion = await this.validarTurno(tx, t, d);
      const r = await this.rango(tx, await this.tz(tx, t), d.fecha, d.horaInicio, d.horaFin);
      try {
        const x = await tx.transaction(async (sp) => (await (sp as unknown as Bd).execute(sql`INSERT INTO shifts (restaurant_id, staff_id, function_id, event_id, starts_at, ends_at, notes, created_by)
          VALUES (${t.restaurantId}, ${d.personaId}, ${funcion}::uuid, ${d.eventoId ?? null}::uuid, ${r.ini}::timestamptz, ${r.fin}::timestamptz, ${d.notas ?? null}, ${por}::uuid) RETURNING id`)).rows[0] as { id: string });
        await auditar(tx, t.restaurantId, por, 'turnos.creado', 'shift', x.id, { personaId: d.personaId, fecha: d.fecha, horaInicio: d.horaInicio, horaFin: d.horaFin });
        return { id: x.id };
      } catch (e) { if (esChoque(e)) throw new ConflictException('Esa persona ya tiene un turno que se cruza con ese horario.'); throw e; }
    });
  }

  cambiar(t: Tenant, por: string, id: string, d: z.infer<typeof NuevoTurno>) {
    return this.db.run(t, async (tx) => {
      const s = (await tx.execute(sql`SELECT check_in FROM shifts WHERE id = ${id} AND restaurant_id = ${t.restaurantId} FOR UPDATE`)).rows[0] as { check_in: Date | null } | undefined;
      if (!s) throw new NotFoundException('Turno no encontrado.');
      if (s.check_in) throw new ConflictException('El turno ya tiene entrada marcada: no se modifica.');
      const funcion = await this.validarTurno(tx, t, d);
      const r = await this.rango(tx, await this.tz(tx, t), d.fecha, d.horaInicio, d.horaFin);
      try {
        await tx.transaction(async (sp) => { await (sp as unknown as Bd).execute(sql`UPDATE shifts SET staff_id = ${d.personaId}, function_id = ${funcion}::uuid, event_id = ${d.eventoId ?? null}::uuid, starts_at = ${r.ini}::timestamptz, ends_at = ${r.fin}::timestamptz, notes = ${d.notas ?? null} WHERE id = ${id}`); });
      } catch (e) { if (esChoque(e)) throw new ConflictException('Esa persona ya tiene un turno que se cruza con ese horario.'); throw e; }
      await auditar(tx, t.restaurantId, por, 'turnos.cambiado', 'shift', id, d);
      return { ok: true };
    });
  }

  borrar(t: Tenant, por: string, id: string) {
    return this.db.run(t, async (tx) => {
      const s = (await tx.execute(sql`SELECT check_in FROM shifts WHERE id = ${id} AND restaurant_id = ${t.restaurantId} FOR UPDATE`)).rows[0] as { check_in: Date | null } | undefined;
      if (!s) throw new NotFoundException('Turno no encontrado.');
      if (s.check_in) throw new ConflictException('El turno ya tiene asistencia registrada: no se borra.');
      await tx.execute(sql`DELETE FROM shifts WHERE id = ${id}`);
      await auditar(tx, t.restaurantId, por, 'turnos.borrado', 'shift', id);
      return { ok: true };
    });
  }

  private async listar(tx: Bd, t: Tenant, desde: string, hasta: string, soloPersona?: string, verPago = true) {
    const tz = await this.tz(tx, t);
    const r = await tx.execute(sql`SELECT s.id, s.staff_id, m.full_name, f.name AS funcion, s.event_id, e.name AS evento, s.notes,
        to_char(s.starts_at AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS fecha, to_char(s.starts_at AT TIME ZONE ${tz}, 'HH24:MI') AS ini, to_char(s.ends_at AT TIME ZONE ${tz}, 'HH24:MI') AS fin,
        (s.ends_at AT TIME ZONE ${tz})::date > (s.starts_at AT TIME ZONE ${tz})::date AS cruza,
        to_char(s.check_in AT TIME ZONE ${tz}, 'HH24:MI') AS entrada, to_char(s.check_out AT TIME ZONE ${tz}, 'HH24:MI') AS salida,
        round(extract(epoch FROM (s.ends_at - s.starts_at)) / 3600, 2)::text AS horas, s.pay_amount::text AS pago,
        round(extract(epoch FROM (s.ends_at - s.starts_at)) / 3600 * COALESCE(m.hourly_cost, 0), 2)::text AS costo_plan
      FROM shifts s JOIN staff_members m ON m.id = s.staff_id LEFT JOIN staff_functions f ON f.id = s.function_id LEFT JOIN events e ON e.id = s.event_id
      WHERE s.restaurant_id = ${t.restaurantId} AND (s.starts_at AT TIME ZONE ${tz})::date BETWEEN ${desde}::date AND ${hasta}::date ${soloPersona ? sql`AND s.staff_id = ${soloPersona}` : sql``}
      ORDER BY s.starts_at, m.full_name LIMIT 1000`);
    return (r.rows as { id: string; staff_id: string; full_name: string; funcion: string | null; event_id: string | null; evento: string | null; notes: string | null; fecha: string; ini: string; fin: string; cruza: boolean; entrada: string | null; salida: string | null; horas: string; pago: string | null; costo_plan: string }[])
      .map((x) => ({ id: x.id, personaId: x.staff_id, persona: x.full_name, funcion: x.funcion, eventoId: x.event_id, evento: x.evento, notas: x.notes, fecha: x.fecha, horaInicio: x.ini, horaFin: x.fin, cruzaDia: x.cruza, entrada: x.entrada, salida: x.salida, horas: x.horas, ...(verPago ? { pago: x.pago, costoPlanificado: x.costo_plan } : {}) }));
  }

  lista(t: Tenant, desde: string, hasta: string, verPago: boolean) { return this.db.run(t, (tx) => this.listar(tx, t, desde, hasta, undefined, verPago)); }

  /** Mis turnos de los próximos días, para cualquier persona del equipo con usuario. */
  mis(t: Tenant, userId: string, desde: string, hasta: string) {
    return this.db.run(t, async (tx) => {
      const p = (await tx.execute(sql`SELECT id FROM staff_members WHERE user_id = ${userId}::uuid AND restaurant_id = ${t.restaurantId}`)).rows[0] as { id: string } | undefined;
      return p ? this.listar(tx, t, desde, hasta, p.id, false) : [];
    });
  }

  /** Marca la entrada o la salida. La persona solo marca las suyas y dentro de su horario; dueño y administración, las de cualquiera. */
  marcar(t: Tenant, userId: string, administra: boolean, id: string, que: 'entrada' | 'salida') {
    return this.db.run(t, async (tx) => {
      const s = (await tx.execute(sql`SELECT s.check_in, s.check_out, s.starts_at, s.ends_at, m.user_id, m.hourly_cost::text AS hc FROM shifts s JOIN staff_members m ON m.id = s.staff_id WHERE s.id = ${id} AND s.restaurant_id = ${t.restaurantId} FOR UPDATE OF s`)).rows[0] as
        { check_in: Date | null; check_out: Date | null; starts_at: Date; ends_at: Date; user_id: string | null; hc: string | null } | undefined;
      if (!s) throw new NotFoundException('Turno no encontrado.');
      if (!administra && s.user_id !== userId) throw new ForbiddenException('Solo puedes marcar tus propios turnos.');
      if (que === 'entrada') {
        if (s.check_in) throw new ConflictException('La entrada ya está marcada.');
        if (!administra) {
          const ok = (await tx.execute(sql`SELECT (now() >= ${s.starts_at}::timestamptz - interval '60 minutes' AND now() <= ${s.ends_at}::timestamptz) AS ok`)).rows[0] as { ok: boolean };
          if (!ok.ok) throw new ConflictException('Solo puedes marcar entrada desde una hora antes del turno y hasta que termine.');
        }
        await tx.execute(sql`UPDATE shifts SET check_in = now() WHERE id = ${id}`);
        await auditar(tx, t.restaurantId, userId, 'turnos.entrada', 'shift', id);
        return { ok: true };
      }
      if (!s.check_in) throw new ConflictException('Primero marca la entrada.');
      if (s.check_out) throw new ConflictException('La salida ya está marcada.');
      const r = (await tx.execute(sql`UPDATE shifts SET check_out = now(), pay_amount = CASE WHEN ${s.hc}::numeric IS NULL THEN NULL ELSE round(extract(epoch FROM (now() - check_in)) / 3600 * ${s.hc}::numeric, 2) END WHERE id = ${id}
        RETURNING pay_amount::text AS pago, round(extract(epoch FROM (check_out - check_in)) / 3600, 2)::text AS horas`)).rows[0] as { pago: string | null; horas: string };
      await auditar(tx, t.restaurantId, userId, 'turnos.salida', 'shift', id, r);
      return { ok: true, horas: r.horas, pago: administra ? r.pago : undefined };
    });
  }

  /** Costo de personal del período: horas programadas y trabajadas, pago por horas y costo planificado, por persona y por evento. */
  costo(t: Tenant, desde: string, hasta: string) {
    return this.db.run(t, async (tx) => {
      const filas = await this.listar(tx, t, desde, hasta, undefined, true);
      const por = new Map<string, { personaId: string; persona: string; turnos: number; horasProgramadas: Decimal; horasTrabajadas: Decimal; pago: Decimal; planificado: Decimal }>();
      const evs = new Map<string, { evento: string; horas: Decimal; planificado: Decimal }>();
      for (const f of filas) {
        const a = por.get(f.personaId) ?? { personaId: f.personaId, persona: f.persona, turnos: 0, horasProgramadas: new Decimal(0), horasTrabajadas: new Decimal(0), pago: new Decimal(0), planificado: new Decimal(0) };
        a.turnos++; a.horasProgramadas = a.horasProgramadas.plus(f.horas); a.planificado = a.planificado.plus(f.costoPlanificado ?? 0); if (f.pago) a.pago = a.pago.plus(f.pago);
        por.set(f.personaId, a);
        if (f.eventoId) { const e = evs.get(f.eventoId) ?? { evento: f.evento ?? '', horas: new Decimal(0), planificado: new Decimal(0) }; e.horas = e.horas.plus(f.horas); e.planificado = e.planificado.plus(f.costoPlanificado ?? 0); evs.set(f.eventoId, e); }
      }
      const trab = (await tx.execute(sql`SELECT s.staff_id, round(SUM(extract(epoch FROM (s.check_out - s.check_in))) / 3600, 2)::text AS h FROM shifts s WHERE s.restaurant_id = ${t.restaurantId} AND s.check_out IS NOT NULL
        AND (s.starts_at AT TIME ZONE (SELECT timezone FROM restaurants WHERE id = ${t.restaurantId}))::date BETWEEN ${desde}::date AND ${hasta}::date GROUP BY s.staff_id`)).rows as { staff_id: string; h: string }[];
      for (const x of trab) { const a = por.get(x.staff_id); if (a) a.horasTrabajadas = new Decimal(x.h); }
      const personas = [...por.values()].map((a) => ({ personaId: a.personaId, persona: a.persona, turnos: a.turnos, horasProgramadas: a.horasProgramadas.toFixed(2), horasTrabajadas: a.horasTrabajadas.toFixed(2), pagoPorHoras: a.pago.toFixed(2), costoPlanificado: a.planificado.toFixed(2) })).sort((a, b) => a.persona.localeCompare(b.persona));
      return { desde, hasta, personas, porEvento: [...evs].map(([id, e]) => ({ eventoId: id, evento: e.evento, horas: e.horas.toFixed(2), costoPlanificado: e.planificado.toFixed(2) })),
        totalPagoPorHoras: personas.reduce((s, p) => s.plus(p.pagoPorHoras), new Decimal(0)).toFixed(2), totalPlanificado: personas.reduce((s, p) => s.plus(p.costoPlanificado), new Decimal(0)).toFixed(2) };
    });
  }
}
