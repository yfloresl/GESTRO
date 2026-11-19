/**
 * ESTANDAR KYROS DE SIMPLIFICACION v1.0.0 (S-02..S-13). Archivo IDENTICO en los 7 sistemas (copiar tal cual a `apps/web/src/lib/kyros-estandar.ts`).
 * Solo funciones puras y constantes, sin dependencias: lo que cambia entre sistemas (colores, kit de UI) vive en los componentes finos.
 * Premisa del dueno: simplificar NO es quitar capacidades; es que todo sea identificable e intuitivo y igual en los 7 sistemas.
 */

// ---------------------------------------------------------------------------------------------------------------------------------
// S-02 / S-03: ingreso unico y politica de sesion
// ---------------------------------------------------------------------------------------------------------------------------------
/** Texto del UNICO boton de ingreso en los 7 sistemas. Lleva directo a Kyros ID (sin paso intermedio). */
export const BOTON_ENTRAR = 'Entrar con Kyros ID';
export const SESION = {
  /**
   * Ingreso normal: `max_age` unico = 8 h (28800 s, la jornada). Si Kyros ID tiene una autenticacion de menos de 8 h vuelve sin pedir
   * contrasena (SSO entre sistemas); si es mas vieja la pide. NO se usa `prompt=login` ni `max_age=0` en el ingreso normal: forzarlos hace
   * que cada ingreso pida la contrasena otra vez y rompe el SSO. Configurable: cada sistema puede leerlo de su ajuste, con este valor por defecto.
   */
  LOGIN_MAX_AGE_SEGUNDOS: 28800,
  /** Reconfirmacion SOLO para acciones sensibles (borrar datos, cambiar el correo, claves, demostracion, administrador de plataforma): <= 5 min. */
  SENSIBLE_MAX_AGE_SEGUNDOS: 300,
  MENSAJE_RECONFIRMAR: 'Por seguridad, confirma tu identidad para continuar. Es solo para esta acción.',
  BOTON_RECONFIRMAR: 'Confirmar mi identidad',
} as const;

