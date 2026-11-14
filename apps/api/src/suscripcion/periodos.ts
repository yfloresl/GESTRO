/**
 * Fechas de suscripción (GS-C04). Todo en fechas de calendario "YYYY-MM-DD" (hora de Bolivia, sin horas),
 * sin usar Date local ni UTC: así 23:30 en La Paz nunca cambia de día.
 *
 * Regla del dueño: el cliente nunca pierde días pagados.
 *  - Renovar ANTES de vencer suma al período vigente (empieza el día siguiente al vencimiento).
 *  - Renovar DESPUÉS de vencida empieza hoy.
 *  - Mes con "día ancla": los períodos empiezan siempre el mismo día del mes (31/01, 28/02, 31/03, 30/04…);
 *    un mes corto no desplaza los períodos siguientes.
 */
export type Fecha = string;

const RE = /^(\d{4})-(\d{2})-(\d{2})$/;
export function partes(f: Fecha): { a: number; m: number; d: number } {
  const x = RE.exec(f);
  if (!x) throw new Error(`Fecha inválida: ${f}`);
  return { a: +x[1], m: +x[2], d: +x[3] };
}
export const esBisiesto = (a: number) => (a % 4 === 0 && a % 100 !== 0) || a % 400 === 0;
export const diasDelMes = (a: number, m: number) => [31, esBisiesto(a) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
const fmt = (a: number, m: number, d: number) => `${String(a).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** Número de día juliano (calendario gregoriano proléptico), para sumar y restar días sin Date. */
function aDias(f: Fecha): number {
  const { a, m, d } = partes(f);
  const y = m <= 2 ? a - 1 : a; const mm = m <= 2 ? m + 12 : m;
  return 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) + Math.floor((153 * (mm - 3) + 2) / 5) + d;
}
export const diasEntre = (desde: Fecha, hasta: Fecha) => aDias(hasta) - aDias(desde);
export function sumarDias(f: Fecha, n: number): Fecha {
  const objetivo = aDias(f) + n;
  let { a, m } = partes(f);
  // se busca el año/mes por aproximación (n es pequeño en la práctica: <= unos miles de días)
  let d = 1; let r = fmt(a, m, 1);
  const paso = n >= 0 ? 1 : -1;
  while (true) {
    const ini = aDias(fmt(a, m, 1)); const fin = ini + diasDelMes(a, m) - 1;
    if (objetivo >= ini && objetivo <= fin) { d = objetivo - ini + 1; r = fmt(a, m, d); break; }
    m += paso; if (m > 12) { m = 1; a++; } if (m < 1) { m = 12; a--; }
  }
  return r;
}

/** Suma `meses` al mes de `f` y toma el día `ancla` (recortado al largo de ese mes). */
export function sumarMesesAncla(f: Fecha, meses: number, ancla: number): Fecha {
  const { a, m } = partes(f);
  const t = a * 12 + (m - 1) + meses;
  const aa = Math.floor(t / 12); const mm = (t % 12) + 1;
  return fmt(aa, mm, Math.min(ancla, diasDelMes(aa, mm)));
}

export interface Renovacion { desde: Fecha; hasta: Fecha; ancla: number }
/**
 * Renueva `meses` meses. `hasta` = vencimiento vigente (null si nunca pagó), `ancla` = día ancla guardado.
 * Si el vigente aún no termina (o termina hoy) los meses se SUMAN a continuación; si ya venció, empieza `hoy`.
 */
export function renovar(p: { hoy: Fecha; hasta: Fecha | null; ancla: number | null; meses: number }): Renovacion {
  if (!Number.isInteger(p.meses) || p.meses < 1) throw new Error('meses debe ser un entero >= 1');
  const siguiente = p.hasta ? sumarDias(p.hasta, 1) : null;
  const continua = siguiente !== null && diasEntre(p.hoy, siguiente) >= 0; // siguiente >= hoy
  const desde = continua ? siguiente! : p.hoy;
  const ancla = continua && p.ancla ? p.ancla : partes(desde).d;
  const proximoInicio = sumarMesesAncla(desde, p.meses, ancla);
  return { desde, hasta: sumarDias(proximoInicio, -1), ancla };
}

/**
 * Cambio de plan con días restantes: el valor ya pagado se conserva. Los días restantes (contando hoy)
 * al precio viejo equivalen a floor(dias × viejo / nuevo) días del plan nuevo; el resto (menos de un día
 * del plan nuevo) queda como crédito en centavos. Todo en BigInt (centavos), sin flotantes.
 * Valor por día = precio mensual × 12 / 365 (base anual fija).
 */
export function prorrateoCambioPlan(p: { diasRestantes: number; precioViejoCent: bigint; precioNuevoCent: bigint }): { diasNuevos: number; creditoCent: bigint } {
  if (p.precioNuevoCent <= 0n) throw new Error('El plan nuevo debe tener precio');
  const dias = BigInt(Math.max(0, p.diasRestantes));
  const diasNuevos = (dias * p.precioViejoCent) / p.precioNuevoCent;
  const restoProporcional = dias * p.precioViejoCent - diasNuevos * p.precioNuevoCent; // en "centavos×día"
  const creditoCent = (restoProporcional * 12n * 2n + 365n) / (365n * 2n); // half-up
  return { diasNuevos: Number(diasNuevos), creditoCent };
}
