import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { api, useSesion } from '../lib/sesion';
import { bs, type Pedido } from '../lib/tipos';
import { Esqueleto } from './Esqueleto';
import { Dato, Ficha } from './Ficha';

const hoyIso = () => new Date(Date.now() - 4 * 3_600_000).toISOString().slice(0, 10);
const restar = (f: string, d: number) => new Date(Date.parse(`${f}T12:00:00Z`) - d * 86_400_000).toISOString().slice(0, 10);

interface Res { ingresos: string; pedidos: number; ticketPromedio: string; costoAlimentosPct: string | null; utilidadBruta: string }
interface ResumenDia { actual: Res; anterior: Res; variacion: { ingresosPct: string | null } }
interface PlatoMenu { nombre: string; unidades: string; ventas: string }
interface FilaVenta { clave: string; etiqueta: string; ventas: string }
interface Alerta { id: string; tipo: string; severidad: 'info' | 'media' | 'alta'; mensaje: string; resuelta?: string | null }
interface Detalle { titulo: string; sub?: string; cuerpo: ReactNode }

function Kpi({ icono, etiqueta, valor, sub, onClick }: { icono: string; etiqueta: string; valor: string; sub?: string; onClick(): void }) {
  return (
    <button type="button" onClick={onClick} className="text-left bg-surface-container-lowest border border-outline-variant rounded-xl shadow-[0_1px_8px_rgba(0,0,0,0.04)] p-space-md flex flex-col gap-space-xs hover:shadow-md hover:border-primary transition">
      <span className="flex items-center justify-between"><span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider">{etiqueta}</span><span className="material-symbols-outlined text-primary text-[20px]" aria-hidden="true">{icono}</span></span>
      <span className="font-headline-md text-headline-md font-semibold text-primary truncate">{valor}</span>
      {sub && <span className="font-body-sm text-body-sm text-on-surface-variant">{sub}</span>}
    </button>
  );
}

