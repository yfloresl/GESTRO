/* Service worker de GESTRO: avisos Web Push con la pantalla bloqueada (Android y iPhone con la PWA instalada).
   No guarda en caché nada de la API: los datos siempre se piden en vivo. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let aviso = { titulo: 'GESTRO', cuerpo: 'Tienes un aviso nuevo.', url: '/app/salon' };
  try { aviso = { ...aviso, ...event.data.json() }; } catch { /* aviso genérico */ }
  event.waitUntil(self.registration.showNotification(aviso.titulo, {
    body: aviso.cuerpo,
    icon: '/icono-192.png',
    badge: '/icono-192.png',
    tag: aviso.etiqueta || undefined,
    renotify: !!aviso.etiqueta,
    vibrate: [250, 120, 250, 120, 250],
    requireInteraction: !!aviso.urgente,
    data: { url: aviso.url },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const destino = new URL(event.notification.data?.url || '/app/salon', self.location.origin).href;
  event.waitUntil((async () => {
    const abiertas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of abiertas) {
      if (c.url.startsWith(self.location.origin) && 'focus' in c) { await c.focus(); if ('navigate' in c) await c.navigate(destino); return; }
    }
    await self.clients.openWindow(destino);
  })());
});
