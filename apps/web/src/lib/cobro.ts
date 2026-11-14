/**
 * GST-004: cálculo del cobro en CENTAVOS enteros (sin flotantes). Es el mismo que hace el servidor (api/src/pedidos/cobro-calculo.ts):
 * la pantalla solo anticipa lo que el servidor va a validar, el servidor manda.
 */
export const DESCUENTO_MAX_PCT = 30;
export const PROPINA_MAX_PCT = 30;

/** "12", "12,5", "12.50" → 1250. null si no es un monto con a lo más 2 decimales. Vacío = 0. */
export function aCentavos(v: string): number | null {
  const t = v.trim().replace(',', '.');
  if (t === '') return 0;
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(t);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || '0');
}
export const deCentavos = (c: number) => `${Math.floor(c / 100)}.${String(c % 100).padStart(2, '0')}`;

export interface EntradaCobro { subtotal: number; descuento: string; motivo: string; propina: string; metodo: string; recibido: string }
export interface ResultadoCobro { descuento: number; total: number; propina: number; aCobrar: number; recibido: number | null; vuelto: number | null; error: string | null }

export function calcularCobro(e: EntradaCobro): ResultadoCobro {
  const vacio = { descuento: 0, total: e.subtotal, propina: 0, aCobrar: e.subtotal, recibido: null, vuelto: null };
  const d = aCentavos(e.descuento); const pr = aCentavos(e.propina);
  if (d === null) return { ...vacio, error: 'El descuento debe ser un monto válido (máximo 2 decimales).' };
  if (pr === null) return { ...vacio, error: 'La propina debe ser un monto válido (máximo 2 decimales).' };
  if (d > 0 && e.motivo.trim().length < 3) return { ...vacio, descuento: d, total: Math.max(0, e.subtotal - d), error: 'Escribe el motivo del descuento (mínimo 3 letras).' };
  const topeD = Math.floor((e.subtotal * DESCUENTO_MAX_PCT) / 100);
  if (d > topeD) return { ...vacio, descuento: d, error: `El descuento no puede pasar del ${DESCUENTO_MAX_PCT} % (Bs ${deCentavos(topeD)}).` };
  const total = e.subtotal - d;
  const topeP = Math.floor((total * PROPINA_MAX_PCT) / 100);
  if (pr > topeP) return { ...vacio, descuento: d, total, propina: pr, aCobrar: total + pr, error: `La propina no puede pasar del ${PROPINA_MAX_PCT} % (Bs ${deCentavos(topeP)}).` };
  if (pr > 0 && e.metodo === 'credito') return { ...vacio, descuento: d, total, aCobrar: total, error: 'Una venta a crédito no lleva propina.' };
  const aCobrar = total + pr;
  let recibido: number | null = null; let vuelto: number | null = null;
  if (e.metodo === 'efectivo' && e.recibido.trim() !== '') {
    const r = aCentavos(e.recibido);
    if (r === null) return { descuento: d, total, propina: pr, aCobrar, recibido: null, vuelto: null, error: 'El efectivo recibido debe ser un monto válido.' };
    recibido = r;
    if (r < aCobrar) return { descuento: d, total, propina: pr, aCobrar, recibido, vuelto: null, error: `Faltan Bs ${deCentavos(aCobrar - r)} para cubrir el cobro.` };
    vuelto = r - aCobrar;
  }
  return { descuento: d, total, propina: pr, aCobrar, recibido, vuelto, error: null };
}
