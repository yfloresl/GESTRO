import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ListaEsqueleto } from '../componentes/Esqueleto';
import { api, mensajeDeError, useRolesActivos } from '../lib/sesion';
import { bs } from '../lib/tipos';
import { clases } from '../componentes/Marca';
import { AvisoPruebas } from './FacturacionConfig';
import { abrirPdf, ETIQUETA_FACTURA, type Factura } from './FacturaPanel';

/** Facturas del restaurante: estado de cada una, las pendientes de emitir y su conciliación con FacturaSIN. */
export function Facturas() {
  const { sucursalId } = useRolesActivos(); const qc = useQueryClient();
  const [estado, setEstado] = useState(''); const [error, setError] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['facturas', sucursalId, estado], queryFn: () => api.get<Factura[]>(`/facturas${estado ? `?estado=${estado}` : ''}`, sucursalId!), enabled: !!sucursalId, refetchInterval: 30_000 });
  const conciliar = useMutation({ mutationFn: () => api.post<{ revisadas: number; cambiadas: number }>('/facturacion/conciliar', undefined, sucursalId!), onSuccess: () => qc.invalidateQueries({ queryKey: ['facturas', sucursalId] }), onError: (e) => setError(mensajeDeError(e)) });
  const pendientes = (q.data ?? []).filter((f) => f.estado === 'en_cola').length;
  return (
    <div className="flex flex-col gap-space-md max-w-4xl">
      <header><h1 className="font-headline-lg text-headline-lg text-primary tracking-tight">Facturas</h1><p className="font-body-md text-on-surface-variant">Facturas emitidas a tus clientes a través de FacturaSIN.</p></header>
      <AvisoPruebas />
      {pendientes > 0 && <p role="alert" className="rounded-lg bg-error-container text-on-error-container p-space-sm">Hay {pendientes} factura(s) pendiente(s) de emitir. Las ventas ya están cobradas; GESTRO reintenta sola. Puedes pedir el reintento ahora.</p>}
      {error && <p role="alert" className="text-error">{error}</p>}
      <div className="flex flex-wrap gap-space-sm items-end">
        <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Estado</span><select value={estado} onChange={(e) => setEstado(e.target.value)} className={`${clases.input} !w-56`}><option value="">Todas</option>{Object.entries(ETIQUETA_FACTURA).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></label>
        <button type="button" disabled={conciliar.isPending} onClick={() => conciliar.mutate()} className={`${clases.secundario} !w-auto px-space-md`}>{conciliar.isPending ? 'Conciliando…' : 'Reintentar y conciliar pendientes'}</button>
      </div>
      {!q.data ? <ListaEsqueleto /> : q.data.length === 0 ? <p className="text-on-surface-variant">Todavía no hay facturas. Se emiten desde Caja («Factura electrónica») o desde un pedido cobrado.</p> : (
        <ul className="flex flex-col divide-y divide-outline-variant bg-surface-container-lowest border border-outline-variant rounded-xl">
          {q.data.map((f) => (
            <li key={f.id} className="p-space-sm flex flex-wrap items-center gap-space-sm justify-between">
              <div>
                <p className="font-semibold">{f.numero ? `N.º ${f.numero} · ` : ''}{f.comprador.consumidorFinal ? 'Sin nombre' : f.comprador.razonSocial} · {bs(f.total)}</p>
                <p className="font-body-sm text-on-surface-variant">{ETIQUETA_FACTURA[f.estado] ?? f.estado} · {new Date(f.creada).toLocaleString('es-BO', { timeZone: 'America/La_Paz' })}{f.ticket ? ` · ticket ${f.ticket}` : ''}{f.error && ['en_cola', 'rechazada', 'error_datos'].includes(f.estado) ? ` · ${f.error}` : ''}</p>
              </div>
              <div className="flex gap-space-xs">
                {f.puedeImprimir && <button type="button" onClick={() => void abrirPdf(f.id, sucursalId!).catch((e) => setError(mensajeDeError(e)))} className="h-11 px-space-sm text-primary font-label-lg">PDF</button>}
                <Link to={`/app/pedidos?abrir=${f.pedidoId}`} className="h-11 px-space-sm text-primary font-label-lg flex items-center">Pedido</Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
