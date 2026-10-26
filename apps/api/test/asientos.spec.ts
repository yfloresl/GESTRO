import { describe, expect, it } from 'vitest';
import {
  AsientoDescuadrado, PLAN_DE_CUENTAS, ajusteDeInventario, cierreDeEvento, cobroDeCuenta, pagoDeEvento, compraAlContado, compraRecibida, contrarrestar, costoDeVentas, ivaIncluido, merma, pagoAProveedor, saldoNatural, validarPartidaDoble, ventaCobrada,
} from '../src/contabilidad/asientos';

const suma = (a: { lineas: { debe: string; haber: string }[] }) => ({ d: a.lineas.reduce((s, l) => s + Number(l.debe), 0), h: a.lineas.reduce((s, l) => s + Number(l.haber), 0) });

describe('Generadores de asientos (funciones puras)', () => {
  it('el IVA va incluido en el precio: 113 con tasa 13 → 13 de IVA', () => {
    expect(ivaIncluido(113, 13).toFixed(2)).toBe('13.00');
    expect(ivaIncluido('65.50', 13).toFixed(2)).toBe('7.54');
    expect(ivaIncluido(100, 0).toFixed(2)).toBe('0.00');
  });

  it('venta con recibo o sin documento: todo es venta; con factura separa el débito fiscal', () => {
    const r = ventaCobrada({ total: '65.50', metodo: 'efectivo', documento: 'recibo', ivaPct: 13 });
    expect(r.lineas).toEqual([{ cuenta: 'caja', debe: '65.50', haber: '0.00' }, { cuenta: 'ventas', debe: '0.00', haber: '65.50' }]);
    const f = ventaCobrada({ total: '113', metodo: 'tarjeta', documento: 'factura', ivaPct: 13 });
    expect(f.lineas).toEqual([{ cuenta: 'bancos', debe: '113.00', haber: '0.00' }, { cuenta: 'ventas', debe: '0.00', haber: '100.00' }, { cuenta: 'debito_fiscal', debe: '0.00', haber: '13.00' }]);
    expect(ventaCobrada({ total: 50, metodo: 'credito', documento: 'ninguno', ivaPct: 13 }).lineas[0].cuenta).toBe('cxc');
  });

  it('todos los generadores cuadran (debe = haber) incluso con redondeos', () => {
    for (const total of ['0.01', '1.00', '33.33', '65.50', '1234.57', '999999.99']) {
      for (const a of [
        ventaCobrada({ total, metodo: 'qr', documento: 'factura', ivaPct: 13 }), costoDeVentas({ valor: total }), compraRecibida({ total, conIva: true, ivaPct: 13 }),
        compraRecibida({ total, conIva: false, ivaPct: 13 }), compraAlContado({ total }), pagoAProveedor({ monto: total, via: 'bancos' }), cobroDeCuenta({ monto: total, via: 'caja' }), merma({ valor: total }),
        ajusteDeInventario({ valor: total })!, ajusteDeInventario({ valor: `-${total}` })!,
      ]) { const { d, h } = suma(a); expect(d).toBeCloseTo(h, 2); expect(() => validarPartidaDoble(a)).not.toThrow(); }
    }
  });

  it('compra con IVA: inventario por el neto, crédito fiscal por el IVA, proveedor por el total', () => {
    expect(compraRecibida({ total: '113', conIva: true, ivaPct: 13 }).lineas).toEqual([
      { cuenta: 'inventarios', debe: '100.00', haber: '0.00' }, { cuenta: 'credito_fiscal', debe: '13.00', haber: '0.00' }, { cuenta: 'proveedores', debe: '0.00', haber: '113.00' }]);
  });

  it('ajuste de inventario: sobrante, faltante y cero (sin asiento)', () => {
    expect(ajusteDeInventario({ valor: '10' })!.lineas[0]).toMatchObject({ cuenta: 'inventarios', debe: '10.00' });
    expect(ajusteDeInventario({ valor: '-10' })!.lineas[0]).toMatchObject({ cuenta: 'ajustes_inventario', debe: '10.00' });
    expect(ajusteDeInventario({ valor: '0' })).toBeNull();
  });

  it('rechaza importes en cero o negativos y asientos descuadrados', () => {
    expect(() => ventaCobrada({ total: 0, metodo: 'efectivo', documento: 'recibo', ivaPct: 13 })).toThrow(AsientoDescuadrado);
    expect(() => merma({ valor: '-5' })).toThrow(AsientoDescuadrado);
    expect(() => validarPartidaDoble({ glosa: 'x', lineas: [{ cuenta: 'caja', debe: '10.00', haber: '0.00' }, { cuenta: 'ventas', debe: '0.00', haber: '9.99' }] })).toThrow(/descuadrado/);
    expect(() => validarPartidaDoble({ glosa: 'x', lineas: [{ cuenta: 'caja', debe: '5.00', haber: '5.00' }, { cuenta: 'ventas', debe: '0.00', haber: '0.00' }] })).toThrow(AsientoDescuadrado);
  });

  it('contrarrestar intercambia debe y haber', () => {
    const v = ventaCobrada({ total: '40', metodo: 'efectivo', documento: 'recibo', ivaPct: 13 });
    const c = contrarrestar(v);
    expect(c.lineas).toEqual([{ cuenta: 'caja', debe: '0.00', haber: '40.00' }, { cuenta: 'ventas', debe: '40.00', haber: '0.00' }]);
    expect(c.glosa).toMatch(/^Anulación/);
  });

  it('el plan de cuentas: códigos únicos, padres existentes, una clave de sistema por cuenta y todas las claves cubiertas', () => {
    const codigos = PLAN_DE_CUENTAS.map((c) => c.code);
    expect(new Set(codigos).size).toBe(codigos.length);
    for (const c of PLAN_DE_CUENTAS) if (c.parent) expect(codigos).toContain(c.parent);
    const claves = PLAN_DE_CUENTAS.filter((c) => c.key).map((c) => c.key);
    expect(new Set(claves).size).toBe(claves.length);
    for (const k of ['caja', 'bancos', 'cxc', 'inventarios', 'credito_fiscal', 'proveedores', 'debito_fiscal', 'it_por_pagar', 'capital', 'resultados_acumulados', 'ventas', 'costo_ventas', 'mermas', 'ajustes_inventario', 'gastos_generales']) expect(claves).toContain(k);
  });

  it('saldo natural según el tipo de cuenta', () => {
    expect(saldoNatural('activo', 100, 30).toFixed(2)).toBe('70.00');
    expect(saldoNatural('gasto', 100, 30).toFixed(2)).toBe('70.00');
    expect(saldoNatural('pasivo', 30, 100).toFixed(2)).toBe('70.00');
    expect(saldoNatural('ingreso', 0, 65).toFixed(2)).toBe('65.00');
  });
});

