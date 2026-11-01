import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { auditar, esDuplicado } from '../comun/auditoria';
import { entorno } from '../config/entorno';
import { Bd, Tenant, TenantDb } from '../database/database.module';
import { areas, restaurantTables, staffMembers } from '../database/esquema';

export const Area = z.object({ nombre: z.string().trim().min(1).max(80), encargadoId: z.string().uuid().nullable().optional() }).strict();
export const Mesa = z.object({
  numero: z.string().trim().min(1).max(20), asientos: z.number().int().min(1).max(50), areaId: z.string().uuid().nullable().optional(),
  posX: z.number().int().min(0).max(5000).nullable().optional(), posY: z.number().int().min(0).max(5000).nullable().optional(), activa: z.boolean().optional(),
}).strict();
export const MesaParcial = Mesa.partial();
export const AsignacionGrupo = z.object({ meseroId: z.string().uuid(), areaId: z.string().uuid().nullable().optional() }).strict();   // sin areaId = todo el restaurante
export const Asignacion = z.object({ mesaId: z.string().uuid(), meseroId: z.string().uuid() }).strict();

@Injectable()
export class SalonService {
  constructor(@Inject(TenantDb) private readonly db: TenantDb) {}

  areas(t: Tenant) {
    return this.db.run(t, (tx) => tx.select().from(areas).where(eq(areas.restaurantId, t.restaurantId)).orderBy(asc(areas.name)).then((r) => r.map((a) => ({ id: a.id, nombre: a.name, encargadoId: a.managerStaffId }))));
  }

  private async personaValida(tx: Bd, t: Tenant, id: string | null | undefined) {
    if (!id) return;
    const [s] = await tx.select({ id: staffMembers.id }).from(staffMembers).where(and(eq(staffMembers.id, id), eq(staffMembers.restaurantId, t.restaurantId), eq(staffMembers.active, true)));
    if (!s) throw new BadRequestException('La persona no existe o está inactiva en esta sucursal.');
  }

  crearArea(t: Tenant, por: string, d: z.infer<typeof Area>) {
    return this.db.run(t, async (tx) => {
      await this.personaValida(tx, t, d.encargadoId);
      try {
        const [a] = await tx.insert(areas).values({ restaurantId: t.restaurantId, name: d.nombre, managerStaffId: d.encargadoId ?? null }).returning();
        await auditar(tx, t.restaurantId, por, 'salon.area_creada', 'area', a.id, d);
        return { id: a.id, nombre: a.name, encargadoId: a.managerStaffId };
      } catch (e) { if (esDuplicado(e)) throw new ConflictException('Ya existe un área con ese nombre.'); throw e; }
    });
  }

  cambiarArea(t: Tenant, por: string, id: string, d: z.infer<typeof Area>) {
    return this.db.run(t, async (tx) => {
      await this.personaValida(tx, t, d.encargadoId);
      const r = await tx.update(areas).set({ name: d.nombre, ...(d.encargadoId !== undefined && { managerStaffId: d.encargadoId }) }).where(and(eq(areas.id, id), eq(areas.restaurantId, t.restaurantId))).returning({ id: areas.id });
      if (!r.length) throw new NotFoundException('Área no encontrada.');
      await auditar(tx, t.restaurantId, por, 'salon.area_cambiada', 'area', id, d);
      return { ok: true };
    });
  }

  /** Las mesas llevan el QR solo para quien lo imprime (dueño y administrador); el resto ve la mesa sin él. */
  mesas(t: Tenant, conQr: boolean) {
    return this.db.run(t, async (tx) => {
      const filas = await tx.select().from(restaurantTables).where(eq(restaurantTables.restaurantId, t.restaurantId)).orderBy(asc(restaurantTables.number));
      const asig = await tx.execute(sql`SELECT table_id, waiter_id FROM table_assignments WHERE restaurant_id = ${t.restaurantId} AND valid_during @> now()`);
      const porMesa = new Map((asig.rows as { table_id: string; waiter_id: string }[]).map((r) => [r.table_id, r.waiter_id]));
      return filas.map((m) => ({
        id: m.id, numero: m.number, asientos: m.seats, areaId: m.areaId, posX: m.posX, posY: m.posY, activa: m.active, meseroId: porMesa.get(m.id) ?? null,
        ...(conQr && { urlQr: `${entorno.urlPublica}/m/${m.qrToken}` }),
      }));
    });
  }

  crearMesa(t: Tenant, por: string, d: z.infer<typeof Mesa>) {
    return this.db.run(t, async (tx) => {
      await this.areaValida(tx, t, d.areaId);
      try {
        const [m] = await tx.insert(restaurantTables).values({ restaurantId: t.restaurantId, number: d.numero, seats: d.asientos, areaId: d.areaId ?? null, posX: d.posX ?? null, posY: d.posY ?? null, qrToken: sql`encode(gen_random_bytes(18),'hex')` as unknown as string }).returning({ id: restaurantTables.id });
        await auditar(tx, t.restaurantId, por, 'salon.mesa_creada', 'table', m.id, d);
        return { id: m.id };
      } catch (e) { if (esDuplicado(e)) throw new ConflictException('Ya existe una mesa con ese número.'); throw e; }
    });
  }

  private async areaValida(tx: Bd, t: Tenant, id: string | null | undefined) {
    if (!id) return;
    const [a] = await tx.select({ id: areas.id }).from(areas).where(and(eq(areas.id, id), eq(areas.restaurantId, t.restaurantId)));
    if (!a) throw new BadRequestException('El área no existe en esta sucursal.');
  }

