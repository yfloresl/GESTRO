import type { PoolClient } from 'pg';

/**
 * Ampliación de la demostración: lo que hace que TODOS los módulos tengan algo que mostrar (reservas, compras, cuentas por cobrar y por pagar,
 * turnos, salón en vivo con pedidos abiertos y llamados de mesa). Corre dentro de la misma transacción que `cargarDatosDemo`, que le pasa el contexto.
 * Los datos de personas (staff_members) se conservan al restablecer, por eso el personal se busca por nombre antes de crearlo.
 */
export interface ContextoDemo {
  c: PoolClient; rid: string; hoy: string; tz: string;
  mesas: string[]; prov: string[]; almacen: string;
  ing: Map<string, { id: string; u: { costo: number } }>;
  platos: { id: string; d: { n: string; precio: number } }[];
  fecha: (base: string, d: number) => string;
  iso: (dia: string, h: number, m: number) => string;
  r2: (n: number) => number;
  asiento: (dia: string, memo: string, source: string, lineas: [string, number, number][]) => Promise<void>;
}

const CLIENTES_CREDITO = [['Empresa Constructora Illimani', '70234567'], ['Notaría Rojas', '71123456'], ['Colegio San Andrés', '76543210'], ['Estudio Jurídico Vargas', '72345678'], ['Clínica Santa Rita', '73456789'], ['Banco Comunal Sur', '75678901']] as const;

