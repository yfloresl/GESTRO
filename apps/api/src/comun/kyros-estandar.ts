/**
 * ESTANDAR KYROS v1.1 (QA-SIMPLIFICACION S-02..S-13). Lógica y textos comunes, SIN dependencias.
 * Copia idéntica en los 7 sistemas (web: src/lib/kyros-estandar.ts; la API puede importar la misma copia en su src/).
 * NO editar en un solo sistema: se cambia en QA/estandar-kyros/ y se copia a todos (verificar con md5).
 */

// ---------------------------------------------------------------- S-03 sesión y reconfirmación
/** Duración máxima de una sesión de trabajo: 8 horas (28 800 s). Se envía como `max_age` en el ingreso normal. */
export const SESION_MAX_AGE_S = 28_800;
/** Acciones sensibles (secretos, interruptores, cobros, cambios de plataforma): haber confirmado la identidad hace 5 minutos o menos. */
export const REAUTH_SENSIBLE_MAX_MIN = 5;
export const REAUTH_SENSIBLE_MAX_AGE_S = REAUTH_SENSIBLE_MAX_MIN * 60;
/**
 * Constante estándar para quien exija reconfirmar SIEMPRE (Dental lo usaba: prompt=login, max_age=0).
 * Por defecto false en los 7. Si un sistema necesita endurecerlo, cambia SOLO esta constante (y lo documenta); no hay variantes sueltas.
 */
export const FORZAR_LOGIN_SIEMPRE = false;

export type ModoIngreso = 'normal' | 'sensible';
/** Parámetros OIDC extra del ingreso. normal: max_age 28800; sensible: max_age 300. Con FORZAR_LOGIN_SIEMPRE: prompt=login y max_age=0. */
export function parametrosIngreso(modo: ModoIngreso = 'normal', forzar: boolean = FORZAR_LOGIN_SIEMPRE): Record<string, string> {
  if (forzar) return { prompt: 'login', max_age: '0' };
  return { max_age: String(modo === 'sensible' ? REAUTH_SENSIBLE_MAX_AGE_S : SESION_MAX_AGE_S) };
}
/** ¿La autenticación (auth_time en segundos) es lo bastante reciente para una acción sensible? `ahoraS` en segundos. */
export function identidadReciente(authTimeS: number | null | undefined, ahoraS: number = Math.floor(Date.now() / 1000)): boolean {
  return typeof authTimeS === 'number' && ahoraS - authTimeS <= REAUTH_SENSIBLE_MAX_AGE_S;
}
/** Códigos de error que significan «hay que reconfirmar la identidad» (los que hoy devuelven las APIs de los 7). */
const CODIGOS_REAUTH = ['REAUTH_REQUERIDA', 'REAUTENTICACION_REQUERIDA', 'SESION_ANTIGUA', 'ACR_INSUFICIENTE', 'IDENTIDAD_NO_CONFIRMADA', 'AUTH_TIME_ANTIGUO', 'REAUTENTICAR', 'PLATAFORMA_REAUTH'];
export function requiereReconfirmar(e: unknown): boolean {
  const x = e as { codigo?: string; code?: string; error?: string; message?: string; status?: number } | null;
  const c = String(x?.codigo ?? x?.code ?? x?.error ?? '').toUpperCase();
  return CODIGOS_REAUTH.some((k) => c.includes(k)) || /reconfirm|volver a ingresar|sesi[oó]n.*(antigua|vieja)|hace m[aá]s de 5 min/i.test(String(x?.message ?? ''));
}

