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
      return { id:'enc'+Date.now()+Math.random().toString(36).slice(2,6), name:e, dexId:null, stage:'', categories:[], image:'', description:'', baseStats:{baseAccuracy:0,baseDamage:0,baseDodge:0,baseArmor:0,baseHealth:0}, attacks:[], revealed:true, isBoss:false, currentWounds:null, disposition:'enemy' };
    }
    return Object.assign({ id:'enc'+Date.now()+Math.random().toString(36).slice(2,6), name:'', dexId:null, stage:'', categories:[], image:'', description:'', baseStats:{baseAccuracy:0,baseDamage:0,baseDodge:0,baseArmor:0,baseHealth:0}, attacks:[], revealed:true, isBoss:false, currentWounds:null, disposition:'enemy' }, e);
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
