export interface ItemPedido {
  id: string; platoId: string; nombre: string; cantidad: string; precio: string; nota: string | null; modificadores: string[]; tiempo: number; estado: string;
  anulado: boolean; motivoAnulacion: string | null; porConfirmar: boolean; desdeQr: boolean; iniciado: string | null; listo: string | null;
}
export interface Pedido {
  id: string; tipo: 'mesa' | 'mostrador' | 'llevar' | 'delivery'; mesaId: string | null; mesa: string | null; ticket: number | null; canal: string; estado: string;
  cliente: string | null; telefono: string | null; direccion: string | null; recojo: string | null; comentario: string | null; subtotal: string; total: string;
  abierto: string; enviado: string | null; mesero: string | null; items: ItemPedido[];
}
export interface Ticket {
  id: string; tipo: Pedido['tipo']; mesa: string | null; ticket: number | null; mesero: string | null; cliente: string | null; recojo: string | null; comentario: string | null;
  enviado: string | null; estado: 'nuevo' | 'en_preparacion' | 'listo'; items: ItemPedido[];
}
export interface CajaEstado { activa: boolean; id?: string; desde?: string; montoInicial?: string; cobros?: { metodo: string; total: string; cantidad: number }[]; efectivoEsperado?: string }
export interface Recibo {
  id: string; numero: number; emitido: string; monto: string; cliente: string | null; metodo: string | null; anulado: boolean; motivoAnulacion: string | null;
  restaurante: string; razonSocial: string; nit: string | null; mesa: string | null; ticket: number | null; items: { nombre: string; cantidad: string; precio: string }[]; leyenda: string;
}

export const bs = (n: string | number) => `Bs ${Number(n).toFixed(2)}`;
export const ETIQUETA_TIPO: Record<string, string> = { mesa: 'Mesa', mostrador: 'Mostrador', llevar: 'Para llevar', delivery: 'Delivery' };
export const ETIQUETA_ESTADO: Record<string, string> = {
  borrador: 'Sin enviar', enviado: 'Enviado', en_preparacion: 'En preparación', listo: 'Listo', servido: 'Servido', cobrado: 'Cobrado', anulado: 'Anulado', por_confirmar: 'Por confirmar',
};
/** Minutos transcurridos desde una fecha ISO. */
export const minutosDesde = (iso: string | null) => (iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000)) : 0);
