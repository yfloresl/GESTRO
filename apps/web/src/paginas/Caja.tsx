import { confirmar } from '../componentes/Dialogos';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { clases } from '../componentes/Marca';
import { api, mensajeDeError, useRolesActivos } from '../lib/sesion';
import { bs, CajaEstado, Recibo } from '../lib/tipos';
import { ListaEsqueleto } from '../componentes/Esqueleto';
import { centavosDeDiferencia } from '../lib/cierre-caja';

const METODO: Record<string, string> = { efectivo: 'Efectivo', qr: 'QR', tarjeta: 'Tarjeta', transferencia: 'Transferencia', credito: 'Crédito', cuentas_por_cobrar: 'Cobros de cuentas (efectivo)', cuentas_por_cobrar_banco: 'Cobros de cuentas (por banco, no van al cajón)' };
const num = (v: FormDataEntryValue | null) => Number(String(v ?? '').replace(',', '.'));

/** Caja: apertura, cobros del turno por método y cierre con arqueo (el cobro se hace desde el pedido). */
export function Caja() {
  const { sucursalId } = useRolesActivos();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['caja', sucursalId], queryFn: () => api.get<CajaEstado>('/caja/actual', sucursalId!), enabled: !!sucursalId, refetchInterval: 30_000 });
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [cierre, setCierre] = useState<{ esperado: string; contado: string; diferencia: string; explicacion?: string | null } | null>(null);
  // GST-C03: si lo contado no cuadra con lo esperado, la pantalla pide explicarlo.
  const [contado, setContado] = useState('');
  const dif = centavosDeDiferencia(contado, q.data?.efectivoEsperado);
  const refrescar = () => qc.invalidateQueries({ queryKey: ['caja', sucursalId] });

  const abrir = async (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); setError(null); const f = new FormData(e.currentTarget); try { await api.post('/caja/abrir', { montoInicial: num(f.get('monto')) }, sucursalId!); setCierre(null); setAviso('Caja abierta. Ya puedes cobrar.'); await refrescar(); } catch (err) { setError(mensajeDeError(err)); } };
  const cerrar = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setError(null); const f = new FormData(e.currentTarget);
    if (!(await confirmar({ titulo: 'Cerrar la caja', mensaje: 'Ya no podrás cobrar hasta abrir una nueva. ¿Cerrar la caja?', aceptar: 'Cerrar caja' }))) return;
    try { const explicacion = String(f.get('explicacion') ?? '').trim();
      const r = await api.post<{ efectivoEsperado: string; montoContado: string; diferencia: string; explicacion?: string | null }>('/caja/cerrar', { montoContado: num(f.get('contado')), ...(explicacion ? { explicacion } : {}) }, sucursalId!); setAviso(null); setContado(''); setCierre({ esperado: r.efectivoEsperado, contado: r.montoContado, diferencia: r.diferencia, explicacion: r.explicacion }); await refrescar(); } catch (err) { setError(mensajeDeError(err)); }
  };

  const c = q.data;
  return (
    <div className="flex flex-col gap-space-lg max-w-3xl">
      <header><h1 className="font-headline-lg text-headline-lg text-primary tracking-tight">Caja</h1><p className="font-body-md text-body-md text-on-surface-variant">Abre tu caja para cobrar y ciérrala con arqueo al terminar el turno.</p></header>
      {error && <p role="alert" className="rounded-lg bg-error-container text-on-error-container p-space-sm">{error}</p>}
      {aviso && !error && <p role="status" className="rounded-lg bg-tertiary-fixed text-on-tertiary-fixed-variant p-space-sm">{aviso}</p>}
      {cierre && (
        <section role="status" className={`rounded-xl border-2 p-space-md flex flex-col gap-1 ${Number(cierre.diferencia) === 0 ? 'border-tertiary bg-tertiary-fixed' : 'border-error bg-error-container'}`}>
          <h2 className="font-headline-sm text-headline-sm">Caja cerrada</h2>
          <p>Esperado en efectivo: <strong className="font-label-lg">{bs(cierre.esperado)}</strong> · Contado: <strong className="font-label-lg">{bs(cierre.contado)}</strong></p>
          <p className="font-semibold">{Number(cierre.diferencia) === 0 ? 'La caja cuadra.' : `Diferencia: ${bs(cierre.diferencia)} (${Number(cierre.diferencia) < 0 ? 'faltante' : 'sobrante'})`}</p>
          {cierre.explicacion && <p className="font-body-sm text-on-surface-variant">Explicación: {cierre.explicacion}</p>}
        </section>
      )}
      {q.isLoading ? <ListaEsqueleto /> : !c?.activa ? (
        <form onSubmit={abrir} className="bg-surface-container-lowest border border-outline-variant rounded-xl p-space-md flex flex-col gap-space-sm">
          <h2 className="font-headline-sm text-headline-sm">Abrir caja</h2>
          <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Efectivo inicial (Bs)</span><input name="monto" required inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,2})?" title="Escribe un monto válido, por ejemplo 200,50 (sin signo y con a lo más 2 decimales)" defaultValue="0" className={`${clases.input} font-label-lg`} /></label>
          <button className={clases.primario}>Abrir caja</button>
        </form>
      ) : (
        <>
          <section className="grid grid-cols-1 gap-gutter sm:grid-cols-2">
            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-space-md"><p className={clases.etiqueta}>Efectivo esperado</p><p className="font-headline-lg text-headline-lg text-primary font-label-lg">{bs(c.efectivoEsperado!)}</p><p className="font-body-sm text-on-surface-variant">Apertura {bs(c.montoInicial!)} + cobros en efectivo (ventas y cuentas por cobrar)</p></div>
            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-space-md"><p className={clases.etiqueta}>Cobros del turno</p>
              {(c.cobros ?? []).length === 0 ? <p className="text-on-surface-variant">Sin cobros todavía.</p> : <ul className="mt-space-xs flex flex-col gap-1">{c.cobros!.map((x) => <li key={x.metodo} className="flex justify-between"><span>{METODO[x.metodo] ?? x.metodo} <span className="text-on-surface-variant">({x.cantidad})</span></span><span className="font-label-lg">{bs(x.total)}</span></li>)}</ul>}
              {Number(c.propinas ?? 0) > 0 && <p className="mt-space-xs font-body-sm text-on-surface-variant">Propinas cobradas: {bs(c.propinas!)} (se entregan al personal; {bs(c.propinasEnEfectivo ?? 0)} en efectivo están en el cajón y suman al efectivo esperado).</p>}
            </div>
          </section>
          <form onSubmit={cerrar} className="bg-surface-container-lowest border border-outline-variant rounded-xl p-space-md flex flex-col gap-space-sm">
            <h2 className="font-headline-sm text-headline-sm">Cerrar caja (arqueo)</h2>
            <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Efectivo contado (Bs)</span><input name="contado" required value={contado} onChange={(e) => setContado(e.target.value)} inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,2})?" title="Escribe un monto válido, por ejemplo 200,50 (sin signo y con a lo más 2 decimales)" className={`${clases.input} font-label-lg`} /></label>
            {dif !== null && dif !== 0 && (
              <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>La caja no cuadra ({dif < 0 ? 'faltan' : 'sobran'} Bs {(Math.abs(dif) / 100).toFixed(2)}): explica por qué</span><input name="explicacion" required minLength={3} maxLength={300} placeholder="Por ejemplo: vuelto mal dado, gasto menor sin registrar…" className={clases.input} /></label>
            )}
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
  if (q.isLoading) return <ListaEsqueleto />;
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
        {Number(r.descuento ?? 0) > 0 && <>
          <p className="flex justify-between border-t border-dashed border-black pt-1"><span>Subtotal</span><span>{(Math.round(Number(r.monto) * 100 + Number(r.descuento) * 100) / 100).toFixed(2)}</span></p>
          <p className="flex justify-between"><span>Descuento</span><span>− {Number(r.descuento).toFixed(2)}</span></p>
        </>}
        <p className={`flex justify-between ${Number(r.descuento ?? 0) > 0 ? '' : 'border-t border-dashed border-black pt-1'} font-semibold`}><span>TOTAL Bs</span><span>{Number(r.monto).toFixed(2)}</span></p>
        {Number(r.propina ?? 0) > 0 && <>
          <p className="flex justify-between"><span>Propina</span><span>{Number(r.propina).toFixed(2)}</span></p>
          <p className="flex justify-between font-semibold"><span>A PAGAR Bs</span><span>{(Math.round(Number(r.monto) * 100 + Number(r.propina) * 100) / 100).toFixed(2)}</span></p>
        </>}
        {r.recibido != null && <p className="flex justify-between"><span>Efectivo recibido</span><span>{Number(r.recibido).toFixed(2)}</span></p>}
        {r.vuelto != null && Number(r.vuelto) > 0 && <p className="flex justify-between"><span>Vuelto</span><span>{Number(r.vuelto).toFixed(2)}</span></p>}
        <p>Pago: {r.metodo ? METODO[r.metodo] ?? r.metodo : '—'}</p>
        <p className="text-center mt-3">¡Gracias por su visita!</p>
      </article>
    </div>
  );
}