// ---------------------------------------------------------------- textos únicos (S-02, S-03, S-07, S-10, S-11)
export type Idioma = 'es' | 'en' | 'pt';
export const TXT_ES = {
  entrarKyrosId: 'Entrar con Kyros ID',
  crearCuenta: 'Crear mi cuenta',
  reconfirmarTitulo: 'Confirma que eres tú',
  reconfirmarMensaje: 'Por seguridad, para esta acción necesitamos que confirmes tu identidad (sesión iniciada hace 5 minutos o menos).',
  confirmarIdentidad: 'Confirmar mi identidad',
  marcaCasilla: 'Marca la casilla para continuar',
  aceptoLegal: 'He leído y acepto',
  leer: 'Leer',
  sinPermisoTitulo: 'No tienes permiso para ver esto',
  sinPermisoAQuien: 'Pídele acceso a la persona que administra tu cuenta o a tu equipo de soporte.',
  sinPermisoAQuienPlataforma: 'Pídele acceso al equipo de Kyros-Tech (soporte).',
  demostracionAviso: 'Demostración: estos datos son de ejemplo, no son reales y pueden restablecerse en cualquier momento.',
  invitacionVigencia: (dias: number) => (dias <= 0 ? 'Vencida' : dias === 1 ? 'Vence mañana' : `Vence en ${dias} días`),
  reenviar: 'Reenviar invitación',
  copiarEnlace: 'Copiar enlace',
  sinNotificaciones: 'No tienes avisos nuevos.',
  campana: 'Avisos',
  marcarLeidos: 'Marcar todos como leídos',
  errorGenerico: 'No pudimos completar la acción. Intenta de nuevo y, si sigue igual, avisa a soporte.',
};
export type Textos = typeof TXT_ES;
const TXT_EN: Textos = {
  entrarKyrosId: 'Sign in with Kyros ID', crearCuenta: 'Create my account', reconfirmarTitulo: 'Confirm it is you',
  reconfirmarMensaje: 'For your security, this action requires you to confirm your identity (signed in 5 minutes ago or less).', confirmarIdentidad: 'Confirm my identity',
  marcaCasilla: 'Tick the box to continue', aceptoLegal: 'I have read and accept', leer: 'Read',
  sinPermisoTitulo: 'You do not have permission to view this', sinPermisoAQuien: 'Ask the person who manages your account or your support team for access.',
  sinPermisoAQuienPlataforma: 'Ask the Kyros-Tech team (support) for access.', demostracionAviso: 'Demo: this data is sample data, it is not real and may be reset at any time.',
  invitacionVigencia: (d: number) => (d <= 0 ? 'Expired' : d === 1 ? 'Expires tomorrow' : `Expires in ${d} days`), reenviar: 'Resend invitation', copiarEnlace: 'Copy link',
  sinNotificaciones: 'You have no new notifications.', campana: 'Notifications', marcarLeidos: 'Mark all as read', errorGenerico: 'We could not complete the action. Try again and, if it persists, contact support.',
};
const TXT_PT: Textos = {
  entrarKyrosId: 'Entrar com Kyros ID', crearCuenta: 'Criar minha conta', reconfirmarTitulo: 'Confirme que é você',
  reconfirmarMensaje: 'Por segurança, esta ação exige que você confirme sua identidade (login feito há 5 minutos ou menos).', confirmarIdentidad: 'Confirmar minha identidade',
  marcaCasilla: 'Marque a caixa para continuar', aceptoLegal: 'Li e aceito', leer: 'Ler',
  sinPermisoTitulo: 'Você não tem permissão para ver isto', sinPermisoAQuien: 'Peça acesso a quem administra sua conta ou à sua equipe de suporte.',
  sinPermisoAQuienPlataforma: 'Peça acesso à equipe da Kyros-Tech (suporte).', demostracionAviso: 'Demonstração: estes dados são de exemplo, não são reais e podem ser restabelecidos a qualquer momento.',
  invitacionVigencia: (d: number) => (d <= 0 ? 'Vencido' : d === 1 ? 'Vence amanhã' : `Vence em ${d} dias`), reenviar: 'Reenviar convite', copiarEnlace: 'Copiar link',
  sinNotificaciones: 'Você não tem avisos novos.', campana: 'Avisos', marcarLeidos: 'Marcar todos como lidos', errorGenerico: 'Não foi possível concluir a ação. Tente novamente e, se persistir, avise o suporte.',
};
/** Textos comunes por idioma (es por defecto; en y pt para los sistemas que los ofrecen). */
export function textos(idioma: Idioma | string | undefined = 'es'): Textos { return idioma === 'en' ? TXT_EN : idioma === 'pt' ? TXT_PT : TXT_ES; }
/** Compatibilidad: textos en español. */
export const TXT = TXT_ES;

// ---------------------------------------------------------------- S-04 consola «Plataforma»
export const PLATAFORMA = { nombre: 'Plataforma', ruta: '/plataforma' } as const;
export const SECCIONES_PLATAFORMA = [
  { clave: 'clientes', etiqueta: 'Clientes', ruta: '/plataforma/clientes' },
  { clave: 'planes', etiqueta: 'Planes', ruta: '/plataforma/planes' },
  { clave: 'facturacion', etiqueta: 'Facturación', ruta: '/plataforma/facturacion' },
  { clave: 'integraciones', etiqueta: 'Integraciones', ruta: '/plataforma/integraciones' },
  { clave: 'auditoria', etiqueta: 'Auditoría', ruta: '/plataforma/auditoria' },
  { clave: 'demostracion', etiqueta: 'Demostración', ruta: '/plataforma/demostracion' },
] as const;
export type SeccionPlataforma = (typeof SECCIONES_PLATAFORMA)[number]['clave'];
/** Rutas antiguas que redirigen a la canónica (usar con <Navigate replace>). Si un sistema no tiene la sección, redirige a /plataforma. */
export const REDIRECCIONES_PLATAFORMA: Record<string, string> = {
  '/admin': '/plataforma',
  '/admin/configuracion': '/plataforma/integraciones',
  '/backoffice': '/plataforma',
  '/app/plataforma': '/plataforma',
  '/app/plataforma/facturacion': '/plataforma/facturacion',
  '/admin/facturacion': '/plataforma/facturacion',
  '/backoffice/facturacion': '/plataforma/facturacion',
  '/admin/demo': '/plataforma/demostracion',
};
/** Destino de una ruta vieja, o null si no hay (o si apuntaría a sí misma: evita el bucle /plataforma → /plataforma). */
/** Destino de una ruta vieja, o null si no hay (o si apuntaría a sí misma: evita el bucle /plataforma → /plataforma). */
export function rutaCanonicaPlataforma(ruta: string): string | null {
  const limpia = ruta.replace(/\/+$/, '') || '/';
  const d = REDIRECCIONES_PLATAFORMA[limpia] ?? null;
  return d && d !== limpia ? d : null;
}
/** Primera sección disponible (inicio de Plataforma). /plataforma NO redirige a sí misma: la pantalla raíz debe navegar a esta ruta. */
export function rutaInicioPlataforma(disponibles?: readonly string[]): string {
  const s = SECCIONES_PLATAFORMA.find((x) => !disponibles || disponibles.includes(x.clave));
  return s ? s.ruta : PLATAFORMA.ruta;
}

