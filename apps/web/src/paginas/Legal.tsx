import { useQuery } from '@tanstack/react-query';
import { Fragment, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Marca } from '../componentes/Marca';

export type DocLegal = 'terminos' | 'privacidad' | 'politicas';
export type IdiomaLegal = 'es' | 'en';
type Idioma = IdiomaLegal;

// Los textos viven en docs/legal (fuente) y se copian a src/legal con scripts/sync-legal.mjs.
const TEXTOS = import.meta.glob('../legal/*/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const texto = (idioma: Idioma, doc: DocLegal) => TEXTOS[`../legal/${idioma}/${doc}.md`] ?? '';
export const TEXTOS_LOCALES = texto;   // respaldo del popup si la API pública no responde

export const TITULOS: Record<Idioma, Record<DocLegal, string>> = {
  es: { terminos: 'Términos y condiciones', privacidad: 'Política de privacidad', politicas: 'Políticas de uso' },
  en: { terminos: 'Terms and Conditions', privacidad: 'Privacy Policy', politicas: 'Usage Policies' },
};

/** Versión vigente de los textos (la API es la fuente: el alta se rechaza si no coincide). */
export function useVersionLegal() {
  return useQuery({ queryKey: ['version-legal'], queryFn: async () => (await fetch('/api/v1/public/legal')).json() as Promise<{ version: string }>, staleTime: 600_000, retry: 1 });
}

const negritas = (t: string): ReactNode[] => t.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith('**') ? <strong key={i}>{p.slice(2, -2)}</strong> : <Fragment key={i}>{p.replace(/`([^`]+)`/g, '$1')}</Fragment>));

/** Renderizador mínimo de Markdown (títulos, citas, listas, párrafos y negritas) para no sumar dependencias. */
export function Markdown({ md }: { md: string }) {
  const bloques: ReactNode[] = []; let lista: string[] = [];
  const cerrarLista = () => { if (lista.length) { bloques.push(<ul key={`u${bloques.length}`} className="list-disc pl-space-lg flex flex-col gap-space-xs">{lista.map((x, i) => <li key={i}>{negritas(x)}</li>)}</ul>); lista = []; } };
  for (const l of md.replace(/\r\n/g, '\n').split('\n')) {
    if (/^- /.test(l)) { lista.push(l.slice(2)); continue; }
    cerrarLista();
    if (!l.trim()) continue;
    if (l.startsWith('# ')) bloques.push(<h1 key={bloques.length} className="font-headline-lg text-headline-lg text-primary">{l.slice(2)}</h1>);
    else if (l.startsWith('## ')) bloques.push(<h2 key={bloques.length} className="font-headline-sm text-headline-sm text-primary mt-space-md">{l.slice(3)}</h2>);
    else if (l.startsWith('> ')) bloques.push(<p key={bloques.length} role="note" className="rounded-lg bg-secondary-fixed text-on-secondary-fixed p-space-sm font-body-sm">{negritas(l.slice(2))}</p>);
    else bloques.push(<p key={bloques.length}>{negritas(l)}</p>);
  }
  cerrarLista();
  return <div className="flex flex-col gap-space-sm font-body-md text-body-md text-on-surface">{bloques}</div>;
}

/** Páginas públicas /terminos, /privacidad y /politicas (borradores versionados, en español e inglés). */
export function PaginaLegal({ doc }: { doc: DocLegal }) {
  const [idioma, setIdioma] = useState<Idioma>(() => (typeof navigator !== 'undefined' && navigator.language?.startsWith('en') ? 'en' : 'es'));
  return (
    <main className="min-h-screen bg-background px-space-md py-space-lg flex justify-center">
      <article className="w-full max-w-3xl flex flex-col gap-space-md">
        <header className="flex flex-wrap items-center justify-between gap-space-sm"><Link to="/" aria-label="Ir al inicio"><Marca /></Link>
          <div role="group" aria-label="Idioma" className="flex gap-space-xs">{(['es', 'en'] as const).map((i) => <button key={i} type="button" aria-pressed={idioma === i} onClick={() => setIdioma(i)} className={`h-12 px-space-md rounded-lg font-semibold ${idioma === i ? 'bg-primary-container text-on-primary' : 'bg-surface-container text-on-surface-variant'}`}>{i === 'es' ? 'Español' : 'English'}</button>)}</div></header>
        <nav aria-label="Documentos" className="flex flex-wrap gap-space-md font-body-sm">{(['terminos', 'privacidad', 'politicas'] as const).map((d) => <Link key={d} to={`/legal/${d}`} aria-current={d === doc ? 'page' : undefined} className={d === doc ? 'font-semibold text-primary' : 'text-primary underline'}>{TITULOS[idioma][d]}</Link>)}</nav>
        <Markdown md={texto(idioma, doc)} />
      </article>
    </main>
  );
}
