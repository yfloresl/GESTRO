import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, mensajeDeError, useRolesActivos } from '../lib/sesion';
import { ListaEsqueleto } from '../componentes/Esqueleto';
import { clases } from '../componentes/Marca';
import { FacturacionConfig } from './FacturacionConfig';
import { SubirQr, type QrActual } from '../lib/kyros-subir-qr';
import { deCentavos, leerPorcentaje, pctTxt, topeEnCentavos } from '../lib/cobro';

interface Ajustes {
  pedidosPorQr: boolean; qrSinConfirmacion: boolean; modoDeCobro: 'recibo' | 'ninguno' | 'factura'; descuentoMaxPct: number; propinaMaxPct: number;
  ultimoCambioTopes: { cuando: string; por: string | null; motivo: string | null; antes: { descuentoMaxPct: number; propinaMaxPct: number } | null } | null;
}

/** Topes del cobro (GST-010): lo máximo que un cajero puede descontar o dejar de propina. Solo dueño/administrador. */
function TopesDeCobro({ a, guardar }: { a: Ajustes; guardar(c: { descuentoMaxPct: number; propinaMaxPct: number; motivoCambioTopes?: string }): Promise<boolean> }) {
  const [d, setD] = useState(pctTxt(a.descuentoMaxPct)); const [p, setP] = useState(pctTxt(a.propinaMaxPct)); const [motivo, setMotivo] = useState('');
  const [ok, setOk] = useState(false); const [ocupado, setOcupado] = useState(false);
  const dn = leerPorcentaje(d); const pn = leerPorcentaje(p);
  const invalido = dn === null || pn === null;
  const sube = !invalido && (dn > a.descuentoMaxPct || pn > a.propinaMaxPct);
  const cambia = !invalido && (dn !== a.descuentoMaxPct || pn !== a.propinaMaxPct);
  const ejDesc = dn === null ? null : topeEnCentavos(10000, dn);
  const ejProp = pn === null ? null : topeEnCentavos(10000, pn);
  const enviar = async () => {
    if (invalido || !cambia) return;
    setOcupado(true); setOk(false);
    const r = await guardar({ descuentoMaxPct: dn, propinaMaxPct: pn, ...(motivo.trim() ? { motivoCambioTopes: motivo.trim() } : {}) });
    setOcupado(false); if (r) { setOk(true); setMotivo(''); }
  };
  const u = a.ultimoCambioTopes;
  return (
    <div className="py-space-sm flex flex-col gap-space-sm">
      <div>
        <p className="font-body-md font-semibold">Límites al cobrar: descuento y propina</p>
        <p className="font-body-sm text-body-sm text-on-surface-variant">Sirven para que nadie regale de más por error. <strong>Descuento:</strong> lo máximo que se puede rebajar de un pedido, como porcentaje de lo consumido. <strong>Propina:</strong> lo máximo que se puede anotar de propina, como porcentaje de lo que paga el cliente. Si pones 0, esa opción queda bloqueada. El cambio vale desde el siguiente cobro, en todas las cajas.</p>
      </div>
      <div className="grid grid-cols-2 gap-space-sm">
        <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Descuento máximo (%)</span><input value={d} onChange={(e) => { setD(e.target.value); setOk(false); }} inputMode="decimal" aria-invalid={dn === null} className={clases.input} /></label>
        <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Propina máxima (%)</span><input value={p} onChange={(e) => { setP(e.target.value); setOk(false); }} inputMode="decimal" aria-invalid={pn === null} className={clases.input} /></label>
      </div>
      {invalido ? <p role="alert" className="text-error font-body-sm">Escribe un número entre 0 y 100, con hasta 2 decimales (por ejemplo 30 o 12,5).</p>
        : <p className="font-body-sm text-on-surface-variant" aria-live="polite">Ejemplo con un pedido de Bs 100,00: se podrá descontar hasta Bs {deCentavos(ejDesc!)}; con un total de Bs 100,00 la propina podrá llegar a Bs {deCentavos(ejProp!)}.</p>}
      {sube && <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Motivo para subir el límite (obligatorio)</span><input value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={200} placeholder="Ej.: promoción de aniversario" className={clases.input} /><span className="font-body-sm text-on-surface-variant">Quedará guardado con tu nombre, la fecha y los valores anterior y nuevo.</span></label>}
      <button type="button" disabled={ocupado || !cambia || (sube && motivo.trim().length < 3)} onClick={enviar} className={clases.primario}>{ocupado ? 'Guardando…' : 'Guardar límites'}</button>
      {ok && <p role="status" className="text-primary font-body-sm">Listo: los nuevos límites ya valen para el próximo cobro.</p>}
      <p className="font-body-sm text-on-surface-variant">{u ? `Último cambio: ${new Date(u.cuando).toLocaleString('es-BO', { timeZone: 'America/La_Paz' })} por ${u.por ?? 'un usuario'}${u.antes ? ` (antes ${pctTxt(u.antes.descuentoMaxPct)} % y ${pctTxt(u.antes.propinaMaxPct)} %)` : ''}${u.motivo ? ` · motivo: ${u.motivo}` : ''}.` : 'Todavía no se han cambiado: valen los límites de fábrica (30 % y 30 %).'}</p>
    </div>
  );
}

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
  const cambiar = async (c: Partial<Pick<Ajustes, 'pedidosPorQr' | 'qrSinConfirmacion' | 'modoDeCobro' | 'descuentoMaxPct' | 'propinaMaxPct'>> & { motivoCambioTopes?: string }): Promise<boolean> => {
    setError(null);
    try { await api.patch('/sucursal/ajustes', c, sucursalId!); await qc.invalidateQueries({ queryKey: ['ajustes', sucursalId] }); await qc.invalidateQueries({ queryKey: ['cobro-topes', sucursalId] }); return true; }
    catch (e) { setError(mensajeDeError(e)); return false; }
  };
  const qrq = useQuery({ queryKey: ['qr-cliente', sucursalId], queryFn: () => api.get<QrActual>(`/qr-cobro/cliente/${sucursalId}`, sucursalId!), enabled: !!sucursalId });
  const a = q.data;
  return (
    <div className="flex flex-col gap-space-lg max-w-2xl">
      <header><h1 className="font-headline-lg text-headline-lg text-primary tracking-tight">Configuración</h1><p className="font-body-md text-body-md text-on-surface-variant">Ajustes de esta sucursal.</p></header>
      {error && <p role="alert" className="rounded-lg bg-error-container text-on-error-container p-space-sm">{error}</p>}
      {!a ? <ListaEsqueleto /> : (
        <section className="bg-surface-container-lowest border border-outline-variant rounded-xl p-space-md divide-y divide-outline-variant">
          <Interruptor activo={a.pedidosPorQr} cambiar={(v) => cambiar({ pedidosPorQr: v })} titulo="Pedidos por QR" ayuda="El cliente puede pedir platos desde su celular. Apagado, el QR solo muestra el menú y los botones de llamado." />
          <Interruptor activo={a.qrSinConfirmacion} deshabilitado={!a.pedidosPorQr} cambiar={(v) => cambiar({ qrSinConfirmacion: v })} titulo="Enviar a cocina sin confirmar" ayuda="Apagado (recomendado): el mesero confirma con un toque cada pedido del cliente. Encendido: entra directo a cocina." />
          <div className="py-space-sm">
            <p className="font-body-md font-semibold">Documento al cobrar</p>
            <p className="font-body-sm text-body-sm text-on-surface-variant mb-space-xs">Recibo o solo contabilizar. La factura electrónica (en ambiente de pruebas) se configura más abajo, en «Facturación electrónica».</p>
            <div className="grid grid-cols-2 gap-space-xs" role="radiogroup" aria-label="Documento al cobrar">
              {([['recibo', 'Recibos'], ['ninguno', 'Solo contabilizar']] as const).map(([k, n]) => <button key={k} type="button" role="radio" aria-checked={a.modoDeCobro === k} onClick={() => cambiar({ modoDeCobro: k })} className={`h-12 rounded-lg font-semibold ${a.modoDeCobro === k ? 'bg-primary-container text-on-primary' : 'bg-surface-container text-on-surface-variant'}`}>{n}</button>)}
            </div>
          </div>
          <TopesDeCobro key={`${a.descuentoMaxPct}-${a.propinaMaxPct}`} a={a} guardar={cambiar} />
        </section>
      )}
      {sucursalId && (
        <section id="qr-cobro" className="bg-surface-container-lowest border border-outline-variant rounded-xl p-space-md">
          <SubirQr qr={qrq.data} idioma="es" puedeEditar titulo="QR de cobro de tu restaurante" descripcion="Es el QR que se muestra al cobrar con «QR» en caja."
            subir={(f, banco) => api.subirQr(`/qr-cobro/cliente/${sucursalId}`, f, banco, sucursalId)} quitar={() => api.del(`/qr-cobro/cliente/${sucursalId}`, undefined, sucursalId)}
            alCambiar={() => { void qc.invalidateQueries({ queryKey: ['qr-cliente', sucursalId] }); }} />
        </section>
      )}
      <FacturacionConfig />
    </div>
  );
}
