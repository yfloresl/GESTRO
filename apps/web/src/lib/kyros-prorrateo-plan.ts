/** ESTANDAR KYROS v1.1 (S-06). Copia idéntica del módulo verificado de AXION. NO editar en un solo sistema: cambia aquí y copia a los 7. */
/**
 * AX-095: prorrateo del cambio de plan, puro y en CENTAVOS ENTEROS (sin decimales flotantes). Orden del dueño: la suscripción nunca pierde días.
 * Los precios mensuales YA incluyen el IVA (13 % por dentro): aquí no se suma ni se separa impuesto alguno.
 *
 * - `vigenciaHasta` es el último día cubierto (inclusive); hoy cuenta como día restante. Días restantes = hasta - hoy + 1 (0 si ya venció o no hay vigencia).
 * - Tarifa diaria = precio mensual / días del mes de hoy (la misma base del prorrateo del simulador).
 * - crédito = round(actual × días / díasMes); costo nuevo = round(nuevo × días / díasMes); redondeo a centavo entero (mitad hacia arriba).
 * - diferencia = costo nuevo - crédito. > 0: se cobra (primero se aplica el saldo a favor previo). < 0: el exceso NO se descarta: se convierte en
 *   días extra del plan nuevo (se suman a la vigencia) y el resto menor a un día queda como saldo a favor en centavos.
 */
// Utilidades de fecha copiadas TAL CUAL de AXION (apps/api/src/comun/vigencia.ts); la matemática de abajo no se toca.
export function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + dias); return d.toISOString().slice(0, 10);
}
export const diasEntreFechas = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

export interface EntradaProrrateo {
  hoy: string;                       // AAAA-MM-DD, fecha de Bolivia
  vigenciaHasta: string | null;
  centavosActual: number;            // precio mensual del plan actual, en centavos, IVA incluido
  centavosNuevo: number;
  saldoPrevioCentavos?: number;
  mismoPlan?: boolean;
}

export interface ResultadoProrrateo {
  valido: boolean;
  motivoInvalido: 'mismo_plan' | null;
  vencida: boolean;
  fechaEfectiva: string;
  vigenciaActual: string | null;
  vigenciaNueva: string | null;
  diasRestantes: number;
  diasDelMes: number;
  creditoCentavos: number;
  costoNuevoCentavos: number;
  diferenciaCentavos: number;        // costo nuevo - crédito (puede ser negativa)
  saldoAplicadoCentavos: number;     // del saldo previo, aplicado al cobro
  cobroCentavos: number;             // a cobrar ahora (>= 0), ya descontado el saldo aplicado
  diasExtra: number;                 // días que se suman a la vigencia por un crédito mayor que el costo
  saldoFinalCentavos: number;        // saldo a favor que queda después del cambio
}

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
  if (dias === 0) return { ...base, vencida: true };   // vencida: nada que acreditar ni cobrar; el plan nuevo rige desde hoy y el cliente renueva con el precio nuevo
  const credito = divRedondeada(e.centavosActual, dias, diasDelMes);
  const costo = divRedondeada(e.centavosNuevo, dias, diasDelMes);
  const diferencia = costo - credito;
  let aplicado = 0; let cobro = 0; let extra = 0; let saldoFinal = saldoPrevio; let vigenciaNueva = e.vigenciaHasta;
  if (diferencia > 0) {
    aplicado = Math.min(saldoPrevio, diferencia);
    cobro = diferencia - aplicado;
    saldoFinal = saldoPrevio - aplicado;
  } else if (diferencia < 0) {
    const exceso = -diferencia + saldoPrevio;   // el saldo previo también se convierte en días
    if (e.centavosNuevo > 0) {
      extra = Math.floor((exceso * diasDelMes) / e.centavosNuevo);
      const usado = Math.floor((e.centavosNuevo * extra) / diasDelMes);   // floor: nunca supera el exceso
      saldoFinal = exceso - usado;
      if (extra > 0) vigenciaNueva = sumarDias(e.vigenciaHasta!, extra);
    } else saldoFinal = exceso;                 // plan nuevo sin precio: todo queda como saldo, nada se pierde
  }
  return { ...base, diasRestantes: dias, creditoCentavos: credito, costoNuevoCentavos: costo, diferenciaCentavos: diferencia, saldoAplicadoCentavos: aplicado, cobroCentavos: cobro, diasExtra: extra, saldoFinalCentavos: saldoFinal, vigenciaNueva };
}
