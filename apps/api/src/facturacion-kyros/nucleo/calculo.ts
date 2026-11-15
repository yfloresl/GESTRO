/**
 * Cálculos de la factura de Kyros-Tech a sus clientes. TODO en enteros (BigInt, centavos): nunca coma flotante.
 * Sin dependencias: se copia tal cual a otro sistema.
 *
 * Reglas (verificadas por el QA; ver docs/facturacion-kyros.md):
 *  - Precio en Bs de un plan en USD = USD x TCO del día de la validación del pago (nunca 6,96), mitad hacia arriba al centavo.
 *  - IVA 13 % (Ley 843, art. 5) «por dentro»: el precio ya lo incluye; débito fiscal = 13 % del importe facturado,
 *    mitad hacia arriba al centavo. Así lo calcula también FacturaSIN (`ivaReferencial`): 116,70 -> 15,17.
 *  - Se factura lo COBRADO (el monto del pago validado), también tras promociones, cambios de plan o prorrateos.
 */
export type Centavos = bigint;

/** Alícuota general del IVA en puntos básicos (13,00 % = 1300). Ley 843 art. 5. No cambia por decisión del dueño (Ley 1733 NO se activa). */
export const ALICUOTA_IVA_PB = 1300n;

/** «116.70» / «116,7» / 116.7 -> 11670n. Rechaza más de 2 decimales, negativos y basura (no redondea en silencio). */
export function aCentavos(valor: string | number): Centavos {
  const s = (typeof valor === 'number' ? (Number.isFinite(valor) ? String(valor) : 'x') : String(valor)).trim().replace(',', '.');
  const m = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) throw new RangeError(`Monto inválido: «${String(valor)}» (máximo 2 decimales, sin signo)`);
  return BigInt(m[1]!) * 100n + BigInt(((m[2] ?? '') + '00').slice(0, 2));
}

/** 11670n -> «116.70». */
export function deCentavos(c: Centavos): string {
  const neg = c < 0n; const a = neg ? -c : c;
  return `${neg ? '-' : ''}${a / 100n}.${String(a % 100n).padStart(2, '0')}`;
}

/** Número de dos decimales exactos (para el JSON hacia FacturaSIN, que espera `number`). */
export const comoNumero = (c: Centavos): number => Number(deCentavos(c));

/** IVA contenido en un importe: round-half-up(importe x 13 %), en centavos. 11670 -> 1517 (15,17). */
export function ivaPorDentro(totalCent: Centavos, alicuotaPb: bigint = ALICUOTA_IVA_PB): Centavos {
  if (totalCent < 0n) throw new RangeError('El importe no puede ser negativo');
  return (totalCent * alicuotaPb + 5_000n) / 10_000n;
}

/** Decimal con hasta 6 decimales («11.67», «11.675») a micro-unidades (11670000n). */
export function aMicros(valor: string | number): bigint {
  const m = /^(\d{1,6})(?:\.(\d{1,6}))?$/.exec(String(valor).trim());
  if (!m) throw new RangeError(`Tipo de cambio inválido: «${String(valor)}»`);
  const micros = BigInt(m[1]!) * 1_000_000n + BigInt(((m[2] ?? '') + '000000').slice(0, 6));
  if (micros <= 0n) throw new RangeError('El tipo de cambio debe ser mayor a cero');
  return micros;
}

/** USD x TCO -> Bs al centavo (mitad hacia arriba). 10 x 11,67 = 11670n. */
export function usdABobCent(usd: string | number, tco: string | number): Centavos {
  return (aCentavos(usd) * aMicros(tco) + 500_000n) / 1_000_000n;
}

/** Monto esperado de N meses con descuento porcentual (0-100, hasta 2 decimales) sobre el precio mensual en centavos. Mitad hacia arriba. */
export function montoMeses(precioMensualCent: Centavos, meses: number, descuentoPct: string | number = 0): Centavos {
  if (!Number.isInteger(meses) || meses < 1) throw new RangeError('Meses inválidos');
  const d = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(String(descuentoPct));
  if (!d) throw new RangeError('Descuento inválido');
  const dpb = BigInt(d[1]!) * 100n + BigInt(((d[2] ?? '') + '00').slice(0, 2)); // puntos básicos
  if (dpb > 10_000n) throw new RangeError('El descuento no puede pasar de 100 %');
  return (precioMensualCent * BigInt(meses) * (10_000n - dpb) + 5_000n) / 10_000n;
}

export interface DesgloseFactura { totalCent: Centavos; ivaCent: Centavos; total: string; iva: string }
export function desglosar(totalCent: Centavos): DesgloseFactura {
  const ivaCent = ivaPorDentro(totalCent);
  return { totalCent, ivaCent, total: deCentavos(totalCent), iva: deCentavos(ivaCent) };
}

/** Suma exacta de importes en texto («116.70») o centavos -> «233.40». Para totales de pantalla y exportación. */
export function sumar(importes: Array<string | Centavos>): string {
  return deCentavos(importes.reduce<Centavos>((a, x) => a + (typeof x === 'bigint' ? x : aCentavos(x)), 0n));
}
