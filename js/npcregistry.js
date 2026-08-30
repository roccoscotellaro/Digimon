// js/npc-registry.js
// Registro NPC condiviso (Supabase via /api/notice?resource=npc): fetch, cache in formato
// {name,color,avatar} per i picker "Parla come"/Menziona, e upsert. Dipende solo da cachedNpcs
// (globale, js/store.js) e apiGet/apiPost (globali, js/api.js), entrambi caricati prima di
// questo file. E' un prerequisito per js/chat-composer.js (che lo usa per i picker).
//
// Script classico (non un modulo ES), caricato PRIMA del blocco <script> principale in index.html
// -- restano funzioni globali esattamente come quando vivevano nella stessa IIFE del file grande,
// nessun cambiamento di comportamento.

  // ---------- Registro NPC condiviso (Supabase via /api/notice?resource=npc) ----------
  // Prima viveva solo in localStorage sul browser del Master: comodo (nessuna migrazione DB) ma
  // legato a quel dispositivo — un giocatore che apriva npc.html dal proprio telefono vedeva
  // sempre il registro vuoto. Ora è condiviso come roster/scena/log/dex: cachedNpcs si popola al
  // login (renderPlayer/renderMaster) e si aggiorna ogni ~10 minuti nel polling lento (stesso
  // dexCycle del Digidex in refreshLiveParts — cambia raramente quanto il Dex, non serve
  // rileggerlo ogni 4s, vedi il commento su dexCycle più sotto per il perché).
  //
  // loadSavedNpcs continua a restituire il vecchio formato {name,color,avatar} così tutti i
  // picker "Parla come"/menziona (che sono diversi punti nel file) restano invariati.
  async function getNpcs(code){ const d = await apiGet('/api/notice?resource=npc&code=' + encodeURIComponent(code), true); return d ? (d.npcs||[]) : []; }
  function loadSavedNpcs(code){
    return cachedNpcs.map(n=>({ name: n.name, color: n.chatColor||null, avatar: n.faceUrl || n.fullBodyUrl || null }));
  }
  async function rememberNpc(code, npc){
    if(!npc || !npc.name || !npc.name.trim()) return;
    const name = npc.name.trim();
    const existing = cachedNpcs.find(n=>n.name.toLowerCase()===name.toLowerCase());
    const entry = {
      id: existing ? existing.id : null,
      name,
      chatColor: npc.color || (existing && existing.chatColor) || '#ffd76a',
      faceUrl: npc.avatar || (existing && existing.faceUrl) || '',
      fullBodyUrl: (existing && existing.fullBodyUrl) || '',
      description: (existing && existing.description) || ''
    };
    const d = await apiPost('/api/notice', { resource:'npc', code, ...entry });
    if(d && d.npc){
      const idx = cachedNpcs.findIndex(n=>n.id===d.npc.id);
      if(idx>=0) cachedNpcs[idx] = d.npc; else cachedNpcs.push(d.npc);
    }
  }