/** Devuelve cuántos pedidos abiertos de hoy sembró (se suman al total de pedidos de la demostración). */
export async function ampliarDemo(x: ContextoDemo): Promise<number> {
  const { c, rid, hoy, mesas, prov, almacen, ing, platos, fecha, iso, r2, asiento } = x;
  const idPlato = (n: string) => platos.find((p) => p.d.n === n)!.id;

  // --- Reservas por la web: la sucursal las acepta y confirma sola ---
  await c.query(`UPDATE restaurants SET reservations_enabled = true, reservation_auto_confirm = true WHERE id = $1`, [rid]);
  const reservas: [number, number, number, number, string, string, number, string, string][] = [
    // [día relativo, hora, minuto, mesa(índice), cliente, teléfono, personas, estado, notas]
    [-6, 20, 0, 4, 'Familia Quispe', '70111222', 4, 'cumplida', ''], [-4, 13, 0, 7, 'Almuerzo de la oficina Delta', '71222333', 6, 'cumplida', 'Cuenta separada'],
    [-3, 20, 30, 5, 'Carla Mendoza', '72333444', 3, 'no_show', ''], [-2, 21, 0, 6, 'Pablo Rivera', '73444555', 4, 'cancelada', 'Canceló por lluvia'],
    [0, 20, 0, 3, 'Marcela y Jorge', '74555666', 2, 'confirmada', 'Aniversario: postre con vela'], [0, 21, 15, 7, 'Grupo Torrez', '75666777', 6, 'pendiente', ''],
    [1, 13, 0, 7, 'Almuerzo de negocios Ticona', '76777888', 5, 'confirmada', 'Factura a nombre de empresa'], [1, 20, 0, 4, 'Familia Choque', '77888999', 4, 'confirmada', ''],
    [2, 20, 30, 5, 'Rosario Flores', '78999000', 3, 'pendiente', 'Una persona vegetariana'], [3, 21, 0, 6, 'Cumpleaños de Lucía', '70001112', 4, 'confirmada', 'Tarta propia'],
  ];
  for (const [d, h, m, mesa, cliente, tel, pax, estado, notas] of reservas) {
    const dia = fecha(hoy, d);
    await c.query(`INSERT INTO reservations (restaurant_id, table_id, customer_name, phone, party_size, starts_at, ends_at, state, notes, source)
      VALUES ($1,$2,$3,$4,$5,$6::timestamptz,$6::timestamptz + interval '90 minutes',$7::reservation_state,$8,$9)`, [rid, mesas[mesa], cliente, tel, pax, iso(dia, h, m), estado, notas || null, d <= -2 ? 'caja' : 'web']);
  }

  // --- Ventas a crédito: cuentas por cobrar (abiertas, vencidas, con abono y saldadas) ---
  const cred = (await c.query(`SELECT p.id, p.amount::float8 AS monto, (p.paid_at AT TIME ZONE $2)::date::text AS dia FROM sales_payments p WHERE p.restaurant_id = $1 AND p.method = 'credito' ORDER BY p.paid_at`, [rid, x.tz])).rows as { id: string; monto: number; dia: string }[];
  for (const [i, v] of cred.entries()) {
    const [cliente, tel] = CLIENTES_CREDITO[i % CLIENTES_CREDITO.length];
    const vence = fecha(v.dia, 15); const abono = i % 3 === 0 ? v.monto : i % 3 === 1 ? r2(v.monto / 2) : 0;
    const cobroDia = fecha(v.dia, 7) < hoy ? fecha(v.dia, 7) : fecha(hoy, -1);
    await c.query(`INSERT INTO payables_receivables (restaurant_id, direction, counterparty, customer_phone, amount, paid, due_on, sales_payment_id, paid_at, created_at)
      VALUES ($1,'por_cobrar',$2,$3,$4,$5,$6::date,$7,$8,$9::timestamptz)`, [rid, cliente, tel, v.monto, abono, vence, v.id, abono >= v.monto ? `${cobroDia}T15:00:00-04:00` : null, `${v.dia}T20:00:00-04:00`]);
    if (abono > 0) await asiento(cobroDia, `Cobro de cuenta por cobrar: ${cliente}`, 'cobro_cxc', [['bancos', abono, 0], ['cxc', 0, abono]]);
  }

  // --- Compras: una orden recibida (a crédito), una enviada y una borrador ---
  const lineasOc = async (oc: string, lineas: [string, number][]) => {
    let total = 0;
    for (const [n, q] of lineas) { const costo = ing.get(n)!.u.costo; total += q * costo; await c.query(`INSERT INTO purchase_order_lines (restaurant_id, purchase_order_id, ingredient_id, qty, unit_cost) VALUES ($1,$2,$3,$4,$5)`, [rid, oc, ing.get(n)!.id, q, costo]); }
    await c.query(`UPDATE purchase_orders SET total = $2 WHERE id = $1`, [oc, r2(total)]);
    return r2(total);
  };
  const ocRec = (await c.query(`INSERT INTO purchase_orders (restaurant_id, supplier_id, status, expected_on, notes, sent_at, created_at) VALUES ($1,$2,'recibida',$3::date,'Reposición de secos',$4::timestamptz,$4::timestamptz) RETURNING id`, [rid, prov[0], fecha(hoy, -11), iso(fecha(hoy, -13), 9, 0)])).rows[0].id as string;
  const recibidas: [string, number][] = [['Aceite', 20], ['Harina', 40], ['Arroz', 30]];
  const totalRec = await lineasOc(ocRec, recibidas);
  await c.query(`UPDATE purchase_order_lines SET received_qty = qty WHERE purchase_order_id = $1`, [ocRec]);
  const rec = (await c.query(`INSERT INTO purchase_receipts (restaurant_id, purchase_order_id, warehouse_id, invoice_number, total, received_at) VALUES ($1,$2,$3,'F-2231',$4,$5::timestamptz) RETURNING id`, [rid, ocRec, almacen, totalRec, iso(fecha(hoy, -11), 10, 30)])).rows[0].id as string;
  for (const [n, q] of recibidas) {
    const i = ing.get(n)!;
    await c.query(`INSERT INTO purchase_receipt_lines (restaurant_id, receipt_id, ingredient_id, ordered_qty, pending_before, received_qty, unit_cost) VALUES ($1,$2,$3,$4,$4,$4,$5)`, [rid, rec, i.id, q, i.u.costo]);
    await c.query(`INSERT INTO stock_movements (restaurant_id, warehouse_id, ingredient_id, kind, qty, unit_cost, ref_type, ref_id, created_at) VALUES ($1,$2,$3,'compra',$4,$5,'purchase_receipt',$6,$7::timestamptz)`, [rid, almacen, i.id, q, i.u.costo, rec, iso(fecha(hoy, -11), 10, 30)]);
  }
  await c.query(`INSERT INTO payables_receivables (restaurant_id, direction, counterparty, supplier_id, amount, due_on, purchase_order_id, receipt_id, document_number, created_at) VALUES ($1,'por_pagar','Distribuidora Andina',$2,$3,$4::date,$5,$6,'F-2231',$7::timestamptz)`,
    [rid, prov[0], totalRec, fecha(hoy, 4), ocRec, rec, iso(fecha(hoy, -11), 10, 30)]);
  await asiento(fecha(hoy, -11), 'Compra a crédito: Distribuidora Andina (F-2231)', 'compra_credito', [['inventarios', totalRec, 0], ['proveedores', 0, totalRec]]);
  const ocEnv = (await c.query(`INSERT INTO purchase_orders (restaurant_id, supplier_id, status, expected_on, notes, sent_at, created_at) VALUES ($1,$2,'enviada',$3::date,'Para el fin de semana',$4::timestamptz,$4::timestamptz) RETURNING id`, [rid, prov[1], fecha(hoy, 1), iso(fecha(hoy, -1), 16, 0)])).rows[0].id as string;
  await lineasOc(ocEnv, [['Carne de res', 25], ['Pollo', 15]]);
  const ocBor = (await c.query(`INSERT INTO purchase_orders (restaurant_id, supplier_id, status, expected_on, notes) VALUES ($1,$2,'borrador',$3::date,'Queso bajo el mínimo: reponer') RETURNING id`, [rid, prov[0], fecha(hoy, 3)])).rows[0].id as string;
  await lineasOc(ocBor, [['Queso', 10], ['Huevo', 120]]);

  // --- Personal y turnos (el personal se conserva al restablecer: se busca por nombre) ---
  const funciones = new Map<string, string>();
  for (const f of ['Salón', 'Cocina', 'Caja']) funciones.set(f, (await c.query(`INSERT INTO staff_functions (restaurant_id, name) VALUES ($1,$2) ON CONFLICT (restaurant_id, name) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [rid, f])).rows[0].id);
  const personal: [string, string, 'regular' | 'temporal', number | null, number | null][] = [
    ['Luis Condori', 'Salón', 'regular', 18, null], ['Marta Flores', 'Cocina', 'regular', null, 3200], ['Pedro Vargas', 'Cocina', 'temporal', 15, null], ['Elena Mamani', 'Salón', 'regular', 17, null],
  ];
  const staff = new Map<string, string>();
  for (const [n, f, tipo, hora, sueldo] of personal) {
    const ya = (await c.query(`SELECT id FROM staff_members WHERE restaurant_id = $1 AND full_name = $2`, [rid, n])).rows[0]?.id as string | undefined;
    const id = ya ?? (await c.query(`INSERT INTO staff_members (restaurant_id, full_name, kind, hourly_cost, monthly_salary) VALUES ($1,$2,$3::staff_kind,$4,$5) RETURNING id`, [rid, n, tipo, hora, sueldo])).rows[0].id as string;
    await c.query(`UPDATE staff_members SET function_id = $2 WHERE id = $1`, [id, funciones.get(f)]);
    staff.set(n, id);
  }
  const evento = (await c.query(`SELECT id, starts_at, ends_at FROM events WHERE restaurant_id = $1 ORDER BY starts_at LIMIT 1`, [rid])).rows[0] as { id: string; starts_at: Date; ends_at: Date } | undefined;
  for (let d = -10; d <= 6; d++) {
    const dia = fecha(hoy, d); const finde = [5, 6, 0].includes(new Date(`${dia}T12:00:00Z`).getUTCDay());
    const turnos: [string, number, number, string][] = [['Luis Condori', 11, 17, 'Salón'], ['Marta Flores', 10, 18, 'Cocina']];
    if (finde || d % 2 === 0) turnos.push(['Elena Mamani', 17, 23, 'Salón']);
    if (finde) turnos.push(['Pedro Vargas', 17, 23, 'Cocina']);
    for (const [n, h1, h2, f] of turnos) {
      const horas = h2 - h1; const pasado = d < 0; const costo = personal.find((p) => p[0] === n)![3];
      await c.query(`INSERT INTO shifts (restaurant_id, staff_id, function_id, starts_at, ends_at, check_in, check_out, pay_amount) VALUES ($1,$2,$3,$4::timestamptz,$5::timestamptz,$6::timestamptz,$7::timestamptz,$8)`,
        [rid, staff.get(n), funciones.get(f), iso(dia, h1, 0), iso(dia, h2, 0), pasado ? iso(dia, h1, n === 'Elena Mamani' && d % 3 === 0 ? 12 : 0) : null, pasado ? iso(dia, h2, 5) : null, costo ? r2(costo * horas) : null]);
    }
  }
  if (evento) {
    for (const n of ['Luis Condori', 'Elena Mamani', 'Pedro Vargas']) {
      await c.query(`INSERT INTO shifts (restaurant_id, staff_id, function_id, event_id, starts_at, ends_at, pay_amount, notes) VALUES ($1,$2,$3,$4,$5::timestamptz,$6::timestamptz,$7,'Servicio del evento')`,
        [rid, staff.get(n), funciones.get(n === 'Pedro Vargas' ? 'Cocina' : 'Salón'), evento.id, new Date(evento.starts_at).toISOString(), new Date(evento.ends_at).toISOString(), n === 'Pedro Vargas' ? 90 : 100]);
    }
  }

  // --- Salón en vivo: pedidos abiertos hoy, para ver mesas ocupadas y el tablero de cocina ---
  const abiertos: [number, string, [string, number, string][]][] = [
    [1, 'en_preparacion', [['Pique macho', 2, 'en_preparacion'], ['Refresco', 2, 'servido']]],
    [2, 'enviado', [['Silpancho', 1, 'enviado'], ['Sopa de maní', 1, 'enviado']]],
    [3, 'listo', [['Milanesa de pollo', 2, 'listo'], ['Limonada', 2, 'servido']]],
    [5, 'servido', [['Fricasé', 1, 'servido'], ['Flan', 1, 'servido']]],
  ];
  for (const [mesa, estado, items] of abiertos) {
    const total = items.reduce((s, [n, q]) => s + q * platos.find((p) => p.d.n === n)!.d.precio, 0);
    const oid = (await c.query(`INSERT INTO orders (restaurant_id, table_id, channel, order_type, status, subtotal, total, opened_at, sent_at) VALUES ($1,$2,'mesero','mesa',$3::order_status,$4,$4, now() - interval '25 minutes', now() - interval '24 minutes') RETURNING id`, [rid, mesas[mesa], estado, total])).rows[0].id as string;
    for (const [n, q, st] of items) await c.query(`INSERT INTO order_items (restaurant_id, order_id, menu_item_id, qty, unit_price, list_price, status, sent_at, started_at, ready_at) VALUES ($1,$2,$3,$4,$5,$5,$6::order_status, now() - interval '24 minutes', CASE WHEN $6 <> 'enviado' THEN now() - interval '20 minutes' END, CASE WHEN $6 IN ('listo','servido') THEN now() - interval '8 minutes' END)`, [rid, oid, idPlato(n), q, platos.find((p) => p.d.n === n)!.d.precio, st]);
  }
  await c.query(`INSERT INTO service_requests (restaurant_id, table_id, kind, comment, status) VALUES ($1,$2,'atencion','Necesitamos más servilletas','pendiente'), ($1,$3,'cuenta',NULL,'pendiente')`, [rid, mesas[0], mesas[4]]);
  await c.query(`INSERT INTO service_requests (restaurant_id, table_id, kind, status, attended_at, created_at) VALUES ($1,$2,'cuenta','atendida', now() - interval '2 hours', now() - interval '2 hours 5 minutes')`, [rid, mesas[6]]);
  return abiertos.length;
}
