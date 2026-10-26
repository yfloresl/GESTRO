import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Shell } from './componentes/Shell';
import { AvisosProvider } from './lib/avisos';
import { SesionProvider } from './lib/sesion';
import { Cliente } from './paginas/Cliente';
import { Menu } from './paginas/Menu';
import { Personal } from './paginas/Personal';
import { Salon } from './paginas/Salon';
import { Caja, ReciboPagina } from './paginas/Caja';
import { Cocina } from './paginas/Cocina';
import { Compras } from './paginas/Compras';
import { Cobranzas } from './paginas/Cobranzas';
import { Contabilidad } from './paginas/Contabilidad';
import { Promociones } from './paginas/Promociones';
import { Turnos } from './paginas/Turnos';
import { Eventos } from './paginas/Eventos';
import { ReservaWeb } from './paginas/ReservaWeb';
import { Reservas } from './paginas/Reservas';
import { Configuracion } from './paginas/Configuracion';
import { Inventario } from './paginas/Inventario';
import { Pedidos } from './paginas/Pedidos';
import { PlanDelDia } from './paginas/PlanDelDia';
import { Recetas } from './paginas/Recetas';
import { Plataforma } from './paginas/Plataforma';
import { Suscripcion } from './paginas/Suscripcion';
import { Callback } from './paginas/Callback';
import { Ingreso } from './paginas/Ingreso';
import { EnConstruccion, Panel } from './paginas/Panel';
import { Registro } from './paginas/Registro';
import { useRolesActivos } from './lib/sesion';

/** Cada persona cae en lo suyo: cocina en su tablero, mesero en el salón, cajero en la caja. */
function Inicio() {
  const { roles, esAdmin, esPlataforma } = useRolesActivos();
  if (esPlataforma && roles.length === 0) return <Navigate to="plataforma" replace />;
  if (esAdmin || esPlataforma || roles.length === 0) return <Navigate to="panel" replace />;
  if (roles.includes('cocina')) return <Navigate to="/cocina" replace />;
  if (roles.includes('cajero')) return <Navigate to="caja" replace />;
  if (roles.includes('almacen')) return <Navigate to="inventario" replace />;
  if (roles.includes('cobranzas')) return <Navigate to="cobranzas" replace />;
  return <Navigate to="salon" replace />;
}
import './estilos.css';

const cliente = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <QueryClientProvider client={cliente}>
      <SesionProvider>
        <AvisosProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Ingreso />} />
            <Route path="/entrar" element={<Ingreso directo />} />
            <Route path="/callback" element={<Callback />} />
            <Route path="/registro" element={<Registro />} />
            <Route path="/m/:qr" element={<Cliente />} />
            <Route path="/r/:slug" element={<ReservaWeb />} />
            <Route path="/cocina" element={<Cocina />} />
            <Route path="/app" element={<Shell />}>
              <Route index element={<Inicio />} />
              <Route path="panel" element={<Panel />} />
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
        </BrowserRouter>
        </AvisosProvider>
      </SesionProvider>
    </QueryClientProvider>
  </StrictMode>,
);

// Service worker: avisos Web Push con la pantalla bloqueada. No guarda datos en caché.
if ('serviceWorker' in navigator) window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => undefined); });
