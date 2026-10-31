import { SUB_PRUEBA_KYROS_MESERO, SUB_PRUEBA_KYROS_COCINA, SUB_PRUEBA_KYROS_CONTADOR, SUB_PRUEBA_KYROS_COBRANZAS, SUB_PRUEBA_KYROS_ALMACEN, SUB_PRUEBA_KYROS_AREA } from '../src/demo/constantes';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SUB_PRUEBA_KYROS, SUB_PRUEBA_KYROS_ASISTENTE, SUB_PRUEBA_KYROS_TUTOR, esSubDeDemostracion } from '../src/demo/constantes';
import { vaciarSucursal } from '../src/demo/limpiar';
import { levantar } from './util';

let t: Awaited<ReturnType<typeof levantar>>;
let plat: Awaited<ReturnType<Awaited<ReturnType<typeof levantar>>['nuevaPlataforma']>>;
beforeAll(async () => { t = await levantar(); plat = await t.nuevaPlataforma(); await plat.del('/plataforma/demo'); });
afterAll(async () => { await plat.del('/plataforma/demo'); await t.cerrar(); });

const entrar = (sub: string) => t.api().post('/api/v1/auth/kyros-id/sesion').send({ accessToken: t.firmar({ sub }) });
const cargar = async (dias = 14) => { await plat.del('/plataforma/demo'); const r = await plat.post('/plataforma/demo', { dias }); expect(r.status).toBe(200); return r.body as { sucursal: { id: string; slug: string }; pedidos: number }; };
async function sesionDe(sub: string) {
  const r = await entrar(sub); expect(r.status).toBe(200); expect(r.body.estado).toBe('sesion');
  const token = r.body.sesion.accessToken as string; const rid = r.body.sesion.sucursales[0].id as string;
  return { token, rid, roles: r.body.sesion.sucursales[0].roles as string[], api: t.con(token, rid), sesion: r.body.sesion };
}
const cuenta = async (tabla: string, rid: string) => Number((await t.owner.query(`SELECT count(*)::int AS n FROM ${tabla} WHERE restaurant_id = $1`, [rid])).rows[0].n);

