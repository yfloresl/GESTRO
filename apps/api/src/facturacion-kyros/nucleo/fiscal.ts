/**
 * Datos fiscales del comprador (NIT/CI, razón social) y la regla de «consumidor final / sin nombre».
 * Sin dependencias: se copia tal cual a otro sistema.
 */
export type TipoDocFiscal = 'NIT' | 'CI' | 'CEX' | 'PAS';
/** Código del catálogo de FacturaSIN/SIN (tipoDocumento). */
export const CODIGO_TIPO_DOC: Record<TipoDocFiscal, 1 | 2 | 3 | 5> = { CI: 1, CEX: 2, PAS: 3, NIT: 5 };

export interface DatosFiscales { tipo: TipoDocFiscal; numero: string; complemento?: string | null; razonSocial: string; correo?: string | null }
export type ResultadoValidacion = { ok: true; datos: DatosFiscales } | { ok: false; errores: string[] };

const limpiar = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();
const tieneControl = (s: string) => [...s].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);

/** Valida el documento fiscal del cliente. NIT: 5 a 13 dígitos sin ceros a la izquierda; CI: 4 a 10 dígitos (+ complemento de 1-2 letras/dígitos). */
export function validarDatosFiscales(e: { tipo?: string | null; numero?: string | null; complemento?: string | null; razonSocial?: string | null; correo?: string | null }): ResultadoValidacion {
  const errores: string[] = [];
  const tipo = (limpiar(e.tipo) || 'NIT').toUpperCase() as TipoDocFiscal;
  const numero = limpiar(e.numero).replace(/[\s.-]/g, '');
  const complemento = limpiar(e.complemento).toUpperCase() || null;
  const razonSocial = limpiar(e.razonSocial);
  const correo = limpiar(e.correo).toLowerCase() || null;
  if (!(tipo in CODIGO_TIPO_DOC)) errores.push('Tipo de documento inválido (NIT, CI, CEX o PAS).');
  else if (tipo === 'NIT' && !/^[1-9]\d{4,12}$/.test(numero)) errores.push('El NIT debe tener de 5 a 13 dígitos, sin ceros a la izquierda.');
  else if (tipo === 'CI' && !/^\d{4,10}$/.test(numero)) errores.push('La cédula de identidad debe tener de 4 a 10 dígitos.');
  else if ((tipo === 'CEX' || tipo === 'PAS') && !/^[0-9A-Za-z]{4,20}$/.test(numero)) errores.push('El documento debe tener de 4 a 20 letras o dígitos.');
  if (complemento && (tipo !== 'CI' || !/^[0-9A-Z]{1,2}$/.test(complemento))) errores.push('El complemento solo aplica a la CI y tiene 1 o 2 caracteres.');
  if (razonSocial.length < 2 || razonSocial.length > 150 || tieneControl(razonSocial)) errores.push('La razón social debe tener de 2 a 150 caracteres.');
  if (correo && (correo.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(correo))) errores.push('El correo no es válido.');
  return errores.length ? { ok: false, errores } : { ok: true, datos: { tipo, numero, complemento, razonSocial, correo } };
}

/**
 * Comprador «consumidor final / sin nombre»: CI 0 y razón social «S/N». Es la práctica del SIN para ventas a quien no da datos;
 * FacturaSIN NO lo documenta como caso propio (NO verificado con el SIN): si lo rechaza, la factura queda pendiente con el motivo.
 * Nunca se usa solo: lo decide una persona (botón «Emitir como consumidor final») y queda marcado en la factura.
 */
export const COMPRADOR_CONSUMIDOR_FINAL = { tipoDocumento: 1 as const, numeroDocumento: '0', razonSocial: 'S/N' };
