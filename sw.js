// Service Worker di DigiVice OS — SOLO per le Web Push.
// Va servito dalla RADICE del sito (https://tuodominio/sw.js), non da una sottocartella:
// lo scope di un Service Worker copre solo il percorso da cui viene servito in giù, e qui
// serve che copra l'intero sito (index.html, player.html, digimon.html, ecc.).
//
// Non fa caching, non intercetta fetch, non serve offline: si occupa solo di ricevere i
// push events quando arrivano (anche a pagina chiusa, finché il browser stesso è "vivo" —
// su Android funziona anche a browser completamente chiuso; su iOS solo se l'app è stata
// installata da Home Screen, e richiede iOS 16.4+) e di aprire/mettere a fuoco la pagina
// giusta quando la persona tocca la notifica.

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let payload = { title: 'DigiVice OS', body: 'Nuovo messaggio.', url: '/index.html' };
  try {
    if (event.data) payload = Object.assign(payload, event.data.json());
  } catch (e) {
    // Se per qualche motivo il payload non è JSON valido, teniamo i valori di default sopra
    // invece di far fallire silenziosamente la notifica.
  }
  const options = {
    body: payload.body,
    tag: payload.tag || 'dvos-push',
    renotify: true,
    icon: payload.icon || undefined,
    data: { url: payload.url || '/index.html' }
  };
  event.waitUntil(self.registration.showNotification(payload.title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/index.html';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Se una scheda del sito è già aperta, la mettiamo a fuoco invece di aprirne una nuova.
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
