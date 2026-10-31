/**
 * Paquetes (planes) por módulo. Comensales y terceros (QR, reservas web, portal) NUNCA pagan ni se bloquean: solo se
 * restringen rutas del personal (`DeSucursal`). Sin límite por usuario.
 * Los entitlements están APAGADOS por defecto: solo se aplican si `plans.features.aplicar === true`.
 */
export const MODULOS = {
  menu_salon: 'Menú y salón',
  caja: 'Caja y comandas',
  cierre: 'Cierre diario',
  cocina: 'Cocina con pantalla',
  inventario: 'Inventario y recetas',
  reservas: 'Reservas',
  cobranzas: 'Cobranzas',
  sucursales: 'Varias sucursales',
  contabilidad: 'Contabilidad',
  compras: 'Compras y proveedores',
  delivery: 'Delivery',
} as const;
export type Modulo = keyof typeof MODULOS;

const ESENCIAL: Modulo[] = ['menu_salon', 'caja', 'cierre'];
const PROFESIONAL: Modulo[] = [...ESENCIAL, 'cocina', 'inventario', 'reservas', 'cobranzas'];
const CADENA: Modulo[] = [...PROFESIONAL, 'sucursales', 'contabilidad', 'compras', 'delivery'];

export const PAQUETES = [
  { codigo: 'esencial', nombre: 'Esencial', usd: 25, modulos: ESENCIAL },
  { codigo: 'profesional', nombre: 'Profesional', usd: 49, modulos: PROFESIONAL },
  { codigo: 'cadena', nombre: 'Cadena', usd: 99, modulos: CADENA },
] as const;
export const TIPO_DE_CAMBIO = 6.96;

/** Primer segmento de la ruta → módulo. Lo que no está aquí es del paquete base (siempre disponible). */
const RUTA_A_MODULO: Record<string, Modulo> = {
  cocina: 'cocina',
  inventario: 'inventario', almacenes: 'inventario', insumos: 'inventario', stock: 'inventario', unidades: 'inventario', recetas: 'inventario', 'plan-del-dia': 'inventario',
  reservas: 'reservas', eventos: 'reservas',
  'por-cobrar': 'cobranzas',
  contabilidad: 'contabilidad',
  compras: 'compras', proveedores: 'compras', 'ordenes-de-compra': 'compras', 'por-pagar': 'compras',
  delivery: 'delivery',
};

export function moduloDeRuta(url: string): Modulo | null {
  const seg = url.split('?')[0].replace(/^\/?api\/v\d+\//, '').replace(/^\//, '').split('/')[0];
  return RUTA_A_MODULO[seg] ?? null;
}

export type Alcance = { aplicado: boolean; modulos: Modulo[] | null };

/** `features` de un plan → qué se aplica. Sin `aplicar: true` o sin lista de módulos, todo está disponible. */
export function alcanceDe(features: unknown): Alcance {
  const f = (features ?? {}) as { aplicar?: unknown; modulos?: unknown };
  const lista = Array.isArray(f.modulos) ? (f.modulos.filter((m) => typeof m === 'string' && m in MODULOS) as Modulo[]) : null;
  return { aplicado: f.aplicar === true && lista !== null, modulos: lista };
}
