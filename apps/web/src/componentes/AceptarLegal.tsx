import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, mensajeDeError, useSesion } from '../lib/sesion';
import { clases } from './Marca';
import { EnlaceLegal } from './ModalLegal';

/** Si cambió la versión de los Términos o la Privacidad, se pide aceptar de nuevo antes de seguir. Las cuentas de demostración y de plataforma están exentas (el servidor lo decide). */
export function AceptarLegal() {
  const { sesion } = useSesion();
  const qc = useQueryClient();
  const [acepta, setAcepta] = useState(false); const [error, setError] = useState<string | null>(null); const [enviando, setEnviando] = useState(false);
  const q = useQuery({ queryKey: ['legal-estado', sesion?.usuario.id], queryFn: () => api.get<{ version: string; aceptada: boolean }>('/legal/estado'), enabled: !!sesion, staleTime: 300_000, retry: 1 });
  if (!q.data || q.data.aceptada) return null;
  const aceptar = async () => {
    setError(null); setEnviando(true);
    try { await api.post('/legal/aceptar', { acepto: true, version: q.data!.version }); await qc.invalidateQueries({ queryKey: ['legal-estado'] }); }
    catch (e) { setError(mensajeDeError(e)); setEnviando(false); }
  };
  return (
    <div role="dialog" aria-modal="true" aria-label="Actualización de términos" className="fixed inset-0 z-[80] bg-inverse-surface/60 flex items-center justify-center p-space-md">
      <div className="w-full max-w-md bg-surface rounded-xl p-space-lg flex flex-col gap-space-md">
        <h2 className="font-headline-md text-headline-md text-primary">Actualizamos nuestros términos</h2>
        <p className="text-on-surface-variant">Para seguir usando GESTRO necesitamos que revises y aceptes la versión vigente ({q.data.version}).</p>
        <ul className="flex flex-col gap-space-xs border border-outline-variant rounded-lg divide-y divide-outline-variant">
          {([['terminos', 'Términos y condiciones'], ['privacidad', 'Política de privacidad'], ['politicas', 'Políticas de uso']] as const).map(([d, t]) => (
            <li key={d} className="flex items-center justify-between gap-space-sm p-space-sm"><span className="font-body-sm">{t} · v{q.data!.version}</span><EnlaceLegal doc={d} className="h-12 px-space-sm text-primary underline font-semibold">Leer</EnlaceLegal></li>))}
        </ul>
        <label className="flex items-start gap-space-sm min-h-12">
          <input type="checkbox" checked={acepta} onChange={(e) => setAcepta(e.target.checked)} className="w-6 h-6 mt-0.5 shrink-0" />
          <span className="font-body-sm text-body-sm">He leído y acepto los Términos y condiciones, la Política de privacidad y las Políticas de uso.</span>
        </label>
        {error && <p role="alert" className="text-error font-body-sm">{error}</p>}
        <button type="button" disabled={!acepta || enviando} onClick={aceptar} className={clases.primario}>{enviando ? 'Guardando…' : 'Aceptar y continuar'}</button>
      </div>
    </div>
  );
}
