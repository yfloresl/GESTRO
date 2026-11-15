import { describe, expect, it } from 'vitest';
import { armarComprador, armarPayload, calcularFactura, deCentavos, ErrorFactura, esperaDeReintento, idExternoDe, importeDeLinea, ivaReferencial, limpiarTexto, metodoPagoSin, tarjetaEnmascarada, validarNit } from '../src/facturacion-emisor/calculo-factura';

// Recálculo INDEPENDIENTE: enteros de centavos con Number y Math (no BigInt ni la misma ruta de código).
const bsC = (x: number) => `${Math.floor(x / 100)}.${String(x % 100).padStart(2, '0')}`;
const ivaC = (totalC: number) => Math.floor((totalC * 13 + 50) / 100); // 13 % del total, mitad hacia arriba

describe('factura: cálculos (Ley 843, IVA por dentro 13 %)', () => {
  it('caso con descuento y propina: la propina NO se factura', () => {
    // 2 x 45,00 + 1 x 38,50 + 3 x 12,00 = 164,50; descuento 14,50 -> 150,00; propina 15,00 aparte.
    const r = calcularFactura({ lineas: [
      { itemId: 'a', nombre: 'Pique', cantidad: '2', precio: '45.00' }, { itemId: 'b', nombre: 'Sopa', cantidad: '1', precio: '38.50' }, { itemId: 'c', nombre: 'Refresco', cantidad: '3', precio: '12.00' }], descuento: '14.50', propina: '15.00' });
    expect(deCentavos(r.subtotal)).toBe('164.50'); expect(deCentavos(r.total)).toBe('150.00');
    expect(deCentavos(r.iva)).toBe('19.50'); expect(deCentavos(r.propinaExcluida)).toBe('15.00');
    expect(ivaC(15000)).toBe(1950);
  });
  it('IVA 13 % con redondeo al centavo', () => {
    expect(deCentavos(ivaReferencial(11670n))).toBe('15.17'); // 15,171
    expect(deCentavos(ivaReferencial(1n))).toBe('0.00'); // 0,13 centavos
    expect(deCentavos(ivaReferencial(4n))).toBe('0.01'); // 0,52 centavos
    expect(deCentavos(ivaReferencial(5n))).toBe('0.01'); // 0,65 centavos
    expect(deCentavos(ivaReferencial(100000000n))).toBe('130000.00');
  });
  it('cantidades fraccionarias: un solo redondeo por línea, mitad hacia arriba', () => {
    expect(deCentavos(importeDeLinea('0.5', '15.55'))).toBe('7.78'); // 7,775
    expect(deCentavos(importeDeLinea('0.333', '10.00'))).toBe('3.33');
    expect(deCentavos(importeDeLinea('1.5', '0.01'))).toBe('0.02'); // 0,015
    expect(deCentavos(importeDeLinea('3', '12.00'))).toBe('36.00');
  });
  it('5000 casos aleatorios contra aritmética independiente', () => {
    let seed = 987654; const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    for (let i = 0; i < 5000; i++) {
      const n = 1 + rnd(6); const lineas = []; let subC = 0;
      for (let k = 0; k < n; k++) { const q = 1 + rnd(20); const pC = 1 + rnd(30000); lineas.push({ itemId: `i${k}`, nombre: 'Plato', cantidad: String(q), precio: bsC(pC) }); subC += q * pC; }
      const dC = rnd(Math.floor(subC * 0.3) + 1); const prop = rnd(5000);
      const r = calcularFactura({ lineas, descuento: bsC(dC), propina: bsC(prop) });
      expect(deCentavos(r.subtotal)).toBe(bsC(subC)); expect(deCentavos(r.total)).toBe(bsC(subC - dC)); expect(deCentavos(r.iva)).toBe(bsC(ivaC(subC - dC)));
      expect(r.total + r.propinaExcluida).toBe(BigInt(subC - dC + prop));
    }
  });
  it('rechaza total cero o pedido vacío', () => {
    expect(() => calcularFactura({ lineas: [], descuento: '0' })).toThrow(ErrorFactura);
    expect(() => calcularFactura({ lineas: [{ itemId: 'a', nombre: 'x', cantidad: '1', precio: '10.00' }], descuento: '10.00' })).toThrow(/mayor que cero/);
  });
});

