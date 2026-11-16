/**
 * Normativa de facturación (informe QA-NORMATIVA-FACTURACION, 15/11/2026). Funciones PURAS, en enteros (BigInt, centavos), sin
 * dependencias: se copian tal cual a otro sistema de Kyros. Nada de coma flotante.
 *
 *  - IVA «por dentro» (vigente): el precio incluye el IVA; débito fiscal = 13 % del importe facturado, mitad hacia arriba (Ley 843, arts. 4 y 5).
 *    Bs 116,70 -> IVA 15,17 y neto 101,53.
 *  - IVA «por fuera» (Ley 1733, art. 5 reformado): NO está en vigor; rige desde el primer día del mes siguiente a la publicación de su
 *    Decreto Supremo reglamentario (no publicado a 15/11/2026). Queda detrás de un INTERRUPTOR APAGADO. Para mantener el precio final
 *    (Bs 116,70): neto 103,27 + IVA 13,43.
 *  - Los códigos de producto SIN, actividad y método de pago (salvo 1 efectivo, 2 tarjeta y 5 otros) NO están confirmados: se leen del
 *    catálogo que FacturaSIN sincroniza del SIN y mientras no los confirme el contador se muestra el aviso AVISO_CODIGOS_NO_CONFIRMADOS.
 */
export type ModoIva = 'por_dentro' | 'por_fuera';
export const MODO_IVA_DEFECTO: ModoIva = 'por_dentro';
export const TASA_IVA_PB = 1300n;
export const AVISO_CODIGOS_NO_CONFIRMADOS = 'NO CONFIRMADO — definir con el catálogo del SIN';
export const TEXTO_AVISO_CODIGOS =
  'Los códigos de producto SIN, la actividad económica y el método de pago de las facturas son valores de SIMULACIÓN: NO CONFIRMADO — definir con el catálogo del SIN (sincronizar con el token delegado de la empresa en FacturaSIN) y confirmar con el contador antes de facturar con validez fiscal.';

/** a / b redondeado mitad hacia arriba (a >= 0, b > 0). */
const mediaArriba = (a: bigint, b: bigint): bigint => (2n * a + b) / (2n * b);

/** IVA contenido en un importe (por dentro): 13 % del importe, mitad hacia arriba. 11670n -> 1517n. */
export const ivaPorDentroCent = (totalCent: bigint): bigint => mediaArriba(totalCent * TASA_IVA_PB, 10_000n);
/** IVA 13 % sobre un neto (por fuera). 10327n -> 1343n. */
export const ivaSobreNetoCent = ivaPorDentroCent;

/** Neto tal que neto + 13 % del neto = total (precio final constante). Si ningún neto en centavos cuadra, `exacto: false` y IVA = total - neto. */
export function netoParaTotalPorFuera(totalCent: bigint): { netoCent: bigint; ivaCent: bigint; exacto: boolean } {
  const base = mediaArriba(totalCent * 10_000n, 10_000n + TASA_IVA_PB);
  for (const d of [0n, -1n, 1n, -2n, 2n]) {
    const n = base + d;
    if (n > 0n && n + ivaSobreNetoCent(n) === totalCent) return { netoCent: n, ivaCent: totalCent - n, exacto: true };
  }
  return { netoCent: base, ivaCent: totalCent - base, exacto: false };
}

export interface DesgloseFiscal { modo: ModoIva; netoCent: bigint; ivaCent: bigint; totalCent: bigint; exacto: boolean }

/** Neto, IVA y total por separado de lo COBRADO. En «por fuera» el total no cambia (mismo precio final). */
export function desglosarFiscal(totalCent: bigint, modo: ModoIva = MODO_IVA_DEFECTO): DesgloseFiscal {
  if (totalCent < 0n) throw new RangeError('El importe no puede ser negativo');
  if (modo === 'por_fuera') {
    const r = netoParaTotalPorFuera(totalCent);
    return { modo, netoCent: r.netoCent, ivaCent: r.ivaCent, totalCent, exacto: r.exacto };
  }
  const iva = ivaPorDentroCent(totalCent);
  return { modo, netoCent: totalCent - iva, ivaCent: iva, totalCent, exacto: true };
}

export type RegimenTributario = 'general' | 'simplificado' | 'no_declarado';

/**
 * F10: avisos (NUNCA bloquea) al guardar datos fiscales de un médico, odontólogo, veterinario o empresa.
 *  - Régimen Tributario Simplificado: solo artesanos, comerciantes minoristas y vivanderos (D.S. 24484); NO puede emitir factura con crédito
 *    fiscal. Médicos, odontólogos y veterinarios independientes y las empresas van en el Régimen General.
 *  - Se exige un NIT activo: sin NIT o con NIT que el SIN no reconoce, no se puede facturar.
 */
export function evaluarRegimenFiscal(e: { regimen?: string | null; nit?: string | null; nitActivo?: boolean | null }): { avisos: string[]; puedeFacturarConCredito: boolean } {
  const avisos: string[] = [];
  const nit = String(e.nit ?? '').replace(/\D/g, '');
  let puede = true;
  if (e.regimen === 'simplificado') {
    puede = false;
    avisos.push('Declaraste el Régimen Tributario Simplificado: ese régimen solo es para artesanos, comerciantes minoristas y vivanderos y NO permite emitir factura con derecho a crédito fiscal (D.S. 24484). Los médicos, odontólogos, veterinarios independientes y las empresas tributan en el Régimen General. Es solo un aviso: puedes guardar, pero confírmalo con tu contador antes de facturar.');
  }
  if (!nit) {
    puede = false;
    avisos.push('Falta el NIT: para emitir facturas se necesita un NIT ACTIVO en el padrón del SIN. Puedes guardar ahora y completarlo después.');
  } else if (!/^[1-9]\d{4,12}$/.test(nit)) {
    puede = false;
    avisos.push('El NIT no parece válido (5 a 13 dígitos, sin ceros a la izquierda). Se necesita un NIT ACTIVO para facturar.');
  } else if (e.nitActivo === false) {
    puede = false;
    avisos.push('El SIN no reconoce este NIT como activo: sin un NIT activo no se pueden emitir facturas.');
  }
  return { avisos, puedeFacturarConCredito: puede };
}