// ---------------------------------------------------------------- S-05 glosario único (mismos nombres en los 7)
export const GLOSARIO = {
  webhook: 'Aviso de estados',
  suscribirWebhook: 'Verificar aviso de estados',
  probarEntrega: 'Probar entrega',
  reprocesar: 'Reprocesar',
  conciliar: 'Conciliar ahora',
  conectarYProbar: 'Conectar y probar',
  pagosSinFactura: 'Pagos sin factura',
  backoffice: 'Plataforma',
  tenant: 'Cliente',
  demo: 'Demostración',
  avanzado: 'Avanzado',
} as const;
/** Estados de factura y de entrega: misma palabra y mismo tono en todas las pantallas. */
export const ESTADOS = {
  pendiente: 'Pendiente', procesando: 'En proceso', emitida: 'Emitida', validada: 'Emitida', observada: 'Observada', rechazada: 'Rechazada', anulada: 'Anulada',
  entregada: 'Entregada', reintentando: 'Reintentando', fallida: 'Fallida', aplicado: 'Aplicado', ignorado: 'Ignorado', 'rechazada por firma': 'Rechazada por firma',
} as const;
export function etiquetaEstado(estado: string | null | undefined): string {
  const k = (estado ?? '').toLowerCase();
  return (ESTADOS as Record<string, string>)[k] ?? (estado ? estado.charAt(0).toUpperCase() + estado.slice(1).toLowerCase() : '—');
}
/** Reemplaza jerga técnica por el término del glosario en un texto de pantalla (red de seguridad, no sustituye redactar bien). */
export function aLenguajeSimple(t: string): string {
  return t.replace(/\bwebhooks?\b/gi, GLOSARIO.webhook.toLowerCase()).replace(/\bbackoffice\b/gi, GLOSARIO.backoffice).replace(/\btenants?\b/gi, 'cliente');
}

// ---------------------------------------------------------------- S-06b funcionalidades sin precio (solo SuperAdmin)
export interface FuncionalidadSinPrecio { clave: string; nombre: string }
/** Lista simple y SOLO para SuperAdmin de plataforma. Ninguna pantalla de cliente muestra el aviso «sin precio definido». */
export function textoFuncionalidadesSinPrecio(items: FuncionalidadSinPrecio[]): string {
  return items.length ? `Falta definir precio a ${items.length} funcionalidad${items.length === 1 ? '' : 'es'}: ${items.map((i) => i.nombre).join(', ')}.` : 'Todas las funcionalidades tienen precio.';
}
export const esAdminPlataforma = (roles: readonly string[] | null | undefined): boolean => !!roles?.some((r) => /^(superadmin|super_admin|admin_plataforma|platform_admin|plataforma_admin|administrador)$/i.test(r));

