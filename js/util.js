// js/util.js
// Piccoli helper puri usati ovunque nel Tavolo (index.html): nessuna dipendenza da altro stato
// dell'app (roster, scena, sessione...), quindi sono il pezzo a rischio piu' basso in assoluto
// da estrarre dal vecchio index.html monolitico.
//
// Script classico (non un modulo ES), caricato PRIMA del blocco <script> principale in
// index.html: le funzioni qui sotto restano quindi disponibili come funzioni globali,
// esattamente come quando vivevano dentro la stessa IIFE del file grande — nessun cambiamento
// di comportamento, solo di dove il codice vive.

function escapeHTML(s){ return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function escapeAttr(s){ return escapeHTML(s); }
function sanitizeKeyPart(s){ return String(s||'').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 48); }
