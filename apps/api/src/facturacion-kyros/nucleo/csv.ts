/**
 * Exportación CSV segura. Sin dependencias.
 * Contra la inyección de fórmulas (CSV/Excel injection): una celda de TEXTO que empieza por = + - @ tab o retorno se
 * antepone con una comilla simple. Los importes se escriben aparte con `celdaNumero` (solo aceptan decimales válidos).
 */
export function celdaTexto(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  const peligrosa = /^[=+\-@\t\r\n]/.test(s); // se mira ANTES de normalizar: un salto de línea inicial también abre una fórmula
  s = s.replace(/\r\n|\r|\n/g, ' '); // una fila = una línea
  if (peligrosa) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}
export function celdaNumero(v: string | number | bigint | null): string {
  if (v === null) return '';
  const s = String(v);
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new RangeError(`Número inválido en CSV: ${s}`);
  return s;
}
export const filaCsv = (celdas: string[]) => celdas.join(',');
/** BOM para que Excel abra bien los acentos. */
export const BOM = '﻿';
