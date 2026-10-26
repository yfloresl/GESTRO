import { useQuery } from '@tanstack/react-query';
import { FormEvent, ReactNode, useRef, useState } from 'react';
import { clases } from '../componentes/Marca';
import { api, mensajeDeError, useRolesActivos } from '../lib/sesion';

interface Respuesta { respuesta: string; fuentes: { herramienta: string; parametros: Record<string, unknown> }[]; modelo: string; tokens: number }
interface Turno { pregunta: string; respuesta?: Respuesta; error?: string }

const SUGERENCIAS = ['¿Cuánto vendí esta semana comparado con la anterior?', '¿Cuáles son mis platos más rentables?', '¿Qué insumos están por acabarse?', '¿Cuánto me deben mis clientes y cuánto debo a proveedores?', '¿Qué alertas tengo abiertas?'];

/** Texto con **negritas** sin usar HTML (nada de lo que escriba la IA se inyecta como marcado). */
const enLinea = (s: string): ReactNode[] => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith('**') && p.endsWith('**') ? <strong key={i}>{p.slice(2, -2)}</strong> : p));
const celdas = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

/** Mini renderizador de Markdown seguro: párrafos, listas, encabezados y tablas. */
function Markdown({ texto }: { texto: string }) {
  const lineas = texto.split('\n'); const salida: ReactNode[] = []; let i = 0;
  while (i < lineas.length) {
    const l = lineas[i];
    if (/^\s*\|.*\|\s*$/.test(l) && /^\s*\|?\s*:?-{2,}/.test(lineas[i + 1] ?? '')) {
      const cab = celdas(l); const filas: string[][] = []; i += 2;
      while (i < lineas.length && /^\s*\|.*\|\s*$/.test(lineas[i])) filas.push(celdas(lineas[i++]));
      salida.push(<div key={i} className="overflow-x-auto rounded-lg border border-outline-variant"><table className="w-full text-body-sm"><thead><tr className="text-left bg-surface-container">{cab.map((c, k) => <th key={k} className="p-2">{enLinea(c)}</th>)}</tr></thead><tbody>{filas.map((f, r) => <tr key={r} className="border-t border-outline-variant">{f.map((c, k) => <td key={k} className="p-2">{enLinea(c)}</td>)}</tr>)}</tbody></table></div>);
      continue;
    }
    if (/^\s*[-*]\s+/.test(l)) { const items: string[] = []; while (i < lineas.length && /^\s*[-*]\s+/.test(lineas[i])) items.push(lineas[i++].replace(/^\s*[-*]\s+/, '')); salida.push(<ul key={i} className="list-disc pl-space-md">{items.map((x, k) => <li key={k}>{enLinea(x)}</li>)}</ul>); continue; }
    if (/^#{1,4}\s+/.test(l)) { salida.push(<p key={i} className="font-semibold">{enLinea(l.replace(/^#{1,4}\s+/, ''))}</p>); i++; continue; }
    if (l.trim()) salida.push(<p key={i}>{enLinea(l)}</p>);
    i++;
  }
  return <div className="flex flex-col gap-space-xs">{salida}</div>;
}

const ETIQUETA_HERRAMIENTA: Record<string, string> = { resumen_periodo: 'Resumen del período', ventas_agrupadas: 'Ventas agrupadas', ingenieria_menu: 'Ingeniería de menú', estado_de_resultados: 'Estado de resultados', alertas_abiertas: 'Alertas abiertas', stock_bajo: 'Stock bajo', cuentas: 'Cuentas por cobrar y pagar', proyeccion: 'Proyección' };

/** Asistente de gestión (pantalla 5.13): preguntas en lenguaje natural; consulta solo lectura y muestra sus fuentes. */
export function Asistente() {
  const { sucursalId } = useRolesActivos();
  const [turnos, setTurnos] = useState<Turno[]>([]); const [pregunta, setPregunta] = useState(''); const [ocupado, setOcupado] = useState(false); const fin = useRef<HTMLDivElement>(null);
  const estado = useQuery({ queryKey: ['asistente-estado', sucursalId], queryFn: () => api.get<{ disponible: boolean; uso: { llamadas: number; errores: number } }>('/asistente/estado', sucursalId!), enabled: !!sucursalId });
  if (!sucursalId) return null;
  const preguntar = async (texto: string) => {
    const p = texto.trim(); if (p.length < 3 || ocupado) return;
    setOcupado(true); setPregunta(''); setTurnos((t) => [...t, { pregunta: p }]);
    try { const r = await api.post<Respuesta>('/asistente/preguntar', { pregunta: p }, sucursalId); setTurnos((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, respuesta: r } : x))); }
    catch (e) { setTurnos((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, error: mensajeDeError(e) } : x))); }
    finally { setOcupado(false); setTimeout(() => fin.current?.scrollIntoView({ behavior: 'smooth' }), 50); void estado.refetch(); }
  };
  const enviar = (e: FormEvent) => { e.preventDefault(); void preguntar(pregunta); };
  return (
    <div className="flex flex-col gap-space-lg">
      <header><h1 className="font-headline-lg text-headline-lg text-primary tracking-tight">Asistente</h1><p className="font-body-md text-body-md text-on-surface-variant">Pregunta en tus palabras. Solo consulta tus datos: no modifica nada. {estado.data ? `Consultas este mes: ${estado.data.uso.llamadas}.` : ''}</p></header>
      {estado.data && !estado.data.disponible && <p role="alert" className="rounded-xl bg-secondary-fixed text-on-secondary-fixed-variant p-space-md">El asistente todavía no está activado: falta la clave de IA. Pídele al equipo de Kyros-Tech que la cargue en la consola de plataforma. Mientras tanto, usa Estadísticas, Alertas y el Informe FODA.</p>}
      <div className="flex flex-col gap-space-md">
        {turnos.length === 0 && <div className="flex flex-wrap gap-space-xs">{SUGERENCIAS.map((s) => <button key={s} type="button" disabled={ocupado || estado.data?.disponible === false} onClick={() => preguntar(s)} className="min-h-12 px-space-md py-2 rounded-full bg-surface-container text-on-surface-variant text-left disabled:opacity-50">{s}</button>)}</div>}
        {turnos.map((t, i) => (
          <div key={i} className="flex flex-col gap-space-xs">
            <p className="self-end max-w-[85%] rounded-xl bg-primary-container text-on-primary p-space-sm">{t.pregunta}</p>
            <div className="max-w-full rounded-xl border border-outline-variant bg-surface-container-lowest p-space-md flex flex-col gap-space-xs" aria-live="polite">
              {t.error ? <p role="alert" className="text-error">{t.error}</p> : !t.respuesta ? <p role="status" className="text-on-surface-variant">Consultando tus datos…</p> : <>
                <Markdown texto={t.respuesta.respuesta} />
                {t.respuesta.fuentes.length > 0 && <details><summary className="cursor-pointer text-primary font-label-md min-h-12 flex items-center">Fuentes consultadas ({t.respuesta.fuentes.length})</summary>
                  <ul className="font-body-sm text-on-surface-variant">{t.respuesta.fuentes.map((f, k) => <li key={k}>{ETIQUETA_HERRAMIENTA[f.herramienta] ?? f.herramienta}{Object.keys(f.parametros).length ? ` — ${Object.entries(f.parametros).map(([a, b]) => `${a}: ${String(b)}`).join(', ')}` : ''}</li>)}</ul></details>}</>}
            </div>
          </div>))}
        <div ref={fin} />
      </div>
      <form onSubmit={enviar} className="flex gap-space-xs sticky bottom-0 bg-background py-space-sm"><input value={pregunta} onChange={(e) => setPregunta(e.target.value)} maxLength={500} placeholder="Escribe tu pregunta…" aria-label="Pregunta para el asistente" disabled={estado.data?.disponible === false} className={clases.input} /><button disabled={ocupado || pregunta.trim().length < 3 || estado.data?.disponible === false} className="h-[52px] px-space-md rounded-lg bg-primary text-on-primary font-semibold disabled:opacity-50">{ocupado ? '…' : 'Preguntar'}</button></form>
    </div>
  );
}