  cambiarMesa(t: Tenant, por: string, id: string, d: z.infer<typeof MesaParcial>) {
    return this.db.run(t, async (tx) => {
      await this.areaValida(tx, t, d.areaId);
      const cambios = {
        ...(d.numero !== undefined && { number: d.numero }), ...(d.asientos !== undefined && { seats: d.asientos }), ...(d.areaId !== undefined && { areaId: d.areaId }),
        ...(d.posX !== undefined && { posX: d.posX }), ...(d.posY !== undefined && { posY: d.posY }), ...(d.activa !== undefined && { active: d.activa }),
      };
      if (!Object.keys(cambios).length) throw new BadRequestException('Nada que cambiar.');
      try {
        const r = await tx.update(restaurantTables).set(cambios).where(and(eq(restaurantTables.id, id), eq(restaurantTables.restaurantId, t.restaurantId))).returning({ id: restaurantTables.id });
        if (!r.length) throw new NotFoundException('Mesa no encontrada.');
      } catch (e) { if (esDuplicado(e)) throw new ConflictException('Ya existe una mesa con ese número.'); throw e; }
      await auditar(tx, t.restaurantId, por, 'salon.mesa_cambiada', 'table', id, d);
      return { ok: true };
    });
  }

  /** Regenerar el QR invalida el anterior y las sesiones de mesa que ya se abrieron con él. */
  regenerarQr(t: Tenant, por: string, id: string) {
    return this.db.run(t, async (tx) => {
      const r = await tx.update(restaurantTables).set({ qrToken: sql`encode(gen_random_bytes(18),'hex')` as unknown as string }).where(and(eq(restaurantTables.id, id), eq(restaurantTables.restaurantId, t.restaurantId))).returning({ q: restaurantTables.qrToken });
      if (!r.length) throw new NotFoundException('Mesa no encontrada.');
      await auditar(tx, t.restaurantId, por, 'salon.qr_regenerado', 'table', id);
      return { urlQr: `${entorno.urlPublica}/m/${r[0].q}` };
    });
  }

  asignaciones(t: Tenant) {
    return this.db.run(t, async (tx) => {
      const r = await tx.execute(sql`SELECT table_id, waiter_id, lower(valid_during) AS desde FROM table_assignments WHERE restaurant_id = ${t.restaurantId} AND valid_during @> now()`);
      return (r.rows as { table_id: string; waiter_id: string; desde: string }[]).map((x) => ({ mesaId: x.table_id, meseroId: x.waiter_id, desde: x.desde }));
    });
  }

  private async asignarMesa(tx: Bd, t: Tenant, por: string, mesaId: string, meseroId: string) {
    await tx.execute(sql`UPDATE table_assignments SET valid_during = tstzrange(lower(valid_during), now()) WHERE table_id = ${mesaId} AND valid_during @> now() AND lower(valid_during) < now()`);
    await tx.execute(sql`DELETE FROM table_assignments WHERE table_id = ${mesaId} AND valid_during @> now() AND lower(valid_during) >= now()`);
    await tx.execute(sql`INSERT INTO table_assignments (restaurant_id, table_id, waiter_id, valid_during) VALUES (${t.restaurantId}, ${mesaId}, ${meseroId}, tstzrange(now(), NULL))`);
    await auditar(tx, t.restaurantId, por, 'salon.mesero_asignado', 'table', mesaId, { mesaId, meseroId });
  }

  /** Reasignar a mitad del turno cierra la asignación vigente y abre la nueva; las solicitudes abiertas no se pierden. */
  asignar(t: Tenant, por: string, d: z.infer<typeof Asignacion>) {
    return this.db.run(t, async (tx) => {
      await this.personaValida(tx, t, d.meseroId);
      const [m] = await tx.select({ id: restaurantTables.id }).from(restaurantTables).where(and(eq(restaurantTables.id, d.mesaId), eq(restaurantTables.restaurantId, t.restaurantId)));
      if (!m) throw new NotFoundException('Mesa no encontrada.');
      await this.asignarMesa(tx, t, por, d.mesaId, d.meseroId);
      return { ok: true };
    });
  }

  /** Un mesero para toda un área (o para todo el restaurante si no se indica área): se asigna a cada mesa activa. */
  asignarGrupo(t: Tenant, por: string, d: z.infer<typeof AsignacionGrupo>) {
    return this.db.run(t, async (tx) => {
      await this.personaValida(tx, t, d.meseroId);
      const filtro = d.areaId ? sql`AND area_id = ${d.areaId}` : sql``;
      const mesas = (await tx.execute(sql`SELECT id FROM restaurant_tables WHERE restaurant_id = ${t.restaurantId} AND active ${filtro}`)).rows as { id: string }[];
      if (d.areaId && !mesas.length && !(await tx.execute(sql`SELECT 1 FROM areas WHERE id = ${d.areaId} AND restaurant_id = ${t.restaurantId}`)).rows.length) throw new NotFoundException('Área no encontrada.');
      for (const m of mesas) await this.asignarMesa(tx, t, por, m.id, d.meseroId);
      await auditar(tx, t.restaurantId, por, 'salon.mesero_asignado_grupo', 'area', d.areaId ?? t.restaurantId, { ...d, mesas: mesas.length });
      return { ok: true, mesas: mesas.length };
    });
  }
}
