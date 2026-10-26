import { BadGatewayException, BadRequestException, HttpException, HttpStatus, Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { auditar } from '../comun/auditoria';
import { ConfiguracionService } from '../configuracion/configuracion.service';
import { BD, Bd, Tenant, TenantDb } from '../database/database.module';

/** Módulo de IA: aísla la clave de Claude (cifrada en la base), los modelos por tarea, los costos, los reintentos y el registro de uso. */
const CLAVE = 'ia';
export const MODELOS_POR_DEFECTO = { foda: 'claude-sonnet-5-5', asistente: 'claude-sonnet-5-5', rapido: 'claude-haiku-5-5' } as const;
export type Tarea = 'foda' | 'asistente' | 'prueba';
const URL_POR_DEFECTO = 'https://api.anthropic.com';
const LIMITE_DIARIO_POR_SUCURSAL = 200;
const TIEMPO_MAXIMO_MS = 60_000;
const REINTENTOS = 2;

export interface ConfigIa {
  apiKey?: string; baseUrl?: string; modelos?: Partial<Record<'foda' | 'asistente' | 'rapido', string>>;
  /** USD por millón de tokens, por modelo. Sin precio cargado, el costo queda sin calcular (no se inventa). */
  precios?: Record<string, { entrada: number; salida: number }>;
  limiteMensualUsd?: number | null; limiteDiarioPorSucursal?: number; activa?: boolean;
}

export const AjustesIa = z.object({
  apiKey: z.string().trim().min(20).max(300).regex(/^[\x21-\x7e]+$/, 'La clave no puede tener espacios ni caracteres raros').optional(),
  baseUrl: z.string().trim().url().max(200).refine((u) => /^https:\/\//.test(u) || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(u), 'Solo https (o http en localhost para pruebas)').optional(),
  modelos: z.object({ foda: z.string().trim().min(3).max(60).optional(), asistente: z.string().trim().min(3).max(60).optional(), rapido: z.string().trim().min(3).max(60).optional() }).strict().optional(),
  precios: z.record(z.string().min(3).max(60), z.object({ entrada: z.number().min(0).max(10_000), salida: z.number().min(0).max(10_000) }).strict()).optional(),
  limiteMensualUsd: z.number().min(0).max(1_000_000).nullable().optional(), limiteDiarioPorSucursal: z.number().int().min(1).max(100_000).optional(), activa: z.boolean().optional(),
}).strict();

export interface Bloque { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown>; tool_use_id?: string; content?: string }
export interface Mensaje { role: 'user' | 'assistant'; content: string | Bloque[] }
export interface Herramienta { name: string; description: string; input_schema: Record<string, unknown> }
export interface Respuesta { bloques: Bloque[]; parada: string; entrada: number; salida: number; modelo: string }

@Injectable()
export class IaService {
  private readonly log = new Logger('IA');
  constructor(@Inject(ConfiguracionService) private readonly cfg: ConfiguracionService, @Inject(TenantDb) private readonly db: TenantDb, @Inject(BD) private readonly bd: Bd) {}

  private async leer(): Promise<ConfigIa> { return (await this.cfg.leer<ConfigIa>(CLAVE)) ?? {}; }

  /* ---------------- consola de plataforma ---------------- */

  /** Estado sin exponer la clave: solo si hay una y sus últimos 4 caracteres. */
  async estado() {
    const c = await this.leer();
    const uso = (await this.bd.execute(sql`SELECT count(*)::int AS llamadas, COALESCE(SUM(input_tokens), 0)::int AS entrada, COALESCE(SUM(output_tokens), 0)::int AS salida, COALESCE(SUM(cost_usd), 0)::numeric(12,4)::text AS costo
      FROM ai_jobs WHERE created_at >= date_trunc('month', now()) AND status = 'ok'`)).rows[0] as { llamadas: number; entrada: number; salida: number; costo: string };
    return {
      configurada: !!c.apiKey, ultimosCaracteres: c.apiKey ? c.apiKey.slice(-4) : null, activa: c.activa !== false, baseUrl: c.baseUrl ?? URL_POR_DEFECTO,
      modelos: { ...MODELOS_POR_DEFECTO, ...(c.modelos ?? {}) }, precios: c.precios ?? {}, limiteMensualUsd: c.limiteMensualUsd ?? null, limiteDiarioPorSucursal: c.limiteDiarioPorSucursal ?? LIMITE_DIARIO_POR_SUCURSAL,
      usoDelMes: { llamadas: uso.llamadas, tokensEntrada: uso.entrada, tokensSalida: uso.salida, costoUsd: uso.costo },
    };
  }

  async guardar(por: string, d: z.infer<typeof AjustesIa>) {
    const c = await this.leer();
    const nuevo: ConfigIa = { ...c, ...(d.apiKey && { apiKey: d.apiKey }), ...(d.baseUrl && { baseUrl: d.baseUrl.replace(/\/+$/, '') }), ...(d.modelos && { modelos: { ...c.modelos, ...d.modelos } }),
      ...(d.precios && { precios: d.precios }), ...(d.limiteMensualUsd !== undefined && { limiteMensualUsd: d.limiteMensualUsd }), ...(d.limiteDiarioPorSucursal && { limiteDiarioPorSucursal: d.limiteDiarioPorSucursal }), ...(d.activa !== undefined && { activa: d.activa }) };
    await this.cfg.guardar(CLAVE, nuevo, por);
    return this.estado();
  }

  async quitarClave(por: string) { const c = await this.leer(); delete c.apiKey; await this.cfg.guardar(CLAVE, c, por); return this.estado(); }

  /** Una llamada mínima para comprobar la clave y la dirección (cuenta como uso de plataforma, sin sucursal). */
  async probar() {
    const r = await this.enviar('prueba', 'rapido', { sistema: 'Responde solo con la palabra: listo', mensajes: [{ role: 'user', content: 'ping' }], maxTokens: 16 });
    return { ok: true, modelo: r.modelo, respuesta: r.bloques.filter((b) => b.type === 'text').map((b) => b.text).join('').slice(0, 40) };
  }

  async disponible(): Promise<boolean> { const c = await this.leer(); return !!c.apiKey && c.activa !== false; }

  /* ---------------- llamadas a Claude ---------------- */

  private costo(c: ConfigIa, modelo: string, entrada: number, salida: number): string | null {
    const p = c.precios?.[modelo]; if (!p) return null;
    return ((entrada * p.entrada + salida * p.salida) / 1_000_000).toFixed(5);
  }

  private async registrar(t: Tenant | null, tarea: string, modelo: string, entrada: number | null, salida: number | null, costo: string | null, estado: string) {
    // Sin sucursal (prueba de la consola) no se registra en ai_jobs: la tabla es por sucursal.
    if (!t) return;
    await this.db.run(t, (tx) => tx.execute(sql`INSERT INTO ai_jobs (restaurant_id, task, model, input_tokens, output_tokens, cost_usd, status) VALUES (${t.restaurantId}, ${tarea}, ${modelo}, ${entrada}, ${salida}, ${costo}::numeric, ${estado})`));
  }

  /** Topes de gasto: por sucursal y por día, y el límite mensual de la plataforma (si tiene precios cargados). */
  private async verificarLimites(t: Tenant | null, c: ConfigIa) {
    if (t) {
      const dia = (await this.db.run(t, (tx) => tx.execute(sql`SELECT count(*)::int AS n FROM ai_jobs WHERE restaurant_id = ${t.restaurantId} AND created_at >= date_trunc('day', now() AT TIME ZONE 'America/La_Paz') AT TIME ZONE 'America/La_Paz'`))).rows[0] as { n: number };
      if (dia.n >= (c.limiteDiarioPorSucursal ?? LIMITE_DIARIO_POR_SUCURSAL)) throw new HttpException('Llegaste al límite diario de consultas de IA de esta sucursal. Se renueva mañana.', HttpStatus.TOO_MANY_REQUESTS);
    }
    if (c.limiteMensualUsd != null) {
      const m = (await this.bd.execute(sql`SELECT COALESCE(SUM(cost_usd), 0)::float8 AS c FROM ai_jobs WHERE created_at >= date_trunc('month', now())`)).rows[0] as { c: number };
      if (m.c >= c.limiteMensualUsd) throw new HttpException('Se alcanzó el límite mensual de gasto en IA de la plataforma.', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  /** Llama a la API de Mensajes de Claude con reintentos y tiempo máximo, y deja registro de tokens y costo. */
  async enviar(tarea: Tarea, modeloDe: 'foda' | 'asistente' | 'rapido', o: { sistema: string; mensajes: Mensaje[]; herramientas?: Herramienta[]; maxTokens?: number }, t: Tenant | null = null): Promise<Respuesta> {
    const c = await this.leer();
    if (!c.apiKey || c.activa === false) throw new ServiceUnavailableException('La IA no está configurada. Pídele al equipo de Kyros-Tech que cargue la clave de Claude en la consola de plataforma.');
    await this.verificarLimites(t, c);
    const modelo = c.modelos?.[modeloDe] ?? MODELOS_POR_DEFECTO[modeloDe];
    const url = `${(c.baseUrl ?? URL_POR_DEFECTO).replace(/\/+$/, '')}/v1/messages`;
    const cuerpo = JSON.stringify({ model: modelo, max_tokens: o.maxTokens ?? 1024, system: o.sistema, messages: o.mensajes, ...(o.herramientas?.length ? { tools: o.herramientas } : {}) });
    let ultimo = 'sin respuesta';
    for (let intento = 0; intento <= REINTENTOS; intento++) {
      const ctl = new AbortController(); const reloj = setTimeout(() => ctl.abort(), TIEMPO_MAXIMO_MS);
      try {
        const r = await fetch(url, { method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json', 'x-api-key': c.apiKey, 'anthropic-version': '2023-06-01' }, body: cuerpo });
        if (r.status === 429 || r.status >= 500) { ultimo = `HTTP ${r.status}`; await new Promise((ok) => setTimeout(ok, 400 * (intento + 1))); continue; }
        if (!r.ok) {
          ultimo = `HTTP ${r.status}`; await this.registrar(t, tarea, modelo, null, null, null, `error_${r.status}`);
          if (r.status === 401 || r.status === 403) throw new ServiceUnavailableException('Anthropic rechazó la clave de IA. Revisa la clave en la consola de plataforma.');
          throw new BadGatewayException(`La IA respondió con un error (${r.status}).`);
        }
        const j = (await r.json()) as { content?: Bloque[]; stop_reason?: string; usage?: { input_tokens?: number; output_tokens?: number } };
        const entrada = j.usage?.input_tokens ?? 0; const salida = j.usage?.output_tokens ?? 0;
        await this.registrar(t, tarea, modelo, entrada, salida, this.costo(c, modelo, entrada, salida), 'ok');
        return { bloques: j.content ?? [], parada: j.stop_reason ?? '', entrada, salida, modelo };
      } catch (e) {
        if (e instanceof HttpException) throw e;
        ultimo = (e as Error).name === 'AbortError' ? 'tiempo agotado' : (e as Error).message;
        await new Promise((ok) => setTimeout(ok, 400 * (intento + 1)));
      } finally { clearTimeout(reloj); }
    }
    this.log.warn(`La IA no respondió tras ${REINTENTOS + 1} intentos: ${ultimo}`);
    await this.registrar(t, tarea, modelo, null, null, null, 'error_red');
    throw new BadGatewayException('No pudimos comunicarnos con la IA en este momento. Intenta de nuevo en unos minutos.');
  }

  /** Auditoría de uso de una sucursal (para el dueño): llamadas del mes y su costo estimado, si hay precios cargados. */
  usoDeSucursal(t: Tenant) {
    return this.db.run(t, async (tx) => {
      const r = (await tx.execute(sql`SELECT count(*) FILTER (WHERE status = 'ok')::int AS ok, count(*) FILTER (WHERE status <> 'ok')::int AS errores, COALESCE(SUM(cost_usd), 0)::numeric(12,4)::text AS costo FROM ai_jobs WHERE restaurant_id = ${t.restaurantId} AND created_at >= date_trunc('month', now())`)).rows[0] as { ok: number; errores: number; costo: string };
      return { llamadas: r.ok, errores: r.errores, costoUsd: r.costo };
    });
  }

  async auditar(t: Tenant, por: string, accion: string, datos: unknown) { await this.db.run(t, (tx) => auditar(tx, t.restaurantId, por, accion, 'ia', t.restaurantId, datos)); }

  /** Valida que una cadena sea el JSON que pedimos al modelo (extrae el primer objeto aunque venga con texto alrededor). */
  static extraerJson(texto: string): unknown {
    const i = texto.indexOf('{'); const j = texto.lastIndexOf('}');
    if (i < 0 || j <= i) throw new BadRequestException('La IA no devolvió un resultado en el formato esperado.');
    try { return JSON.parse(texto.slice(i, j + 1)); } catch { throw new BadRequestException('La IA no devolvió un resultado en el formato esperado.'); }
  }
}
