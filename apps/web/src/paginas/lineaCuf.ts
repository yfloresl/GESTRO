/** Línea «CUF … · Emitida el <fecha>» de la tarjeta de factura de Kyros-Tech (DN-F13). */
export function lineaCuf(cuf: string | null | undefined, emitidaEn: string | null | undefined, etiquetaFecha: (fecha: string) => string, formatear: (iso: string) => string | null | undefined): string | null {
  if (!cuf) return null;
  return emitidaEn ? `CUF ${cuf} · ${etiquetaFecha(formatear(emitidaEn) ?? emitidaEn)}` : `CUF ${cuf}`;
}
