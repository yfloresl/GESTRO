import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Rol } from '@gestro/contracts';
import { auditar, esDuplicado } from '../comun/auditoria';
import { Tenant, TenantDb } from '../database/database.module';
import { kyrosLinks, roles, staffMembers, userInvitations, userRoles, users } from '../database/esquema';
import { SecretosService } from '../secretos/secretos.service';

/** El rol «owner» se asigna solo al abrir el restaurante; no se reparte desde aquí. */
// La API solo importa TIPOS de @gestro/contracts (el paquete no viaja en la imagen). El Record obliga a listar todos los roles.
const TODOS_LOS_ROLES: Record<Rol, true> = { owner: true, admin: true, cobranzas: true, cajero: true, mesero: true, area_manager: true, cocina: true, almacen: true, contador: true };
const ASIGNABLES = (Object.keys(TODOS_LOS_ROLES) as Rol[]).filter((r) => r !== 'owner') as [Rol, ...Rol[]];
export const NuevoPersonal = z.object({
  nombre: z.string().trim().min(2).max(120),
  correo: z.string().trim().email().max(200),
  telefono: z.string().trim().max(30).optional(),
  roles: z.array(z.enum(ASIGNABLES)).min(1).max(4),
}).strict();
export const CambioPersonal = z.object({
  nombre: z.string().trim().min(2).max(120).optional(),
  telefono: z.string().trim().max(30).nullable().optional(),
  roles: z.array(z.enum(ASIGNABLES)).min(1).max(4).optional(),
  activo: z.boolean().optional(),
}).strict();

const VIGENCIA_CODIGO_DIAS = 7;

@Injectable()
export class PersonalService {
  constructor(@Inject(TenantDb) private readonly db: TenantDb, @Inject(SecretosService) private readonly secretos: SecretosService) {}

  listar(t: Tenant) {
    return this.db.run(t, async (tx) => {
      const filas = await tx.select({ id: staffMembers.id, userId: staffMembers.userId, nombre: staffMembers.fullName, telefono: staffMembers.phone, activo: staffMembers.active, correo: users.email })
        .from(staffMembers).leftJoin(users, eq(users.id, staffMembers.userId)).where(eq(staffMembers.restaurantId, t.restaurantId));
      const ids = filas.map((f) => f.userId).filter((x): x is string => !!x);
      const rs = ids.length ? await tx.select({ userId: userRoles.userId, rol: roles.code }).from(userRoles).innerJoin(roles, eq(roles.id, userRoles.roleId)).where(and(eq(userRoles.restaurantId, t.restaurantId), inArray(userRoles.userId, ids))) : [];
      const vinc = ids.length ? await tx.select({ userId: kyrosLinks.userId }).from(kyrosLinks).where(inArray(kyrosLinks.userId, ids)) : [];
      return filas.map((f) => ({
        id: f.id, nombre: f.nombre, correo: f.correo, telefono: f.telefono, activo: f.activo,
        roles: rs.filter((r) => r.userId === f.userId).map((r) => r.rol),
        vinculado: vinc.some((v) => v.userId === f.userId),
      }));
    });
  }

  private async codigo(tx: Parameters<Parameters<TenantDb['run']>[1]>[0], userId: string, por: string): Promise<{ codigo: string; venceEl: string }> {
    await tx.delete(userInvitations).where(and(eq(userInvitations.userId, userId), sql`${userInvitations.usedAt} IS NULL`));
    const codigo = `gst-${this.secretos.tokenAleatorio()}`;
    const vence = new Date(Date.now() + VIGENCIA_CODIGO_DIAS * 86_400_000);
    await tx.insert(userInvitations).values({ userId, tokenHash: this.secretos.huella(codigo), createdBy: por, expiresAt: vence });
    return { codigo, venceEl: vence.toISOString() };
  }

