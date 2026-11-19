import { useState } from 'react';
import { BOTONES, LEGAL, mensajeErrorAceptacion, validarAceptacion } from '../../lib/kyros-estandar';
import { clases } from '../Marca';

/**
 * S-07: componente ÚNICO de aceptación legal (casilla + «Aceptar y continuar»). El botón NUNCA queda mudo: sin casilla marcada dice
 * «Marca la casilla para continuar.» y, si el servidor falla, muestra un mensaje legible (nunca un código técnico).
 * `enviar` debe lanzar un error con `status`/`message` si falla.
 */
export function AceptacionLegal({ enviar, textoCasilla = LEGAL.TEXTO_CASILLA }: { enviar: () => Promise<void>; textoCasilla?: string }) {
  const [marcada, setMarcada] = useState(false); const [aviso, setAviso] = useState<string | null>(null); const [enviando, setEnviando] = useState(false);
  const aceptar = async () => {
    const falta = validarAceptacion(marcada);
    if (falta) { setAviso(falta); return; }
    setAviso(null); setEnviando(true);
    try { await enviar(); } catch (e) { const x = e as { status?: number; message?: string }; setAviso(mensajeErrorAceptacion(x.status, x.message)); setEnviando(false); }
  };
  return (
    <div className="flex flex-col gap-space-sm">
      <label className="flex items-start gap-space-sm min-h-12">
        <input type="checkbox" checked={marcada} onChange={(e) => { setMarcada(e.target.checked); if (e.target.checked) setAviso(null); }} className="w-6 h-6 mt-0.5 shrink-0" aria-describedby="aviso-legal" />
        <span className="font-body-sm text-body-sm">{textoCasilla}</span>
      </label>
      <p id="aviso-legal" role="alert" className="text-error font-body-sm">{aviso}</p>
      <button type="button" disabled={enviando} onClick={aceptar} className={clases.primario}>{enviando ? 'Guardando…' : BOTONES.aceptarYContinuar}</button>
    </div>
  );
}