// ---------------------------------------------------------------- S-07 errores legibles tras (re)aceptar
export function mensajeLegible(e: unknown, respaldo: string = TXT.errorGenerico): string {
  if (requiereReconfirmar(e)) return `${TXT.reconfirmarMensaje} Pulsa «${TXT.confirmarIdentidad}».`;
  const m = (e as { message?: string; mensaje?: string } | null)?.mensaje ?? (e as { message?: string } | null)?.message;
  if (!m || /^(\{|\[|<)|\b(500|502|503|504)\b|failed to fetch|networkerror|unexpected token|internal server|^\w+Error:/i.test(m)) return respaldo;
  return aLenguajeSimple(m);
}

// ---------------------------------------------------------------- S-08 invitaciones
/** Días enteros que faltan para `venceEn` (ISO); 0 si ya venció. */
export function diasParaVencer(venceEn: string | Date | null | undefined, ahora: Date = new Date()): number {
  if (!venceEn) return 0;
  const ms = new Date(venceEn).getTime() - ahora.getTime();
  return ms <= 0 ? 0 : Math.ceil(ms / 86_400_000);
}
/** Vigencia estándar de toda invitación: 7 días. */
export const INVITACION_VIGENCIA_DIAS = 7;

// ---------------------------------------------------------------- S-13 rubro fiscal
/** Forma que devuelve FacturaSIN en GET .../rubros (catálogo del SIN): el sistema solo la pasa tal cual al selector. */
export interface RubroActividad { actividadEconomica: string; descripcion: string; productosSin: { codigoProductoSin: string; descripcion: string; unidadMedida?: { codigo: string | number; descripcion?: string } | null }[] }
export interface OpcionRubro { valor: string; etiqueta: string; actividadEconomica: string; codigoProductoSin: string; actividad: string; unidadMedida: string }
/** Aplana el catálogo a una lista simple de rubros («Producto — Actividad»); los códigos quedan en `valor` y se muestran solo en «Avanzado». */
export function opcionesRubro(actividades: RubroActividad[] | null | undefined): OpcionRubro[] {
  return (actividades ?? []).flatMap((a) => a.productosSin.map((p) => ({
    valor: `${a.actividadEconomica}|${p.codigoProductoSin}`, etiqueta: `${p.descripcion} — ${a.descripcion}`, actividadEconomica: a.actividadEconomica, codigoProductoSin: p.codigoProductoSin, actividad: a.descripcion,
    unidadMedida: p.unidadMedida ? `${p.unidadMedida.descripcion ? p.unidadMedida.descripcion + ' ' : ''}(${p.unidadMedida.codigo})` : NO_CONFIRMADO,
  })));
}
export const RUBRO_NOTA_SIN = 'Los códigos vienen del catálogo oficial del SIN que sincroniza FacturaSIN. Si el catálogo no responde, el sistema muestra «NO CONFIRMADO» y no inventa códigos.';
/** Unidad de medida: se completa sola por producto; «Avanzado» permite ajustarla. NO CONFIRMADO mientras FacturaSIN no devuelva el código. */
export const NO_CONFIRMADO = 'NO CONFIRMADO';

// ---------------------------------------------------------------- S-06 desglose de IVA (convención verificada del proyecto)
export const IVA_TASA_PCT = 13;
export interface DesgloseIva { netoCentavos: number; ivaCentavos: number; totalCentavos: number }
/**
 * Desglose de un importe que YA incluye IVA: el IVA contenido es el 13 % del importe total (convención del proyecto), en centavos enteros,
 * redondeo al centavo con la mitad hacia arriba; neto = total - IVA, así neto + IVA = total exacto (ej.: Bs 800,00 → IVA 104,00, neto 696,00).
 * Con BigInt: sin errores de coma flotante en totales grandes.
 */
export function desgloseIva(totalCentavos: number): DesgloseIva {
  if (!Number.isInteger(totalCentavos) || totalCentavos < 0) throw new RangeError('El importe debe ser centavos enteros no negativos.');
  const t = BigInt(totalCentavos);
  const iva = Number((t * BigInt(IVA_TASA_PCT) * 2n + 100n) / 200n);
  return { netoCentavos: totalCentavos - iva, ivaCentavos: iva, totalCentavos };
}
/** Texto simple: «IVA 13 % incluido: Bs X». `fmt` formatea centavos. */
export const textoIvaIncluido = (totalCentavos: number, fmt: (c: number) => string, idioma: Idioma | string = 'es'): string =>
  (idioma === 'en' ? `VAT 13% included: ` : idioma === 'pt' ? `IVA 13% incluído: ` : `IVA 13 % incluido: `) + fmt(desgloseIva(totalCentavos).ivaCentavos);
/** Desglose de cada importe visible de la vista previa del cambio de plan (también se guarda en la confirmación y la auditoría). */
export function desgloseCambioPlan(r: { creditoCentavos: number; costoNuevoCentavos: number; diferenciaCentavos: number; saldoAplicadoCentavos: number; cobroCentavos: number; saldoFinalCentavos: number }) {
  return {
    credito: desgloseIva(r.creditoCentavos), costoNuevo: desgloseIva(r.costoNuevoCentavos), diferencia: desgloseIva(Math.abs(r.diferenciaCentavos)), diferenciaEsSaldoAFavor: r.diferenciaCentavos < 0,
    saldoAplicado: desgloseIva(r.saldoAplicadoCentavos), cobro: desgloseIva(r.cobroCentavos), saldoFinal: desgloseIva(r.saldoFinalCentavos),
  };
}
