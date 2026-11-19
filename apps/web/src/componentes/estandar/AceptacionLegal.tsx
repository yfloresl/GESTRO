import { useState } from 'react';
import { AceptacionLegal as CasillaLegal } from '../../lib/kyros-estandar-ui';
import { LEGAL, mensajeErrorAceptacion } from '../../lib/kyros-local';
import { clases } from '../Marca';
/**
 * S-07: aceptación legal. La casilla y su mensaje son los del estándar compartido; aquí solo se maneja el envío. El botón NUNCA queda mudo: sin casilla
 * marcada muestra «Marca la casilla para continuar» y, si el servidor falla, un mensaje legible (nunca un código técnico).
 * `enviar` debe lanzar un error con `status`/`message` si falla.
 */
export function AceptacionLegal({ enviar, textoCasilla = LEGAL.TEXTO_CASILLA }: { enviar: () => Promise<void>; textoCasilla?: string }) {
  const [marcada, setMarcada] = useState(false); const [intento, setIntento] = useState(false); const [error, setError] = useState<string | null>(null); const [enviando, setEnviando] = useState(false);
  const aceptar = async () => {
    setIntento(true);
    if (!marcada) return;
    setError(null); setEnviando(true);
    try { await enviar(); } catch (e) { const x = e as { status?: number; message?: string }; setError(mensajeErrorAceptacion(x.status, x.message)); setEnviando(false); }
  };
  return (
    <div className="flex flex-col gap-space-sm">
      <CasillaLegal marcada={marcada} onCambio={(v) => { setMarcada(v); if (v) setError(null); }} intento={intento} error={error}>{textoCasilla}</CasillaLegal>
      <button type="button" disabled={enviando} onClick={aceptar} className={clases.primario}>{enviando ? 'Guardando…' : 'Aceptar y continuar'}</button>
    </div>
  );
}
