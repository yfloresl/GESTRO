/**
 * ESTANDAR KYROS v1.1 — componentes comunes (web). Copia idéntica en los 7 sistemas junto a kyros-estandar.ts y kyros-prorrateo-plan.ts
 * (misma carpeta, p. ej. apps/web/src/lib/). Solo depende de React. Estilo mínimo en línea con variables CSS opcionales
 * (--kx-primario, --kx-texto, --kx-borde, --kx-fondo, --kx-error, --kx-aviso) para que se vean bien sin tocar el CSS del sistema.
 */
import type { CSSProperties, ReactNode } from 'react';
import { textos, GLOSARIO, SECCIONES_PLATAFORMA, esAdminPlataforma, desgloseIva, diasParaVencer, opcionesRubro, textoFuncionalidadesSinPrecio, NO_CONFIRMADO, RUBRO_NOTA_SIN, type Idioma, type RubroActividad, type FuncionalidadSinPrecio } from './kyros-estandar';
import type { ResultadoProrrateo } from './kyros-prorrateo-plan';

const caja = (color: string): CSSProperties => ({ border: `1px solid var(--kx-borde, #cbd5e1)`, borderLeft: `4px solid ${color}`, borderRadius: 8, padding: '12px 14px', background: 'var(--kx-fondo, transparent)', color: 'var(--kx-texto, inherit)', fontSize: 14, lineHeight: 1.45 });
const boton: CSSProperties = { cursor: 'pointer', borderRadius: 8, border: '1px solid var(--kx-primario, #1d4ed8)', background: 'var(--kx-primario, #1d4ed8)', color: '#fff', padding: '10px 16px', fontSize: 14, fontWeight: 600 };
const botonSec: CSSProperties = { ...boton, background: 'transparent', color: 'var(--kx-primario, #1d4ed8)' };

/** S-02: UN solo botón de ingreso. Debe llevar directo a Kyros ID (la landing no tiene un «Ingresar» intermedio). */
export function BotonEntrarKyrosId({ onClick, deshabilitado, texto, idioma }: { onClick: () => void; deshabilitado?: boolean; texto?: string; idioma?: Idioma }) {
  const TXT = textos(idioma);
  texto = texto ?? TXT.entrarKyrosId;
  return <button type="button" onClick={onClick} disabled={deshabilitado} style={boton} data-kx="entrar-kyros-id">{texto}</button>;
}

/** S-03: mismo mensaje y mismo botón en todos los sistemas cuando una acción sensible pide reconfirmar. */
export function AvisoReconfirmar({ onConfirmar, ocupado, idioma }: { onConfirmar: () => void; ocupado?: boolean; idioma?: Idioma }) {
  const TXT = textos(idioma);
  return (
    <div role="alert" style={caja('var(--kx-aviso, #d97706)')} data-kx="reconfirmar">
      <strong>{TXT.reconfirmarTitulo}</strong>
      <p style={{ margin: '6px 0 10px' }}>{TXT.reconfirmarMensaje}</p>
      <button type="button" onClick={onConfirmar} disabled={ocupado} style={boton}>{TXT.confirmarIdentidad}</button>
    </div>
  );
}

/** S-10: pantalla única de falta de permiso (también para el «No se pudo cargar el equipo» que era AX-094). */
export function SinPermiso({ aQuien, titulo, onVolver, idioma, textoVolver }: { aQuien?: string; titulo?: string; onVolver?: () => void; idioma?: Idioma; textoVolver?: string }) {
  const TXT = textos(idioma);
  aQuien = aQuien ?? TXT.sinPermisoAQuien; titulo = titulo ?? TXT.sinPermisoTitulo;
  return (
    <div role="alert" style={{ ...caja('var(--kx-error, #dc2626)'), maxWidth: 520, margin: '32px auto' }} data-kx="sin-permiso">
      <h2 style={{ margin: 0, fontSize: 18 }}>{titulo}</h2>
      <p style={{ margin: '8px 0 0' }}>{aQuien}</p>
      {onVolver && <button type="button" onClick={onVolver} style={{ ...botonSec, marginTop: 12 }}>{textoVolver ?? (idioma === 'en' ? 'Back to start' : idioma === 'pt' ? 'Voltar ao início' : 'Volver al inicio')}</button>}
    </div>
  );
}