describe('Cuentas de demostración Prueba_Kyros', { timeout: 120_000 }, () => {
  it('sin demostración cargada, las tres cuentas dan 401 (como un token inválido); el resto de identidades sigue su flujo normal', async () => {
    await plat.del('/plataforma/demo');
    for (const sub of [SUB_PRUEBA_KYROS, SUB_PRUEBA_KYROS_ASISTENTE, SUB_PRUEBA_KYROS_TUTOR]) expect((await entrar(sub)).status).toBe(401);
    const otra = await entrar('6f1f0a2e-1111-4444-8888-000000000001');
    expect(otra.status).toBe(200); expect(otra.body.estado).toBe('sin_vinculo');                  // una persona cualquiera sí puede registrarse
    expect(esSubDeDemostracion(SUB_PRUEBA_KYROS)).toBe(true); expect(esSubDeDemostracion('otro')).toBe(false);
    expect((await plat.get('/plataforma/demo')).body).toMatchObject({ cargada: false });
  });

  it('al cargarla quedan la sucursal «Casa Andina» y las cuentas pre-vinculadas: administrador y caja; el tutor sigue sin entrar', async () => {
    const d = await cargar(); expect(d.pedidos).toBeGreaterThan(50);
    const est = (await plat.get('/plataforma/demo')).body;
    expect(est).toMatchObject({ cargada: true, sucursal: { nombre: 'Casa Andina' } });
    expect(est.cuentas.map((x: { usuario: string; rol: string; vinculada: boolean }) => [x.usuario, x.rol, x.vinculada])).toEqual([['prueba_kyros', 'owner', true], ['prueba_kyros_asistente', 'cajero', true], ['prueba_kyros_gestro_mesero', 'mesero', true], ['prueba_kyros_gestro_cocina', 'cocina', true], ['prueba_kyros_gestro_almacen', 'almacen', true], ['prueba_kyros_gestro_cobranzas', 'cobranzas', true], ['prueba_kyros_gestro_contador', 'contador', true], ['prueba_kyros_gestro_area', 'area_manager', true]]);
    const admin = await sesionDe(SUB_PRUEBA_KYROS);
    expect(admin.sesion.usuario.nombre).toBe('Prueba Kyros'); expect(admin.roles).toEqual(['owner']);
    expect((await sesionDe(SUB_PRUEBA_KYROS_ASISTENTE)).roles).toEqual(['cajero']);
    expect((await entrar(SUB_PRUEBA_KYROS_TUTOR)).status).toBe(401);
    expect((await plat.post('/plataforma/demo', {})).status).toBe(409);                              // una sola demostración
    expect((await t.con((await t.nuevoRestaurante()).token, '00000000-0000-0000-0000-000000000000').get('/plataforma/demo')).status).toBeGreaterThanOrEqual(400);
  });

  it('cobertura: reservas, cuentas por cobrar y pagar, compras, turnos, salón en vivo, suscripción y cuentas por rol (con su 403 sin permiso)', async () => {
    const d = await cargar(); const rid = d.sucursal.id;
    const n = async (sentencia: string) => Number((await t.owner.query(sentencia, [rid])).rows[0].n);
    expect(await n(`SELECT count(DISTINCT state)::int n FROM reservations WHERE restaurant_id = $1`)).toBeGreaterThanOrEqual(4);
    expect(await n(`SELECT count(*)::int n FROM payables_receivables WHERE restaurant_id = $1 AND direction = 'por_cobrar'`)).toBeGreaterThan(0);
    expect(await n(`SELECT count(*)::int n FROM payables_receivables WHERE restaurant_id = $1 AND direction = 'por_pagar'`)).toBe(1);
    expect(await n(`SELECT count(DISTINCT status)::int n FROM purchase_orders WHERE restaurant_id = $1`)).toBe(3);
    expect(await n(`SELECT count(*)::int n FROM shifts WHERE restaurant_id = $1`)).toBeGreaterThan(30);
    expect(await n(`SELECT count(*)::int n FROM orders WHERE restaurant_id = $1 AND status NOT IN ('cobrado','anulado')`)).toBe(4);
    expect(await n(`SELECT count(*)::int n FROM service_requests WHERE restaurant_id = $1 AND status = 'pendiente'`)).toBe(2);
    expect(await n(`SELECT count(*)::int n FROM restaurants r JOIN plans p ON p.id = r.plan_id WHERE r.id = $1`)).toBe(1);
    expect(await n(`SELECT count(*)::int n FROM subscription_payments WHERE restaurant_id = $1 AND status = 'validado'`)).toBe(1);
    // Todos los asientos cuadran (también los de crédito y cobro de cuentas por cobrar).
    expect(await n(`SELECT count(*)::int n FROM (SELECT entry_id FROM journal_lines WHERE restaurant_id = $1 GROUP BY entry_id HAVING sum(debit) <> sum(credit)) x`)).toBe(0);
    // Cada rol ve lo suyo y recibe 403 en lo que no le toca.
    const mesero = await sesionDe(SUB_PRUEBA_KYROS_MESERO); expect(mesero.roles).toEqual(['mesero']);
    expect((await mesero.api.get('/mesas')).status).toBe(200); expect((await mesero.api.get('/contabilidad/cuentas')).status).toBe(403);
    const cocina = await sesionDe(SUB_PRUEBA_KYROS_COCINA); expect(cocina.roles).toEqual(['cocina']); expect((await cocina.api.get('/contabilidad/cuentas')).status).toBe(403);
    const almacen = await sesionDe(SUB_PRUEBA_KYROS_ALMACEN); expect(almacen.roles).toEqual(['almacen']); expect((await almacen.api.get('/por-cobrar')).status).toBe(403);
    const cobranzas = await sesionDe(SUB_PRUEBA_KYROS_COBRANZAS); expect(cobranzas.roles).toEqual(['cobranzas']); expect((await cobranzas.api.get('/por-cobrar')).status).toBe(200);
    const contador = await sesionDe(SUB_PRUEBA_KYROS_CONTADOR); expect(contador.roles).toEqual(['contador']); expect((await contador.api.get('/contabilidad/cuentas')).status).toBe(200);
    expect((await cobranzas.api.get('/contabilidad/cuentas')).status).toBe(403);
    const area = await sesionDe(SUB_PRUEBA_KYROS_AREA); expect(area.roles).toEqual(['area_manager']); expect((await area.api.get('/contabilidad/cuentas')).status).toBe(403);
  });

  it('nada de lo que se ve dice «demo» o «ejemplo» y los datos están completos (menú, recetas, ventas, asientos)', async () => {
    const d = await cargar(); const a = await sesionDe(SUB_PRUEBA_KYROS);
    const textos = (await t.owner.query(`SELECT name AS t FROM restaurants WHERE id = $1 UNION ALL SELECT name FROM menu_items WHERE restaurant_id = $1 UNION ALL SELECT name FROM ingredients WHERE restaurant_id = $1
      UNION ALL SELECT memo FROM journal_entries WHERE restaurant_id = $1 UNION ALL SELECT name FROM events WHERE restaurant_id = $1 UNION ALL SELECT COALESCE(notes, '') FROM events WHERE restaurant_id = $1
      UNION ALL SELECT COALESCE(reason, '') FROM stock_movements WHERE restaurant_id = $1 UNION ALL SELECT name FROM promotions WHERE restaurant_id = $1 UNION ALL SELECT slug::text FROM restaurants WHERE id = $1`, [d.sucursal.id])).rows.map((r) => String(r.t));
    expect(textos.length).toBeGreaterThan(100);
    expect(textos.filter((x) => /demo|ejemplo|muestra/i.test(x))).toEqual([]);
    expect(await cuenta('menu_items', d.sucursal.id)).toBe(15); expect(await cuenta('recipes', d.sucursal.id)).toBe(15);
    const res = (await a.api.get(`/contabilidad/reportes/balance`)).body; expect(res.cuadra).toBe(true);
    expect((await a.api.get('/contabilidad/reportes/comprobacion')).body.cuadra).toBe(true);
    expect((await a.api.get('/estadisticas/resumen')).body.actual.pedidos).toBeGreaterThan(50);
    const stock = (await t.owner.query(`SELECT i.name, COALESCE(s.qty, 0)::float8 AS qty, i.min_stock::float8 AS min FROM ingredients i LEFT JOIN stock_levels s ON s.ingredient_id = i.id WHERE i.restaurant_id = $1`, [d.sucursal.id])).rows as { name: string; qty: number; min: number }[];
    expect(stock.filter((x) => x.qty < 0)).toEqual([]);                                                // nunca en negativo
    expect(stock.filter((x) => x.qty < x.min).map((x) => x.name)).toEqual(['Queso']);                  // una sola alerta de stock bajo
  });
});

