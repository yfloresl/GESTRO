/** Marcadores de carga: dan forma a lo que viene en vez de un texto «Cargando…». Respetan «reducir movimiento». */
export function Esqueleto({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`rounded-lg bg-surface-container-high motion-safe:animate-pulse ${className}`} />;
}

export function ListaEsqueleto({ filas = 4 }: { filas?: number }) {
  return (
    <div role="status" aria-label="Cargando" className="grid grid-cols-1 gap-gutter md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: filas }, (_, i) => (
        <div key={i} className="rounded-xl border border-outline-variant bg-surface-container-lowest p-space-md flex flex-col gap-space-sm">
          <Esqueleto className="h-5 w-2/5" /><Esqueleto className="h-4 w-4/5" /><Esqueleto className="h-4 w-3/5" />
        </div>))}
      <span className="sr-only">Cargando…</span>
    </div>
  );
}
