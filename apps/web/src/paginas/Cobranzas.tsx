import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { Dato, Ficha, Telefono } from '../componentes/Ficha';
import { clases } from '../componentes/Marca';
import { api, mensajeDeError, useRolesActivos } from '../lib/sesion';
import { bs } from '../lib/tipos';

interface Cuenta { id: string; cliente: string; telefono: string | null; monto: string; pagado: string; saldo: string; vence: string; dias: number; vencida: boolean }

/** Cuentas por cobrar: ventas a crédito pendientes, con cobro total o parcial por caja o banco. */
export function Cobranzas() {
  const { sucursalId } = useRolesActivos();
  const qc = useQueryClient();
  const [todas, setTodas] = useState(false); const [cobrando, setCobrando] = useState<Cuenta | null>(null); const [ficha, setFicha] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['por-cobrar', sucursalId, todas], queryFn: () => api.get<Cuenta[]>(`/por-cobrar${todas ? '?todas=1' : ''}`, sucursalId!), enabled: !!sucursalId });
  if (!sucursalId) return null;
  const lista = q.data ?? [];
  const total = lista.reduce((t, c) => t + Number(c.saldo), 0); const vencido = lista.filter((c) => c.vencida).reduce((t, c) => t + Number(c.saldo), 0);
  return (
    <div className="flex flex-col gap-space-lg">
      <header><h1 className="font-headline-lg text-headline-lg text-primary tracking-tight">Cuentas por cobrar</h1><p className="font-body-md text-body-md text-on-surface-variant">Ventas a crédito pendientes de cobro. Cada cobro genera su asiento contable.</p></header>
      <div className="grid grid-cols-2 gap-gutter md:grid-cols-3">
        <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-space-md"><p className="font-label-sm uppercase text-on-surface-variant">Por cobrar</p><p className="font-headline-sm text-headline-sm text-primary">{bs(total)}</p></div>
        <div className={`rounded-xl border p-space-md ${vencido > 0 ? 'bg-error-container text-on-error-container border-error-container' : 'bg-surface-container-lowest border-outline-variant'}`}><p className="font-label-sm uppercase">Vencido</p><p className="font-headline-sm text-headline-sm">{bs(vencido)}</p></div>
      </div>
      <label className="flex items-center gap-space-sm min-h-12"><input type="checkbox" className="w-6 h-6" checked={todas} onChange={(e) => setTodas(e.target.checked)} /><span>Incluir cuentas ya cobradas</span></label>
      {q.isLoading ? <p role="status">Cargando…</p> : lista.length === 0 ? <p className="rounded-xl border border-outline-variant bg-surface-container-lowest p-space-md text-on-surface-variant">No hay cuentas por cobrar. Nacen al cobrar un pedido con el método «Crédito».</p> : (
        <ul className="grid grid-cols-1 gap-gutter md:grid-cols-2">{lista.map((c) => {
          const cobrada = !(Number(c.saldo) > 0);
          return (
            <li key={c.id} className={`border rounded-xl p-space-md flex items-center justify-between gap-space-sm ${c.vencida ? 'bg-error-container/30 border-error-container' : 'bg-surface-container-lowest border-outline-variant'} ${cobrada ? 'opacity-60' : ''}`}>
              <div className="min-w-0"><button type="button" onClick={() => setFicha(c.cliente)} aria-label={`Ver ficha de ${c.cliente}`} className="font-semibold truncate text-left text-primary underline-offset-2 hover:underline max-w-full">{c.cliente}</button>
                <p className="font-body-sm text-on-surface-variant">{c.telefono ? `${c.telefono} · ` : ''}{cobrada ? 'Cobrada' : c.vencida ? `Venció hace ${-c.dias} día(s)` : c.dias === 0 ? 'Vence hoy' : `Vence en ${c.dias} día(s)`} ({c.vence})</p>
                <p className="font-label-lg text-primary">{cobrada ? bs(c.monto) : `Saldo ${bs(c.saldo)}`}{!cobrada && Number(c.pagado) > 0 ? <span className="font-body-sm text-on-surface-variant"> de {bs(c.monto)}</span> : null}</p></div>
              {!cobrada && <button type="button" onClick={() => setCobrando(c)} className="h-12 px-space-md rounded-lg bg-primary text-on-primary font-semibold whitespace-nowrap">Cobrar</button>}
            </li>);
        })}</ul>)}
      {ficha && <FichaCliente cliente={ficha} cuentas={lista.filter((c) => c.cliente === ficha)} cobrar={(c) => { setFicha(null); setCobrando(c); }} cerrar={() => setFicha(null)} />}
      {cobrando && <Cobro cuenta={cobrando} cerrar={() => setCobrando(null)} hecho={() => { setCobrando(null); void qc.invalidateQueries({ queryKey: ['por-cobrar'] }); void qc.invalidateQueries({ queryKey: ['conta'] }); }} />}
    </div>
  );
}

