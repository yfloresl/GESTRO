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
import { Callback } from './paginas/Callback';
import { Ingreso } from './paginas/Ingreso';
import { EnConstruccion, Panel } from './paginas/Panel';
import { Registro } from './paginas/Registro';
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
            <Route path="/app" element={<Shell />}>
              <Route index element={<Navigate to="panel" replace />} />
              <Route path="panel" element={<Panel />} />
              <Route path="menu" element={<Menu />} />
              <Route path="salon" element={<Salon />} />
              <Route path="personal" element={<Personal />} />
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
