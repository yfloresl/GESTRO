import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { auditar } from '../comun/auditoria';
import { Tenant, TenantDb } from '../database/database.module';
import { ContabilidadService } from '../contabilidad/contabilidad.service';

const HOY = sql`(now() AT TIME ZONE 'America/La_Paz')::date`;
export const CobroDeCuenta = z.object({
  monto: z.number().positive().max(10_000_000).refine((n) => Math.round(n * 100) / 100 === n, 'Máximo 2 decimales').optional(),
  via: z.enum(['caja', 'bancos']).default('caja'),
}).strict();

/** Cuentas por cobrar: ventas a crédito. Cada cobro (total o parcial) genera su asiento: Caja o Bancos contra Cuentas por cobrar. */
@Injectable()
export class CobranzasService {
  constructor(@Inject(TenantDb) private readonly db: TenantDb, @Inject(ContabilidadService) private readonly conta: ContabilidadService) {}

  porCobrar(t: Tenant, soloAbiertas = true) {
    return this.db.run(t, async (tx) => {
      const r = await tx.execute(sql`SELECT p.id, p.counterparty, p.customer_phone, p.amount::text AS monto, p.paid::text AS pagado, (p.amount - p.paid)::text AS saldo, p.due_on::text AS vence, (p.due_on - ${HOY})::int AS dias
        FROM payables_receivables p WHERE p.restaurant_id = ${t.restaurantId} AND p.direction = 'por_cobrar' AND p.voided_at IS NULL ${soloAbiertas ? sql`AND p.paid < p.amount` : sql``} ORDER BY p.due_on, p.created_at LIMIT 300`);
      return (r.rows as { id: string; counterparty: string; customer_phone: string | null; monto: string; pagado: string; saldo: string; vence: string; dias: number }[])
        .map((x) => ({ id: x.id, cliente: x.counterparty, telefono: x.customer_phone, monto: x.monto, pagado: x.pagado, saldo: x.saldo, vence: x.vence, dias: x.dias, vencida: x.dias < 0 && Number(x.saldo) > 0 }));
    });
  }

  cobrar(t: Tenant, por: string, id: string, d: z.infer<typeof CobroDeCuenta>) {
    return this.db.run(t, async (tx) => {
      const [c] = (await tx.execute(sql`SELECT (amount - paid)::text AS saldo FROM payables_receivables WHERE id = ${id} AND restaurant_id = ${t.restaurantId} AND direction = 'por_cobrar' AND voided_at IS NULL FOR UPDATE`)).rows as { saldo: string }[];
      if (!c) throw new NotFoundException('Cuenta por cobrar no encontrada.');
      if (!(Number(c.saldo) > 0)) throw new ConflictException('Esta cuenta ya está cobrada.');
      const monto = d.monto !== undefined ? d.monto.toFixed(2) : c.saldo;
      if (Number(monto) > Number(c.saldo)) throw new BadRequestException(`El cobro supera el saldo (Bs ${c.saldo}).`);
      const r = (await tx.execute(sql`UPDATE payables_receivables SET paid = paid + ${monto}::numeric, paid_by = ${por}::uuid, paid_at = CASE WHEN paid + ${monto}::numeric >= amount THEN now() ELSE paid_at END WHERE id = ${id} RETURNING (amount - paid)::text AS saldo`)).rows[0] as { saldo: string };
      await this.conta.cobroDeCuenta(tx, t, por, monto, d.via);
      await auditar(tx, t.restaurantId, por, 'cobranzas.cobro', 'receivable', id, { monto, via: d.via, saldo: r.saldo });
      return { ok: true, saldo: r.saldo };
    });
  }
}
