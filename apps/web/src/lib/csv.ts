/**
 * gestro-p03: descarga de reportes en CSV para el contador. Formato que abre bien en el Excel de Bolivia:
 * separador «;», decimales con coma, UTF-8 con BOM (tildes y ñ correctas) y saltos de línea CRLF.
 */
export type Celda = string | number | null | undefined;

/** Un texto de la tabla: se entrecomilla si lleva «;», comillas o saltos de línea; y si empieza con = + - @ se antepone «'» para que Excel no lo ejecute como fórmula. */
export function celdaCsv(v: Celda): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v).replace('.', ',') : '';
  let t = v;
  if (/^[=+\-@\t\r]/.test(t) && !/^-?\d+([.,]\d+)?$/.test(t)) t = `'${t}`;
  if (/^-?\d+\.\d+$/.test(t)) t = t.replace('.', ',');   // «715.80» → «715,80»
  return /[;"\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

export function aCsv(columnas: string[], filas: Celda[][]): string {
  return [columnas, ...filas].map((f) => f.map(celdaCsv).join(';')).join('\r\n') + '\r\n';
}

/** Baja el archivo en el navegador (no sale nada del equipo: se arma aquí mismo con lo que ya se ve en pantalla). */
export function descargarCsv(nombre: string, columnas: string[], filas: Celda[][]): void {
  const blob = new Blob(['﻿', aCsv(columnas, filas)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a');
  a.href = url; a.download = nombre.endsWith('.csv') ? nombre : `${nombre}.csv`; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
