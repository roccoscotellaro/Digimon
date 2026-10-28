const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  console.warn('SUPABASE_URL o SUPABASE_SERVICE_KEY mancanti nelle variabili ambiente.');
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);

function cleanCode(code) {
  return String(code || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 48);
}

// Risposte GET "condizionali" (richiesta Rocco 2026-10-28, "leggerezza e velocità"): ogni giro di
// polling (15s) rileggeva roster, scena, combattimento, ecc. per intero anche quando non era cambiato
// nulla. Con questo helper una risposta GET riuscita porta un'impronta (ETag) del suo contenuto; il
// browser la ricorda e alla richiesta successiva la rimanda (If-None-Match) da solo, senza nessun
// codice in più lato pagina. Se il contenuto è identico rispondiamo 304 "non cambiato" — pochi byte
// invece dell'intero JSON — e il browser riusa la copia che aveva. `private, no-cache` = mai in cache
// condivisa (CDN), e sempre ricontrollato col server: i dati restano sempre aggiornati.
// Si attiva con una riga in cima a ogni handler: enableEtag(req, res).
function enableEtag(req, res) {
  if (req.method !== 'GET' || typeof res.json !== 'function') return;
  const originalJson = res.json.bind(res);
  res.json = (obj) => {
    if (res.statusCode !== 200) return originalJson(obj);
    const body = JSON.stringify(obj);
    const tag = 'W/"' + crypto.createHash('sha1').update(body).digest('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 27) + '"';
    res.setHeader('ETag', tag);
    res.setHeader('Cache-Control', 'private, no-cache');
    if (req.headers['if-none-match'] === tag) {
      res.statusCode = 304;
      return res.end();
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(body);
  };
}

module.exports = { supabase, cleanCode, enableEtag };
