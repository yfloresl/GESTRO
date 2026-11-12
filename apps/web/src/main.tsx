import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, ReactNode, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { GRUPOS, Shell, visible } from './componentes/Shell';
import { Cargando } from './componentes/Marca';
import { LegalProvider } from './componentes/ModalLegal';
import { AvisosProvider } from './lib/avisos';
import { SesionProvider } from './lib/sesion';
const Cliente = lazy(() => import('./paginas/Cliente').then((m) => ({ default: m.Cliente })));
const Menu = lazy(() => import('./paginas/Menu').then((m) => ({ default: m.Menu })));
const Personal = lazy(() => import('./paginas/Personal').then((m) => ({ default: m.Personal })));
const Salon = lazy(() => import('./paginas/Salon').then((m) => ({ default: m.Salon })));
const Caja = lazy(() => import('./paginas/Caja').then((m) => ({ default: m.Caja })));
const ReciboPagina = lazy(() => import('./paginas/Caja').then((m) => ({ default: m.ReciboPagina })));
const Cocina = lazy(() => import('./paginas/Cocina').then((m) => ({ default: m.Cocina })));
const Compras = lazy(() => import('./paginas/Compras').then((m) => ({ default: m.Compras })));
const Cobranzas = lazy(() => import('./paginas/Cobranzas').then((m) => ({ default: m.Cobranzas })));
const Alertas = lazy(() => import('./paginas/Alertas').then((m) => ({ default: m.Alertas })));
const Asistente = lazy(() => import('./paginas/Asistente').then((m) => ({ default: m.Asistente })));
const Contabilidad = lazy(() => import('./paginas/Contabilidad').then((m) => ({ default: m.Contabilidad })));
const Foda = lazy(() => import('./paginas/Foda').then((m) => ({ default: m.Foda })));
const Estadisticas = lazy(() => import('./paginas/Estadisticas').then((m) => ({ default: m.Estadisticas })));
const Promociones = lazy(() => import('./paginas/Promociones').then((m) => ({ default: m.Promociones })));
const Turnos = lazy(() => import('./paginas/Turnos').then((m) => ({ default: m.Turnos })));
const Eventos = lazy(() => import('./paginas/Eventos').then((m) => ({ default: m.Eventos })));
const ReservaWeb = lazy(() => import('./paginas/ReservaWeb').then((m) => ({ default: m.ReservaWeb })));
const Reservas = lazy(() => import('./paginas/Reservas').then((m) => ({ default: m.Reservas })));
const Configuracion = lazy(() => import('./paginas/Configuracion').then((m) => ({ default: m.Configuracion })));
const Inventario = lazy(() => import('./paginas/Inventario').then((m) => ({ default: m.Inventario })));
const Pedidos = lazy(() => import('./paginas/Pedidos').then((m) => ({ default: m.Pedidos })));
const PlanDelDia = lazy(() => import('./paginas/PlanDelDia').then((m) => ({ default: m.PlanDelDia })));
const Recetas = lazy(() => import('./paginas/Recetas').then((m) => ({ default: m.Recetas })));
const Plataforma = lazy(() => import('./paginas/Plataforma').then((m) => ({ default: m.Plataforma })));
const Suscripcion = lazy(() => import('./paginas/Suscripcion').then((m) => ({ default: m.Suscripcion })));
import { Callback } from './paginas/Callback';
import { Ingreso } from './paginas/Ingreso';
import { Portada } from './paginas/Portada';
const EnConstruccion = lazy(() => import('./paginas/Panel').then((m) => ({ default: m.EnConstruccion })));
const Panel = lazy(() => import('./paginas/Panel').then((m) => ({ default: m.Panel })));
import { Registro } from './paginas/Registro';
import { PaginaLegal } from './paginas/Legal';
import { useRolesActivos } from './lib/sesion';

/** Cada persona cae en lo suyo: cocina en su tablero, mesero en el salón, cajero en la caja. */
/** El Panel del Dueño solo se abre para dueño o administrador; cualquier otro rol vuelve a su pantalla de inicio. */
function SoloDueno({ children }: { children: ReactNode }) {
  const { esAdmin } = useRolesActivos();
  return esAdmin ? <>{children}</> : <Navigate to="/app" replace />;
}

