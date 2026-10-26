import { Body, Controller, Get, Inject, NotFoundException, Patch } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { Actor, ActorActual, TenantActual } from '../comun/acceso';
import { DeSucursal } from '../comun/guards';
import { Tenant, TenantDb } from '../database/database.module';
import { auditLog, restaurants } from '../database/esquema';

const Cambios = z.object({ name: z.string().trim().min(2).max(120) }).strict();

/** Sucursal activa (X-Restaurant-Id). Primer endpoint de negocio: ejercita guards, RLS y auditoría. */
@Controller('sucursal')
export class SucursalController {
  constructor(@Inject(TenantDb) private readonly db: TenantDb) {}

  @Get() @DeSucursal()
  async actual(@TenantActual() t: Tenant) {
    const [r] = await this.db.run(t, (tx) => tx.select().from(restaurants).where(eq(restaurants.id, t.restaurantId)));
    if (!r) throw new NotFoundException('Sucursal no encontrada');
    return { id: r.id, nombre: r.name, slug: r.slug, modoDeCobro: r.billingMode, pagadoHasta: r.paidUntil, estado: r.status, demo: r.isDemo };
  }

  @Patch() @DeSucursal('owner', 'admin')
  async cambiar(@TenantActual() t: Tenant, @ActorActual() actor: Actor, @Body() body: unknown) {
    const d = Cambios.parse(body);
    await this.db.run(t, async (tx) => {
      await tx.update(restaurants).set({ name: d.name }).where(eq(restaurants.id, t.restaurantId));
      await tx.insert(auditLog).values({ restaurantId: t.restaurantId, userId: actor.sub, action: 'sucursal.renombrada', entity: 'restaurant', entityId: t.restaurantId, after: d });
    });
    return { ok: true };
  }
}
