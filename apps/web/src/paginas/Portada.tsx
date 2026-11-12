import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Marca } from '../componentes/Marca';
import { PieLegal } from '../componentes/ModalLegal';
import { SelectorTema } from '../componentes/SelectorTema';
import { iniciarIngreso } from '../lib/kyrosid';
import { api, useSesion } from '../lib/sesion';

type Idioma = 'es' | 'en';
const T = {
  es: {
    ingresar: 'Ingresar', crear: 'Crear cuenta', lema: 'Tu restaurante, en un solo lugar',
    sub: 'GESTRO reúne el menú, las mesas con código QR, los pedidos, la cocina, la caja, el inventario, las compras, las reservas y la contabilidad básica. Desde el navegador, sin instalar nada.',
    paraQuien: 'Para quién es', quienes: [['Dueños y administradores', 'Ven cómo va el negocio y deciden con datos.'], ['Meseros, cocina y caja', 'Cada persona ve solo lo suyo y trabaja más rápido.'], ['Tus comensales', 'Escanean el QR de la mesa, piden, llaman al mesero y reservan, sin crear cuenta ni pagar nada al sistema.']],
    funciones: 'Qué puedes hacer', f: [['menu_book', 'Menú y fotos', 'Tu carta con precios, fotos y disponibilidad.'], ['table_restaurant', 'Mesas y salón', 'Zonas (VIP, terraza, fumadores…), meseros por mesa o por área y llamados en vivo.'], ['qr_code_2', 'Pedidos por QR', 'El comensal pide desde su mesa y el pedido llega a cocina.'], ['skillet', 'Cocina', 'Tablero de comandas con tiempos y avisos de «listo».'], ['point_of_sale', 'Caja', 'Cobros en efectivo, QR, tarjeta o crédito, arqueo y recibos.'], ['inventory_2', 'Inventario y recetas', 'Stock, mermas, costos y márgenes por plato.'], ['event_seat', 'Reservas', 'Agenda y una página pública para reservar.'], ['account_balance', 'Compras y contabilidad', 'Órdenes de compra, cuentas por pagar y cobrar, asientos y reportes.']],
    vista: 'Así se ve', como: 'Cómo empezar', pasos: ['Crea tu cuenta con Kyros ID.', 'Lee y acepta los términos.', 'Abre tu restaurante y carga tu menú.'],
    nota: 'GESTRO no emite facturas electrónicas ni cobra en línea por tu restaurante: registra los cobros que haces con tus propios medios.',
    imgs: { estadisticas: 'Estadísticas y panel del dueño', salon: 'Mapa de mesas y llamados', pedidos: 'Pedidos en curso', recetas: 'Recetas y costeo', inventario: 'Inventario' },
    error: 'No pudimos abrir Kyros ID. Inténtalo otra vez.', noDisp: 'El ingreso no está disponible por ahora. Inténtalo en unos minutos.',
  },
  en: {
    ingresar: 'Sign in', crear: 'Create account', lema: 'Your restaurant, in one place',
    sub: 'GESTRO brings together your menu, QR-code tables, orders, kitchen, cash register, inventory, purchasing, reservations and basic accounting. In your browser, nothing to install.',
    paraQuien: 'Who it is for', quienes: [['Owners and managers', 'See how the business is doing and decide with data.'], ['Waiters, kitchen and cashiers', 'Everyone sees only their part and works faster.'], ['Your diners', 'They scan the table QR, order, call the waiter and book, with no account and nothing to pay the system.']],
    funciones: 'What you can do', f: [['menu_book', 'Menu and photos', 'Your menu with prices, photos and availability.'], ['table_restaurant', 'Tables and floor', 'Zones (VIP, terrace, smoking…), waiters by table or area and live calls.'], ['qr_code_2', 'QR ordering', 'Diners order from their table and the order reaches the kitchen.'], ['skillet', 'Kitchen', 'Ticket board with timers and “ready” alerts.'], ['point_of_sale', 'Cash register', 'Cash, QR, card or credit payments, till count and receipts.'], ['inventory_2', 'Inventory and recipes', 'Stock, waste, costs and margins per dish.'], ['event_seat', 'Reservations', 'A diary and a public page to book.'], ['account_balance', 'Purchasing and accounting', 'Purchase orders, payables and receivables, journal entries and reports.']],
    vista: 'What it looks like', como: 'How to start', pasos: ['Create your account with Kyros ID.', 'Read and accept the terms.', 'Open your restaurant and load your menu.'],
    nota: 'GESTRO does not issue electronic tax invoices or charge online for your restaurant: it records the payments you take by your own means.',
    imgs: { estadisticas: 'Statistics and owner dashboard', salon: 'Table map and calls', pedidos: 'Orders in progress', recetas: 'Recipes and costing', inventario: 'Inventory' },
    error: 'We could not open Kyros ID. Please try again.', noDisp: 'Sign-in is not available right now. Please try again in a few minutes.',
  },
} as const;