function Inicio() {
  const { roles, esAdmin, esPlataforma } = useRolesActivos();
  if (esPlataforma && roles.length === 0) return <Navigate to="plataforma" replace />;
  if (esAdmin || esPlataforma || roles.length === 0) return <Navigate to="panel" replace />;
  if (roles.includes('cocina')) return <Navigate to="/cocina" replace />;
  if (roles.includes('cajero')) return <Navigate to="caja" replace />;
  if (roles.includes('almacen')) return <Navigate to="inventario" replace />;
  if (roles.includes('cobranzas')) return <Navigate to="cobranzas" replace />;
  if (roles.includes('mesero') || roles.includes('area_manager')) return <Navigate to="salon" replace />;
  // Cualquier otro rol (p. ej. contador) cae en la primera sección que su menú le muestra, nunca en una sin acceso.
  const primero = GRUPOS.flatMap((g) => g.items).find((i) => visible(i, roles, false));
  return <Navigate to={primero?.ruta ?? 'turnos'} replace />;
}
import { registrarRetornoNativo } from './lib/nativo';
import './estilos.css';

registrarRetornoNativo();   // inerte fuera de la app Android

const cliente = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <QueryClientProvider client={cliente}>
      <SesionProvider>
        <AvisosProvider>
        <BrowserRouter>
          <LegalProvider>
          <Suspense fallback={<Cargando />}>
          <Routes>
            <Route path="/" element={<Portada />} />
            <Route path="/ingresar" element={<Ingreso />} />
            <Route path="/entrar" element={<Ingreso directo />} />
            <Route path="/callback" element={<Callback />} />
            <Route path="/registro" element={<Registro />} />
            <Route path="/terminos" element={<PaginaLegal doc="terminos" />} />
            <Route path="/legal/terminos" element={<PaginaLegal doc="terminos" />} />
            <Route path="/legal/privacidad" element={<PaginaLegal doc="privacidad" />} />
            <Route path="/legal/politicas" element={<PaginaLegal doc="politicas" />} />
            <Route path="/privacidad" element={<PaginaLegal doc="privacidad" />} />
            <Route path="/politicas" element={<PaginaLegal doc="politicas" />} />
            <Route path="/m/:qr" element={<Cliente />} />
            <Route path="/r/:slug" element={<ReservaWeb />} />
            <Route path="/cocina" element={<Cocina />} />
            <Route path="/app" element={<Shell />}>
              <Route index element={<Inicio />} />
              <Route path="panel" element={<SoloDueno><Panel /></SoloDueno>} />
              <Route path="menu" element={<Menu />} />
              <Route path="salon" element={<Salon />} />
              <Route path="personal" element={<Personal />} />
              <Route path="pedidos" element={<Pedidos />} />
              <Route path="inventario" element={<Inventario />} />
              <Route path="compras" element={<Compras />} />
              <Route path="contabilidad" element={<Contabilidad />} />
              <Route path="cobranzas" element={<Cobranzas />} />
              <Route path="reservas" element={<Reservas />} />
              <Route path="eventos" element={<Eventos />} />
              <Route path="turnos" element={<Turnos />} />
              <Route path="promociones" element={<Promociones />} />
              <Route path="estadisticas" element={<Estadisticas />} />
              <Route path="alertas" element={<Alertas />} />
              <Route path="foda" element={<Foda />} />
              <Route path="asistente" element={<Asistente />} />
              <Route path="recetas" element={<Recetas />} />
              <Route path="plan-del-dia" element={<PlanDelDia />} />
              <Route path="caja" element={<Caja />} />
              <Route path="recibo/:id" element={<ReciboPagina />} />
              <Route path="configuracion" element={<Configuracion />} />
              <Route path="suscripcion" element={<Suscripcion />} />
              <Route path="plataforma" element={<Plataforma />} />
              <Route path="*" element={<EnConstruccion />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </Suspense>
          </LegalProvider>
        </BrowserRouter>
        </AvisosProvider>
      </SesionProvider>
    </QueryClientProvider>
  </StrictMode>,
);

// Service worker: avisos Web Push con la pantalla bloqueada. No guarda datos en caché.
if ('serviceWorker' in navigator) window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => undefined); });
