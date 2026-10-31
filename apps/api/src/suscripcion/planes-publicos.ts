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

/** Contrato de Kyros-Tech: {usd_bob, fecha, fuente, antiguedad_dias, desactualizado}. Cualquier otra forma se descarta. */
export function leerTipoCambio(j: unknown): { bob: number; fecha: string; vigente: boolean } | null {
  const o = j as { usd_bob?: unknown; fecha?: unknown; desactualizado?: unknown } | null;
  if (!o || typeof o.usd_bob !== 'number' || !Number.isFinite(o.usd_bob) || o.usd_bob <= 1 || o.usd_bob >= 100) return null;
  if (typeof o.fecha !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.fecha)) return null;
  return { bob: o.usd_bob, fecha: o.fecha, vigente: o.desactualizado !== true };
}

@Injectable()
export class TipoCambioService {
  private ultimo: { bob: number; fecha: string; vigente: boolean; en: number } | null = null;

  /** Caché de 6 h. 503 = el servicio no tiene valor: solo dólares. Si la red falla se usa el último valor bueno con SU fecha (vigente = false). */
  async actual(): Promise<TipoCambio | null> {
    if (this.ultimo && Date.now() - this.ultimo.en < CACHE_MS) return { bob: this.ultimo.bob, fecha: this.ultimo.fecha, vigente: this.ultimo.vigente };
    try {
      const r = await fetch(URL_TIPO_CAMBIO, { signal: AbortSignal.timeout(4000), headers: { accept: 'application/json' } });
      if (r.status === 503) { this.ultimo = null; return null; }
      const v = r.ok ? leerTipoCambio(await r.json()) : null;
      if (v) { this.ultimo = { ...v, en: Date.now() }; return v; }
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