describe('Solo lectura', { timeout: 120_000 }, () => {
  it('se puede mirar todo pero cualquier escritura devuelve 403; también las entradas públicas (QR y reservas)', async () => {
    const d = await cargar(); const a = await sesionDe(SUB_PRUEBA_KYROS); const c = await sesionDe(SUB_PRUEBA_KYROS_ASISTENTE);
    for (const ruta of ['/menu/platos', '/mesas', '/inventario/insumos'.replace('inventario/', ''), '/estadisticas/resumen', '/alertas', '/eventos', '/promociones']) expect((await a.api.get(ruta)).status).toBe(200);
    expect((await a.api.post('/menu/platos', { nombre: 'Plato nuevo', precio: 10 })).status).toBe(403);
    expect((await a.api.post('/pedidos', { tipo: 'mostrador' })).status).toBe(403);
    expect((await a.api.post('/personal', { nombre: 'Persona X', correo: 'x@t.bo', roles: ['mesero'] })).status).toBe(403);
    expect((await a.api.patch('/sucursal', { nombre: 'Otro nombre' })).status).toBe(403);
    expect((await c.api.post('/caja/abrir', { montoInicial: 0 })).status).toBe(403);
    expect((await a.api.post('/suscripcion/pagos', {})).status).toBe(403);                              // ni siquiera la ruta de pagos, que se salta el control de suscripción
    const antes = await cuenta('menu_items', d.sucursal.id); expect(antes).toBe(15);
    const reservasAntes = await cuenta('reservations', d.sucursal.id); const llamadosAntes = await cuenta('service_requests', d.sucursal.id);
    const pub = await t.api().post(`/api/v1/public/${d.sucursal.slug}/reservas`).send({ cliente: 'Ana Mamani', telefono: '70011122', personas: 2, fecha: '2030-01-01', hora: '12:00' });
    expect([403, 404]).toContain(pub.status);                                                           // reservas apagadas (404) o bloqueadas (403): nunca se crean
    expect(await cuenta('reservations', d.sucursal.id)).toBe(reservasAntes);
    const qr = (await t.owner.query('SELECT qr_token FROM restaurant_tables WHERE restaurant_id = $1 LIMIT 1', [d.sucursal.id])).rows[0].qr_token as string;
    const ses = await t.api().post('/api/v1/qr/sesion').send({ qrToken: qr });
    if (ses.status === 200) {
      const llamado = await t.api().post('/api/v1/qr/solicitudes').set('Authorization', `Bearer ${ses.body.token}`).send({ tipo: 'atencion' });
      expect(llamado.status).toBe(403);
      const pedido = await t.api().post('/api/v1/qr/pedidos').set('Authorization', `Bearer ${ses.body.token}`).send({ items: [{ platoId: (await t.owner.query('SELECT id FROM menu_items WHERE restaurant_id = $1 LIMIT 1', [d.sucursal.id])).rows[0].id, cantidad: 1 }] });
      expect(pedido.status).toBe(403);
    }
    expect(await cuenta('service_requests', d.sucursal.id)).toBe(llamadosAntes);
  });

  it('una sucursal normal no se ve afectada: sus dueños escriben con libertad y no pueden usar el reinicio', async () => {
    const r = await t.nuevoRestaurante(); const dueno = t.con(r.token, r.rid);
    expect((await dueno.post('/menu/platos', { nombre: 'Pique', precio: 50 })).status).toBe(201);
    expect((await dueno.post('/demo/restablecer')).status).toBe(403);
    expect((await dueno.get('/sucursal')).body.demo).toBe(false);
  });
});

