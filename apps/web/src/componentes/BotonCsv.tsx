import { type Celda, descargarCsv } from '../lib/csv';

/** gestro-p03: «Descargar CSV» con las mismas columnas y filas que se ven en pantalla (abre en Excel). */
export function BotonCsv({ nombre, columnas, filas, deshabilitado }: { nombre: string; columnas: string[]; filas: Celda[][]; deshabilitado?: boolean }) {
  return (
    <button type="button" disabled={deshabilitado || filas.length === 0} onClick={() => descargarCsv(nombre, columnas, filas)} className="h-12 px-space-md rounded-lg border border-outline-variant text-primary font-semibold inline-flex items-center gap-space-xs disabled:opacity-40">
      <span className="material-symbols-outlined" aria-hidden="true">download</span>Descargar CSV
    </button>
  );
}
