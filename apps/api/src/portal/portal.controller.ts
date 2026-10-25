import { Controller, Get, HttpCode, Inject, Options, Req, Res, UnauthorizedException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { sql } from 'drizzle-orm';
import type { Request, Response } from 'express';
import type { Rol } from '@gestro/contracts';
import { Publico } from '../comun/acceso';
import { SesionService } from '../auth/sesion.service';
import { entorno } from '../config/entorno';
import { TenantDb } from '../database/database.module';
import { KyrosIdService } from '../kyros-id/kyros-id.service';
import { SuscripcionService } from '../suscripcion/suscripcion.service';

/** El Portal Kyros solo puede llamar desde su propio origen, sin cookies, y solo a estas dos rutas. */
const ORIGEN_PORTAL = 'https://portal.kyros-tech.com';
const ROL_TEXTO: Record<Rol, string> = { owner: 'Dueño', admin: 'Administrador', cobranzas: 'Encargado de cobranzas', cajero: 'Cajero', mesero: 'Mesero', area_manager: 'Encargado de área', cocina: 'Jefe de cocina', almacen: 'Almacén', contador: 'Contador' };
type Urgencia = 'info' | 'atencion' | 'urgente';
interface Perfil {
  rol: string; sucursal: string; nombreMostrado: string; estado: 'ACTIVA' | 'SUSPENDIDA'; tableros: { etiqueta: string; valor: number | string; detalle?: string }[];
  pendientes: { etiqueta: string; cantidad: number; urgencia: Urgencia; destino: string }[]; proximos: { titulo: string; cuando: string; detalle?: string; destino: string }[];
  suscripciones: { nombre: string; plan: string; estado: 'ACTIVA' | 'POR_VENCER' | 'VENCIDA' | 'SUSPENDIDA'; venceEl: string; gestionar: string }[];
}

@Controller('portal')
export class PortalController {
  constructor(
    @Inject(KyrosIdService) private readonly kyros: KyrosIdService,
    @Inject(SesionService) private readonly sesion: SesionService,
    @Inject(TenantDb) private readonly db: TenantDb,
  ) {}

  private cabeceras(req: Request, res: Response) {
    // CORS solo para el Portal (y solo localhost en desarrollo); sin credenciales; nunca en caché compartida.
    const origen = req.headers.origin;
    if (origen && (origen === ORIGEN_PORTAL || (!entorno.produccion && /^http:\/\/localhost:\d+$/.test(origen)))) {
      res.setHeader('Access-Control-Allow-Origin', origen); res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'authorization'); res.setHeader('Access-Control-Allow-Methods', 'GET');
    }
    res.setHeader('Cache-Control', 'no-store');
  }

  @Publico() @Options('summary') @HttpCode(204) preflightResumen(@Req() req: Request, @Res({ passthrough: true }) res: Response) { this.cabeceras(req, res); }
  @Publico() @Options('account') @HttpCode(204) preflightCuenta(@Req() req: Request, @Res({ passthrough: true }) res: Response) { this.cabeceras(req, res); }

  /** Resumen agregado para la tarjeta del Portal: solo conteos y estados, sin datos de clientes ni de terceros. */
  @Publico() @Throttle({ default: { limit: 60, ttl: 60_000 } }) @Get('summary')
  async resumen(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.cabeceras(req, res);
    const v = await this.identificar(req);
    const entrar = `${entorno.urlPublica}/entrar`;
    if (!v) return { vinculado: false, entrar };
    const perfiles = await this.perfiles(v);
    const p0 = perfiles[0];
    return { vinculado: true, nombreMostrado: p0?.nombreMostrado ?? '', rol: p0?.rol ?? '', tableros: p0?.tableros ?? [], pendientes: p0?.pendientes ?? [], proximos: p0?.proximos ?? [], entrar, perfiles: perfiles.map(({ suscripciones: _s, ...resto }) => resto) };
  }

  @Publico() @Throttle({ default: { limit: 60, ttl: 60_000 } }) @Get('account')
  async cuenta(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.cabeceras(req, res);
    const v = await this.identificar(req);
    const entrar = `${entorno.urlPublica}/entrar`;
    if (!v) return { vinculado: false, entrar };
    const perfiles = await this.perfiles(v);
    const p0 = perfiles[0];
    return {
      vinculado: true, rol: p0?.rol ?? '', nombreMostrado: p0?.nombreMostrado ?? '', estadoCuenta: p0?.estado ?? 'ACTIVA', suscripciones: perfiles.flatMap((p) => p.suscripciones),
      gestionarPerfil: '/app/panel', entrar, perfiles: perfiles.map((p) => ({ rol: p.rol, sucursal: p.sucursal, nombreMostrado: p.nombreMostrado, estado: p.estado, suscripciones: p.suscripciones })),
    };
  }

  /** Token del client `portal-web` con la audiencia propia de GESTRO. Cualquier otro (o ausente) = 401 genérico. */
  private async identificar(req: Request): Promise<string | null> {
    const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    if (!token) throw new UnauthorizedException();
    const r = await this.kyros.validarPortal(token);
    return r.userId;
  }

  private async perfiles(userId: string): Promise<Perfil[]> {
    const { usuario, sucursales } = await this.sesion.contexto(userId).catch(() => ({ usuario: null, sucursales: [] }));
    if (!usuario) return [];
    const out: Perfil[] = [];
    for (const s of sucursales) {
      const t = { restaurantId: s.id, restaurantIds: [] };
      const d = await this.db.run(t, async (tx) => {
        const r = await tx.execute(sql`SELECT
          (SELECT count(*)::int FROM service_requests WHERE restaurant_id = ${s.id} AND status = 'pendiente') AS llamados,
          (SELECT count(*)::int FROM service_requests WHERE restaurant_id = ${s.id} AND status = 'pendiente' AND escalated_at IS NOT NULL) AS escalados,
          (SELECT count(*)::int FROM orders WHERE restaurant_id = ${s.id} AND status IN ('borrador','enviado','en_preparacion','listo','servido')) AS pedidos,
          (SELECT count(DISTINCT order_id)::int FROM order_items WHERE restaurant_id = ${s.id} AND from_qr AND status = 'borrador' AND voided_at IS NULL) AS por_confirmar,
          (SELECT count(*)::int FROM orders WHERE restaurant_id = ${s.id} AND status IN ('enviado','en_preparacion')) AS en_cocina,
          (SELECT paid_until::text FROM restaurants WHERE id = ${s.id}) AS hasta,
          (SELECT (paid_until - (now() AT TIME ZONE 'America/La_Paz')::date)::int FROM restaurants WHERE id = ${s.id}) AS dias,
          (SELECT status FROM restaurants WHERE id = ${s.id}) AS estado,
          (SELECT p.name FROM restaurants r JOIN plans p ON p.id = r.plan_id WHERE r.id = ${s.id}) AS plan`);
        return r.rows[0] as { llamados: number; escalados: number; pedidos: number; por_confirmar: number; en_cocina: number; hasta: string | null; dias: number | null; estado: string; plan: string | null };
      });
      const admin = s.roles.some((r) => r === 'owner' || r === 'admin');
      const estadoSus = SuscripcionService.estado(d.dias);
      const tableros: Perfil['tableros'] = s.roles.includes('cocina') && !admin
        ? [{ etiqueta: 'Comandas en cocina', valor: d.en_cocina }]
        : [{ etiqueta: 'Llamados de mesa', valor: d.llamados, detalle: d.escalados ? `${d.escalados} sin atender` : undefined }, { etiqueta: 'Pedidos en curso', valor: d.pedidos }, ...(admin ? [{ etiqueta: 'Suscripción', valor: d.dias === null ? 'Sin fecha' : d.dias >= 0 ? `${d.dias} días` : 'Vencida' }] : [])];
      const pendientes: Perfil['pendientes'] = [];
      if (d.llamados > 0 && !s.roles.every((r) => r === 'cocina')) pendientes.push({ etiqueta: 'Llamados de mesa sin atender', cantidad: d.llamados, urgencia: d.escalados ? 'urgente' : 'atencion', destino: '/app/salon' });
      if (d.por_confirmar > 0 && !s.roles.every((r) => r === 'cocina')) pendientes.push({ etiqueta: 'Pedidos del cliente por confirmar', cantidad: d.por_confirmar, urgencia: 'atencion', destino: '/app/pedidos' });
      if (admin && estadoSus !== 'activa') pendientes.push({ etiqueta: estadoSus === 'por_vencer' ? 'Suscripción por vencer' : 'Suscripción vencida', cantidad: 1, urgencia: estadoSus === 'por_vencer' ? 'atencion' : 'urgente', destino: '/app/suscripcion' });
      const proximos: Perfil['proximos'] = admin && d.hasta ? [{ titulo: 'Vence la suscripción', cuando: `${d.hasta}T23:59:59-04:00`, detalle: s.nombre, destino: '/app/suscripcion' }] : [];
      out.push({
        rol: s.roles.map((r) => ROL_TEXTO[r] ?? r).join(' / '), sucursal: s.nombre, nombreMostrado: usuario.fullName, estado: d.estado === 'activo' ? 'ACTIVA' : 'SUSPENDIDA', tableros: tableros.slice(0, 4), pendientes: pendientes.slice(0, 6), proximos,
        suscripciones: admin ? [{ nombre: s.nombre, plan: d.plan ?? 'Sin plan', estado: d.estado !== 'activo' ? 'SUSPENDIDA' : estadoSus === 'activa' ? 'ACTIVA' : estadoSus === 'por_vencer' ? 'POR_VENCER' : 'VENCIDA', venceEl: d.hasta ?? '', gestionar: '/app/suscripcion' }] : [],
      });
    }
    if (!out.length && usuario.isPlatformAdmin) out.push({ rol: 'Plataforma Kyros-Tech', sucursal: 'Plataforma', nombreMostrado: usuario.fullName, estado: 'ACTIVA', tableros: [], pendientes: [], proximos: [], suscripciones: [] });
    return out;
  }
}
