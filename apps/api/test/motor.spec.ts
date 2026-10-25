import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { CicloDeRecetas, Catalogo, consumo, convertir, costoPorPorcion, faltantes, margenPct, r2, r3, Receta, RecetaInvalida, requerimientos, UnidadIncompatible, validarSinCiclos } from '../src/recetas/motor';

const unidades = {
  g: { base: 'g', factor: '1' }, kg: { base: 'g', factor: '1000' }, lb: { base: 'g', factor: '453.592' },
  ml: { base: 'ml', factor: '1' }, l: { base: 'ml', factor: '1000' }, un: { base: 'un', factor: '1' },
};
const insumos = {
  carne: { unidad: 'kg' }, papa: { unidad: 'kg' }, arroz: { unidad: 'kg' }, aceite: { unidad: 'l' }, huevo: { unidad: 'un' }, mani: { unidad: 'kg' }, caldo: { unidad: 'l' }, salsa: { unidad: 'l' }, tomate: { unidad: 'kg' },
};
const receta = (id: string, rendimiento: string, mermaPct: string, lineas: [string, string, string][]): Receta => ({ id, rendimiento, mermaPct, lineas: lineas.map(([insumoId, cantidad, unidad]) => ({ insumoId, cantidad, unidad })) });
const cat = (extra: Partial<Catalogo> = {}): Catalogo => ({ unidades, insumos, recetaDePlato: {}, subRecetaDeInsumo: {}, ...extra });
const num = (m: Map<string, Decimal>, id: string) => r3(m.get(id) ?? new Decimal(0));

describe('convertir', () => {
  it('kg ↔ g ↔ lb y l ↔ ml', () => {
    expect(convertir(2, 'kg', 'g', unidades).toString()).toBe('2000');
    expect(convertir(500, 'g', 'kg', unidades).toString()).toBe('0.5');
    expect(r3(convertir(1, 'lb', 'kg', unidades))).toBe('0.454');
    expect(convertir(250, 'ml', 'l', unidades).toString()).toBe('0.25');
  });
  it('unidades de otra familia o inexistentes fallan', () => {
    expect(() => convertir(1, 'kg', 'l', unidades)).toThrow(UnidadIncompatible);
    expect(() => convertir(1, 'kg', 'taza', unidades)).toThrow(UnidadIncompatible);
  });
  it('no pierde precisión como el punto flotante', () => {
    expect(convertir('0.1', 'kg', 'g', unidades).toString()).toBe('100');
    expect(new Decimal('0.1').plus('0.2').toString()).toBe('0.3');
  });
});

describe('consumo de una receta', () => {
  it('escala por porciones ÷ rendimiento', () => {
    const milanesa = receta('r1', '1', '0', [['carne', '200', 'g']]);
    expect(num(consumo(cat(), milanesa, 40), 'carne')).toBe('8.000'); // 40 × 200 g = 8 kg
  });
  it('rendimiento de varias porciones: una olla de 10 porciones', () => {
    const olla = receta('r1', '10', '0', [['caldo', '3', 'l']]);
    expect(num(consumo(cat(), olla, 25), 'caldo')).toBe('7.500');
  });
  it('agrega la merma en porcentaje', () => {
    const r = receta('r1', '1', '10', [['papa', '300', 'g']]);
    expect(num(consumo(cat(), r, 10), 'papa')).toBe('3.300'); // 10 × 0.3 kg × 1.10
  });
  it('convierte la unidad de la línea a la unidad del insumo (aceite en ml, stock en l)', () => {
    const r = receta('r1', '1', '0', [['aceite', '30', 'ml']]);
    expect(num(consumo(cat(), r, 100), 'aceite')).toBe('3.000');
  });
  it('los redondeos son half-up a 3 decimales y exactos', () => {
    const r = receta('r1', '3', '0', [['arroz', '1', 'kg']]);
    expect(num(consumo(cat(), r, 1), 'arroz')).toBe('0.333');
    expect(num(consumo(cat(), r, 2), 'arroz')).toBe('0.667');
    expect(r2(new Decimal('2.675'))).toBe('2.68');
  });
  it('una línea con insumo desconocido o rendimiento cero es un error claro', () => {
    expect(() => consumo(cat(), receta('r1', '1', '0', [['fantasma', '1', 'kg']]), 1)).toThrow(RecetaInvalida);
    expect(() => consumo(cat(), receta('r1', '0', '0', [['carne', '1', 'kg']]), 1)).toThrow(RecetaInvalida);
  });
});

describe('sub-recetas', () => {
  const salsa = receta('s1', '2', '0', [['tomate', '1', 'kg']]); // 2 l de salsa con 1 kg de tomate
  it('expande la sub-receta hasta los insumos básicos', () => {
    const plato = receta('p1', '1', '0', [['salsa', '100', 'ml'], ['carne', '150', 'g']]);
    const c = cat({ subRecetaDeInsumo: { salsa } });
    const m = consumo(c, plato, 20); // 20 porciones × 100 ml = 2 l de salsa = 1 kg de tomate
    expect(num(m, 'tomate')).toBe('1.000'); expect(num(m, 'carne')).toBe('3.000'); expect(m.has('salsa')).toBe(false);
  });
  it('sub-recetas anidadas', () => {
    const base = receta('b1', '1', '0', [['tomate', '500', 'g']]); // 1 l de caldo base = 0.5 kg tomate
    const salsaConBase = receta('s1', '1', '0', [['caldo', '1', 'l']]); // 1 l de salsa = 1 l de caldo
    const plato = receta('p1', '1', '0', [['salsa', '250', 'ml']]);
    const c = cat({ subRecetaDeInsumo: { caldo: base, salsa: salsaConBase } });
    expect(num(consumo(c, plato, 4), 'tomate')).toBe('0.500'); // 4 × 250 ml = 1 l
  });
  it('un ciclo (A usa B y B usa A) se rechaza', () => {
    const a = receta('A', '1', '0', [['caldo', '1', 'l']]); const b = receta('B', '1', '0', [['salsa', '1', 'l']]);
    const c = cat({ subRecetaDeInsumo: { salsa: a, caldo: b } });
    expect(() => consumo(c, receta('p', '1', '0', [['salsa', '1', 'l']]), 1)).toThrow(CicloDeRecetas);
    expect(() => validarSinCiclos(c, a)).toThrow(/Ciclo de recetas: A → B → A/);
  });
  it('una sub-receta que se usa a sí misma también es ciclo', () => {
    const yo = receta('S', '1', '0', [['salsa', '1', 'l']]);
    expect(() => validarSinCiclos(cat({ subRecetaDeInsumo: { salsa: yo } }), yo)).toThrow(CicloDeRecetas);
  });
});

