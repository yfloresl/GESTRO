import Decimal from 'decimal.js';

/**
 * Generadores de asientos contables: funciones PURAS (sin base de datos) que reciben un hecho del negocio y devuelven las
 * líneas de partida doble. Cada una se ejecuta dentro de la transacción del hecho. Dinero siempre con decimal.js y a 2 decimales.
 * Las tasas de impuestos llegan como parámetros de la sucursal: aquí no hay ninguna constante tributaria.
 */
Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export type ClaveCuenta =
  | 'caja' | 'bancos' | 'cxc' | 'inventarios' | 'credito_fiscal' | 'proveedores' | 'debito_fiscal' | 'it_por_pagar'
  | 'anticipos' | 'capital' | 'resultados_acumulados' | 'ventas' | 'costo_ventas' | 'mermas' | 'ajustes_inventario' | 'gastos_generales';
export interface LineaAsiento { cuenta: ClaveCuenta; debe: string; haber: string }
export interface Asiento { glosa: string; lineas: LineaAsiento[] }

const d2 = (v: Decimal.Value) => new Decimal(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const f2 = (v: Decimal) => v.toFixed(2);
const debe = (cuenta: ClaveCuenta, v: Decimal): LineaAsiento => ({ cuenta, debe: f2(v), haber: '0.00' });
const haber = (cuenta: ClaveCuenta, v: Decimal): LineaAsiento => ({ cuenta, debe: '0.00', haber: f2(v) });

export class AsientoDescuadrado extends Error {}

/** Verifica debe = haber. Nunca debería fallar con estos generadores; protege contra cambios futuros. */
export function validarPartidaDoble(a: Asiento): void {
  const sd = a.lineas.reduce((s, l) => s.plus(l.debe), new Decimal(0)); const sh = a.lineas.reduce((s, l) => s.plus(l.haber), new Decimal(0));
  if (!sd.eq(sh) || sd.lte(0)) throw new AsientoDescuadrado(`Asiento descuadrado: debe ${f2(sd)} ≠ haber ${f2(sh)}`);
  for (const l of a.lineas) if (new Decimal(l.debe).gt(0) === new Decimal(l.haber).gt(0)) throw new AsientoDescuadrado('Cada línea es débito o crédito, no ambos ni ninguno');
}

const hecho = (glosa: string, lineas: LineaAsiento[]): Asiento => { const a = { glosa, lineas }; validarPartidaDoble(a); return a; };
const positivo = (v: Decimal.Value, que: string): Decimal => { const x = d2(v); if (x.lte(0)) throw new AsientoDescuadrado(`${que} debe ser mayor a cero`); return x; };

/** En Bolivia el IVA va incluido en el precio: la parte de IVA de un importe con IVA = importe × tasa ÷ (100 + tasa). */
export const ivaIncluido = (importe: Decimal.Value, ivaPct: Decimal.Value): Decimal => d2(new Decimal(importe).mul(ivaPct).div(new Decimal(100).plus(ivaPct)));

export type MetodoCobro = 'efectivo' | 'qr' | 'tarjeta' | 'transferencia' | 'credito';
const cuentaDeCobro = (m: MetodoCobro): ClaveCuenta => (m === 'efectivo' ? 'caja' : m === 'credito' ? 'cxc' : 'bancos');

/** Venta cobrada. Con factura separa el débito fiscal del IVA; con recibo o sin documento, todo es venta. */
export function ventaCobrada(p: { total: Decimal.Value; metodo: MetodoCobro; documento: 'factura' | 'recibo' | 'ninguno'; ivaPct: Decimal.Value }): Asiento {
  const total = positivo(p.total, 'El total de la venta');
  if (p.documento === 'factura') {
    const iva = ivaIncluido(total, p.ivaPct);
    return hecho('Venta con factura', [debe(cuentaDeCobro(p.metodo), total), haber('ventas', total.minus(iva)), ...(iva.gt(0) ? [haber('debito_fiscal', iva)] : [])]);
  }
  return hecho(p.documento === 'recibo' ? 'Venta con recibo' : 'Venta sin documento', [debe(cuentaDeCobro(p.metodo), total), haber('ventas', total)]);
}

/** Costo de lo vendido: sale del inventario lo que se consumió al enviar a cocina, valorizado al costo promedio. */
export function costoDeVentas(p: { valor: Decimal.Value }): Asiento {
  const v = positivo(p.valor, 'El costo de ventas');
  return hecho('Costo de ventas', [debe('costo_ventas', v), haber('inventarios', v)]);
}

/** Compra recibida a crédito del proveedor. Si la factura trae IVA, el crédito fiscal se separa del inventario. */
export function compraRecibida(p: { total: Decimal.Value; conIva: boolean; ivaPct: Decimal.Value }): Asiento {
  const total = positivo(p.total, 'El total de la compra');
  if (!p.conIva) return hecho('Compra a proveedor', [debe('inventarios', total), haber('proveedores', total)]);
  const iva = ivaIncluido(total, p.ivaPct);
  return hecho('Compra con factura', [debe('inventarios', total.minus(iva)), ...(iva.gt(0) ? [debe('credito_fiscal', iva)] : []), haber('proveedores', total)]);
}

/** Compra pagada al contado que entra directo al kardex (sin orden de compra). */
export function compraAlContado(p: { total: Decimal.Value }): Asiento {
  const total = positivo(p.total, 'El total de la compra');
  return hecho('Compra al contado', [debe('inventarios', total), haber('caja', total)]);
}

export function pagoAProveedor(p: { monto: Decimal.Value; via: 'caja' | 'bancos' }): Asiento {
  const m = positivo(p.monto, 'El pago');
  return hecho('Pago a proveedor', [debe('proveedores', m), haber(p.via, m)]);
}

export function cobroDeCuenta(p: { monto: Decimal.Value; via: 'caja' | 'bancos' }): Asiento {
  const m = positivo(p.monto, 'El cobro');
  return hecho('Cobro de cuenta por cobrar', [debe(p.via, m), haber('cxc', m)]);
}

/** Cobro de un evento antes de que se realice: es dinero del cliente (pasivo), todavía no es venta. */
export function pagoDeEvento(p: { monto: Decimal.Value; via: 'caja' | 'bancos' }): Asiento {
  const m = positivo(p.monto, 'El cobro del evento');
  return hecho('Cobro de evento (anticipo)', [debe(p.via, m), haber('anticipos', m)]);
}

/** Evento realizado: lo cobrado por adelantado pasa a ventas y lo que falta queda por cobrar al cliente. */
export function cierreDeEvento(p: { total: Decimal.Value; pagado: Decimal.Value }): Asiento {
  const total = positivo(p.total, 'El total del evento'); const pagado = d2(p.pagado);
  if (pagado.lt(0) || pagado.gt(total)) throw new AsientoDescuadrado('Lo cobrado no puede superar el total del evento');
  const saldo = total.minus(pagado);
  return hecho('Evento realizado', [...(pagado.gt(0) ? [debe('anticipos', pagado)] : []), ...(saldo.gt(0) ? [debe('cxc', saldo)] : []), haber('ventas', total)]);
}

export function merma(p: { valor: Decimal.Value }): Asiento {
  const v = positivo(p.valor, 'El valor de la merma');
  return hecho('Merma de inventario', [debe('mermas', v), haber('inventarios', v)]);
}

/** Ajuste de inventario por conteo o corrección: positivo = sobrante, negativo = faltante. Cero no genera asiento. */
export function ajusteDeInventario(p: { valor: Decimal.Value }): Asiento | null {
  const v = d2(p.valor);
  if (v.isZero()) return null;
  return v.gt(0) ? hecho('Ajuste de inventario (sobrante)', [debe('inventarios', v), haber('ajustes_inventario', v)]) : hecho('Ajuste de inventario (faltante)', [debe('ajustes_inventario', v.abs()), haber('inventarios', v.abs())]);
}

/** Contrarresta un asiento (anulación de una venta): mismas cuentas con debe y haber intercambiados. */
export function contrarrestar(a: Asiento, glosa = `Anulación: ${a.glosa}`): Asiento {
  return hecho(glosa, a.lineas.map((l) => ({ cuenta: l.cuenta, debe: l.haber, haber: l.debe })));
}

/* ---------- Plan de cuentas para restaurantes (plantilla editable por sucursal) ---------- */

export type TipoCuenta = 'activo' | 'pasivo' | 'patrimonio' | 'ingreso' | 'costo' | 'gasto';
export interface CuentaPlantilla { code: string; name: string; type: TipoCuenta; parent?: string; key?: ClaveCuenta; groups?: boolean }
export const PLAN_DE_CUENTAS: CuentaPlantilla[] = [
  { code: '1', name: 'ACTIVO', type: 'activo', groups: true }, { code: '1.1', name: 'Activo corriente', type: 'activo', parent: '1', groups: true },
  { code: '1.1.01', name: 'Caja', type: 'activo', parent: '1.1', key: 'caja' }, { code: '1.1.02', name: 'Bancos', type: 'activo', parent: '1.1', key: 'bancos' },
  { code: '1.1.03', name: 'Cuentas por cobrar', type: 'activo', parent: '1.1', key: 'cxc' }, { code: '1.1.04', name: 'Inventarios', type: 'activo', parent: '1.1', key: 'inventarios' },
  { code: '1.1.05', name: 'Crédito fiscal IVA', type: 'activo', parent: '1.1', key: 'credito_fiscal' },
  { code: '2', name: 'PASIVO', type: 'pasivo', groups: true }, { code: '2.1', name: 'Pasivo corriente', type: 'pasivo', parent: '2', groups: true },
  { code: '2.1.01', name: 'Proveedores por pagar', type: 'pasivo', parent: '2.1', key: 'proveedores' }, { code: '2.1.02', name: 'Débito fiscal IVA', type: 'pasivo', parent: '2.1', key: 'debito_fiscal' },
  { code: '2.1.03', name: 'IT por pagar', type: 'pasivo', parent: '2.1', key: 'it_por_pagar' }, { code: '2.1.04', name: 'Anticipos de clientes', type: 'pasivo', parent: '2.1', key: 'anticipos' },
  { code: '3', name: 'PATRIMONIO', type: 'patrimonio', groups: true }, { code: '3.1', name: 'Capital y resultados', type: 'patrimonio', parent: '3', groups: true },
  { code: '3.1.01', name: 'Capital', type: 'patrimonio', parent: '3.1', key: 'capital' }, { code: '3.1.02', name: 'Resultados acumulados', type: 'patrimonio', parent: '3.1', key: 'resultados_acumulados' },
  { code: '4', name: 'INGRESOS', type: 'ingreso', groups: true }, { code: '4.1', name: 'Ingresos por ventas', type: 'ingreso', parent: '4', groups: true },
  { code: '4.1.01', name: 'Ventas', type: 'ingreso', parent: '4.1', key: 'ventas' },
  { code: '5', name: 'COSTOS Y GASTOS', type: 'gasto', groups: true }, { code: '5.1', name: 'Costo de ventas', type: 'costo', parent: '5', groups: true },
  { code: '5.1.01', name: 'Costo de ventas', type: 'costo', parent: '5.1', key: 'costo_ventas' }, { code: '5.1.02', name: 'Mermas', type: 'costo', parent: '5.1', key: 'mermas' },
  { code: '5.1.03', name: 'Ajustes de inventario', type: 'costo', parent: '5.1', key: 'ajustes_inventario' },
  { code: '5.2', name: 'Gastos de operación', type: 'gasto', parent: '5', groups: true },
  { code: '5.2.01', name: 'Sueldos y cargas sociales', type: 'gasto', parent: '5.2' }, { code: '5.2.02', name: 'Servicios básicos', type: 'gasto', parent: '5.2' },
  { code: '5.2.03', name: 'Alquileres', type: 'gasto', parent: '5.2' }, { code: '5.2.04', name: 'Otros gastos', type: 'gasto', parent: '5.2', key: 'gastos_generales' },
];

/** Saldo natural de una cuenta: activos, costos y gastos suben con el debe; pasivos, patrimonio e ingresos, con el haber. */
export function saldoNatural(tipo: TipoCuenta, debe: Decimal.Value, haber: Decimal.Value): Decimal {
  const d = new Decimal(debe); const h = new Decimal(haber);
  return tipo === 'activo' || tipo === 'costo' || tipo === 'gasto' ? d.minus(h) : h.minus(d);
}
