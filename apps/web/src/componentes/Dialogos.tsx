import { useEffect, useRef, useState } from 'react';

/**
 * GST-003: reemplazo accesible de confirm() y prompt() del navegador.
 * Uso: `if (!(await confirmar('¿Cerrar la caja?'))) return;` y `const m = await pedirTexto({ titulo: 'Motivo' })` (null = canceló).
 * Se monta una sola vez (<DialogosProvider/>) en la raíz. Con foco atrapado, Esc para cancelar y retorno del foco al botón de origen.
 */
export interface OpcionesConfirmar { titulo?: string; mensaje: string; aceptar?: string; cancelar?: string; peligro?: boolean }
export interface OpcionesTexto { titulo: string; mensaje?: string; etiqueta?: string; valor?: string; aceptar?: string; obligatorio?: boolean; minimo?: number; maximo?: number; teclado?: 'text' | 'decimal' | 'numeric' }

type Peticion =
  | { tipo: 'confirmar'; op: OpcionesConfirmar; fin(v: boolean): void }
  | { tipo: 'texto'; op: OpcionesTexto; fin(v: string | null): void };

let abrir: ((p: Peticion) => void) | null = null;

export function confirmar(op: string | OpcionesConfirmar): Promise<boolean> {
  const o = typeof op === 'string' ? { mensaje: op } : op;
  // Sin proveedor montado (pruebas): se cancela en lugar de ejecutar una acción destructiva sin preguntar.
  if (!abrir) return Promise.resolve(false);
  return new Promise((fin) => abrir!({ tipo: 'confirmar', op: o, fin }));
}
export function pedirTexto(op: OpcionesTexto): Promise<string | null> {
  if (!abrir) return Promise.resolve(null);
  return new Promise((fin) => abrir!({ tipo: 'texto', op, fin }));
}

export function DialogosProvider() {
  const [cola, setCola] = useState<Peticion[]>([]);
  useEffect(() => { abrir = (p) => setCola((c) => [...c, p]); return () => { abrir = null; }; }, []);
  const actual = cola[0];
  if (!actual) return null;
  const terminar = () => setCola((c) => c.slice(1));
  return <Cuadro key={cola.length + (actual.tipo === 'confirmar' ? actual.op.mensaje : actual.op.titulo)} p={actual} terminar={terminar} />;
}

function Cuadro({ p, terminar }: { p: Peticion; terminar(): void }) {
  const previo = useRef<Element | null>(typeof document !== 'undefined' ? document.activeElement : null);
  const caja = useRef<HTMLDivElement>(null);
  const [texto, setTexto] = useState(p.tipo === 'texto' ? p.op.valor ?? '' : '');
  const [error, setError] = useState<string | null>(null);
  const idT = useRef(`dlg-${Math.random().toString(36).slice(2, 8)}`).current;
  const cerrar = (v: boolean | string | null) => {
    if (p.tipo === 'confirmar') p.fin(v === true); else p.fin(typeof v === 'string' ? v : null);
    terminar();
    (previo.current as HTMLElement | null)?.focus?.();
  };
  const cancelar = () => cerrar(p.tipo === 'confirmar' ? false : null);
  useEffect(() => { // foco inicial: el campo, o el botón seguro (Cancelar) en acciones peligrosas
    const el = caja.current?.querySelector<HTMLElement>(p.tipo === 'texto' ? 'input' : p.op.peligro ? '[data-cancelar]' : '[data-aceptar]');
    el?.focus();
  }, [p]);
  const teclas = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); cancelar(); return; }
    if (e.key !== 'Tab') return;
    const f = [...(caja.current?.querySelectorAll<HTMLElement>('button, input, textarea, [href]') ?? [])].filter((x) => !x.hasAttribute('disabled'));
    if (!f.length) return;
    const primero = f[0]; const ultimo = f[f.length - 1];
    if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
    else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
  };
  const aceptarTexto = () => {
    if (p.tipo !== 'texto') return;
    const v = texto.trim();
    const min = p.op.minimo ?? (p.op.obligatorio === false ? 0 : 1);
    if (v.length < min) { setError(min > 1 ? `Escribe al menos ${min} caracteres.` : 'Este dato es obligatorio.'); return; }
    cerrar(v);
  };
  const titulo = p.tipo === 'confirmar' ? p.op.titulo ?? 'Confirma la acción' : p.op.titulo;
  const peligro = p.tipo === 'confirmar' && p.op.peligro;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-inverse-surface/50 p-space-md" onMouseDown={(e) => { if (e.target === e.currentTarget) cancelar(); }}>
      <div ref={caja} role="alertdialog" aria-modal="true" aria-labelledby={`${idT}-t`} aria-describedby={`${idT}-m`} onKeyDown={teclas} className="w-full max-w-md bg-surface rounded-xl p-space-md flex flex-col gap-space-md shadow-xl">
        <h2 id={`${idT}-t`} className="font-headline-md text-headline-md text-primary">{titulo}</h2>
        <p id={`${idT}-m`} className="text-on-surface-variant whitespace-pre-line">{p.tipo === 'confirmar' ? p.op.mensaje : p.op.mensaje ?? ''}</p>
        {p.tipo === 'texto' && (
          <label className="flex flex-col gap-space-xs">
            <span className="font-label-md text-label-md text-on-surface-variant">{p.op.etiqueta ?? 'Escribe aquí'}</span>
            <input value={texto} onChange={(e) => { setTexto(e.target.value); setError(null); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); aceptarTexto(); } }}
              maxLength={p.op.maximo ?? 200} inputMode={p.op.teclado ?? 'text'} aria-invalid={!!error} aria-describedby={error ? `${idT}-e` : undefined}
              className="h-12 rounded-lg border border-outline-variant bg-surface-container-lowest px-space-sm" />
          </label>
        )}
        {error && <p id={`${idT}-e`} role="alert" className="text-error">{error}</p>}
        <div className="grid grid-cols-2 gap-space-sm">
          <button type="button" data-cancelar onClick={cancelar} className="h-14 rounded-lg border border-outline-variant font-semibold">{p.tipo === 'confirmar' ? p.op.cancelar ?? 'Cancelar' : 'Cancelar'}</button>
          <button type="button" data-aceptar onClick={() => (p.tipo === 'confirmar' ? cerrar(true) : aceptarTexto())} className={`h-14 rounded-lg font-semibold ${peligro ? 'bg-error text-on-error' : 'bg-primary text-on-primary'}`}>{p.op.aceptar ?? 'Aceptar'}</button>
        </div>
      </div>
    </div>
  );
}
