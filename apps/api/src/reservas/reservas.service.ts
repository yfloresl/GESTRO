import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { auditar } from '../comun/auditoria';
import { BD, Bd, Tenant, TenantDb } from '../database/database.module';
import { restaurants } from '../database/esquema';
import { EventosGateway, salas } from '../tiempo-real/eventos.gateway';
import { PushService } from '../tiempo-real/push.service';

const Fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha AAAA-MM-DD').refine((s) => !Number.isNaN(Date.parse(s)), 'Fecha inválida');
const Hora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora HH:MM');
const Cliente = z.string().trim().min(2).max(120);
const Telefono = z.string().trim().min(6).max(30);

export const ReservaPublica = z.object({
  cliente: Cliente, telefono: Telefono, email: z.string().trim().email().max(120).optional(), personas: z.number().int().min(1).max(100), fecha: Fecha, hora: Hora, notas: z.string().trim().max(300).optional(),
}).strict();
export const ReservaDelPersonal = z.object({
  cliente: Cliente, telefono: Telefono.optional(), email: z.string().trim().email().max(120).optional(), personas: z.number().int().min(1).max(100), fecha: Fecha, hora: Hora,
  mesaId: z.string().uuid().optional(), notas: z.string().trim().max(300).optional(),
}).strict();
export const Accion = z.object({ accion: z.enum(['confirmar', 'sentar', 'cumplir', 'no_show', 'cancelar']), mesaId: z.string().uuid().optional() }).strict();
export const MoverMesa = z.object({ mesaId: z.string().uuid().nullable() }).strict();
/** Código de la reserva tal como lo escribe el cliente: sin importar mayúsculas, espacios ni guiones. */
export const Cancelar = z.object({ codigo: z.string().trim().min(4).max(16).transform((s) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')).pipe(z.string().length(6)) }).strict();
export const AjustesReservas = z.object({
  habilitadas: z.boolean().optional(), duracionMin: z.number().int().min(30).max(360).optional(), abre: Hora.optional(), cierra: Hora.optional(),
  autoConfirmar: z.boolean().optional(), maxPersonas: z.number().int().min(1).max(100).optional(),
}).strict();
export { Fecha };

type Estado = 'pendiente' | 'confirmada' | 'sentada' | 'cumplida' | 'no_show' | 'cancelada';
const TRANSICION: Record<z.infer<typeof Accion>['accion'], { desde: Estado[]; hacia: Estado }> = {
  confirmar: { desde: ['pendiente'], hacia: 'confirmada' },
  sentar: { desde: ['pendiente', 'confirmada'], hacia: 'sentada' },
  cumplir: { desde: ['sentada'], hacia: 'cumplida' },
  no_show: { desde: ['pendiente', 'confirmada'], hacia: 'no_show' },
  cancelar: { desde: ['pendiente', 'confirmada'], hacia: 'cancelada' },
};
const esChoque = (e: unknown) => { const x = e as { code?: string; cause?: { code?: string } }; return x?.code === '23P01' || x?.cause?.code === '23P01'; };
const esRepetido = (e: unknown) => { const x = e as { code?: string; cause?: { code?: string } }; return x?.code === '23505' || x?.cause?.code === '23505'; };
const minutos = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));

interface Cfg { habilitadas: boolean; dur: number; abre: string; cierra: string; auto: boolean; max: number; tz: string; nombre: string }

/**
 * Reservas. El cliente reserva por la web pública (sin sesión) y el personal las gestiona. La base garantiza con una restricción de
 * exclusión que una mesa no tenga dos reservas activas que se crucen: si dos personas piden la última mesa a la vez, solo una gana.
 */
@Injectable()
export class ReservasService {
  constructor(
    @Inject(BD) private readonly bd: Bd,
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(EventosGateway) private readonly eventos: EventosGateway,
    @Inject(PushService) private readonly push: PushService,
  ) {}

  /* ---------------- ajustes ---------------- */

  private async cfg(tx: Bd, rid: string): Promise<Cfg> {
    const r = (await tx.execute(sql`SELECT reservations_enabled, reservation_minutes, reservation_open::text AS abre, reservation_close::text AS cierra, reservation_auto_confirm, reservation_max_party, timezone, name FROM restaurants WHERE id = ${rid}`)).rows[0] as
      { reservations_enabled: boolean; reservation_minutes: number; abre: string; cierra: string; reservation_auto_confirm: boolean; reservation_max_party: number; timezone: string; name: string };
    return { habilitadas: r.reservations_enabled, dur: r.reservation_minutes, abre: r.abre.slice(0, 5), cierra: r.cierra.slice(0, 5), auto: r.reservation_auto_confirm, max: r.reservation_max_party, tz: r.timezone, nombre: r.name };
  }

  ajustes(t: Tenant) {
    return this.db.run(t, async (tx) => { const c = await this.cfg(tx, t.restaurantId); return { habilitadas: c.habilitadas, duracionMin: c.dur, abre: c.abre, cierra: c.cierra, autoConfirmar: c.auto, maxPersonas: c.max }; });
  }

  cambiarAjustes(t: Tenant, por: string, d: z.infer<typeof AjustesReservas>) {
    return this.db.run(t, async (tx) => {
      const a = await this.cfg(tx, t.restaurantId);
      const abre = d.abre ?? a.abre; const cierra = d.cierra ?? a.cierra; const dur = d.duracionMin ?? a.dur;
      if (minutos(cierra) - minutos(abre) < dur) throw new BadRequestException('El horario de reservas debe alcanzar para al menos una reserva completa.');
      await tx.execute(sql`UPDATE restaurants SET reservations_enabled = ${d.habilitadas ?? a.habilitadas}, reservation_minutes = ${dur}, reservation_open = ${abre}::time, reservation_close = ${cierra}::time,
        reservation_auto_confirm = ${d.autoConfirmar ?? a.auto}, reservation_max_party = ${d.maxPersonas ?? a.max} WHERE id = ${t.restaurantId}`);
      await auditar(tx, t.restaurantId, por, 'reservas.ajustes', 'restaurant', t.restaurantId, d);
      return { ok: true };
    });
  }

  /* ---------------- reglas ---------------- */

  /** Instante de inicio y fin (UTC, ISO) de una reserva dada en la hora local de la sucursal. */
  private async rango(tx: Bd, c: Cfg, fecha: string, hora: string) {
    const r = (await tx.execute(sql`SELECT (((${fecha}::date + ${hora}::time)::timestamp) AT TIME ZONE ${c.tz})::text AS ini,
      ((((${fecha}::date + ${hora}::time)::timestamp) AT TIME ZONE ${c.tz}) + make_interval(mins => ${c.dur}::int))::text AS fin,
      ((((${fecha}::date + ${hora}::time)::timestamp) AT TIME ZONE ${c.tz}) > now()) AS futura`)).rows[0] as { ini: string; fin: string; futura: boolean };
    return r;
  }

  private validar(c: Cfg, personas: number, hora: string) {
    if (personas > c.max) throw new BadRequestException(`Para grupos de más de ${c.max} personas, llama al restaurante.`);
    const m = minutos(hora);
    if (m % 15 !== 0) throw new BadRequestException('Las reservas se toman cada 15 minutos.');
    if (m < minutos(c.abre) || m + c.dur > minutos(c.cierra)) throw new BadRequestException(`Se reserva entre las ${c.abre} y las ${c.cierra} (la reserva dura ${c.dur} minutos).`);
  }

  private async mesaLibre(tx: Bd, rid: string, personas: number, ini: string, fin: string): Promise<string> {
    const hay = (await tx.execute(sql`SELECT 1 FROM restaurant_tables WHERE restaurant_id = ${rid} AND active AND seats >= ${personas}::int LIMIT 1`)).rows.length;
    if (!hay) throw new ConflictException('No tenemos una mesa para esa cantidad de personas.');
    const m = (await tx.execute(sql`SELECT t.id FROM restaurant_tables t WHERE t.restaurant_id = ${rid} AND t.active AND t.seats >= ${personas}::int
      AND NOT EXISTS (SELECT 1 FROM reservations r WHERE r.table_id = t.id AND r.state IN ('pendiente','confirmada','sentada') AND tstzrange(r.starts_at, r.ends_at) && tstzrange(${ini}::timestamptz, ${fin}::timestamptz))
      ORDER BY t.seats, t.number LIMIT 1`)).rows[0] as { id: string } | undefined;
    if (!m) throw new ConflictException('No hay mesa disponible a esa hora. Prueba con otro horario.');
    return m.id;
  }

  private async insertar(tx: Bd, rid: string, c: Cfg, por: string | null, origen: string, d: { cliente: string; telefono?: string; email?: string; personas: number; fecha: string; hora: string; notas?: string; mesaId?: string }, estado: Estado) {
    this.validar(c, d.personas, d.hora);
    const r = await this.rango(tx, c, d.fecha, d.hora);
    if (!r.futura) throw new BadRequestException('Esa hora ya pasó.');
    let mesa = d.mesaId;
    if (mesa) {
      const m = (await tx.execute(sql`SELECT seats FROM restaurant_tables WHERE id = ${mesa} AND restaurant_id = ${rid} AND active`)).rows[0] as { seats: number } | undefined;
      if (!m) throw new BadRequestException('La mesa no existe en esta sucursal.');
      if (m.seats < d.personas) throw new BadRequestException(`La mesa tiene ${m.seats} asientos: no alcanza para ${d.personas}.`);
    } else mesa = await this.mesaLibre(tx, rid, d.personas, r.ini, r.fin);
    // El código corto (6 caracteres) es único por sucursal: si dos coinciden, la base lo rechaza y se reintenta con otro.
    for (let intento = 0; ; intento++) {
    try {
      return await tx.transaction(async (sp) => {
        const x = (await (sp as unknown as Bd).execute(sql`INSERT INTO reservations (restaurant_id, table_id, customer_name, phone, email, party_size, starts_at, ends_at, state, notes, source, created_by)
          VALUES (${rid}, ${mesa}::uuid, ${d.cliente}, ${d.telefono ?? null}, ${d.email ?? null}, ${d.personas}, ${r.ini}::timestamptz, ${r.fin}::timestamptz, ${estado}::reservation_state, ${d.notas ?? null}, ${origen}, ${por}::uuid) RETURNING id, code`)).rows[0] as { id: string; code: string };
        return x;
      });
    } catch (e) {
      if (esChoque(e)) throw new ConflictException('Esa mesa se acaba de ocupar. Prueba con otro horario.');
      if (esRepetido(e) && intento < 4) continue;
      throw e;
    }
    }
  }

  private async avisar(tx: Bd, rid: string, d: { cliente: string; personas: number; fecha: string; hora: string }, id: string) {
    this.eventos.emitir(salas.sucursal(rid), 'reserva.nueva', { id });
    const dest = (await tx.execute(sql`SELECT DISTINCT ur.user_id FROM user_roles ur JOIN roles ro ON ro.id = ur.role_id WHERE ur.restaurant_id = ${rid} AND ro.code IN ('owner','admin','cajero')`)).rows as { user_id: string }[];
    void this.push.avisar(dest.map((x) => x.user_id), { titulo: 'Nueva reserva', cuerpo: `${d.cliente} · ${d.personas} personas · ${d.fecha} ${d.hora}`, url: '/app/reservas', etiqueta: `reserva-${id}` });
  }

  /* ---------------- público (sin sesión) ---------------- */

  private async sucursal(slug: string) {
    const [r] = await this.bd.select({ id: restaurants.id, estado: restaurants.status, demo: restaurants.isDemo }).from(restaurants).where(eq(restaurants.slug, slug));
    if (!r || r.estado !== 'activo') throw new NotFoundException('Restaurante no encontrado.');
    return { restaurantId: r.id, restaurantIds: [], ...(r.demo ? { demo: true } : {}) } as Tenant & { demo?: boolean };
  }

  async publica(slug: string) {
    const t = await this.sucursal(slug);
    return this.db.run(t, async (tx) => {
      const c = await this.cfg(tx, t.restaurantId);
      return { restaurante: c.nombre, habilitadas: c.habilitadas, duracionMin: c.dur, abre: c.abre, cierra: c.cierra, maxPersonas: c.max, confirmaSola: c.auto };
    });
  }

  async disponibilidad(slug: string, fecha: string, personas: number) {
    const t = await this.sucursal(slug);
    return this.db.run(t, async (tx) => {
      const c = await this.cfg(tx, t.restaurantId);
      if (!c.habilitadas) throw new NotFoundException('Este restaurante no recibe reservas por la web.');
      if (personas > c.max) throw new BadRequestException(`Para grupos de más de ${c.max} personas, llama al restaurante.`);
      const r = await tx.execute(sql`WITH s AS (SELECT gs AS l FROM generate_series((${fecha}::date + ${c.abre}::time)::timestamp, (${fecha}::date + ${c.cierra}::time)::timestamp - make_interval(mins => ${c.dur}::int), interval '30 minutes') gs)
        SELECT to_char(s.l, 'HH24:MI') AS hora FROM s
        WHERE (s.l AT TIME ZONE ${c.tz}) > now()
          AND EXISTS (SELECT 1 FROM restaurant_tables t WHERE t.restaurant_id = ${t.restaurantId} AND t.active AND t.seats >= ${personas}::int
            AND NOT EXISTS (SELECT 1 FROM reservations r WHERE r.table_id = t.id AND r.state IN ('pendiente','confirmada','sentada')
              AND tstzrange(r.starts_at, r.ends_at) && tstzrange(s.l AT TIME ZONE ${c.tz}, (s.l AT TIME ZONE ${c.tz}) + make_interval(mins => ${c.dur}::int))))
        ORDER BY s.l`);
      return { fecha, personas, duracionMin: c.dur, horas: (r.rows as { hora: string }[]).map((x) => x.hora) };
    });
  }

  async reservar(slug: string, d: z.infer<typeof ReservaPublica>) {
    const t = await this.sucursal(slug);
    if ((t as { demo?: boolean }).demo) throw new ForbiddenException('Esta sucursal es de muestra y no recibe pedidos, llamados ni reservas reales.');
    return this.db.run(t, async (tx) => {
      const c = await this.cfg(tx, t.restaurantId);
      if (!c.habilitadas) throw new NotFoundException('Este restaurante no recibe reservas por la web.');
      const dup = (await tx.execute(sql`SELECT 1 FROM reservations WHERE restaurant_id = ${t.restaurantId} AND phone = ${d.telefono} AND state IN ('pendiente','confirmada') AND starts_at > now() HAVING count(*) >= 3`)).rows.length;
      if (dup) throw new ConflictException('Ya tienes varias reservas pendientes con este teléfono. Cancela alguna o llama al restaurante.');
      const estado: Estado = c.auto ? 'confirmada' : 'pendiente';
      const x = await this.insertar(tx, t.restaurantId, c, null, 'web', d, estado);
      await this.avisar(tx, t.restaurantId, d, x.id);
      return { codigo: x.code, estado, restaurante: c.nombre, fecha: d.fecha, hora: d.hora, personas: d.personas, duracionMin: c.dur };
    });
  }

  async cancelarPublica(slug: string, codigo: string) {
    const t = await this.sucursal(slug);
    if ((t as { demo?: boolean }).demo) throw new ForbiddenException('Esta sucursal es de muestra y no recibe pedidos, llamados ni reservas reales.');
    return this.db.run(t, async (tx) => {
      const r = (await tx.execute(sql`UPDATE reservations SET state = 'cancelada' WHERE restaurant_id = ${t.restaurantId} AND code = ${codigo} AND state IN ('pendiente','confirmada') AND starts_at > now() RETURNING id`)).rows[0] as { id: string } | undefined;
      if (!r) throw new ConflictException('No encontramos una reserva activa con ese código (o ya no se puede cancelar).');
      this.eventos.emitir(salas.sucursal(t.restaurantId), 'reserva.cambio', { id: r.id });
      return { ok: true };
    });
  }

  /* ---------------- personal ---------------- */

  dia(t: Tenant, fecha: string) {
    return this.db.run(t, async (tx) => {
      const c = await this.cfg(tx, t.restaurantId);
      const r = await tx.execute(sql`SELECT r.id, r.code, r.customer_name, r.phone, r.email, r.party_size, r.state::text AS estado, r.notes, r.source, t.number AS mesa, r.table_id,
          to_char(r.starts_at AT TIME ZONE ${c.tz}, 'HH24:MI') AS hora, to_char(r.ends_at AT TIME ZONE ${c.tz}, 'HH24:MI') AS hasta
        FROM reservations r LEFT JOIN restaurant_tables t ON t.id = r.table_id
        WHERE r.restaurant_id = ${t.restaurantId} AND (r.starts_at AT TIME ZONE ${c.tz})::date = ${fecha}::date ORDER BY r.starts_at, r.customer_name`);
      return (r.rows as { id: string; code: string; customer_name: string; phone: string | null; email: string | null; party_size: number; estado: Estado; notes: string | null; source: string; mesa: string | null; table_id: string | null; hora: string; hasta: string }[])
        .map((x) => ({ id: x.id, codigo: x.code, cliente: x.customer_name, telefono: x.phone, email: x.email, personas: x.party_size, estado: x.estado, notas: x.notes, origen: x.source, mesa: x.mesa, mesaId: x.table_id, hora: x.hora, hasta: x.hasta }));
    });
  }

  crear(t: Tenant, por: string, d: z.infer<typeof ReservaDelPersonal>) {
    return this.db.run(t, async (tx) => {
      const c = await this.cfg(tx, t.restaurantId);
      const x = await this.insertar(tx, t.restaurantId, c, por, 'personal', d, 'confirmada');
      await auditar(tx, t.restaurantId, por, 'reservas.creada', 'reservation', x.id, { cliente: d.cliente, fecha: d.fecha, hora: d.hora, personas: d.personas });
      return { id: x.id, codigo: x.code };
    });
  }

  cambiarEstado(t: Tenant, por: string, id: string, d: z.infer<typeof Accion>) {
    return this.db.run(t, async (tx) => {
      const r = (await tx.execute(sql`SELECT state::text AS estado, table_id, party_size FROM reservations WHERE id = ${id} AND restaurant_id = ${t.restaurantId} FOR UPDATE`)).rows[0] as { estado: Estado; table_id: string | null; party_size: number } | undefined;
      if (!r) throw new NotFoundException('Reserva no encontrada.');
      const tr = TRANSICION[d.accion];
      if (!tr.desde.includes(r.estado)) throw new ConflictException(`Una reserva ${r.estado.replace('_', ' ')} no puede pasar a «${d.accion}».`);
      const mesa = d.mesaId ?? r.table_id;
      if (d.accion === 'sentar' && !mesa) throw new BadRequestException('Asigna una mesa antes de sentar a los clientes.');
      try {
        await tx.transaction(async (sp) => { await (sp as unknown as Bd).execute(sql`UPDATE reservations SET state = ${tr.hacia}::reservation_state, table_id = ${mesa}::uuid WHERE id = ${id}`); });
      } catch (e) { if (esChoque(e)) throw new ConflictException('Esa mesa ya está reservada en ese horario.'); throw e; }
      await auditar(tx, t.restaurantId, por, `reservas.${d.accion}`, 'reservation', id, { de: r.estado, a: tr.hacia });
      this.eventos.emitir(salas.sucursal(t.restaurantId), 'reserva.cambio', { id });
      return { ok: true, estado: tr.hacia };
    });
  }

  moverMesa(t: Tenant, por: string, id: string, d: z.infer<typeof MoverMesa>) {
    return this.db.run(t, async (tx) => {
      const r = (await tx.execute(sql`SELECT state::text AS estado, party_size FROM reservations WHERE id = ${id} AND restaurant_id = ${t.restaurantId} FOR UPDATE`)).rows[0] as { estado: Estado; party_size: number } | undefined;
      if (!r) throw new NotFoundException('Reserva no encontrada.');
      if (!['pendiente', 'confirmada', 'sentada'].includes(r.estado)) throw new ConflictException('Esta reserva ya está cerrada.');
      if (d.mesaId) {
        const m = (await tx.execute(sql`SELECT seats FROM restaurant_tables WHERE id = ${d.mesaId} AND restaurant_id = ${t.restaurantId} AND active`)).rows[0] as { seats: number } | undefined;
        if (!m) throw new BadRequestException('La mesa no existe en esta sucursal.');
        if (m.seats < r.party_size) throw new BadRequestException(`La mesa tiene ${m.seats} asientos: no alcanza para ${r.party_size}.`);
      } else if (r.estado === 'sentada') throw new BadRequestException('Una reserva sentada necesita mesa.');
      try {
        await tx.transaction(async (sp) => { await (sp as unknown as Bd).execute(sql`UPDATE reservations SET table_id = ${d.mesaId}::uuid WHERE id = ${id}`); });
      } catch (e) { if (esChoque(e)) throw new ConflictException('Esa mesa ya está reservada en ese horario.'); throw e; }
      await auditar(tx, t.restaurantId, por, 'reservas.mesa', 'reservation', id, d);
      this.eventos.emitir(salas.sucursal(t.restaurantId), 'reserva.cambio', { id });
      return { ok: true };
    });
  }
}
