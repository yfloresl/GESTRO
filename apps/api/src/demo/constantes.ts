/**
 * Cuentas de demostración del ecosistema Kyros (Prueba_Kyros). Las crea el aprovisionamiento de Identidad con `sub` FIJO; cada sistema las
 * pre-vincula al cargar su demostración. El `sub` no cambia mientras exista el usuario en Kyros ID. Son identificadores públicos, no secretos.
 */
export const SUB_PRUEBA_KYROS = '3c183200-ca0f-483f-90fd-2cea6c0b0695';             // administrador del negocio de ejemplo
export const SUB_PRUEBA_KYROS_ASISTENTE = '92209c11-c4a6-40ce-ae54-e607ffc64891';   // personal de caja / recepción
export const SUB_PRUEBA_KYROS_TUTOR = '3969cf14-de90-458c-b2bc-d287adc1469b';       // cliente: GESTRO no lo usa

/** Cuentas por rol (para mostrar el menú de cada rol y el 403 sin permiso). Identidad las crea con ESTE `sub` fijo (rama feat/demo-cuentas-extra), públicas con la clave demo y sin contraseña local en GESTRO. */
export const SUB_PRUEBA_KYROS_MESERO = '0f4d6bd2-ab9b-482e-9e21-e0bf61a0b584';
export const SUB_PRUEBA_KYROS_COCINA = '75ec2b33-5e9d-4712-895d-552cb49daf4b';
export const SUB_PRUEBA_KYROS_ALMACEN = 'cf1b7962-1bb4-4526-a563-e2d805e1ffa7';
export const SUB_PRUEBA_KYROS_COBRANZAS = '97c3f591-1fa7-4487-958a-8fa1f43dc556';
export const SUB_PRUEBA_KYROS_AREA = '0819aca5-6243-498f-a725-3069c40f0748';
export const SUB_PRUEBA_KYROS_CONTADOR = '76f5c6e8-ff7e-40b5-b2c7-1ab52a0fca35';

export const SUBS_DE_DEMOSTRACION: readonly string[] = [SUB_PRUEBA_KYROS, SUB_PRUEBA_KYROS_ASISTENTE, SUB_PRUEBA_KYROS_TUTOR, SUB_PRUEBA_KYROS_MESERO, SUB_PRUEBA_KYROS_COCINA, SUB_PRUEBA_KYROS_ALMACEN, SUB_PRUEBA_KYROS_COBRANZAS, SUB_PRUEBA_KYROS_CONTADOR, SUB_PRUEBA_KYROS_AREA];
export const esSubDeDemostracion = (sub: string) => SUBS_DE_DEMOSTRACION.includes(sub);

/** Mientras no haya demostración cargada, estas cuentas no entran (401, como un token inválido). */
export const CUENTAS_DEMO = [
  { sub: SUB_PRUEBA_KYROS, usuario: 'prueba_kyros', correo: 'prueba_kyros@demo.kyros.invalid', nombre: 'Prueba Kyros', rol: 'owner' as const },
  { sub: SUB_PRUEBA_KYROS_ASISTENTE, usuario: 'prueba_kyros_asistente', correo: 'prueba_kyros_asistente@demo.kyros.invalid', nombre: 'Prueba Kyros Asistente', rol: 'cajero' as const },
  { sub: SUB_PRUEBA_KYROS_MESERO, usuario: 'prueba_kyros_gestro_mesero', correo: 'prueba_kyros_gestro_mesero@demo.kyros.invalid', nombre: 'Prueba Kyros Mesero', rol: 'mesero' as const },
  { sub: SUB_PRUEBA_KYROS_COCINA, usuario: 'prueba_kyros_gestro_cocina', correo: 'prueba_kyros_gestro_cocina@demo.kyros.invalid', nombre: 'Prueba Kyros Cocina', rol: 'cocina' as const },
  { sub: SUB_PRUEBA_KYROS_ALMACEN, usuario: 'prueba_kyros_gestro_almacen', correo: 'prueba_kyros_gestro_almacen@demo.kyros.invalid', nombre: 'Prueba Kyros Almacén', rol: 'almacen' as const },
  { sub: SUB_PRUEBA_KYROS_COBRANZAS, usuario: 'prueba_kyros_gestro_cobranzas', correo: 'prueba_kyros_gestro_cobranzas@demo.kyros.invalid', nombre: 'Prueba Kyros Cobranzas', rol: 'cobranzas' as const },
  { sub: SUB_PRUEBA_KYROS_CONTADOR, usuario: 'prueba_kyros_gestro_contador', correo: 'prueba_kyros_gestro_contador@demo.kyros.invalid', nombre: 'Prueba Kyros Contador', rol: 'contador' as const },
  { sub: SUB_PRUEBA_KYROS_AREA, usuario: 'prueba_kyros_gestro_area', correo: 'prueba_kyros_gestro_area@demo.kyros.invalid', nombre: 'Prueba Kyros Área', rol: 'area_manager' as const },
];

/** Tiempo mínimo entre dos «Restablecer mis datos de muestra». */
export const ESPERA_REINICIO_MIN = 5;
