import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, mensajeDeError, useRolesActivos } from '../lib/sesion';

interface Ajustes { pedidosPorQr: boolean; qrSinConfirmacion: boolean; modoDeCobro: 'recibo' | 'ninguno' | 'factura' }

function Interruptor({ activo, cambiar, titulo, ayuda, deshabilitado }: { activo: boolean; cambiar(v: boolean): void; titulo: string; ayuda: string; deshabilitado?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-space-md py-space-sm">
      <div><p className="font-body-md font-semibold">{titulo}</p><p className="font-body-sm text-body-sm text-on-surface-variant">{ayuda}</p></div>
      <button type="button" role="switch" aria-checked={activo} aria-label={titulo} disabled={deshabilitado} onClick={() => cambiar(!activo)} className={`w-14 h-8 shrink-0 rounded-full p-1 transition-colors ${activo ? 'bg-primary-container' : 'bg-outline-variant'} disabled:opacity-50`}><span className={`block w-6 h-6 rounded-full bg-white transition-transform ${activo ? 'translate-x-6' : ''}`} /></button>
    </div>
  );
}

/** Configuración de la sucursal: pedidos por QR y documento de cobro. */
export function Configuracion() {
  const { sucursalId } = useRolesActivos();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['ajustes', sucursalId], queryFn: () => api.get<Ajustes>('/sucursal/ajustes', sucursalId!), enabled: !!sucursalId });
  const [error, setError] = useState<string | null>(null);
  const cambiar = async (c: Partial<Ajustes>) => { setError(null); try { await api.patch('/sucursal/ajustes', c, sucursalId!); await qc.invalidateQueries({ queryKey: ['ajustes', sucursalId] }); } catch (e) { setError(mensajeDeError(e)); } };
  const a = q.data;
  return (
    <div className="flex flex-col gap-space-lg max-w-2xl">
      <header><h1 className="font-headline-lg text-headline-lg text-primary tracking-tight">Configuración</h1><p className="font-body-md text-body-md text-on-surface-variant">Ajustes de esta sucursal.</p></header>
      {error && <p role="alert" className="rounded-lg bg-error-container text-on-error-container p-space-sm">{error}</p>}
      {!a ? <p role="status">Cargando…</p> : (
        <section className="bg-surface-container-lowest border border-outline-variant rounded-xl p-space-md divide-y divide-outline-variant">
          <Interruptor activo={a.pedidosPorQr} cambiar={(v) => cambiar({ pedidosPorQr: v })} titulo="Pedidos por QR" ayuda="El cliente puede pedir platos desde su celular. Apagado, el QR solo muestra el menú y los botones de llamado." />
          <Interruptor activo={a.qrSinConfirmacion} deshabilitado={!a.pedidosPorQr} cambiar={(v) => cambiar({ qrSinConfirmacion: v })} titulo="Enviar a cocina sin confirmar" ayuda="Apagado (recomendado): el mesero confirma con un toque cada pedido del cliente. Encendido: entra directo a cocina." />
          <div className="py-space-sm">
            <p className="font-body-md font-semibold">Documento al cobrar</p>
            <p className="font-body-sm text-body-sm text-on-surface-variant mb-space-xs">La factura electrónica del SIN estará disponible cuando se conecte el Servicio Fiscal.</p>
            <div className="grid grid-cols-2 gap-space-xs" role="radiogroup" aria-label="Documento al cobrar">
              {([['recibo', 'Recibos'], ['ninguno', 'Solo contabilizar']] as const).map(([k, n]) => <button key={k} type="button" role="radio" aria-checked={a.modoDeCobro === k} onClick={() => cambiar({ modoDeCobro: k })} className={`h-12 rounded-lg font-semibold ${a.modoDeCobro === k ? 'bg-primary-container text-on-primary' : 'bg-surface-container text-on-surface-variant'}`}>{n}</button>)}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
