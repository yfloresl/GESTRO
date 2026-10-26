import { Global, Inject, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { entorno } from '../config/entorno';
import * as esquema from './esquema';

export const BD = Symbol('BD');
export type Bd = NodePgDatabase<typeof esquema>;
export const POOL = Symbol('POOL');

/** Contexto de sucursal de una petición (lo fija RestaurantScopeGuard). */
export interface Tenant { restaurantId: string; restaurantIds: string[]; plataforma?: boolean }

@Injectable()
class CierreDePool implements OnModuleDestroy {
  constructor(@Inject(POOL) private readonly pool: Pool) {}
  async onModuleDestroy() { await this.pool.end(); }
}

/**
 * Acceso a datos de negocio. `run` abre una transacción, baja al rol app_user (NOBYPASSRLS) y fija la
 * sucursal: desde ahí la base solo deja ver y escribir filas de esa sucursal, aunque falle una consulta.
 * `bd` directo (dueño de las tablas) es solo para autenticación y plataforma, que no tienen sucursal.
 */
@Injectable()
export class TenantDb {
  constructor(@Inject(BD) private readonly bd: Bd) {}

  run<T>(tenant: Tenant, fn: (tx: Bd) => Promise<T>): Promise<T> {
    return this.bd.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE app_user`);
      await tx.execute(sql`SELECT set_config('app.restaurant_id', ${tenant.restaurantId}, true),
        set_config('app.restaurant_ids', ${tenant.restaurantIds.join(',')}, true),
        set_config('app.is_platform', ${tenant.plataforma ? 'on' : 'off'}, true)`);
      return fn(tx as unknown as Bd);
    });
  }
}

@Global()
@Module({
  providers: [
    { provide: POOL, useFactory: () => new Pool({ connectionString: entorno.baseDeDatos, max: 10 }) },
    { provide: BD, inject: [POOL], useFactory: (pool: Pool): Bd => drizzle(pool, { schema: esquema }) },
    TenantDb, CierreDePool,
  ],
  exports: [BD, TenantDb, POOL],
})
export class DatabaseModule {}