describe('plan del día: insumos requeridos y faltantes', () => {
  const milanesa = receta('m', '1', '5', [['carne', '200', 'g'], ['huevo', '1', 'un'], ['aceite', '50', 'ml']]);
  const sopa = receta('s', '1', '0', [['mani', '40', 'g'], ['papa', '100', 'g'], ['caldo', '300', 'ml']]);
  const c = cat({ recetaDePlato: { milanesa, sopa } });

  it('40 porciones de milanesa y 25 de sopa producen una lista consolidada por insumo', () => {
    const { requerido, sinReceta } = requerimientos([{ platoId: 'milanesa', porciones: 40 }, { platoId: 'sopa', porciones: 25 }], c);
    expect(sinReceta).toEqual([]);
    expect(num(requerido, 'carne')).toBe('8.400'); // 40 × 0.2 kg × 1.05
    expect(num(requerido, 'huevo')).toBe('42.000');
    expect(num(requerido, 'aceite')).toBe('2.100');
    expect(num(requerido, 'mani')).toBe('1.000'); expect(num(requerido, 'papa')).toBe('2.500'); expect(num(requerido, 'caldo')).toBe('7.500');
  });
  it('un insumo compartido por dos platos se suma', () => {
    const otra = receta('o', '1', '0', [['carne', '100', 'g']]);
    const { requerido } = requerimientos([{ platoId: 'milanesa', porciones: 10 }, { platoId: 'otra', porciones: 10 }], cat({ recetaDePlato: { milanesa, otra } }));
    expect(num(requerido, 'carne')).toBe('3.100'); // 2.1 + 1.0
  });
  it('los platos sin receta se avisan aparte y no rompen el cálculo', () => {
    const r = requerimientos([{ platoId: 'milanesa', porciones: 1 }, { platoId: 'misterio', porciones: 5 }], c);
    expect(r.sinReceta).toEqual(['misterio']); expect(r.requerido.has('carne')).toBe(true);
  });
  it('con stock suficiente no hay faltantes; con poco, falta la diferencia', () => {
    const { requerido } = requerimientos([{ platoId: 'milanesa', porciones: 40 }], c);
    expect(faltantes(requerido, { carne: '10', huevo: '50', aceite: '5' }).size).toBe(0);
    const f = faltantes(requerido, { carne: '5.4', huevo: '50' });
    expect(num(f, 'carne')).toBe('3.000'); expect(num(f, 'aceite')).toBe('2.100'); expect(f.has('huevo')).toBe(false);
  });
  it('stock repartido en dos almacenes: el disponible es la suma', () => {
    const { requerido } = requerimientos([{ platoId: 'milanesa', porciones: 40 }], c);
    const total = new Decimal('4.4').plus('4.0'); // cocina + cámara
    expect(faltantes(requerido, { carne: total, huevo: 42, aceite: 2.1 }).size).toBe(0);
  });
  it('sin porciones no requiere nada', () => {
    expect(requerimientos([{ platoId: 'milanesa', porciones: 0 }], c).requerido.get('carne')?.toString()).toBe('0');
  });
});

describe('costo y margen', () => {
  const milanesa = receta('m', '1', '5', [['carne', '200', 'g'], ['huevo', '1', 'un']]);
  it('costo por porción = Σ cantidad × costo, con merma', () => {
    const costo = costoPorPorcion(cat(), milanesa, { carne: '60', huevo: '1.2' }); // 0.21 kg × 60 + 1.05 × 1.2
    expect(r2(costo)).toBe('13.86');
  });
  it('incluye el costo de las sub-recetas', () => {
    const salsa = receta('s1', '2', '0', [['tomate', '1', 'kg']]);
    const plato = receta('p1', '1', '0', [['salsa', '100', 'ml']]);
    expect(r2(costoPorPorcion(cat({ subRecetaDeInsumo: { salsa } }), plato, { tomate: '10' }))).toBe('0.50'); // 0.1 l = 0.05 kg
  });
  it('margen sobre el precio; sin precio no hay margen', () => {
    expect(r2(margenPct(65, '13.86')!)).toBe('78.68');
    expect(margenPct(0, 5)).toBeNull();
  });
  it('subir el precio de la carne sube el costo y baja el margen', () => {
    const antes = costoPorPorcion(cat(), milanesa, { carne: '60', huevo: '1.2' });
    const despues = costoPorPorcion(cat(), milanesa, { carne: '90', huevo: '1.2' });
    expect(despues.gt(antes)).toBe(true);
    expect(margenPct(40, despues)!.lt(margenPct(40, antes)!)).toBe(true);
  });
});
