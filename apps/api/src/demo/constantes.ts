/**
 * Cuentas de demostración del ecosistema Kyros (Prueba_Kyros). Las crea el aprovisionamiento de Identidad con `sub` FIJO; cada sistema las
 * pre-vincula al cargar su demostración. El `sub` no cambia mientras exista el usuario en Kyros ID. Son identificadores públicos, no secretos.
 */
export const SUB_PRUEBA_KYROS = '3c183200-ca0f-483f-90fd-2cea6c0b0695';             // administrador del negocio de ejemplo
export const SUB_PRUEBA_KYROS_ASISTENTE = '92209c11-c4a6-40ce-ae54-e607ffc64891';   // personal de caja / recepción
export const SUB_PRUEBA_KYROS_TUTOR = '3969cf14-de90-458c-b2bc-d287adc1469b';       // cliente: GESTRO no lo usa

export const SUBS_DE_DEMOSTRACION: readonly string[] = [SUB_PRUEBA_KYROS, SUB_PRUEBA_KYROS_ASISTENTE, SUB_PRUEBA_KYROS_TUTOR];
export const esSubDeDemostracion = (sub: string) => SUBS_DE_DEMOSTRACION.includes(sub);

/** Mientras no haya demostración cargada, estas cuentas no entran (401, como un token inválido). */
export const CUENTAS_DEMO = [
  { sub: SUB_PRUEBA_KYROS, usuario: 'prueba_kyros', correo: 'prueba_kyros@demo.kyros.invalid', nombre: 'Prueba Kyros', rol: 'owner' as const },
  { sub: SUB_PRUEBA_KYROS_ASISTENTE, usuario: 'prueba_kyros_asistente', correo: 'prueba_kyros_asistente@demo.kyros.invalid', nombre: 'Prueba Kyros Asistente', rol: 'cajero' as const },
];

/** Tiempo mínimo entre dos «Restablecer mis datos de muestra». */
export const ESPERA_REINICIO_MIN = 5;
