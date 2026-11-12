import { useQuery } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Markdown, TEXTOS_LOCALES, TITULOS, type DocLegal, type IdiomaLegal } from '../paginas/Legal';

interface Vigente { documento: string; titulo: string; version: string; idioma: string; markdown: string }
const idiomaInicial = (): IdiomaLegal => (typeof navigator !== 'undefined' && navigator.language?.startsWith('en') ? 'en' : 'es');

/** Lee el texto vigente de la API pública (sin sesión); si la red falla, usa el texto empaquetado con la web. */
export function useDocumentoLegal(doc: DocLegal, idioma: IdiomaLegal) {
  return useQuery({
    queryKey: ['legal-vigente', doc, idioma], staleTime: 600_000, retry: 0,
    queryFn: async (): Promise<Vigente> => {
      try { const r = await fetch(`/api/v1/public/legal/${doc}/vigente?idioma=${idioma}`); if (r.ok) return await r.json(); } catch { /* respaldo local */ }
      return { documento: doc, titulo: TITULOS[idioma][doc], version: '', idioma, markdown: TEXTOS_LOCALES(idioma, doc) };
    },
  });
}

const FOCALIZABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/** Diálogo de lectura SOBRE la pantalla actual: foco atrapado y devuelto al cerrar, Esc cierra, scroll interno, casi pantalla completa en móvil. */
export function ModalLegal({ doc, cerrar }: { doc: DocLegal; cerrar(): void }) {
  const [idioma, setIdioma] = useState<IdiomaLegal>(idiomaInicial);
  const q = useDocumentoLegal(doc, idioma);
  const caja = useRef<HTMLDivElement>(null); const previo = useRef<Element | null>(null);

  useEffect(() => {
    previo.current = document.activeElement;
    caja.current?.querySelector<HTMLElement>('button')?.focus();
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); cerrar(); return; }
      if (e.key !== 'Tab' || !caja.current) return;
      const f = [...caja.current.querySelectorAll<HTMLElement>(FOCALIZABLE)]; if (!f.length) return;
      const primero = f[0]; const ultimo = f[f.length - 1];
      if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
      else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
    };
    document.addEventListener('keydown', tecla, true);
    const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', tecla, true); document.body.style.overflow = overflow; (previo.current as HTMLElement | null)?.focus?.(); };
  }, [cerrar]);

  return (
    <div role="dialog" aria-modal="true" aria-label={TITULOS[idioma][doc]} className="fixed inset-0 z-[90] bg-inverse-surface/60 flex items-center justify-center p-0 sm:p-space-md" onMouseDown={(e) => e.target === e.currentTarget && cerrar()}>
      <div ref={caja} className="bg-surface w-full h-full sm:h-auto sm:max-h-[85vh] sm:max-w-3xl sm:rounded-xl flex flex-col overflow-hidden">
        <header className="flex flex-wrap items-center justify-between gap-space-sm p-space-md border-b border-outline-variant">
          <div className="min-w-0"><h2 className="font-headline-sm text-headline-sm text-primary truncate">{TITULOS[idioma][doc]}</h2>{q.data?.version && <p className="font-body-sm text-on-surface-variant">{idioma === 'es' ? 'Versión' : 'Version'} {q.data.version}</p>}</div>
          <div className="flex items-center gap-space-xs">
            <div role="group" aria-label={idioma === 'es' ? 'Idioma' : 'Language'} className="flex gap-space-xs">{(['es', 'en'] as const).map((i) => <button key={i} type="button" aria-pressed={idioma === i} onClick={() => setIdioma(i)} className={`h-12 px-space-md rounded-lg font-semibold ${idioma === i ? 'bg-primary-container text-on-primary' : 'bg-surface-container text-on-surface-variant'}`}>{i === 'es' ? 'ES' : 'EN'}</button>)}</div>
            <button type="button" onClick={cerrar} aria-label={idioma === 'es' ? 'Cerrar' : 'Close'} className="w-12 h-12 rounded-lg hover:bg-surface-container"><span className="material-symbols-outlined" aria-hidden="true">close</span></button>
          </div>
        </header>
        <div className="overflow-y-auto p-space-md" tabIndex={0}>{q.isLoading ? <p role="status">…</p> : <Markdown md={q.data!.markdown} />}</div>
      </div>
    </div>
  );
}

interface Ctx { abrir(doc: DocLegal): void }
const Contexto = createContext<Ctx>({ abrir: () => undefined });
export const useLegal = () => useContext(Contexto);

/** Un solo popup para toda la app: cualquier enlace «Leer» o «Términos · Privacidad» lo abre sin navegar ni perder el estado de la pantalla. */
export function LegalProvider({ children }: { children: ReactNode }) {
  const [doc, setDoc] = useState<DocLegal | null>(null);
  const abrir = useCallback((d: DocLegal) => setDoc(d), []); const cerrar = useCallback(() => setDoc(null), []);
  return <Contexto.Provider value={{ abrir }}>{children}{doc && <ModalLegal doc={doc} cerrar={cerrar} />}</Contexto.Provider>;
}

/** Enlace-botón que abre el documento en el popup. */
export function EnlaceLegal({ doc, children, className = 'text-primary underline' }: { doc: DocLegal; children?: ReactNode; className?: string }) {
  const { abrir } = useLegal();
  return <button type="button" onClick={() => abrir(doc)} className={className}>{children ?? TITULOS.es[doc]}</button>;
}

/** Pie permanente «Términos · Privacidad». Cada enlace tiene su URL propia (/legal/terminos, /legal/privacidad) y, con JavaScript, abre el popup. */
export function PieLegal({ className = '' }: { className?: string }) {
  const { abrir } = useLegal();
  const ir = (d: DocLegal) => (e: React.MouseEvent) => { e.preventDefault(); abrir(d); };
  return (
    <nav aria-label="Legal" className={`flex flex-wrap justify-center gap-space-md font-body-sm text-on-surface-variant ${className}`}>
      <a href="/legal/terminos" onClick={ir('terminos')} className="underline hover:text-primary">Términos</a><span aria-hidden="true">·</span>
      <a href="/legal/privacidad" onClick={ir('privacidad')} className="underline hover:text-primary">Privacidad</a><span aria-hidden="true">·</span>
      <a href="/legal/politicas" onClick={ir('politicas')} className="underline hover:text-primary">Políticas</a>
    </nav>
  );
}
