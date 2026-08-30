// js/digimon-card.js
// Scheda Digimon completa + logica di Evoluzione, il pezzo singolo piu' grosso del monolite
// originale: renderDigimonCard (visualizzazione/editing della Scheda Digimon con le sue barre,
// Qualities, Attacchi, Forme Armor) e tutto cio' che serve solo a lei -- calcolo statistiche
// derivate (computeDerivedStats/maxAttackSlots/computeDpSpent), UI di Attributo/Evoluzioni/EP
// Digivice (attributeIconHTML/attributeLegendHTML/attributeBadgeHTML/splitCategoriesAttribute/
// evolutionsReadonlyHTML/evolutionsEditableHTML/epDigiviceHTML), Qualities (qualitiesReadonlyHTML/
// qualitiesEditableHTML), Attacchi (attackTagsPlain/attackTagsHTML), e il cambio di Stage
// (evolutionCost/snapshotCurrentStatsToStage/showEvolutionTransition/applyStageChange, con la
// tabella STAGE_CREATION dei costi/stat iniziali per Stage e defaultDigimon come base per un
// Digimon nuovo -- usato anche da normalizeMember in index.html per completare schede vecchie).
//
// Dipende da: escapeHTML/escapeAttr/displayName (js/util.js), stageIndex/SIZES/SKILL_DEFS
// (js/rules.js), batteryCap/hasEffectQuality/rollPool/rollSkillCheck/evaluateVsTN/diceRowHTML
// (js/combat-engine.js), bestDigimonImage/pushLog (js/chat-log-engine.js), saveMember
// (js/api.js), session/cachedRoster/cachedProgression/cachedDex/cachedScene (js/store.js), e da
// barHTML/batteryBarHTML/portraitHTML/digimonPortraitHTML/siblingCardId (js/ui-helpers.js,
// caricato subito prima di questo file) -- tutti gia' globali.
//
// Script classico (non un modulo ES), caricato PRIMA del blocco <script> principale in index.html,
// dopo js/ui-helpers.js.
//
// renderDigimonCard NON chiama piu' refreshLiveParts()/renderTamerCard() direttamente (entrambe
// restano dentro l'IIFE di index.html -- la prima e' l'orchestratore centrale, la seconda e' la
// Scheda Tamer/Skills, non ancora estratta): come nelle fasi precedenti, riceve due parametri
// opzionali `onChanged` (al posto di refreshLiveParts, richiamato dopo ogni salvataggio) e
// `renderTamerCardFn` (al posto di renderTamerCard, richiamato quando un cambio di Stage deve
// aggiornare anche la Scheda Tamer affiancata), propagati ad ogni chiamata interna e ricorsiva.
// I due punti in index.html che avviano questa scheda passano `refreshLiveParts` e
// `renderTamerCard` come argomenti -- stesso comportamento di prima, iniettato dall'esterno
// invece che agganciato per nome.

  let editingDigimon = false;

  function defaultDigimon(){
    return {
      name:'', stage:'Rookie', personality:'', imageUrl:'', approved:false,
      maxWounds:5, currentWounds:5, maxMp:3, currentMp:3,
      baseAccuracy:1, baseDamage:1, baseDodge:1, baseArmor:1, baseHealth:1,
      dpTotal:0, unspentBonusDP:0, qualities:[],
      // Il "riposo di default" parte da Fresh: con Default Range 2 sblocca Fresh â Baby â Rookie
      // senza Evolution Points (regola 3.0/8.05b) â coerente con digimon.html.
      defaultStage:'Fresh', defaultRange:2, evolutionPoints:0, forcedEvoRoundsLeft:0,
      evolveUnlocked:false,
      unlockedEvolutions:[], // nomi delle evoluzioni (dal Digidex) che il Master ha sbloccato per il giocatore
      battery:0, usedSigMoveThisTurn:false,
      size:'Medium', stance:'Neutral', chatColor:'#c896ff',
      resolveCurrent:0, resolveMax:4,
      stageStats:{},
      armorForms:[],
      hybridMode:false,
      hiddenFromParty:false, // true = nascosto agli altri giocatori (es. non ancora "schiuso" narrativamente); Master e proprietario lo vedono sempre
      attacks:[
        { name:'Colpo Base', shape:'Melee', type:'Damage', effectKey:'', extraTags:'', desc:'Un attacco fisico semplice.', signature:false, reach:0, areaAttack:false },
        { name:'Raggio a Distanza', shape:'Range', type:'Damage', effectKey:'', extraTags:'', desc:'Un colpo dalla distanza.', signature:false, reach:1, areaAttack:false }
      ]
    };
  }

  const STAGE_CREATION = {
    Fresh:    { dp:2,  startStat:1 },
    Baby:     { dp:5,  startStat:1 },
    Rookie:   { dp:10, startStat:2 },
    Champion: { dp:20, startStat:3 },
    Ultimate: { dp:30, startStat:4 },
    Mega:     { dp:40, startStat:5 }
  };

  function __playEvolutionSfx(url){
    try{
      if(window.__dvosAudioPrefs && (window.__dvosAudioPrefs.clickMuted || window.__dvosAudioPrefs.musicMuted)) return;
      new Audio(url).play().catch(()=>{});
    }catch(e){}
  }

  const SIZE_DEFS = {
    Small:    { ram:2, cpu:-1, bit:1 },
    Medium:   { ram:1, bit:1 },
    Large:    { cpu:1, bit:1 },
    Huge:     { cpu:1, dos:1 },
    Gigantic: { ram:-1, cpu:2, dos:1 },
    Colossal: { ram:-1, cpu:2, dos:1 }
  };
  function maxSizeIndexForStage(stage){ return Math.min(SIZES.length-1, stageIndex(stage)+1); }
  function allowedSizes(stage){ return SIZES.slice(0, maxSizeIndexForStage(stage)+1); }

  // stanceModifiers spostato in js/rules.js

  function computeDerivedStats(d){
    const sizeMod = SIZE_DEFS[d.size] || {};
    return {
      bit: Math.max(0, Math.floor(Number(d.baseAccuracy||0)/3) + (sizeMod.bit||0)),
      dos: Math.max(0, Math.floor(Number(d.baseDamage||0)/3) + (sizeMod.dos||0)),
      ram: Math.max(0, Math.floor(Number(d.baseDodge||0)/3) + (sizeMod.ram||0)),
      cpu: Math.max(0, Math.floor(Number(d.baseArmor||0)/3) + (sizeMod.cpu||0))
    };
  }

  function evolutionsReadonlyHTML(evolutions){
    if(!evolutions || evolutions.length===0) return '';
    return `
      <div class="muted" style="margin-top:10px;margin-bottom:4px;">Possibili Evoluzioni</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;">
        ${evolutions.map(ev=>`
          <div style="display:flex;flex-direction:column;align-items:center;width:56px;">
            ${portraitHTML(ev.imageUrl, ev.name, 'sm')}
            <div class="muted" style="font-size:10px;text-align:center;margin-top:2px;">${escapeHTML(ev.name)}</div>
          </div>
        `).join('')}
      </div>
    `;
  }

  function evolutionsEditableHTML(evolutions){
    if(!evolutions || evolutions.length===0) return '<div class="muted" style="margin-bottom:8px;">Nessuna evoluzione aggiunta.</div>';
    return evolutions.map((ev,i)=>`
      <div class="flex-between" style="margin-bottom:4px;">
        <span>${escapeHTML(ev.name)}</span>
        <button class="btn ghost small" data-rmevo="${i}">Rimuovi</button>
      </div>
    `).join('');
  }

  // STAGES spostato in js/rules.js
  const DEX_ATTRIBUTES = ['Vaccine','Data','Virus','Free','Variable'];
  const DEX_ATTRIBUTE_COLOR = { Vaccine:'#5aa8ff', Data:'#3ddc84', Virus:'#ff5d5d', Free:'#b8b8b8', Variable:'#ff8a3d' };
  // Icone ufficiali Attributo (set Digimon Story: Time Stranger su Wikimon â stile coerente,
  // copre tutti e 5 gli Attributi incluso Variable). Stessa mappa usata in dex.html.
  const ATTRIBUTE_ICON_URL = {
    Vaccine: 'https://wikimon.net/images/6/6c/DSTS_Icon_Attribute_Vaccine.png',
    Data: 'https://wikimon.net/images/2/2a/DSTS_Icon_Attribute_Data.png',
    Virus: 'https://wikimon.net/images/2/2c/DSTS_Icon_Attribute_Virus.png',
    Free: 'https://wikimon.net/images/5/5b/DSTS_Icon_Attribute_Free.png',
    Variable: 'https://wikimon.net/images/0/0b/DSTS_Icon_Attribute_Variable.png'
  };
  // Testo breve per Attributo (Variant Rule 2.05c â Attribute Advantage), usato come tooltip
  // sull'icona: Vaccine batte Virus, Virus batte Data, Data batte Vaccine. Free non partecipa.
  // Variable sceglie un Attributo all'Iniziativa, fisso per tutto il combattimento.
  const ATTRIBUTE_DESC = {
    Vaccine: 'Vaccine â batte Virus, perde da Data',
    Data: 'Data â batte Vaccine, perde da Virus',
    Virus: 'Virus â batte Data, perde da Vaccine',
    Free: 'Free â non partecipa al vantaggio di Attributo',
    Variable: 'Variable â sceglie un Attributo all\'Iniziativa, fisso per il combattimento'
  };
  function attributeIconHTML(attribute, size){
    if(!attribute || !ATTRIBUTE_ICON_URL[attribute]) return '';
    const px = size || 14;
    return `<img src="${ATTRIBUTE_ICON_URL[attribute]}" alt="${escapeAttr(attribute)}" title="${escapeAttr(ATTRIBUTE_DESC[attribute]||attribute)}" style="width:${px}px;height:${px}px;vertical-align:middle;" onerror="this.style.display='none'" />`;
  }
  // Trafiletto compatto da mettere vicino a ogni selettore Attributo: spiega il triangolo una volta
  // sola, con le icone vere invece che solo testo.
  function attributeLegendHTML(){
    return `<div style="margin-top:4px;">
      <svg viewBox="0 0 220 210" width="190" height="182" xmlns="http://www.w3.org/2000/svg" style="display:block;margin:2px auto 6px auto;">
  <defs>
    <marker id="atriArrow" markerWidth="7" markerHeight="7" refX="5" refY="2.5" orient="auto">
      <path d="M0,0 L5,2.5 L0,5 Z" fill="#35e8c9"/>
    </marker>
  </defs>
  <path d="M 95,46 Q 55,90 46,144" fill="none" stroke="#35e8c9" stroke-width="1.6" marker-end="url(#atriArrow)"/>
  <path d="M 56,169 Q 110,198 165,169" fill="none" stroke="#35e8c9" stroke-width="1.6" marker-end="url(#atriArrow)"/>
  <path d="M 175,144 Q 165,90 128,46" fill="none" stroke="#35e8c9" stroke-width="1.6" marker-end="url(#atriArrow)"/>
  <image href="https://wikimon.net/images/6/6c/DSTS_Icon_Attribute_Vaccine.png" x="97" y="17" width="26" height="26"/>
  <text x="110" y="10" text-anchor="middle" font-size="10" fill="#cfd6e4" font-family="sans-serif">Vaccine</text>
  <image href="https://wikimon.net/images/2/2c/DSTS_Icon_Attribute_Virus.png" x="22" y="152" width="26" height="26"/>
  <text x="35" y="196" text-anchor="middle" font-size="10" fill="#cfd6e4" font-family="sans-serif">Virus</text>
  <image href="https://wikimon.net/images/2/2a/DSTS_Icon_Attribute_Data.png" x="172" y="152" width="26" height="26"/>
  <text x="185" y="196" text-anchor="middle" font-size="10" fill="#cfd6e4" font-family="sans-serif">Data</text>
</svg>
      <div class="muted" style="font-size:9px;text-align:center;margin-top:-2px;display:flex;align-items:center;justify-content:center;gap:4px;">${attributeIconHTML('Free',13)} Free non conta Â· ${attributeIconHTML('Variable',13)} Variable sceglie all'Iniziativa</div>
    </div>`;
  }
  // A Dex entry's "categories" array holds both Attribute and Family/Field tags together (no separate
  // backend column for them). We treat any value matching a known Attribute as *the* Attribute, and
  // everything else as Family tags, so we can show/edit them as distinct fields without any schema change.
  function splitCategoriesAttribute(categories){
    const cats = Array.isArray(categories) ? categories : [];
    const attribute = cats.find(c=>DEX_ATTRIBUTES.includes(c)) || '';
    const family = cats.filter(c=>!DEX_ATTRIBUTES.includes(c));
    return { attribute, family };
  }
  function attributeBadgeHTML(attribute){
    if(!attribute) return '';
    const color = DEX_ATTRIBUTE_COLOR[attribute] || 'var(--text-mute)';
    return `<span class="tag" style="color:${color};border-color:${color};display:inline-flex;align-items:center;gap:3px;">${attributeIconHTML(attribute, 12)}${escapeHTML(attribute)}</span>`;
  }
  // stageIndex spostato in js/rules.js
  // Badge "a Digivice" per gli Evolution Point disponibili (regola 8.05a): una cornice con
  // antenna/pulsante e schermo LCD al posto del semplice testo "EP: X". Se max Ã¨ noto (Milestone
  // completate) lo mostra in tono piÃ¹ spento accanto al valore attuale, es. "3/5".
  // opts.mini = versione ridotta per il Roster Campagna del Master (rosterItemHTML), dove lo
  // spazio Ã¨ poco; la versione normale resta per la Scheda Digimon del giocatore. Le "barrette"
  // sullo schermo centrale sono una griglia a celle (fino a 10, 8 in versione mini) â se il
  // massimo reale supera quel numero di celle, il riempimento Ã¨ proporzionale invece che 1:1,
  // cosÃ¬ la lettura resta a colpo d'occhio anche con Milestone avanzate; il valore esatto Ã¨
  // comunque scritto sotto in cifre.
  function epDigiviceHTML(current, max, opts){
    const mini = !!(opts && opts.mini);
    const cur = Math.max(0, Number(current)||0);
    const hasMax = max!=null && max>=0;
    const SLOTS = mini ? 5 : 8;
    const totalSlots = (hasMax && max>0 && max<SLOTS) ? max : SLOTS;
    let filledSlots;
    if(hasMax && max>0){
      filledSlots = max<=SLOTS ? Math.min(cur, max) : Math.round((cur/max)*SLOTS);
    } else {
      filledSlots = Math.min(cur, SLOTS);
    }
    let bars = '';
    for(let i=0;i<SLOTS;i++){
      bars += i<totalSlots ? `<span class="ep-dv-bar ${i<filledSlots?'filled':''}"></span>` : `<span class="ep-dv-bar dim"></span>`;
    }
    return `<span class="ep-digivice${mini?' mini':''}" title="Evolution Points disponibili${hasMax?` (massimo ${max}, pari alle Milestone completate)`:''}">
      <span class="ep-dv-frame"><span class="ep-dv-screen">${bars}</span></span>
      <span class="ep-dv-label">EP <b>${cur}</b>${hasMax?`<span style="opacity:.6;">/${max}</span>`:''}</span>
    </span>`;
  }
  // Specchio di digimon.html: slot Attacco massimi per Stage (regola 3.05a â 1 Signature + 2 extra
  // agli Stage base, 4 a Mega), + i Rank di Memory Upgrade (Free Quality, +1 Attacco/Rank) se presenti.
  const ATTACK_SLOTS_BY_STAGE = { Fresh:1, Baby:1, Rookie:3, Champion:3, Ultimate:3, Mega:4 };
  function memoryUpgradeRanks(qualities){
    const q = (qualities||[]).find(x=>x.name && x.name.indexOf('Memory Upgrade')===0);
    return q ? (Number(q.rank)||1) : 0;
  }
  function maxAttackSlots(d){
    const base = ATTACK_SLOTS_BY_STAGE[d && d.stage] ?? 3;
    return base + memoryUpgradeRanks(d && d.qualities);
  }
  // batteryCap spostato in js/rules.js
  function evolutionCost(d, targetStage){
    const comfortableMax = stageIndex(d.defaultStage) + Number(d.defaultRange||0);
    return Math.max(0, stageIndex(targetStage) - comfortableMax);
  }

  function snapshotCurrentStatsToStage(d, stage){
    if(!d.stageStats) d.stageStats = {};
    const prevAttacks = d.stageStats[stage] && d.stageStats[stage].attacks;
    d.stageStats[stage] = {
      name: d.name, imageUrl: d.imageUrl || '',
      baseAccuracy: d.baseAccuracy, baseDamage: d.baseDamage, baseDodge: d.baseDodge,
      baseArmor: d.baseArmor, baseHealth: d.baseHealth, maxWounds: d.maxWounds, maxMp: d.maxMp, size: d.size,
      attacks: (Array.isArray(d.attacks) && d.attacks.length) ? d.attacks : prevAttacks
    };
  }

  // Piccola transizione visiva di evoluzione: dissolvenza incrociata tra il ritratto vecchio e quello
  // nuovo (preferendo la GIF se il Digidex ne ha una), con un bagliore di sottofondo. "Un minimo" di
  // spettacolaritÃ  come richiesto â nessun video, solo CSS, sparisce da sola dopo pochi secondi o al tocco.
  function showEvolutionTransition(oldImg, newImg, newName){
    const div = document.createElement('div');
    div.style.cssText = 'position:fixed;inset:0;background:rgba(5,7,10,0.92);z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;';
    div.innerHTML = `
      <style>
        @keyframes evo-fade-out{0%{opacity:1;}60%{opacity:0.3;}100%{opacity:0;}}
        @keyframes evo-fade-in{0%{opacity:0;transform:scale(0.85);}60%{opacity:0;}100%{opacity:1;transform:scale(1);}}
        @keyframes evo-flash{0%{opacity:0;}50%{opacity:1;}100%{opacity:0.4;}}
      </style>
      <div style="position:relative;width:200px;height:200px;">
        <div style="position:absolute;inset:-30px;border-radius:50%;background:radial-gradient(circle, rgba(53,232,201,0.55), transparent 70%);animation:evo-flash 1.8s ease-out forwards;pointer-events:none;"></div>
        ${oldImg ? `<img src="${escapeAttr(oldImg)}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;image-rendering:pixelated;animation:evo-fade-out 1.8s ease-in forwards;" />` : ''}
        ${newImg ? `<img src="${escapeAttr(newImg)}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;image-rendering:pixelated;opacity:0;animation:evo-fade-in 1.8s ease-out forwards;" />` : ''}
      </div>
      <div class="mono" style="color:var(--cyan);margin-top:18px;font-size:16px;letter-spacing:0.05em;text-shadow:0 0 10px rgba(53,232,201,0.6);">â¨ DIGIVOLVE IN ${escapeHTML((newName||'?').toUpperCase())} â¨</div>
      <div class="muted" style="margin-top:10px;font-size:11px;">(tocca per chiudere)</div>
    `;
    document.body.appendChild(div);
    div.onclick = ()=>{ if(div.parentNode) div.remove(); };
    setTimeout(()=>{ if(div.parentNode) div.remove(); }, 3200);
  }
  function applyStageChange(d, oldStage, newStage){
    if(oldStage === newStage) return;
    snapshotCurrentStatsToStage(d, oldStage);
    if(!d.stageStats) d.stageStats = {};
    const saved = d.stageStats[newStage];
    if(saved){
      d.baseAccuracy = saved.baseAccuracy; d.baseDamage = saved.baseDamage; d.baseDodge = saved.baseDodge;
      d.baseArmor = saved.baseArmor; d.baseHealth = saved.baseHealth;
      d.maxWounds = saved.maxWounds; d.maxMp = saved.maxMp;
      d.size = saved.size || allowedSizes(newStage)[0] || 'Medium';
      if(saved.name) d.name = saved.name;
      if(saved.imageUrl) d.imageUrl = saved.imageUrl;
      // Evolvere cambia anche le mosse: se questo Stage ha un elenco Attacchi proprio (dal Digidex),
      // lo usiamo al posto di quello dello Stage precedente.
      if(Array.isArray(saved.attacks) && saved.attacks.length) d.attacks = saved.attacks;
    } else {
      const cfg = STAGE_CREATION[newStage] || { startStat:1 };
      d.baseAccuracy = cfg.startStat; d.baseDamage = cfg.startStat; d.baseDodge = cfg.startStat;
      d.baseArmor = cfg.startStat; d.baseHealth = cfg.startStat;
      d.maxWounds = stageIndex(newStage) + cfg.startStat*2;
      d.size = allowedSizes(newStage)[0] || 'Medium';
    }
    d.stage = newStage;
    if(d.currentWounds > d.maxWounds) d.currentWounds = d.maxWounds;
    if(d.currentMp > d.maxMp) d.currentMp = d.maxMp;
    if(!allowedSizes(newStage).includes(d.size)) d.size = allowedSizes(newStage)[0] || 'Medium';
  }

  // Instrada un pushLog di narrazione generata da un'azione del giocatore sul proprio Digimon
  // (Evoluzione, Signature Move, Armor Form, Pool Check...) verso lo stesso canale che il
  // giocatore sta guardando in quel momento â privato col Master, il sottogruppo aperto, o
  // generale â esattamente come giÃ  fatto per tiri/spostamenti in js/chat-log-engine.js (vedi
  // memberLocationKey/subgroupLocationKey, e il commento "BUGFIX" lÃ¬ per lo stesso identico bug).
  // Prima di questa funzione, ogni pushLog qui sotto andava sempre in Chat Generale: un giocatore
  // separato in un sottogruppo vedeva la propria narrazione di digievoluzione sparire nel canale
  // sbagliato (segnalato dall'utente). playerChatMode/playerActiveSubgroupId restano al valore di
  // default quando Ã¨ il Master a cliccare questi stessi bottoni dal proprio pannello (il Master ha
  // un proprio masterChatMode separato), quindi in quel caso questa funzione si comporta come un
  // normale pushLog, senza alcun cambiamento di comportamento.
  async function pushPlayerNarration(code, me, entry){
    if(typeof playerChatMode!=='undefined' && playerChatMode==='private'){
      return pushPrivateLog(code, session.username, { ...entry, meta: { ...(entry.meta||{}), location: memberLocationKey(me) } });
    } else if(typeof playerChatMode!=='undefined' && playerChatMode==='subgroup' && playerActiveSubgroupId){
      const group = (cachedSubgroups||[]).find(g=>g.id===playerActiveSubgroupId) || null;
      return pushPrivateLog(code, 'subgroup:'+playerActiveSubgroupId, { ...entry, meta: { ...(entry.meta||{}), location: subgroupLocationKey(group) } });
    }
    return pushLog(code, entry);
  }

  function attackTagsPlain(a){
    const tags = [`[${a.shape.toUpperCase()}${a.shape==='Range'?' '+(a.reach||1):''}]`, `[${a.type.toUpperCase()}]`];
    if(a.areaAttack) tags.push('[AREA]');
    if(a.type==='Support' && a.effectKey){
      const def = EFFECT_DEFS.find(d=>d.key===a.effectKey);
      if(def) tags.push(`[${def.label.toUpperCase()}]`);
    }
    if(a.extraTags) tags.push(a.extraTags);
    return tags.join(' ');
  }
  function attackTagsHTML(a){
    const shapeColor = a.shape==='Melee' ? 'var(--amber)' : 'var(--cyan)';
    const typeColor = a.type==='Damage' ? 'var(--danger)' : '#c896ff';
    let html = `<span class="tag" style="color:${shapeColor};border-color:${shapeColor};margin-right:3px;">${a.shape==='Melee'?'ð¡ï¸':'ð¹'} ${a.shape}${a.shape==='Range'?' ('+(a.reach||1)+' zone)':''}</span><span class="tag" style="color:${typeColor};border-color:${typeColor};margin-right:3px;">${a.type==='Damage'?'ð¥':'â¨'} ${a.type}</span>`;
    if(a.areaAttack) html += `<span class="tag" style="color:var(--amber);border-color:var(--amber);margin-right:3px;">ðª Area</span>`;
    if(a.type==='Support' && a.effectKey){
      const def = EFFECT_DEFS.find(d=>d.key===a.effectKey);
      if(def) html += `<span class="tag" style="margin-right:3px;">${def.label}</span>`;
    }
    if(a.extraTags) html += `<span class="tag">${escapeHTML(a.extraTags)}</span>`;
    return html;
  }

  function computeDpSpent(qualities){
    return (qualities||[]).reduce((sum,q)=>sum+(Number(q.cost)||0),0);
  }

  function qualitiesReadonlyHTML(qualities){
    if(!qualities || qualities.length===0) return '<div class="muted">Nessuna Quality registrata.</div>';
    return qualities.map(q=>`
      <div class="roster-item" style="padding:6px 8px;margin-bottom:4px;">
        <div class="flex-between">
          <span><b>${escapeHTML(q.name)}</b>${q.category?` <span class="tag" style="margin-left:4px;">${escapeHTML(q.category)}</span>`:''}</span>
          <span class="mono">${q.cost} DP</span>
        </div>
        ${q.description ? `<div class="sub" style="margin-top:2px;">${escapeHTML(q.description)}</div>` : ''}
      </div>
    `).join('');
  }

  const QUALITY_CATALOG = [
    { name:'Certain Strike', category:'Attack', dpPerRank:2, maxRank:3, mechanic:'certainStrike', desc:'Aggiunge Successi automatici garantiti alla Pool Accuracy pari ai Ranks, su un Attacco [DAMAGE].' },
    { name:'Weapon', category:'Attack', dpPerRank:1, maxRank:3, mechanic:'weapon', desc:'FONDAMENTA â Rank max = Stage (1/2/3, sempre 3 da Ultimate in su). Bonus automatico ad Accuracy e Danno pari ai Ranks (semplificazione: nel manuale si applica solo ad Attacchi con Tag [WEAPON]; qui Ã¨ generico su tutti gli Attacchi). Su [RANGE] il manuale darebbe anche +Range/Limite Effettivo pari ai Ranks (gestione zone a discrezione del Master). Su [MELEE], un numero di 4 pari ai Ranks conta come Successo (applicare a mano sui tiri Accuracy). Incompatibile con Instinct.' },
    { name:'Instinct', category:'Static', dpPerRank:1, maxRank:3, mechanic:'instinct', desc:'FONDAMENTA â Rank max = Stage (1/2/3, sempre 3 da Ultimate in su). Bonus automatico a Dodge pari ai Ranks. Applica anche manualmente lo stesso bonus a Ferite Massime (Health) e a Movimento (non gestito dal sito). Incompatibile con Weapon.' },
    { name:'Data Optimization: Close Combat', category:'Static', dpPerRank:1, maxRank:1, mechanic:'', desc:'FONDAMENTA (una sola Data Optimization a scelta). +1 Accuracy su Attacchi [MELEE], +3 invece di +1 se il Bersaglio ha giÃ  subito un Attacco dalla fine del suo ultimo turno (applicare a mano).' },
    { name:'Data Optimization: Ranged Striker', category:'Static', dpPerRank:1, maxRank:1, mechanic:'', desc:'FONDAMENTA (una sola Data Optimization a scelta). +1 Accuracy su Attacchi [RANGE]. +1 a Range e Limite Effettivo (gestione zone a discrezione del Master).' },
    { name:'Data Optimization: Warden', category:'Static', dpPerRank:1, maxRank:1, mechanic:'dataOptWarden', desc:'FONDAMENTA (una sola Data Optimization a scelta). +1 Armor (automatico). Una volta a combattimento, Azione Interrupt senza spendere Azioni (Azione Libera) â applicare a mano.' },
    { name:'Data Optimization: Brawler', category:'Clash', dpPerRank:1, maxRank:1, mechanic:'dataOptBrawler', desc:'FONDAMENTA (una sola Data Optimization a scelta). +1 automatico ai Check per avviare o durante un Clash. +1 Danno quando attacca un avversario con cui Ã¨ in Clash (applicare a mano).' },
    { name:'Data Optimization: Speedster', category:'Static', dpPerRank:1, maxRank:1, mechanic:'', desc:'FONDAMENTA (una sola Data Optimization a scelta). +1 Movimento (non gestito dal sito). Ignora la prima penalitÃ  a Dodge per essere stato attaccato dopo il proprio turno (applicare a mano).' },
    { name:'Data Optimization: Effect Warrior', category:'Static', dpPerRank:1, maxRank:1, mechanic:'', desc:'FONDAMENTA (una sola Data Optimization a scelta). +1 Potenza a tutti i Tag di Effetto d\'Attacco che usano una Stat Derivata del lanciatore (applicare a mano alla Potenza quando registri l\'Effetto).' },
    { name:'Data Optimization: Variable', category:'Trigger', dpPerRank:1, maxRank:1, mechanic:'', desc:'FONDAMENTA (una sola Data Optimization a scelta). Una volta a round, puÃ² ritirare un Check o Pool Check giÃ  effettuato in Combattimento e deve tenere il nuovo risultato (si resetta a fine turno).' },
    { name:'Naturewalk: Fuoco', category:'Static', dpPerRank:1, maxRank:1, mechanic:'naturewalk', desc:'FONDAMENTA â +1 alla Stat scelta qui sotto (max 2 Ranks totali su elementi diversi). Consigliato Dragon\'s Roar/Unknown (Deserti, Vulcani, Dune). Riduce di 1 la Durata di [BURN] su di sÃ© e ignora le penalitÃ  da calore estremo. Nessuna penalitÃ  da Terreno Difficile di Fuoco. Resistente ad Attacchi Elemental Force: Fuoco.' },
    { name:'Naturewalk: Acqua', category:'Static', dpPerRank:1, maxRank:1, mechanic:'naturewalk', desc:'FONDAMENTA â +1 alla Stat scelta qui sotto (max 2 Ranks totali su elementi diversi). Consigliato Deep Savers (Oceani, Fiumi, Laghi). Riduce di 1 la Durata di [FRAIL] su di sÃ© e respira sott\'acqua. Nessuna penalitÃ  da Terreno Difficile d\'Acqua. Resistente ad Attacchi Elemental Force: Acqua.' },
    { name:'Naturewalk: Vento', category:'Static', dpPerRank:1, maxRank:1, mechanic:'naturewalk', desc:'FONDAMENTA â +1 alla Stat scelta qui sotto (max 2 Ranks totali su elementi diversi). Consigliato Wind Guardians (Montagne, cieli aperti, Altipiani). Dimezza la Potenza di [PULL] subito come Effetto negativo e riduce di 1 il Danno da Caduta. Resistente ad Attacchi Elemental Force: Vento.' },
    { name:'Naturewalk: Terra', category:'Static', dpPerRank:1, maxRank:1, mechanic:'naturewalk', desc:'FONDAMENTA â +1 alla Stat scelta qui sotto (max 2 Ranks totali su elementi diversi). Consigliato Nature Spirits/Jungle Troopers (Caverne, Deserti, Canyon). Dimezza la Potenza di [PUSH] subito come Effetto negativo e riduce di 1 il Danno da fattori ambientali. Resistente ad Attacchi Elemental Force: Terra.' },
    { name:'Naturewalk: Ghiaccio', category:'Static', dpPerRank:1, maxRank:1, mechanic:'naturewalk', desc:'FONDAMENTA â +1 alla Stat scelta qui sotto (max 2 Ranks totali su elementi diversi). Consigliato Deep Savers/Nightmare Soldiers (Montagne Innevate, Ghiacciai, Tundra). Riduce di 1 la Durata di [FREEZE] su di sÃ© e ignora le penalitÃ  da freddo estremo. Resistente ad Attacchi Elemental Force: Ghiaccio.' },
    { name:'Naturewalk: Legno', category:'Static', dpPerRank:1, maxRank:1, mechanic:'naturewalk', desc:'FONDAMENTA â +1 alla Stat scelta qui sotto (max 2 Ranks totali su elementi diversi). Consigliato Nature Spirits/Jungle Troopers (Foreste, Giungle, Paludi). Riduce di 1 la Durata di [POISON] su di sÃ© e puÃ² scoprire 1 informazione sull\'area circostante una volta al giorno. Resistente ad Attacchi Elemental Force: Legno.' },
    { name:'Naturewalk: Acciaio', category:'Static', dpPerRank:1, maxRank:1, mechanic:'naturewalk', desc:'FONDAMENTA â +1 alla Stat scelta qui sotto (max 2 Ranks totali su elementi diversi). Consigliato Metal Empire/Unknown (CiviltÃ , Fabbriche). Riduce di 1 la Durata di [HEAVY] su di sÃ© e comprende lo scopo di un oggetto artificiale al tocco, una volta al giorno. Resistente ad Attacchi Elemental Force: Acciaio.' },
    { name:'Naturewalk: Fulmine', category:'Static', dpPerRank:1, maxRank:1, mechanic:'naturewalk', desc:'FONDAMENTA â +1 alla Stat scelta qui sotto (max 2 Ranks totali su elementi diversi). Consigliato Virus Busters/Metal Empire (aree elettriche, temporalesche). Riduce di 1 la Durata di [DULL] su di sÃ© e puÃ² ricaricare un dispositivo elettronico una volta al giorno. Resistente ad Attacchi Elemental Force: Fulmine.' },
    { name:'Naturewalk: OscuritÃ ', category:'Static', dpPerRank:1, maxRank:1, mechanic:'naturewalk', desc:'FONDAMENTA â +1 alla Stat scelta qui sotto (max 2 Ranks totali su elementi diversi). Consigliato Unknown/Dark Area/Nightmare Soldiers (aree buie o "da Halloween"). Riduce di 1 la Durata di [DOOM] su di sÃ© e vede al buio/scarsa luce senza impedimenti. Resistente ad Attacchi Elemental Force: OscuritÃ .' },
    { name:'Naturewalk: Luce', category:'Static', dpPerRank:1, maxRank:1, mechanic:'naturewalk', desc:'FONDAMENTA â +1 alla Stat scelta qui sotto (max 2 Ranks totali su elementi diversi). Consigliato Virus Busters/Wind Guardians (terreni sacri/angelici). Riduce di 1 la Durata di [DISTRACT] su di sÃ© e crea una fonte di luce sul corpo pari al proprio Stage in spazi. Resistente ad Attacchi Elemental Force: Luce.' },
    { name:'Extra Movement: Flight', category:'Static', dpPerRank:1, maxRank:1, mechanic:'', desc:'FONDAMENTA (Movimento non gestito dal sito, applicare a discrezione del Master). -1 Movimento, ma capacitÃ  di volare pari al proprio Movimento. Perde questa Extra Movement se scende a metÃ  Ferite Massime o meno.' },
    { name:'Extra Movement: Digger', category:'Static', dpPerRank:1, maxRank:1, mechanic:'', desc:'FONDAMENTA (Movimento non gestito dal sito). PuÃ² scavare in terreno morbido (terra, neve, sabbia) pari al proprio Movimento. Non considera creature sottoterra come oscurate se sullo stesso terreno.' },
    { name:'Extra Movement: Swimmer', category:'Static', dpPerRank:1, maxRank:1, mechanic:'', desc:'FONDAMENTA (Movimento non gestito dal sito). Il nuoto usa il Movimento pieno. Non considera oscurato nulla per via della superficie dell\'acqua. PuÃ² Trattenere il Respiro un numero illimitato di volte a combattimento.' },
    { name:'Extra Movement: Wallclimber', category:'Static', dpPerRank:1, maxRank:1, mechanic:'', desc:'FONDAMENTA (Movimento non gestito dal sito). PuÃ² scalare superfici verticali pari al proprio Movimento (non soffitti).' },
    { name:'Extra Movement: Jumper', category:'Static', dpPerRank:1, maxRank:1, mechanic:'', desc:'FONDAMENTA (Movimento non gestito dal sito). Altezza e lunghezza di Salto pari al Movimento pieno.' },
    { name:'Accelerate', category:'Static', dpPerRank:1, maxRank:10, mechanic:'', desc:'FONDAMENTA â +1 Movimento per Rank (non gestito dal sito). Ranks massimi = RAM base del Digimon (non imposto dal tool, verificare a mano).' },
    { name:'Advanced Mobility: Flight', category:'Static', dpPerRank:1, maxRank:1, mechanic:'', desc:'FONDAMENTA â Richiede Stage 2+ e 1 Rank di Extra Movement: Flight. Non rallentato dai venti piÃ¹ forti; perde la velocitÃ  di volo solo a 1/4 delle Ferite Massime o meno (invece di metÃ ).' },
    { name:'Advanced Mobility: Digger', category:'Static', dpPerRank:1, maxRank:1, mechanic:'', desc:'FONDAMENTA â Richiede Stage 2+ e 1 Rank di Extra Movement: Digger. Scava anche materiali duri (pietra, ghiaccio, metalli morbidi) come Terreno Difficile, lasciando un tunnel; vista tremore a piena Gittata sottoterra.' },
    { name:'Advanced Mobility: Swimmer', category:'Static', dpPerRank:1, maxRank:1, mechanic:'', desc:'FONDAMENTA â Richiede Stage 2+ e 1 Rank di Extra Movement: Swimmer. Nuota senza essere rallentato da correnti forti, anche in liquidi diversi dall\'acqua (lava, metallo liquido) a discrezione del Master. Ignora penalitÃ  di vista sott\'acqua.' },
    { name:'Advanced Mobility: Wallclimber', category:'Static', dpPerRank:1, maxRank:1, mechanic:'', desc:'FONDAMENTA â Richiede Stage 2+ e 1 Rank di Extra Movement: Wallclimber. PuÃ² camminare sui soffitti, immune a [ROOT].' },
    { name:'Area Attack', category:'Attack', dpPerRank:1, maxRank:6, mechanic:'', desc:'Per Rank, applica un Tag Area diverso (max 1 per Attacco, Attacco diverso ogni volta): [T:BLAST] (solo RANGE, cerchio Base 1 spazio +metÃ  BIT), [T:BURST] (attorno all\'Attaccante, Base 1 spazio +metÃ  DOS, l\'Attaccante non Ã¨ bersaglio), [T:CONE] (cono 90Â°, Base 2 spazi +BIT), [T:LINE] (pilastro adiacente, Base 3 spazi +CPU, puÃ² rimbalzare sui muri), [T:PASS] (solo MELEE, carica in linea retta pari a RAM, 2 Azioni salvo [CHARGE]), [T:WAVE] (cubo adiacente, Base 2 spazi +metÃ  DOS). Un Attacco con Tag Area puÃ² sempre essere usato anche come Attacco singolo. Se usato come Area: Danno dopo Armor dimezzato (arrotondato su); Durata/Potenza degli Effetti [SUPPORT] ridotta di 1 (min 1 su Nemici, min 0 su Alleati). Non riduce il Danno Unalterable.' },
    { name:'Zoner: Friendly Fire', category:'Attack', dpPerRank:1, maxRank:1, mechanic:'', desc:'Richiede 1 Rank di Area Attack (scegli una sola opzione Zoner). Un Attacco Area [SUPPORT] con Effetto solo per Alleati puÃ² trattare i Nemici come bersagli [DAMAGE] e gli Alleati come [SUPPORT] nello stesso Attacco (l\'Effetto non tocca i Nemici). Incompatibile con Data Specialization: Status Warlord.' },
    { name:'Zoner: Bombardment', category:'Attack', dpPerRank:1, maxRank:1, mechanic:'', desc:'Richiede 1 Rank di Area Attack (scegli una sola opzione Zoner). Su un Attacco Area [DAMAGE] puoi scegliere di colpire tutti (Alleati e Nemici); se lo fai, il Danno non scende sotto la Stat Derivata usata per l\'Area o il Danno Totale dopo Armor (il minore dei due).' },
    { name:'Absolute Evasion', category:'Static', dpPerRank:2, maxRank:3, mechanic:'absoluteEvasion', desc:'Richiede Dodge base 4/8/12 (Rank max = Stage, fino a 3 a Ultimate+). Successi automatici garantiti sul tiro di Dodge pari ai Ranks (semplificazione: nel manuale si sottraggono dalla Pool base e si "consumano" quando subisci penalitÃ  da Dodge consecutivi nello stesso round â qui restano fissi, annotare a mano il consumo). Incompatibile con Data Specialization: Uncatchable Target.' },
    { name:'Fierce Soul', category:'Attack', dpPerRank:2, maxRank:1, mechanic:'', desc:'Sblocca Fierce Stance (selezionabile nel menu Stance): +Stage Damage automatico, -Stage a Movimento e Range (narrativo, non gestito dal sito). Se manchi un Attacco in questa Stance, puoi rifarlo subito sullo stesso bersaglio come Azione Libera (1 volta a round; il bersaglio subisce comunque la penalitÃ  Dodge dell\'Attacco iniziale; con Signature Move mantiene la Battery).' },
    { name:'Brave Heart', category:'Attack', dpPerRank:2, maxRank:1, mechanic:'', desc:'Sblocca Brave Stance (selezionabile nel menu Stance): +Stage Armor automatico, -Stage a Movimento (narrativo, non gestito dal sito). Se Intercedi in questa Stance e sopravvivi, ottieni [SHARPEN] con Potenza pari agli Alleati entro CPU spazi, fino al prossimo Attacco riuscito o fine Combattimento (registralo come Effetto).' },
    { name:'Ammo', category:'Attack', dpPerRank:1, maxRank:1, mechanic:'ammo', desc:'Un Attacco ignora la regola "una volta a round" â utilizzabile piÃ¹ volte per combattimento, fino a un numero di volte pari allo Stage.' },
    { name:'Combat Monster', category:'Static', dpPerRank:2, maxRank:3, mechanic:'combatMonster', desc:'Guadagna Resolve pari al danno subito (max Stage+2). Quando colpisce con un Attacco, tutto il Resolve si aggiunge al Danno e si azzera.' },
    { name:'Charge Attack', category:'Attack', dpPerRank:1, maxRank:1, mechanic:'', desc:'Un Attacco [MELEE] permette di Muoversi prima o dopo, nella stessa Azione (richiede Movimento non gestito dal sito).' },
    { name:'Heavy Recoil', category:'Attack', dpPerRank:1, maxRank:1, mechanic:'', desc:'Un Attacco [RANGE] ignora la penalitÃ  di Melee-adiacenza, ma ha un contraccolpo (dettagli a discrezione del Master).' },
    { name:'Substitute', category:'Trigger', dpPerRank:2, maxRank:1, mechanic:'', desc:'Se il Dodge fallisce, puoi tentare un Check RAM (TN 10+BIT dell\'Attaccante) per annullare il colpo, perdendo Caselle Ferita pari a Stage+1.' },
    { name:'Bullet Proof', category:'Static', dpPerRank:1, maxRank:1, mechanic:'', desc:'Attacchi ripetuti dello stesso Nemico nello stesso round subiscono una penalitÃ  crescente pari al tuo Stage.' },
    { name:'Point Blank', category:'Clash', dpPerRank:1, maxRank:1, mechanic:'', desc:'Puoi usare Attacchi [RANGE] come se fossero [MELEE] durante un Clash.' },
    { name:'Reach', category:'Clash', dpPerRank:1, maxRank:1, mechanic:'', desc:'Puoi Clashare da piÃ¹ lontano del normale (dettagli a discrezione del Master).' },
    { name:'Monster Strength', category:'Clash', dpPerRank:1, maxRank:1, mechanic:'monsterStrength', desc:'Puoi Lanciare o Muovere in Clash un avversario 2+ Size piÃ¹ grande di te.' },
    { name:'Titan Power', category:'Clash', dpPerRank:1, maxRank:1, mechanic:'', desc:'Puoi Lanciare avversari ancora piÃ¹ grandi rispetto a Monster Strength.' },
    { name:'Armor Piercing', category:'Attack', dpPerRank:2, maxRank:2, mechanic:'', desc:'L\'Attacco infligge Danno Unalterable extra (ignora Armor) pari ai Successi in eccesso, fino ai Ranks.' },
    { name:'Second Wind', category:'Trigger', dpPerRank:2, maxRank:3, mechanic:'', desc:'Rank max = Stage (fino a 3). Quando si tira l\'Iniziativa, ottieni usi pari ai Ranks. Ogni uso: Recovery Check come 1 Azione (max 1 volta a turno, non puoi Attaccare lo stesso turno). Gli usi non spesi si perdono a fine Combattimento, ma ogni uso non speso dÃ  Caselle Ferita extra al Recovery Check di fine Combattimento. Tracciare gli usi a mano.' },
    { name:'Pack Master', category:'Trigger', dpPerRank:2, maxRank:1, mechanic:'', desc:'Se il Digimon Ã¨ bersaglio di un Attacco, un Alleato adiacente puÃ² Intercedere come Azione Libera, una volta a round.' },
    { name:'Vital Energy', category:'Trigger', dpPerRank:1, maxRank:2, mechanic:'', desc:'Richiesta per Illness. Rank 1: una volta a round, ritira gli 1 usciti in un Check di Health. Rank 2: ritira anche i 2 sullo stesso tiro.' },
    { name:'System Boost', category:'Static', dpPerRank:2, maxRank:4, mechanic:'', desc:'Rank max = Stage (fino a 4). Per Rank, scegli una Stat Derivata diversa (RAM/CPU/BIT/DOS): +1 a quella Stat. Sconto di 1 DP al primo acquisto.' },
    { name:'Teleport', category:'Static', dpPerRank:3, maxRank:1, mechanic:'', desc:'Richiesta per Transporter. Teletrasporto istantaneo pari a Stage+2 spazi (serve linea di vista; +Ranks di Instinct, +1 con Data Optimization: Speedster â non gestito dal sito). Una volta a combattimento, come Azione Interrupt, puÃ² far fallire un Attacco nemico teletrasportandosi via (non attiva Contrattacchi), oppure come Azione di Clash per fuggire automaticamente dal Clash.' },
    { name:'Glamor', category:'Trigger', dpPerRank:1, maxRank:1, mechanic:'', desc:'Incompatibile con Illusionary Overlay. Come 2 Azioni, applica un\'illusione d\'aspetto a bersagli entro metÃ  BIT spazi con un Check BIT (Performance), penalitÃ  pari al numero di bersagli oltre il primo. Chi dubita puÃ² opporre un Check BIT pari al risultato per smascherarla. Dura finchÃ© non ne crei una nuova, sei portato a 0 Ferite, o perdi la Quality.' },
    { name:'Illusionary Overlay', category:'Trigger', dpPerRank:1, maxRank:1, mechanic:'', desc:'Come 2 Azioni entro range BIT, Check BIT (Manipulate) TN 8+Nemici in Combattimento, crea uno Shroud illusorio (con Naturewalk associato: chi non ce l\'ha Ã¨ Accecato dentro, chi Ã¨ fuori vede Oscurati i bersagli dentro) o Barriere illusorie (bloccano movimento/attacco finchÃ© non vengono scoperte). Un bersaglio puÃ² opporre un Check DOS (Awareness) TN pari ai Successi per smascherarla. TN sale di 3 a ogni uso successivo nello stesso Combattimento.' },
    { name:'Technician', category:'Static', dpPerRank:1, maxRank:1, mechanic:'', desc:'Richiesta per Firewall, Trojan, Data Scan. +3 ai Check per riparare/decifrare codice o macchinari, capire l\'ambiente digitale (incluso se corrotto), ricostruire strutture/macchinari nel Mondo Digitale.' },
    { name:'Firewall', category:'Static', dpPerRank:1, maxRank:1, mechanic:'', desc:'Richiede Technician. Il bonus di Technician sale a +6 (ulteriori +3) e si applica anche a: scovare intrusi che hackerano un\'area, proteggere/rinforzare codice che stai riparando, mantenere una Domain Control, resistere a effetti che alterano il proprio codice (es. Suppression).' },
    { name:'Trojan', category:'Static', dpPerRank:1, maxRank:1, mechanic:'', desc:'Richiede Technician. Il bonus di Technician sale a +6 (ulteriori +3) e si applica anche a: manipolare il codice per accedere ad aree protette, danneggiare/corrompere codice o macchinari (limiti decisi dal Master).' },
    { name:'Hide in Plain Sight', category:'Static', dpPerRank:1, maxRank:1, mechanic:'', desc:'Richiesta per Shade Cloak, Sneak Attack. Check Stealth come 1 Azione invece di 2 per Nascondersi (anche in vista di chi ti cerca), una volta a turno. Resti Nascosto finchÃ© non interagisci con un altro partecipante (es. attacchi).' },
    { name:'Shade Cloak', category:'Trigger', dpPerRank:1, maxRank:1, mechanic:'', desc:'Richiede Hide in Plain Sight. Quando fai il Check Stealth, con 1 Azione extra estendi lo stesso risultato/beneficio agli Alleati scelti entro RAM spazi, finchÃ© restano a quella distanza. Se un Alleato beneficiato interferisce con un altro Digimon, il beneficio finisce per tutti.' },
    { name:'Sneak Attack', category:'Attack', dpPerRank:1, maxRank:1, mechanic:'', desc:'Richiede Hide in Plain Sight. Applica il Tag [SNEAK] a un Attacco (su [RANGE] richiede 1 Azione extra). Se attacchi un bersaglio da cui sei Nascosto e non ti ha rilevato, +RAM Accuracy su quell\'Attacco.' },
    { name:'Simplified Strike', category:'Attack', dpPerRank:2, maxRank:1, mechanic:'', desc:'Applica il Tag [SIMPLE] a un Attacco: quell\'Attacco costa 1 Azione in meno (minimo 1), incluso per costi extra come Called Shot o [T:DRAIN] potenziato. Non riduce il costo di Azione degli Effetti d\'Attacco.' },
    { name:'Watchful Hunter', category:'Trigger', dpPerRank:1, maxRank:1, mechanic:'', desc:'Una volta a round, Check DOS (Awareness) come Azione Libera nel proprio turno; ignora le penalitÃ  da Oscurato (non da Accecato). Come Azione Libera (o 2 Azioni) puoi mirare un Nemico con Check DOS (Awareness) TN 12+RAM bersaglio: su Successo +2 Accuracy su [MELEE] contro quel bersaglio fino al tuo prossimo turno (trattato come non Oscurato); su Successo Critico il bonus vale anche per [RANGE]; su Fallimento Critico consideri il bersaglio Oscurato fino al tuo prossimo turno.' },
    { name:'Giant Hijacker', category:'Trigger', dpPerRank:1, maxRank:1, mechanic:'', desc:'Solo contro Nemici di Size maggiore di almeno 1. Come 1 Azione da adiacente, Check CPU (Athletics) TN 10+RAM bersaglio-CPU proprio. Successo: ti aggrappi e ti muovi con lui (non Ã¨ un Clash, entrambi mantengono le proprie Azioni). Successo Critico: la TN per scrollarti di dosso sale di 3. Fallimento Critico: subisci [SLOW 2] fino al tuo prossimo turno. Il bersaglio usa 1 Azione con Check CPU TN 10+tuo RAM per scrollarti via; tu puoi staccarti in ogni momento come Azione Libera.' },
    { name:'Horde Duelist', category:'Trigger', dpPerRank:2, maxRank:1, mechanic:'', desc:'Incompatibile con Aggressive Flank. Solo se sei adiacente esclusivamente a Nemici: come 1 Azione, Check BIT (Survival) TN 10+Stage piÃ¹ alto tra i Nemici adiacenti+numero di Nemici adiacenti (i Minion non contano). Successo: +BIT Accuracy sugli Attacchi contro Nemici adiacenti privi di Alleati adiacenti a loro volta, fino al tuo prossimo turno (finisce prima se un Alleato si avvicina). Successo Critico: riottieni l\'Azione spesa. Fallimento Critico: non puoi riusarla fino a fine Combattimento.' },
    { name:'Exposing Hold', category:'Clash', dpPerRank:2, maxRank:1, mechanic:'', desc:'Quando vinci un Check per controllare un Clash, puoi scegliere di attivare questa Quality fino al tuo prossimo tentativo di controllo: non puoi usare l\'Azione Pin, ma l\'Avversario riduce il Danno subito da Attacchi esterni solo di metÃ  del proprio CPU (non della somma dei CPU) â stessa logica per [SUPPORT] con RAM.' },
    { name:'Slippery', category:'Clash', dpPerRank:1, maxRank:1, mechanic:'', desc:'Quando un Nemico tenta di iniziare un Clash con te, o tu tenti di Fuggire da un Clash, puoi tirare RAMx2 invece del Check CPU+RAM. Se il tuo risultato supera quello dell\'iniziatore, il tentativo di Clash finisce subito e l\'iniziatore non puÃ² ritentare fino al round successivo. Se Ã¨ inferiore, l\'iniziatore controlla subito il Clash.' },
    { name:'Fastball', category:'Clash', dpPerRank:1, maxRank:1, mechanic:'', desc:'Come 1 Azione, lancia un Alleato volontario di Size inferiore alla tua (nessun limite di Size con Monster Strength) entro la tua portata di Clash. Se l\'Alleato ha un Attacco [CHARGE] e viene lanciato su un Nemico, puÃ² fare quell\'Attacco come Azione Interrupt senza muoversi tu. Con 2 Azioni invece di 1, l\'Alleato riceve 1 Azione extra (l\'Interrupt puÃ² diventare gratuito) o puoi usare [T:PASS] per colpire piÃ¹ bersagli nel lancio.' },
    { name:'Counterattack', category:'Trigger', dpPerRank:1, maxRank:2, mechanic:'', desc:'Richiesta per Counterblow, Cross Counter, Return Fire, Instant Counter. Se un Nemico manca un Attacco contro di te, puoi usare un\'Azione Interrupt per attaccarlo (Attacco da 1 Azione a scelta); il bersaglio subisce una penalitÃ  a Dodge pari al tuo Stage. Utilizzabile un numero di volte a Combattimento pari ai Ranks. Non puoi contrattaccare come Area Attack.' },
    { name:'Aggressive Flank', category:'Attack', dpPerRank:1, maxRank:1, mechanic:'', desc:'Richiesta per Coordinated Assault. Incompatibile con Horde Duelist. +RAM (o Stage se maggiore) Accuracy quando sei adiacente a un Alleato, o quando tu e un Alleato siete entrambi adiacenti allo stesso Nemico bersaglio.' },
    { name:'Basic Effect: Fear', category:'Attack', dpPerRank:1, maxRank:1, mechanic:'', desc:'CAP. 4.08 â Sblocca l\'uso del Tag [FEAR] su un Attacco [SUPPORT]. Senza questa Quality (o senza pagare il suo DP), il Master puÃ² vietare la selezione dell\'Effetto sull\'Attacco.' },
    { name:'Basic Effect: Slow', category:'Attack', dpPerRank:1, maxRank:1, mechanic:'', desc:'CAP. 4.08 â Sblocca l\'uso del Tag [SLOW] su un Attacco [SUPPORT].' },
    { name:'Basic Effect: Keen', category:'Attack', dpPerRank:1, maxRank:1, mechanic:'', desc:'CAP. 4.08 â Sblocca l\'uso del Tag [KEEN] su un Attacco [SUPPORT].' },
    { name:'Basic Effect: Swift', category:'Attack', dpPerRank:1, maxRank:1, mechanic:'', desc:'CAP. 4.08 â Sblocca l\'uso del Tag [SWIFT] su un Attacco [SUPPORT].' },
    { name:'Basic Effect: Cleanse', category:'Attack', dpPerRank:1, maxRank:1, mechanic:'', desc:'CAP. 4.08 â Sblocca l\'uso del Tag [CLEANSE] su un Attacco [SUPPORT] (riduce la Durata degli Effetti sul bersaglio).' },
    { name:'Basic Effect: Root', category:'Attack', dpPerRank:1, maxRank:1, mechanic:'', desc:'CAP. 4.08 â Sblocca l\'uso del Tag [ROOT] su un Attacco [SUPPORT].' },
    { name:'Basic Effect: Taunt', category:'Attack', dpPerRank:1, maxRank:1, mechanic:'', desc:'CAP. 4.08 â Sblocca l\'uso del Tag [TAUNT] su un Attacco [SUPPORT].' },
    { name:'Basic Effect: Push', category:'Attack', dpPerRank:1, maxRank:1, mechanic:'', desc:'CAP. 4.08 â Sblocca l\'uso del Tag [PUSH] su un Attacco [SUPPORT].' },
    { name:'Basic Effect: Pull', category:'Attack', dpPerRank:1, maxRank:1, mechanic:'', desc:'CAP. 4.08 â Sblocca l\'uso del Tag [PULL] su un Attacco [SUPPORT].' },
    { name:'Advanced Effect: Confuse', category:'Attack', dpPerRank:2, maxRank:1, mechanic:'', desc:'STAGE 2+ â Sblocca l\'uso del Tag [CONFUSE] su un Attacco [SUPPORT].' },
    { name:'Advanced Effect: Distract', category:'Attack', dpPerRank:2, maxRank:1, mechanic:'', desc:'STAGE 2+ â Sblocca l\'uso del Tag [DISTRACT] su un Attacco [SUPPORT].' },
    { name:'Advanced Effect: Dull', category:'Attack', dpPerRank:2, maxRank:1, mechanic:'', desc:'STAGE 2+ â Sblocca l\'uso del Tag [DULL] su un Attacco [SUPPORT].' },
    { name:'Advanced Effect: Frail', category:'Attack', dpPerRank:2, maxRank:1, mechanic:'', desc:'STAGE 2+ â Sblocca l\'uso del Tag [FRAIL] su un Attacco [SUPPORT].' },
    { name:'Advanced Effect: Sturdy', category:'Attack', dpPerRank:2, maxRank:1, mechanic:'', desc:'STAGE 2+ â Sblocca l\'uso del Tag [STURDY] su un Attacco [SUPPORT].' },
    { name:'Advanced Effect: Sharpen', category:'Attack', dpPerRank:2, maxRank:1, mechanic:'', desc:'STAGE 2+ â Sblocca l\'uso del Tag [SHARPEN] su un Attacco [SUPPORT].' },
    { name:'Advanced Effect: Nimble', category:'Attack', dpPerRank:2, maxRank:1, mechanic:'', desc:'STAGE 2+ â Sblocca l\'uso del Tag [NIMBLE] su un Attacco [SUPPORT].' },
    { name:'Advanced Effect: Exploit', category:'Attack', dpPerRank:2, maxRank:1, mechanic:'', desc:'STAGE 2+ â Sblocca l\'uso del Tag [EXPLOIT] su un Attacco [SUPPORT].' },
    { name:'Advanced Effect: Burn', category:'Attack', dpPerRank:2, maxRank:1, mechanic:'', desc:'STAGE 2+ â Sblocca l\'uso del Tag [BURN] (Danno) su un Attacco [DAMAGE][SUPPORT].' },
    { name:'Advanced Effect: Poison', category:'Attack', dpPerRank:2, maxRank:1, mechanic:'', desc:'STAGE 2+ â Sblocca l\'uso del Tag [POISON] (Danno) su un Attacco [DAMAGE][SUPPORT].' },
    { name:'Advanced Effect: Shield', category:'Attack', dpPerRank:2, maxRank:1, mechanic:'', desc:'STAGE 2+ â Sblocca l\'uso del Tag [SHIELD] su un Attacco [SUPPORT] (garantisce Caselle Ferita Temporanee).' },
    { name:'Master Effect: Fury', category:'Attack', dpPerRank:3, maxRank:1, mechanic:'', desc:'STAGE 4+/ULTIMATE â Sblocca l\'uso del Tag [FURY] su un Attacco [SUPPORT] (Accuracy e Damage insieme).' },
    { name:'Master Effect: Pacify', category:'Attack', dpPerRank:3, maxRank:1, mechanic:'', desc:'STAGE 4+/ULTIMATE â Sblocca l\'uso del Tag [PACIFY] su un Attacco [SUPPORT] (Accuracy e Damage insieme).' },
    { name:'Master Effect: Debilitate', category:'Attack', dpPerRank:3, maxRank:1, mechanic:'', desc:'STAGE 4+/ULTIMATE â Sblocca l\'uso del Tag [DEBILITATE] su un Attacco [SUPPORT] (riduce tutte le Stat tranne Health).' },
    { name:'Master Effect: Bastion', category:'Attack', dpPerRank:3, maxRank:1, mechanic:'', desc:'STAGE 4+/ULTIMATE â Sblocca l\'uso del Tag [BASTION] su un Attacco [SUPPORT] (le 4 Stat di combattimento insieme; Ã¨ anche l\'Effetto dato da Battle Cry).' },
    { name:'Master Effect: Daring', category:'Attack', dpPerRank:3, maxRank:1, mechanic:'', desc:'STAGE 4+/ULTIMATE â Sblocca l\'uso del Tag [DARING] su un Attacco [SUPPORT] (Accuracy e Armor insieme).' },
    { name:'Huge Power', category:'Trigger', dpPerRank:1, maxRank:2, mechanic:'', desc:'Rank 1: una volta a round, ritira gli 1 usciti in un tiro di Accuracy. Rank 2: ritira anche i 2 sullo stesso tiro. Non si applica ai dadi Bonus da Azioni del Tamer.' },
    { name:'Combat Awareness', category:'Static', dpPerRank:1, maxRank:3, mechanic:'', desc:'Rank 1: Check Awareness come 1 Azione invece di 2; +Ranks a Iniziativa; +Ranks ad Accuracy e Dodge nel primo Round di Combattimento. Rank 2: +Ranks anche a Movimento nel primo Round (non gestito dal sito). Rank 3 (variante): puoi scambiare la tua Iniziativa con quella di un Alleato consenziente quando viene tirata.' },
    { name:'Battle Cry', category:'Trigger', dpPerRank:3, maxRank:1, mechanic:'', desc:'Come 1 Azione, Check DOS (Bravery) TN 10+somma degli Stage dei nemici in combattimento (min 1 a nemico, il Master puÃ² aumentarla per i Boss). Tu e gli Alleati entro DOS spazi ottenete [BASTION] (bonus ad Accuracy/Damage/Dodge/Armor) per 1 round: Potenza 1 su Fallimento, pari al tuo Stage su Successo. Su Successo Critico riottieni l\'Azione spesa. Ogni uso successivo nello stesso Combattimento alza la TN di 6.' },
    { name:'Resistance', category:'Static', dpPerRank:2, maxRank:3, mechanic:'resistance', desc:'Riduce la Potenza degli Effetti negativi subiti pari ai Ranks (min. 1).' },
    { name:'Algorithm', category:'Static', dpPerRank:1, maxRank:2, mechanic:'', desc:'STAGE 2+ â Ignora l\'incompatibilitÃ  tra Weapon e Instinct: puoi comprare Ranks in entrambi, limitati dai Ranks di questa Quality (Rank 1 â 1 Rank in ciascuno; Rank 2, solo da Stage 3+ â 2 Ranks in ciascuno). Richiesta per Pure Digizoid Weaponry e Pure Overwrite. Incompatibile con 3 Ranks di Weapon, 3 Ranks di Instinct, altri Digizoid Weaponry o Gain Force.' },
    { name:'Sprint', category:'Static', dpPerRank:2, maxRank:1, mechanic:'', desc:'STAGE 2+ â Il Digimon aggiunge il proprio RAM al Movimento (non gestito dal sito, applicare a discrezione del Master).' },
    { name:'Data Specialization: Fistful of Force', category:'Attack', dpPerRank:2, maxRank:1, mechanic:'', desc:'STAGE 4+ â Richiede Data Optimization: Close Combat. 1 Rank gratuito in Area Attack. Gli Attacchi Area [MELEE] usano la Dimensione Massima e i bersagli nella Dimensione Base di un\'Area [DAMAGE][MELEE] non dimezzano il Danno dopo l\'Armor.' },
    { name:'Data Specialization: Flurry', category:'Attack', dpPerRank:2, maxRank:1, mechanic:'', desc:'STAGE 4+ â Richiede Data Optimization: Close Combat. Un\'Azione al proprio turno puÃ² produrre un ulteriore Attacco [MELEE][DAMAGE], ignorando la regola "un Attacco a round" (senza altri Tag extra).' },
    { name:'Data Specialization: Mobile Artillery', category:'Attack', dpPerRank:2, maxRank:1, mechanic:'', desc:'STAGE 4+ â Richiede Data Optimization: Ranged Striker. 1 Rank gratuito in Area Attack. I bersagli nella Dimensione Base di un\'Area [RANGE] non dimezzano il Danno dopo l\'Armor (non si applica se ha anche un Tag Effetto). Con 1 Rank di Naturewalk, puÃ² spendere 1 Azione extra per rendere l\'area Terreno Difficile dell\'Elemento scelto fino al proprio prossimo turno.' },
    { name:'Data Specialization: Sniper', category:'Static', dpPerRank:2, maxRank:1, mechanic:'', desc:'STAGE 4+ â Richiede Data Optimization: Ranged Striker. +3 Range e Limite Effettivo. PuÃ² usare l\'Azione Called Shot (opzione Sharpshooter) illimitatamente a combattimento, con penalitÃ  ad Accuracy dimezzata. Ignora il bonus di Uncatchable Target avversario (non quello di Data Optimization: Speedster).' },
    { name:'Data Specialization: Try Something', category:'Static', dpPerRank:2, maxRank:1, mechanic:'', desc:'STAGE 4+ â Richiede Data Optimization: Warden. 1 Rank gratuito in Counterattack. Un Attacco fuori dal proprio turno con Azione Interrupt (non Hold Action) ignora la regola "un Attacco a round".' },
    { name:'Data Specialization: True Guardian', category:'Static', dpPerRank:2, maxRank:1, mechanic:'', desc:'STAGE 4+ â Richiede Data Optimization: Warden. Quando Intercede, guadagna Armor pari alla distanza percorsa per Intercedere. Se l\'Attacco intercettato aveva Tag Area, gli Alleati dietro il Digimon riducono il Danno subito del proprio CPU (min 1) e negano i Tag Effetto. Se ha speso 2 Azioni per Intercedere prima del proprio turno, guadagna 1 Azione quel turno.' },
    { name:'Data Specialization: Power Throw', category:'Clash', dpPerRank:2, maxRank:1, mechanic:'', desc:'STAGE 4+ â Richiede Data Optimization: Brawler. Fastball gratuita. Quando lancia un bersaglio (Alleato o Nemico) in Clash, sceglie: distanza raddoppiata, +CPU ad Accuracy se lancia su un Nemico, o +metÃ  CPU a Danno se non lancia su un Nemico. Un Alleato lanciato non subisce Danno dal lancio.' },
    { name:'Data Specialization: Wrestlemania', category:'Clash', dpPerRank:2, maxRank:1, mechanic:'wrestlemania', desc:'STAGE 4+ â Richiede Data Optimization: Brawler. In Clash, sblocca l\'Azione Finisher: dopo un Attacco riuscito, tira CPU o BIT (TN 10+Stage) per danno bonus, poi il Clash finisce.' },
    { name:'Data Specialization: Hit and Run', category:'Attack', dpPerRank:2, maxRank:1, mechanic:'', desc:'STAGE 4+ â Richiede Data Optimization: Speedster. Charge Attack o Heavy Recoil gratuita. Con Tag [CHARGE]/[RECOIL] non Ã¨ vincolato a muoversi in linea retta; muovendosi almeno 2 spazi prima dell\'Attacco, aggiunge RAM al Danno. Non puÃ² essere colpito con Punishing Strike mentre lo usa.' },
    { name:'Data Specialization: Uncatchable Target', category:'Static', dpPerRank:2, maxRank:1, mechanic:'', desc:'STAGE 4+ â Richiede Data Optimization: Speedster. +3 Dodge, nessuna penalitÃ  crescente se attaccato piÃ¹ volte nello stesso round (Coordinated Assault e Sniper avversari ignorano questo bonus). Incompatibile con Absolute Evasion.' },
    { name:'Data Specialization: Status Warlord', category:'Attack', dpPerRank:2, maxRank:1, mechanic:'', desc:'STAGE 4+ â Richiede Data Optimization: Effect Warrior. Sconto una tantum di 1 DP su un Effetto d\'Attacco. Se fa un Attacco [DAMAGE] senza Tag Effetto nel proprio turno, puÃ² fare anche un Attacco [SUPPORT] lo stesso turno ignorando la regola "un Attacco a round" (e viceversa). Incompatibile con Zoner: Friendly Fire, Dark Emblem, Holy Ward.' },
    { name:'Data Specialization: Code Wizard', category:'Static', dpPerRank:2, maxRank:1, mechanic:'', desc:'STAGE 4+ â Richiede Data Optimization: Effect Warrior. La Durata massima di tutti gli Effetti creati aumenta di 1. PuÃ² usare Called Shot (opzione Focused) illimitatamente a combattimento con penalitÃ  dimezzata. Ignora il requisito del Tag [DAMAGE] per alcuni Effetti (es. [BURN]).' },
    { name:'Data Specialization: Tactical Adaptation', category:'Attack', dpPerRank:2, maxRank:1, mechanic:'', desc:'STAGE 4+ â Richiede Data Optimization: Variable. Guadagna una Stance Quality gratis, oppure 2 Ranks gratuiti di Mode Change. All\'inizio dell\'Iniziativa puÃ² fare Change Stance come Azione Libera; sul proprio turno puÃ² farlo come Azione Libera (o Mode Change se disponibile).' },
    { name:'Data Specialization: Supreme Code', category:'Static', dpPerRank:2, maxRank:1, mechanic:'supremeCode', desc:'STAGE 4+ â Richiede Data Optimization: Variable. +1 automatico ad Accuracy, Damage, Dodge e Armor. +1 anche a Health, da applicare manualmente a Ferite Massime.' },
    { name:'Prodigious Skill', category:'Static', dpPerRank:1, maxRank:4, mechanic:'', desc:'Rank max = Stage (fino a 4). Scegli una Skill del Tamer (es. Feats of Strength, Stealth, Awareness): +1+2ÃStat Derivata associata (CPU per Skill di Corpo, RAM per AgilitÃ , BIT per Intelligenza/Carisma, DOS per VolontÃ ) sui Check di quella Skill, invece della sola Stat Derivata.' },
    { name:'Mighty Blow', category:'Attack', dpPerRank:3, maxRank:1, mechanic:'', desc:'STAGE 2+ â Applica [MIGHTY] a un Attacco [MELEE][DAMAGE]. Se infligge almeno 2 Danno dopo Armor (no Unalterable), Check CPU (Feats of Strength) TN 10+CPU bersaglio: Successo â [STUN] al bersaglio; Successo Critico â anche +2 Danno extra; Fallimento Critico â -1 Danno (min 1). La TN sale di 3 a ogni uso successivo (salvo Signature Move). Compatibile con altri Effetti tranne quelli di Danno.' },
    { name:'Precise Focus', category:'Attack', dpPerRank:1, maxRank:1, mechanic:'', desc:'STAGE 2+ â Applica [FOCUS] a un Attacco [RANGE]: ogni punto di Danno toglie 2 Caselle Ferita Temporanee invece di 1. Se usato con 1 Azione extra (Bolster, Called Shot, ecc.), Check RAM (Precision) TN 12+RAM bersaglio: Successo +3 Accuracy, Successo Critico +5 Accuracy, Fallimento Critico nessun bonus. Nessun beneficio su Area Attack.' },
    { name:'Feint Attack', category:'Attack', dpPerRank:2, maxRank:1, mechanic:'', desc:'STAGE 2+ â Applica [T:FEINT] a un Attacco [MELEE]. Attivabile alla dichiarazione: l\'Attacco subisce una penalitÃ  a Danno pari al tuo Stage, poi Check BIT (Manipulate) TN 6+BIT bersaglio; su Successo dimezzi il Dodge (o l\'Armor) del bersaglio per quell\'Attacco. Incompatibile con Counterattack.' },
    { name:'Counterblow', category:'Attack', dpPerRank:1, maxRank:1, mechanic:'', desc:'STAGE 2+ â Richiede 1 Rank di Counterattack. Incompatibile con Cross Counter, Return Fire. Applica [COUNTER] a un Attacco [MELEE], usabile solo con Counterattack. Quando attivi Counterattack, scegli: dimezzare il Dodge del bersaglio, dimezzare il suo Armor, oppure spendere 2 usi di Counterattack per entrambi.' },
    { name:'Cross Counter', category:'Attack', dpPerRank:2, maxRank:1, mechanic:'', desc:'STAGE 2+ â Richiede 1 Rank di Counterattack. Incompatibile con Counterblow, Combat Monster, Return Fire, Instant Counter. Applica [COUNTER] a un Attacco [MELEE], usabile solo con Counterattack. Puoi attivare Counterattack anche se il Nemico colpisce (non solo se manca), quando subisci almeno Stage+1 Danno dopo Armor da un suo [MELEE]. Se attivato durante un\'Intercede, il bersaglio non dimezza il Dodge.' },
    { name:'Return Fire', category:'Attack', dpPerRank:2, maxRank:1, mechanic:'', desc:'STAGE 2+ â Richiede 1 Rank di Counterattack. Incompatibile con Counterblow, Cross Counter. Applica [COUNTER] a un Attacco [RANGE], usabile solo con Counterattack. Se Counterattack scatta da un Attacco [RANGE], ignori le penalitÃ  per attaccare entro il Limite Effettivo.' },
    { name:'Instant Counter', category:'Trigger', dpPerRank:1, maxRank:1, mechanic:'', desc:'STAGE 2+ â Richiede 1 Rank di Counterattack. Incompatibile con Cross Counter. Puoi usare l\'Azione Interrupt di Counterattack come Azione Libera, una volta a Combattimento.' },
    { name:'Lifesteal', category:'Attack', dpPerRank:1, maxRank:1, mechanic:'', desc:'STAGE 2+ â Applica [T:DRAIN] a un Attacco (non su Attacchi con Tag Effetto). Cura Caselle Ferita pari al Danno inflitto, fino a un massimo di DOS (+Stage extra spendendo 1 Azione in piÃ¹). Su Area Attack usa il Danno complessivo per calcolare la cura.' },
    { name:'Reload', category:'Trigger', dpPerRank:1, maxRank:1, mechanic:'', desc:'STAGE 2+ â Richiede Ammo. Come 2 Azioni, Check BIT (Precision) TN 18-RAM per riottenere l\'uso dell\'Attacco [AMMO]: Successo lo riottieni, Successo Critico riottieni anche 1 Azione, Fallimento Critico non puoi piÃ¹ riprovare in questo Combattimento. La TN sale di 3 a ogni uso riuscito successivo.' },
    { name:'Brace', category:'Trigger', dpPerRank:2, maxRank:1, mechanic:'', desc:'STAGE 2+ â Quando subisci Danno da un Attacco, Azione Interrupt per Check CPU (Endurance) TN 10+Danno dopo Armor: Successo dimezza ulteriormente il Danno, Successo Critico porta a 0 se scenderebbe a 1, Fallimento Critico +1 Danno. Non incide sul Danno Unalterable. La TN sale di 3 a ogni uso (e ancora +3 se usato su un Attacco da cui hai Interceduto).' },
    { name:'Savagery', category:'Trigger', dpPerRank:1, maxRank:1, mechanic:'', desc:'STAGE 2+ â Richiede Combat Monster. Una volta a round, quando dichiari un Attacco puoi attivarla: Check CPU (Endurance) TN 15-DOS (dettagli su successo/fallimento a discrezione del Master in base al testo completo della Quality).' },
    { name:'Assured Destruction', category:'Trigger', dpPerRank:1, maxRank:1, mechanic:'', desc:'STAGE 2+ â Richiede Combat Monster. Quando attacchi un Nemico, puoi convertire qualsiasi quantitÃ  di Resolve in dadi extra sulla Pool di Accuracy invece che in Danno bonus, solo per quell\'Attacco.' },
    { name:'Focused Resistance', category:'Trigger', dpPerRank:1, maxRank:1, mechanic:'', desc:'STAGE 2+ â Richiesta per Immunity. Quando subiresti un Effetto da un Attacco, Azione Interrupt per raddoppiare la tua Resistenza contro quell\'Effetto in arrivo.' },
    { name:'Immunity', category:'Trigger', dpPerRank:2, maxRank:1, mechanic:'', desc:'STAGE 2+ â Richiede Focused Resistance. La tua Resistenza puÃ² ridurre la Potenza di un Effetto in arrivo sotto 2; se scenderebbe a 0, l\'Effetto Ã¨ negato del tutto. L\'Azione Resist conta come se stessi usando un\'Azione extra.' },
    { name:'Element Master', category:'Trigger', dpPerRank:2, maxRank:1, mechanic:'', desc:'STAGE 2+ â Richiede 1 Rank di Naturewalk. Richiesta per Domain Control, Elemental Myriad, Adaptive/Altered Element. Puoi manipolare liberamente fonti naturali del tuo Elemento e produrre effetti unici non di combattimento (a discrezione del Master, eventuale Check DOS Fortitude per usi difficili). Ignora del tutto gli Attacchi Elemental Force dello stesso Elemento e dimezza il Danno Unalterable da Terreno Pericoloso dello stesso Elemento.' },
    { name:'Domain Control', category:'Trigger', dpPerRank:1, maxRank:1, mechanic:'', desc:'STAGE 2+ â Richiede Element Master. Incompatibile con Elemental Myriad. Come 2 Azioni (serve una fonte dell\'Elemento, o Check DOS Fortitude TN 10+2ÃStage con Conjurer), crea una Domain con Durata ed effetto raggio pari a Stage+1 che ti segue; applica un effetto legato all\'Elemento scelto (vedi tabella Domini nel manuale) a Nemici o Alleati nell\'area a ogni tuo turno. Un Digimon con lo stesso Naturewalk puÃ² ignorare l\'effetto.' },
    { name:'Inspiring Guidance', category:'Attack', dpPerRank:1, maxRank:3, mechanic:'', desc:'Richiede 1 Rank di Basic/Advanced/Master Effect. Applica [GUIDING] a un Attacco [SUPPORT] con Effetto positivo (Ranks max = DP speso sull\'Effetto collegato). Se l\'Effetto positivo va a segno, Check BIT (Persuasion) TN 10+Stage: su Successo il bersaglio ottiene una riserva di dadi "Guiding" (pari ai Ranks, +1 su Successo Critico) da aggiungere a qualsiasi Pool Check finchÃ© durano o finchÃ© dura l\'Effetto. Solo un Digimon alla volta puÃ² beneficiarne.' },
    { name:'Overclock', category:'Trigger', dpPerRank:1, maxRank:1, mechanic:'', desc:'Devi anche comprare un Effetto positivo che usa una Stat Derivata del lanciatore (pagandolo normalmente); quell\'Effetto si applica a questa Quality invece che a un Attacco, e non puoi piÃ¹ comprarlo separatamente. Come 1 Azione, Check con la Stat Derivata associata TN 10+Stage: Successo â ti applichi l\'Effetto (con la tua Potenza) fino al tuo prossimo turno; Successo Critico â dura 3 round.' },
    { name:'Overdrive', category:'Trigger', dpPerRank:2, maxRank:1, mechanic:'', desc:'STAGE 2+ â Come Azione Libera una volta a round, Check CPU (Athletics) TN 15-RAM: Successo â [HASTE] per quel turno, ma -2 Dodge per 1 round a fine turno (per la fatica); Successo Critico â nessuna penalitÃ . La TN sale di 6 a ogni uso successivo nello stesso Combattimento.' },
    { name:'Data Scan', category:'Trigger', dpPerRank:1, maxRank:1, mechanic:'', desc:'STAGE 2+ â Richiede Technician. Come 1 Azione su un Nemico visibile, Check BIT (Knowledge) TN 10+DOS bersaglio: su Successo scopri una delle seguenti informazioni a scelta (Ferite attuali/max, Stat Core dopo le Qualities, Stat Derivate, Movimento/Range, elenco Core Qualities, o un Attacco con tutti i Tag â puoi ripetere la scelta piÃ¹ volte pagando di nuovo); Successo Critico ne scopri una in piÃ¹. Fallimento Critico non puoi riprovare fino a fine Combattimento.' },
    { name:'Adaptive Element', category:'Static', dpPerRank:1, maxRank:1, mechanic:'', desc:'Richiede Element Master. Incompatibile con Elemental Myriad, Altered Element. Quando prendi Domain Control, invece di un solo Dominio puoi scegliere entrambi i Domini del tuo Elemento e attivare quello che preferisci ogni volta (solo uno alla volta).' },
    { name:'Altered Element', category:'Static', dpPerRank:1, maxRank:1, mechanic:'', desc:'Richiede Element Master. Incompatibile con Elemental Myriad, Adaptive Element. Quando prendi Domain Control, puoi scegliere qualsiasi opzione di Dominio invece di essere limitato al tuo Elemento di Naturewalk (resta comunque considerato il tuo Elemento).' },
    { name:'Elemental Myriad', category:'Static', dpPerRank:1, maxRank:4, mechanic:'', desc:'Richiede Element Master. Incompatibile con Domain Control, Adaptive/Altered Element. Rank max per Stage (0-1:0, 2:1, 3:2, 4+:4). Per ogni Rank qui, puoi comprare 2 Ranks extra di Naturewalk (li paghi comunque normalmente), ma il bonus di Naturewalk a una singola Stat non supera +3 in totale.' },
    { name:'Conjurer', category:'Trigger', dpPerRank:3, maxRank:1, mechanic:'', desc:'STAGE 2+ â Richiesta per Evoker. Incompatibile con Summoner, Combat Monster, Positive Reinforcement. Risorsa "Creation Limit" = BIT+Stage. Con l\'Azione Conjure Objects (2 Azioni) crei oggetti/strutture (1 spazio cubico ciascuno, decisi alla presa della Quality) entro il tuo Range, fino al Creation Limit; non tirano Dodge, vengono distrutti da un Attacco che infligge Danno, e il costo torna disponibile quando distrutti. Non puoi riusare l\'Azione per 1 round dopo averla usata.' },
    { name:'Summoner', category:'Trigger', dpPerRank:1, maxRank:3, mechanic:'', desc:'STAGE 2+ â Richiesta per Evoker. Incompatibile con Conjurer, Combat Monster, Positive Reinforcement, Showstopper. Risorsa "Mastery" = BIT+2ÃRanks (+ Ranks di Conjurer se presente). Scegli un Tipo di Minion (Infantry/Protector/Recon/Volatile, ognuno con costo Mastery, Size e bonus propri â vedi manuale 5.06/6.0x per la tabella completa). Azione Summon (1 o 2 Azioni per metÃ /piena Mastery) crea Minion con Accuracy/Damage/Movimento basati sul tuo BIT e Ferite pari a DOSÃ2, senza Armor/Dodge, solo Attacchi [MELEE]. Azione Command Minion (1-2 Azioni) li fa Muovere/Attaccare/Aiutare.' },
    { name:'Evoker', category:'Static', dpPerRank:1, maxRank:1, mechanic:'', desc:'Richiede Conjurer o Summoner. Puoi usare le Azioni Conjure e Summon con le stesse Azioni (Creation Limit/Mastery condivisi tra Oggetti e Minion).' },
    { name:'Hybrid Drive', category:'Static', dpPerRank:1, maxRank:1, mechanic:'', desc:'STAGE 4+ â Richiede Data Optimization. Puoi comprare una Data Specialization aggiuntiva a scelta libera, indipendentemente dalla tua Data Optimization.' },
    { name:'Coordinated Assault', category:'Trigger', dpPerRank:2, maxRank:1, mechanic:'', desc:'STAGE 3+ â Richiede Aggressive Flank. Come 1 Azione, Check BIT (Precision) TN 10+RAM bersaglio per applicare "Marchiato" a un singolo bersaglio (Successo Critico: anche -1 Dodge immediato). Il bersaglio Marchiato subisce una penalitÃ  Dodge pari al tuo Stage (invece di -1) per ogni Attacco oltre il primo che lo colpisce nel round. Un solo bersaglio attivo alla volta; se muore, puoi ri-marchiare come Azione Interrupt gratuita. Incide su Uncatchable Target/Absolute Evasione avversari, non su Speedster.' },
    { name:'Berserker', category:'Static', dpPerRank:1, maxRank:1, mechanic:'', desc:'STAGE 3+ â Richiede Combat Monster. Richiesta per Boiling Blood. Il tetto massimo di Resolve diventa StageÃ2 (invece di Stage+2).' },
    { name:'Boiling Blood', category:'Static', dpPerRank:1, maxRank:3, mechanic:'', desc:'STAGE 3+ â Richiede Berserker. Inizi il Combattimento con Resolve pari ai Ranks. A ogni tuo turno, se sei sotto le Ferite Massime generi Resolve pari ai Ranks (doppio se sei sotto metÃ ); se raggiungi il tetto di Resolve a inizio turno, Check CPU (Endurance) TN 15-DOS: su Fallimento subisci Danno Unalterable pari al doppio dei Ranks.' },
    { name:'Sentry Aim', category:'Trigger', dpPerRank:2, maxRank:1, mechanic:'', desc:'STAGE 3+ â Sblocca Sentry Stance. Attivandola, piazzi una Sentry Zone (come [T:BLAST]); chi entra/esce dalla zona puÃ² essere colpito con un Attacco [RANGE][DAMAGE] gratuito (Azione Interrupt, ignora "un Attacco a round", nessun Tag extra â un bersaglio non puÃ² essere colpito due volte cosÃ¬ nello stesso round). Nessuna penalitÃ  Accuracy sui [RANGE] in questa Stance, ma -2 Dodge contro [MELEE] e non puoi bersagliare nemici entro 2 spazi; tratti tutto il terreno come Difficile.' },
    { name:'Martial Strikes', category:'Trigger', dpPerRank:2, maxRank:1, mechanic:'', desc:'STAGE 3+ â Richiede 1 Rank di Weapon. Sblocca Martial Stance. Una volta a round come Azione Libera, Check BIT (Decipher Intent) TN 10+DOS bersaglio: su Successo i tuoi 6 su Accuracy contano come 2 Successi contro quel bersaglio fino al tuo prossimo turno con Attacchi [WEAPON] (Successo Critico: raddoppia anche il bonus di Weapon). PenalitÃ  a Dodge pari al tuo Stage contro Nemici non bersagliati.' },
    { name:'Anticipate Assault', category:'Trigger', dpPerRank:2, maxRank:1, mechanic:'', desc:'STAGE 3+ â Richiede 1 Rank di Instinct. Sblocca Anticipate Stance. Una volta a round come Azione Libera, Check RAM (Evasion) TN 10+DOS bersaglio: su Successo i tuoi 6 su Dodge contro quel bersaglio contano come 2 Successi fino al tuo prossimo turno (Successo Critico: raddoppia il bonus di Instinct e i suoi Attacchi non riducono il tuo Dodge Pool, salvo Sniper/Coordinated Assault). PenalitÃ  ad Armor pari al tuo Stage contro Nemici non bersagliati.' },
    { name:'Transporter', category:'Trigger', dpPerRank:1, maxRank:1, mechanic:'', desc:'STAGE 3+ â Richiede Teleport. Puoi teletrasportare anche Alleati adiacenti insieme a te (anche in reazione a un Attacco); ognuno perde 1 Azione al turno successivo (come se avesse Interceduto). +1 alla distanza di Teleport.' },
    { name:'Holy Ward', category:'Trigger', dpPerRank:2, maxRank:1, mechanic:'', desc:'STAGE 3+/ULTIMATE â Richiede 1 Rank di Basic/Advanced/Master Effect con un Effetto positivo. Incompatibile con Dark Emblem, Status Warlord. Richiesta per Chaotic Balance. Quando colpisci con un Attacco con Effetto positivo (o [HASTE]/[IMMUNE]/[SHIELD]), tira BIT come Pool Check: ogni Successo cura 1 Casella Ferita a un bersaglio dell\'Attacco a scelta. Max 1 volta a round.' },
    { name:'Dark Emblem', category:'Trigger', dpPerRank:2, maxRank:1, mechanic:'', desc:'STAGE 3+/ULTIMATE â Richiede 1 Rank di Basic/Advanced/Master Effect con un Effetto negativo. Incompatibile con Holy Ward, Status Warlord. Richiesta per Chaotic Balance. Quando colpisci con un Attacco con Effetto negativo (o [FEAR]/[DOOM]/[STUN]/[BLIND]/[DOT]), tira BIT come Pool Check: ogni Successo infligge 1 Danno Unalterable a un bersaglio dell\'Attacco a scelta. Max 1 volta a round.' },
    { name:'Chaotic Balance', category:'Static', dpPerRank:1, maxRank:1, mechanic:'', desc:'Richiede Holy Ward o Dark Emblem (permette di comprare entrambe). Non puoi attivarle nello stesso round, e se ne usi una non puoi riusarla il turno dopo â ma se ne hai usata una nel round precedente, l\'altra ottiene +1 Successo (cura o Danno Unalterable) quando la usi.' },
    { name:'Distant Force', category:'Clash', dpPerRank:2, maxRank:1, mechanic:'', desc:'STAGE 3+/ULTIMATE â Come 1 Azione, bersaglia un Digimon entro il tuo Range. Se non consenziente, Check contrapposto (tu BIT+DOS, lui il suo Clash â conta come Check di Clash per Brawler/Slippery). Se vinci (o Ã¨ consenziente), applichi [PUSH] o [PULL] usando BIT o DOS a scelta per la distanza.' },
    { name:'Basic Effect: Lag', category:'Attack', dpPerRank:1, maxRank:1, mechanic:'', desc:'CAP. 4.08 â Sblocca l\'uso del Tag [LAG] su un Attacco [SUPPORT] (riduce la posizione in Iniziativa del bersaglio, gestione manuale dell\'ordine).' },
    { name:'Basic Effect: Lead', category:'Attack', dpPerRank:1, maxRank:1, mechanic:'', desc:'CAP. 4.08 â Sblocca l\'uso del Tag [LEAD] su un Attacco [SUPPORT] (aumenta la posizione in Iniziativa del bersaglio, gestione manuale dell\'ordine).' },
    { name:'Basic Effect: Tailwind', category:'Attack', dpPerRank:1, maxRank:1, mechanic:'', desc:'CAP. 4.08 â Sblocca l\'uso del Tag [TAILWIND] su un Attacco [SUPPORT] (aumenta il Movimento, non gestito dal sito).' },
    { name:'Basic Effect: Vague', category:'Attack', dpPerRank:1, maxRank:1, mechanic:'', desc:'CAP. 4.08 â Sblocca l\'uso del Tag [VAGUE] su un Attacco [SUPPORT] (riduce Accuracy).' },
    { name:'Advanced Effect: Heavy', category:'Attack', dpPerRank:2, maxRank:1, mechanic:'', desc:'STAGE 2+ â Sblocca l\'uso del Tag [HEAVY] su un Attacco [SUPPORT] (rimuove opzioni di Movimento extra, non gestito dal sito).' },
    { name:'Advanced Effect: Freeze', category:'Attack', dpPerRank:2, maxRank:1, mechanic:'', desc:'STAGE 2+ â Sblocca l\'uso del Tag [FREEZE] (Danno) su un Attacco [DAMAGE][SUPPORT] (Danno se il bersaglio non si muove).' },
    { name:'Master Effect: Paralyze', category:'Attack', dpPerRank:3, maxRank:1, mechanic:'', desc:'STAGE 4+/ULTIMATE â Sblocca l\'uso del Tag [PARALYZE] su un Attacco [SUPPORT] (riduce Dodge e mobilitÃ ).' },
    { name:'Master Effect: Rattled', category:'Attack', dpPerRank:3, maxRank:1, mechanic:'', desc:'STAGE 4+/ULTIMATE â Sblocca l\'uso del Tag [RATTLED] su un Attacco [SUPPORT] (Damage e Dodge insieme).' },
    { name:'Master Effect: Shaken', category:'Attack', dpPerRank:3, maxRank:1, mechanic:'', desc:'STAGE 4+/ULTIMATE â Sblocca l\'uso del Tag [SHAKEN] su un Attacco [SUPPORT] (Accuracy e Armor insieme).' },
    { name:'Master Effect: Weak', category:'Attack', dpPerRank:3, maxRank:1, mechanic:'', desc:'STAGE 4+/ULTIMATE â Sblocca l\'uso del Tag [WEAK] su un Attacco [SUPPORT] (Damage e Armor insieme).' },
    { name:'Master Effect: Strength', category:'Attack', dpPerRank:3, maxRank:1, mechanic:'', desc:'STAGE 4+/ULTIMATE â Sblocca l\'uso del Tag [STRENGTH] su un Attacco [SUPPORT] (Damage e Armor insieme, positivo).' },
    { name:'Master Effect: Vigil', category:'Attack', dpPerRank:3, maxRank:1, mechanic:'', desc:'STAGE 4+/ULTIMATE â Sblocca l\'uso del Tag [VIGIL] su un Attacco [SUPPORT] (Dodge e Armor insieme).' },
    { name:'Master Effect: Vigor', category:'Attack', dpPerRank:3, maxRank:1, mechanic:'', desc:'STAGE 4+/ULTIMATE â Sblocca l\'uso del Tag [VIGOR] su un Attacco [SUPPORT] (Dodge e Movimento, quest\'ultimo non gestito dal sito).' },
    { name:'Master Effect: Steady', category:'Attack', dpPerRank:3, maxRank:1, mechanic:'', desc:'STAGE 4+/ULTIMATE â Sblocca l\'uso del Tag [STEADY] su un Attacco [SUPPORT] (Damage e Dodge insieme).' },
    { name:'Master Effect: Regen', category:'Attack', dpPerRank:3, maxRank:1, mechanic:'', desc:'STAGE 4+/ULTIMATE â Sblocca l\'uso del Tag [REGEN] su un Attacco [SUPPORT] (cura il bersaglio e permette di sopravvivere a un colpo fatale â applicare a mano).' },
    { name:'Master Effect: Ruin', category:'Attack', dpPerRank:3, maxRank:1, mechanic:'', desc:'STAGE 4+/ULTIMATE â Sblocca l\'uso del Tag [RUIN] su un Attacco [DAMAGE][SUPPORT] (Danno basato sul BIT del lanciatore).' },
    { name:'Master Effect: Doom', category:'Attack', dpPerRank:3, maxRank:1, mechanic:'', desc:'STAGE 4+/ULTIMATE â Sblocca l\'uso del Tag [DOOM] su un Attacco [SUPPORT] (nega la cura oltre una certa soglia â applicare a mano).' },
    { name:'Master Effect: Blind', category:'Attack', dpPerRank:3, maxRank:1, mechanic:'', desc:'STAGE 4+/ULTIMATE â Sblocca l\'uso del Tag [BLIND] su un Attacco [SUPPORT] (il bersaglio Ã¨ accecato per la Durata â applicare a mano).' },
    { name:'Master Effect: Dot', category:'Attack', dpPerRank:3, maxRank:1, mechanic:'', desc:'STAGE 4+/ULTIMATE â Sblocca l\'uso del Tag [DOT] su un Attacco [DAMAGE][SUPPORT] (trasforma il bersaglio in Sprite: perde i benefici d\'Attacco ma guadagna Dodge â applicare a mano, max 1 volta a Combattimento per bersaglio).' },
    { name:'Master Effect: Stun', category:'Attack', dpPerRank:3, maxRank:1, mechanic:'', desc:'STAGE 4+/ULTIMATE â Sblocca l\'uso del Tag [STUN] su un Attacco [SUPPORT] (rimuove un\'Azione al bersaglio â applicare a mano).' },
    { name:'Master Effect: Immune', category:'Attack', dpPerRank:3, maxRank:1, mechanic:'', desc:'STAGE 4+/ULTIMATE â Sblocca l\'uso del Tag [IMMUNE] su un Attacco [SUPPORT] (riduce la Potenza degli Effetti negativi in arrivo sul bersaglio â applicare a mano).' },
    { name:'Master Effect: Deny', category:'Attack', dpPerRank:3, maxRank:1, mechanic:'', desc:'STAGE 4+/ULTIMATE â Sblocca l\'uso del Tag [DENY] su un Attacco [SUPPORT] (nega il primo Effetto che il bersaglio subirebbe â applicare a mano).' },
    { name:'Master Effect: Haste', category:'Attack', dpPerRank:3, maxRank:1, mechanic:'', desc:'STAGE 4+/ULTIMATE â Sblocca l\'uso del Tag [HASTE] su un Attacco [SUPPORT] (concede un\'Azione extra al bersaglio â applicare a mano).' },
    { name:'Mode Change', category:'Trigger', dpPerRank:1, maxRank:3, mechanic:'', desc:'STAGE 3+ â Richiesta per Superior Mode. Rank 1: come 1 Azione, scambia ArmorâDamage OPPURE AccuracyâDodge (Stat Base). Rank 2: scambia una coppia qualsiasi di Stat Base (tranne Health). Rank 3: scambia liberamente tutte le Stat Base tranne Health. Non tocca le Stat Derivate nÃ© i bonus da Qualities/Stance/Direct.' },
    { name:'Superior Mode', category:'Trigger', dpPerRank:1, maxRank:1, mechanic:'', desc:'Richiede 3 Ranks di Mode Change. Scegli Qualities giÃ  possedute per un totale di DP â¤ StageÃ3 (ignora sconti; ogni prerequisito collegato va incluso), poi scegli altrettante Qualities diverse (mai giÃ  possedute) dello stesso costo totale: sono le tue "Mode Change Qualities". Quando usi Mode Change, puoi anche scambiare il set di Qualities attuale con quello Mode, e cambiare Size (se ne hai scelta una diversa), fino a fine Combattimento o a un nuovo uso di Mode Change per tornare indietro.' },
    { name:'Chrome Digizoid Armor', category:'Static', dpPerRank:1, maxRank:1, mechanic:'', desc:'STAGE 3+ (Ultimate) â Incompatibile con altri Digizoid Armor. +1 Armor, +1 Health (applicare a mano a Ferite Massime).' },
    { name:'Cursed Digizoid Armor', category:'Static', dpPerRank:1, maxRank:1, mechanic:'', desc:'STAGE 4+ (Mega) â Incompatibile con altri Digizoid Armor. +1 Health. +2 Armor mentre subisci un Effetto negativo (applicare a mano quando rilevante).' },
    { name:'Adaptive Digizoid Armor', category:'Trigger', dpPerRank:2, maxRank:1, mechanic:'', desc:'STAGE 4+ (Mega) â Incompatibile con altri Digizoid Armor. A inizio round, 4 punti da distribuire tra bonus a Dodge e Armor come preferisci (es. +3 Dodge e +1 Armor).' },
    { name:'Sharp Digizoid Armor', category:'Static', dpPerRank:2, maxRank:1, mechanic:'', desc:'STAGE 4+ (Mega) â Incompatibile con altri Digizoid Armor. +2 Armor, +1 Health. Quando subisci un Attacco [DAMAGE], infliggi 1 Danno Unalterable all\'Attaccante.' },
    { name:'Heavy Digizoid Armor', category:'Static', dpPerRank:2, maxRank:1, mechanic:'', desc:'STAGE 4+ (Mega) â Incompatibile con altri Digizoid Armor. +4 Armor. -1 Movimento (non gestito dal sito), +1 CPU.' },
    { name:'Flexible Digizoid Armor', category:'Trigger', dpPerRank:3, maxRank:1, mechanic:'', desc:'STAGE 4+ (Mega) â Incompatibile con altri Digizoid Armor. +2 Armor, +3 Dodge, +1 RAM. Sei considerato 1 Size piÃ¹ piccolo mentre ti muovi (puoi passare per gli spazi di Digimon piÃ¹ grandi senza fermarti lÃ¬).' },
    { name:'Light Digizoid Armor', category:'Static', dpPerRank:3, maxRank:1, mechanic:'', desc:'STAGE 4+ (Mega) â Incompatibile con altri Digizoid Armor. +3 Dodge, +1 Health. +1 Movimento (non gestito dal sito) e 1 Successo automatico garantito su ogni tiro di Dodge (si somma ad Absolute Evasion, non riduce la Pool).' },
    { name:'Shining Digizoid Armor', category:'Trigger', dpPerRank:3, maxRank:1, mechanic:'', desc:'STAGE 4+ (Mega) â Incompatibile con altri Digizoid Armor. +2 Armor, +3 Health. Riduci di 1 (min 1) la Potenza degli Effetti negativi in arrivo. Contro Danno Unalterable da un Nemico, Pool Check di tanti d6 quanto il Danno: -1 Danno per Successo.' },
    { name:'Chrome Digizoid Weaponry', category:'Attack', dpPerRank:1, maxRank:1, mechanic:'', desc:'STAGE 3+ (Ultimate) â Richiede 1 Rank di Weapon. Incompatibile con Algorithm e altri Digizoid Weaponry. Gli Attacchi [WEAPON] guadagnano +2 Accuracy, +1 Damage, +1 Potenza ai Tag Effetto.' },
    { name:'Cursed Digizoid Weaponry', category:'Attack', dpPerRank:1, maxRank:1, mechanic:'', desc:'STAGE 4+ (Mega) â Richiede 1 Rank di Weapon. Incompatibile con Algorithm e altri Digizoid Weaponry. Gli Attacchi [WEAPON] guadagnano +2 Accuracy, +1 Damage; +2 Damage extra quando sei a metÃ  Ferite Massime o meno.' },
    { name:'Adaptive Digizoid Weaponry', category:'Attack', dpPerRank:2, maxRank:1, mechanic:'', desc:'STAGE 4+ (Mega) â Richiede 1 Rank di Weapon. Incompatibile con Algorithm e altri Digizoid Weaponry. A inizio turno, 4 punti da distribuire tra bonus Accuracy/Damage sugli Attacchi [WEAPON] fino al tuo prossimo turno. Immune a [DISARM].' },
    { name:'Sharp Digizoid Weaponry', category:'Attack', dpPerRank:2, maxRank:1, mechanic:'', desc:'STAGE 4+ (Mega) â Richiede 1 Rank di Weapon. Incompatibile con Algorithm e altri Digizoid Weaponry. Gli Attacchi [WEAPON] guadagnano +4 Accuracy; gli [DAMAGE][WEAPON] infliggono 2 Danno Unalterable extra a segno.' },
    { name:'Heavy Digizoid Weaponry', category:'Attack', dpPerRank:2, maxRank:1, mechanic:'', desc:'STAGE 4+ (Mega) â Richiede 1 Rank di Weapon. Incompatibile con Algorithm e altri Digizoid Weaponry. Gli Attacchi [WEAPON] guadagnano +5 Damage; -1 Movimento (non gestito dal sito), +1 DOS. Gli [DAMAGE][WEAPON] applicano [HEAVY] per 1 round.' },
    { name:'Flexible Digizoid Weaponry', category:'Attack', dpPerRank:3, maxRank:1, mechanic:'', desc:'STAGE 4+ (Mega) â Richiede 1 Rank di Weapon. Incompatibile con Algorithm e altri Digizoid Weaponry. +1 BIT, +3 Dodge. Gli [RANGE][WEAPON] guadagnano +1 Range; i [MELEE][WEAPON] colpiscono 1 spazio piÃ¹ lontano (come 1 Rank di Reach: Wide Swings, cumulabile con Reach giÃ  posseduto). Escape the Clash riesce sempre in automatico.' },
    { name:'Light Digizoid Weaponry', category:'Attack', dpPerRank:3, maxRank:1, mechanic:'', desc:'STAGE 4+ (Mega) â Richiede 1 Rank di Weapon. Incompatibile con Algorithm e altri Digizoid Weaponry. Gli Attacchi [WEAPON] guadagnano +3 Accuracy, +3 Damage, e 1 Successo automatico garantito su ogni tiro Accuracy (si somma a Certain Strike). +1 Azione extra al turno, usabile solo per Bolster, Muovi o Movimento Difficile.' },
    { name:'Shining Digizoid Weaponry', category:'Attack', dpPerRank:3, maxRank:1, mechanic:'', desc:'STAGE 4+ (Mega) â Richiede 1 Rank di Weapon. Incompatibile con Algorithm e altri Digizoid Weaponry. Gli Attacchi [WEAPON] guadagnano +5 Accuracy, +1 Damage. Su [MELEE]: Danno minimo di 2 dopo Armor se [DAMAGE], +1 Durata se [SUPPORT] a segno. Su [RANGE]: +3 Range e Limite Effettivo. +1 IP Temporaneo quando tiri l\'Iniziativa (perso se non speso a fine Combattimento).' },
    { name:'Pure Digizoid Weaponry', category:'Attack', dpPerRank:3, maxRank:1, mechanic:'', desc:'STAGE 4+ (Mega) â Richiede 2 Ranks di Weapon e 2 Ranks di Algorithm. Incompatibile con ogni altro Digizoid Weaponry. Gli Attacchi [WEAPON] guadagnano +2 Accuracy/Damage. Guadagni il Tag [OFFHAND] indipendente dai Tag [WEAPON] giÃ  posseduti, trattato come Rank 2 di [WEAPON] (su Signature Move il bonus totale da Weapon+Offhand non supera 4+Battery attuale).' },
    { name:'Overwrite', category:'Trigger', dpPerRank:1, maxRank:1, mechanic:'', desc:'STAGE 3+/ULTIMATE â Richiede 1 Rank di Instinct. Solo 1 Gain Force per Digimon; incompatibile con Algorithm e ogni altra Gain Force. Come 1 Azione attivi Overwrite: finchÃ© attivo (o fino a fine Combattimento), ogni volta che subiresti un Effetto da fonte esterna, perdi Caselle Ferita pari al doppio del costo DP di quell\'Effetto per negarlo del tutto (es. [DISTRACT] 2DP â 4 Danno Unalterable). Puoi disattivarlo come Azione Libera nel tuo turno. Non nega l\'Effetto se ti porterebbe a 0 Ferite. Il Danno subito conta per Combat Monster. Non Ã¨ mai sopprimibile.' },
    { name:'Undying inForce', category:'Static', dpPerRank:2, maxRank:1, mechanic:'', desc:'STAGE 4+/MEGA â Richiede 1 Rank di Instinct. Unica Gain Force; incompatibile con Algorithm/altre Gain Force. Sotto metÃ  Ferite Massime, ottieni [REGEN] passivo con Potenza pari ai Ranks di Instinct (nullo a 0 Ferite; [CLEANSE] lo sopprime solo per 1 round). Con Second Wind: puoi usarlo nel turno in cui attacchi, e ottieni usi extra pari ai Ranks di Instinct. Una volta a round, ritira gli 1 su un Check Health (con Vital Energy, anche i 2).' },
    { name:'Temporal inForce', category:'Trigger', dpPerRank:2, maxRank:1, mechanic:'', desc:'STAGE 4+/MEGA â Richiede 1 Rank di Instinct. Unica Gain Force; incompatibile con Algorithm/altre Gain Force. Non tiri l\'Iniziativa: dopo che tutti gli altri l\'hanno tirata, scegli la tua posizione nell\'ordine di turno (nessuno puÃ² Interrompere durante il tuo turno, salvo Hold Action). Ogni turno alterno puoi aggiustare la tua posizione (non se sei affetto da [LAG]). Con Ranks di Combat Awareness: immune a [LAG] e aggiungi i Ranks di Instinct ai suoi bonus.' },
    { name:'Omniscient inForce', category:'Trigger', dpPerRank:2, maxRank:1, mechanic:'', desc:'STAGE 4+/MEGA â Richiede 1 Rank di Instinct. Unica Gain Force; incompatibile con Algorithm/altre Gain Force. Puoi usare Hold Action su te stesso (anche senza Tamer), gratis una volta a turno (quindi fino a 2 volte, la seconda con 2 Azioni) e ignori il limite "un Attacco a round" quando lo usi per attaccare. Aggiungi i Ranks di Instinct al Pool Check di Hold Action. Una volta a round, ritira gli 1 su un tiro di Dodge (con Avoidance, anche i 2).' },
    { name:'Digital Hazard', category:'Attack', dpPerRank:3, maxRank:1, mechanic:'', desc:'STAGE 4+/MEGA â Richiede 1 Rank di Instinct. Unica Gain Force; incompatibile con Algorithm/altre Gain Force. Applica [HAZARD] a un Attacco (sostituisce [MELEE]/[RANGE]/[DAMAGE]/[SUPPORT]): Danno automatico (niente tiri Accuracy/Dodge) a tutto entro metÃ  Range, ridotto da Armor, +Danno pari ai Ranks di Instinct. Ogni uso oltre il primo a Combattimento (salvo su Signature Move) ti costa Ferite pari al tuo Stage (non conta per Combat Monster). Nessun altro Tag applicabile salvo Effetti (serve min. 4 Danno per applicarli).' },
    { name:'Zero Unit', category:'Attack', dpPerRank:3, maxRank:1, mechanic:'', desc:'STAGE 4+/MEGA â Richiede 1 Rank di Instinct. Unica Gain Force; incompatibile con Algorithm/altre Gain Force. Applica [ZERO] a un Attacco [SUPPORT] (Effetto positivo senza Durata, 1 volta a Combattimento, 2 Azioni, mai come Area): o fa evolvere gratis un Alleato entro Stage spazi che ha giÃ  sbloccato lo Stage successivo (Punti Evoluzione extra pari ai Ranks di Instinct), oppure rianima un Alleato sconfitto con Ferite pari al doppio dei Ranks di Instinct (tornando allo Stage in cui Ã¨ caduto). Su Signature Move il bonus scala anche con la Battery.' },
    { name:'Pure Overwrite', category:'Static', dpPerRank:2, maxRank:1, mechanic:'', desc:'STAGE 4+/MEGA â Richiede 2 Ranks di Instinct e 2 Ranks di Algorithm. Unica Gain Force; incompatibile con ogni altra. ImmunitÃ  a tutti gli Effetti negativi di costo 2 DP o meno (mai sopprimibile). Con Second Wind: puoi attivarlo nel tuo turno senza consumare un uso, spendendo 1 Azione extra, anche senza usi rimasti.' },
    { name:'Memory Upgrade', category:'Static', dpPerRank:0, maxRank:3, mechanic:'', desc:'CAP. 7.01 (GRATIS) â +1 Attacco nella tua lista di Attacchi per Rank. Puoi comprare 1 Rank ogni 3 Tag da Attacco ottenuti da Qualities (es. [PIERCING 1]+[CERTAIN 1]+[CHARGE] = 1 Rank). Non conta nel limite di Free Qualities del Digimon.' },
    { name:'Slayer', category:'Attack', dpPerRank:0, maxRank:1, mechanic:'', desc:'CAP. 7.01 (GRATIS) â Scegli una Famiglia, un Tipo (Drago/Demone/Bestia ecc.) o un Elemento di Naturewalk come "nemico preferito" (il Master deve approvarlo). +DOS Accuracy contro quel tipo di bersaglio; se manchi un Attacco che ne beneficerebbe, subisci Danno Unalterable pari al tuo Stage. Non conta nel limite di Free Qualities.' },
    { name:'Critical Arms', category:'Attack', dpPerRank:0, maxRank:1, mechanic:'', desc:'CAP. 7.01 (GRATIS) â Richiede 1+ Rank di Weapon. Tira 2d6 (Critical Dice) insieme alla Pool Accuracy su ogni Attacco [WEAPON]: 2 â l\'Attacco fallisce automaticamente e subisci [DISARM] fino a fine Combattimento (o 2 Azioni per rimuoverlo); 3-11 â nessun effetto; 12 â effetto positivo extra (vedi manuale per il dettaglio esatto). Non conta nel limite di Free Qualities.' },
    { name:'Mind Over Matter', category:'Static', dpPerRank:0, maxRank:1, mechanic:'', desc:'CAP. 7.01 (GRATIS) â -1 a tutte le Stat Core. In cambio, scegli 2 Skills dello stesso Attributo (tranne RAM/AgilitÃ  pura) e trattale come se avessi Prodigious Skill su entrambe.' },
    { name:'Justice Is Blind', category:'Trigger', dpPerRank:0, maxRank:1, mechanic:'', desc:'CAP. 7.01 (GRATIS) â Il Digimon Ã¨ cieco/ipovedente: fallisce automaticamente i Check visivi ma ha Prodigious Skill: Awareness per l\'udito e contro Hide in Plain Sight. In combattimento, i suoi [MELEE] hanno sempre [T:WAVE] e i [RANGE] sempre [T:CONE] gratuiti (non puÃ² comprare altri Tag Area); niente Selective Targeting. Un Attacco a bersaglio singolo richiede 1 Azione extra (o il Tamer cede 1 Azione per dirigerlo).' },
    { name:'Weakened Strike (Fragile Strike)', category:'Attack', dpPerRank:-1, maxRank:3, mechanic:'', desc:'NEGATIVA â Richiede 1+ Rank di Certain Strike (Ranks max = quelli di Certain Strike). Applica [FRAGILE] all\'Attacco con [CERTAIN]: -1 Danno e -1 Potenza/Durata degli Effetti (min 0) per Rank. Non applicabile a un Attacco [SUPPORT].' },
    { name:'Indiscriminate Targeting', category:'Static', dpPerRank:-1, maxRank:1, mechanic:'', desc:'NEGATIVA â Richiede 1+ Rank di Area Attack. Incompatibile con Zoner. I tuoi Area Attack non distinguono piÃ¹ Alleati da Nemici: colpiscono tutti tranne te.' },
    { name:'Underwhelming', category:'Static', dpPerRank:-1, maxRank:2, mechanic:'', desc:'NEGATIVA â Richiede 1+ Rank di Huge Power (max Ranks = quelli di Huge Power). Quando usi Huge Power, riduci i Successi finali di Accuracy di 1 per Rank qui. Huge Power non Ã¨ piÃ¹ utilizzabile su un Attacco con [CERTAIN].' },
    { name:'Broadside', category:'Static', dpPerRank:-1, maxRank:2, mechanic:'', desc:'NEGATIVA â Richiede 1+ Rank di Avoidance (max Ranks = quelli di Avoidance). Quando usi Avoidance, riduci i Successi finali di Dodge di 1 per Rank qui.' },
    { name:'Illness', category:'Static', dpPerRank:-1, maxRank:2, mechanic:'', desc:'NEGATIVA â Richiede 1+ Rank di Vital Energy (max Ranks = quelli di Vital Energy). Quando usi Vital Energy, riduci i Successi finali di Health di 1 per Rank qui.' },
    { name:'System Error', category:'Static', dpPerRank:-1, maxRank:2, mechanic:'', desc:'NEGATIVA â Richiede 1+ Rank di System Boost (max Ranks = quelli di System Boost). Per ogni Rank qui, riduci di 1 una Stat Derivata NON giÃ  toccata da System Boost.' },
    { name:'Natural Weakness', category:'Static', dpPerRank:-1, maxRank:2, mechanic:'', desc:'NEGATIVA â Richiede 1+ Rank di Naturewalk. Incompatibile con Elemental Myriad. Per ogni Rank, scegli 2 Elementi che NON hai da Naturewalk: subisci il doppio del bonus Danno di Elemental Force da quegli Elementi (max Ranks = quelli di Naturewalk).' },
    { name:'Exploitable Program', category:'Static', dpPerRank:-1, maxRank:1, mechanic:'', desc:'NEGATIVA â La TN di ogni Nemico che richiede una tua Stat Derivata (es. Mighty Blow, Substitute subiti) Ã¨ ridotta di 3.' },
    { name:'Accuracy Converter [Nemico]', category:'Static', dpPerRank:0, maxRank:99, mechanic:'', desc:'CAP. 3.01 GM INDEX (solo Nemici, gratis, non conta nel limite Free) â Per Rank: -1 Accuracy, +1 BIT. Non puoi scendere sotto l\'Accuracy di partenza nÃ© superare il doppio del BIT senza questa Quality. Usare con moderazione: serve solo ad abbassare Stat totali "esagerate" mantenendo la Stat Derivata.' },
    { name:'Damage Converter [Nemico]', category:'Static', dpPerRank:0, maxRank:99, mechanic:'', desc:'CAP. 3.01 GM INDEX (solo Nemici, gratis, non conta nel limite Free) â Per Rank: -1 Damage, +1 DOS. Non puoi scendere sotto il Damage di partenza nÃ© superare il doppio del DOS senza questa Quality.' },
    { name:'Dodge Converter [Nemico]', category:'Static', dpPerRank:0, maxRank:99, mechanic:'', desc:'CAP. 3.01 GM INDEX (solo Nemici, gratis, non conta nel limite Free) â Per Rank: -1 Dodge, +1 RAM. Non puoi scendere sotto il Dodge di partenza nÃ© superare il doppio del RAM senza questa Quality.' },
    { name:'Armor Converter [Nemico]', category:'Static', dpPerRank:0, maxRank:99, mechanic:'', desc:'CAP. 3.01 GM INDEX (solo Nemici, gratis, non conta nel limite Free) â Per Rank: -1 Armor, +1 CPU. Non puoi scendere sotto l\'Armor di partenza nÃ© superare il doppio del CPU senza questa Quality.' },
    { name:'Punishing Strike', category:'Attack', dpPerRank:1, maxRank:1, mechanic:'', desc:'STAGE 2+ â Richiede 1 Rank di Combat Awareness. Richiesta per There Is No Escape. Applica [PUNISH] a un Attacco [MELEE]: se un Nemico si allontana volontariamente dalla tua portata melee (non teleport, non spostamento da Effetto), puoi attaccarlo fuori dal tuo turno come Azione Interrupt (niente Area Attack). Utilizzabile un numero di volte a Combattimento pari ai tuoi Ranks di Combat Awareness. Se un Alleato Intercede contro questo Attacco, il suo Armor Ã¨ dimezzato contro il Danno.' },
    { name:'There Is No Escape', category:'Static', dpPerRank:1, maxRank:1, mechanic:'', desc:'Richiede Punishing Strike. Quando infliggi 2+ Danno con un Attacco [PUNISH], dimezzi il Movimento del bersaglio fino a fine turno (o lo azzeri se l\'Attacco ha anche [ROOT]). Il Danno Unalterable non conta per attivarla. Utilizzabile anche se il bersaglio tenta di Teletrasportarsi via.' },
    { name:'Boiling Point', category:'Static', dpPerRank:-2, maxRank:1, mechanic:'', desc:'NEGATIVA â Richiede Combat Monster. Quando inizi il turno con Resolve al massimo, Check CPU (Endurance) TN 15-DOS: Fallimento Critico â perdi Ferite pari al Resolve attuale; Fallimento â perdi metÃ  Resolve attuale in Ferite e azzeri il Resolve; Successo â la TN sale del tuo Resolve massimo fino a fine Combattimento; Successo Critico â sale solo di metÃ .' },
    { name:'[BOSS] Adaptive Intelligence', category:'Boss', dpPerRank:1, maxRank:1, mechanic:'', desc:'+2 Dodge (stackabile) contro un Attacco giÃ  visto, per ogni volta vista dall\'inizio del combattimento. Riservata al Master per i Boss.' },
    { name:'[BOSS] Finesse', category:'Boss', dpPerRank:1, maxRank:99, mechanic:'', desc:'Per Rank: +1 Armor e 1 Danno Unalterable extra sugli Attacchi [DAMAGE]. Ranks massimi = Stage. Riservata al Master.' },
    { name:'[BOSS] True Immunity', category:'Boss', dpPerRank:1, maxRank:99, mechanic:'', desc:'Per Rank, scegli un Effetto: quell\'Effetto non ha mai Durata o Potenza su questo Digimon. Riservata al Master.' },
    { name:'[BOSS] Multigrappler', category:'Boss', dpPerRank:3, maxRank:1, mechanic:'', desc:'PuÃ² Clashare con piÃ¹ nemici insieme, fino al proprio Stage. Riservata al Master.' },
    { name:'[BOSS] Spatial Distortion', category:'Boss', dpPerRank:2, maxRank:1, mechanic:'', desc:'1 Azione extra per ignorare la distanza dell\'Attacco (Range senza penalitÃ , Melee a qualsiasi distanza). Riservata al Master.' },
    { name:'[BOSS] Suppression', category:'Boss', dpPerRank:3, maxRank:1, mechanic:'', desc:'Blocca un tipo di Quality (Static/Trigger/Attack) per i nemici vicini, salvo un Check DOS (TN 10+DOS) con 2 Azioni per ignorarla. Riservata al Master.' }
  ];
  // computeQualityMechanics spostato in js/rules.js

  function qualitiesEditableHTML(qualities){
    if(!qualities || qualities.length===0) return '<div class="muted" style="margin-bottom:6px;">Nessuna Quality aggiunta.</div>';
    return qualities.map((q,i)=>`
      <div class="flex-between" style="margin-bottom:4px;">
        <span>${escapeHTML(q.name)} <span class="muted">(${q.cost} DP)</span></span>
        <button class="btn ghost small" data-rmquality="${i}">Rimuovi</button>
      </div>
    `).join('');
  }

  function renderDigimonCard(me, containerId, onChanged, renderTamerCardFn){
    containerId = containerId || 'digimon-card';
    const cardEl = document.getElementById(containerId);
    if(!cardEl) return;
    const d = me.digimon;
    const isMasterCtx = containerId && containerId.indexOf('m-digimon-')===0;
    // FinchÃ© il Master non approva, la scheda Digimon mostra SOLO l'Uovo al giocatore â nessun nome,
    // stat, Qualities o altro testo. Il Master invece deve poter vedere tutto per decidere se
    // approvare, quindi per lui la scheda resta sempre completa.
    if(!d.approved && !isMasterCtx){
      cardEl.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px 0;gap:14px;">
          ${EGG_IMAGE_URL
            ? `<img src="${escapeAttr(EGG_IMAGE_URL)}" style="width:96px;height:96px;object-fit:contain;" />`
            : `<div style="width:96px;height:96px;border-radius:50%;background:radial-gradient(circle at 35% 30%, #fff8e6, #f0d9a0 60%, #d9b976);display:flex;align-items:center;justify-content:center;font-size:44px;">ð¥</div>`}
        </div>
      `;
      return;
    }
    const der = computeDerivedStats(d);
    if(!editingDigimon){
      cardEl.innerHTML = `
        <div class="flex-between"><div class="section-title" style="margin:0;border:none;padding:0;">Scheda Digimon</div>
        <span><a href="digimon.html" target="_blank" class="btn ghost small" style="margin-right:4px;text-decoration:none;">âï¸ Scheda Completa</a>${isMasterCtx && !d.approved ? `<button class="btn small" id="btn-approve-digimon-${containerId}" style="margin-right:4px;color:var(--cyan);border-color:var(--cyan-dim);">â Approva</button>` : ''}<button class="btn small" id="btn-edit-digimon-${containerId}">Modifica</button>${isMasterCtx ? `<button class="btn ghost small" id="btn-reset-digimon-${containerId}" style="margin-left:4px;color:var(--danger);border-color:var(--danger);">ðï¸ Azzera</button>` : ''}</span></div>
        ${!d.approved ? `<div class="muted" style="margin:4px 0 0;color:var(--amber);">ð¥ In attesa di approvazione â il giocatore vede solo l'Uovo finchÃ© non premi Approva.</div>` : ''}
        <div class="sheet-head" style="margin-top:12px;">
          ${digimonPortraitHTML(d)}
          <div class="info"><div class="nm">${escapeHTML(d.name||'(senza nome)')}</div><div class="tg">${escapeHTML(d.stage)}${d.attribute ? ` Â· ${attributeIconHTML(d.attribute, 15)} ${escapeHTML(d.attribute)}` : ''}</div></div>
        </div>
        ${barHTML('Caselle Ferita', d.currentWounds, d.maxWounds, 'hp', 'dig-w-minus-'+containerId, 'dig-w-plus-'+containerId)}
        ${Number(d.tempWounds||0)>0 ? `<div class="muted" style="margin-top:-4px;margin-bottom:8px;color:var(--cyan);">ð¡ï¸ +${d.tempWounds} Caselle Ferita Temporanee (Shield)</div>` : ''}
        ${barHTML('MP', d.currentMp, d.maxMp, 'mp', 'dig-mp-minus-'+containerId, 'dig-mp-plus-'+containerId)}
        ${d.personality ? `<div class="muted" style="margin-top:8px;"><i>${escapeHTML(d.personality)}</i></div>` : ''}
        <div class="divider"></div>
        <div class="muted" style="margin-bottom:6px;">Stat Base (Combattimento) â ð² tira Pool Check (Nd6, successi su 5-6)</div>
        <div class="grid-stats" style="grid-template-columns:repeat(5,1fr);">
          <div class="stat-box"><div class="v">${d.baseAccuracy}</div><div class="l">ACC</div><button class="roll-btn" data-pool="baseAccuracy" style="margin-top:4px;">ð²</button></div>
          <div class="stat-box"><div class="v">${d.baseDamage}</div><div class="l">DMG</div></div>
          <div class="stat-box"><div class="v">${d.baseDodge}</div><div class="l">DODGE</div><button class="roll-btn" data-pool="baseDodge" style="margin-top:4px;">ð²</button></div>
          <div class="stat-box"><div class="v">${d.baseArmor}</div><div class="l">ARM</div></div>
          <div class="stat-box"><div class="v">${d.baseHealth}</div><div class="l">HP</div><button class="roll-btn" data-pool="baseHealth" style="margin-top:4px;">ð²</button></div>
        </div>
        <div id="pool-roll-result-${containerId}" style="margin-top:8px;"></div>
        <div class="muted" style="margin:8px 0 6px;">Stat Derivate (calcolate)</div>
        <div class="grid-stats" style="grid-template-columns:repeat(4,1fr);">
          <div class="stat-box"><div class="v">${der.bit}</div><div class="l">BIT</div></div>
          <div class="stat-box"><div class="v">${der.dos}</div><div class="l">DOS</div></div>
          <div class="stat-box"><div class="v">${der.ram}</div><div class="l">RAM</div></div>
          <div class="stat-box"><div class="v">${der.cpu}</div><div class="l">CPU</div></div>
        </div>
        <div class="row" style="margin-top:8px;">
          <div class="stat-box"><div class="l">SIZE</div><div class="v" style="font-size:14px;">${escapeHTML(d.size)}</div></div>
          <div class="stat-box"><div class="l">STANCE</div><div class="v" style="font-size:14px;">${escapeHTML(d.stance)}</div></div>
        </div>
        <div class="muted" style="margin-top:4px;">Stance: ${
          d.stance==='Neutral' ? 'nessun bonus/penalitÃ ' :
          d.stance==='Offensive' ? `+${stageIndex(d.stage)} Accuracy, â${stageIndex(d.stage)} Dodge` :
          d.stance==='Defensive' ? `+${stageIndex(d.stage)} Dodge, â${stageIndex(d.stage)} Accuracy` :
          d.stance==='Fierce' ? `+${stageIndex(d.stage)} Damage, â${stageIndex(d.stage)} Movimento/Range (richiede Fierce Soul)` :
          d.stance==='Brave' ? `+${stageIndex(d.stage)} Armor, â${stageIndex(d.stage)} Movimento (richiede Brave Heart)` :
          d.stance==='Sentry' ? 'Sentry Zone + Attacco Interrupt gratuito su chi entra/esce (richiede Sentry Aim; nessuna penalitÃ  Range, -2 Dodge vs Melee, Terreno sempre Difficile â gestione manuale)' :
          d.stance==='Martial' ? '6 su Accuracy contano doppio con [WEAPON] contro un bersaglio marcato (richiede Martial Strikes â gestione manuale)' :
          d.stance==='Anticipate' ? '6 su Dodge contano doppio contro un bersaglio marcato (richiede Anticipate Assault â gestione manuale)' : ''
        } (modificabile da "Modifica")</div>
        <div class="divider"></div>
        ${batteryBarHTML('Battery', d.battery, batteryCap(d.stage), 'dig-batt-minus-'+containerId, 'dig-batt-plus-'+containerId)}
        <button class="btn amber" id="btn-sig-move-${containerId}" style="width:100%;margin-top:4px;" ${(d.battery||0)<1?'disabled':''}>â¡ Usa Signature Move (Battery ${d.battery||0})</button>
        <div class="divider"></div>
        ${barHTML('Resolve', d.resolveCurrent||0, d.resolveMax||4, 'mp', 'dig-res-minus-'+containerId, 'dig-res-plus-'+containerId)}
        <div class="muted" style="font-size:10px;">Risorsa da alcune Qualities (es. Combat Monster) â Max impostabile in "Modifica".</div>
        <div class="divider"></div>
        <div class="muted" style="margin-bottom:4px;">Evoluzione ${isMasterCtx ? `<button class="btn ghost small" id="btn-toggle-evolve-${containerId}" style="margin-left:8px;${d.evolveUnlocked?'color:var(--cyan);border-color:var(--cyan-dim);':'color:var(--danger);border-color:var(--danger);'}">${d.evolveUnlocked?'ð Sbloccata per il giocatore':'ð Bloccata per il giocatore'}</button>` : ''}</div>
        ${isMasterCtx ? (()=>{
          const dexEntry = cachedDex.find(e=>(e.name||'').toLowerCase()===(d.name||'').toLowerCase());
          const options = dexEntry && Array.isArray(dexEntry.evolutions) ? dexEntry.evolutions.filter(Boolean).map(evoName).filter(Boolean) : [];
          if(options.length===0) return '';
          return `
          <div class="sub" style="margin-bottom:6px;">Linee evolutive sbloccate per ${escapeHTML(d.name||'il Digimon')} (dal Digidex) â solo quelle spuntate compariranno come scelta quando il giocatore costruirÃ  lo Stage successivo:</div>
          <div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:8px;">
            ${options.map(name=>`<label style="display:flex;align-items:center;gap:5px;font-size:12px;"><input type="checkbox" data-unlock-evo="${escapeAttr(name)}" data-unlock-evo-container="${containerId}" ${(d.unlockedEvolutions||[]).includes(name)?'checked':''} /> ${escapeHTML(name)}</label>`).join('')}
          </div>`;
        })() : ''}
        ${!isMasterCtx && !d.evolveUnlocked ? `
        <div class="sub" style="margin-bottom:6px;">Il Master non ha ancora sbloccato l'Evoluzione (nÃ© normale nÃ© forzata) â quando lo farÃ , qui compariranno i controlli per evolvere.</div>
        ` : `
        <div class="sub" style="margin-bottom:6px;">Il tuo Digimon riposa normalmente a <b>${escapeHTML(d.defaultStage)}</b> e puÃ² salire fino a <b>${STAGES[Math.min(5, stageIndex(d.defaultStage)+Number(d.defaultRange||0))]}</b> senza spendere Evolution Points (Default Range: ${d.defaultRange}).${d.forcedEvoRoundsLeft>0?` Â· <span style="color:var(--danger);">Evoluzione Forzata: ${d.forcedEvoRoundsLeft} round rimasti</span>`:''}</div>
        <div style="margin-bottom:10px;">
          ${epDigiviceHTML(d.evolutionPoints||0, cachedProgression ? Number(cachedProgression.milestone||0) : null)}
        </div>
        ${d.hybridMode ? `<div class="muted" style="margin-bottom:6px;color:var(--cyan);">ð Hybrid/Bio-Merge attiva: 3 Azioni in combattimento invece di 2 (ancora 1 Attacco a round). Il Tamer non puÃ² Dirigere se stesso.</div>` : ''}
        <div class="row">
          ${(()=>{
            // Il menu si apre di default sullo Stage SUCCESSIVO a quello attuale (non su quello
            // attuale): partiva selezionato sullo Stage attuale, cosÃ¬ premere "Evolvi" senza
            // toccare il menu produceva una "digievoluzione" nel vuoto verso lo stesso Stage,
            // narrata comunque come se fosse successo qualcosa (segnalato dall'utente).
            const nextIdx = Math.min(5, stageIndex(d.stage)+1);
            const defaultTarget = STAGES[nextIdx] || d.stage;
            return `<select id="evo-target-${containerId}" style="flex:2;">${STAGES.map(s=>{
              const built = (d.stageStats && d.stageStats[s]) || s===d.stage;
              return `<option value="${s}" ${s===defaultTarget?'selected':''}>${s}${built?'':' (da costruire)'}</option>`;
            }).join('')}</select>`;
          })()}
          <button class="btn small" id="btn-evolve-${containerId}" style="flex:1;">ð§¬ Evolvi</button>
          <button class="btn ghost small" id="btn-force-evolve-${containerId}" style="flex:1;">â¡ Forza</button>
        </div>
        <div class="muted" id="evo-status-${containerId}" style="margin-top:4px;"></div>
        `}
        ${(cachedProgression && cachedProgression.blastEvolutionEnabled) ? `
        <div class="divider"></div>
        <div class="muted" style="margin-bottom:4px;">ð¥ Blast Evolution â Usi rimasti in campagna: <b>${d.blastEvolutionUses!=null?d.blastEvolutionUses:1}</b> (si rigenera 1 uso a Milestone 3 e 6). Richiede Battery al massimo e un Stage superiore al tuo Default Range.</div>
        <div class="row">
          <select id="blast-target-${containerId}" style="flex:2;">${STAGES.map(s=>`<option ${s===d.stage?'selected':''}>${s}</option>`).join('')}</select>
          <button class="btn ghost small" id="btn-blast-evolve-${containerId}" style="flex:1;" ${(d.battery||0)<batteryCap(d.stage) || (d.blastEvolutionUses!=null?d.blastEvolutionUses:1)<=0 ? 'disabled':''}>ð¥ Blast</button>
        </div>
        <div class="muted" id="blast-status-${containerId}" style="margin-top:4px;"></div>
        ` : ''}
        ${(cachedProgression && cachedProgression.slideEvolutionEnabled) ? `
        <div class="divider"></div>
        <div class="muted" style="margin-bottom:4px;">ð Slide Evolution (Variant 2.02a) â passa a una forma alternativa dello stesso Stage, 1 Evolution Point.</div>
        <div class="row">
          <input type="text" id="slide-name-${containerId}" placeholder="Nome forma alternativa" style="flex:2;" />
          <input type="number" id="slide-wounddiff-${containerId}" placeholder="Î Ferite Max (+/-)" value="0" style="flex:1;" />
          <button class="btn ghost small" id="btn-slide-evolve-${containerId}" style="flex:1;">ð Slide</button>
        </div>
        <div class="muted" id="slide-status-${containerId}" style="margin-top:4px;"></div>
        ` : ''}
        ${((cachedProgression && cachedProgression.darkEvolutionEnabled) || d.darkEvolutionActive) ? `
        <div class="divider"></div>
        ${d.darkEvolutionActive ? `
          <div class="muted" style="margin-bottom:4px;color:var(--danger);">ð Dark Evolution ATTIVA â il Digimon Ã¨ controllato dal Master, attacca tutto ciÃ² che si muove. Termina quando: sconfigge tutti, viene sconfitto, passano ${d.stage} turni, o il Tamer supera un Check Willpower TN 20.</div>
          <button class="btn ghost small" id="btn-dark-evolve-end-${containerId}" style="width:100%;">â©ï¸ Termina Dark Evolution (torna al Default Stage)</button>
        ` : `
          <div class="muted" style="margin-bottom:4px;">ð Dark Evolution (Variant 2.02a) â evoluzione forzata da emozioni negative del Tamer. Il Master controlla il Digimon finchÃ© non rientra.</div>
          <div class="row">
            <select id="dark-target-${containerId}" style="flex:2;">${STAGES.map(s=>`<option ${s===d.stage?'selected':''}>${s}</option>`).join('')}</select>
            <button class="btn ghost small" id="btn-dark-evolve-start-${containerId}" style="flex:1;">ð Attiva</button>
          </div>
        `}
        <div class="muted" id="dark-status-${containerId}" style="margin-top:4px;"></div>
        ` : ''}
        <div class="divider"></div>
        <div class="flex-between" style="margin-bottom:6px;"><span class="muted">ð¡ï¸ Armor Forms (Digimental, 0 EP, 1 volta a Riposo)</span></div>
        ${(d.armorForms||[]).length===0 ? '<div class="muted" style="margin-bottom:6px;">Nessuna Armor Form registrata.</div>' : d.armorForms.map((af,ai)=>`
          <div class="roster-item" style="padding:6px 8px;margin-bottom:4px;">
            <div class="flex-between"><b>${escapeHTML(af.name)}</b><span class="muted">${escapeHTML(af.digimentalName)} Â· ${af.stage}</span></div>
            ${af.qualities && af.qualities.length ? `<div class="sub" style="margin-top:2px;">${af.qualities.map(q=>escapeHTML(q.name)).join(', ')}</div>` : ''}
            <div class="row" style="margin-top:4px;">
              <button class="btn small" data-armor-use="${ai}" style="flex:1;" ${af.usedThisRest?'disabled':''}>${af.usedThisRest?'GiÃ  usata (Rest)':'ð¡ï¸ Usa'}</button>
              <button class="btn ghost small" data-armor-revert="${ai}" style="flex:1;">â©ï¸ Torna al Default</button>
            </div>
          </div>
        `).join('')}
        <div class="divider"></div>
        <div class="flex-between" style="margin-bottom:6px;">
          <span class="muted">Qualities</span>
          <span class="mono" style="color:${computeDpSpent(d.qualities)>Number(d.dpTotal||0)?'var(--danger)':'var(--cyan)'};">${computeDpSpent(d.qualities)} / ${d.dpTotal||0} DP</span>
        </div>
        ${qualitiesReadonlyHTML(d.qualities)}
      `;
      document.getElementById('btn-edit-digimon-'+containerId).onclick = ()=>{ editingDigimon = true; renderDigimonCard(me, containerId, onChanged, renderTamerCardFn); };
      const approveDigimonBtn = document.getElementById('btn-approve-digimon-'+containerId);
      if(approveDigimonBtn){
        approveDigimonBtn.onclick = async ()=>{
          me.digimon.approved = true;
          await saveMember(session.code, me);
          await pushLog(session.code, { who:'Master', role:'gm', text: `Il Digimon di ${displayName(me)} (${me.digimon.name||'senza nome'}) Ã¨ stato approvato dal Master.` });
          renderDigimonCard(me, containerId, onChanged, renderTamerCardFn);
          if(onChanged) onChanged();
        };
      }
      const resetDigimonBtn = document.getElementById('btn-reset-digimon-'+containerId);
      if(resetDigimonBtn){
        resetDigimonBtn.onclick = async ()=>{
          if(!window.confirm(`Azzerare il Digimon di ${displayName(me)} (${d.name||'senza nome'})? Nome, Stage, Qualities, Attacchi e tutti i punteggi torneranno ai valori iniziali e potrÃ  rifare la Creazione Guidata. L'azione non Ã¨ reversibile.`)) return;
          if(!window.confirm(`Sei sicuro? Questa Ã¨ l'ultima conferma prima di azzerare definitivamente il Digimon di ${displayName(me)}.`)) return;
          me.digimon = defaultDigimon();
          await saveMember(session.code, me);
          await pushLog(session.code, { who:'Master', role:'gm', text: `Il Digimon di ${displayName(me)} Ã¨ stato azzerato dal Master.` });
          renderDigimonCard(me, containerId, onChanged, renderTamerCardFn);
          if(onChanged) onChanged();
        };
      }
      document.getElementById('dig-w-minus-'+containerId).onclick = async ()=>{ me.digimon.currentWounds = Math.max(0, me.digimon.currentWounds-1); await saveMember(session.code, me); renderDigimonCard(me, containerId, onChanged, renderTamerCardFn); };
      document.getElementById('dig-w-plus-'+containerId).onclick = async ()=>{ me.digimon.currentWounds = Math.min(me.digimon.maxWounds, me.digimon.currentWounds+1); await saveMember(session.code, me); renderDigimonCard(me, containerId, onChanged, renderTamerCardFn); };
      document.getElementById('dig-mp-minus-'+containerId).onclick = async ()=>{ me.digimon.currentMp = Math.max(0, me.digimon.currentMp-1); await saveMember(session.code, me); renderDigimonCard(me, containerId, onChanged, renderTamerCardFn); };
      document.getElementById('dig-mp-plus-'+containerId).onclick = async ()=>{ me.digimon.currentMp = Math.min(me.digimon.maxMp, me.digimon.currentMp+1); await saveMember(session.code, me); renderDigimonCard(me, containerId, onChanged, renderTamerCardFn); };
      document.getElementById('dig-batt-minus-'+containerId).onclick = async ()=>{ me.digimon.battery = Math.max(0, (me.digimon.battery||0)-1); await saveMember(session.code, me); renderDigimonCard(me, containerId, onChanged, renderTamerCardFn); };
      document.getElementById('dig-batt-plus-'+containerId).onclick = async ()=>{ me.digimon.battery = Math.min(batteryCap(me.digimon.stage), (me.digimon.battery||0)+1); await saveMember(session.code, me); renderDigimonCard(me, containerId, onChanged, renderTamerCardFn); };
      document.getElementById('dig-res-minus-'+containerId).onclick = async ()=>{ me.digimon.resolveCurrent = Math.max(0, (me.digimon.resolveCurrent||0)-1); await saveMember(session.code, me); renderDigimonCard(me, containerId, onChanged, renderTamerCardFn); };
      document.getElementById('dig-res-plus-'+containerId).onclick = async ()=>{ me.digimon.resolveCurrent = Math.min(me.digimon.resolveMax||4, (me.digimon.resolveCurrent||0)+1); await saveMember(session.code, me); renderDigimonCard(me, containerId, onChanged, renderTamerCardFn); };
      const sigBtn = document.getElementById('btn-sig-move-'+containerId);
      if(sigBtn){
        sigBtn.onclick = async ()=>{
          const spent = Number(me.digimon.battery||0);
          if(spent<1) return;
          me.digimon.battery = 0;
          me.digimon.usedSigMoveThisTurn = true;
          await saveMember(session.code, me);
          await pushPlayerNarration(session.code, me, { who: me.digimon.name||displayName(me), role:'roll', text: `â¡ ${me.digimon.name||'Il Digimon'} usa la Signature Move! Bonus da Battery: +${spent} Accuracy/Damage (o +${spent} da dividere tra Accuracy e Potenza Effetto se [SUPPORT]) su questo attacco.` });
          renderDigimonCard(me, containerId, onChanged, renderTamerCardFn);
          if(onChanged) onChanged();
        };
      }
      const evoTargetSel = document.getElementById('evo-target-'+containerId);
      if(evoTargetSel){
        const updateEvoReadyGlow = ()=>{
          const built = (d.stageStats && d.stageStats[evoTargetSel.value]) || evoTargetSel.value===d.stage;
          const eBtn = document.getElementById('btn-evolve-'+containerId);
          const fBtn = document.getElementById('btn-force-evolve-'+containerId);
          if(eBtn) eBtn.classList.toggle('evo-btn-unready', !built);
          if(fBtn) fBtn.classList.toggle('evo-btn-unready', !built);
        };
        evoTargetSel.onchange = updateEvoReadyGlow;
        updateEvoReadyGlow();
      }
      const attrSel = document.getElementById('e-d-attribute-'+containerId);
      if(attrSel){
        attrSel.onchange = ()=>{
          const iconEl = document.getElementById('e-d-attribute-icon-'+containerId);
          if(iconEl) iconEl.innerHTML = attributeIconHTML(attrSel.value, 20);
        };
      }
      const evoBtn = document.getElementById('btn-evolve-'+containerId);
      if(evoBtn){
        evoBtn.onclick = async ()=>{
          const target = document.getElementById('evo-target-'+containerId).value;
          const statusEl = document.getElementById('evo-status-'+containerId);
          if(target === me.digimon.stage){
            statusEl.style.color='var(--danger)';
            statusEl.textContent = `${me.digimon.name||'Il Digimon'} Ã¨ giÃ  a Stage ${target} â scegli uno Stage superiore dal menu per evolvere davvero.`;
            return;
          }
          if(!(me.digimon.stageStats && me.digimon.stageStats[target]) && target !== me.digimon.stage){
            statusEl.style.color='var(--danger)';
            statusEl.textContent = `Lo Stage ${target} non Ã¨ mai stato costruito â vai su "Scheda Digimon" per assegnare i punti (Ã¨ come creare un Digimon nuovo, regola 3.19) prima di potervi evolvere normalmente.`;
            return;
          }
          const cost = evolutionCost(me.digimon, target);
          if(cost > Number(me.digimon.evolutionPoints||0)){
            statusEl.style.color='var(--danger)';
            statusEl.textContent = `Servono ${cost} Evolution Points (ne hai ${me.digimon.evolutionPoints||0}). Costa comunque 1 Azione da segnare a parte.`;
            return;
          }
          me.digimon.evolutionPoints = Number(me.digimon.evolutionPoints||0) - cost;
          const oldName = me.digimon.name || 'Il Digimon';
          const __oldImg = bestDigimonImage(null, me.digimon.name, me.digimon.imageUrl);
          applyStageChange(me.digimon, me.digimon.stage, target);
          // Regola 8.05: un Digimon che evolve recupera tutte le Wound Box.
          me.digimon.currentWounds = me.digimon.maxWounds;
          await saveMember(session.code, me);
          // BUGFIX: mostrava lo Stage target (es. "Fresh") invece del nome specifico del nuovo
          // Digimon (es. "Tsunomon") raggiunto â che a questo punto Ã¨ giÃ  in me.digimon.name grazie
          // ad applyStageChange, dato che il guard sopra garantisce che lo Stage sia giÃ  costruito.
          await pushPlayerNarration(session.code, me, { who: displayName(me), role:'player', text: `â¨ ${oldName} Ã¨ avvolto da un bagliore di dati... e digivolve in ${me.digimon.name||target}!${cost>0?` (spesi ${cost} Evolution Points)`:''} â Stat aggiornate automaticamente. Ricorda di segnare 1 Azione spesa.` });
          statusEl.style.color='var(--text-mute)'; statusEl.textContent = 'Evoluzione applicata, Stat aggiornate.';
          try{ __playEvolutionSfx('https://gsquzfhxgyqrnkrqdivc.supabase.co/storage/v1/object/public/campaign-audio/FRONTIER1/1787073018875_mziu9s.mpeg'); }catch(e){}
          showEvolutionTransition(__oldImg, bestDigimonImage(null, me.digimon.name, me.digimon.imageUrl), me.digimon.name);
          renderDigimonCard(me, containerId, onChanged, renderTamerCardFn);
          if(onChanged) onChanged();
        };
      }
      const forceBtn = document.getElementById('btn-force-evolve-'+containerId);
      if(forceBtn){
        forceBtn.onclick = async ()=>{
          const target = document.getElementById('evo-target-'+containerId).value;
          const statusEl = document.getElementById('evo-status-'+containerId);
          if(target === me.digimon.stage){
            statusEl.style.color='var(--danger)';
            statusEl.textContent = `${me.digimon.name||'Il Digimon'} Ã¨ giÃ  a Stage ${target} â scegli uno Stage superiore dal menu per forzare l'evoluzione.`;
            return;
          }
          const cost = evolutionCost(me.digimon, target);
          const tn = 18 + cost;
          const willVal = me.tamer.willpower;
          const { dice, total } = rollSkillCheck(willVal, 0);
          const verdict = evaluateVsTN(total, tn, dice);
          let outcomeText;
          const oldName = me.digimon.name || 'Il Digimon';
          const __oldImg = bestDigimonImage(null, me.digimon.name, me.digimon.imageUrl);
          if(verdict.cls==='crit-success'){
            const defaultBuilt = !!(me.digimon.stageStats && me.digimon.stageStats[me.digimon.defaultStage] && me.digimon.stageStats[me.digimon.defaultStage].name);
            applyStageChange(me.digimon, me.digimon.stage, me.digimon.defaultStage);
            me.digimon.currentWounds = me.digimon.maxWounds;
            const defaultLabel = defaultBuilt ? me.digimon.name : me.digimon.defaultStage;
            outcomeText = `â¨ Successo Critico! ${oldName} Ã¨ scosso da un'ondata di energia incontrollabile e digivolve, tornando subito al Default Stage (${defaultLabel}) â Stat aggiornate.`;
          } else if(verdict.cls==='success'){
            // BUGFIX: la Forza Evoluzione puÃ² raggiungere anche uno Stage mai costruito prima (usa
            // stat generiche) â in quel caso applyStageChange NON aggiorna il nome, quindi resta lo
            // Stage come etichetta; se invece era giÃ  costruito mostriamo il nome specifico del
            // Digimon, stesso bug di "Evolvi" (mostrava sempre lo Stage, es. "Fresh", anche quando
            // il nome specifico tipo "Tsunomon" era giÃ  disponibile).
            const targetWasBuilt = !!(me.digimon.stageStats && me.digimon.stageStats[target] && me.digimon.stageStats[target].name);
            applyStageChange(me.digimon, me.digimon.stage, target);
            me.digimon.currentWounds = me.digimon.maxWounds;
            me.digimon.forcedEvoRoundsLeft = 3;
            const targetLabel = targetWasBuilt ? me.digimon.name : `${target} (nome ancora da assegnare)`;
            outcomeText = `â¨ Successo! ${oldName} Ã¨ avvolto da un bagliore instabile e digivolve in ${targetLabel} per 3 round (Stat aggiornate), poi tornerÃ  sotto il Default Stage.`;
          } else {
            outcomeText = `${verdict.label}. Nessuna evoluzione forzata â possibili conseguenze pericolose a discrezione del Master.`;
          }
          await saveMember(session.code, me);
          await pushPlayerNarration(session.code, me, { who: displayName(me), role:'roll', text: `â¡ Forza Evoluzione (TN ${tn}): 3d6[${dice.join(',')}] + Willpower ${willVal} = ${total} â ${outcomeText}`, meta:{ dice } });
          statusEl.style.color='var(--text-mute)'; statusEl.textContent = outcomeText;
          if(verdict.cls==='crit-success' || verdict.cls==='success'){
            try{ __playEvolutionSfx('https://gsquzfhxgyqrnkrqdivc.supabase.co/storage/v1/object/public/campaign-audio/FRONTIER1/1787073018875_mziu9s.mpeg'); }catch(e){}
            showEvolutionTransition(__oldImg, bestDigimonImage(null, me.digimon.name, me.digimon.imageUrl), me.digimon.name);
          }
          renderDigimonCard(me, containerId, onChanged, renderTamerCardFn);
          if(renderTamerCardFn) renderTamerCardFn(me, siblingCardId(containerId,'tamer'));
          if(onChanged) onChanged();
        };
      }
      const toggleEvolveBtn = document.getElementById('btn-toggle-evolve-'+containerId);
      if(toggleEvolveBtn){
        toggleEvolveBtn.onclick = async ()=>{
          me.digimon.evolveUnlocked = !me.digimon.evolveUnlocked;
          await saveMember(session.code, me);
          await pushLog(session.code, { who:'Master', role:'gm', text: me.digimon.evolveUnlocked ? `${me.digimon.name||'Il Digimon'} di ${displayName(me)} sente una strana energia provenire dall'interno...` : `${me.digimon.name||'Il Digimon'} di ${displayName(me)} non sente piÃ¹ quella strana energia (Evoluzione ribloccata dal Master).` });
          renderDigimonCard(me, containerId, onChanged, renderTamerCardFn);
          if(onChanged) onChanged();
        };
      }
      cardEl.querySelectorAll(`[data-unlock-evo-container="${containerId}"]`).forEach(chk=>{
        chk.onchange = async ()=>{
          const name = chk.getAttribute('data-unlock-evo');
          if(!Array.isArray(me.digimon.unlockedEvolutions)) me.digimon.unlockedEvolutions = [];
          if(chk.checked){
            if(!me.digimon.unlockedEvolutions.includes(name)) me.digimon.unlockedEvolutions.push(name);
          } else {
            me.digimon.unlockedEvolutions = me.digimon.unlockedEvolutions.filter(n=>n!==name);
          }
          await saveMember(session.code, me);
          await pushLog(session.code, { who:'Master', role:'gm', text: `Il Master ha ${chk.checked?'sbloccato':'bloccato'} la linea evolutiva "${name}" per ${displayName(me)}.` });
        };
      });
      const blastBtn = document.getElementById('btn-blast-evolve-'+containerId);
      if(blastBtn){
        blastBtn.onclick = async ()=>{
          const target = document.getElementById('blast-target-'+containerId).value;
          const statusEl = document.getElementById('blast-status-'+containerId);
          const usesLeft = me.digimon.blastEvolutionUses!=null ? me.digimon.blastEvolutionUses : 1;
          const maxAccessible = STAGES[Math.min(5, stageIndex(me.digimon.defaultStage)+Number(me.digimon.defaultRange||0))];
          if(usesLeft<=0){ statusEl.textContent = 'Nessun uso di Blast Evolution rimasto in questa campagna.'; return; }
          if((me.digimon.battery||0) < batteryCap(me.digimon.stage)){ statusEl.textContent = 'Serve la Battery al massimo per Blast Evolvere.'; return; }
          if(stageIndex(target) <= stageIndex(maxAccessible)){ statusEl.textContent = `Blast Evolution richiede uno Stage oltre il tuo Default Range (giÃ  accessibile fino a ${maxAccessible}).`; return; }
          const preBlastStage = me.digimon.stage;
          me.digimon.battery = 0;
          me.digimon.blastEvolutionUses = usesLeft - 1;
          applyStageChange(me.digimon, me.digimon.stage, target);
          me.digimon.currentWounds = me.digimon.maxWounds;
          const tn = 12 + stageIndex(target);
          const willVal = me.tamer.willpower;
          const { dice, total } = rollSkillCheck(willVal, 0);
          const verdict = evaluateVsTN(total, tn, dice);
          let outcomeText;
          if(verdict.cls==='crit-success'){
            applyStageChange(me.digimon, me.digimon.stage, preBlastStage);
            outcomeText = `Successo Critico! Torna allo Stage precedente al Blast (${preBlastStage}) â Stat aggiornate.`;
          } else if(verdict.cls==='success'){
            applyStageChange(me.digimon, me.digimon.stage, me.digimon.defaultStage);
            outcomeText = `Successo! Torna al Default Stage (${me.digimon.defaultStage}) â Stat aggiornate.`;
          } else if(verdict.cls==='crit-fail'){
            outcomeText = `Fallimento Critico! Il Digimon regredisce a Digitama come se fosse stato sconfitto (gestire a mano).`;
          } else {
            const revertIdx = Math.max(0, stageIndex(me.digimon.defaultStage)-1);
            applyStageChange(me.digimon, me.digimon.stage, STAGES[revertIdx]);
            outcomeText = `Fallimento. Scende a ${STAGES[revertIdx]} (sotto il Default Stage) e non puÃ² Evolvere per il resto del Combattimento.`;
          }
          await saveMember(session.code, me);
          await pushPlayerNarration(session.code, me, { who: displayName(me), role:'roll', text: `ð¥ Blast Evolution a ${target} â Willpower Check (TN ${tn}): 3d6[${dice.join(',')}] + Willpower ${willVal} = ${total} â ${outcomeText} (Usi rimasti: ${me.digimon.blastEvolutionUses})`, meta:{ dice } });
          statusEl.style.color='var(--text-mute)'; statusEl.textContent = outcomeText;
          renderDigimonCard(me, containerId, onChanged, renderTamerCardFn);
          if(renderTamerCardFn) renderTamerCardFn(me, siblingCardId(containerId,'tamer'));
          if(onChanged) onChanged();
        };
      }
      const slideBtn = document.getElementById('btn-slide-evolve-'+containerId);
      if(slideBtn){
        slideBtn.onclick = async ()=>{
          const newName = document.getElementById('slide-name-'+containerId).value.trim();
          const woundDiff = Number(document.getElementById('slide-wounddiff-'+containerId).value)||0;
          const statusEl = document.getElementById('slide-status-'+containerId);
          if(!newName){ statusEl.textContent = 'Inserisci il nome della forma alternativa.'; return; }
          if(Number(me.digimon.evolutionPoints||0) < 1){ statusEl.textContent = 'Serve almeno 1 Evolution Point.'; return; }
          me.digimon.evolutionPoints = Number(me.digimon.evolutionPoints||0) - 1;
          me.digimon.name = newName;
          if(woundDiff !== 0){
            me.digimon.maxWounds = Math.max(1, Number(me.digimon.maxWounds||1) + woundDiff);
            me.digimon.currentWounds = Math.max(0, Math.min(me.digimon.maxWounds, Number(me.digimon.currentWounds||0) + woundDiff));
          }
          await saveMember(session.code, me);
          await pushPlayerNarration(session.code, me, { who: displayName(me), role:'player', text: `ð ${me.digimon.name} usa Slide Evolution (stesso Stage, 1 Evolution Point speso)${woundDiff!==0?`, Ferite Massime ${woundDiff>0?'+':''}${woundDiff}`:''}.` });
          statusEl.style.color='var(--text-mute)'; statusEl.textContent = `Slide Evolution completata: ora sei ${newName}.`;
          renderDigimonCard(me, containerId, onChanged, renderTamerCardFn);
          if(onChanged) onChanged();
        };
      }
      const darkStartBtn = document.getElementById('btn-dark-evolve-start-'+containerId);
      if(darkStartBtn){
        darkStartBtn.onclick = async ()=>{
          const target = document.getElementById('dark-target-'+containerId).value;
          const statusEl = document.getElementById('dark-status-'+containerId);
          applyStageChange(me.digimon, me.digimon.stage, target);
          me.digimon.darkEvolutionActive = true;
          if(!me.digimon.qualities) me.digimon.qualities = [];
          if(!me.digimon.qualities.some(q=>q.mechanic==='combatMonster')){
            me.digimon.qualities.push({ name:'Combat Monster (Dark Evolution, gratis)', cost:0, category:'Static', description:'Ottenuta gratis con Dark Evolution, giÃ  al massimo del Resolve.', mechanic:'combatMonster', rank:3 });
          }
          me.digimon.resolveCurrent = me.digimon.resolveMax || 4;
          await saveMember(session.code, me);
          await pushPlayerNarration(session.code, me, { who:'Sistema', role:'gm', text: `ð ${me.digimon.name} subisce Dark Evolution! Il Master ne prende il controllo: attacca chiunque si muova finchÃ© non sconfigge tutti, viene sconfitto, passano ${target} turni, o il Tamer supera un Check Willpower TN 20. Il Tamer guadagna 1 nuovo Torment (Marked pari allo Stage).` });
          statusEl.style.color='var(--danger)'; statusEl.textContent = 'Dark Evolution attiva.';
          renderDigimonCard(me, containerId, onChanged, renderTamerCardFn);
          if(onChanged) onChanged();
        };
      }
      const darkEndBtn = document.getElementById('btn-dark-evolve-end-'+containerId);
      if(darkEndBtn){
        darkEndBtn.onclick = async ()=>{
          const statusEl = document.getElementById('dark-status-'+containerId);
          applyStageChange(me.digimon, me.digimon.stage, me.digimon.defaultStage);
          me.digimon.darkEvolutionActive = false;
          await saveMember(session.code, me);
          await pushPlayerNarration(session.code, me, { who:'Sistema', role:'gm', text: `${me.digimon.name} rientra dalla Dark Evolution, tornando a ${me.digimon.defaultStage}.` });
          statusEl.style.color='var(--text-mute)'; statusEl.textContent = 'Dark Evolution terminata.';
          renderDigimonCard(me, containerId, onChanged, renderTamerCardFn);
          if(onChanged) onChanged();
        };
      }
      document.querySelectorAll(`[data-armor-use]`).forEach(btn=>{
        btn.onclick = async ()=>{
          const idx = Number(btn.getAttribute('data-armor-use'));
          const af = me.digimon.armorForms[idx];
          if(!af || af.usedThisRest) return;
          applyStageChange(me.digimon, me.digimon.stage, af.stage);
          if(!me.digimon.qualities) me.digimon.qualities = [];
          (af.qualities||[]).forEach(q=>{
            me.digimon.qualities.push({ ...q, armorSource: af.name });
          });
          af.usedThisRest = true;
          await saveMember(session.code, me);
          await pushPlayerNarration(session.code, me, { who: displayName(me), role:'player', text: `${me.digimon.name||'Il Digimon'} usa il Digimental "${af.digimentalName}" per Armor Evolvere in ${af.name} (${af.stage}, 0 Evolution Points).` });
          renderDigimonCard(me, containerId, onChanged, renderTamerCardFn);
          if(onChanged) onChanged();
        };
      });
      document.querySelectorAll(`[data-armor-revert]`).forEach(btn=>{
        btn.onclick = async ()=>{
          const idx = Number(btn.getAttribute('data-armor-revert'));
          const af = me.digimon.armorForms[idx];
          if(!af) return;
          applyStageChange(me.digimon, me.digimon.stage, me.digimon.defaultStage);
          me.digimon.qualities = (me.digimon.qualities||[]).filter(q=>q.armorSource!==af.name);
          await saveMember(session.code, me);
          await pushPlayerNarration(session.code, me, { who: displayName(me), role:'player', text: `${me.digimon.name||'Il Digimon'} torna al Default Stage (${me.digimon.defaultStage}), lasciando la forma ${af.name}.` });
          renderDigimonCard(me, containerId, onChanged, renderTamerCardFn);
          if(onChanged) onChanged();
        };
      });
      cardEl.querySelectorAll('[data-pool]').forEach(btn=>{
        btn.onclick = async ()=>{
          const statKey = btn.getAttribute('data-pool');
          const statLabel = statKey==='baseAccuracy' ? 'Accuracy' : (statKey==='baseDodge' ? 'Dodge' : 'Health');
          const { dice, successes } = rollPool(d[statKey]);
          const resEl = document.getElementById('pool-roll-result-'+containerId);
          if(resEl) resEl.innerHTML = `${diceRowHTML(dice)}<span class="roll-total">${successes} successi</span>`;
          const logText = `Pool Check ${statLabel} (${d[statKey]}d6): [${dice.join(',')}] â ${successes} successi`;
          await pushPlayerNarration(session.code, me, { who: (d.name||displayName(me)), role:'roll', text: logText, meta: { dice, successes } });
          if(onChanged) onChanged();
        };
      });
    } else {
      cardEl.innerHTML = `
        <div class="section-title">Scheda Digimon â Modifica</div>
        <div class="field"><label>Nome</label><input type="text" id="e-d-name-${containerId}" value="${escapeAttr(d.name)}" /></div>
        <div class="field"><label>URL Immagine (opzionale)</label><input type="text" id="e-d-img-${containerId}" value="${escapeAttr(d.imageUrl)}" placeholder="https://..." /></div>
        <div class="field"><label>Stage</label>
          <select id="e-d-stage-${containerId}">${['Baby','Rookie','Champion','Ultimate','Mega'].map(s=>`<option ${d.stage===s?'selected':''}>${s}</option>`).join('')}</select>
        </div>
        <div class="row">
          <div class="field"><label>Ferite Massime</label><input type="number" id="e-d-maxw-${containerId}" value="${d.maxWounds}" /></div>
          <div class="field"><label>MP Massimi</label><input type="number" id="e-d-maxmp-${containerId}" value="${d.maxMp}" /></div>
        </div>
        <div class="field"><label>PersonalitÃ  (usata dal Master per le battute)</label><textarea id="e-d-personality-${containerId}" rows="3">${escapeHTML(d.personality)}</textarea></div>
        <label style="font-size:11px;display:flex;align-items:center;gap:6px;margin:6px 0;"><input type="checkbox" id="e-d-hybrid-${containerId}" ${d.hybridMode?'checked':''} /> ð Hybrid/Bio-Merge Mode (3 Azioni in combattimento, Tamer e Digimon sono un'unica entitÃ )</label>
        <div class="row">
          <div class="field"><label>Size</label>
            <select id="e-d-size-${containerId}">${allowedSizes(d.stage).map(s=>`<option ${d.size===s?'selected':''}>${s}</option>`).join('')}</select>
          </div>
          <div class="field"><label>Stance</label>
            <select id="e-d-stance-${containerId}">
              <option ${d.stance==='Neutral'?'selected':''}>Neutral</option>
              <option ${d.stance==='Offensive'?'selected':''}>Offensive</option>
              <option ${d.stance==='Defensive'?'selected':''}>Defensive</option>
              <option ${d.stance==='Fierce'?'selected':''}>Fierce</option>
              <option ${d.stance==='Brave'?'selected':''}>Brave</option>
              <option ${d.stance==='Sentry'?'selected':''}>Sentry</option>
              <option ${d.stance==='Martial'?'selected':''}>Martial</option>
              <option ${d.stance==='Anticipate'?'selected':''}>Anticipate</option>
            </select>
          </div>
          <div class="field" style="max-width:70px;"><label>Colore Chat</label><input type="color" id="e-d-color-${containerId}" value="${d.chatColor||'#c896ff'}" style="padding:2px;height:38px;" /></div>
        </div>
        <div class="divider"></div>
        <div class="muted" style="margin-bottom:6px;">Stat Base (Combattimento) â le Stat Derivate (BIT/DOS/RAM/CPU) si calcolano da sole</div>
        <div class="row">
          <div class="field"><label>Accuracy</label><input type="number" id="e-d-acc-${containerId}" value="${d.baseAccuracy}" min="0" /></div>
          <div class="field"><label>Damage</label><input type="number" id="e-d-dmg-${containerId}" value="${d.baseDamage}" min="0" /></div>
        </div>
        <div class="row">
          <div class="field"><label>Dodge</label><input type="number" id="e-d-dodge-${containerId}" value="${d.baseDodge}" min="0" /></div>
          <div class="field"><label>Armor</label><input type="number" id="e-d-arm-${containerId}" value="${d.baseArmor}" min="0" /></div>
        </div>
        <div class="field"><label>Health (base)</label><input type="number" id="e-d-hp-${containerId}" value="${d.baseHealth}" min="0" /></div>
        <div class="divider"></div>
        <div class="flex-between" style="margin-bottom:6px;">
          <span class="muted">Attacchi (Tag: [MELEE]/[RANGE] + [DAMAGE]/[SUPPORT])</span>
          <span class="mono" id="atk-slots-${containerId}" style="font-size:11px;"></span>
        </div>
        <div id="atk-list-${containerId}"></div>
        <div class="row">
          <input type="text" id="atk-name-${containerId}" placeholder="Nome Attacco" style="flex:2;" />
          <select id="atk-shape-${containerId}" style="flex:1;"><option>Melee</option><option>Range</option></select>
          <select id="atk-type-${containerId}" style="flex:1;"><option>Damage</option><option>Support</option></select>
          <select id="atk-reach-${containerId}" style="flex:1;"><option value="1">Portata 1 zona</option><option value="2">Portata 2 zone</option></select>
        </div>
        <div class="row" style="margin-top:6px;">
          <select id="atk-effect-${containerId}" style="flex:1;">
            <option value="">â nessun Effetto â</option>
            ${EFFECT_DEFS.map(e=>`<option value="${e.key}">${e.label}</option>`).join('')}
          </select>
          <input type="text" id="atk-extra-${containerId}" placeholder="Altri Tag (es. [WEAPON 2])" style="flex:1;" />
        </div>
        <div class="row" style="margin-top:6px;">
          <input type="text" id="atk-desc-${containerId}" placeholder="Descrizione breve" style="flex:2;" />
          <label style="display:flex;align-items:center;gap:4px;font-size:11px;flex:1;"><input type="checkbox" id="atk-sig-${containerId}" /> Signature Move</label>
          <label style="display:flex;align-items:center;gap:4px;font-size:11px;flex:1;"><input type="checkbox" id="atk-area-${containerId}" /> Area Attack</label>
          <button class="btn small" id="btn-atk-add-${containerId}" style="flex:1;">Aggiungi</button>
        </div>
        <div class="err" id="atk-add-err-${containerId}" style="margin-top:4px;"></div>
        <div class="divider"></div>
        <div class="muted" style="margin-bottom:6px;">Evoluzione</div>
        <div class="row">
          <div class="field"><label>Default Stage</label>
            <select id="e-d-defstage-${containerId}">${STAGES.map(s=>`<option ${d.defaultStage===s?'selected':''}>${s}</option>`).join('')}</select>
          </div>
          <div class="field"><label>Default Range</label><input type="number" id="e-d-defrange-${containerId}" value="${d.defaultRange||1}" min="0" /></div>
          <div class="field"><label>Evolution Points</label><input type="number" id="e-d-evopts-${containerId}" value="${d.evolutionPoints||0}" min="0" /></div>
        </div>
        <div class="row">
          <div class="field"><label>Attributo (Variant Rule 2.05c)</label>
            <span style="display:inline-flex;align-items:center;gap:8px;">
              <select id="e-d-attribute-${containerId}">
                ${['Vaccine','Data','Virus','Free','Variable'].map(a=>`<option ${d.attribute===a?'selected':''}>${a}</option>`).join('')}
              </select>
              <span id="e-d-attribute-icon-${containerId}">${attributeIconHTML(d.attribute, 20)}</span>
            </span>
            ${attributeLegendHTML()}
          </div>
        </div>
        <div class="divider"></div>
        <div class="muted" style="margin-bottom:6px;">ð¡ï¸ Armor Forms</div>
        <div id="armor-list-${containerId}"></div>
        <div class="row">
          <input type="text" id="armor-name-${containerId}" placeholder="Nome Armor Form" style="flex:2;" />
          <input type="text" id="armor-digimental-${containerId}" placeholder="Nome Digimental" style="flex:2;" />
          <select id="armor-stage-${containerId}" style="flex:1;">${STAGES.map(s=>`<option>${s}</option>`).join('')}</select>
        </div>
        <div class="row" style="margin-top:6px;">
          <select id="armor-qual-catalog-${containerId}" style="flex:2;">
            <option value="">â nessuna Quality da aggiungere â</option>
            ${QUALITY_CATALOG.map((q,qi)=>`<option value="${qi}">${escapeHTML(q.name)} (${q.dpPerRank} DP)</option>`).join('')}
          </select>
          <button class="btn small" id="btn-armor-qual-add-${containerId}" style="flex:1;">+ Quality</button>
          <button class="btn amber small" id="btn-armor-add-${containerId}" style="flex:1;">Salva Armor Form</button>
        </div>
        <div class="muted" id="armor-qual-draft-${containerId}" style="margin-top:4px;"></div>
        <div class="divider"></div>
        <div class="field"><label>DP Totali</label><input type="number" id="e-d-dptotal-${containerId}" value="${d.dpTotal||0}" min="0" /></div>
        <div class="field"><label>Resolve Massimo</label><input type="number" id="e-d-resmax-${containerId}" value="${d.resolveMax||4}" min="0" /></div>
        <div class="muted" style="margin-bottom:6px;">Qualities</div>
        <div id="qual-list-${containerId}">${qualitiesEditableHTML(d.qualities)}</div>
        <div class="row">
          <select id="e-d-qual-catalog-${containerId}" style="flex:2;">
            <option value="">â Quality personalizzata â</option>
            ${QUALITY_CATALOG.map((q,qi)=>`<option value="${qi}">${escapeHTML(q.name)} (${q.category}, ${q.dpPerRank} DP/Rank)</option>`).join('')}
          </select>
          <input type="number" id="e-d-qual-rank-${containerId}" value="1" min="1" placeholder="Rank" style="flex:1;" />
          <select id="e-d-qual-stat-${containerId}" style="flex:1;" title="Solo per Naturewalk: a quale Stat va il +1?">
            <option value="accuracy">+1 Accuracy</option>
            <option value="damage">+1 Damage</option>
            <option value="dodge">+1 Dodge</option>
            <option value="armor">+1 Armor</option>
            <option value="health">+1 Health (manuale)</option>
          </select>
        </div>
        <div class="row" style="margin-top:6px;">
          <input type="text" id="e-d-qual-name-${containerId}" placeholder="Nome (se personalizzata)" style="flex:2;" />
          <input type="number" id="e-d-qual-cost-${containerId}" placeholder="DP totali" value="1" style="flex:1;" />
        </div>
        <div class="row" style="margin-top:6px;">
          <input type="text" id="e-d-qual-cat-${containerId}" placeholder="Categoria (opz.)" style="flex:1;" />
          <input type="text" id="e-d-qual-desc-${containerId}" placeholder="Descrizione (opz.)" style="flex:2;" />
          <button class="btn small" id="btn-add-qual-${containerId}" style="flex:1;">Aggiungi</button>
        </div>
        <div class="row" style="margin-top:10px;">
          <button class="btn ghost" id="btn-cancel-digimon-${containerId}">Annulla</button>
          <button class="btn solid" id="btn-save-digimon-${containerId}">Salva</button>
        </div>
        <div class="muted" id="save-status-digimon-${containerId}" style="margin-top:6px;"></div>
      `;
      const renderAtkList = ()=>{
        const listEl = document.getElementById('atk-list-'+containerId);
        const slotsEl = document.getElementById('atk-slots-'+containerId);
        const maxSlots = maxAttackSlots(d);
        const count = (d.attacks||[]).length;
        const sigCount = (d.attacks||[]).filter(a=>a.signature).length;
        const extraCount = count - sigCount;
        const extraMax = Math.max(0, maxSlots - Math.max(sigCount,1));
        if(slotsEl){
          slotsEl.style.color = count>maxSlots ? 'var(--danger)' : 'var(--dchroma)';
          slotsEl.innerHTML = `â­ ${sigCount===0?'<span style="color:var(--danger);">nessuna</span>':sigCount} Â· Extra ${extraCount}/${extraMax}`;
        }
        listEl.innerHTML = (d.attacks||[]).length===0 ? '<div class="muted" style="margin-bottom:6px;">Nessun Attacco.</div>' : d.attacks.map((a,i)=>`
          <div class="flex-between" style="margin-bottom:6px;padding:4px 6px;${a.signature?'border:1px solid var(--dchroma);border-radius:4px;':''}">
            <span>${a.signature?'â­ ':''}<b>${escapeHTML(a.name)}</b>${a.signature?' <span class="tag" style="color:var(--dchroma);border-color:var(--dchroma);" title="Il giocatore puÃ² scegliere di dichiararla e spendere Battery per potenziarla â non Ã¨ automatico.">SIGNATURE MOVE</span>':''} ${attackTagsHTML(a)}</span>
            <button class="btn ghost small" data-rmatk="${i}">Rimuovi</button>
          </div>
        `).join('');
        if(count>maxSlots){
          listEl.innerHTML += `<div class="muted" style="color:var(--danger);margin-top:4px;">Sopra il limite per lo Stage attuale (${count} mosse totali su ${maxSlots} slot) â serve Memory Upgrade (Free Quality, +1 Attacco/Rank) per tenerne di piÃ¹, o rimuoverne uno.</div>`;
        }
        if(sigCount===0){
          listEl.innerHTML += `<div class="muted" style="margin-top:4px;">Nessuna Signature Move impostata â ogni Digimon dovrebbe averne almeno una (due se Jogress).</div>`;
        }
        listEl.querySelectorAll('[data-rmatk]').forEach(b=>{
          b.onclick = ()=>{ d.attacks.splice(Number(b.getAttribute('data-rmatk')),1); renderAtkList(); };
        });
      };
      renderAtkList();
      document.getElementById('btn-atk-add-'+containerId).onclick = ()=>{
        const errEl = document.getElementById('atk-add-err-'+containerId);
        if(errEl) errEl.textContent = '';
        const name = document.getElementById('atk-name-'+containerId).value.trim();
        if(!name) return;
        const shape = document.getElementById('atk-shape-'+containerId).value;
        const type = document.getElementById('atk-type-'+containerId).value;
        const effectKey = type==='Support' ? document.getElementById('atk-effect-'+containerId).value : '';
        if(effectKey && !hasEffectQuality(d, effectKey)){
          const def = EFFECT_DEFS.find(e=>e.key===effectKey);
          const reqName = EFFECT_QUALITY_MAP[effectKey];
          if(errEl) errEl.textContent = `Manca la Quality "${reqName}": acquistala prima di poter usare [${def?def.label.toUpperCase():effectKey}] su un Attacco.`;
          return;
        }
        const extraTags = document.getElementById('atk-extra-'+containerId).value.trim();
        const desc = document.getElementById('atk-desc-'+containerId).value.trim();
        const signature = document.getElementById('atk-sig-'+containerId).checked;
        if(!d.attacks) d.attacks = [];
        if(signature) d.attacks.forEach(a=>a.signature=false);
        const reach = shape==='Range' ? Number(document.getElementById('atk-reach-'+containerId).value)||1 : 0;
        const areaAttack = document.getElementById('atk-area-'+containerId).checked;
        d.attacks.push({ name, shape, type, effectKey, extraTags, desc, signature, reach, areaAttack });
        document.getElementById('atk-name-'+containerId).value='';
        document.getElementById('atk-extra-'+containerId).value='';
        document.getElementById('atk-desc-'+containerId).value='';
        document.getElementById('atk-sig-'+containerId).checked=false;
        document.getElementById('atk-area-'+containerId).checked=false;
        renderAtkList();
      };
      let armorDraftQualities = [];
      const renderArmorList = ()=>{
        const listEl = document.getElementById('armor-list-'+containerId);
        listEl.innerHTML = (d.armorForms||[]).length===0 ? '<div class="muted" style="margin-bottom:6px;">Nessuna Armor Form.</div>' : d.armorForms.map((af,i)=>`
          <div class="flex-between" style="margin-bottom:6px;">
            <span><b>${escapeHTML(af.name)}</b> <span class="muted">(${escapeHTML(af.digimentalName)}, ${af.stage}${af.qualities&&af.qualities.length?`, ${af.qualities.map(q=>q.name).join('+')}`:''})</span></span>
            <button class="btn ghost small" data-rmarmor="${i}">Rimuovi</button>
          </div>
        `).join('');
        listEl.querySelectorAll('[data-rmarmor]').forEach(b=>{
          b.onclick = ()=>{ d.armorForms.splice(Number(b.getAttribute('data-rmarmor')),1); renderArmorList(); };
        });
      };
      renderArmorList();
      const drawArmorQualDraft = ()=>{
        document.getElementById('armor-qual-draft-'+containerId).textContent = armorDraftQualities.length
          ? 'Qualities pronte da salvare: ' + armorDraftQualities.map(q=>q.name).join(', ')
          : '';
      };
      document.getElementById('btn-armor-qual-add-'+containerId).onclick = ()=>{
        const sel = document.getElementById('armor-qual-catalog-'+containerId);
        if(sel.value==='') return;
        const q = QUALITY_CATALOG[Number(sel.value)];
        armorDraftQualities.push({ name:q.name, cost:q.dpPerRank, category:q.category, description:q.desc, mechanic:q.mechanic, rank:1 });
        sel.value='';
        drawArmorQualDraft();
      };
      document.getElementById('btn-armor-add-'+containerId).onclick = ()=>{
        const name = document.getElementById('armor-name-'+containerId).value.trim();
        const digimentalName = document.getElementById('armor-digimental-'+containerId).value.trim();
        const stage = document.getElementById('armor-stage-'+containerId).value;
        if(!name || !digimentalName) return;
        if(!d.armorForms) d.armorForms = [];
        d.armorForms.push({ name, digimentalName, stage, qualities: armorDraftQualities, usedThisRest:false });
        armorDraftQualities = [];
        document.getElementById('armor-name-'+containerId).value='';
        document.getElementById('armor-digimental-'+containerId).value='';
        drawArmorQualDraft();
        renderArmorList();
      };
      const STAT_TARGET_TO_INPUTID = { accuracy:'acc', damage:'dmg', dodge:'dodge', armor:'arm', health:'hp' };
      // Naturewalk/Instinct danno un +1 "gratis" a una Stat â questa funzione lo applica per davvero
      // alla casella visibile (e, se tocca Health, ricalcola anche Ferite Massime = Indice Stage +
      // HealthÃ2). Il Salva legge queste caselle cosÃ¬ com'Ã¨: senza toccarle qui, il bonus resterebbe
      // solo sulla carta e Ferite Massime non si aggiornerebbe mai.
      const applyQualityStatBonusToForm = (entry, sign)=>{
        if(!entry) return;
        let targetKey = null;
        if(entry.mechanic==='naturewalk' && entry.statTarget) targetKey = entry.statTarget;
        else if(entry.mechanic==='instinct') targetKey = 'dodge';
        if(!targetKey) return;
        const suffix = STAT_TARGET_TO_INPUTID[targetKey];
        const inp = suffix && document.getElementById(`e-d-${suffix}-${containerId}`);
        if(!inp) return;
        const amount = (Number(entry.rank)||1) * sign;
        inp.value = Math.max(0, (Number(inp.value)||0) + amount);
        if(targetKey==='health'){
          const maxwInp = document.getElementById('e-d-maxw-'+containerId);
          const stageSel = document.getElementById('e-d-stage-'+containerId);
          if(maxwInp && stageSel){
            maxwInp.value = stageIndex(stageSel.value) + Number(inp.value)*2;
          }
        }
      };
      const bindQualRemove = ()=>{
        document.querySelectorAll(`#qual-list-${containerId} [data-rmquality]`).forEach(b=>{
          b.onclick = ()=>{
            const idx = Number(b.getAttribute('data-rmquality'));
            const removed = d.qualities[idx];
            applyQualityStatBonusToForm(removed, -1);
            d.qualities.splice(idx,1);
            document.getElementById('qual-list-'+containerId).innerHTML = qualitiesEditableHTML(d.qualities);
            bindQualRemove();
          };
        });
      };
      bindQualRemove();
      document.getElementById('btn-add-qual-'+containerId).onclick = ()=>{
        const catalogIdx = document.getElementById('e-d-qual-catalog-'+containerId).value;
        const rank = Math.max(1, Number(document.getElementById('e-d-qual-rank-'+containerId).value)||1);
        let name, cost, category, description, mechanic='';
        if(catalogIdx !== ''){
          const q = QUALITY_CATALOG[Number(catalogIdx)];
          if(!q) return;
          const clampedRank = Math.min(q.maxRank, rank);
          const statTarget = document.getElementById('e-d-qual-stat-'+containerId).value;
          const statLabels = { accuracy:'Accuracy', damage:'Damage', dodge:'Dodge', armor:'Armor', health:'Health (manuale)' };
          name = `${q.name}${q.maxRank>1?` (Rank ${clampedRank})`:''}${q.mechanic==='naturewalk'?` [+1 ${statLabels[statTarget]}]`:''}`;
          cost = q.dpPerRank * clampedRank;
          category = q.category;
          description = q.desc;
          mechanic = q.mechanic;
          if(!d.qualities) d.qualities = [];
          const qualityEntry = { name, cost, category, description, mechanic, rank: clampedRank };
          if(q.mechanic==='naturewalk') qualityEntry.statTarget = statTarget;
          d.qualities.push(qualityEntry);
          applyQualityStatBonusToForm(qualityEntry, 1);
        } else {
          name = document.getElementById('e-d-qual-name-'+containerId).value.trim();
          if(!name) return;
          cost = Number(document.getElementById('e-d-qual-cost-'+containerId).value)||0;
          category = document.getElementById('e-d-qual-cat-'+containerId).value.trim();
          description = document.getElementById('e-d-qual-desc-'+containerId).value.trim();
          if(!d.qualities) d.qualities = [];
          d.qualities.push({ name, cost, category, description });
        }
        document.getElementById('e-d-qual-name-'+containerId).value='';
        document.getElementById('e-d-qual-cost-'+containerId).value='1';
        document.getElementById('e-d-qual-cat-'+containerId).value='';
        document.getElementById('e-d-qual-desc-'+containerId).value='';
        document.getElementById('e-d-qual-rank-'+containerId).value='1';
        document.getElementById('qual-list-'+containerId).innerHTML = qualitiesEditableHTML(d.qualities);
        bindQualRemove();
      };
      document.getElementById('btn-cancel-digimon-'+containerId).onclick = ()=>{ editingDigimon = false; renderDigimonCard(me, containerId, onChanged, renderTamerCardFn); };
      document.getElementById('btn-save-digimon-'+containerId).onclick = async ()=>{
        me.digimon.name = document.getElementById('e-d-name-'+containerId).value;
        me.digimon.imageUrl = document.getElementById('e-d-img-'+containerId).value.trim();
        me.digimon.stage = document.getElementById('e-d-stage-'+containerId).value;
        me.digimon.maxWounds = Number(document.getElementById('e-d-maxw-'+containerId).value)||1;
        me.digimon.maxMp = Number(document.getElementById('e-d-maxmp-'+containerId).value)||0;
        me.digimon.personality = document.getElementById('e-d-personality-'+containerId).value;
        me.digimon.hybridMode = document.getElementById('e-d-hybrid-'+containerId).checked;
        me.digimon.size = document.getElementById('e-d-size-'+containerId).value;
        me.digimon.stance = document.getElementById('e-d-stance-'+containerId).value;
        me.digimon.chatColor = document.getElementById('e-d-color-'+containerId).value;
        me.digimon.baseAccuracy = Number(document.getElementById('e-d-acc-'+containerId).value)||0;
        me.digimon.baseDamage = Number(document.getElementById('e-d-dmg-'+containerId).value)||0;
        me.digimon.baseDodge = Number(document.getElementById('e-d-dodge-'+containerId).value)||0;
        me.digimon.baseArmor = Number(document.getElementById('e-d-arm-'+containerId).value)||0;
        me.digimon.baseHealth = Number(document.getElementById('e-d-hp-'+containerId).value)||0;
        me.digimon.defaultStage = document.getElementById('e-d-defstage-'+containerId).value;
        me.digimon.defaultRange = Number(document.getElementById('e-d-defrange-'+containerId).value)||0;
        me.digimon.attribute = document.getElementById('e-d-attribute-'+containerId).value;
        me.digimon.evolutionPoints = Number(document.getElementById('e-d-evopts-'+containerId).value)||0;
        me.digimon.dpTotal = Number(document.getElementById('e-d-dptotal-'+containerId).value)||0;
        me.digimon.resolveMax = Number(document.getElementById('e-d-resmax-'+containerId).value)||0;
        if(me.digimon.resolveCurrent > me.digimon.resolveMax) me.digimon.resolveCurrent = me.digimon.resolveMax;
        me.digimon.qualities = d.qualities || [];
        if(me.digimon.currentWounds > me.digimon.maxWounds) me.digimon.currentWounds = me.digimon.maxWounds;
        if(me.digimon.currentMp > me.digimon.maxMp) me.digimon.currentMp = me.digimon.maxMp;
        // Fissa Nome/Immagine/Stat appena modificati sullo Stage attivo, altrimenti al prossimo
        // switch/Evoluzione applyStageChange li sovrascrive con i valori vecchi salvati per quello Stage.
        snapshotCurrentStatsToStage(me.digimon, me.digimon.stage);
        const ok = await saveMember(session.code, me);
        const st = document.getElementById('save-status-digimon-'+containerId);
        st.style.color = ok ? 'var(--text-mute)' : 'var(--danger)';
        st.textContent = ok ? 'Salvato.' : ('Errore: '+(lastApiError||''));
        if(ok){ editingDigimon = false; renderDigimonCard(me, containerId, onChanged, renderTamerCardFn); }
      };
    }
  }