function Cobro({ cuenta, cerrar, hecho }: { cuenta: Cuenta; cerrar(): void; hecho(): void }) {
  const { sucursalId } = useRolesActivos();
  const [error, setError] = useState<string | null>(null); const [ocupado, setOcupado] = useState(false);
  const enviar = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setError(null); setOcupado(true); const f = new FormData(e.currentTarget);
    try { await api.post(`/por-cobrar/${cuenta.id}/cobrar`, { monto: Number(String(f.get('monto')).replace(',', '.')), via: String(f.get('via')) }, sucursalId!); hecho(); } catch (err) { setError(mensajeDeError(err)); setOcupado(false); }
  };
  return (
    <div role="dialog" aria-modal="true" aria-label="Cobrar cuenta" className="fixed inset-0 z-[60] flex justify-end bg-inverse-surface/40" onClick={cerrar}>
      <form onSubmit={enviar} onClick={(e) => e.stopPropagation()} className="w-full max-w-md bg-surface h-full overflow-y-auto p-space-md flex flex-col gap-space-md">
        <div className="flex items-center justify-between"><h2 className="font-headline-md text-headline-md text-primary">Cobrar a {cuenta.cliente}</h2><button type="button" aria-label="Cerrar" onClick={cerrar} className="w-12 h-12 rounded-lg hover:bg-surface-container"><span className="material-symbols-outlined" aria-hidden="true">close</span></button></div>
        <p className="text-on-surface-variant">Saldo pendiente: <strong>{bs(cuenta.saldo)}</strong>. Puedes cobrar todo o una parte.</p>
        <label className="flex flex-col gap-space-xs"><span className={clases.etiqueta}>Monto a cobrar (Bs)</span><input name="monto" required inputMode="decimal" defaultValue={Number(cuenta.saldo).toFixed(2)} className={clases.input} /></label>
        <fieldset className="flex flex-col gap-space-xs"><legend className={clases.etiqueta}>¿Cómo pagó?</legend>
          <label className="flex items-center gap-space-sm min-h-12"><input type="radio" name="via" value="caja" defaultChecked className="w-6 h-6" /><span>Efectivo (entra a caja)</span></label>
          <label className="flex items-center gap-space-sm min-h-12"><input type="radio" name="via" value="bancos" className="w-6 h-6" /><span>Banco, QR o transferencia</span></label></fieldset>
        {error && <p role="alert" className="text-error">{error}</p>}
        <button disabled={ocupado} className={clases.primario}>{ocupado ? 'Registrando…' : 'Registrar cobro'}</button>
      </form>
    </div>
  );
}

function FichaCliente({ cliente, cuentas, cobrar, cerrar }: { cliente: string; cuentas: Cuenta[]; cobrar(c: Cuenta): void; cerrar(): void }) {
  const saldo = cuentas.reduce((t, c) => t + Number(c.saldo), 0); const vencido = cuentas.filter((c) => c.vencida).reduce((t, c) => t + Number(c.saldo), 0);
  const total = cuentas.reduce((t, c) => t + Number(c.monto), 0);
  return (
    <Ficha titulo={cliente} subtitulo="Cliente con crédito" cerrar={cerrar}>
      <div>
        <Dato etiqueta="Teléfono" valor={<Telefono valor={cuentas[0]?.telefono ?? null} />} />
        <Dato etiqueta="Ventas a crédito" valor={`${cuentas.length} · ${bs(total)}`} />
        <Dato etiqueta="Saldo por cobrar" valor={<strong>{bs(saldo)}</strong>} />
        <Dato etiqueta="Vencido" valor={vencido > 0 ? <span className="text-error font-semibold">{bs(vencido)}</span> : bs(0)} />
      </div>
      <ul className="flex flex-col gap-space-sm">{cuentas.map((c) => {
        const cobrada = !(Number(c.saldo) > 0);
        return (
          <li key={c.id} className="border border-outline-variant rounded-xl p-space-sm flex items-center justify-between gap-space-sm">
            <div><p className="font-label-lg">{cobrada ? `Cobrada · ${bs(c.monto)}` : `Saldo ${bs(c.saldo)} de ${bs(c.monto)}`}</p>
              <p className="font-body-sm text-on-surface-variant">Vence {c.vence}{!cobrada && c.vencida ? ` · venció hace ${-c.dias} día(s)` : ''}</p></div>
            {!cobrada && <button type="button" onClick={() => cobrar(c)} className="h-12 px-space-md rounded-lg bg-primary text-on-primary font-semibold">Cobrar</button>}
          </li>);
      })}</ul>
    </Ficha>
  );
}
