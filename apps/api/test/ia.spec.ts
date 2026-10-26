import { randomUUID } from 'node:crypto';
import { createServer, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { numerosDe, validarPuntos } from '../src/ia/foda.service';
import { levantar } from './util';

let t: Awaited<ReturnType<typeof levantar>>;
let plat: Awaited<ReturnType<Awaited<ReturnType<typeof levantar>>['nuevaPlataforma']>>;
let falso: Server; let urlFalsa = '';
interface Llamada { headers: Record<string, string | string[] | undefined>; body: { model: string; max_tokens: number; system: string; messages: { role: string; content: unknown }[]; tools?: { name: string }[] } }
const llamadas: Llamada[] = [];
type Paso = { status?: number; json?: unknown };
let guion: Paso[] = [];
const texto = (s: string, usage = { input_tokens: 1000, output_tokens: 500 }): Paso => ({ json: { content: [{ type: 'text', text: s }], stop_reason: 'end_turn', usage } });
const herramienta = (name: string, input: object, usage = { input_tokens: 800, output_tokens: 100 }): Paso => ({ json: { content: [{ type: 'tool_use', id: `tu_${randomUUID().slice(0, 8)}`, name, input }], stop_reason: 'tool_use', usage } });

beforeAll(async () => {
  t = await levantar(); plat = await t.nuevaPlataforma();
  falso = createServer((req, res) => {
    let cuerpo = ''; req.on('data', (c) => { cuerpo += c; });
    req.on('end', () => {
      llamadas.push({ headers: req.headers, body: JSON.parse(cuerpo || '{}') });
      const paso = guion.shift() ?? { status: 500, json: { error: 'sin guion' } };
      res.statusCode = paso.status ?? 200; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(paso.json ?? {}));
    });
  });
  await new Promise<void>((ok) => falso.listen(0, '127.0.0.1', ok));
  urlFalsa = `http://127.0.0.1:${(falso.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await plat.del('/plataforma/ia/clave');
  await plat.put('/plataforma/ia', { baseUrl: 'https://api.anthropic.com', precios: {}, limiteMensualUsd: null, limiteDiarioPorSucursal: 200, activa: true });
  await t.cerrar(); falso.close();
});

const CLAVE = 'sk-ant-api03-PRUEBA-1234567890abcdefWXYZ';
const configurar = async (extra: object = {}) => expect((await plat.put('/plataforma/ia', { apiKey: CLAVE, baseUrl: urlFalsa, activa: true, ...extra })).status).toBe(200);
const sinClave = async () => { await plat.del('/plataforma/ia/clave'); };

const PERIODO = () => ({ desde: laPaz(-27), hasta: laPaz(0) });   // 28 días exactos: lo vendido en 28 días contra los 28 anteriores
const laPaz = (dias: number) => new Date(Date.now() - 4 * 3_600_000 + dias * 86_400_000).toISOString().slice(0, 10);
async function base() {
  const d = await t.nuevoRestaurante();
  const dueno = t.con(d.token, d.rid);
  const alta = async (rol: string) => { const a = await dueno.post('/personal', { nombre: `Persona ${rol}`, correo: `${randomUUID()}@t.bo`, roles: [rol] }); const s = await t.entrarConCodigo(a.body.codigo); return t.con(s.token, d.rid); };
  const [mesero, contador] = [await alta('mesero'), await alta('contador')];
  const plato = (await dueno.post('/menu/platos', { nombre: 'Pique Macho', precio: 100 })).body.id as string;
  return { d, dueno, mesero, contador, plato };
}
type B = Awaited<ReturnType<typeof base>>;
async function venta(b: B, dia: number, monto: number) {
  const ts = `${laPaz(dia)}T13:00:00-04:00`;
  const o = (await t.owner.query(`INSERT INTO orders (restaurant_id, channel, order_type, status, subtotal, total, opened_at, sent_at, closed_at) VALUES ($1,'caja','mostrador','cobrado',$2,$2,$3::timestamptz,$3::timestamptz,$3::timestamptz) RETURNING id`, [b.d.rid, monto.toFixed(2), ts])).rows[0].id as string;
  await t.owner.query(`INSERT INTO order_items (restaurant_id, order_id, menu_item_id, qty, unit_price, status, sent_at, ready_at) VALUES ($1,$2,$3,1,$4,'servido',$5::timestamptz,$5::timestamptz + interval '10 minutes')`, [b.d.rid, o, b.plato, monto, ts]);
  await t.owner.query(`INSERT INTO sales_payments (restaurant_id, order_id, method, amount, document, paid_at) VALUES ($1,$2,'efectivo',$3,'ninguno',$4::timestamptz)`, [b.d.rid, o, monto.toFixed(2), ts]);
}
/** 28 días de ventas de Bs 100 y los 28 anteriores de Bs 50 (ventas +100 %), con mucha merma. */
async function conHistoria(b: B) {
  for (let d = 0; d < 28; d++) { await venta(b, -d, 100); await venta(b, -28 - d, 50); }
  const carne = (await b.dueno.post('/insumos', { nombre: 'Carne', unidad: 'kg' })).body.id as string; const bod = (await b.dueno.post('/almacenes', { nombre: 'Cocina' })).body.id as string;
  await b.dueno.post('/stock/movimientos', { tipo: 'compra', almacenId: bod, insumoId: carne, cantidad: 50, costoUnitario: 60 });
  await b.dueno.post('/stock/movimientos', { tipo: 'merma', almacenId: bod, insumoId: carne, cantidad: 10, motivo: 'se echó a perder' });   // Bs 600 de merma
}

describe('Validación del texto de la IA contra los números', () => {
  const ev = { variacion_ventas: { valor: '100.00', detalle: 'Ingresos Bs 2800.00 contra Bs 1400.00: 100.00 %.' }, merma: { valor: '21.43', detalle: 'Merma Bs 600.00 = 21.43 % de las ventas.' } };
  const periodo = { desde: '2026-10-01', hasta: '2026-10-28' };
  it('extrae cifras con coma o punto', () => { expect(numerosDe('Subió 12,5 % y bajó 3 pedidos, Bs 1.250')).toEqual([12.5, 3, 1.25]); });
  it('conserva lo respaldado y descarta cifras inventadas, métricas inexistentes, textos vacíos o larguísimos', () => {
    const r = validarPuntos({
      fortalezas: [{ texto: 'Las ventas crecieron 100 % (de Bs 1400 a Bs 2800).', metrica: 'variacion_ventas' }, { texto: 'Crecieron 250 %.', metrica: 'variacion_ventas' }, { texto: 'Sin cifras pero con métrica falsa.', metrica: 'inventada' }, { texto: '', metrica: 'merma' }, { texto: 'x'.repeat(500), metrica: 'merma' }],
      debilidades: [{ texto: 'La merma fue 21.43 % de las ventas (Bs 600).', metrica: 'merma' }], oportunidades: 'no es lista', amenazas: [{ texto: 'Sin números pero con métrica real.', metrica: 'merma' }, 5, null],
    }, ev, periodo);
    expect(r.validos.fortalezas.map((p) => p.metrica)).toEqual(['variacion_ventas']);
    expect(r.validos.debilidades).toHaveLength(1); expect(r.validos.oportunidades).toEqual([]); expect(r.validos.amenazas).toHaveLength(1);
    expect(r.descartados).toBe(6);
  });
  it('máximo 4 puntos por cuadrante y las fechas del período cuentan como cifras permitidas', () => {
    const muchos = Array.from({ length: 8 }, () => ({ texto: 'Ventas en 2026-10-28', metrica: 'merma' }));
    expect(validarPuntos({ fortalezas: muchos }, ev, periodo).validos.fortalezas).toHaveLength(4);
  });
  it('un resultado que no es un objeto devuelve todo vacío sin romper', () => {
    expect(validarPuntos(undefined, ev, periodo).validos).toEqual({ fortalezas: [], debilidades: [], oportunidades: [], amenazas: [] });
    expect(validarPuntos('texto', ev, periodo).descartados).toBe(0);
  });
});

describe('Consola de plataforma: clave cifrada', () => {
  it('nunca devuelve la clave, la guarda cifrada y solo la ve el equipo de plataforma', async () => {
    await sinClave();
    expect((await plat.get('/plataforma/ia')).body).toMatchObject({ configurada: false, ultimosCaracteres: null, activa: true, baseUrl: 'https://api.anthropic.com', modelos: { foda: 'claude-sonnet-5-5', asistente: 'claude-sonnet-5-5', rapido: 'claude-haiku-5-5' } });
    const r = await plat.put('/plataforma/ia', { apiKey: CLAVE, baseUrl: urlFalsa });
    expect(r.status).toBe(200); expect(r.body).toMatchObject({ configurada: true, ultimosCaracteres: 'WXYZ' });
    expect(JSON.stringify(r.body)).not.toContain(CLAVE); expect(JSON.stringify((await plat.get('/plataforma/ia')).body)).not.toContain('PRUEBA');
    const fila = (await t.owner.query(`SELECT valor_cifrado FROM app_config WHERE clave = 'ia'`)).rows[0].valor_cifrado as string;
    expect(fila).not.toContain('sk-ant'); expect(fila).not.toContain('PRUEBA');
    const b = await base();
    expect((await b.dueno.get('/plataforma/ia')).status).toBe(403);
    expect((await b.dueno.put('/plataforma/ia', { apiKey: CLAVE })).status).toBe(403);
  });

  it('valida la clave, la dirección y los precios; los cambios parciales conservan la clave', async () => {
    await configurar();
    expect((await plat.put('/plataforma/ia', { apiKey: 'corta' })).status).toBe(400);
    expect((await plat.put('/plataforma/ia', { apiKey: 'tiene espacios en la clave de prueba' })).status).toBe(400);
    expect((await plat.put('/plataforma/ia', { baseUrl: 'http://malicioso.example.com' })).status).toBe(400);
    expect((await plat.put('/plataforma/ia', { baseUrl: 'ftp://x' })).status).toBe(400);
    expect((await plat.put('/plataforma/ia', { precios: { 'claude-sonnet-5-5': { entrada: -1, salida: 1 } } })).status).toBe(400);
    expect((await plat.put('/plataforma/ia', { clave: 'x' })).status).toBe(400);                               // .strict()
    const r = await plat.put('/plataforma/ia', { modelos: { foda: 'claude-opus-5-5' }, limiteMensualUsd: 50 });
    expect(r.body).toMatchObject({ configurada: true, ultimosCaracteres: 'WXYZ', modelos: { foda: 'claude-opus-5-5', asistente: 'claude-sonnet-5-5' }, limiteMensualUsd: 50 });
    await plat.put('/plataforma/ia', { modelos: { foda: 'claude-sonnet-5-5' }, limiteMensualUsd: null });
    expect((await plat.del('/plataforma/ia/clave')).body).toMatchObject({ configurada: false });
  });

  it('probar hace una llamada mínima con la clave, la versión de la API y el modelo rápido', async () => {
    await configurar(); llamadas.length = 0; guion = [texto('listo')];
    const r = await plat.post('/plataforma/ia/probar');
    expect(r.status).toBe(200); expect(r.body).toMatchObject({ ok: true, modelo: 'claude-haiku-5-5', respuesta: 'listo' });
    expect(llamadas[0].headers['x-api-key']).toBe(CLAVE); expect(llamadas[0].headers['anthropic-version']).toBe('2023-06-01');
    expect(llamadas[0].body).toMatchObject({ model: 'claude-haiku-5-5', max_tokens: 16 });
    guion = [{ status: 401, json: { error: { type: 'authentication_error' } } }];
    const mala = await plat.post('/plataforma/ia/probar');
    expect(mala.status).toBe(503); expect(mala.body.message).toMatch(/rechazó la clave/);
  });
});

describe('Sin clave configurada', () => {
  it('el asistente avisa con claridad (503) y el FODA sigue funcionando con reglas', async () => {
    await sinClave();
    const b = await base(); await conHistoria(b);
    const a = await b.dueno.post('/asistente/preguntar', { pregunta: '¿Cómo me fue este mes?' });
    expect(a.status).toBe(503); expect(a.body.message).toMatch(/La IA no está configurada/);
    expect((await b.dueno.get('/asistente/estado')).body).toMatchObject({ disponible: false });
    const f = await b.dueno.post('/reportes/foda/generar', {});
    expect(f.status).toBe(200); expect(f.body.modelo).toBe('reglas'); expect(f.body.suficiente).toBe(true);
    expect(f.body.fortalezas.length + f.body.debilidades.length).toBeGreaterThan(0);
  });
});

describe('FODA', () => {
  it('con pocos datos lo declara en el informe y no inventa nada', async () => {
    await sinClave(); const b = await base();
    for (let d = 0; d < 3; d++) await venta(b, -d, 100);
    const f = (await b.dueno.post('/reportes/foda/generar', {})).body;
    expect(f).toMatchObject({ suficiente: false, modelo: 'reglas', fortalezas: [], debilidades: [], oportunidades: [], amenazas: [] });
    expect(f.motivo).toMatch(/Datos insuficientes: hay 3 pedido\(s\)/);
    const lista = (await b.dueno.get('/reportes/foda')).body; expect(lista).toHaveLength(1);
    expect((await b.dueno.get(`/reportes/foda/${f.id}`)).body).toMatchObject({ suficiente: false, motivo: expect.stringMatching(/insuficientes/) });
  });

  it('con datos, cada punto cita una métrica de la evidencia y todas sus cifras salen de ella', async () => {
    await sinClave(); const b = await base(); await conHistoria(b);
    const f = (await b.dueno.post('/reportes/foda/generar', PERIODO())).body;
    expect(f.fortalezas.map((p: { metrica: string }) => p.metrica)).toContain('variacion_ventas');
    expect(f.fortalezas.find((p: { metrica: string }) => p.metrica === 'variacion_ventas').texto).toMatch(/crecieron 100\.00 %/);
    expect(f.debilidades.map((p: { metrica: string }) => p.metrica)).toEqual(expect.arrayContaining(['merma', 'dependencia']));
    const { validos, descartados } = validarPuntos({ fortalezas: f.fortalezas, debilidades: f.debilidades, oportunidades: f.oportunidades, amenazas: f.amenazas }, f.evidencia, { desde: f.desde, hasta: f.hasta });
    expect(descartados).toBe(0);
    expect(validos.fortalezas.length + validos.debilidades.length + validos.oportunidades.length + validos.amenazas.length).toBe(f.fortalezas.length + f.debilidades.length + f.oportunidades.length + f.amenazas.length);
    expect(f.evidencia.variacion_ventas.detalle).toMatch(/Bs 2800\.00 contra Bs 1400\.00/);
  });

  it('con IA: Claude redacta con solo los agregados, y lo que no cuadra con los números se descarta antes de publicar', async () => {
    await configurar(); const b = await base(); await conHistoria(b); llamadas.length = 0;
    guion = [texto('Aquí está: ' + JSON.stringify({
      fortalezas: [{ texto: 'Las ventas se duplicaron: crecieron 100.00 % (de Bs 1400.00 a Bs 2800.00).', metrica: 'variacion_ventas' }, { texto: 'Crecieron 250 % gracias a la campaña.', metrica: 'variacion_ventas' }],
      debilidades: [{ texto: 'La merma pesa 21.43 % de las ventas.', metrica: 'merma' }, { texto: 'Algo con métrica inventada.', metrica: 'no_existe' }], oportunidades: [], amenazas: [] }) + ' Espero que sirva.')];
    const f = (await b.dueno.post('/reportes/foda/generar', PERIODO())).body;
    expect(f.modelo).toBe('claude-sonnet-5-5'); expect(f.descartadosPorValidacion).toBe(2);
    expect(f.fortalezas).toHaveLength(1); expect(f.fortalezas[0].texto).toMatch(/se duplicaron/); expect(f.debilidades).toHaveLength(1);
    const q = llamadas[0];
    expect(q.body.model).toBe('claude-sonnet-5-5'); expect(q.body.system).toMatch(/SOLO las cifras/);
    const enviado = JSON.parse(q.body.messages[0].content as string);
    expect(Object.keys(enviado)).toEqual(['periodo', 'evidencia', 'puntos_base']);
    expect(enviado.evidencia.variacion_ventas.valor).toBe('100.00');
    expect(JSON.stringify(enviado)).not.toMatch(/@|telefono|correo/i);                                       // solo agregados, sin datos de personas
  });

  it('si la IA falla o contesta basura, se publican las reglas y se avisa que la IA no estuvo disponible', async () => {
    await configurar(); const b = await base(); await conHistoria(b);
    guion = [texto('no soy json')];
    const a = (await b.dueno.post('/reportes/foda/generar', PERIODO())).body;
    expect(a.modelo).toBe('reglas'); expect(a.iaNoDisponible).toMatch(/formato esperado/); expect(a.fortalezas.length + a.debilidades.length).toBeGreaterThan(0);
    guion = [texto(JSON.stringify({ fortalezas: [{ texto: 'Todo inventado 999 %', metrica: 'merma' }], debilidades: [], oportunidades: [], amenazas: [] }))];
    expect((await b.dueno.post('/reportes/foda/generar', PERIODO())).body.modelo).toBe('reglas');                   // nada pasó la validación
    guion = [{ status: 500 }, { status: 500 }, { status: 500 }]; llamadas.length = 0;
    const c = (await b.dueno.post('/reportes/foda/generar', PERIODO())).body;
    expect(c.modelo).toBe('reglas'); expect(c.iaNoDisponible).toMatch(/No pudimos comunicarnos/); expect(llamadas).toHaveLength(3);   // 1 intento + 2 reintentos
  });

  it('valida el período y los permisos; guarda historial por sucursal', async () => {
    await sinClave(); const b = await base(); const o = await base(); await conHistoria(b);
    expect((await b.dueno.post('/reportes/foda/generar', { desde: laPaz(0), hasta: laPaz(-5) })).status).toBe(400);
    expect((await b.dueno.post('/reportes/foda/generar', { desde: laPaz(-200), hasta: laPaz(0) })).status).toBe(400);
    expect((await b.dueno.post('/reportes/foda/generar', { desde: 'ayer' })).status).toBe(400);
    expect((await b.mesero.post('/reportes/foda/generar', {})).status).toBe(403);
    expect((await b.contador.post('/reportes/foda/generar', {})).status).toBe(403);
    expect((await b.contador.get('/reportes/foda')).status).toBe(200);
    const id = (await b.dueno.post('/reportes/foda/generar', {})).body.id as string;
    expect((await o.dueno.get(`/reportes/foda/${id}`)).status).toBe(404);
    expect((await o.dueno.get('/reportes/foda')).body).toHaveLength(0);
    expect((await b.dueno.get('/reportes/foda/' + randomUUID())).status).toBe(404);
  });
});

describe('Asistente de gestión', () => {
  it('consulta herramientas de solo lectura con los datos reales de la sucursal y responde con sus fuentes', async () => {
    await configurar({ precios: { 'claude-sonnet-5-5': { entrada: 3, salida: 15 } } });
    const b = await base(); for (let d = 0; d < 3; d++) await venta(b, -d, 100); llamadas.length = 0;
    guion = [herramienta('resumen_periodo', { desde: laPaz(-6), hasta: laPaz(0) }), texto('Vendiste Bs 300.00 en 3 pedidos.\n\nFuente: resumen_periodo (últimos 7 días)', { input_tokens: 2000, output_tokens: 400 })];
    const r = await b.dueno.post('/asistente/preguntar', { pregunta: '¿Cuánto vendí esta semana?' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ respuesta: expect.stringContaining('Bs 300.00'), modelo: 'claude-sonnet-5-5', tokens: 3300 });
    expect(r.body.fuentes).toEqual([{ herramienta: 'resumen_periodo', parametros: { desde: laPaz(-6), hasta: laPaz(0) } }]);
    expect(llamadas).toHaveLength(2);
    expect(llamadas[0].body.tools!.map((x) => x.name)).toEqual(['resumen_periodo', 'ventas_agrupadas', 'ingenieria_menu', 'estado_de_resultados', 'alertas_abiertas', 'stock_bajo', 'cuentas', 'proyeccion']);
    expect(llamadas[0].body.system).toMatch(/SOLO las herramientas de consulta/); expect(llamadas[0].body.system).toMatch(/No puedes modificar nada/);
    const resultado = (llamadas[1].body.messages[2].content as { type: string; content: string }[])[0];     // lo que Claude recibió de la herramienta
    expect(resultado.type).toBe('tool_result');
    expect(JSON.parse(resultado.content).actual).toMatchObject({ ingresos: '300.00', pedidos: 3 });
    const uso = (await b.dueno.get('/asistente/estado')).body.uso;
    expect(uso).toMatchObject({ llamadas: 2, errores: 0 });
    expect(Number(uso.costoUsd)).toBeCloseTo((800 * 3 + 100 * 15 + 2000 * 3 + 400 * 15) / 1_000_000, 4);       // costo con los precios cargados
    expect((await t.owner.query(`SELECT count(*)::int AS n FROM ai_jobs WHERE restaurant_id = $1 AND task = 'asistente'`, [b.d.rid])).rows[0].n).toBe(2);
  });

  it('una herramienta mal usada o inexistente no rompe: el error vuelve al modelo y la IA no puede escribir ni usar SQL', async () => {
    await configurar(); const b = await base(); llamadas.length = 0;
    guion = [herramienta('resumen_periodo', { desde: 'ayer', hasta: laPaz(0) }), herramienta('borrar_ventas', { todo: true }), herramienta('alertas_abiertas', {}), texto('No pude consultar todo, pero no hay alertas.')];
    const r = await b.dueno.post('/asistente/preguntar', { pregunta: 'Borra las ventas de ayer' });
    expect(r.status).toBe(200); expect(r.body.fuentes.map((f: { herramienta: string }) => f.herramienta)).toEqual(['resumen_periodo', 'borrar_ventas', 'alertas_abiertas']);
    const volvio = (i: number) => (llamadas[i].body.messages.at(-1)!.content as { content: string }[])[0].content;
    expect(JSON.parse(volvio(1)).error).toBeTruthy();                                                           // fechas inválidas
    expect(JSON.parse(volvio(2)).error).toMatch(/Herramienta desconocida: borrar_ventas/);
    expect(JSON.parse(volvio(3))).toEqual([]);                                                                  // alertas abiertas: ninguna
    expect(llamadas[0].body.tools!.some((x) => /borrar|sql|escrib/i.test(x.name))).toBe(false);
  });

  it('sin respuesta final en 6 vueltas devuelve 502; permisos, validación y aislamiento por sucursal', async () => {
    await configurar(); const b = await base(); const o = await base();
    guion = Array.from({ length: 6 }, () => herramienta('alertas_abiertas', {}));
    expect((await b.dueno.post('/asistente/preguntar', { pregunta: 'Dame todo en bucle' })).status).toBe(502);
    expect((await b.mesero.post('/asistente/preguntar', { pregunta: '¿Qué tal?' })).status).toBe(403);
    expect((await b.contador.post('/asistente/preguntar', { pregunta: 'ab' })).status).toBe(400);              // muy corta
    expect((await b.dueno.post('/asistente/preguntar', { pregunta: 'x'.repeat(501) })).status).toBe(400);
    expect((await b.dueno.post('/asistente/preguntar', { pregunta: 'Hola', rol: 'admin' })).status).toBe(400);  // .strict()
    for (let d = 0; d < 2; d++) await venta(o, -d, 70);                                                         // ventas de OTRA sucursal
    llamadas.length = 0; guion = [herramienta('resumen_periodo', { desde: laPaz(-6), hasta: laPaz(0) }), texto('Nada vendido.')];
    await b.dueno.post('/asistente/preguntar', { pregunta: '¿Cuánto vendí?' });
    expect(JSON.parse((llamadas[1].body.messages[2].content as { content: string }[])[0].content).actual).toMatchObject({ ingresos: '0.00', pedidos: 0 });   // RLS: no ve la otra
  });

  it('respeta el límite diario de consultas por sucursal (429) y el límite mensual de la plataforma', async () => {
    await configurar({ limiteDiarioPorSucursal: 2, precios: { 'claude-sonnet-5-5': { entrada: 3, salida: 15 } } });
    const b = await base();
    guion = [texto('uno'), texto('dos'), texto('tres')];
    expect((await b.dueno.post('/asistente/preguntar', { pregunta: 'Primera pregunta' })).status).toBe(200);
    expect((await b.dueno.post('/asistente/preguntar', { pregunta: 'Segunda pregunta' })).status).toBe(200);
    const tercera = await b.dueno.post('/asistente/preguntar', { pregunta: 'Tercera pregunta' });
    expect(tercera.status).toBe(429); expect(tercera.body.message).toMatch(/límite diario/);
    await configurar({ limiteDiarioPorSucursal: 1000, limiteMensualUsd: 0.0001 });                              // el gasto del mes ya lo superó
    const c = await b.dueno.post('/asistente/preguntar', { pregunta: 'Cuarta pregunta' });
    expect(c.status).toBe(429); expect(c.body.message).toMatch(/límite mensual/);
    await plat.put('/plataforma/ia', { limiteMensualUsd: null });
  });
});
