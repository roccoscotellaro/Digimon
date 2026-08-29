// js/api.js
// Livello di trasporto HTTP verso le tue Serverless Function (fetch + parsing JSON + gestione
// errori). Sono le uniche 4 funzioni del vecchio blocco "API helpers" di index.html a non
// leggere nessuna variabile privata di quella IIFE (session, cachedScene, currentLocationKey...)
// -- per questo sono il secondo pezzo estratto dal monolite, dopo util.js/dice.js. Tutti i
// wrapper specifici (getRoster, pushLog, getScene, getDex, ecc.) restano invece dentro
// index.html: usano davvero quelle variabili, quindi spostarli avrebbe richiesto un modulo di
// stato condiviso vero e proprio (rimandato, vedi la discussione sullo split completo).
//
// lastApiError: l'ultimo messaggio d'errore di rete, letto in decine di punti di index.html per
// mostrare "Errore: ..." nell'interfaccia. Prima viveva come variabile privata nella stessa IIFE
// del file grande; ora e' dichiarata qui (script classico, non un modulo ES, caricato PRIMA del
// blocco <script> principale) e resta leggibile ovunque nel file grande esattamente come prima,
// risalendo la catena di scope fino a qui -- nessun cambiamento di comportamento.
let lastApiError = null;

async function apiGet(path, silent){
  try{
    const r = await fetch(path);
    const data = await r.json();
    if(!r.ok){ if(!silent) lastApiError = data.error || ('Errore ' + r.status); return null; }
    if(!silent) lastApiError = null;
    return data;
  }catch(e){ if(!silent) lastApiError = 'Errore di rete: ' + e.message; return null; }
}
async function apiPost(path, body){
  try{
    const r = await fetch(path, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
    const data = await r.json();
    if(!r.ok){ lastApiError = data.error || ('Errore ' + r.status); return null; }
    lastApiError = null;
    return data;
  }catch(e){ lastApiError = 'Errore di rete: ' + e.message; return null; }
}
async function apiPut(path, body){
  try{
    const r = await fetch(path, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
    const data = await r.json();
    if(!r.ok){ lastApiError = data.error || ('Errore ' + r.status); return null; }
    lastApiError = null;
    return data;
  }catch(e){ lastApiError = 'Errore di rete: ' + e.message; return null; }
}
async function apiDelete(path){
  try{
    const r = await fetch(path, { method:'DELETE' });
    const data = await r.json();
    if(!r.ok){ lastApiError = data.error || ('Errore ' + r.status); return null; }
    lastApiError = null;
    return data;
  }catch(e){ lastApiError = 'Errore di rete: ' + e.message; return null; }
}