describe('Restablecer mis datos de muestra', { timeout: 120_000 }, () => {
  it('borra y recarga solo la demostración: lo agregado desaparece y los datos vuelven; queda auditado; ni una pasada de 5 min ni otros roles', async () => {
    const d = await cargar(); const a = await sesionDe(SUB_PRUEBA_KYROS); const c = await sesionDe(SUB_PRUEBA_KYROS_ASISTENTE);
    expect((await a.api.get('/sucursal')).body).toMatchObject({ demo: true, nombre: 'Casa Andina' });
    const otra = await t.nuevoRestaurante(); await t.con(otra.token, otra.rid).post('/menu/platos', { nombre: 'Plato ajeno', precio: 20 });
    const pedidosAntes = await cuenta('orders', d.sucursal.id);
    await t.owner.query(`INSERT INTO menu_items (restaurant_id, name, price) VALUES ($1, 'Plato intruso', 10)`, [d.sucursal.id]);
    await t.owner.query(`INSERT INTO journal_entries (restaurant_id, entry_date, number, memo, posted) VALUES ($1, current_date, 999999, 'Asiento intruso', false)`, [d.sucursal.id]);
    expect((await c.api.post('/demo/restablecer')).status).toBe(403);                                   // la caja no puede
    const r = await a.api.post('/demo/restablecer');
    expect(r.status).toBe(200); expect(r.body.pedidos).toBe(pedidosAntes);                              // misma historia: datos reproducibles
    expect(Number((await t.owner.query(`SELECT count(*)::int AS n FROM menu_items WHERE restaurant_id = $1 AND name = 'Plato intruso'`, [d.sucursal.id])).rows[0].n)).toBe(0);
    expect(Number((await t.owner.query(`SELECT count(*)::int AS n FROM journal_entries WHERE restaurant_id = $1 AND memo = 'Asiento intruso'`, [d.sucursal.id])).rows[0].n)).toBe(0);
    expect(await cuenta('menu_items', d.sucursal.id)).toBe(15); expect(await cuenta('orders', d.sucursal.id)).toBe(pedidosAntes);
    expect(Number((await t.owner.query(`SELECT count(*)::int AS n FROM menu_items WHERE name = 'Plato ajeno'`)).rows[0].n)).toBeGreaterThanOrEqual(1);   // otra sucursal intacta
    const aud = (await t.owner.query(`SELECT action, user_id FROM audit_log WHERE restaurant_id = $1 AND action = 'demo.restablecida'`, [d.sucursal.id])).rows;
    expect(aud).toHaveLength(1); expect(aud[0].user_id).toBe(a.sesion.usuario.id);
    expect((await a.api.get('/contabilidad/reportes/balance')).body.cuadra).toBe(true);                // la contabilidad recargada cuadra
    const seguido = await a.api.post('/demo/restablecer');
    expect(seguido.status).toBe(429); expect(seguido.body.message).toMatch(/máximo una vez cada 5 minutos/);
    await t.owner.query(`UPDATE restaurants SET demo_reset_at = now() - interval '6 minutes' WHERE id = $1`, [d.sucursal.id]);
    expect((await a.api.post('/demo/restablecer')).status).toBe(200);                                   // pasado el tiempo, se puede otra vez
    expect((await a.api.get('/auth/yo')).status).toBe(200);                                             // la sesión y los vínculos sobreviven al reinicio
    expect((await entrar(SUB_PRUEBA_KYROS)).status).toBe(200);
  });

  it('botón de plataforma: exige la frase exacta, solo plataforma, restaura datos y cuentas, audita y no tiene límite de 5 min', async () => {
    const d = await cargar(); const pedidosAntes = await cuenta('orders', d.sucursal.id);
    const dueno = await sesionDe(SUB_PRUEBA_KYROS);
    expect((await dueno.api.post('/plataforma/demo/restablecer', { frase: 'RESTABLECER DEMO' })).status).toBe(403);   // el dueño de la demo no es plataforma
    for (const mala of [{}, { frase: 'restablecer demo' }, { frase: 'RESTABLECER DEMO', otra: 1 }]) expect((await plat.post('/plataforma/demo/restablecer', mala)).status).toBe(400);
    await t.owner.query(`INSERT INTO menu_items (restaurant_id, name, price) VALUES ($1, 'Plato intruso', 10)`, [d.sucursal.id]);
    await t.owner.query(`DELETE FROM kyros_links WHERE sub = $1`, [SUB_PRUEBA_KYROS_MESERO]);                         // cuenta faltante: debe volver
    const r1 = await plat.post('/plataforma/demo/restablecer', { frase: 'RESTABLECER DEMO' });
    expect(r1.status).toBe(200); expect(r1.body.pedidos).toBe(pedidosAntes);
    expect((await plat.post('/plataforma/demo/restablecer', { frase: 'RESTABLECER DEMO' })).status).toBe(200);        // sin límite de 5 min
    expect(Number((await t.owner.query(`SELECT count(*)::int AS n FROM menu_items WHERE restaurant_id = $1 AND name = 'Plato intruso'`, [d.sucursal.id])).rows[0].n)).toBe(0);
    expect((await entrar(SUB_PRUEBA_KYROS_MESERO)).status).toBe(200);
    expect(Number((await t.owner.query(`SELECT count(*)::int n FROM audit_log WHERE restaurant_id = $1 AND action = 'demo.restablecida_por_plataforma'`, [d.sucursal.id])).rows[0].n)).toBe(2);
  });
});

