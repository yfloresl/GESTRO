/**
 * Lo propio de GESTRO que el estándar compartido (`kyros-estandar.ts` / `kyros-estandar-ui.tsx`, v1.1, idéntico en los 7 sistemas) NO cubre.
 * Todo lo que el estándar ya trae (sesión, textos, glosario, Plataforma, invitaciones, IVA…) se importa de allí: aquí no se duplica.
 */
import { desgloseIva, diasParaVencer, TXT } from './kyros-estandar';

// S-07: aceptación legal. Los textos de la casilla y de «marca la casilla» salen del estándar; aquí solo lo propio del flujo de Gestro.
export const LEGAL = {
  TEXTO_CASILLA: 'los Términos y Condiciones, la Política de Privacidad y las Políticas de uso.',
  MENSAJE_ERROR_GENERICO: 'No pudimos registrar tu aceptación. Revisa tu conexión e inténtalo de nuevo.',
  MENSAJE_SESION: 'Tu sesión venció. Entra de nuevo con Kyros ID para continuar.',
} as const;
/** Mensaje a mostrar si el usuario pulsa «Aceptar y continuar» (null = puede continuar). Nunca queda en silencio. */
export function validarAceptacion(marcada: boolean): string | null {
  return marcada ? null : `${TXT.marcaCasilla}.`;
}
/** Mensaje legible para un error al registrar la aceptación (estado HTTP + mensaje del servidor, si lo hay). Nunca devuelve un código técnico. */
export function mensajeErrorAceptacion(estado: number | null | undefined, mensajeServidor?: string | null): string {
  if (estado === 401 || estado === 403) return LEGAL.MENSAJE_SESION;
  const m = (mensajeServidor ?? '').trim();
  const tecnico = !m || /^[A-Z0-9_]+$/.test(m) || /^(error|bad request|internal server error|failed to fetch)/i.test(m) || m.length > 200;
  return tecnico ? LEGAL.MENSAJE_ERROR_GENERICO : m;
}

// S-10: «sin permiso». `aQuien` = quien administra el acceso en Gestro.
export const SIN_PERMISO = { ayuda: (aQuien: string): string => `Pídele acceso a ${aQuien}. Si crees que es un error, cierra sesión y vuelve a entrar con Kyros ID.` } as const;
/** `true` si el error HTTP significa «sin permiso» (403). */
export const esSinPermiso = (estado: number | null | undefined): boolean => estado === 403;

// S-11: la contraseña demo nunca va en claro.
export const DEMOSTRACION = { BOTON_MOSTRAR_CONTRASENA: 'Mostrar contraseña de la cuenta de prueba', BOTON_OCULTAR_CONTRASENA: 'Ocultar contraseña' } as const;
export const enmascarar = (secreto: string): string => '•'.repeat(Math.min(Math.max(secreto.length, 8), 16));

// S-12: notificaciones (ruta propia de Gestro + alias heredados); las etiquetas son las del estándar.
export const RUTA_NOTIFICACIONES = '/notificaciones';
export const ALIAS_NOTIFICACIONES: readonly string[] = ['/avisos', '/alertas'];
export const NOTIFICACIONES = { TITULO: TXT.campana, CAMPANA: TXT.campana, VACIO: TXT.sinNotificaciones, MARCAR_LEIDAS: TXT.marcarLeidos } as const;

// S-08: texto de vigencia de una invitación, el mismo del estándar.
export const textoVigencia = (venceEn: string | Date | null | undefined, ahora: Date = new Date()): string => (venceEn ? TXT.invitacionVigencia(diasParaVencer(venceEn, ahora)) : 'Sin fecha de vencimiento');

// S-06: vista previa de cambio de plan. Gestro convierte el crédito en DÍAS del plan nuevo (GS-C04): el único importe en dinero es el crédito
// que sobra, con IVA incluido; se muestra «Neto / IVA 13 % / Total» (estándar `desgloseIva`). La matemática del prorrateo vive en la API.
export interface VistaPreviaCambioPlan {
  fechaEfectiva: string;          // AAAA-MM-DD
  vigenciaNueva: string | null;   // AAAA-MM-DD (último día cubierto)
  diasRestantes: number;
  diasExtra: number;              // días que se SUMAN por crédito (nunca se pierden)
  creditoSobranteCentavos?: number; // crédito que queda a favor (IVA incluido); 0/ausente = no hay importe
}
const fmtBs = (c: number) => `Bs ${(c / 100).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtFecha = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
export function lineasVistaPrevia(v: VistaPreviaCambioPlan): string[] {
  const l: string[] = [`Días que te quedan: ${v.diasRestantes}`];
  if (v.diasExtra > 0) l.push(`Días que se suman a tu vigencia: ${v.diasExtra}`);
  l.push(`Rige desde: ${fmtFecha(v.fechaEfectiva)}`);
  if (v.vigenciaNueva) l.push(`Tu plan nuevo vence el: ${fmtFecha(v.vigenciaNueva)}`);
  if (v.creditoSobranteCentavos && v.creditoSobranteCentavos > 0) {
    const d = desgloseIva(v.creditoSobranteCentavos);
    l.push(`Crédito que queda a favor: Neto ${fmtBs(d.netoCentavos)} · IVA 13 % ${fmtBs(d.ivaCentavos)} · Total ${fmtBs(d.totalCentavos)}`);
  }
  l.push('No pierdes ningún día ya pagado.');
  return l;
}
/** Lista simple (solo SuperAdmin) de funcionalidades pendientes de precio. Devuelve [] para que ninguna pantalla de cliente muestre el aviso. */
export function funcionalidadesSinPrecio<T extends { nombre: string; precio?: number | string | null }>(items: readonly T[], esSuperAdmin: boolean): string[] {
  if (!esSuperAdmin) return [];
  return items.filter((i) => i.precio === null || i.precio === undefined || i.precio === '' || Number(i.precio) === 0).map((i) => i.nombre);
}
