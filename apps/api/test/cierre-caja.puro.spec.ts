import { describe, expect, it } from 'vitest';
import { cobrosDelTurno, diferenciaDeCaja, notaDeDiferencia } from '../src/pedidos/cierre-caja';

describe('cierre de caja (GST-C03 / GST-C06)', () => {
  it('lista el cobro de cuentas por banco como renglón aparte y no mezcla los dos', () => {
    const f = cobrosDelTurno([{ metodo: 'efectivo', total: '100.00', cantidad: 2 }], { total: '30.00', n: 1 }, { total: '45.50', n: 2 });
    expect(f).toEqual([
      { metodo: 'efectivo', total: '100.00', cantidad: 2 },
      { metodo: 'cuentas_por_cobrar', total: '30.00', cantidad: 1 },
      { metodo: 'cuentas_por_cobrar_banco', total: '45.50', cantidad: 2 },
    ]);
  });

  it('sin cobros de cuentas no agrega renglones', () => {
    expect(cobrosDelTurno([], { total: '0.00', n: 0 }, { total: '0.00', n: 0 })).toEqual([]);
    expect(cobrosDelTurno([], { total: '0.00', n: 0 }, { total: '12.00', n: 1 }).map((x) => x.metodo)).toEqual(['cuentas_por_cobrar_banco']);
  });

  it.each([
    ['150.00', '150.00', '0.00'],
    ['149.90', '150.00', '-0.10'],
    ['150.05', '150.00', '0.05'],
    ['0.30', '0.10', '0.20'], // 0.3 - 0.1 en coma flotante no es 0.2
    ['1000000.00', '999999.99', '0.01'],
  ])('diferencia contado %s esperado %s = %s (centavos exactos)', (contado, esperado, dif) => expect(diferenciaDeCaja(contado, esperado)).toBe(dif));

  it('la explicación solo se guarda con diferencia, recortada y sin espacios sobrantes', () => {
    expect(notaDeDiferencia('0.00', 'sobró')).toBeNull();
    expect(notaDeDiferencia('-0.10', '  Me equivoqué en un vuelto  ')).toBe('Me equivoqué en un vuelto');
    expect(notaDeDiferencia('5.00', '')).toBeNull();
    expect(notaDeDiferencia('5.00', undefined)).toBeNull();
    expect(notaDeDiferencia('5.00', 'x'.repeat(500))).toHaveLength(300);
  });
});
