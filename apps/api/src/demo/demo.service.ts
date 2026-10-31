import { BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { BD, Bd, POOL } from '../database/database.module';
import { KyrosIdService } from '../kyros-id/kyros-id.service';
import { CUENTAS_DEMO, ESPERA_REINICIO_MIN } from './constantes';
import { cargarDatosDemo } from './datos-demo';
import { vaciarSucursal } from './limpiar';

export const FRASE_RESTABLECER = 'RESTABLECER DEMO';
export const RestablecerDemo = z.object({ frase: z.literal(FRASE_RESTABLECER) }).strict();
export const CargarDemo = z.object({ dias: z.number().int().min(7).max(90).default(60) }).strict();
/** Al reiniciar se conserva la estructura (sucursal, personas, roles y vínculos), el registro de auditoría y el uso de IA (para no saltarse el tope diario). */
const CONSERVAR = ['user_roles', 'staff_members', 'audit_log', 'ai_jobs', 'subscription_payments'];

/**
 * Sucursal de demostración para las cuentas Prueba_Kyros: una sola, de solo lectura, con datos de muestra realistas (sin la palabra «demo»
 * en lo que se ve). Las cuentas entran por sus `sub` fijos de Kyros ID, pre-vinculadas aquí. «Restablecer» borra y recarga SOLO esta sucursal.
 */
@Injectable()
export class DemoService {
  constructor(@Inject(BD) private readonly bd: Bd, @Inject(POOL) private readonly pool: Pool, @Inject(KyrosIdService) private readonly kyros: KyrosIdService) {}

  private async conTransaccion<T>(f: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try { await c.query('BEGIN'); const r = await f(c); await c.query('COMMIT'); return r; }
    catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  }

  /** Crea las cuentas de la lista que falten (usuario, rol, personal y vínculo por `sub` fijo); las que ya existen no se tocan. */
  private async asegurarCuentas(c: PoolClient, rid: string, cuentaId: string, emisor: string) {
    for (const cu of CUENTAS_DEMO) {
      if ((await c.query(`SELECT 1 FROM kyros_links WHERE issuer = $1 AND sub = $2`, [emisor, cu.sub])).rows.length) continue;
      const previo = (await c.query(`SELECT id FROM users WHERE email = $1 AND account_id = $2`, [cu.correo, cuentaId])).rows[0] as { id: string } | undefined;
      if (previo) { await c.query(`INSERT INTO kyros_links (issuer, sub, user_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [emisor, cu.sub, previo.id]); continue; }   // usuario sin vínculo: se reconecta
      if ((await c.query(`SELECT 1 FROM users WHERE email = $1`, [cu.correo])).rows.length) continue;
      const u =(await c.query(`INSERT INTO users (account_id, email, full_name) VALUES ($1, $2, $3) RETURNING id`, [cuentaId, cu.correo, cu.nombre])).rows[0].id as string;
      await c.query(`INSERT INTO user_roles (restaurant_id, user_id, role_id) SELECT $1, $2, id FROM roles WHERE code = $3`, [rid, u, cu.rol]);
      await c.query(`INSERT INTO staff_members (restaurant_id, user_id, full_name) VALUES ($1, $2, $3)`, [rid, u, cu.nombre]);
      await c.query(`INSERT INTO kyros_links (issuer, sub, user_id) VALUES ($1, $2, $3)`, [emisor, cu.sub, u]);
    }
  }

  /** La sucursal de muestra tiene un plan y un pago validado (la pantalla de suscripción no queda vacía). Se conserva al restablecer. */
  private async asegurarSuscripcion(c: PoolClient, rid: string) {
    let plan = (await c.query(`SELECT id, monthly_price_bob::float8 AS precio FROM plans WHERE active ORDER BY monthly_price_bob DESC LIMIT 1`)).rows[0] as { id: string; precio: number } | undefined;
    plan ??= (await c.query(`INSERT INTO plans (code, name, monthly_price_bob, features) VALUES ('demo-profesional', 'Profesional', 299, '{}') RETURNING id, monthly_price_bob::float8 AS precio`)).rows[0];
    await c.query(`UPDATE restaurants SET plan_id = $2 WHERE id = $1 AND plan_id IS NULL`, [rid, plan!.id]);
    if ((await c.query(`SELECT 1 FROM subscription_payments WHERE restaurant_id = $1`, [rid])).rows.length) return;
    const monto = Math.round(plan!.precio * 12 * 100) / 100;
    await c.query(`INSERT INTO subscription_payments (restaurant_id, months_paid, amount_bob, expected_amount, voucher_url, bank, bank_reference, status, validated_at, paid_on, period_from, period_to, notes)
      VALUES ($1, 12, $2, $2, 'demo/sin-comprobante', 'Banco Unión', 'PAGO-0001', 'validado', now() - interval '20 days', (now() - interval '20 days')::date, (now() - interval '20 days')::date, (now() + interval '345 days')::date, 'Pago anual')`, [rid, monto]);
  }

  async estado() {
    const r = (await this.bd.execute(sql`SELECT id, name, slug, demo_reset_at FROM restaurants WHERE is_demo`)).rows[0] as { id: string; name: string; slug: string; demo_reset_at: Date | null } | undefined;
    if (!r) return { cargada: false as const, cuentas: CUENTAS_DEMO.map((c) => ({ usuario: c.usuario, rol: c.rol, vinculada: false })) };
    const vinc = (await this.bd.execute(sql`SELECT l.sub FROM kyros_links l JOIN user_roles ur ON ur.user_id = l.user_id WHERE ur.restaurant_id = ${r.id}`)).rows as { sub: string }[];
    return { cargada: true as const, sucursal: { id: r.id, nombre: r.name, slug: r.slug }, ultimoReinicio: r.demo_reset_at ? new Date(r.demo_reset_at).toISOString() : null,
      cuentas: CUENTAS_DEMO.map((c) => ({ usuario: c.usuario, rol: c.rol, vinculada: vinc.some((v) => v.sub === c.sub) })) };
  }

  /** Crea la sucursal, las cuentas pre-vinculadas y los datos de muestra. Solo equipo de plataforma. */
  async cargar(por: string, d: z.infer<typeof CargarDemo>) {
    const { emisor } = await this.kyros.ajustes();
    if (!emisor) throw new BadRequestException('Primero activa Kyros ID: las cuentas de demostración se vinculan a su emisor.');
    return this.conTransaccion(async (c) => {
      if ((await c.query(`SELECT 1 FROM restaurants WHERE is_demo`)).rows.length) throw new ConflictException('Ya hay una demostración cargada.');
      for (const cu of CUENTAS_DEMO) {
        if ((await c.query(`SELECT 1 FROM users WHERE email = $1`, [cu.correo])).rows.length || (await c.query(`SELECT 1 FROM kyros_links WHERE issuer = $1 AND sub = $2`, [emisor, cu.sub])).rows.length) throw new ConflictException(`La cuenta ${cu.usuario} ya existe en GESTRO.`);
      }
      const cuenta = (await c.query(`INSERT INTO accounts (legal_name, owner_email) VALUES ('Casa Andina SRL', $1) RETURNING id`, [CUENTAS_DEMO[0].correo])).rows[0].id as string;
      const hasta = (await c.query(`SELECT ((now() AT TIME ZONE 'America/La_Paz')::date + 3650)::text AS d`)).rows[0].d as string;
      const rest = (await c.query(`INSERT INTO restaurants (account_id, name, slug, billing_mode, paid_until, is_demo, demo_days) VALUES ($1, 'Casa Andina', $2, 'recibo', $3, true, $4) RETURNING id, timezone, slug`,
        [cuenta, `casa-andina-${randomBytes(3).toString('hex')}`, hasta, d.dias])).rows[0] as { id: string; timezone: string; slug: string };
      await this.asegurarCuentas(c, rest.id, cuenta, emisor);
      await this.asegurarSuscripcion(c, rest.id);
      const r = await cargarDatosDemo(c, rest.id, rest.timezone, d.dias);
      await c.query(`INSERT INTO audit_log (restaurant_id, user_id, action, entity, entity_id, after) VALUES ($1::uuid, $2::uuid, 'demo.cargada', 'restaurant', $1::text, $3::jsonb)`, [rest.id, por, JSON.stringify(r)]);
      return { ok: true, sucursal: { id: rest.id, slug: rest.slug }, ...r };
    });
  }

  /** Quita la demostración completa (sucursal, cuentas, vínculos y datos): las cuentas Prueba_Kyros vuelven a dar 401. */
  async quitar(por: string) {
    return this.conTransaccion(async (c) => {
      const r = (await c.query(`SELECT id, account_id FROM restaurants WHERE is_demo FOR UPDATE`)).rows[0] as { id: string; account_id: string } | undefined;
      if (!r) throw new NotFoundException('No hay demostración cargada.');
      const usuarios = (await c.query(`SELECT user_id FROM user_roles WHERE restaurant_id = $1`, [r.id])).rows.map((x) => x.user_id as string);
      await vaciarSucursal(c, r.id, []);
      await c.query(`DELETE FROM kyros_links WHERE user_id = ANY($1::uuid[])`, [usuarios]);
      for (const t of ['refresh_tokens', 'user_invitations']) await c.query(`DELETE FROM ${t} WHERE user_id = ANY($1::uuid[])`, [usuarios]);
      await c.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [usuarios]);
      await c.query(`DELETE FROM restaurants WHERE id = $1`, [r.id]);
      await c.query(`DELETE FROM accounts WHERE id = $1`, [r.account_id]);
      await c.query(`INSERT INTO audit_log (user_id, action, entity, entity_id) VALUES ($1::uuid, 'demo.quitada', 'restaurant', $2)`, [por, r.id]);
      return { ok: true };
    });
  }

  /**
   * «Restablecer mis datos de muestra»: borra y recarga SOLO la sucursal de demostración, como mucho una vez cada 5 minutos, y deja auditoría.
   * La sucursal se verifica en la base (no por lo que diga la petición).
   */
  /** Vacía la sucursal de muestra y la deja como al crearla: cuentas que falten, suscripción y todos los datos. Quien llama ya verificó que es la de demostración. */
  private async recargar(c: PoolClient, rid: string, emisor: string, tz: string, dias: number) {
    await vaciarSucursal(c, rid, CONSERVAR);
    await c.query(`SET LOCAL session_replication_role = 'origin'`);
    const cuentaId = (await c.query(`SELECT account_id FROM restaurants WHERE id = $1`, [rid])).rows[0].account_id as string;
    await this.asegurarCuentas(c, rid, cuentaId, emisor);      // cuentas nuevas de la lista que aún no existan en una demostración ya cargada
    await this.asegurarSuscripcion(c, rid);
    return cargarDatosDemo(c, rid, tz, dias);
  }

  /**
   * «Restablecer cuentas demo» del equipo de plataforma: devuelve la sucursal de muestra a su estado de creación, sin límite de frecuencia
   * (el que quiere es quien administra la plataforma) y con auditoría. Solo toca la sucursal marcada `is_demo`.
   */
  async restablecerPorPlataforma(por: string) {
    const { emisor } = await this.kyros.ajustes();
    if (!emisor) throw new BadRequestException('Primero activa Kyros ID.');
    return this.conTransaccion(async (c) => {
      const r = (await c.query(`SELECT id, timezone, demo_days FROM restaurants WHERE is_demo FOR UPDATE`)).rows[0] as { id: string; timezone: string; demo_days: number } | undefined;
      if (!r) throw new NotFoundException('No hay demostración cargada.');
      await c.query(`UPDATE restaurants SET demo_reset_at = now() WHERE id = $1`, [r.id]);
      const res = await this.recargar(c, r.id, emisor, r.timezone, r.demo_days);
      await c.query(`INSERT INTO audit_log (restaurant_id, user_id, action, entity, entity_id, after) VALUES ($1::uuid, $2::uuid, 'demo.restablecida_por_plataforma', 'restaurant', $1::text, $3::jsonb)`, [r.id, por, JSON.stringify(res)]);
      return { ok: true, ...res };
    });
  }

  async restablecer(restaurantId: string, userId: string) {
    const { emisor } = await this.kyros.ajustes();
    return this.conTransaccion(async (c) => {
      const r = (await c.query(`UPDATE restaurants SET demo_reset_at = now() WHERE id = $1 AND is_demo AND (demo_reset_at IS NULL OR demo_reset_at < now() - ($2 || ' minutes')::interval) RETURNING timezone, demo_days`, [restaurantId, String(ESPERA_REINICIO_MIN)])).rows[0] as { timezone: string; demo_days: number } | undefined;
      if (!r) {
        const es = (await c.query(`SELECT is_demo FROM restaurants WHERE id = $1`, [restaurantId])).rows[0] as { is_demo: boolean } | undefined;
        if (!es?.is_demo) throw new ForbiddenException('Esta sucursal no es de demostración.');
        throw new HttpException(`Ya restableciste tus datos hace poco. Intenta de nuevo en unos minutos (máximo una vez cada ${ESPERA_REINICIO_MIN} minutos).`, HttpStatus.TOO_MANY_REQUESTS);
      }
      const res = await this.recargar(c, restaurantId, emisor, r.timezone, r.demo_days);
      await c.query(`INSERT INTO audit_log (restaurant_id, user_id, action, entity, entity_id, after) VALUES ($1::uuid, $2::uuid, 'demo.restablecida', 'restaurant', $1::text, $3::jsonb)`, [restaurantId, userId, JSON.stringify(res)]);
      return { ok: true, ...res };
    });
  }
}
