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
  // Richiesta Rocco 2026-10-28: "cliccando sulla notifica si apra direttamente la chat". L'URL
  // (vedi chatDeepLink in api/log.js) dice quale chat aprire, es. /index.html?chat=private.
  //  - Se DigiVice è già aperto su index.html: lo mettiamo a fuoco e gli passiamo l'URL con un
  //    postMessage — la pagina (applyChatDeepLink in index.html) apre la chat giusta senza
  //    ricaricarsi (niente login/attesa di nuovo).
  //  - Se è aperta un'altra pagina del sito (Digidex, Mappa...): la portiamo su quell'URL.
  //  - Se non c'è nessuna finestra aperta: ne apriamo una nuova direttamente sull'URL.
  event.waitUntil((async () => {
    const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const isMainPage = (c) => {
      try {
        const p = new URL(c.url).pathname;
        return p === '/' || p.endsWith('/index.html');
      } catch (e) { return false; }
    };
    const main = clientList.find(isMainPage);
    if (main) {
      try { main.postMessage({ type: 'dvos-open-chat', url: targetUrl }); } catch (e) {}
      if ('focus' in main) return main.focus();
      return;
    }
    const other = clientList.find(c => 'navigate' in c);
    if (other) {
      try {
        const navigated = await other.navigate(targetUrl);
        if (navigated && 'focus' in navigated) return navigated.focus();
      } catch (e) {}
    }
    if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
  })());
});
