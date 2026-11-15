import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { clases } from '../componentes/Marca';
import { api, mensajeDeError } from '../lib/sesion';
import { bs } from '../lib/tipos';

interface Datos { tipo: 'NIT' | 'CI' | 'CEX' | 'PAS'; numero: string | null; complemento: string | null; razonSocial: string; correo: string | null }
interface Factura { id: string; estado: string; numero: number | null; total: string; iva: string; descripcion: string; simulada: boolean; avisoFiscal: string | null; emitidaEn: string | null }

/** «Datos para tu factura» (NIT/CI y razón social) y «Mis facturas» de la suscripción, emitidas por Kyros-Tech vía FacturaSIN. */
export function FacturasDeSuscripcion({ sucursalId }: { sucursalId: string }) {
  const qc = useQueryClient();
  const d = useQuery({ queryKey: ['datos-fiscales', sucursalId], queryFn: () => api.get<Datos>('/suscripcion/datos-fiscales', sucursalId) });
  const f = useQuery({ queryKey: ['mis-facturas', sucursalId], queryFn: () => api.get<Factura[]>('/suscripcion/facturas', sucursalId) });
  const [error, setError] = useState<string | null>(null); const [ok, setOk] = useState<string | null>(null);
  const guardar = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setError(null); setOk(null); const x = new FormData(e.currentTarget);
    try {
      await api.put('/suscripcion/datos-fiscales', { tipo: String(x.get('tipo')), numero: String(x.get('numero')).trim() || null, complemento: String(x.get('complemento')).trim() || null, razonSocial: String(x.get('razon')).trim(), correo: String(x.get('correo')).trim() || null }, sucursalId);
      setOk('Datos guardados. Se usarán en tus próximas facturas.'); await qc.invalidateQueries({ queryKey: ['datos-fiscales', sucursalId] });
    } catch (err) { setError(mensajeDeError(err, 'No pudimos guardar tus datos.')); }
  };
  const pdf = async (id: string) => { try { const b = await api.blob(`/suscripcion/facturas/${id}/pdf`, sucursalId); const u = URL.createObjectURL(b); window.open(u, '_blank', 'noopener'); setTimeout(() => URL.revokeObjectURL(u), 60_000); } catch (err) { setError(mensajeDeError(err, 'No pudimos abrir la factura.')); } };
  return (
    <section aria-labelledby="fact" className="flex flex-col gap-space-sm">
      <h2 id="fact" className="font-headline-sm text-headline-sm">Datos para tu factura</h2>
      <p className="font-body-sm text-on-surface-variant">Kyros-Tech factura tu suscripción con estos datos. Sin NIT no se bloquea nada, pero la factura saldrá a «S/N» solo si Kyros-Tech lo decide. Hoy las facturas son de prueba (sin validez fiscal).</p>
      {d.data && (
        <form key={`${d.data.numero}|${d.data.razonSocial}`} onSubmit={guardar} className="bg-surface-container-lowest border border-outline-variant rounded-xl p-space-md grid grid-cols-1 gap-space-sm sm:grid-cols-2">
          <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Tipo de documento</span><select name="tipo" defaultValue={d.data.tipo} className={clases.input}><option value="NIT">NIT</option><option value="CI">Cédula de identidad</option><option value="CEX">Cédula de extranjero</option><option value="PAS">Pasaporte</option></select></label>
          <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Número</span><input name="numero" defaultValue={d.data.numero ?? ''} inputMode="numeric" maxLength={30} className={`${clases.input} font-label-lg`} /></label>
          <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Complemento (solo CI)</span><input name="complemento" defaultValue={d.data.complemento ?? ''} maxLength={5} className={clases.input} /></label>
          <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Razón social</span><input name="razon" required minLength={2} maxLength={150} defaultValue={d.data.razonSocial} className={clases.input} /></label>
          <label className="flex flex-col gap-space-xs sm:col-span-2"><span className={clases.etiqueta}>Correo para la factura (opcional)</span><input name="correo" type="email" maxLength={120} defaultValue={d.data.correo ?? ''} className={clases.input} /></label>
          {error && <p role="alert" className="text-error sm:col-span-2">{error}</p>}{ok && <p role="status" className="rounded-lg bg-tertiary-fixed text-on-tertiary-fixed-variant p-space-sm sm:col-span-2">{ok}</p>}
          <button className={`${clases.primario} sm:col-span-2`}>Guardar datos</button>
        </form>)}
      <h2 className="font-headline-sm text-headline-sm">Mis facturas</h2>
      {(f.data ?? []).length === 0 ? <p className="rounded-xl border border-outline-variant bg-surface-container-lowest p-space-md text-on-surface-variant">Todavía no hay facturas de tu suscripción.</p> : (
        <ul className="flex flex-col gap-space-xs">{f.data!.map((x) => (
          <li key={x.id} className="bg-surface-container-lowest border border-outline-variant rounded-xl p-space-md flex flex-wrap items-center justify-between gap-space-sm">
            <div><p className="font-body-md font-semibold">{x.numero ? `N.º ${x.numero} · ` : ''}{bs(x.total)} <span className="font-body-sm text-on-surface-variant">(IVA {bs(x.iva)})</span></p><p className="font-body-sm text-on-surface-variant">{x.descripcion}{x.simulada ? ' · PRUEBA, sin validez fiscal' : ''} · {x.estado}</p></div>
            {['emitida', 'en_proceso', 'anulada'].includes(x.estado) && <button type="button" onClick={() => pdf(x.id)} className={`${clases.secundario} sm:w-auto sm:px-space-md`}>Ver PDF</button>}
          </li>))}</ul>)}
    </section>
  );
}