/** S-07: casilla de aceptación legal con mensaje claro si se intenta continuar sin marcarla. `intento` = el usuario ya pulsó continuar. */
export function AceptacionLegal({ marcada, onCambio, intento, id = 'kx-acepto', children, error, idioma }: { marcada: boolean; onCambio: (v: boolean) => void; intento: boolean; id?: string; children: ReactNode; error?: string | null; idioma?: Idioma }) {
  const TXT = textos(idioma);
  const falta = intento && !marcada;
  return (
    <div data-kx="aceptacion-legal">
      <label htmlFor={id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 14, cursor: 'pointer' }}>
        <input id={id} type="checkbox" checked={marcada} onChange={(e) => onCambio(e.target.checked)} aria-invalid={falta} aria-describedby={falta ? `${id}-err` : undefined} style={{ marginTop: 3 }} />
        <span>{TXT.aceptoLegal} {children}</span>
      </label>
      {(falta || error) && <p id={`${id}-err`} role="alert" style={{ margin: '6px 0 0', color: 'var(--kx-error, #dc2626)', fontSize: 13 }}>{error ?? TXT.marcaCasilla}</p>}
    </div>
  );
}

/** S-11: aviso permanente de qué es demostración (va en la sección «Demostración» de Plataforma y en los datos demo). */
export function AvisoDemostracion({ children, idioma }: { children?: ReactNode; idioma?: Idioma }) {
  const TXT = textos(idioma);
  return <div role="note" style={caja('var(--kx-aviso, #d97706)')} data-kx="demostracion"><strong>{GLOSARIO.demo}.</strong> {children ?? TXT.demostracionAviso}</div>;
}

/** S-08: enlace de invitación con vigencia visible y reenvío con un clic. */
export function InvitacionEnlace({ enlace, venceEn, onReenviar, onCopiar, ocupado, idioma }: { enlace: string; venceEn: string | Date | null; onReenviar?: () => void; onCopiar?: () => void; ocupado?: boolean; idioma?: Idioma }) {
  const TXT = textos(idioma);
  const dias = diasParaVencer(venceEn);
  return (
    <div style={caja(dias > 0 ? 'var(--kx-primario, #1d4ed8)' : 'var(--kx-error, #dc2626)')} data-kx="invitacion">
      <div style={{ wordBreak: 'break-all', fontSize: 13 }}>{enlace}</div>
      <p style={{ margin: '6px 0 10px' }} data-kx="vigencia">{TXT.invitacionVigencia(dias)}</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {onCopiar && <button type="button" onClick={onCopiar} style={botonSec}>{TXT.copiarEnlace}</button>}
        {onReenviar && <button type="button" onClick={onReenviar} disabled={ocupado} style={boton}>{TXT.reenviar}</button>}
      </div>
    </div>
  );
}

