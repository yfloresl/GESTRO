import { z } from 'zod';

/** Roles de GESTRO por sucursal (los fija GESTRO; Kyros ID solo dice quién es la persona). */
export const ROLES = ['owner', 'admin', 'cobranzas', 'cajero', 'mesero', 'area_manager', 'cocina', 'almacen', 'contador'] as const;
export type Rol = (typeof ROLES)[number];

/** Lo que el navegador necesita para iniciar «Entrar con Kyros ID» (sin red, sin secretos). */
export const KyrosIdPublicoSchema = z.object({
  activo: z.boolean(),
  emisor: z.string(),
  clientId: z.string(),
  authorizationEndpoint: z.string(),
  tokenEndpoint: z.string(),
  endSessionEndpoint: z.string(),
});
export type KyrosIdPublico = z.infer<typeof KyrosIdPublicoSchema>;

export const CanjeKyrosIdSchema = z.object({ accessToken: z.string().min(20).max(8192) }).strict();
export type CanjeKyrosId = z.infer<typeof CanjeKyrosIdSchema>;

export interface SucursalSesion { id: string; nombre: string; roles: Rol[] }

/** Respuesta de abrir sesión: el token de acceso va en memoria; el de refresco, en cookie HttpOnly. */
export interface SesionRespuesta {
  accessToken: string;
  usuario: { id: string; nombre: string; esPlataforma: boolean };
  sucursales: SucursalSesion[];
}

export type EstadoVinculo = 'vinculado' | 'sin_vinculo' | 'pendiente' | 'desactivado';

/** Contrato del Portal Kyros (app-interna-estandar.md §4 y §6.1). */
export interface PortalResumen {
  vinculado: boolean;
  nombreMostrado?: string;
  rol?: string;
  tableros?: { etiqueta: string; valor: number | string; detalle?: string }[];
  pendientes?: { etiqueta: string; cantidad: number; urgencia: 'info' | 'atencion' | 'urgente'; destino: string }[];
  proximos?: { titulo: string; cuando: string; detalle?: string; destino: string }[];
  entrar: string;
}

/** Resultado de canjear el token de Kyros ID: sesión abierta o identidad sin vínculo (registro o código de invitación). */
export type ResultadoCanje =
  | { estado: 'sesion'; sesion: SesionRespuesta }
  | { estado: 'sin_vinculo'; puedeRegistrarse: boolean; registroToken: string };

export interface Registro { registroToken: string; nombre: string; correo: string; restaurante: string; razonSocial: string; nit?: string }
export interface SucursalVista { id: string; nombre: string; slug: string; modoDeCobro: string; pagadoHasta: string | null; estado: string }
