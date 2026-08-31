// js/encounters.js
// Helper puri per gli "Incontri" piazzati in Scena dal Master: normalizzazione (stringa legacy
// solo-nome vs oggetto completo agganciato al Dex), calcolo Caselle Ferita (stessa formula dei
// Digimon dei giocatori, Stage + Health×2 -- usa stageIndex, globale da js/rules.js caricato
// prima di questo file), e le disposizioni (Nemico/Alleato/Neutrale). Nessuna dipendenza da
// session/roster/DOM.
//
// Script classico (non un modulo ES), caricato PRIMA del blocco <script> principale in index.html
// -- restano funzioni/costanti globali esattamente come quando vivevano nella stessa IIFE del
// file grande, nessun cambiamento di comportamento.

  // ---------- SCENE ENCOUNTERS: name-only strings (legacy) vs full Dex-linked objects ----------
  function normalizeEncounter(e){
    if(typeof e === 'string'){
      return { id:'enc'+Date.now()+Math.random().toString(36).slice(2,6), name:e, dexId:null, stage:'', categories:[], image:'', description:'', baseStats:{baseAccuracy:0,baseDamage:0,baseDodge:0,baseArmor:0,baseHealth:0}, attacks:[], revealed:true, isBoss:false, currentWounds:null, disposition:'enemy', nameHidden:false };
    }
    return Object.assign({ id:'enc'+Date.now()+Math.random().toString(36).slice(2,6), name:'', dexId:null, stage:'', categories:[], image:'', description:'', baseStats:{baseAccuracy:0,baseDamage:0,baseDodge:0,baseArmor:0,baseHealth:0}, attacks:[], revealed:true, isBoss:false, currentWounds:null, disposition:'enemy', nameHidden:false }, e);
  }
  const ENCOUNTER_DISPOSITIONS = { enemy:{label:'Nemico', color:'var(--danger)', icon:'⚔️'}, ally:{label:'Alleato', color:'var(--cyan)', icon:'🤝'}, neutral:{label:'Neutrale', color:'var(--text-mute)', icon:'❔'} };

  // Caselle Ferita di un Incontro nella Scena, stessa formula usata per i Digimon dei giocatori (Stage + Health×2)
  function encounterMaxWounds(e){
    const bs = (e && e.baseStats) || {};
    return Math.max(1, stageIndex(e && e.stage) + Number(bs.baseHealth||0)*2);
  }
  function encounterCurrentWounds(e){
    const max = encounterMaxWounds(e);
    if(e.currentWounds===null || e.currentWounds===undefined) return max;
    return Math.max(0, Math.min(max, Number(e.currentWounds)));
  }
  function encName(e){ return (typeof e==='string') ? e : ((e && e.name) || ''); }

  // ---------- Etichetta stabile per partecipanti al combattimento con nome nascosto ----------
  // Con più Digimon nascosti in scena, mostrare "❔ (???)" per tutti li rende indistinguibili in
  // chat/UI (specialmente da mobile, dove non si vede la linea delle distanze). Assegniamo quindi
  // un numero STABILE per lato ("Nemico 1", "Nemico 2", ...), scritto una volta su
  // p.hiddenLabelNum e mai ricalcolato — così resta lo stesso anche se altri partecipanti vengono
  // aggiunti o rimossi in seguito (a differenza di un indice ricalcolato ad ogni render, che
  // salterebbe/si sovrapporrebbe cambiando la lista).
  function assignHiddenLabelNum(combat, p){
    if(!p || !p.nameHidden || p.hiddenLabelNum) return;
    const used = new Set((combat && Array.isArray(combat.participants) ? combat.participants : [])
      .filter(x=>x.nameHidden && x.side===p.side && x.hiddenLabelNum)
      .map(x=>x.hiddenLabelNum));
    let n = 1;
    while(used.has(n)) n++;
    p.hiddenLabelNum = n;
  }
  // Etichetta da mostrare (testo del messaggio, mittente in chat, select del bersaglio, ecc.) per
  // un partecipante con nome nascosto — usa il numero assegnato da assignHiddenLabelNum se
  // presente, altrimenti il vecchio "❔ (???)" generico come fallback (es. dati più vecchi mai
  // passati da lì).
  function hiddenParticipantLabel(p){
    if(!p) return '❔ (???)';
    const kind = p.side==='enemy' ? 'Nemico' : 'Sconosciuto';
    return p.hiddenLabelNum ? `❔ ${kind} ${p.hiddenLabelNum}` : '❔ (???)';
  }
  // Nome "sicuro" da usare ovunque serva mostrare il mittente/attore di una narrazione di
  // combattimento (campo `who` dei messaggi in chat compreso) — maschera automaticamente se il
  // partecipante ha nameHidden, altrimenti il nome vero.
  function narratorName(p){ return (p && p.nameHidden) ? hiddenParticipantLabel(p) : (p ? p.name : ''); }