  /** Crea la persona con su rol y devuelve su código de invitación UNA sola vez (en base solo queda su huella). */
  crear(t: Tenant, por: string, d: z.infer<typeof NuevoPersonal>) {
    return this.db.run(t, async (tx) => {
      try {
        const [u] = await tx.insert(users).values({ email: d.correo, fullName: d.nombre, accountId: sql`(SELECT account_id FROM restaurants WHERE id = ${t.restaurantId})` as unknown as string }).returning({ id: users.id });
        const rs = await tx.select().from(roles).where(inArray(roles.code, d.roles));
        await tx.insert(userRoles).values(rs.map((r) => ({ restaurantId: t.restaurantId, userId: u.id, roleId: r.id })));
        const [s] = await tx.insert(staffMembers).values({ restaurantId: t.restaurantId, userId: u.id, fullName: d.nombre, phone: d.telefono ?? null }).returning({ id: staffMembers.id });
        await auditar(tx, t.restaurantId, por, 'personal.creado', 'staff', s.id, { roles: d.roles });
        return { id: s.id, ...(await this.codigo(tx, u.id, por)) };
      } catch (e) {
        if (esDuplicado(e)) throw new ConflictException('Ya existe un usuario con ese correo.');
        throw e;
      }
    });
  }

  nuevoCodigo(t: Tenant, por: string, staffId: string) {
    return this.db.run(t, async (tx) => {
      const [s] = await tx.select().from(staffMembers).where(and(eq(staffMembers.id, staffId), eq(staffMembers.restaurantId, t.restaurantId)));
      if (!s?.userId) throw new NotFoundException('Persona no encontrada.');
      const [v] = await tx.select().from(kyrosLinks).where(eq(kyrosLinks.userId, s.userId));
      if (v) throw new BadRequestException('Esta persona ya unió su cuenta de Kyros ID.');
      await auditar(tx, t.restaurantId, por, 'personal.codigo_nuevo', 'staff', s.id);
      return this.codigo(tx, s.userId, por);
    });
  }

  cambiar(t: Tenant, por: string, staffId: string, d: z.infer<typeof CambioPersonal>) {
    return this.db.run(t, async (tx) => {
      const [s] = await tx.select().from(staffMembers).where(and(eq(staffMembers.id, staffId), eq(staffMembers.restaurantId, t.restaurantId)));
      if (!s?.userId) throw new NotFoundException('Persona no encontrada.');
      const actuales = await tx.select({ rol: roles.code }).from(userRoles).innerJoin(roles, eq(roles.id, userRoles.roleId)).where(and(eq(userRoles.restaurantId, t.restaurantId), eq(userRoles.userId, s.userId)));
      if (actuales.some((r) => r.rol === 'owner')) throw new ForbiddenException('El dueño no se modifica desde aquí.');
      if (s.userId === por && d.activo === false) throw new ForbiddenException('No puedes desactivarte a ti mismo.');
      if (d.nombre || d.telefono !== undefined || d.activo !== undefined) {
        await tx.update(staffMembers).set({ ...(d.nombre && { fullName: d.nombre }), ...(d.telefono !== undefined && { phone: d.telefono }), ...(d.activo !== undefined && { active: d.activo }) }).where(eq(staffMembers.id, s.id));
        if (d.nombre) await tx.update(users).set({ fullName: d.nombre }).where(eq(users.id, s.userId));
        if (d.activo !== undefined) await tx.update(users).set({ active: d.activo }).where(eq(users.id, s.userId));
      }
      if (d.roles) {
        await tx.delete(userRoles).where(and(eq(userRoles.restaurantId, t.restaurantId), eq(userRoles.userId, s.userId)));
        const rs = await tx.select().from(roles).where(inArray(roles.code, d.roles));
        await tx.insert(userRoles).values(rs.map((r) => ({ restaurantId: t.restaurantId, userId: s.userId!, roleId: r.id })));
      }
      await auditar(tx, t.restaurantId, por, 'personal.cambiado', 'staff', s.id, d);
      return { ok: true };
    });
  }
}
