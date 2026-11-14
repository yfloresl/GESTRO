import { describe, expect, it } from 'vitest';
import { diasDelMes, diasEntre, partes, prorrateoCambioPlan, renovar, sumarDias, sumarMesesAncla } from '../src/suscripcion/periodos';

// Recálculo independiente con Date.UTC (solo en la prueba) para comparar el calendario propio.
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const refSumarDias = (f: string, n: number) => { const { a, m, d } = partes(f); return iso(Date.UTC(a, m - 1, d) + n * 86_400_000); };

describe('calendario de suscripciones (GS-C04)', () => {
  it('meses de 28 a 31 días y bisiesto', () => {
    expect([diasDelMes(2027, 2), diasDelMes(2028, 2), diasDelMes(2100, 2), diasDelMes(2000, 2), diasDelMes(2026, 4), diasDelMes(2026, 12)]).toEqual([28, 29, 28, 29, 30, 31]);
  });
  it('sumarDias y diasEntre coinciden con Date.UTC en 5 años de fechas', () => {
    let f = '2026-01-01';
    for (let i = 0; i < 365 * 5; i += 7) { const ref = refSumarDias('2026-01-01', i); expect(f).toBe(ref); expect(diasEntre('2026-01-01', f)).toBe(i); expect(sumarDias(f, -3)).toBe(refSumarDias(f, -3)); f = sumarDias(f, 7); }
  });
  it('mes con ancla: 31/01 → 28/02 → 31/03 → 30/04; bisiesto 2028', () => {
    expect(sumarMesesAncla('2026-01-31', 1, 31)).toBe('2026-02-28');
    expect(sumarMesesAncla('2026-02-28', 1, 31)).toBe('2026-03-31');
    expect(sumarMesesAncla('2026-03-31', 1, 31)).toBe('2026-04-30');
    expect(sumarMesesAncla('2028-01-31', 1, 31)).toBe('2028-02-29');
    expect(sumarMesesAncla('2026-11-30', 3, 30)).toBe('2027-02-28');
    expect(sumarMesesAncla('2026-12-15', 2, 15)).toBe('2027-02-15');
  });
  it('cinco renovaciones mensuales desde 31/01 terminan el 29/06 (antes se perdían 2 días: 27/06)', () => {
    let hasta: string | null = null; let ancla: number | null = null;
    const fins: string[] = [];
    for (let i = 0; i < 6; i++) {
      const r = renovar({ hoy: '2026-01-31', hasta, ancla, meses: 1 }); // pagos hechos el mismo 31/01 (renueva antes de vencer)
      hasta = r.hasta; ancla = r.ancla; fins.push(r.hasta);
    }
    expect(fins).toEqual(['2026-02-27', '2026-03-30', '2026-04-29', '2026-05-30', '2026-06-29', '2026-07-30']);
  });
  it('el primer pago el 31/01 cubre 31/01–27/02 y no deja días sueltos: cada período empieza el día siguiente al anterior', () => {
    let hasta: string | null = null; let ancla: number | null = null; let desdeAnterior = '';
    for (let i = 0; i < 24; i++) {
      const r = renovar({ hoy: '2026-01-31', hasta, ancla, meses: 1 });
      if (hasta) expect(r.desde).toBe(sumarDias(hasta, 1));
      expect(r.hasta >= r.desde).toBe(true); void desdeAnterior; desdeAnterior = r.desde;
      hasta = r.hasta; ancla = r.ancla;
    }
    // 24 meses desde 31/01/2026: vence 30/01/2028 (el 31/01/2028 sería el siguiente inicio)
    expect(hasta).toBe('2028-01-30');
  });
  it('caso del dueño: vence 30/12, renueva 10/12 por un mes → 30/01; con ancla 31: 30/12 vence → 30/01 se mantiene', () => {
    const r = renovar({ hoy: '2026-12-10', hasta: '2026-12-30', ancla: null, meses: 1 });
    expect(r).toEqual({ desde: '2026-12-31', hasta: '2027-01-30', ancla: 31 });
  });
  it('renovar vencida empieza hoy; renovar el mismo día del vencimiento suma al día siguiente', () => {
    expect(renovar({ hoy: '2026-03-10', hasta: '2026-03-01', ancla: 5, meses: 1 })).toEqual({ desde: '2026-03-10', hasta: '2026-04-09', ancla: 10 });
    expect(renovar({ hoy: '2026-03-01', hasta: '2026-03-01', ancla: null, meses: 1 })).toEqual({ desde: '2026-03-02', hasta: '2026-04-01', ancla: 2 });
    expect(renovar({ hoy: '2026-03-01', hasta: null, ancla: null, meses: 12 })).toEqual({ desde: '2026-03-01', hasta: '2027-02-28', ancla: 1 });
  });
  it('12 meses desde 29/02/2028 → 28/02/2029; 1 mes + regalo (2 meses) cruza fin de año', () => {
    expect(renovar({ hoy: '2028-02-29', hasta: null, ancla: null, meses: 12 }).hasta).toBe('2029-02-27');
    expect(renovar({ hoy: '2026-12-31', hasta: null, ancla: null, meses: 2 }).hasta).toBe('2027-02-27');
  });
  it('los 12 meses de un año siempre suman exactamente los días del año (sin pérdida)', () => {
    for (const ini of ['2026-01-31', '2026-03-15', '2027-12-30', '2028-02-29', '2028-03-01']) {
      const r = renovar({ hoy: ini, hasta: null, ancla: null, meses: 12 });
      const dias = diasEntre(ini, r.hasta) + 1;
      const siguienteAnio = sumarMesesAncla(ini, 12, partes(ini).d);
      expect(dias).toBe(diasEntre(ini, siguienteAnio));
    }
  });
});

describe('cambio de plan con prorrateo (BigInt, centavos)', () => {
  it('conserva el valor pagado: días × viejo = días nuevos × nuevo + crédito', () => {
    // 20 días de un plan de Bs 174,00 pasan a uno de Bs 341,04: floor(20 × 17400 / 34104) = 10 días
    const a = prorrateoCambioPlan({ diasRestantes: 20, precioViejoCent: 17400n, precioNuevoCent: 34104n });
    expect(a.diasNuevos).toBe(10);
    // resto = 20×17400 − 10×34104 = 6960 centavo·día → ×12/365 = 228,8 → 229 centavos
    expect(a.creditoCent).toBe(229n);
    // bajar de plan: 10 días de 341,04 → floor(10×34104/17400) = 19 días (no pierde)
    expect(prorrateoCambioPlan({ diasRestantes: 10, precioViejoCent: 34104n, precioNuevoCent: 17400n }).diasNuevos).toBe(19);
  });
  it('mismo precio no cambia nada; propiedad aleatoria: nunca se entrega más valor del pagado', () => {
    expect(prorrateoCambioPlan({ diasRestantes: 17, precioViejoCent: 5000n, precioNuevoCent: 5000n })).toEqual({ diasNuevos: 17, creditoCent: 0n });
    for (let i = 1; i < 400; i++) {
      const v = BigInt(1000 + i * 37); const n = BigInt(900 + i * 53); const d = (i % 60) + 1;
      const r = prorrateoCambioPlan({ diasRestantes: d, precioViejoCent: v, precioNuevoCent: n });
      expect(BigInt(r.diasNuevos) * n <= BigInt(d) * v).toBe(true);
      expect((BigInt(d) * v - BigInt(r.diasNuevos) * n) < n).toBe(true); // el resto es menos de un día del plan nuevo
    }
  });
});