/** `max_age` que debe pedirse a Kyros ID segun el motivo. `promptLogin` fuerza la autenticacion nueva SOLO en acciones sensibles. */
export function parametrosSesion(motivo: 'ingreso' | 'sensible', override?: { loginMaxAge?: number }): { maxAge: number; promptLogin: boolean } {
  if (motivo === 'sensible') return { maxAge: SESION.SENSIBLE_MAX_AGE_SEGUNDOS, promptLogin: true };
  const v = override?.loginMaxAge;
  return { maxAge: Number.isInteger(v) && (v as number) > 0 ? (v as number) : SESION.LOGIN_MAX_AGE_SEGUNDOS, promptLogin: false };
}
/** `true` si la autenticacion (auth_time, segundos) es suficientemente reciente para una accion sensible. */
export function autenticacionReciente(authTime: number | null | undefined, ahoraSeg = Math.floor(Date.now() / 1000), maxAge: number = SESION.SENSIBLE_MAX_AGE_SEGUNDOS): boolean {
  return typeof authTime === 'number' && authTime <= ahoraSeg + 60 && ahoraSeg - authTime <= maxAge + 60;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// S-04: consola «Plataforma» (una sola estructura y nombre)
// ---------------------------------------------------------------------------------------------------------------------------------
export const PLATAFORMA_NOMBRE = 'Plataforma';
export const PLATAFORMA_BASE = '/plataforma';
export const PLATAFORMA_SECCIONES = [
  { id: 'clientes', etiqueta: 'Clientes', ruta: '/plataforma/clientes' },
  { id: 'planes', etiqueta: 'Planes', ruta: '/plataforma/planes' },
  { id: 'facturacion', etiqueta: 'Facturación', ruta: '/plataforma/facturacion' },
  { id: 'integraciones', etiqueta: 'Integraciones', ruta: '/plataforma/integraciones' },
  { id: 'auditoria', etiqueta: 'Auditoría', ruta: '/plataforma/auditoria' },
  { id: 'demostracion', etiqueta: 'Demostración', ruta: '/plataforma/demostracion' },
] as const;
export type SeccionPlataformaId = (typeof PLATAFORMA_SECCIONES)[number]['id'];

/** Seccion de Plataforma a la que pertenece una ruta (canonica, o heredada segun el `alias` del sistema: ruta vieja -> id de seccion). */
export function seccionDePlataforma(pathname: string, alias: Readonly<Record<string, SeccionPlataformaId>> = {}): SeccionPlataformaId | null {
  const p = pathname.replace(/\/+$/, '') || '/';
  for (const s of PLATAFORMA_SECCIONES) if (p === s.ruta || p.startsWith(`${s.ruta}/`)) return s.id;
  const claves = Object.keys(alias).sort((a, b) => b.length - a.length);
  for (const k of claves) if (p === k || p.startsWith(`${k}/`)) return alias[k]!;
  return null;
}
/** Redireccion de una ruta vieja a la canonica: `alias` = {rutaVieja: rutaCanonica}. Devuelve null si no es una ruta vieja. */
export function redirigirRutaVieja(pathname: string, alias: Readonly<Record<string, string>>): string | null {
  const p = pathname.replace(/\/+$/, '') || '/';
  return Object.prototype.hasOwnProperty.call(alias, p) ? alias[p]! : null;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// S-05: glosario unico, botones y estados en espanol simple
// ---------------------------------------------------------------------------------------------------------------------------------
export const GLOSARIO = {
  webhook: 'aviso automático',
  conciliar: 'revisar estados',
  pagosSinFactura: 'cobros sin factura',
  suscribirAviso: 'activar aviso automático',
  facturaElectronica: 'factura electrónica',
  facturaSIN: 'FacturaSIN',
} as const;
export const BOTONES = {
  entrar: BOTON_ENTRAR,
  reconfirmar: SESION.BOTON_RECONFIRMAR,
  guardar: 'Guardar',
  cancelar: 'Cancelar',
  reintentar: 'Reintentar',
  probar: 'Probar conexión',
  revisarEstados: 'Revisar estados',
  reprocesar: 'Reprocesar',
  copiarEnlace: 'Copiar enlace',
  reenviarInvitacion: 'Reenviar invitación',
  aceptarYContinuar: 'Aceptar y continuar',
  verAvanzado: 'Avanzado',
} as const;
export const ESTADOS = {
  activo: 'Activo', pendiente: 'Pendiente', vencido: 'Vencido', suspendido: 'Suspendido', aprobado: 'Aprobado', rechazado: 'Rechazado',
  emitida: 'Emitida', anulada: 'Anulada', conError: 'Con error', noIncluida: 'No incluida en tu plan',
} as const;
const SUSTITUCIONES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bsuscribir (?:el )?aviso( de estados)?\b/gi, GLOSARIO.suscribirAviso],
  [/\baviso de estados\b/gi, GLOSARIO.webhook],
  [/\bwebhooks?\b/gi, GLOSARIO.webhook],
  [/\bconciliar\b/gi, GLOSARIO.conciliar],
  [/\bconciliaci[oó]n\b/gi, 'revisión de estados'],
  [/\bpagos sin factura\b/gi, GLOSARIO.pagosSinFactura],
];
/** Reemplaza el vocabulario tecnico/disperso por el glosario unico (para textos recibidos del servidor). Idempotente. */
export function simplificarTexto(texto: string): string {
  let r = texto;
  for (const [re, por] of SUSTITUCIONES) r = r.replace(re, por);
  return r;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// S-07: aceptacion legal (mismo componente y mismos mensajes)
// ---------------------------------------------------------------------------------------------------------------------------------
export const LEGAL = {
  MENSAJE_MARCAR_CASILLA: 'Marca la casilla para continuar.',
  TEXTO_CASILLA: 'He leído y acepto los Términos y Condiciones, la Política de Privacidad y las Políticas de uso.',
  MENSAJE_ERROR_GENERICO: 'No pudimos registrar tu aceptación. Revisa tu conexión e inténtalo de nuevo.',
  MENSAJE_SESION: 'Tu sesión venció. Entra de nuevo con Kyros ID para continuar.',
} as const;
/** Mensaje a mostrar si el usuario pulsa «Aceptar y continuar» (null = puede continuar). Nunca queda en silencio. */
export function validarAceptacion(marcada: boolean): string | null {
  return marcada ? null : LEGAL.MENSAJE_MARCAR_CASILLA;
}
/** Mensaje legible para un error al registrar la aceptacion (estado HTTP + mensaje del servidor, si lo hay). Nunca devuelve un codigo tecnico. */
export function mensajeErrorAceptacion(estado: number | null | undefined, mensajeServidor?: string | null): string {
  if (estado === 401 || estado === 403) return LEGAL.MENSAJE_SESION;
  const m = (mensajeServidor ?? '').trim();
  const tecnico = !m || /^[A-Z0-9_]+$/.test(m) || /^(error|bad request|internal server error|failed to fetch)/i.test(m) || m.length > 200;
  return tecnico ? LEGAL.MENSAJE_ERROR_GENERICO : m;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// S-10: sin permiso
// ---------------------------------------------------------------------------------------------------------------------------------
export const SIN_PERMISO = {
  TITULO: 'No tienes permiso para ver esto',
  /** `aQuien`: quien administra el acceso en ese sistema (p. ej. «el administrador de tu consultorio»). */
  ayuda: (aQuien: string): string => `Pídele acceso a ${aQuien}. Si crees que es un error, cierra sesión y vuelve a entrar con Kyros ID.`,
  BOTON_VOLVER: 'Volver al inicio',
} as const;
/** `true` si el error HTTP significa «sin permiso» (403) y debe mostrarse la pantalla unica en vez de un error generico o una consola vacia. */
export const esSinPermiso = (estado: number | null | undefined): boolean => estado === 403;

// ---------------------------------------------------------------------------------------------------------------------------------
// S-11: demostracion · S-12: notificaciones
// ---------------------------------------------------------------------------------------------------------------------------------
export const DEMOSTRACION = {
  TITULO: 'Demostración',
  AVISO_PERMANENTE: 'Esto es una demostración: los datos son de ejemplo y no son reales. No uses información de personas ni de clientes reales.',
  BOTON_MOSTRAR_CONTRASENA: 'Mostrar contraseña de la cuenta de prueba',
  BOTON_OCULTAR_CONTRASENA: 'Ocultar contraseña',
} as const;
/** La contrasena demo nunca va en claro: oculta (puntos) hasta que se pulsa el boton. */
export const enmascarar = (secreto: string): string => '•'.repeat(Math.min(Math.max(secreto.length, 8), 16));
/** Ruta canonica de la pantalla de notificaciones (campana) y alias heredados que redirigen a ella. */
export const RUTA_NOTIFICACIONES = '/notificaciones';
export const ALIAS_NOTIFICACIONES: readonly string[] = ['/avisos', '/alertas'];
export const NOTIFICACIONES = { TITULO: 'Notificaciones', CAMPANA: 'Notificaciones', VACIO: 'No tienes notificaciones nuevas.', MARCAR_LEIDAS: 'Marcar todas como leídas' } as const;

// ---------------------------------------------------------------------------------------------------------------------------------
// S-08: invitaciones (enlace, vigencia visible, reenvio con un clic)
// ---------------------------------------------------------------------------------------------------------------------------------
export interface VigenciaInvitacion { vencida: boolean; diasRestantes: number; texto: string; puedeReenviar: boolean }
/** Vigencia visible de una invitacion: `venceEn` ISO. Siempre ofrece reenviar si esta vencida o vence en <= 1 dia. */
export function vigenciaInvitacion(venceEn: string | Date | null | undefined, ahora: Date = new Date()): VigenciaInvitacion {
  const sinFecha: VigenciaInvitacion = { vencida: false, diasRestantes: 0, texto: 'Sin fecha de vencimiento', puedeReenviar: true };
  if (!venceEn) return sinFecha;
  const fin = typeof venceEn === 'string' ? new Date(venceEn) : venceEn;
  if (Number.isNaN(fin.getTime())) return sinFecha;
  const ms = fin.getTime() - ahora.getTime();
  if (ms <= 0) return { vencida: true, diasRestantes: 0, texto: 'Venció. Reenvíala con un clic para generar un enlace nuevo.', puedeReenviar: true };
  const dias = Math.ceil(ms / 86_400_000);
  return { vencida: false, diasRestantes: dias, texto: dias === 1 ? 'Vence en menos de 1 día' : `Vence en ${dias} días`, puedeReenviar: dias <= 1 };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// S-06 / S-06b: vista previa de cambio de plan y funcionalidades sin precio
// ---------------------------------------------------------------------------------------------------------------------------------
export interface VistaPreviaCambioPlan {
  fechaEfectiva: string;          // AAAA-MM-DD
  vigenciaNueva: string | null;   // AAAA-MM-DD (ultimo dia cubierto)
  diasRestantes: number;
  diasExtra: number;              // dias que se SUMAN por credito (nunca se pierden)
  creditoCentavos: number | null; // null si el sistema acredita en dias y no en dinero
  costoCentavos: number | null;
  cobroCentavos: number | null;
  sinPerdidaDeDias: true;
}
const fmtBs = (c: number) => `Bs ${(c / 100).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtFecha = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
/** Lineas de la vista previa, identicas en todos los sistemas. */
export function lineasVistaPrevia(v: VistaPreviaCambioPlan): string[] {
  const l: string[] = [];
  if (v.creditoCentavos !== null) l.push(`Crédito de tu plan actual: ${fmtBs(v.creditoCentavos)}`);
  if (v.costoCentavos !== null) l.push(`Costo del plan nuevo por los días que te quedan: ${fmtBs(v.costoCentavos)}`);
  if (v.cobroCentavos !== null) l.push(`A pagar ahora: ${fmtBs(v.cobroCentavos)}`);
  l.push(`Días que te quedan: ${v.diasRestantes}`);
  if (v.diasExtra > 0) l.push(`Días que se suman a tu vigencia: ${v.diasExtra}`);
  l.push(`Rige desde: ${fmtFecha(v.fechaEfectiva)}`);
  if (v.vigenciaNueva) l.push(`Tu plan nuevo vence el: ${fmtFecha(v.vigenciaNueva)}`);
  l.push('No pierdes ningún día ya pagado.');
  return l;
}
/** Vista previa a partir del prorrateo en dinero (modelo AXION, sin tocar su matematica). */
export function vistaPreviaDeProrrateo(r: ResultadoProrrateo): VistaPreviaCambioPlan {
  return { fechaEfectiva: r.fechaEfectiva, vigenciaNueva: r.vigenciaNueva, diasRestantes: r.diasRestantes, diasExtra: r.diasExtra, creditoCentavos: r.creditoCentavos, costoCentavos: r.costoNuevoCentavos, cobroCentavos: r.cobroCentavos, sinPerdidaDeDias: true };
}
/** Lista simple (solo SuperAdmin) de funcionalidades pendientes de precio. Devuelve [] para que ninguna pantalla de cliente muestre el aviso. */
export function funcionalidadesSinPrecio<T extends { nombre: string; precio?: number | string | null }>(items: readonly T[], esSuperAdmin: boolean): string[] {
  if (!esSuperAdmin) return [];
  return items.filter((i) => i.precio === null || i.precio === undefined || i.precio === '' || Number(i.precio) === 0).map((i) => i.nombre);
}

// --- Prorrateo en dinero (copia SIN CAMBIOS de la matematica verificada de AXION `prorrateo-plan.ts`; centavos enteros, IVA incluido en el precio) ---
export interface EntradaProrrateo { hoy: string; vigenciaHasta: string | null; centavosActual: number; centavosNuevo: number; saldoPrevioCentavos?: number; mismoPlan?: boolean }
export interface ResultadoProrrateo {
  valido: boolean; motivoInvalido: 'mismo_plan' | null; vencida: boolean; fechaEfectiva: string; vigenciaActual: string | null; vigenciaNueva: string | null; diasRestantes: number; diasDelMes: number;
  creditoCentavos: number; costoNuevoCentavos: number; diferenciaCentavos: number; saldoAplicadoCentavos: number; cobroCentavos: number; diasExtra: number; saldoFinalCentavos: number;
}
const MS_DIA = 86_400_000;
const msDe = (f: string) => Date.UTC(Number(f.slice(0, 4)), Number(f.slice(5, 7)) - 1, Number(f.slice(8, 10)));
export const diasEntreFechas = (a: string, b: string): number => Math.round((msDe(b) - msDe(a)) / MS_DIA);
export const sumarDias = (f: string, n: number): string => new Date(msDe(f) + n * MS_DIA).toISOString().slice(0, 10);
const diasDelMesDe = (f: string) => new Date(Date.UTC(Number(f.slice(0, 4)), Number(f.slice(5, 7)), 0)).getUTCDate();
/** round(a × b / c) en enteros, mitad hacia arriba (a, b >= 0, c > 0). */
export const divRedondeada = (a: number, b: number, c: number): number => Math.floor((2 * a * b + c) / (2 * c));
export function calcularProrrateo(e: EntradaProrrateo): ResultadoProrrateo {
  for (const v of [e.centavosActual, e.centavosNuevo, e.saldoPrevioCentavos ?? 0]) if (!Number.isInteger(v) || v < 0) throw new RangeError('Los importes deben ser centavos enteros no negativos.');
  const diasDelMes = diasDelMesDe(e.hoy);
  const saldoPrevio = e.saldoPrevioCentavos ?? 0;
  const base: ResultadoProrrateo = {
    valido: true, motivoInvalido: null, vencida: false, fechaEfectiva: e.hoy, vigenciaActual: e.vigenciaHasta, vigenciaNueva: e.vigenciaHasta, diasRestantes: 0, diasDelMes,
    creditoCentavos: 0, costoNuevoCentavos: 0, diferenciaCentavos: 0, saldoAplicadoCentavos: 0, cobroCentavos: 0, diasExtra: 0, saldoFinalCentavos: saldoPrevio,
  };
  if (e.mismoPlan) return { ...base, valido: false, motivoInvalido: 'mismo_plan' };
  const dias = e.vigenciaHasta && e.vigenciaHasta >= e.hoy ? diasEntreFechas(e.hoy, e.vigenciaHasta) + 1 : 0;
  if (dias === 0) return { ...base, vencida: true };
  const credito = divRedondeada(e.centavosActual, dias, diasDelMes);
  const costo = divRedondeada(e.centavosNuevo, dias, diasDelMes);
  const diferencia = costo - credito;
  let aplicado = 0; let cobro = 0; let extra = 0; let saldoFinal = saldoPrevio; let vigenciaNueva = e.vigenciaHasta;
  if (diferencia > 0) {
    aplicado = Math.min(saldoPrevio, diferencia);
    cobro = diferencia - aplicado;
    saldoFinal = saldoPrevio - aplicado;
  } else if (diferencia < 0) {
    const exceso = -diferencia + saldoPrevio;
    if (e.centavosNuevo > 0) {
      extra = Math.floor((exceso * diasDelMes) / e.centavosNuevo);
      const usado = Math.floor((e.centavosNuevo * extra) / diasDelMes);
      saldoFinal = exceso - usado;
      if (extra > 0) vigenciaNueva = sumarDias(e.vigenciaHasta!, extra);
    } else saldoFinal = exceso;
  }
  return { ...base, diasRestantes: dias, creditoCentavos: credito, costoNuevoCentavos: costo, diferenciaCentavos: diferencia, saldoAplicadoCentavos: aplicado, cobroCentavos: cobro, diasExtra: extra, saldoFinalCentavos: saldoFinal, vigenciaNueva };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// S-13: codigos fiscales por rubro (lista simple que completa actividad + producto + unidad; «Avanzado» para ajustar)
// ---------------------------------------------------------------------------------------------------------------------------------
export interface RubroSin { actividadEconomica: string; descripcion: string; productosSin: ReadonlyArray<{ codigoProductoSin: string; descripcion: string; unidadMedida?: number | null }> }
export interface OpcionRubro { valor: string; etiqueta: string; actividadEconomica: string; codigoProductoSin: string; unidadMedida: number | null }
/** Lista simple y ordenada para el selector de rubro. Solo usa lo que trae el catalogo sincronizado del SIN: no se inventa ningun codigo. */
export function opcionesDeRubro(rubros: readonly RubroSin[]): OpcionRubro[] {
  const out: OpcionRubro[] = [];
  for (const a of rubros) for (const p of a.productosSin) out.push({ valor: `${a.actividadEconomica}|${p.codigoProductoSin}`, etiqueta: `${a.descripcion} — ${p.descripcion}`, actividadEconomica: a.actividadEconomica, codigoProductoSin: p.codigoProductoSin, unidadMedida: p.unidadMedida ?? null });
  return out.sort((x, y) => x.etiqueta.localeCompare(y.etiqueta, 'es'));
}
/** Texto del bloque «Avanzado» con los tres codigos; lo no confirmado se marca NO CONFIRMADO en vez de inventarse. */
export function resumenCodigosFiscales(c: { actividadEconomica?: string | null; codigoProductoSin?: string | null; unidadMedida?: number | string | null }): string[] {
  const v = (x: unknown) => (x === null || x === undefined || x === '' ? 'NO CONFIRMADO' : String(x));
  return [`Actividad económica: ${v(c.actividadEconomica)}`, `Producto del SIN: ${v(c.codigoProductoSin)}`, `Unidad de medida: ${v(c.unidadMedida)}`];
}