describe('factura: comprador y textos', () => {
  it('NIT numérico de 5 a 13 dígitos', () => {
    expect(validarNit('1000000005')).toBe('1000000005');
    for (const m of ['', '1234', '12345678901234', '12A45678', '123-456', ' ']) expect(() => validarNit(m)).toThrow(ErrorFactura);
  });
  it('tildes y ñ se conservan; símbolos peligrosos se rechazan', () => {
    expect(limpiarTexto('  Pollería   Ñandú  S.R.L. ', 'Razón', 1, 200)).toBe('Pollería Ñandú S.R.L.');
    expect(limpiarTexto('Café Güemes & Hnos. (Sucre)', 'x', 1, 200)).toBe('Café Güemes & Hnos. (Sucre)');
    expect(() => limpiarTexto('<script>', 'x', 1, 50)).toThrow(/no permitidos/);
    expect(() => limpiarTexto('   ', 'Razón', 1, 50)).toThrow(/obligatorio/);
    expect(() => limpiarTexto('a'.repeat(201), 'x', 1, 200)).toThrow(/máximo/);
  });
  it('documentos: NIT, CI con complemento, pasaporte, excepción', () => {
    expect(armarComprador({ tipo: 'nit', numero: '1020304050', razonSocial: 'Empresa Ñ SRL' })).toMatchObject({ tipoDocumento: 5, codigoExcepcion: 0 });
    expect(armarComprador({ tipo: 'ci', numero: '4567890', complemento: '1A', razonSocial: 'Ana' })).toMatchObject({ tipoDocumento: 1, complemento: '1A' });
    expect(armarComprador({ tipo: 'pasaporte', numero: 'AB123456', razonSocial: 'John Smith' }).tipoDocumento).toBe(3);
    expect(armarComprador({ tipo: 'nit', numero: '1020304050', razonSocial: 'X', nitConExcepcion: true }).codigoExcepcion).toBe(1);
    expect(() => armarComprador({ tipo: 'ci', numero: '12', razonSocial: 'X' })).toThrow();
    expect(() => armarComprador({ tipo: 'nit', numero: '123', razonSocial: 'X' })).toThrow();
    expect(() => armarComprador({ tipo: 'ci', numero: '4567890', razonSocial: 'X', nitConExcepcion: true })).toThrow();
    expect(() => armarComprador({ tipo: 'nit', numero: '1020304050', complemento: '1', razonSocial: 'X' })).toThrow();
    expect(() => armarComprador({ tipo: 'ci', numero: '4567890', razonSocial: 'X', correo: 'no-es-correo' })).toThrow();
  });
});

describe('factura: payload', () => {
  const config = { sucursal: 0, puntoVenta: 0, actividad: '561011', codigoSinPorDefecto: '63111', unidadPorDefecto: 57 };
  it('arma el payload con códigos SIN por plato, propina fuera y clave pedido+intento', () => {
    const p = armarPayload({ idExterno: idExternoDe('ped-1', 2), lineas: [{ itemId: 'm1', nombre: 'Silpancho', cantidad: '2', precio: '45.50', codigoSin: '99999', unidad: 58 }, { itemId: 'm2', nombre: 'Té', cantidad: '1', precio: '8.00' }], descuento: '5.00', comprador: armarComprador({ tipo: 'ci', numero: '4567890', razonSocial: 'Ana' }), metodo: 'tarjeta', numeroTarjeta: tarjetaEnmascarada('4111', '1111'), config });
    expect(p.idExterno).toBe('gestro:ped-1:2'); expect(p.moneda).toBe(1); expect(p.descuentoAdicional).toBe(5); expect(p.metodoPago).toBe(2);
    expect(p.numeroTarjeta).toBe('4111000000001111');
    expect(p.items[0]).toMatchObject({ codigoProductoSin: '99999', unidadMedida: 58, cantidad: 2, precioUnitario: 45.5, actividadEconomica: '561011' });
    expect(p.items[1]).toMatchObject({ codigoProductoSin: '63111', unidadMedida: 57 });
    expect(JSON.stringify(p)).not.toMatch(/propina/i);
  });
  it('método de pago y reintentos', () => {
    expect(['efectivo', 'tarjeta', 'qr', 'transferencia'].map(metodoPagoSin)).toEqual([1, 2, 7, 7]);
    expect([1, 2, 3, 4, 20].map(esperaDeReintento)).toEqual([30000, 60000, 120000, 240000, 900000]);
    expect(() => tarjetaEnmascarada('41', '1111')).toThrow();
  });
});
