import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { clases } from '../componentes/Marca';
import { api, mensajeDeError, useRolesActivos } from '../lib/sesion';
import { bs, CajaEstado, Recibo } from '../lib/tipos';

const METODO: Record<string, string> = { efectivo: 'Efectivo', qr: 'QR', tarjeta: 'Tarjeta', transferencia: 'Transferencia', credito: 'Crédito' };
const num = (v: FormDataEntryValue | null) => Number(String(v ?? '').replace(',', '.'));

/** Caja: apertura, cobros del turno por método y cierre con arqueo (el cobro se hace desde el pedido). */
export function Caja() {
  const { sucursalId } = useRolesActivos();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['caja', sucursalId], queryFn: () => api.get<CajaEstado>('/caja/actual', sucursalId!), enabled: !!sucursalId, refetchInterval: 30_000 });
  const [error, setError] = useState<string | null>(null);
  const [cierre, setCierre] = useState<{ esperado: string; contado: string; diferencia: string } | null>(null);
  const refrescar = () => qc.invalidateQueries({ queryKey: ['caja', sucursalId] });

  const abrir = async (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); setError(null); const f = new FormData(e.currentTarget); try { await api.post('/caja/abrir', { montoInicial: num(f.get('monto')) }, sucursalId!); setCierre(null); await refrescar(); } catch (err) { setError(mensajeDeError(err)); } };
  const cerrar = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setError(null); const f = new FormData(e.currentTarget);
    if (!confirm('¿Cerrar la caja? Ya no podrás cobrar hasta abrir una nueva.')) return;
    try { const r = await api.post<{ efectivoEsperado: string; montoContado: string; diferencia: string }>('/caja/cerrar', { montoContado: num(f.get('contado')) }, sucursalId!); setCierre({ esperado: r.efectivoEsperado, contado: r.montoContado, diferencia: r.diferencia }); await refrescar(); } catch (err) { setError(mensajeDeError(err)); }
  };

  const c = q.data;
  return (
    <div className="flex flex-col gap-space-lg max-w-3xl">
      <header><h1 className="font-headline-lg text-headline-lg text-primary tracking-tight">Caja</h1><p className="font-body-md text-body-md text-on-surface-variant">Abre tu caja para cobrar y ciérrala con arqueo al terminar el turno.</p></header>
      {error && <p role="alert" className="rounded-lg bg-error-container text-on-error-container p-space-sm">{error}</p>}
      {cierre && (
        <section role="status" className={`rounded-xl border-2 p-space-md flex flex-col gap-1 ${Number(cierre.diferencia) === 0 ? 'border-tertiary bg-tertiary-fixed' : 'border-error bg-error-container'}`}>
          <h2 className="font-headline-sm text-headline-sm">Caja cerrada</h2>
          <p>Esperado en efectivo: <strong className="font-label-lg">{bs(cierre.esperado)}</strong> · Contado: <strong className="font-label-lg">{bs(cierre.contado)}</strong></p>
          <p className="font-semibold">{Number(cierre.diferencia) === 0 ? 'La caja cuadra.' : `Diferencia: ${bs(cierre.diferencia)} (${Number(cierre.diferencia) < 0 ? 'faltante' : 'sobrante'})`}</p>
        </section>
      )}
      {q.isLoading ? <p role="status">Cargando…</p> : !c?.activa ? (
        <form onSubmit={abrir} className="bg-surface-container-lowest border border-outline-variant rounded-xl p-space-md flex flex-col gap-space-sm">
          <h2 className="font-headline-sm text-headline-sm">Abrir caja</h2>
          <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Efectivo inicial (Bs)</span><input name="monto" required inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,2})?" defaultValue="0" className={`${clases.input} font-label-lg`} /></label>
          <button className={clases.primario}>Abrir caja</button>
        </form>
      ) : (
        <>
          <section className="grid grid-cols-1 gap-gutter sm:grid-cols-2">
            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-space-md"><p className={clases.etiqueta}>Efectivo esperado</p><p className="font-headline-lg text-headline-lg text-primary font-label-lg">{bs(c.efectivoEsperado!)}</p><p className="font-body-sm text-on-surface-variant">Apertura {bs(c.montoInicial!)} + cobros en efectivo</p></div>
            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-space-md"><p className={clases.etiqueta}>Cobros del turno</p>
              {(c.cobros ?? []).length === 0 ? <p className="text-on-surface-variant">Sin cobros todavía.</p> : <ul className="mt-space-xs flex flex-col gap-1">{c.cobros!.map((x) => <li key={x.metodo} className="flex justify-between"><span>{METODO[x.metodo] ?? x.metodo} <span className="text-on-surface-variant">({x.cantidad})</span></span><span className="font-label-lg">{bs(x.total)}</span></li>)}</ul>}
            </div>
          </section>
          <form onSubmit={cerrar} className="bg-surface-container-lowest border border-outline-variant rounded-xl p-space-md flex flex-col gap-space-sm">
            <h2 className="font-headline-sm text-headline-sm">Cerrar caja (arqueo)</h2>
            <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Efectivo contado (Bs)</span><input name="contado" required inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,2})?" className={`${clases.input} font-label-lg`} /></label>
            <button className="h-14 rounded-lg bg-error text-on-error font-semibold">Cerrar caja</button>
          </form>
        </>
      )}
    </div>
  );
}

