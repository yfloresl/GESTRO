import { Body, Controller, HttpCode, Inject, Injectable, Get, Patch } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { Actor, ActorActual, Publico } from '../comun/acceso';
import { SoloPlataforma } from '../comun/guards';
import { BD, Bd } from '../database/database.module';
import { MODULOS } from './paquetes';

/** Servicio de tipo de cambio de Kyros-Tech (literal no secreto, como pide el estándar). */
const URL_TIPO_CAMBIO = 'https://www.kyros-tech.com/api/v1/tipo-cambio';
const CACHE_MS = 6 * 3_600_000;
export type TipoCambio = { bob: number; fecha: string; vigente: boolean };

/** Saca un número y una fecha de la respuesta sin atarse a un contrato exacto. Devuelve null si no hay un valor razonable. */
export function leerTipoCambio(j: unknown): { bob: number; fecha: string | null } | null {
  const n = (v: unknown) => { const x = typeof v === 'string' ? Number(v.replace(',', '.')) : v; return typeof x === 'number' && Number.isFinite(x) && x > 1 && x < 100 ? x : null; };
  const buscar = (o: unknown, llaves: string[]): unknown => { if (!o || typeof o !== 'object') return undefined; for (const k of llaves) if (k in (o as object)) return (o as Record<string, unknown>)[k]; return undefined; };
  for (const raiz of [j, buscar(j, ['data', 'resultado', 'result'])]) {
    const v = n(buscar(raiz, ['tipoCambio', 'tipo_cambio', 'bob', 'usdBob', 'usd_bob', 'venta', 'oficial', 'rate', 'valor', 'cambio']));
    if (v !== null) { const f = buscar(raiz, ['fecha', 'date', 'actualizado', 'updatedAt', 'updated_at']); return { bob: v, fecha: typeof f === 'string' ? f.slice(0, 10) : null }; }
  }
  return null;
}

@Injectable()
export class TipoCambioService {
  private ultimo: { bob: number; fecha: string; en: number } | null = null;

  /** Caché de 6 h; si el servicio no responde se usa el último valor bueno con SU fecha (vigente = false). Sin ninguno: null (solo dólares). */
  async actual(): Promise<TipoCambio | null> {
    if (this.ultimo && Date.now() - this.ultimo.en < CACHE_MS) return { bob: this.ultimo.bob, fecha: this.ultimo.fecha, vigente: true };
    try {
      const r = await fetch(URL_TIPO_CAMBIO, { signal: AbortSignal.timeout(4000), headers: { accept: 'application/json' } });
      const v = r.ok ? leerTipoCambio(await r.json()) : null;
      if (v) { this.ultimo = { bob: v.bob, fecha: v.fecha ?? new Date().toISOString().slice(0, 10), en: Date.now() }; return { bob: this.ultimo.bob, fecha: this.ultimo.fecha, vigente: true }; }
    } catch { /* se usa el respaldo */ }
    return this.ultimo ? { bob: this.ultimo.bob, fecha: this.ultimo.fecha, vigente: false } : null;
  }
}

const Publicar = z.object({ publicar: z.boolean() }).strict();

@Injectable()
export class PlanesPublicosService {
  constructor(@Inject(BD) private readonly bd: Bd, @Inject(TipoCambioService) private readonly tc: TipoCambioService) {}

  /** «Planes y precios» de la portada: con el interruptor apagado (por defecto) no se revela nada. */
  async publico() {
    const apagado = { publicado: false as const };
    const [a] = (await this.bd.execute(sql`SELECT show_pricing FROM platform_settings WHERE id = 1`)).rows as { show_pricing: boolean }[];
    if (!a?.show_pricing) return apagado;
    const filas = (await this.bd.execute(sql`SELECT code, name, monthly_price_usd::float8 AS usd, features FROM plans WHERE active AND monthly_price_usd IS NOT NULL AND features ? 'modulos' ORDER BY monthly_price_usd`)).rows as { code: string; name: string; usd: number; features: { modulos: string[] } }[];
    return {
      publicado: true as const,
      planes: filas.map((p) => ({ codigo: p.code, nombre: p.name, usd: p.usd, modulos: p.features.modulos.filter((m) => m in MODULOS).map((m) => ({ codigo: m, nombre: MODULOS[m as keyof typeof MODULOS] })) })),
      tipoCambio: await this.tc.actual(),
      nota: 'Los comensales y terceros nunca pagan. Sin límite de usuarios.',
    };
  }

  async publicar(por: string, publicar: boolean) {
    await this.bd.execute(sql`INSERT INTO platform_settings (id, show_pricing) VALUES (1, ${publicar}) ON CONFLICT (id) DO UPDATE SET show_pricing = EXCLUDED.show_pricing, updated_at = now()`);
    await this.bd.execute(sql`INSERT INTO audit_log (user_id, action, entity, entity_id, after) VALUES (${por}::uuid, ${publicar ? 'plataforma.planes_publicados' : 'plataforma.planes_ocultos'}, 'platform_settings', '1', ${JSON.stringify({ publicar })}::jsonb)`);
    return { ok: true, publicado: publicar };
  }
}

@Controller('public')
export class PlanesPublicosController {
  constructor(@Inject(PlanesPublicosService) private readonly s: PlanesPublicosService) {}
  @Publico() @Get('planes') planes() { return this.s.publico(); }
}

@Controller('plataforma')
@SoloPlataforma()
export class PlanesPublicosAdminController {
  constructor(@Inject(PlanesPublicosService) private readonly s: PlanesPublicosService) {}
  @Patch('planes-publicos') @HttpCode(200) publicar(@ActorActual() a: Actor, @Body() b: unknown) { return this.s.publicar(a.sub, Publicar.parse(b).publicar); }
}
