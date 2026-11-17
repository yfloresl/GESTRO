import { Body, Controller, Delete, Get, HttpCode, HttpException, Inject, Injectable, NotFoundException, Param, Put } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { Actor, ActorActual } from '../comun/acceso';
import { SoloPlataforma } from '../comun/guards';
import { ConfiguracionService } from '../configuracion/configuracion.service';
import { BD, Bd } from '../database/database.module';

/**
 * Catálogo CERRADO de secretos de integración: solo estas claves existen. Sin valor por defecto y sin leer del entorno:
 * el dueño pega el valor en la consola de plataforma (solo escritura). El valor se guarda cifrado en app_config y NINGUNA ruta lo devuelve.
 */
export const CATALOGO_SECRETOS = {
  KYROS_SERVICE_CLIENT_SECRET: { nombre: 'Secreto del client de servicio de GESTRO en Kyros ID (gestro-service)', uso: 'Llamadas de servicio a servicio (client_credentials) hacia otros sistemas de Kyros-Tech.' },
} as const;
export type ClaveSecreto = keyof typeof CATALOGO_SECRETOS;
/** Secretos que solo escribe y lee el SERVIDOR (enlace automatico con FacturaSIN): fuera del catalogo, sin ruta ni pantalla, sin pegarlos a mano. */
export type ClaveInterna = 'FACTURASIN_API_KEY';

/** Escribir exige haber confirmado la identidad hace poco (contraseña + segundo factor en Kyros ID). */
export const VENTANA_REAUTH_S = 15 * 60;

const Valor = z.object({ valor: z.string().min(16).max(512) }).strict();
const llaveDe = (c: string) => `secreto.${c}`;
type Guardado = { valor: string | null; actualizado: string; deshabilitadaEn?: string | null; versiones: number };

@Injectable()
export class IntegracionesService {
  constructor(@Inject(ConfiguracionService) private readonly cfg: ConfiguracionService, @Inject(BD) private readonly bd: Bd) {}

  private clave(c: string): ClaveSecreto { if (!(c in CATALOGO_SECRETOS)) throw new NotFoundException('Esa clave no existe en el catálogo.'); return c as ClaveSecreto; }

  private exigirReauth(a: Actor) {
    if (!a.aat || Date.now() / 1000 - a.aat > VENTANA_REAUTH_S) throw new HttpException({ code: 'REAUTH_REQUERIDA', message: 'Confirma tu identidad otra vez para guardar secretos.' }, 401);
  }

  private auditar(por: string, accion: string, clave: string) {
    return this.bd.execute(sql`INSERT INTO audit_log (user_id, action, entity, entity_id, after) VALUES (${por}::uuid, ${accion}, 'secreto', ${clave}, ${JSON.stringify({ clave })}::jsonb)`);   // nunca el valor
  }

  /** Estado de cada clave del catálogo: «configurada» o «no configurada». Jamás el valor. */
  async estado() {
    const filas = [];
    for (const c of Object.keys(CATALOGO_SECRETOS) as ClaveSecreto[]) {
      const g = await this.cfg.leer<Guardado>(llaveDe(c));
      filas.push({ clave: c, nombre: CATALOGO_SECRETOS[c].nombre, uso: CATALOGO_SECRETOS[c].uso, estado: g?.valor ? 'configurada' : 'no_configurada', actualizado: g?.actualizado ?? null, deshabilitadaEn: g?.deshabilitadaEn ?? null });
    }
    return filas;
  }

  async guardar(a: Actor, c: string, cuerpo: unknown) {
    const clave = this.clave(c); this.exigirReauth(a); const { valor } = Valor.parse(cuerpo);
    const previo = await this.cfg.leer<Guardado>(llaveDe(clave));
    await this.cfg.guardar(llaveDe(clave), { valor, actualizado: new Date().toISOString(), deshabilitadaEn: null, versiones: (previo?.versiones ?? 0) + 1 } satisfies Guardado, a.sub);
    await this.auditar(a.sub, 'plataforma.secreto_guardado', clave);
    return { ok: true, clave, estado: 'configurada' };
  }

  /** «Quitar» = deshabilitar: el valor se limpia, la fila y su historial de auditoría se conservan. */
  async deshabilitar(a: Actor, c: string) {
    const clave = this.clave(c); this.exigirReauth(a);
    const previo = await this.cfg.leer<Guardado>(llaveDe(clave));
    await this.cfg.guardar(llaveDe(clave), { valor: null, actualizado: new Date().toISOString(), deshabilitadaEn: new Date().toISOString(), versiones: previo?.versiones ?? 0 } satisfies Guardado, a.sub);
    await this.auditar(a.sub, 'plataforma.secreto_deshabilitado', clave);
    return { ok: true, clave, estado: 'no_configurada' };
  }

  /** Escritura de SERVIDOR (enlace automatico con FacturaSIN): sin usuario ni reautenticacion. No esta expuesta por ninguna ruta y nunca devuelve el valor. */
  async guardarDeServicio(clave: ClaveInterna, valor: string): Promise<void> {
    const previo = await this.cfg.leer<Guardado>(llaveDe(clave));
    await this.cfg.guardar(llaveDe(clave), { valor, actualizado: new Date().toISOString(), deshabilitadaEn: null, versiones: (previo?.versiones ?? 0) + 1 } satisfies Guardado, null);
  }

  /** Solo para uso interno del servidor (futuras llamadas servicio-a-servicio). No está expuesto por ninguna ruta. */
  async obtener(c: ClaveSecreto | ClaveInterna): Promise<string | null> { return (await this.cfg.leer<Guardado>(llaveDe(c)))?.valor ?? null; }
}

@Controller('plataforma/secretos')
@SoloPlataforma()
export class IntegracionesController {
  constructor(@Inject(IntegracionesService) private readonly s: IntegracionesService) {}
  @Get() estado() { return this.s.estado(); }
  @Put(':clave') @HttpCode(200) guardar(@ActorActual() a: Actor, @Param('clave') c: string, @Body() b: unknown) { return this.s.guardar(a, c, b); }
  @Delete(':clave') @HttpCode(200) deshabilitar(@ActorActual() a: Actor, @Param('clave') c: string) { return this.s.deshabilitar(a, c); }
}
