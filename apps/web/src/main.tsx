import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Shell } from './componentes/Shell';
import { SesionProvider } from './lib/sesion';
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
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Ingreso />} />
            <Route path="/entrar" element={<Ingreso directo />} />
            <Route path="/callback" element={<Callback />} />
            <Route path="/registro" element={<Registro />} />
            <Route path="/app" element={<Shell />}>
              <Route index element={<Navigate to="panel" replace />} />
              <Route path="panel" element={<Panel />} />
              <Route path="*" element={<EnConstruccion />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </SesionProvider>
    </QueryClientProvider>
  </StrictMode>,
);