export interface EtiquetasVistaPrevia { yaEstas: (plan: string) => string; vencido: (fecha: string) => string; cambiaDesde: string; diasQueQuedan: string; credito: string; costoNuevo: string; saldoAplicado: string; aPagar: string; saldoAFavorDiferencia: string; diasExtra: string; venceEl: string; saldoQueda: string; neto: string; iva: string; total: string; ivaIncluido: string; nota: string }
export const ETIQUETAS_VISTA_PREVIA: Record<Idioma, EtiquetasVistaPrevia> = {
  es: { yaEstas: (p) => `Ya estás en el plan ${p}.`, vencido: (f) => `Tu plan está vencido: el plan nuevo rige desde hoy (${f}) y se renueva con su precio.`, cambiaDesde: 'Cambia desde', diasQueQuedan: 'Días que te quedan', credito: 'Crédito de tu plan actual', costoNuevo: 'Costo del plan nuevo por esos días', saldoAplicado: 'Saldo a favor aplicado', aPagar: 'A pagar ahora', saldoAFavorDiferencia: 'Diferencia a tu favor', diasExtra: 'Días extra que se suman', venceEl: 'vence el', saldoQueda: 'Saldo a favor que te queda', neto: 'Neto', iva: 'IVA 13 %', total: 'Total', ivaIncluido: 'IVA 13 % incluido', nota: 'No pierdes días: lo que ya pagaste se convierte en crédito o en días extra. Los precios incluyen IVA.' },
  en: { yaEstas: (p) => `You are already on the ${p} plan.`, vencido: (f) => `Your plan has expired: the new plan starts today (${f}) and renews at its price.`, cambiaDesde: 'Effective from', diasQueQuedan: 'Days left', credito: 'Credit from your current plan', costoNuevo: 'Cost of the new plan for those days', saldoAplicado: 'Credit balance applied', aPagar: 'To pay now', saldoAFavorDiferencia: 'Difference in your favor', diasExtra: 'Extra days added', venceEl: 'expires on', saldoQueda: 'Credit balance left', neto: 'Net', iva: 'VAT 13%', total: 'Total', ivaIncluido: 'VAT 13% included', nota: 'You do not lose days: what you already paid becomes credit or extra days. Prices include VAT.' },
  pt: { yaEstas: (p) => `Você já está no plano ${p}.`, vencido: (f) => `Seu plano está vencido: o novo plano vale desde hoje (${f}) e renova pelo seu preço.`, cambiaDesde: 'Muda a partir de', diasQueQuedan: 'Dias restantes', credito: 'Crédito do seu plano atual', costoNuevo: 'Custo do novo plano por esses dias', saldoAplicado: 'Saldo a favor aplicado', aPagar: 'A pagar agora', saldoAFavorDiferencia: 'Diferença a seu favor', diasExtra: 'Dias extras somados', venceEl: 'vence em', saldoQueda: 'Saldo a favor restante', neto: 'Líquido', iva: 'IVA 13%', total: 'Total', ivaIncluido: 'IVA 13% incluído', nota: 'Você não perde dias: o que já pagou vira crédito ou dias extras. Os preços incluem imposto.' },
};
/** S-06: vista previa de cambio de plan (modelo AXION). `fmt` formatea centavos. Cada importe se muestra con «Neto / IVA 13 % / Total» (neto + IVA = total exacto). */
export function VistaPreviaCambioPlan({ r, planActual, planNuevo, fmt, idioma, etiquetas }: { r: ResultadoProrrateo; planActual: string; planNuevo: string; fmt: (centavos: number) => string; idioma?: Idioma; etiquetas?: Partial<EtiquetasVistaPrevia> }) {
  const L: EtiquetasVistaPrevia = { ...ETIQUETAS_VISTA_PREVIA[idioma ?? 'es'], ...etiquetas };
  if (!r.valido) return <div role="note" style={caja('var(--kx-aviso, #d97706)')}>{L.yaEstas(planActual)}</div>;
  const fila = (clave: string, etiqueta: string, c: number, destacar?: boolean) => {
    const d = desgloseIva(c);
    return (
      <div key={clave} data-kx={'importe-' + clave} style={{ display: 'contents' }}>
        <dt>{etiqueta}</dt>
        <dd style={{ margin: 0 }}>{destacar ? <strong>{fmt(d.totalCentavos)}</strong> : fmt(d.totalCentavos)}
          <small style={{ display: 'block', opacity: 0.8 }}>{L.neto} {fmt(d.netoCentavos)} · {L.iva} {fmt(d.ivaCentavos)} · {L.total} {fmt(d.totalCentavos)}</small>
          <small style={{ display: 'block', opacity: 0.8 }}>{L.ivaIncluido}: {fmt(d.ivaCentavos)}</small></dd>
      </div>
    );
  };
  return (
    <div style={caja('var(--kx-primario, #1d4ed8)')} data-kx="vista-previa-plan">
      <strong>{planActual} → {planNuevo}</strong>
      {r.vencida ? <p style={{ margin: '6px 0 0' }}>{L.vencido(r.fechaEfectiva)}</p> : (
        <dl style={{ margin: '8px 0 0', display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px' }}>
          <dt>{L.cambiaDesde}</dt><dd style={{ margin: 0 }}>{r.fechaEfectiva}</dd>
          <dt>{L.diasQueQuedan}</dt><dd style={{ margin: 0 }}>{r.diasRestantes}</dd>
          {fila('credito', L.credito, r.creditoCentavos)}
          {fila('costo-nuevo', L.costoNuevo, r.costoNuevoCentavos)}
          {r.diferenciaCentavos < 0 && fila('diferencia-a-favor', L.saldoAFavorDiferencia, -r.diferenciaCentavos)}
          {r.saldoAplicadoCentavos > 0 && fila('saldo-aplicado', L.saldoAplicado, r.saldoAplicadoCentavos)}
          {fila('cobro', L.aPagar, r.cobroCentavos, true)}
          {r.diasExtra > 0 && (<><dt>{L.diasExtra}</dt><dd style={{ margin: 0 }}>+{r.diasExtra} ({L.venceEl} {r.vigenciaNueva})</dd></>)}
          {r.saldoFinalCentavos > 0 && fila('saldo-final', L.saldoQueda, r.saldoFinalCentavos)}
        </dl>
      )}
      <p style={{ margin: '8px 0 0', fontSize: 12, opacity: 0.8 }}>{L.nota}</p>
    </div>
  );
}

/** S-06b: lista simple SOLO para SuperAdmin. Nunca renderizar en pantallas de cliente. */
export function FuncionalidadesSinPrecio({ items }: { items: FuncionalidadSinPrecio[] }) {
  return <div role="note" style={caja(items.length ? 'var(--kx-aviso, #d97706)' : 'var(--kx-primario, #1d4ed8)')} data-kx="sin-precio">{textoFuncionalidadesSinPrecio(items)}</div>;
}

/** S-13: selector simple de rubro (lista del catálogo del SIN vía FacturaSIN); los códigos solo bajo «Avanzado». */
export function SelectorRubro({ actividades, valor, onCambio, catalogoDisponible = true }: { actividades: RubroActividad[] | null | undefined; valor: string; onCambio: (valor: string) => void; catalogoDisponible?: boolean }) {
  const ops = opcionesRubro(actividades);
  const sel = ops.find((o) => o.valor === valor);
  return (
    <div data-kx="selector-rubro">
      <label style={{ display: 'block', fontSize: 14, fontWeight: 600 }}>Rubro de tu negocio
        <select value={valor} onChange={(e) => onCambio(e.target.value)} style={{ display: 'block', width: '100%', marginTop: 4, padding: 8 }}>
          <option value="">Elegir rubro…</option>
          {ops.map((o) => <option key={o.valor} value={o.valor}>{o.etiqueta}</option>)}
        </select>
      </label>
      {!catalogoDisponible && <p role="status" style={{ fontSize: 13 }}>{NO_CONFIRMADO}: el catálogo del SIN no respondió; no se inventan códigos.</p>}
      <details style={{ marginTop: 6, fontSize: 13 }}>
        <summary>{GLOSARIO.avanzado}</summary>
        <p style={{ margin: '6px 0' }}>Actividad: {sel?.actividadEconomica ?? '—'} · Producto SIN: {sel?.codigoProductoSin ?? '—'} · Unidad de medida: {sel ? sel.unidadMedida : '—'}</p>
        <p style={{ margin: 0, opacity: 0.8 }}>{RUBRO_NOTA_SIN}</p>
      </details>
    </div>
  );
}

export interface AvisoItem { id: string; titulo: string; detalle?: string; fecha?: string; leido?: boolean; href?: string }
/** S-12: la misma pantalla/lista de avisos en todos (ruta canónica /avisos; /notificaciones redirige). */
export function ListaAvisos({ items, onAbrir, onMarcarLeidos, idioma }: { items: AvisoItem[]; onAbrir?: (a: AvisoItem) => void; onMarcarLeidos?: () => void; idioma?: Idioma }) {
  const TXT = textos(idioma);
  const sinLeer = items.filter((i) => !i.leido).length;
  return (
    <section aria-label={TXT.campana} data-kx="avisos">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>{TXT.campana}{sinLeer > 0 ? ` (${sinLeer})` : ''}</h2>
        {onMarcarLeidos && sinLeer > 0 && <button type="button" onClick={onMarcarLeidos} style={botonSec}>{TXT.marcarLeidos}</button>}
      </header>
      {items.length === 0 ? <p>{TXT.sinNotificaciones}</p> : (
        <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0 0', display: 'grid', gap: 8 }}>
          {items.map((a) => (
            <li key={a.id} style={{ ...caja(a.leido ? 'var(--kx-borde, #cbd5e1)' : 'var(--kx-primario, #1d4ed8)'), cursor: onAbrir ? 'pointer' : 'default' }} onClick={() => onAbrir?.(a)}>
              <strong>{a.titulo}</strong>{a.detalle && <div>{a.detalle}</div>}{a.fecha && <small>{a.fecha}</small>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** S-04: menú de secciones de «Plataforma», igual en todos. Filtra por rol: sin rol de plataforma no se muestra nada; `puede(clave)` afina por sección (permisos del sistema). `disponibles` oculta las que el sistema no tenga. */
export function MenuPlataforma({ actual, disponibles, roles, puede, renderEnlace }: { actual?: string; disponibles?: readonly string[]; roles?: readonly string[] | null; puede?: (clave: string) => boolean; renderEnlace: (s: { clave: string; etiqueta: string; ruta: string; activo: boolean }) => ReactNode }) {
  if (roles !== undefined && !esAdminPlataforma(roles)) return null;
  const visibles = SECCIONES_PLATAFORMA.filter((s) => (!disponibles || disponibles.includes(s.clave)) && (!puede || puede(s.clave)));
  return <nav aria-label="Plataforma" data-kx="menu-plataforma" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>{visibles.map((s) => <span key={s.clave}>{renderEnlace({ ...s, activo: actual === s.clave })}</span>)}</nav>;
}
