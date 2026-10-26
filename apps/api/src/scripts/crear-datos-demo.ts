/**
 * Datos de ejemplo para presentar o probar GESTRO, en la terminal del contenedor `api`:
 *   node dist/src/scripts/crear-datos-demo.js --sucursal <slug> --confirmo
 * Carga en una sucursal NUEVA (sin pedidos, platos ni asientos): menú con recetas, inventario con stock, proveedores, mesas, 60 días de
 * ventas con su consumo y costo, mermas, asientos contables, una promoción y un evento. Si la sucursal ya tiene datos, no hace nada.
 * Es de un solo uso por sucursal y NO es para restaurantes reales: mezclaría ventas inventadas con las verdaderas.
 */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { entorno } from '../config/entorno';
import { PLAN_DE_CUENTAS } from '../contabilidad/asientos';

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : undefined; };
const tiene = (n: string) => process.argv.includes(`--${n}`);

// Generador pseudoaleatorio fijo: los datos de ejemplo salen siempre iguales.
let semilla = 20261025;
const azar = () => { semilla = (semilla * 16807) % 2147483647; return semilla / 2147483647; };
const entre = (a: number, b: number) => a + azar() * (b - a);
const elegir = <T>(pesos: [T, number][]): T => { let x = azar() * pesos.reduce((s, p) => s + p[1], 0); for (const [v, p] of pesos) { x -= p; if (x <= 0) return v; } return pesos[0][0]; };
const r2 = (n: number) => Math.round(n * 100) / 100;
const fecha = (base: string, d: number) => new Date(Date.parse(`${base}T12:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);
const iso = (dia: string, h: number, m: number) => `${dia}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00-04:00`;

type Ing = { n: string; u: string; costo: number; min: number; perecedero: boolean; prov: 0 | 1 };
const INGREDIENTES: Ing[] = [
  { n: 'Carne de res', u: 'kg', costo: 62, min: 8, perecedero: true, prov: 1 }, { n: 'Pollo', u: 'kg', costo: 28, min: 8, perecedero: true, prov: 1 }, { n: 'Papa', u: 'kg', costo: 6, min: 15, perecedero: false, prov: 0 },
  { n: 'Arroz', u: 'kg', costo: 9, min: 10, perecedero: false, prov: 0 }, { n: 'Cebolla', u: 'kg', costo: 5, min: 6, perecedero: false, prov: 0 }, { n: 'Tomate', u: 'kg', costo: 7, min: 6, perecedero: true, prov: 0 },
  { n: 'Queso', u: 'kg', costo: 45, min: 4, perecedero: true, prov: 0 }, { n: 'Huevo', u: 'un', costo: 1.1, min: 60, perecedero: true, prov: 0 }, { n: 'Harina', u: 'kg', costo: 7, min: 5, perecedero: false, prov: 0 },
  { n: 'Aceite', u: 'l', costo: 18, min: 5, perecedero: false, prov: 0 }, { n: 'Maní', u: 'kg', costo: 25, min: 2, perecedero: false, prov: 0 }, { n: 'Fideo', u: 'kg', costo: 10, min: 4, perecedero: false, prov: 0 },
  { n: 'Plátano', u: 'kg', costo: 8, min: 5, perecedero: true, prov: 0 }, { n: 'Leche', u: 'l', costo: 8, min: 6, perecedero: true, prov: 0 }, { n: 'Azúcar', u: 'kg', costo: 8, min: 4, perecedero: false, prov: 0 },
  { n: 'Lechuga', u: 'kg', costo: 10, min: 2, perecedero: true, prov: 0 }, { n: 'Limón', u: 'kg', costo: 9, min: 2, perecedero: true, prov: 0 },
  { n: 'Gaseosa 500 ml', u: 'un', costo: 4.5, min: 24, perecedero: false, prov: 0 }, { n: 'Cerveza', u: 'un', costo: 9, min: 24, perecedero: false, prov: 0 },
];
// Cantidades de receta: g y ml se convierten a la unidad del insumo (kg, l); «un» va directo.
type Linea = [string, number, 'g' | 'ml' | 'un'];
const PLATOS: { n: string; cat: string; precio: number; prep: number; real: number; peso: number; receta: Linea[] }[] = [
  { n: 'Sopa de maní', cat: 'Entradas', precio: 28, prep: 10, real: 9, peso: 9, receta: [['Maní', 40, 'g'], ['Papa', 80, 'g'], ['Fideo', 30, 'g'], ['Cebolla', 20, 'g'], ['Carne de res', 40, 'g']] },
  { n: 'Empanada de queso', cat: 'Entradas', precio: 12, prep: 8, real: 8, peso: 8, receta: [['Harina', 60, 'g'], ['Queso', 40, 'g'], ['Aceite', 20, 'ml'], ['Huevo', 0.25, 'un']] },
  { n: 'Ensalada mixta', cat: 'Entradas', precio: 22, prep: 6, real: 6, peso: 3, receta: [['Lechuga', 100, 'g'], ['Tomate', 80, 'g'], ['Cebolla', 20, 'g']] },
  { n: 'Pique macho', cat: 'Platos de fondo', precio: 78, prep: 15, real: 15, peso: 14, receta: [['Carne de res', 220, 'g'], ['Papa', 250, 'g'], ['Cebolla', 50, 'g'], ['Tomate', 60, 'g'], ['Huevo', 1, 'un']] },
  { n: 'Milanesa de pollo', cat: 'Platos de fondo', precio: 56, prep: 12, real: 19, peso: 12, receta: [['Pollo', 250, 'g'], ['Harina', 40, 'g'], ['Huevo', 1, 'un'], ['Papa', 200, 'g'], ['Aceite', 60, 'ml'], ['Arroz', 100, 'g']] },
  { n: 'Silpancho', cat: 'Platos de fondo', precio: 52, prep: 14, real: 14, peso: 10, receta: [['Carne de res', 200, 'g'], ['Papa', 250, 'g'], ['Arroz', 120, 'g'], ['Huevo', 1, 'un'], ['Tomate', 40, 'g'], ['Cebolla', 30, 'g']] },
  { n: 'Fricasé', cat: 'Platos de fondo', precio: 60, prep: 18, real: 18, peso: 5, receta: [['Carne de res', 250, 'g'], ['Papa', 150, 'g'], ['Cebolla', 40, 'g'], ['Arroz', 80, 'g']] },
  { n: 'Pollo a la plancha', cat: 'Platos de fondo', precio: 48, prep: 14, real: 14, peso: 8, receta: [['Pollo', 280, 'g'], ['Arroz', 120, 'g'], ['Lechuga', 50, 'g'], ['Tomate', 50, 'g']] },
  { n: 'Fideo con queso', cat: 'Platos de fondo', precio: 38, prep: 10, real: 10, peso: 2, receta: [['Fideo', 150, 'g'], ['Queso', 80, 'g'], ['Cebolla', 20, 'g'], ['Aceite', 15, 'ml']] },
  { n: 'Charquekan', cat: 'Platos de fondo', precio: 70, prep: 20, real: 20, peso: 3, receta: [['Carne de res', 200, 'g'], ['Papa', 250, 'g'], ['Huevo', 1, 'un'], ['Queso', 50, 'g']] },
  { n: 'Refresco', cat: 'Bebidas', precio: 10, prep: 2, real: 2, peso: 14, receta: [['Gaseosa 500 ml', 1, 'un']] },
  { n: 'Cerveza', cat: 'Bebidas', precio: 14, prep: 2, real: 2, peso: 7, receta: [['Cerveza', 1, 'un']] },
  { n: 'Limonada', cat: 'Bebidas', precio: 14, prep: 4, real: 4, peso: 6, receta: [['Limón', 120, 'g'], ['Azúcar', 30, 'g']] },
  { n: 'Flan', cat: 'Postres', precio: 18, prep: 5, real: 5, peso: 4, receta: [['Huevo', 2, 'un'], ['Leche', 200, 'ml'], ['Azúcar', 40, 'g']] },
  { n: 'Plátano frito', cat: 'Postres', precio: 16, prep: 6, real: 6, peso: 2, receta: [['Plátano', 200, 'g'], ['Aceite', 40, 'ml'], ['Azúcar', 15, 'g']] },
];
const FACTOR = { g: 0.001, ml: 0.001, un: 1 } as const;
const PEDIDOS_POR_DIA: Record<number, number> = { 1: 14, 2: 12, 3: 16, 4: 18, 5: 30, 6: 38, 7: 26 };   // lunes … domingo
const DIAS = 60;

async function main() {
  const slug = arg('sucursal');
  if (!slug || !tiene('confirmo')) { console.error('Uso: --sucursal <slug> --confirmo   (carga datos de EJEMPLO en una sucursal nueva)'); process.exit(2); }
  const pool = new Pool({ connectionString: entorno.baseDeDatos, max: 1 });
  const c = await pool.connect();
  try {
    const rest = (await c.query('SELECT id, timezone FROM restaurants WHERE slug = $1', [slug])).rows[0] as { id: string; timezone: string } | undefined;
    if (!rest) { console.error(`No existe la sucursal «${slug}».`); process.exit(1); }
    const rid = rest.id;
    for (const [tabla, que] of [['orders', 'pedidos'], ['menu_items', 'platos'], ['journal_entries', 'asientos contables'], ['ingredients', 'insumos']] as const) {
      if ((await c.query(`SELECT 1 FROM ${tabla} WHERE restaurant_id = $1 LIMIT 1`, [rid])).rows.length) { console.error(`La sucursal ya tiene ${que}: los datos de ejemplo solo se cargan en una sucursal nueva.`); process.exit(1); }
    }
    const hoy = (await c.query(`SELECT (now() AT TIME ZONE $1)::date::text AS d`, [rest.timezone])).rows[0].d as string;
    await c.query('BEGIN');

    // --- Mesas, proveedores, almacenes ---
    const mesas: string[] = [];
    for (let i = 1; i <= 8; i++) mesas.push((await c.query(`INSERT INTO restaurant_tables (restaurant_id, number, seats) VALUES ($1,$2,$3) ON CONFLICT (restaurant_id, number) DO UPDATE SET seats = EXCLUDED.seats RETURNING id`, [rid, String(i), i <= 4 ? 2 : i <= 7 ? 4 : 6])).rows[0].id);
    const prov = [] as string[];
    for (const [n, dias, pago] of [['Distribuidora Andina', 2, 15], ['Carnes del Valle', 1, 0]] as const) prov.push((await c.query(`INSERT INTO suppliers (restaurant_id, name, lead_days, payment_days) VALUES ($1,$2,$3,$4) RETURNING id`, [rid, n, dias, pago])).rows[0].id);
    const almacen = (await c.query(`INSERT INTO warehouses (restaurant_id, name) VALUES ($1,'Cocina') ON CONFLICT (restaurant_id, name) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [rid])).rows[0].id as string;

    // --- Insumos, menú y recetas ---
    const ing = new Map<string, { id: string; u: Ing }>();
    for (const i of INGREDIENTES) ing.set(i.n, { id: (await c.query(`INSERT INTO ingredients (restaurant_id, name, unit_code, min_stock, last_cost, perishable, preferred_supplier_id, default_warehouse_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, [rid, i.n, i.u, i.min, i.costo, i.perecedero, prov[i.prov], almacen])).rows[0].id, u: i });
    const cats = new Map<string, string>();
    for (const [i, n] of ['Entradas', 'Platos de fondo', 'Bebidas', 'Postres'].entries()) cats.set(n, (await c.query(`INSERT INTO menu_categories (restaurant_id, name, sort_order) VALUES ($1,$2,$3) RETURNING id`, [rid, n, i])).rows[0].id);
    const platos = [] as { id: string; d: (typeof PLATOS)[number] }[];
    for (const [i, d] of PLATOS.entries()) {
      const id = (await c.query(`INSERT INTO menu_items (restaurant_id, category_id, name, price, prep_minutes, sort_order) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [rid, cats.get(d.cat), d.n, d.precio, d.prep, i])).rows[0].id as string;
      const rec = (await c.query(`INSERT INTO recipes (restaurant_id, menu_item_id, version, yield_portions, waste_pct, active) VALUES ($1,$2,1,1,0,true) RETURNING id`, [rid, id])).rows[0].id as string;
      for (const [n, q, u] of d.receta) await c.query(`INSERT INTO recipe_lines (restaurant_id, recipe_id, ingredient_id, qty, unit_code) VALUES ($1,$2,$3,$4,$5)`, [rid, rec, ing.get(n)!.id, q, u]);
      platos.push({ id, d });
    }

    // --- Historia de ventas en memoria (60 días hasta ayer) ---
    type Item = { id: string; plato: (typeof platos)[number]; cant: number };
    type Pedido = { id: string; dia: string; ts: string; ready: string; canal: string; tipo: string; mesa: string | null; metodo: string; items: Item[]; total: number };
    const dias: { fecha: string; pedidos: Pedido[] }[] = [];
    for (let k = DIAS; k >= 1; k--) {
      const f = fecha(hoy, -k); const iso7 = ((new Date(`${f}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
      const crecimiento = 0.85 + 0.25 * ((DIAS - k) / DIAS);
      const n = Math.max(3, Math.round(PEDIDOS_POR_DIA[iso7] * crecimiento * entre(0.8, 1.2)));
      const pedidos: Pedido[] = [];
      for (let p = 0; p < n; p++) {
        const canal = elegir<string>([['mesero', 60], ['caja', 20], ['qr_mesa', 20]]);
        const items: Item[] = []; let total = 0;
        const cuantos = elegir<number>([[1, 45], [2, 40], [3, 15]]);
        for (let j = 0; j < cuantos; j++) { const plato = elegir(platos.map((x) => [x, x.d.peso] as [typeof x, number])); const cant = elegir<number>([[1, 75], [2, 25]]); items.push({ id: randomUUID(), plato, cant }); total += plato.d.precio * cant; }
        const almuerzo = azar() < 0.7; const h = almuerzo ? 12 + Math.floor(azar() * 2) : 19 + Math.floor(azar() * 3); const m = Math.floor(azar() * 60);
        const prepMax = Math.max(...items.map((i) => i.plato.d.real)) + entre(-2, 3);
        pedidos.push({ id: randomUUID(), dia: f, ts: iso(f, h, m), ready: new Date(Date.parse(iso(f, h, m)) + Math.max(3, prepMax) * 60_000).toISOString(), canal, tipo: canal === 'caja' ? 'mostrador' : 'mesa', mesa: canal === 'caja' ? null : mesas[Math.floor(azar() * mesas.length)],
          metodo: elegir<string>([['efectivo', 55], ['qr', 30], ['tarjeta', 15]]), items, total: r2(total) });
      }
      dias.push({ fecha: f, pedidos });
    }

    // --- Cuentas contables ---
    const cuentas = new Map<string, string>(); const porCodigo = new Map<string, string>();
    for (const a of PLAN_DE_CUENTAS) {
      const r = await c.query(`INSERT INTO chart_of_accounts (restaurant_id, code, name, type, parent_id, accepts_entries, system_key) VALUES ($1,$2,$3,$4::account_type,$5,$6,$7) RETURNING id`, [rid, a.code, a.name, a.type, a.parent ? porCodigo.get(a.parent) : null, !a.groups, a.key ?? null]);
      porCodigo.set(a.code, r.rows[0].id); if (a.key) cuentas.set(a.key, r.rows[0].id);
    }
    let numero = 0;
    const asiento = async (dia: string, memo: string, source: string, lineas: [string, number, number][]) => {
      const e = (await c.query(`INSERT INTO journal_entries (restaurant_id, entry_date, number, memo, source, source_id, posted) VALUES ($1,$2::date,$3,$4,$5,$6,false) RETURNING id`, [rid, dia, ++numero, memo, source, source === 'manual' ? null : randomUUID()])).rows[0].id as string;
      for (const [k, d, h] of lineas.filter((l) => l[1] > 0 || l[2] > 0)) await c.query(`INSERT INTO journal_lines (restaurant_id, entry_id, account_id, debit, credit) VALUES ($1,$2,$3,$4,$5)`, [rid, e, cuentas.get(k), r2(d), r2(h)]);
      await c.query(`UPDATE journal_entries SET posted = true, posted_at = now() WHERE id = $1`, [e]);
    };
    await asiento(fecha(hoy, -DIAS - 1), 'Aporte inicial de capital (datos de ejemplo)', 'manual', [['caja', 40000, 0], ['capital', 0, 40000]]);

    // --- Recorrido día por día: compras de la semana, ventas, consumo, mermas y asientos ---
    let totalVentas = 0; let totalPedidos = 0;
    const consumoDe = (p: Pedido) => { const m = new Map<string, number>(); for (const it of p.items) for (const [n, q, u] of it.plato.d.receta) m.set(n, (m.get(n) ?? 0) + q * FACTOR[u] * it.cant); return m; };
    for (const [idx, dia] of dias.entries()) {
      if (idx % 7 === 0) {                                                  // compra semanal: lo que se va a consumir en los próximos 7 días + 10 %
        const necesidad = new Map<string, number>();
        for (const d of dias.slice(idx, idx + 7)) for (const p of d.pedidos) for (const [n, q] of consumoDe(p)) necesidad.set(n, (necesidad.get(n) ?? 0) + q);
        let gasto = 0; const nombres: string[] = []; const cant: number[] = []; const costos: number[] = [];
        for (const [n, q] of necesidad) { const i = ing.get(n)!; const deriva = 1 + (n === 'Carne de res' ? 0.12 * (idx / dias.length) : 0); const costo = r2(i.u.costo * deriva * entre(0.97, 1.03)); const qty = Math.ceil(q * 1.1 * 1000) / 1000; nombres.push(i.id); cant.push(qty); costos.push(costo); gasto += qty * costo; }
        await c.query(`INSERT INTO stock_movements (restaurant_id, warehouse_id, ingredient_id, kind, qty, unit_cost, created_at) SELECT $1, $2, u.i, 'compra', u.q, u.c, $3::timestamptz FROM unnest($4::uuid[], $5::numeric[], $6::numeric[]) AS u(i, q, c)`, [rid, almacen, iso(dia.fecha, 8, 0), nombres, cant, costos]);
        await asiento(dia.fecha, 'Compras de la semana al contado (datos de ejemplo)', 'compra_directa', [['inventarios', gasto, 0], ['caja', 0, gasto]]);
        await c.query(`UPDATE ingredients i SET last_cost = u.c FROM unnest($1::uuid[], $2::numeric[]) AS u(id, c) WHERE i.id = u.id`, [nombres, costos]);
      }
      if (!dia.pedidos.length) continue;
      await c.query(`INSERT INTO orders (id, restaurant_id, table_id, channel, order_type, status, subtotal, total, opened_at, sent_at, ready_at, closed_at)
        SELECT u.id, $1, u.tid, u.canal::order_channel, u.tipo::order_type, 'cobrado', u.total, u.total, u.ts, u.ts, u.ready, u.ts + interval '30 minutes' FROM unnest($2::uuid[], $3::uuid[], $4::text[], $5::text[], $6::numeric[], $7::timestamptz[], $8::timestamptz[]) AS u(id, tid, canal, tipo, total, ts, ready)`,
      [rid, dia.pedidos.map((p) => p.id), dia.pedidos.map((p) => p.mesa), dia.pedidos.map((p) => p.canal), dia.pedidos.map((p) => p.tipo), dia.pedidos.map((p) => p.total), dia.pedidos.map((p) => p.ts), dia.pedidos.map((p) => p.ready)]);
      const items = dia.pedidos.flatMap((p) => p.items.map((it) => ({ p, it })));
      await c.query(`INSERT INTO order_items (id, restaurant_id, order_id, menu_item_id, qty, unit_price, list_price, status, sent_at, ready_at, started_at)
        SELECT u.id, $1, u.oid, u.mid, u.q, u.pr, u.pr, 'servido', u.ts, u.ready, u.ts FROM unnest($2::uuid[], $3::uuid[], $4::uuid[], $5::numeric[], $6::numeric[], $7::timestamptz[], $8::timestamptz[]) AS u(id, oid, mid, q, pr, ts, ready)`,
      [rid, items.map((x) => x.it.id), items.map((x) => x.p.id), items.map((x) => x.it.plato.id), items.map((x) => x.it.cant), items.map((x) => x.it.plato.d.precio), items.map((x) => x.p.ts), items.map((x) => new Date(Date.parse(x.p.ts) + x.it.plato.d.real * 60_000 * entre(0.85, 1.15)).toISOString())]);
      await c.query(`INSERT INTO sales_payments (restaurant_id, order_id, method, amount, document, paid_at) SELECT $1, u.oid, u.m, u.a, 'ninguno', u.ts + interval '30 minutes' FROM unnest($2::uuid[], $3::text[], $4::numeric[], $5::timestamptz[]) AS u(oid, m, a, ts)`,
        [rid, dia.pedidos.map((p) => p.id), dia.pedidos.map((p) => p.metodo), dia.pedidos.map((p) => p.total), dia.pedidos.map((p) => p.ts)]);
      // Consumo de insumos por plato vendido (al costo promedio vigente en ese momento)
      const mov = items.flatMap(({ p, it }) => it.plato.d.receta.map(([n, q, u]) => ({ ing: ing.get(n)!.id, qty: -Math.round(q * FACTOR[u] * it.cant * 1000) / 1000, ref: it.id, ts: p.ts })));
      await c.query(`INSERT INTO stock_movements (restaurant_id, warehouse_id, ingredient_id, kind, qty, ref_type, ref_id, created_at) SELECT $1, $2, u.i, 'consumo', u.q, 'order_item', u.r, u.ts FROM unnest($3::uuid[], $4::numeric[], $5::uuid[], $6::timestamptz[]) AS u(i, q, r, ts)`,
        [rid, almacen, mov.map((x) => x.ing), mov.map((x) => x.qty), mov.map((x) => x.ref), mov.map((x) => x.ts)]);
      const ventasDia = dia.pedidos.reduce((s, p) => s + p.total, 0); const efectivo = dia.pedidos.filter((p) => p.metodo === 'efectivo').reduce((s, p) => s + p.total, 0);
      const costoDia = (await c.query(`SELECT COALESCE(SUM(-qty * unit_cost), 0)::float8 AS v FROM stock_movements WHERE restaurant_id = $1 AND kind = 'consumo' AND created_at >= $2::timestamptz AND created_at < $2::timestamptz + interval '1 day'`, [rid, iso(dia.fecha, 0, 0)])).rows[0].v as number;
      const ef = r2(efectivo); const ba = r2(ventasDia - efectivo);
      await asiento(dia.fecha, 'Ventas del día (datos de ejemplo)', 'venta', [['caja', ef, 0], ['bancos', ba, 0], ['ventas', 0, r2(ef + ba)]]);
      await asiento(dia.fecha, 'Costo de ventas del día (datos de ejemplo)', 'costo_consumo', [['costo_ventas', costoDia, 0], ['inventarios', 0, costoDia]]);
      totalVentas += ventasDia; totalPedidos += dia.pedidos.length;
      if (idx % 4 === 1) {                                                  // una merma chica cada pocos días, de lo perecedero
        const n = elegir<string>([['Tomate', 3], ['Lechuga', 3], ['Plátano', 2], ['Leche', 2], ['Queso', 1]]); const i = ing.get(n)!; const q = r2(entre(0.3, 1.2));
        await c.query(`INSERT INTO stock_movements (restaurant_id, warehouse_id, ingredient_id, kind, qty, reason, created_at) VALUES ($1,$2,$3,'merma',$4,'Producto en mal estado (dato de ejemplo)',$5::timestamptz)`, [rid, almacen, i.id, -q, iso(dia.fecha, 22, 0)]);
        await asiento(dia.fecha, 'Merma de inventario (datos de ejemplo)', 'merma', [['mermas', q * i.u.costo, 0], ['inventarios', 0, q * i.u.costo]]);
      }
    }

    // --- Un insumo bajo el mínimo (para ver las alertas de stock) ---
    await c.query(`INSERT INTO stock_movements (restaurant_id, warehouse_id, ingredient_id, kind, qty, reason) SELECT $1, $2, i.id, 'ajuste', 1.2 - COALESCE(s.qty, 0), 'Conteo de ejemplo' FROM ingredients i LEFT JOIN stock_levels s ON s.ingredient_id = i.id AND s.warehouse_id = $2 WHERE i.restaurant_id = $1 AND i.name = 'Queso'`, [rid, almacen]);

    // --- Promoción y evento de ejemplo ---
    const bebidas = platos.filter((p) => p.d.cat === 'Bebidas').map((p) => p.id);
    await c.query(`INSERT INTO promotions (restaurant_id, name, scope, discount_pct, valid_from, valid_to, weekdays, start_time, end_time, item_ids) VALUES ($1,'Happy hour de bebidas','hora',20, (($2::date)::timestamp AT TIME ZONE $4), ((($3::date + 1))::timestamp AT TIME ZONE $4) - interval '1 second','{1,2,3,4,5}'::smallint[],'17:00','19:00',$5::uuid[])`, [rid, hoy, fecha(hoy, 60), rest.timezone, `{${bebidas.join(',')}}`]);
    const ev = (await c.query(`INSERT INTO events (restaurant_id, name, kind, client_name, client_phone, guests, starts_at, ends_at, price_total, notes) VALUES ($1,'Cumpleaños de Doña Rosa (ejemplo)','privado','Familia Mamani','70012345',40, $2::timestamptz, $3::timestamptz, 2600, 'Evento de ejemplo para ver la cotización') RETURNING id`, [rid, iso(fecha(hoy, 14), 19, 0), iso(fecha(hoy, 14), 23, 0)])).rows[0].id as string;
    for (const [n, porc] of [['Pique macho', 20], ['Milanesa de pollo', 15], ['Ensalada mixta', 40], ['Refresco', 40]] as const) await c.query(`INSERT INTO event_menu (restaurant_id, event_id, menu_item_id, portions) VALUES ($1,$2,$3,$4)`, [rid, ev, platos.find((p) => p.d.n === n)!.id, porc]);

    await c.query('COMMIT');
    console.log(`Datos de ejemplo cargados en «${slug}»: ${PLATOS.length} platos con receta, ${INGREDIENTES.length} insumos, ${totalPedidos} pedidos de los últimos ${DIAS} días (Bs ${r2(totalVentas)}), ${numero} asientos, 1 promoción y 1 evento.`);
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); await pool.end(); }
}
main().catch((e) => { console.error(e.message); process.exit(1); });