describe('Asientos de eventos', () => {
  it('el cobro anticipado es un pasivo, no una venta', () => {
    expect(pagoDeEvento({ monto: '2000', via: 'bancos' }).lineas).toEqual([{ cuenta: 'bancos', debe: '2000.00', haber: '0.00' }, { cuenta: 'anticipos', debe: '0.00', haber: '2000.00' }]);
  });
  it('al cerrar: anticipos y lo que falta por cobrar pasan a ventas; sin saldo o sin anticipos, solo las líneas necesarias', () => {
    expect(cierreDeEvento({ total: '6500', pagado: '4500' }).lineas).toEqual([{ cuenta: 'anticipos', debe: '4500.00', haber: '0.00' }, { cuenta: 'cxc', debe: '2000.00', haber: '0.00' }, { cuenta: 'ventas', debe: '0.00', haber: '6500.00' }]);
    expect(cierreDeEvento({ total: '100', pagado: '100' }).lineas).toHaveLength(2);
    expect(cierreDeEvento({ total: '100', pagado: '0' }).lineas.map((l) => l.cuenta)).toEqual(['cxc', 'ventas']);
    expect(() => cierreDeEvento({ total: '100', pagado: '100.01' })).toThrow(AsientoDescuadrado);
    expect(() => cierreDeEvento({ total: '0', pagado: '0' })).toThrow(AsientoDescuadrado);
  });
});
