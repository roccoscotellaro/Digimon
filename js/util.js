// js/util.js
// Piccoli helper usati ovunque nel Tavolo (index.html). La maggior parte (escapeHTML/escapeAttr/
// sanitizeKeyPart) non dipende da altro stato dell'app -- da qui il nome "util". displayName/
// displayNameFor sono l'eccezione: leggono cachedRoster (globale, dichiarato in js/store.js, che
// carica PRIMA di questo file) per risalire dal semplice username al nome del personaggio da
// mostrare in UI -- restano qui perche' sono helper di formattazione usati ovunque quanto gli
// altri (55+ punti nel file grande), non logica specifica di una singola funzionalita'.
//
// Script classico (non un modulo ES), caricato PRIMA del blocco <script> principale in
// index.html: le funzioni qui sotto restano quindi disponibili come funzioni globali,
// esattamente come quando vivevano dentro la stessa IIFE del file grande — nessun cambiamento
// di comportamento, solo di dove il codice vive.

function escapeHTML(s){ return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function escapeAttr(s){ return escapeHTML(s); }
function sanitizeKeyPart(s){ return String(s||'').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 48); }

// Nome da mostrare in UI per un membro del roster: il nome del personaggio (tamer.characterName)
// se è stato impostato, altrimenti lo username di login (fallback per schede esistenti che non
// l'hanno mai compilato). Lo username resta SEMPRE la chiave di login/sessione/query — questa
// funzione (e la variante sotto) sono solo per la visualizzazione.
function displayName(member){
  const cn = member && member.tamer && member.tamer.characterName;
  return (cn && String(cn).trim()) ? String(cn).trim() : ((member && member.username) || '');
}
// Variante comoda quando si ha solo lo username (es. record non collegati a un member completo:
// bug report, log di scan, thread di chat privata) — cerca il membro in cachedRoster e ricade sullo
// username grezzo se non lo trova o non ha un characterName impostato.
function displayNameFor(username){
  if(!username) return '';
  const member = (cachedRoster||[]).find(m=>m.username===username);
  return member ? displayName(member) : username;
}