describe('Quitar la demostración y Portal', { timeout: 120_000 }, () => {
  it('el Portal ve a Prueba_Kyros mientras la demostración está cargada y recibe 401 cuando se quita; quitarla borra todo rastro', async () => {
    const d = await cargar();
    const tokenPortal = (sub: string) => t.firmar({ sub, azp: 'portal-web', aud: ['gestro-portal'] });
    const resumen = (sub: string) => t.api().get('/api/v1/portal/summary').set('Authorization', `Bearer ${tokenPortal(sub)}`);
    const ok = await resumen(SUB_PRUEBA_KYROS);
    expect(ok.status).toBe(200); expect(ok.body).toMatchObject({ vinculado: true, nombreMostrado: 'Prueba Kyros' });
    expect((await resumen(SUB_PRUEBA_KYROS_TUTOR)).status).toBe(401);
    expect((await resumen('6f1f0a2e-2222-4444-8888-000000000002')).body).toMatchObject({ vinculado: false });   // persona normal sin cuenta: no es error
    expect((await plat.del('/plataforma/demo')).status).toBe(200);
    expect((await resumen(SUB_PRUEBA_KYROS)).status).toBe(401);
    expect((await entrar(SUB_PRUEBA_KYROS)).status).toBe(401);
    for (const tabla of ['restaurants', 'orders', 'menu_items', 'journal_entries', 'user_roles', 'staff_members']) expect(await cuenta(tabla, d.sucursal.id).catch(() => 0)).toBe(0);
    expect(Number((await t.owner.query(`SELECT count(*)::int AS n FROM users WHERE email LIKE '%@demo.kyros.invalid'`)).rows[0].n)).toBe(0);
    expect(Number((await t.owner.query(`SELECT count(*)::int AS n FROM kyros_links WHERE sub = $1`, [SUB_PRUEBA_KYROS])).rows[0].n)).toBe(0);
    expect((await plat.del('/plataforma/demo')).status).toBe(404);                                       // ya no hay nada que quitar
    expect((await plat.post('/plataforma/demo', { dias: 7 })).status).toBe(200);                           // y se puede cargar de nuevo
  });

  it('la consola de plataforma es solo para plataforma y valida los días', async () => {
    const r = await t.nuevoRestaurante(); const dueno = t.con(r.token, r.rid);
    expect((await dueno.post('/plataforma/demo', {})).status).toBe(403);
    expect((await dueno.del('/plataforma/demo')).status).toBe(403);
    await plat.del('/plataforma/demo');
    expect((await plat.post('/plataforma/demo', { dias: 3 })).status).toBe(400);
    expect((await plat.post('/plataforma/demo', { dias: 500 })).status).toBe(400);
    expect((await plat.post('/plataforma/demo', { dias: 10, otra: 1 })).status).toBe(400);
  });
});

describe('Vaciar una sucursal (función interna)', () => {
  it('respeta lo que se conserva y no toca otras sucursales', async () => {
    const a = await t.nuevoRestaurante(); const b = await t.nuevoRestaurante();
    await t.con(a.token, a.rid).post('/menu/platos', { nombre: 'Pique A', precio: 10 }); await t.con(b.token, b.rid).post('/menu/platos', { nombre: 'Pique B', precio: 10 });
    const pool = new Pool({ connectionString: process.env.BASE_DE_DATOS, max: 1 }); const c = await pool.connect();
    try { await c.query('BEGIN'); await vaciarSucursal(c, a.rid, ['user_roles', 'staff_members', 'audit_log']); await c.query('COMMIT'); } finally { c.release(); await pool.end(); }
    expect(await cuenta('menu_items', a.rid)).toBe(0); expect(await cuenta('menu_items', b.rid)).toBe(1);
    expect(await cuenta('user_roles', a.rid)).toBeGreaterThan(0);
  });
});
