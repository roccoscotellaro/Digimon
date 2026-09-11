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
  // sectorId/luogoId (fase 21): posizione facoltativa dell'Incontro dentro la Scena. null/assente
  // = "Ovunque nella scena" (comportamento storico, retrocompatibile con tutti gli Incontri creati
  // prima di questa fase: restano visibili a chiunque, indipendentemente da dove si trova). Se
  // impostato, l'Incontro si vede solo a chi (giocatore o gruppo) si trova in quel Settore (con
  // luogoId nullo = ovunque in quel Settore) o esattamente in quel Luogo (con luogoId impostato).
  // Vedi encounterMatchesLocation in js/scene-encounters.js.
  //
  // bossBonusStat/bossBonusAmount (richiesta utente: "vogliamo creare questo automatismo?" per il
  // flag Boss): tracciano SE e QUANTO bonus è stato dato a una singola Statistica base per essere
  // stato marcato Boss, così togliere il flag può annullare esattamente lo stesso bonus invece di
  // lasciare la Statistica gonfiata per sempre. null/0 = nessun bonus applicato (default, e caso
  // di tutti gli Incontri creati prima di questa funzionalità).
  //
  // chatColor (richiesta utente: "fai sì che possa scegliere il colore quando lo aggiungo in
  // scena così che resti sempre lo stesso e non devo cambiarlo ogni volta"): colore mostrato/usato
  // di default nel picker "Colore scritta in chat" quando il Master fa "Parlare" questo Incontro
  // (vedi applySpeakAsMode/applyPrivSpeakAsMode/applySubSpeakAsMode) — invece del vecchio valore
  // fisso '#ff5d5d' uguale per ogni Incontro, ognuno ha ora il proprio colore persistente,
  // impostabile alla creazione (renderEncounterDraftCard) o in seguito (encountersEditableHTML).
  // '#ff5d5d' resta il default per gli Incontri creati prima di questo campo.
  function normalizeEncounter(e){
    if(typeof e === 'string'){
      return { id:'enc'+Date.now()+Math.random().toString(36).slice(2,6), name:e, dexId:null, stage:'', categories:[], image:'', description:'', baseStats:{baseAccuracy:0,baseDamage:0,baseDodge:0,baseArmor:0,baseHealth:0}, attacks:[], revealed:true, isBoss:false, bossBonusStat:null, bossBonusAmount:0, currentWounds:null, disposition:'enemy', nameHidden:false, sectorId:null, luogoId:null, chatColor:'#ff5d5d' };
    }
    return Object.assign({ id:'enc'+Date.now()+Math.random().toString(36).slice(2,6), name:'', dexId:null, stage:'', categories:[], image:'', description:'', baseStats:{baseAccuracy:0,baseDamage:0,baseDodge:0,baseArmor:0,baseHealth:0}, attacks:[], revealed:true, isBoss:false, bossBonusStat:null, bossBonusAmount:0, currentWounds:null, disposition:'enemy', nameHidden:false, sectorId:null, luogoId:null, chatColor:'#ff5d5d' }, e);
  }
  const ENCOUNTER_DISPOSITIONS = { enemy:{label:'Nemico', color:'var(--danger)', icon:'⚔️'}, ally:{label:'Alleato', color:'var(--cyan)', icon:'🤝'}, neutral:{label:'Neutrale', color:'var(--text-mute)', icon:'❔'} };

  // Statistiche base a cui è possibile assegnare il bonus automatico da Boss (vedi
  // renderEncounterDraftCard/bindEncounterDraftCard e il bottone "👑 Segna Boss" in
  // js/scene-encounters.js). baseHealth alza le Caselle Ferita tramite encounterMaxWounds qui
  // sotto (Stage + Health×2, quindi ogni punto qui vale 2 Caselle Ferita), le altre si applicano
  // 1:1 alla Statistica del partecipante in combattimento.
  const BOSS_BONUS_STATS = { baseAccuracy:'Accuracy', baseDamage:'Damage', baseDodge:'Dodge', baseArmor:'Armor', baseHealth:'Wound Box (Health)' };

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
