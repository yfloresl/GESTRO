import Decimal from 'decimal.js';

export interface Conciliacion {
  /** Suma de platos vendidos a precio de lista. */ ventasAPrecioLista: string;
  /** Descuentos registrados en los cobros del período. */ descuentos: string;
  /** Lo realmente cobrado (igual a «Ingresos» del Resumen). */ ingresos: string;
  /** precio de lista − descuentos − ingresos. Debe ser 0,00; si no, hay una diferencia SIN explicar que se muestra tal cual. */ diferenciaSinExplicar: string;
}

/** gestro-024: ventas por plato (a precio de lista) = Ingresos + Descuentos. No ajusta nada: si no cuadra, expone la diferencia. */
export function conciliarVentas(ventasLista: Decimal.Value, descuentos: Decimal.Value, ingresos: Decimal.Value): Conciliacion {
  const f = (v: Decimal.Value) => new Decimal(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const l = f(ventasLista); const d = f(descuentos); const i = f(ingresos);
  return { ventasAPrecioLista: l.toFixed(2), descuentos: d.toFixed(2), ingresos: i.toFixed(2), diferenciaSinExplicar: l.minus(d).minus(i).toFixed(2) };
}

export interface FilaV { clave: string; etiqueta: string; ventas: string; cantidad: string; participacionPct: string }
const DIAS = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

/** gestro-023: la hora (o el día) sin ventas aparece con cero entre la primera y la última, para que se vean los valles y no solo dos barras sueltas. Las filas ya vienen ordenadas. */
export function rellenarHuecos(filas: FilaV[], grupo: 'hora' | 'dia_semana'): FilaV[] {
  if (!filas.length) return filas;
  const claves = filas.map((f) => Number(f.clave)); const ini = grupo === 'hora' ? Math.min(...claves) : 1; const fin = grupo === 'hora' ? Math.max(...claves) : 7;
  const por = new Map(filas.map((f) => [Number(f.clave), f]));
  const r: FilaV[] = [];
  for (let k = ini; k <= fin; k++) r.push(por.get(k) ?? { clave: String(k), etiqueta: grupo === 'hora' ? `${String(k).padStart(2, '0')}:00` : DIAS[k], ventas: '0.00', cantidad: '0', participacionPct: '0.00' });
  return r;
}
