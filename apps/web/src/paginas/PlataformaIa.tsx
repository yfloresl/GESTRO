import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { clases } from '../componentes/Marca';
import { api, mensajeDeError } from '../lib/sesion';

interface Estado { configurada: boolean; ultimosCaracteres: string | null; activa: boolean; baseUrl: string; modelos: { foda: string; asistente: string; rapido: string }; precios: Record<string, { entrada: number; salida: number }>; limiteMensualUsd: number | null; limiteDiarioPorSucursal: number;
  usoDelMes: { llamadas: number; tokensEntrada: number; tokensSalida: number; costoUsd: string } }
const num = (v: FormDataEntryValue | null) => Number(String(v ?? '').replace(',', '.'));

/** Consola de plataforma: clave de Claude (se guarda cifrada y nunca se vuelve a mostrar), modelos por tarea, precios y límites de gasto. */
export function PlataformaIa() {
  const qc = useQueryClient(); const [error, setError] = useState<string | null>(null); const [msg, setMsg] = useState<string | null>(null); const [ocupado, setOcupado] = useState(false);
  const q = useQuery({ queryKey: ['plataforma-ia'], queryFn: () => api.get<Estado>('/plataforma/ia') });
  const e = q.data;
  const accion = async (f: () => Promise<unknown>, ok: string) => { setError(null); setMsg(null); setOcupado(true); try { await f(); setMsg(ok); await qc.invalidateQueries({ queryKey: ['plataforma-ia'] }); } catch (err) { setError(mensajeDeError(err)); } finally { setOcupado(false); } };
  const clave = (ev: FormEvent<HTMLFormElement>) => { ev.preventDefault(); const f = new FormData(ev.currentTarget); const form = ev.currentTarget; void accion(async () => { await api.put('/plataforma/ia', { apiKey: String(f.get('clave')).trim() }); form.reset(); }, 'Clave guardada (cifrada). No se vuelve a mostrar.'); };
  const ajustes = (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault(); const f = new FormData(ev.currentTarget); const s = (k: string) => String(f.get(k) ?? '').trim();
    const precios: Record<string, { entrada: number; salida: number }> = {};
    for (const m of [s('m_foda'), s('m_asistente'), s('m_rapido')]) if (m && s(`pe_${m}`) !== '' && s(`ps_${m}`) !== '') precios[m] = { entrada: num(f.get(`pe_${m}`)), salida: num(f.get(`ps_${m}`)) };
    void accion(() => api.put('/plataforma/ia', { baseUrl: s('url'), modelos: { foda: s('m_foda'), asistente: s('m_asistente'), rapido: s('m_rapido') }, precios, limiteMensualUsd: s('limite') ? num(f.get('limite')) : null, limiteDiarioPorSucursal: Math.round(num(f.get('diario'))) }), 'Ajustes guardados.');
  };
  if (!e) return <p role="status">Cargando…</p>;
  const modelos = [...new Set([e.modelos.foda, e.modelos.asistente, e.modelos.rapido])];
  return (
    <section className="flex flex-col gap-space-md">
      {error && <p role="alert" className="rounded-lg bg-error-container text-on-error-container p-space-sm">{error}</p>}{msg && <p role="status" className="rounded-lg bg-tertiary-fixed text-on-tertiary-fixed-variant p-space-sm">{msg}</p>}
      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-space-md flex flex-col gap-space-sm">
        <h2 className="font-headline-sm text-headline-sm">Clave de Claude</h2>
        <p>{e.configurada ? <>Hay una clave guardada, termina en <strong>…{e.ultimosCaracteres}</strong>. Está cifrada en la base de datos y no se puede volver a ver.</> : 'Todavía no hay una clave. Sin ella, el asistente no responde y el FODA se arma solo con reglas.'}</p>
        <form onSubmit={clave} className="flex flex-col gap-space-xs sm:flex-row"><input name="clave" type="password" autoComplete="off" required minLength={20} placeholder={e.configurada ? 'Pega una clave nueva para reemplazarla' : 'sk-ant-…'} aria-label="Clave de la API de Anthropic" className={clases.input} /><button disabled={ocupado} className="h-[52px] px-space-md rounded-lg bg-primary text-on-primary font-semibold whitespace-nowrap">Guardar clave</button></form>
        <div className="flex flex-wrap gap-space-xs">
          <button type="button" disabled={ocupado || !e.configurada} onClick={() => accion(async () => { const r = await api.post<{ modelo: string }>('/plataforma/ia/probar'); setMsg(`La clave funciona (respondió ${r.modelo}).`); }, '')} className="h-12 px-space-md rounded-lg border border-outline-variant font-semibold disabled:opacity-50">Probar conexión</button>
          <button type="button" disabled={ocupado || !e.configurada} onClick={() => { if (confirm('¿Quitar la clave de IA? El asistente dejará de funcionar.')) void accion(() => api.del('/plataforma/ia/clave'), 'Clave eliminada.'); }} className="h-12 px-space-md rounded-lg border border-error text-error font-semibold disabled:opacity-50">Quitar clave</button>
          <button type="button" disabled={ocupado} onClick={() => accion(() => api.put('/plataforma/ia', { activa: !e.activa }), e.activa ? 'IA apagada para todas las sucursales.' : 'IA encendida.')} className="h-12 px-space-md rounded-lg border border-outline-variant font-semibold">{e.activa ? 'Apagar la IA' : 'Encender la IA'}</button></div>
      </div>
      <div className="grid grid-cols-2 gap-gutter md:grid-cols-4">
        {[['Consultas del mes', String(e.usoDelMes.llamadas)], ['Tokens de entrada', e.usoDelMes.tokensEntrada.toLocaleString('es-BO')], ['Tokens de salida', e.usoDelMes.tokensSalida.toLocaleString('es-BO')], ['Costo estimado', Number(e.usoDelMes.costoUsd) > 0 ? `USD ${e.usoDelMes.costoUsd}` : 'Sin precios cargados']].map(([t, v]) => <div key={t} className="rounded-xl border border-outline-variant bg-surface-container-lowest p-space-md"><p className="font-label-sm uppercase text-on-surface-variant">{t}</p><p className="font-headline-sm text-headline-sm text-primary">{v}</p></div>)}</div>
      <form onSubmit={ajustes} key={JSON.stringify(e.modelos) + e.baseUrl + e.limiteDiarioPorSucursal} className="bg-surface-container-lowest border border-outline-variant rounded-xl p-space-md grid grid-cols-1 gap-space-sm md:grid-cols-3">
        <h2 className="font-headline-sm text-headline-sm md:col-span-3">Modelos, precios y límites</h2>
        {([['m_foda', 'Modelo del FODA', e.modelos.foda], ['m_asistente', 'Modelo del asistente', e.modelos.asistente], ['m_rapido', 'Modelo rápido (pruebas)', e.modelos.rapido]] as const).map(([k, n, v]) => <label key={k} className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>{n}</span><input name={k} defaultValue={v} required className={clases.input} /></label>)}
        {modelos.map((m) => <div key={m} className="grid grid-cols-2 gap-space-xs md:col-span-1"><label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>USD/millón entrada · {m}</span><input name={`pe_${m}`} inputMode="decimal" defaultValue={e.precios[m]?.entrada ?? ''} className={clases.input} /></label><label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>salida</span><input name={`ps_${m}`} inputMode="decimal" defaultValue={e.precios[m]?.salida ?? ''} className={clases.input} /></label></div>)}
        <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Límite mensual (USD, vacío = sin límite)</span><input name="limite" inputMode="decimal" defaultValue={e.limiteMensualUsd ?? ''} className={clases.input} /></label>
        <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Consultas por día por sucursal</span><input name="diario" type="number" min={1} defaultValue={e.limiteDiarioPorSucursal} className={clases.input} /></label>
        <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Dirección de la API</span><input name="url" defaultValue={e.baseUrl} className={clases.input} /></label>
        <p className="font-body-sm text-on-surface-variant md:col-span-3">Los precios sirven para estimar el costo: si no los cargas, el costo queda sin calcular y el límite mensual no se aplica. Usa los precios vigentes de tu cuenta de Anthropic.</p>
        <button disabled={ocupado} className={`${clases.primario} md:col-span-3`}>Guardar ajustes</button>
      </form>
    </section>
  );
}