/** Indicadores del dueño (pantalla 5.1): ventas del día, ticket, plato estrella, margen, ocupación, ventas por hora y alertas. Cada recuadro abre su detalle en un panel. */
export function Indicadores() {
  const { sucursalId } = useSesion();
  const [detalle, setDetalle] = useState<Detalle | null>(null);
  const hoy = hoyIso(); const semana = restar(hoy, 6);
  const on = !!sucursalId;
  const dia = useQuery({ queryKey: ['panel-dia', sucursalId, hoy], queryFn: () => api.get<ResumenDia>(`/estadisticas/resumen?desde=${hoy}&hasta=${hoy}`, sucursalId!), enabled: on, refetchInterval: 60_000 });
  const menu = useQuery({ queryKey: ['panel-menu', sucursalId, hoy], queryFn: () => api.get<{ platos: PlatoMenu[] }>(`/estadisticas/menu?desde=${semana}&hasta=${hoy}`, sucursalId!), enabled: on, staleTime: 300_000 });
  const horas = useQuery({ queryKey: ['panel-horas', sucursalId, hoy], queryFn: () => api.get<{ filas: FilaVenta[] }>(`/estadisticas/ventas?grupo=hora&desde=${semana}&hasta=${hoy}`, sucursalId!), enabled: on, staleTime: 300_000 });
  const alertas = useQuery({ queryKey: ['panel-alertas', sucursalId], queryFn: () => api.get<Alerta[]>('/alertas', sucursalId!), enabled: on, refetchInterval: 60_000 });
  const mesas = useQuery({ queryKey: ['mesas', sucursalId], queryFn: () => api.get<{ id: string; activa: boolean }[]>('/mesas', sucursalId!), enabled: on, staleTime: 300_000 });
  const abiertos = useQuery({ queryKey: ['pedidos', sucursalId, 'abiertos'], queryFn: () => api.get<Pedido[]>('/pedidos?filtro=abiertos', sucursalId!), enabled: on, refetchInterval: 30_000 });

  if (dia.isLoading) return <div className="grid grid-cols-1 gap-gutter sm:grid-cols-2 xl:grid-cols-5">{Array.from({ length: 5 }, (_, i) => <Esqueleto key={i} className="h-32" />)}</div>;
  const hoyVacio = (dia.data?.actual.pedidos ?? 0) === 0 && (dia.data?.anterior.pedidos ?? 0) > 0;   // si hoy aún no se vendió, se muestra el último día con ventas (ayer)
  const a = hoyVacio ? dia.data?.anterior : dia.data?.actual; const ingresos = Number(a?.ingresos ?? 0); const cuando = hoyVacio ? 'ayer' : 'hoy';
  const ranking = [...(menu.data?.platos ?? [])].sort((x, y) => Number(y.unidades) - Number(x.unidades));
  const estrella = ranking[0];
  const margen = a && ingresos > 0 ? (Number(a.utilidadBruta) / ingresos) * 100 : null;
  const activas = (mesas.data ?? []).filter((m) => m.activa).length;
  const enCurso = abiertos.data ?? []; const ocupadas = new Set(enCurso.filter((p) => p.mesaId).map((p) => p.mesaId)).size;
  const filasHora = (horas.data?.filas ?? []).map((f) => ({ h: f.etiqueta, v: Number(f.ventas) })); const maxH = Math.max(1, ...filasHora.map((f) => f.v));
  const abiertas = (alertas.data ?? []).filter((x) => !x.resuelta).slice(0, 3);
  const variacion = hoyVacio ? null : dia.data?.variacion.ingresosPct;

  return (
    <>
      <div className="grid grid-cols-1 gap-gutter sm:grid-cols-2 xl:grid-cols-5">
        <Kpi icono="payments" etiqueta={hoyVacio ? 'Ventas de ayer' : 'Ventas del día'} valor={bs(ingresos)} sub={variacion == null ? (hoyVacio ? 'Hoy aún no hay ventas' : 'Sin día anterior para comparar') : `${Number(variacion) >= 0 ? '▲' : '▼'} ${Math.abs(Number(variacion))}% vs. ayer`}
          onClick={() => setDetalle({ titulo: 'Ventas del día', sub: hoy, cuerpo: <div><Dato etiqueta={`Ingresos de ${cuando}`} valor={bs(ingresos)} />{!hoyVacio && <Dato etiqueta="Ingresos de ayer" valor={bs(dia.data?.anterior.ingresos ?? 0)} />}<Dato etiqueta="Pedidos cobrados" valor={a?.pedidos ?? 0} /></div> })} />
        <Kpi icono="receipt_long" etiqueta="Ticket promedio" valor={bs(a?.ticketPromedio ?? 0)} sub={`${a?.pedidos ?? 0} pedidos cobrados`}
          onClick={() => setDetalle({ titulo: 'Ticket promedio', sub: hoy, cuerpo: <div><Dato etiqueta={cuando === 'hoy' ? 'Hoy' : 'Ayer'} valor={bs(a?.ticketPromedio ?? 0)} />{!hoyVacio && <Dato etiqueta="Ayer" valor={bs(dia.data?.anterior.ticketPromedio ?? 0)} />}</div> })} />
        <Kpi icono="star" etiqueta="Plato estrella" valor={estrella?.nombre ?? '—'} sub={estrella ? `${Number(estrella.unidades)} unidades · 7 días` : 'Sin ventas en 7 días'}
          onClick={() => setDetalle({ titulo: 'Más vendidos', sub: 'Últimos 7 días', cuerpo: <div>{ranking.slice(0, 8).map((p) => <Dato key={p.nombre} etiqueta={p.nombre} valor={`${Number(p.unidades)} u · ${bs(p.ventas)}`} />)}</div> })} />
        <Kpi icono="percent" etiqueta="Margen estimado" valor={margen === null ? '—' : `${margen.toFixed(1)}%`} sub={a?.costoAlimentosPct ? `Costo de alimentos ${a.costoAlimentosPct}%` : undefined}
          onClick={() => setDetalle({ titulo: 'Margen estimado', sub: hoy, cuerpo: <div><Dato etiqueta="Utilidad bruta" valor={bs(a?.utilidadBruta ?? 0)} /><Dato etiqueta="Costo de alimentos" valor={a?.costoAlimentosPct ? `${a.costoAlimentosPct}%` : '—'} /></div> })} />
        <Kpi icono="table_restaurant" etiqueta="Ocupación del salón" valor={activas ? `${Math.round((ocupadas / activas) * 100)}%` : '—'} sub={`${ocupadas} de ${activas} mesas`}
          onClick={() => setDetalle({ titulo: 'Ocupación del salón', cuerpo: <div>{enCurso.map((p) => <Dato key={p.id} etiqueta={p.mesa ? `Mesa ${p.mesa}` : p.tipo} valor={`${p.estado} · ${bs(p.total)}`} />)}{!enCurso.length && <p className="text-on-surface-variant">No hay pedidos en curso.</p>}</div> })} />
      </div>

      <div className="grid grid-cols-1 gap-gutter xl:grid-cols-3">
        <section aria-labelledby="horas" className="xl:col-span-2 bg-surface-container-lowest border border-outline-variant rounded-xl p-space-md flex flex-col gap-space-sm">
          <h2 id="horas" className="font-headline-sm text-headline-sm">Ventas por hora <span className="font-body-sm text-on-surface-variant">· últimos 7 días</span></h2>
          {horas.isLoading ? <Esqueleto className="h-40" /> : !filasHora.length ? <p className="text-on-surface-variant">Todavía no hay ventas para mostrar.</p> : (
            <div className="flex items-end gap-1 h-40" role="group" aria-label="Ventas por hora">
              {filasHora.map((f) => (
                <button key={f.h} type="button" title={`${f.h}: ${bs(f.v)}`} onClick={() => setDetalle({ titulo: `Ventas a las ${f.h}`, sub: 'Suma de los últimos 7 días', cuerpo: <Dato etiqueta="Ventas" valor={bs(f.v)} /> })} className="flex-1 flex flex-col items-center justify-end gap-1 h-full group">
                  <span className="w-full rounded-t bg-primary group-hover:bg-primary-container transition-colors" style={{ height: `${Math.max(4, (f.v / maxH) * 100)}%` }} />
                  <span className="font-label-sm text-[10px] text-on-surface-variant">{f.h.slice(0, 2)}</span>
                </button>))}
            </div>)}
        </section>
        <section aria-labelledby="alertas-v" className="bg-surface-container-lowest border border-outline-variant rounded-xl p-space-md flex flex-col gap-space-sm">
          <h2 id="alertas-v" className="font-headline-sm text-headline-sm flex items-center gap-space-xs"><span className="material-symbols-outlined text-error" aria-hidden="true">notifications_active</span>Alertas operativas</h2>
          {alertas.isLoading ? <Esqueleto className="h-24" /> : !abiertas.length ? <p className="text-on-surface-variant">Todo en orden: no hay alertas abiertas.</p> : (
            <ul className="flex flex-col gap-space-xs">{abiertas.map((x) => (
              <li key={x.id}><button type="button" onClick={() => setDetalle({ titulo: x.tipo.replace(/_/g, ' '), sub: `Severidad ${x.severidad}`, cuerpo: <p>{x.mensaje}</p> })}
                className={`w-full text-left rounded-lg p-space-sm border-l-4 hover:shadow-sm transition-shadow ${x.severidad === 'alta' ? 'bg-error-container/50 border-error' : x.severidad === 'media' ? 'bg-secondary-fixed/60 border-secondary' : 'bg-surface-container border-outline'}`}>{x.mensaje}</button></li>))}</ul>)}
        </section>
      </div>
      {detalle && <Ficha titulo={detalle.titulo} subtitulo={detalle.sub} cerrar={() => setDetalle(null)}>{detalle.cuerpo}</Ficha>}
    </>
  );
}
