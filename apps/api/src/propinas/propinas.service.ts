import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { auditar } from '../comun/auditoria';
import { Bd, Tenant, TenantDb } from '../database/database.module';
import { FilaPropina, pendienteDePropina, totalesDePropinas } from './propinas';

const MAX_DIAS = 62;
export const Entrega = z.object({ meseroId: z.string().uuid(), dia: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict();

/** Propinas por mesero y por día (según quién atendió la mesa) y su marca de «entregada». Reutiliza la propina que ya guarda cada cobro. */
@Injectable()
export class PropinasService {
  constructor(@Inject(TenantDb) private readonly db: TenantDb) {}

  private async dias(tx: Bd, t: Tenant, mesero: string | null, desde: string, hasta: string) {
    const tz = ((await tx.execute(sql`SELECT timezone FROM restaurants WHERE id = ${t.restaurantId}`)).rows[0] as { timezone: string }).timezone;
    const r = await tx.execute(sql`SELECT o.waiter_id AS mesero_id, COALESCE(s.full_name, 'Sin mesero asignado') AS mesero, ((p.paid_at AT TIME ZONE ${tz})::date)::text AS dia, SUM(p.tip_amount)::numeric(14,2)::text AS propina
      FROM sales_payments p JOIN orders o ON o.id = p.order_id LEFT JOIN staff_members s ON s.id = o.waiter_id
      WHERE p.restaurant_id = ${t.restaurantId} AND p.voided_at IS NULL AND p.tip_amount > 0 AND (p.paid_at AT TIME ZONE ${tz})::date BETWEEN ${desde}::date AND ${hasta}::date
        ${mesero ? sql`AND o.waiter_id = ${mesero}::uuid` : sql``}
      GROUP BY o.waiter_id, s.full_name, 3 ORDER BY 3 DESC, 2`);
    return r.rows as { mesero_id: string | null; mesero: string; dia: string; propina: string }[];
  }

  lista(t: Tenant, desde: string, hasta: string) {
    if (hasta < desde) throw new BadRequestException('«Hasta» no puede ser anterior a «desde».');
    if ((Date.parse(hasta) - Date.parse(desde)) / 86_400_000 > MAX_DIAS) throw new BadRequestException(`El rango máximo es de ${MAX_DIAS} días.`);
    return this.db.run(t, async (tx) => {
      const filas = await this.dias(tx, t, null, desde, hasta);
      const ent = (await tx.execute(sql`SELECT d.staff_id, d.day::text AS dia, d.amount::text AS monto, d.delivered_at, u.full_name AS por FROM tip_payouts d LEFT JOIN users u ON u.id = d.delivered_by
        WHERE d.restaurant_id = ${t.restaurantId} AND d.day BETWEEN ${desde}::date AND ${hasta}::date`)).rows as { staff_id: string; dia: string; monto: string; delivered_at: Date; por: string | null }[];
      const out: FilaPropina[] = filas.map((f) => {
        const e = ent.find((x) => x.staff_id === f.mesero_id && x.dia === f.dia);
        const entregada = e?.monto ?? '0.00';
        return { meseroId: f.mesero_id, mesero: f.mesero, dia: f.dia, propina: f.propina, entregada, pendiente: pendienteDePropina(f.propina, entregada), entregadaEl: e ? new Date(e.delivered_at).toISOString() : null, entregadaPor: e?.por ?? null };
      });
      return { desde, hasta, filas: out, totales: totalesDePropinas(out) };
    });
  }

  /** Marca como entregada la propina de ese mesero ese día (lo acumulado hasta ahora). Repetir actualiza el monto si llegaron más propinas. */
  entregar(t: Tenant, por: string, d: z.infer<typeof Entrega>) {
    return this.db.run(t, async (tx) => {
      const [f] = await this.dias(tx, t, d.meseroId, d.dia, d.dia);
      if (!f) throw new NotFoundException('Ese mesero no tiene propinas ese día.');
      await tx.execute(sql`INSERT INTO tip_payouts (restaurant_id, staff_id, day, amount, delivered_by) VALUES (${t.restaurantId}, ${d.meseroId}::uuid, ${d.dia}::date, ${f.propina}::numeric, ${por}::uuid)
        ON CONFLICT (restaurant_id, staff_id, day) DO UPDATE SET amount = EXCLUDED.amount, delivered_by = EXCLUDED.delivered_by, delivered_at = now()`);
      await auditar(tx, t.restaurantId, por, 'propinas.entregada', 'staff', d.meseroId, { dia: d.dia, monto: f.propina });
      return { ok: true, entregada: f.propina };
    });
  }
}
