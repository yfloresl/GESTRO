import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, mensajeDeError, useSesion } from '../lib/sesion';
import { clases } from './Marca';

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
        <label className="flex items-start gap-space-sm min-h-12">
          <input type="checkbox" checked={acepta} onChange={(e) => setAcepta(e.target.checked)} className="w-6 h-6 mt-0.5 shrink-0" />
          <span className="font-body-sm text-body-sm">He leído y acepto los <Link to="/terminos" target="_blank" className="text-primary underline">Términos y condiciones</Link>, la <Link to="/privacidad" target="_blank" className="text-primary underline">Política de privacidad</Link> y las <Link to="/politicas" target="_blank" className="text-primary underline">Políticas de uso</Link>.</span>
        </label>
        {error && <p role="alert" className="text-error font-body-sm">{error}</p>}
        <button type="button" disabled={!acepta || enviando} onClick={aceptar} className={clases.primario}>{enviando ? 'Guardando…' : 'Aceptar y continuar'}</button>
      </div>
    </div>
  );
}
