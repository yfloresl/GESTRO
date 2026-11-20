/**
 * GST-C03: ¿el efectivo contado difiere del esperado? Todo en centavos enteros (nunca coma flotante sobre decimales) para que «0,10 + 0,20»
 * no invente una diferencia. Devuelve los centavos (contado - esperado) o null si lo escrito aún no es un monto válido.
 */
export function centavosDeDiferencia(contado: string, esperado: string | undefined): number | null {
  const aCentavos = (v: string): number | null => {
    const m = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(v.trim());
    if (!m) return null;
    return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || '0');
  };
  const c = aCentavos(contado);
  const e = aCentavos(String(esperado ?? '0'));
  return c === null || e === null ? null : c - e;
}