/** Portal informativo de GESTRO (raíz del sistema): qué es, para quién, funciones y capturas. Sin precios. Desde aquí se ingresa o se crea la cuenta con Kyros ID. */
export function Portada() {
  const { estado } = useSesion();
  const [idioma, setIdioma] = useState<Idioma>(() => (typeof navigator !== 'undefined' && navigator.language?.startsWith('en') ? 'en' : 'es'));
  const [error, setError] = useState<string | null>(null);
  const cfg = useQuery({ queryKey: ['kyros-id-config'], queryFn: () => api.kyrosIdConfig(), retry: 1 });
  const t = T[idioma];
  if (estado === 'activa') return <Navigate to="/app" replace />;

  const ir = (registro: boolean) => { if (!cfg.data) return; setError(null); iniciarIngreso(cfg.data, { registro, destino: '/app' }).catch(() => setError(t.error)); };
  const caido = cfg.isError || (cfg.data && !cfg.data.activo);
  const Botones = ({ clase = '' }: { clase?: string }) => (
    <div className={`flex flex-wrap gap-space-sm ${clase}`}>
      <button type="button" onClick={() => ir(false)} disabled={!cfg.data || !!caido} className="h-14 px-space-lg rounded-lg bg-primary text-on-primary font-semibold flex items-center gap-space-xs disabled:opacity-50"><span className="material-symbols-outlined" aria-hidden="true">login</span>{t.ingresar}</button>
      <button type="button" onClick={() => ir(true)} disabled={!cfg.data || !!caido} className="h-14 px-space-lg rounded-lg border border-outline text-primary font-semibold disabled:opacity-50">{t.crear}</button>
    </div>);

  return (
    <div className="min-h-screen bg-background text-on-surface overflow-x-clip">
      <header className="sticky top-0 z-30 bg-surface/90 backdrop-blur border-b border-outline-variant">
        <div className="max-w-6xl mx-auto h-16 px-space-md flex items-center justify-between gap-space-sm">
          <Marca />
          <div className="flex items-center gap-space-xs">
            <div role="group" aria-label={idioma === 'es' ? 'Idioma' : 'Language'} className="flex gap-space-xs">{(['es', 'en'] as const).map((i) => <button key={i} type="button" aria-pressed={idioma === i} onClick={() => setIdioma(i)} className={`h-12 px-space-sm rounded-lg font-semibold ${idioma === i ? 'bg-primary-container text-on-primary' : 'text-on-surface-variant hover:bg-surface-container'}`}>{i.toUpperCase()}</button>)}</div>
            <SelectorTema />
            <button type="button" onClick={() => ir(false)} disabled={!cfg.data || !!caido} className="hidden sm:flex h-12 px-space-md rounded-lg bg-primary text-on-primary font-semibold items-center disabled:opacity-50">{t.ingresar}</button>
          </div>
        </div>
      </header>

      <main>
        <section className="max-w-6xl mx-auto px-space-md py-space-xl grid gap-space-lg lg:grid-cols-2 items-center">
          <div className="flex flex-col gap-space-md">
            <h1 className="font-headline-xl-mobile md:font-headline-xl text-headline-xl-mobile md:text-headline-xl text-primary tracking-tight">{t.lema}</h1>
            <p className="font-body-lg text-body-lg text-on-surface-variant">{t.sub}</p>
            <Botones />
            {error && <p role="alert" className="text-error font-body-sm">{error}</p>}
            {caido && <p role="alert" className="rounded-lg bg-error-container text-on-error-container p-space-sm font-body-sm">{t.noDisp}</p>}
          </div>
          <img src="/portada/estadisticas.webp" alt={t.imgs.estadisticas} width={1440} height={900} className="w-full rounded-xl border border-outline-variant shadow-[0_8px_24px_rgba(0,0,0,0.12)]" />
        </section>

        <section aria-labelledby="para" className="bg-surface-container-low">
          <div className="max-w-6xl mx-auto px-space-md py-space-xl flex flex-col gap-space-md">
            <h2 id="para" className="font-headline-lg text-headline-lg text-primary">{t.paraQuien}</h2>
            <div className="grid gap-gutter md:grid-cols-3">{t.quienes.map(([a, b]) => <div key={a} className="bg-surface-container-lowest border border-outline-variant rounded-xl p-space-md"><h3 className="font-headline-sm text-headline-sm">{a}</h3><p className="text-on-surface-variant">{b}</p></div>)}</div>
          </div>
        </section>

        <section aria-labelledby="fun" className="max-w-6xl mx-auto px-space-md py-space-xl flex flex-col gap-space-md">
          <h2 id="fun" className="font-headline-lg text-headline-lg text-primary">{t.funciones}</h2>
          <div className="grid gap-gutter sm:grid-cols-2 lg:grid-cols-4">{t.f.map(([ic, a, b]) => <div key={a} className="border border-outline-variant rounded-xl p-space-md bg-surface-container-lowest flex flex-col gap-space-xs"><span className="material-symbols-outlined text-primary text-[28px]" aria-hidden="true">{ic}</span><h3 className="font-label-lg font-semibold">{a}</h3><p className="font-body-sm text-on-surface-variant">{b}</p></div>)}</div>
        </section>

        <section aria-labelledby="vista" className="bg-surface-container-low">
          <div className="max-w-6xl mx-auto px-space-md py-space-xl flex flex-col gap-space-md">
            <h2 id="vista" className="font-headline-lg text-headline-lg text-primary">{t.vista}</h2>
            <div className="grid gap-gutter md:grid-cols-2">{(['salon', 'pedidos', 'recetas', 'inventario'] as const).map((k) => <figure key={k} className="flex flex-col gap-space-xs"><img src={`/portada/${k}.webp`} alt={t.imgs[k]} loading="lazy" width={1440} height={900} className="w-full rounded-xl border border-outline-variant" /><figcaption className="font-body-sm text-on-surface-variant">{t.imgs[k]}</figcaption></figure>)}</div>
          </div>
        </section>

        <section aria-labelledby="como" className="max-w-6xl mx-auto px-space-md py-space-xl flex flex-col gap-space-md">
          <h2 id="como" className="font-headline-lg text-headline-lg text-primary">{t.como}</h2>
          <ol className="grid gap-gutter md:grid-cols-3">{t.pasos.map((p, i) => <li key={p} className="flex items-start gap-space-sm"><span className="w-10 h-10 shrink-0 rounded-full bg-primary text-on-primary flex items-center justify-center font-semibold">{i + 1}</span><span className="pt-2">{p}</span></li>)}</ol>
          <Botones />
          <p className="font-body-sm text-on-surface-variant">{t.nota}</p>
        </section>
      </main>

      <footer className="border-t border-outline-variant py-space-lg flex flex-col items-center gap-space-sm px-space-md">
        <PieLegal /><p className="font-body-sm text-on-surface-variant">© Kyros-Tech · GESTRO</p>
      </footer>
    </div>
  );
}
