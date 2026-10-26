import { esSubDeDemostracion } from '../demo/constantes';
import { BadRequestException, ConflictException, ForbiddenException, HttpException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { and, eq, gt, isNull, lt } from 'drizzle-orm';
import type { Response } from 'express';
import { z } from 'zod';
import type { KyrosIdPublico, Rol, SesionRespuesta } from '@gestro/contracts';
import { SesionService } from '../auth/sesion.service';
import { entorno } from '../config/entorno';
import { ConfiguracionService } from '../configuracion/configuracion.service';
import { BD, Bd } from '../database/database.module';
import { accounts, kyrosLinks, kyrosUsedTokens, restaurants, roles, userInvitations, userRoles, users } from '../database/esquema';
import { SecretosService } from '../secretos/secretos.service';
import { ClavesDelEmisor, EmisorNoDisponible, Reclamos, TokenInvalido, urlDeClaves, validarAvisoDeCierre, validarToken } from './validador';

/** Lo que se guarda (cifrado) en app_config. Nada de esto es secreto, pero va igual que el resto. */
export interface KyrosIdGuardado { activo: boolean; emisor: string; clientId: string; audiencia: string; portalClientId?: string; portalAudiencia?: string }

export const EMISOR_POR_DEFECTO = 'https://auth.kyros-tech.com/realms/kyros';
/** Una identidad creada con «Crear mi cuenta» tiene auth_time de hasta 5 minutos (patrón del Portal). */
const RECIEN_CREADA_S = 300;
/** Días de prueba de un restaurante nuevo (provisional hasta que Kyros-Tech fije los planes). */
export const DIAS_DE_PRUEBA = 15;

export type ResultadoCanje =
  | { estado: 'sesion'; sesion: SesionRespuesta }
  | { estado: 'sin_vinculo'; puedeRegistrarse: boolean; registroToken: string };

export const RegistroSchema = z.object({
  registroToken: z.string().min(20).max(4096),
  nombre: z.string().trim().min(2).max(120),
  correo: z.string().trim().email().max(200),
  restaurante: z.string().trim().min(2).max(120),
  razonSocial: z.string().trim().min(2).max(160),
  nit: z.string().trim().max(30).optional(),
}).strict();

export const VincularSchema = z.object({
  registroToken: z.string().min(20).max(4096),
  codigo: z.string().trim().min(16).max(128),
}).strict();

const slugDe = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'restaurante';

@Injectable()
export class KyrosIdService {
  private claves: { emisor: string; cache: ClavesDelEmisor } | null = null;

  constructor(
    @Inject(BD) private readonly bd: Bd,
    @Inject(ConfiguracionService) private readonly config: ConfiguracionService,
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(SecretosService) private readonly secretos: SecretosService,
    @Inject(SesionService) private readonly sesion: SesionService,
  ) {}

  async ajustes(): Promise<KyrosIdGuardado> {
    const a = await this.config.leer<KyrosIdGuardado>('kyrosId');
    const clientId = a?.clientId || 'gestro-web';
    return { activo: !!a?.activo, emisor: (a?.emisor || EMISOR_POR_DEFECTO).replace(/\/+$/, ''), clientId, audiencia: a?.audiencia || clientId, portalClientId: a?.portalClientId || 'portal-web', portalAudiencia: a?.portalAudiencia || 'gestro-portal' };
  }

  /**
   * Token del Portal Kyros (client `portal-web`, audiencia propia de GESTRO): solo sirve para portal/summary y
   * portal/account. Devuelve el `sub` y, si hay vínculo, el usuario local. Nunca crea cuentas.
   */
  async validarPortal(token: string): Promise<{ sub: string; userId: string | null }> {
    const a = await this.ajustes();
    let r: Reclamos;
    try {
      r = await validarToken(token, { emisor: a.emisor, clientId: a.portalClientId || 'portal-web', audiencia: a.portalAudiencia || 'gestro-portal' }, this.clavesDe(a.emisor));
    } catch (e) {
      if (e instanceof EmisorNoDisponible) throw new HttpException('Kyros ID no responde.', 503);
      throw new UnauthorizedException();
    }
    const [v] = await this.bd.select({ userId: kyrosLinks.userId }).from(kyrosLinks).where(and(eq(kyrosLinks.issuer, a.emisor), eq(kyrosLinks.sub, r.sub)));
    if (!v && esSubDeDemostracion(r.sub)) throw new UnauthorizedException();   // sin demostración cargada: como un token inválido
    return { sub: r.sub, userId: v?.userId ?? null };
  }

  async guardar(a: KyrosIdGuardado, por: string): Promise<void> {
    await this.config.guardar('kyrosId', a, por);
    this.claves = null;
  }

  /** Lo que necesita el navegador. Sin red: solo arma las direcciones (convención de Keycloak). */
  async publico(): Promise<KyrosIdPublico> {
    const a = await this.ajustes();
    const p = `${a.emisor}/protocol/openid-connect`;
    return { activo: a.activo, emisor: a.emisor, clientId: a.clientId, authorizationEndpoint: `${p}/auth`, tokenEndpoint: `${p}/token`, endSessionEndpoint: `${p}/logout` };
  }

  private clavesDe(emisor: string): ClavesDelEmisor {
    if (!this.claves || this.claves.emisor !== emisor) this.claves = { emisor, cache: new ClavesDelEmisor(urlDeClaves(emisor), { produccion: entorno.produccion }) };
    return this.claves.cache;
  }

  /** Canjea el token de acceso de Kyros ID: o abre sesión (vínculo existente) o devuelve un token de registro. */
  async canjear(accessToken: string, ip: string, res: Response): Promise<ResultadoCanje> {
    const a = await this.ajustes();
    if (!a.activo) throw new HttpException('Kyros ID no está activado.', 503);
    let r: Reclamos;
    try {
      r = await validarToken(accessToken, { emisor: a.emisor, clientId: a.clientId, audiencia: a.audiencia }, this.clavesDe(a.emisor));
    } catch (e) {
      if (e instanceof EmisorNoDisponible) throw new HttpException('Kyros ID no responde. Inténtalo en un momento.', 503);
      if (e instanceof TokenInvalido) throw new UnauthorizedException('No pudimos verificar tu ingreso.');
      throw e;
    }
    await this.usarJti(r);

    const [vinculo] = await this.bd.select().from(kyrosLinks).where(and(eq(kyrosLinks.issuer, a.emisor), eq(kyrosLinks.sub, r.sub)));
    if (!vinculo && esSubDeDemostracion(r.sub)) throw new UnauthorizedException('No pudimos verificar tu ingreso.');   // las cuentas Prueba_Kyros solo valen con la demostración cargada
    if (vinculo) {
      const [u] = await this.bd.select().from(users).where(eq(users.id, vinculo.userId));
      if (!u?.active) throw new ForbiddenException('Tu cuenta está desactivada.');
      return { estado: 'sesion', sesion: await this.sesion.abrir(u.id, r.sub, ip, res) };
    }
    const reciente = typeof r.auth_time === 'number' && Date.now() / 1000 - r.auth_time <= RECIEN_CREADA_S;
    const registroToken = await this.jwt.signAsync({ iss: a.emisor, reciente }, {
      secret: this.secretos.firma('registro-kyros'), algorithm: 'HS256', audience: 'registro', subject: r.sub, expiresIn: '15m',
    });
    // Sin consultar cuentas: la respuesta es la misma exista o no el correo.
    return { estado: 'sin_vinculo', puedeRegistrarse: reciente, registroToken };
  }

  /** Cada `jti` se canjea una sola vez. */
  private async usarJti(r: Reclamos): Promise<void> {
    if (!r.jti) return;
    await this.bd.delete(kyrosUsedTokens).where(lt(kyrosUsedTokens.expiresAt, new Date()));
    const dentro = await this.bd.insert(kyrosUsedTokens).values({ jti: r.jti, expiresAt: new Date(r.exp * 1000 + 60_000) }).onConflictDoNothing().returning({ jti: kyrosUsedTokens.jti });
    if (!dentro.length) throw new UnauthorizedException('No pudimos verificar tu ingreso.');
  }

  private async leerRegistro(token: string): Promise<{ sub: string; emisor: string; reciente: boolean }> {
    try {
      const p = await this.jwt.verifyAsync<{ sub: string; iss: string; reciente: boolean }>(token, { secret: this.secretos.firma('registro-kyros'), algorithms: ['HS256'], audience: 'registro' });
      return { sub: p.sub, emisor: p.iss, reciente: !!p.reciente };
    } catch {
      throw new UnauthorizedException('Tu ingreso venció: vuelve a entrar con Kyros ID.');
    }
  }

  /** Primer vínculo del personal: el código de invitación prueba quién debe ocupar el usuario. Nunca por correo. */
  async vincular(d: z.infer<typeof VincularSchema>, ip: string, res: Response): Promise<SesionRespuesta> {
    const reg = await this.leerRegistro(d.registroToken);
    const hash = this.secretos.huella(d.codigo);
    const [inv] = await this.bd.select().from(userInvitations).where(and(eq(userInvitations.tokenHash, hash), isNull(userInvitations.usedAt), gt(userInvitations.expiresAt, new Date())));
    if (!inv) throw new BadRequestException('El código no es válido o ya venció.');
    const consumida = await this.bd.update(userInvitations).set({ usedAt: new Date() }).where(and(eq(userInvitations.id, inv.id), isNull(userInvitations.usedAt))).returning({ id: userInvitations.id });
    if (!consumida.length) throw new BadRequestException('El código no es válido o ya venció.');
    const [u] = await this.bd.select().from(users).where(and(eq(users.id, inv.userId), eq(users.active, true)));
    if (!u) throw new ForbiddenException('Tu cuenta está desactivada.');
    await this.crearVinculo(reg.emisor, reg.sub, u.id);
    return this.sesion.abrir(u.id, reg.sub, ip, res);
  }

  /** «Completa tu registro»: solo una identidad recién creada con «Crear mi cuenta» abre su restaurante. */
  async registrar(d: z.infer<typeof RegistroSchema>, ip: string, res: Response): Promise<SesionRespuesta> {
    const reg = await this.leerRegistro(d.registroToken);
    if (!reg.reciente) throw new ForbiddenException('Para registrar un restaurante, crea tu cuenta con «Crear mi cuenta».');
    const hasta = new Date(Date.now() + DIAS_DE_PRUEBA * 86_400_000).toISOString().slice(0, 10);
    const userId = await this.bd.transaction(async (tx) => {
      const [cuenta] = await tx.insert(accounts).values({ legalName: d.razonSocial, nit: d.nit ?? null, ownerEmail: d.correo }).returning({ id: accounts.id });
      const [rest] = await tx.insert(restaurants).values({
        accountId: cuenta.id, name: d.restaurante, slug: `${slugDe(d.restaurante)}-${this.secretos.tokenAleatorio().slice(0, 5).toLowerCase()}`, paidUntil: hasta,
      }).returning({ id: restaurants.id });
      const [u] = await tx.insert(users).values({ accountId: cuenta.id, email: d.correo, fullName: d.nombre }).returning({ id: users.id });
      const [rol] = await tx.select().from(roles).where(eq(roles.code, 'owner' satisfies Rol));
      await tx.insert(userRoles).values({ restaurantId: rest.id, userId: u.id, roleId: rol.id });
      await tx.insert(kyrosLinks).values({ issuer: reg.emisor, sub: reg.sub, userId: u.id });
      return u.id;
    }).catch((e) => {
      if (/unique|duplicate/i.test(String(e?.message ?? e)) || e?.code === '23505' || e?.cause?.code === '23505') throw new ConflictException('Ese correo o esa identidad ya está registrada.');
      throw e;
    });
    return this.sesion.abrir(userId, reg.sub, ip, res);
  }

  /** Vínculo inmutable. Las restricciones UNIQUE deciden las carreras: una gana, la otra recibe 409. */
  async crearVinculo(emisor: string, sub: string, userId: string): Promise<void> {
    try {
      await this.bd.insert(kyrosLinks).values({ issuer: emisor, sub, userId });
    } catch (e) {
      if ((e as { code?: string; cause?: { code?: string } }).code === '23505' || (e as { cause?: { code?: string } }).cause?.code === '23505') throw new ConflictException('Esta identidad o este usuario ya están vinculados.');
      throw e;
    }
  }

  /** Cierre global: Kyros ID avisa (back-channel) y se revocan las sesiones de esa persona. */
  async avisoDeCierre(token: string): Promise<void> {
    const a = await this.ajustes();
    let aviso: Awaited<ReturnType<typeof validarAvisoDeCierre>>;
    try {
      aviso = await validarAvisoDeCierre(token, { emisor: a.emisor, clientId: a.clientId }, this.clavesDe(a.emisor));
    } catch { throw new BadRequestException(); }
    await this.bd.insert(kyrosUsedTokens).values({ jti: `bc:${aviso.jti}`, expiresAt: new Date(aviso.exp * 1000 + 60_000) }).onConflictDoNothing();
    if (aviso.sub) await this.sesion.revocarPorSub(aviso.sub);
  }
}