/** Recibo imprimible (58/80 mm desde el navegador). Rotulado «no es una factura». */
export function ReciboPagina() {
  const { id } = useParams();
  const { sucursalId } = useRolesActivos();
  const q = useQuery({ queryKey: ['recibo', id], queryFn: () => api.get<Recibo>(`/recibos/${id}`, sucursalId!), enabled: !!sucursalId && !!id });
  useEffect(() => { document.body.classList.add('imprimiendo-recibo'); return () => document.body.classList.remove('imprimiendo-recibo'); }, []);
  const r = q.data;
  if (q.isLoading) return <p role="status">Cargando recibo…</p>;
  if (!r) return <p role="alert" className="text-error">No encontramos ese recibo.</p>;
  return (
    <div className="flex flex-col items-center gap-space-md">
      <button type="button" onClick={() => window.print()} className={`${clases.primario} max-w-xs print:hidden`}><span className="material-symbols-outlined" aria-hidden="true">print</span>Imprimir</button>
      <article id="recibo" className="w-[80mm] max-w-full bg-white text-black p-4 font-label-md text-label-md border border-outline-variant print:border-0 print:w-[80mm]" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
        <p className="text-center font-semibold">{r.restaurante}</p>
        <p className="text-center">{r.razonSocial}{r.nit ? ` · NIT ${r.nit}` : ''}</p>
        <p className="text-center my-2 font-semibold border-y border-dashed border-black py-1">{r.leyenda}</p>
        {r.anulado && <p className="text-center font-bold text-lg border-2 border-black my-2">ANULADO{r.motivoAnulacion ? ` — ${r.motivoAnulacion}` : ''}</p>}
        <p>Recibo N° {String(r.numero).padStart(6, '0')}</p>
        <p>{new Date(r.emitido).toLocaleString('es-BO', { timeZone: 'America/La_Paz' })}</p>
        <p>{r.mesa ? `Mesa ${r.mesa}` : r.ticket ? `Ticket #${r.ticket}` : ''}{r.cliente ? ` · ${r.cliente}` : ''}</p>
        <table className="w-full my-2 text-left"><tbody>{r.items.map((i, k) => <tr key={k}><td className="align-top">{Number(i.cantidad)}× {i.nombre}</td><td className="text-right align-top">{Number(Number(i.cantidad) * Number(i.precio)).toFixed(2)}</td></tr>)}</tbody></table>
        <p className="flex justify-between border-t border-dashed border-black pt-1 font-semibold"><span>TOTAL Bs</span><span>{Number(r.monto).toFixed(2)}</span></p>
        <p>Pago: {r.metodo ? METODO[r.metodo] ?? r.metodo : '—'}</p>
        <p className="text-center mt-3">¡Gracias por su visita!</p>
      </article>
    </div>
  );
}
