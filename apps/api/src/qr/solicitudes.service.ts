import { ConflictException, HttpException, Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { and, desc, eq, gt, inArray, isNull, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { auditar, esDuplicado } from '../comun/auditoria';
import { BD, Bd, Tenant, TenantDb } from '../database/database.module';
import { areas, restaurants, restaurantTables, serviceRequests, staffMembers, userRoles, roles } from '../database/esquema';
import { SecretosService } from '../secretos/secretos.service';
import { EventosGateway, huellaQr, salas } from '../tiempo-real/eventos.gateway';
import { PushService } from '../tiempo-real/push.service';

/** Máximo de solicitudes por mesa y por minuto (anti-abuso del QR). */
export const MAX_POR_MINUTO = 6;
/** Minutos sin atender antes de avisar al encargado del área. Provisional: se vuelve ajuste por sucursal. */
export const ESCALA_MINUTOS = 3;
const VIDA_TOKEN_MESA = '4h';

export const NuevaSolicitud = z.object({ tipo: z.enum(['atencion', 'cuenta', 'servicio']), comentario: z.string().trim().max(300).optional() }).strict();
export const SesionMesa = z.object({ qrToken: z.string().regex(/^[a-f0-9]{36}$/, 'QR inválido') }).strict();

const ETIQUETA = { atencion: 'Llamado al mesero', cuenta: 'Pide la cuenta', servicio: 'Pide servicio', otro: 'Solicitud' } as const;

export interface MesaCtx { restaurantId: string; tableId: string }

@Injectable()
export class SolicitudesService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Solicitudes');
  private reloj?: NodeJS.Timeout;

  constructor(
    @Inject(BD) private readonly bd: Bd,
    @Inject(TenantDb) private readonly db: TenantDb,
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(SecretosService) private readonly secretos: SecretosService,
    @Inject(EventosGateway) private readonly eventos: EventosGateway,
    @Inject(PushService) private readonly push: PushService,
  ) {}

  /** El escalamiento corre en la API (una sola instancia por ahora); en las pruebas se invoca a mano. */
  onModuleInit() {
    if (process.env.VITEST === undefined) this.reloj = setInterval(() => { this.escalar().catch((e) => this.log.warn(String(e?.message ?? e))); }, 20_000);
  }
  onModuleDestroy() { if (this.reloj) clearInterval(this.reloj); }

  /** Cambia el QR escaneado por un token de mesa (4 h) que solo vale para ESA mesa. */
  async abrirSesion(qrToken: string) {
    const [m] = await this.bd.select({ id: restaurantTables.id, rid: restaurantTables.restaurantId, numero: restaurantTables.number, activa: restaurantTables.active, qr: restaurantTables.qrToken }).from(restaurantTables).where(eq(restaurantTables.qrToken, qrToken));
    if (!m || !m.activa) throw new NotFoundException('Este QR no está disponible.');
    const [r] = await this.bd.select({ nombre: restaurants.name, slug: restaurants.slug, estado: restaurants.status }).from(restaurants).where(eq(restaurants.id, m.rid));
    if (!r || r.estado !== 'activo') throw new NotFoundException('Este QR no está disponible.');
    const token = await this.jwt.signAsync({ rid: m.rid, tid: m.id, qk: huellaQr(m.qr) }, { secret: this.secretos.firma('mesa'), algorithm: 'HS256', audience: 'table', expiresIn: VIDA_TOKEN_MESA });
    return { token, mesa: { numero: m.numero }, restaurante: { nombre: r.nombre, slug: r.slug } };
  }

  /** Quién atiende esta mesa ahora: el mesero vigente o, si no hay, el encargado del área. */
  private async destino(tx: Bd, rid: string, tableId: string): Promise<{ staffId: string | null; userId: string | null; esEncargado: boolean }> {
    const a = await tx.execute(sql`SELECT s.id AS staff_id, s.user_id FROM table_assignments ta JOIN staff_members s ON s.id = ta.waiter_id WHERE ta.table_id = ${tableId} AND ta.valid_during @> now() AND s.active LIMIT 1`);
    const mesero = (a.rows as { staff_id: string; user_id: string | null }[])[0];
    if (mesero) return { staffId: mesero.staff_id, userId: mesero.user_id, esEncargado: false };
    const e = await tx.execute(sql`SELECT s.id AS staff_id, s.user_id FROM restaurant_tables t JOIN areas a ON a.id = t.area_id JOIN staff_members s ON s.id = a.manager_staff_id WHERE t.id = ${tableId} AND t.restaurant_id = ${rid} AND s.active LIMIT 1`);
    const enc = (e.rows as { staff_id: string; user_id: string | null }[])[0];
    return enc ? { staffId: enc.staff_id, userId: enc.user_id, esEncargado: true } : { staffId: null, userId: null, esEncargado: true };
  }

  async crear(ctx: MesaCtx, d: z.infer<typeof NuevaSolicitud>) {
    const t: Tenant = { restaurantId: ctx.restaurantId, restaurantIds: [] };
    const r = await this.db.run(t, async (tx) => {
      if (((await tx.execute(sql`SELECT is_demo FROM restaurants WHERE id = ${ctx.restaurantId}`)).rows[0] as { is_demo: boolean } | undefined)?.is_demo) throw new HttpException({ code: 'DEMO', message: 'Esta sucursal es de muestra y no recibe pedidos, llamados ni reservas reales.' }, 403);
      const recientes = await tx.select({ n: sql<number>`count(*)::int` }).from(serviceRequests).where(and(eq(serviceRequests.tableId, ctx.tableId), gt(serviceRequests.createdAt, sql`now() - interval '1 minute'`)));
      if ((recientes[0]?.n ?? 0) >= MAX_POR_MINUTO) throw new HttpException({ code: 'TOO_MANY', message: 'Demasiadas solicitudes seguidas. Espera un momento.' }, 429);
      const dst = await this.destino(tx, ctx.restaurantId, ctx.tableId);
      try {
        const [s] = await tx.insert(serviceRequests).values({ restaurantId: ctx.restaurantId, tableId: ctx.tableId, kind: d.tipo, comment: d.comentario || null, assignedWaiterId: dst.staffId }).returning();
        const [mesa] = await tx.select({ numero: restaurantTables.number }).from(restaurantTables).where(eq(restaurantTables.id, ctx.tableId));
        return { s, mesa: mesa?.numero ?? '?', dst };
      } catch (e) {
        if (esDuplicado(e)) throw new ConflictException('Ya avisaste al mesero. En un momento te atienden.');
        throw e;
      }
    });
    const vista = this.vista(r.s, r.mesa);
    this.eventos.emitir(salas.sucursal(ctx.restaurantId), 'solicitud.nueva', { ...vista, paraMi: false });
    if (r.dst.userId) this.eventos.emitir(salas.persona(r.dst.userId), 'solicitud.nueva', { ...vista, paraMi: true });
    this.eventos.emitir(salas.mesa(ctx.tableId), 'solicitud.estado', { id: r.s.id, tipo: d.tipo, estado: 'pendiente' });
    // El aviso con la pantalla bloqueada es un extra: no demora ni rompe la respuesta al cliente.
    if (r.dst.userId) void this.push.avisar([r.dst.userId], { titulo: `Mesa ${r.mesa}`, cuerpo: `${ETIQUETA[d.tipo]}${d.comentario ? `: ${d.comentario}` : ''}`, url: '/app/salon', etiqueta: `mesa-${ctx.tableId}-${d.tipo}`, urgente: true });
    return { id: r.s.id, estado: 'pendiente' as const };
  }

  private vista(s: typeof serviceRequests.$inferSelect, mesa: string) {
    return { id: s.id, mesaId: s.tableId, mesa, tipo: s.kind, comentario: s.comment, estado: s.status, meseroId: s.assignedWaiterId, creada: s.createdAt.toISOString(), atendida: s.attendedAt?.toISOString() ?? null, escalada: !!s.escalatedAt };
  }

  /** Estado que ve el cliente de la mesa: sus solicitudes recientes. */
  estadoDeMesa(ctx: MesaCtx) {
    return this.db.run({ restaurantId: ctx.restaurantId, restaurantIds: [] }, async (tx) => {
      const filas = await tx.select().from(serviceRequests).where(and(eq(serviceRequests.tableId, ctx.tableId), gt(serviceRequests.createdAt, sql`now() - interval '30 minutes'`))).orderBy(desc(serviceRequests.createdAt)).limit(10);
      return filas.map((s) => ({ id: s.id, tipo: s.kind, estado: s.status, creada: s.createdAt.toISOString() }));
    });
  }

  /** Lista del personal: pendientes (o de hoy). El mesero ve las suyas primero en pantalla; la regla de qué ve cada rol vive en el cliente. */
  listar(t: Tenant, estado: 'pendiente' | 'atendida' | 'todas') {
    return this.db.run(t, async (tx) => {
      const cond = [eq(serviceRequests.restaurantId, t.restaurantId), ...(estado === 'todas' ? [gt(serviceRequests.createdAt, sql`now() - interval '12 hours'`)] : [eq(serviceRequests.status, estado), gt(serviceRequests.createdAt, sql`now() - interval '12 hours'`)])];
      const f = await tx.select({ s: serviceRequests, mesa: restaurantTables.number }).from(serviceRequests).innerJoin(restaurantTables, eq(restaurantTables.id, serviceRequests.tableId)).where(and(...cond)).orderBy(desc(serviceRequests.createdAt)).limit(200);
      return f.map((x) => this.vista(x.s, x.mesa));
    });
  }

  atender(t: Tenant, userId: string, id: string) {
    return this.db.run(t, async (tx) => {
      const [s] = await tx.update(serviceRequests).set({ status: 'atendida', attendedAt: sql`now()` as unknown as Date })
        .where(and(eq(serviceRequests.id, id), eq(serviceRequests.restaurantId, t.restaurantId), eq(serviceRequests.status, 'pendiente'))).returning();
      if (!s) throw new NotFoundException('La solicitud ya no está pendiente.');
      const [mesa] = await tx.select({ numero: restaurantTables.number }).from(restaurantTables).where(eq(restaurantTables.id, s.tableId));
      await auditar(tx, t.restaurantId, userId, 'solicitud.atendida', 'service_request', id);
      const segundos = Math.round(((s.attendedAt?.getTime() ?? Date.now()) - s.createdAt.getTime()) / 1000);
      this.eventos.emitir(salas.sucursal(t.restaurantId), 'solicitud.atendida', { ...this.vista(s, mesa?.numero ?? '?') });
      this.eventos.emitir(salas.mesa(s.tableId), 'solicitud.estado', { id: s.id, tipo: s.kind, estado: 'atendida' });
      return { ok: true, tiempoDeRespuestaSegundos: segundos };
    });
  }

  /** Solicitudes sin atender pasado el tiempo: avisa una sola vez al encargado del área (o a dueño y administradores). */
  async escalar(): Promise<number> {
    const vencidas = await this.bd.select().from(serviceRequests).where(and(eq(serviceRequests.status, 'pendiente'), isNull(serviceRequests.escalatedAt), lt(serviceRequests.createdAt, sql`now() - make_interval(mins => ${ESCALA_MINUTOS})`)));
    let n = 0;
    for (const s of vencidas) {
      const marcada = await this.bd.update(serviceRequests).set({ escalatedAt: sql`now()` as unknown as Date }).where(and(eq(serviceRequests.id, s.id), isNull(serviceRequests.escalatedAt))).returning({ id: serviceRequests.id });
      if (!marcada.length) continue;
      const [mesa] = await this.bd.select({ numero: restaurantTables.number, area: restaurantTables.areaId }).from(restaurantTables).where(eq(restaurantTables.id, s.tableId));
      const dst = await this.encargados(s.restaurantId, mesa?.area ?? null);
      const evento = { ...this.vista({ ...s, escalatedAt: new Date() }, mesa?.numero ?? '?') };
      this.eventos.emitir(salas.sucursal(s.restaurantId), 'solicitud.escalada', evento);
      for (const u of dst) this.eventos.emitir(salas.persona(u), 'solicitud.escalada', evento);
      void this.push.avisar(dst, { titulo: `Mesa ${mesa?.numero ?? '?'} sin atender`, cuerpo: `Pasaron ${ESCALA_MINUTOS} minutos: ${ETIQUETA[s.kind as keyof typeof ETIQUETA] ?? 'Solicitud'}`, url: '/app/salon', etiqueta: `escala-${s.id}`, urgente: true });
      n++;
    }
    return n;
  }

  private async encargados(rid: string, areaId: string | null): Promise<string[]> {
    if (areaId) {
      const r = await this.bd.select({ u: staffMembers.userId }).from(areas).innerJoin(staffMembers, eq(staffMembers.id, areas.managerStaffId)).where(and(eq(areas.id, areaId), eq(staffMembers.active, true)));
      const u = r.map((x) => x.u).filter((x): x is string => !!x);
      if (u.length) return u;
    }
    const r = await this.bd.select({ u: userRoles.userId }).from(userRoles).innerJoin(roles, eq(roles.id, userRoles.roleId)).where(and(eq(userRoles.restaurantId, rid), inArray(roles.code, ['owner', 'admin'])));
    return r.map((x) => x.u);
  }
}
