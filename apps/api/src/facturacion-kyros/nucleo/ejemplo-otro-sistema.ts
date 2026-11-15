/**
 * Ejemplo mínimo para replicar el Flujo 1 en otro sistema (Medyx, Dental, Vet, AXION, Hub, Glucora). Ver docs/facturacion-kyros.md.
 * Aquí el «almacén» es un Map en memoria; en tu sistema son 3 consultas SQL sobre tu tabla de facturas (una fila por pago).
 */
import { aCentavos, emitirFactura, FacturaSinClient, tokenClientCredentials, type AlmacenFacturas, type FilaFactura, type PagoFacturable } from './index';

export async function ejemplo(secretoDeMiSistema: string) {
  const filas = new Map<string, FilaFactura>();
  const almacen: AlmacenFacturas = {
    obtener: async (pagoId) => filas.get(pagoId) ?? null,
    iniciarIntento: async (pago, d) => { const f = { id: `f-${pago.pagoId}`, pagoId: pago.pagoId, estado: 'emitiendo' as const, intentos: (filas.get(pago.pagoId)?.intentos ?? 0) + 1, claveIdempotencia: d.clave, facturasinId: null }; filas.set(pago.pagoId, f); return f; },
    guardarResultado: async (pagoId, r) => { const f = filas.get(pagoId)!; filas.set(pagoId, { ...f, estado: r.estado, facturasinId: r.facturasinId ?? f.facturasinId }); },
  };
  const cliente = new FacturaSinClient({ baseUrl: 'https://facturasin.kyros-tech.com/api', sistema: 'medyx', token: tokenClientCredentials({ issuer: 'https://auth.kyros-tech.com/realms/kyros', clientId: 'medyx-service', clientSecret: secretoDeMiSistema }) });
  const pago: PagoFacturable = { pagoId: 'pago-1001', plan: 'Plan Médico', meses: 1, mesesDeRegalo: 0, montoCent: aCentavos('116.70'), desde: null, hasta: null, fiscales: { tipo: 'NIT', numero: '1020304050', razonSocial: 'Consultorio Andino SRL' } };
  // Justo después de validar el pago, SIN bloquearlo: emitirFactura nunca lanza por fallos de FacturaSIN.
  return emitirFactura({ almacen, cliente, config: { sistema: 'medyx', empresa: 'kyros-tech', sector: 1, sucursal: 0, puntoVenta: 0, metodoPago: 7, codigoProducto: 'SUSC-MENSUAL' } }, pago);
}
