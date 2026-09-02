// js/combat-engine.js
// Logica di combattimento pura: nessuna chiamata API, nessun accesso al DOM, nessuna persistenza
// (niente saveMember/saveCombat qui dentro). Legge solo cachedRoster (globale da store.js) e le
// funzioni di js/rules.js (STAGES/stageIndex/stanceModifiers/batteryCap/computeQualityMechanics),
// entrambi caricati prima di questo file.
//
// Cosa e' rimasto INVECE dentro index.html, deliberatamente: tutto cio' che chiama saveMember,
// saveCombat o tocca il DOM (applyInstantEffect, applyDefeatIfNeeded, renderCombatManager e la
// UI di combattimento in generale, trySpendAction/ACTION_DEFS -- economia delle Azioni, non
// puramente matematica). Quelle restano nel file grande finche' non arrivera' una fase dedicata
// a loro, con lo stesso livello di audit fatto qui.
//
// Script classico (non un modulo ES), caricato dopo js/rules.js e prima del blocco <script>
// principale in index.html -- restano funzioni/costanti globali esattamente come quando vivevano
// nella stessa IIFE del file grande, nessun cambiamento di comportamento.

  function buildInitiativeOrder(participants){
    const sideA = participants.filter(p=>p.side==='ally').slice().sort((a,b)=>b.initiative-a.initiative);
    const sideB = participants.filter(p=>p.side==='enemy').slice().sort((a,b)=>b.initiative-a.initiative);
    const order = [];
    let qA = sideA.slice(), qB = sideB.slice();
    let currentSide = (qA[0] ? qA[0].initiative : -Infinity) >= (qB[0] ? qB[0].initiative : -Infinity) ? 'A' : 'B';
    while(qA.length || qB.length){
      if(currentSide==='A'){
        if(qA.length){ order.push(qA.shift()); currentSide = 'B'; }
        else { order.push(qB.shift()); }
      } else {
        if(qB.length){ order.push(qB.shift()); currentSide = 'A'; }
        else { order.push(qA.shift()); }
      }
    }
    return order.map(p=>p.id);
  }
  function defaultCombat(){
    return { active:false, round:1, currentIndex:0, participants:[], order:[], startZoneAlly:'Molto Corto', startZoneEnemy:'Molto Lungo' };
  }
  // ---------- turn gating helpers (self-service player actions) ----------
  function currentTurnParticipant(combat){
    if(!combat || !combat.active || !combat.order || combat.order.length===0) return null;
    const id = combat.order[combat.currentIndex];
    return (combat.participants||[]).find(x=>x.id===id) || null;
  }
  function isMyCombatTurn(combat, username){
    const p = currentTurnParticipant(combat);
    return !!(p && p.isPC && p.username===username);
  }
  // Avanza il turno / termina il combattimento — condiviso tra il pannello "Combattimento" (in alto)
  // e "Gestione Combattimento" più sotto, così i controlli funzionano identici da entrambi i punti.
  function isParticipantDefeated(p){
    if(!p) return false;
    if(p.isPC){
      const member = cachedRoster.find(m=>m.username===p.username);
      return !!(member && member.digimon.defeated);
    }
    return !!p.defeated;
  }
  function recalcCombatOrder(combat){
    combat.order = buildInitiativeOrder(combat.participants);
    combat.currentIndex = 0;
    combat.round = 1;
    combat.participants.forEach(p=>{
      const pMember = p.isPC ? cachedRoster.find(m=>m.username===p.username) : null;
      p.actions = (pMember && pMember.digimon.hybridMode) ? 3 : 2;
      p.attackedThisRound = false;
      // Pool separato del Tamer (Indice Regole 9.01: "ogni partecipante guadagna 2 Azioni --
      // Tamer e Digimon separatamente"). Ogni elemento di combat.participants rappresenta un
      // Digimon (agganciato al proprio Tamer via username per i PC): p.actions resta il pool del
      // Digimon, p.tamerActions il pool separato del suo Tamer -- vedi trySpendAction/ACTION_DEFS
      // in index.html e claude/audit-regolamento-dda2e.md, Addendum 3.
      p.tamerActions = 2;
      p.attackedThisRoundTamer = false;
    });
  }
  function getParticipantBattery(p){
    if(!p.isPC) return null; // Battery è una risorsa da Partner Digimon: i Nemici normalmente non la usano
    const member = cachedRoster.find(m=>m.username===p.username);
    if(!member) return null;
    return { current: Number(member.digimon.battery||0), max: batteryCap(member.digimon.stage) };
  }
  // Le zone sono un'unica linea condivisa con 5 posizioni (o——o——o——o——o): ogni pallino È una zona
  // per il regolamento — niente conversioni, Melee = stessa posizione, Reach 1/2 = distanza in pallini,
  // penalità -2/-4 dirette sulla distanza. Un "Muovi" sposta di 1 pallino = 1 zona.
  // "Medio" resta il centro esatto (indice 2 su 5), quindi i fallback "||'Medio'" restano validi.
  const ZONES = ['Molto Corto','Corto','Medio','Lungo','Molto Lungo'];
  function zoneIndex(z){ const i = ZONES.indexOf(z); return i<0?2:i; }
  function zoneDistance(a,b){ return Math.abs(zoneIndex(a)-zoneIndex(b)); }
  function zonePenalty(distance){ if(distance<=0) return 0; if(distance===1) return -2; return -4; }
  // Etichetta numerica per la UI ("Range 3") invece del nome assoluto ("Medio") — i nomi sono relativi
  // e da soli non dicono nulla; il numero di posizione è più chiaro e coerente con "distanza in zone".
  function zoneLabel(z){ return 'Range ' + (zoneIndex(z)+1); }
  // Muovi di un solo pallino lungo la linea, in riferimento a un altro partecipante.
  function zoneStepToward(fromZone, refZone){
    const fi = zoneIndex(fromZone), ri = zoneIndex(refZone);
    if(fi===ri) return null; // già alla stessa posizione, "avvicinati" non ha effetto
    return ZONES[fi + (ri>fi?1:-1)];
  }
  function zoneStepAway(fromZone, refZone){
    const fi = zoneIndex(fromZone), ri = zoneIndex(refZone);
    const dir = (ri>=fi) ? -1 : 1; // se pari, per default ci si allontana verso "Molto Corto"
    const ni = fi + dir;
    if(ni<0 || ni>ZONES.length-1) return null; // già al limite (non si può allontanare oltre)
    return ZONES[ni];
  }
  // Muovi di N pallini in una direzione fissa (usato dalle frecce sotto la linea) — clampato ai limiti.
  function zoneStepDirection(fromZone, dir){
    const fi = zoneIndex(fromZone);
    const ni = fi + (dir>0?1:-1);
    if(ni<0 || ni>ZONES.length-1) return null;
    return ZONES[ni];
  }

  // Le zone sono un unico asse condiviso (Corto-Medio-Lungo), non una distanza per ogni coppia:
  // avvicinarsi a uno può avvicinare o allontanare da tutti gli altri, a seconda di dove si trovano
  // sullo stesso asse. Segnala l'effetto collaterale su chiunque non sia il riferimento scelto.
  function zoneSideEffectsNote(participants, movingId, refId, beforeZone, afterZone){
    const notes = [];
    participants.forEach(o=>{
      if(o.id===movingId || o.id===refId) return;
      const before = zoneDistance(beforeZone, o.zone||'Medio');
      const after = zoneDistance(afterZone, o.zone||'Medio');
      if(after<before) notes.push(`si avvicina anche a ${o.name}`);
      else if(after>before) notes.push(`si allontana da ${o.name}`);
    });
    return notes.length ? ` — ${notes.join(', ')}` : '';
  }
  function getParticipantAttacks(p){
    if(!p) return [];
    if(p.isPC){
      const member = cachedRoster.find(m=>m.username===p.username);
      return (member && member.digimon.attacks) || [];
    }
    return p.attacks || [];
  }
  function getParticipantWounds(p){
    if(p.isPC){
      const member = cachedRoster.find(m=>m.username===p.username);
      if(member) return { current: member.digimon.currentWounds, max: member.digimon.maxWounds, temp: Number(member.digimon.tempWounds||0) };
    }
    return { current: p.currentWounds||0, max: p.maxWounds||1, temp: Number(p.tempWounds||0) };
  }

  const EFFECT_ICONS = { fear:'😨', slow:'🐌', frail:'🛡️💔', dull:'⚔️💔', confuse:'💫', distract:'👀', keen:'🎯', swift:'💨', sturdy:'🛡️', sharpen:'⚔️✨', nimble:'🤸', burn:'🔥', poison:'☠️', exploit:'🔓', fury:'😡', pacify:'🕊️', debilitate:'⬇️', bastion:'🏰', daring:'🗡️', taunt:'😤', root:'🌱', pull:'⬅️', push:'➡️', cleanse:'✨', shield:'🛡', lag:'⏪', lead:'⏩', tailwind:'🌬️', vague:'❓', heavy:'⚓', freeze:'❄️', paralyze:'🚫', rattled:'😰', shaken:'😵', weak:'📉', strength:'💪', vigil:'👁️', vigor:'⚡', steady:'⚖️', regen:'💚', ruin:'🔻', doom:'💀', blind:'🙈', dot:'🔮', stun:'💥', immune:'🔰', deny:'🚫', haste:'🏃' };
  function effectIcon(key){ return EFFECT_ICONS[key] || '❔'; }
  // Spiegazione in linguaggio semplice generata dai dati meccanici già codificati per l'Effetto
  // (mods/blocksMove/tick/instant) — mostrata cliccando sull'icona di stato, invece di dover
  // ricordare a memoria cosa fa ogni singolo Tag.
  function effectExplanationText(def){
    if(!def) return 'Effetto sconosciuto.';
    const modLabels = { accuracy:'Accuracy', dodge:'Dodge', damage:'Damage', armor:'Armor' };
    const parts = Object.entries(def.mods||{}).map(([k,v])=>`${v>0?'+':''}${v} ${modLabels[k]||k}`);
    if(def.blocksMove) parts.push('blocca il Movimento');
    if(def.tick) parts.push('infligge il proprio effetto a inizio round (tick — gestito a mano)');
    if(def.instant) parts.push('si risolve subito quando applicato (istantaneo)');
    const mech = parts.length ? parts.join(', ') : 'nessun modificatore automatico alle Stat — effetto narrativo/da gestire a mano';
    return `${def.type==='positive'?'Effetto Positivo':'Effetto Negativo'}: ${mech}. I numeri tra parentesi sono Potenza e Durata (round rimasti).`;
  }

  // Varianti di testo già presenti nel Digidex che non coincidono esattamente con l'etichetta interna.
  const EFFECT_TAG_ALIASES = { 'CONFUSION': 'confuse' };

  const EFFECT_DEFS = [
    { key:'fear', label:'Fear', type:'negative', mods:{ accuracy:-1 } },
    { key:'slow', label:'Slow', type:'negative', mods:{ dodge:-1 } },
    { key:'frail', label:'Frail', type:'negative', mods:{ armor:-1 } },
    { key:'dull', label:'Dull', type:'negative', mods:{ damage:-1 } },
    { key:'confuse', label:'Confuse', type:'negative', mods:{ accuracy:-1, dodge:-1 } },
    { key:'distract', label:'Distract', type:'negative', mods:{ accuracy:-1, dodge:-1 } },
    { key:'keen', label:'Keen', type:'positive', mods:{ accuracy:1 } },
    { key:'swift', label:'Swift', type:'positive', mods:{ dodge:1 } },
    { key:'sturdy', label:'Sturdy', type:'positive', mods:{ armor:1 } },
    { key:'sharpen', label:'Sharpen', type:'positive', mods:{ damage:1 } },
    { key:'nimble', label:'Nimble', type:'positive', mods:{ accuracy:1, dodge:1 } },
    { key:'burn', label:'Burn', type:'negative', mods:{}, tick:true },
    { key:'poison', label:'Poison', type:'negative', mods:{}, tick:true },
    { key:'exploit', label:'Exploit', type:'negative', mods:{ dodge:-1, armor:-1 } },
    { key:'fury', label:'Fury', type:'positive', mods:{ accuracy:1, damage:1 } },
    { key:'pacify', label:'Pacify', type:'negative', mods:{ accuracy:-1, damage:-1 } },
    { key:'debilitate', label:'Debilitate', type:'negative', mods:{ accuracy:-1, damage:-1, dodge:-1, armor:-1 } },
    { key:'bastion', label:'Bastion', type:'positive', mods:{ accuracy:1, damage:1, dodge:1, armor:1 } },
    { key:'daring', label:'Daring', type:'positive', mods:{ accuracy:1, armor:1 } },
    { key:'taunt', label:'Taunt', type:'negative', mods:{ accuracy:-1 } },
    { key:'root', label:'Root', type:'negative', mods:{}, blocksMove:true },
    { key:'pull', label:'Pull', type:'negative', mods:{}, instant:'pull' },
    { key:'push', label:'Push', type:'negative', mods:{}, instant:'push' },
    { key:'cleanse', label:'Cleanse', type:'positive', mods:{}, instant:'cleanse' },
    { key:'shield', label:'Shield', type:'positive', mods:{}, instant:'shield' },
    { key:'lag', label:'Lag', type:'negative', mods:{} },
    { key:'lead', label:'Lead', type:'positive', mods:{} },
    { key:'tailwind', label:'Tailwind', type:'positive', mods:{} },
    { key:'vague', label:'Vague', type:'negative', mods:{ accuracy:-1 } },
    { key:'heavy', label:'Heavy', type:'negative', mods:{} },
    { key:'freeze', label:'Freeze', type:'negative', mods:{}, tick:true },
    { key:'paralyze', label:'Paralyze', type:'negative', mods:{ dodge:-1 } },
    { key:'rattled', label:'Rattled', type:'negative', mods:{ damage:-1, dodge:-1 } },
    { key:'shaken', label:'Shaken', type:'negative', mods:{ accuracy:-1, armor:-1 } },
    { key:'weak', label:'Weak', type:'negative', mods:{ damage:-1, armor:-1 } },
    { key:'strength', label:'Strength', type:'positive', mods:{ damage:1, armor:1 } },
    { key:'vigil', label:'Vigil', type:'positive', mods:{ dodge:1, armor:1 } },
    { key:'vigor', label:'Vigor', type:'positive', mods:{ dodge:1 } },
    { key:'steady', label:'Steady', type:'positive', mods:{ damage:1, dodge:1 } },
    { key:'regen', label:'Regen', type:'positive', mods:{} },
    { key:'ruin', label:'Ruin', type:'negative', mods:{}, tick:true },
    { key:'doom', label:'Doom', type:'negative', mods:{} },
    { key:'blind', label:'Blind', type:'negative', mods:{} },
    { key:'dot', label:'Dot', type:'negative', mods:{} },
    { key:'stun', label:'Stun', type:'negative', mods:{} },
    { key:'immune', label:'Immune', type:'positive', mods:{} },
    { key:'deny', label:'Deny', type:'positive', mods:{} },
    { key:'haste', label:'Haste', type:'positive', mods:{}, instant:'' }
  ];

  const EFFECT_QUALITY_MAP = {
    fear:'Basic Effect: Fear', slow:'Basic Effect: Slow', keen:'Basic Effect: Keen', swift:'Basic Effect: Swift',
    cleanse:'Basic Effect: Cleanse', root:'Basic Effect: Root', taunt:'Basic Effect: Taunt', push:'Basic Effect: Push', pull:'Basic Effect: Pull',
    lag:'Basic Effect: Lag', lead:'Basic Effect: Lead', tailwind:'Basic Effect: Tailwind', vague:'Basic Effect: Vague',
    confuse:'Advanced Effect: Confuse', distract:'Advanced Effect: Distract', dull:'Advanced Effect: Dull', frail:'Advanced Effect: Frail',
    sturdy:'Advanced Effect: Sturdy', sharpen:'Advanced Effect: Sharpen', nimble:'Advanced Effect: Nimble', exploit:'Advanced Effect: Exploit',
    burn:'Advanced Effect: Burn', poison:'Advanced Effect: Poison', shield:'Advanced Effect: Shield',
    heavy:'Advanced Effect: Heavy', freeze:'Advanced Effect: Freeze',
    fury:'Master Effect: Fury', pacify:'Master Effect: Pacify', debilitate:'Master Effect: Debilitate', bastion:'Master Effect: Bastion', daring:'Master Effect: Daring',
    paralyze:'Master Effect: Paralyze', rattled:'Master Effect: Rattled', shaken:'Master Effect: Shaken', weak:'Master Effect: Weak',
    strength:'Master Effect: Strength', vigil:'Master Effect: Vigil', vigor:'Master Effect: Vigor', steady:'Master Effect: Steady',
    regen:'Master Effect: Regen', ruin:'Master Effect: Ruin', doom:'Master Effect: Doom', blind:'Master Effect: Blind',
    dot:'Master Effect: Dot', stun:'Master Effect: Stun', immune:'Master Effect: Immune', deny:'Master Effect: Deny', haste:'Master Effect: Haste'
  };
  function hasAttributeAdvantage(atkAttr, defAttr){
    if(!atkAttr || !defAttr) return false;
    if(atkAttr==='Free' || defAttr==='Free' || atkAttr==='Variable' || defAttr==='Variable') return false;
    const table = { Vaccine:'Virus', Virus:'Data', Data:'Vaccine' };
    return table[atkAttr] === defAttr;
  }
  function getParticipantAttribute(p){
    if(p.isPC){
      const member = cachedRoster.find(m=>m.username===p.username);
      return member ? (member.digimon.attribute||'Free') : 'Free';
    }
    return p.attribute || 'Free';
  }
  function hasEffectQuality(d, effectKey){
    const required = EFFECT_QUALITY_MAP[effectKey];
    if(!required) return true; // no known requirement (e.g. custom/unlisted effect) — allow
    return (d.qualities||[]).some(q=>q.name===required);
  }
  function computeEffectModifiers(p){
    const mod = { accuracy:0, damage:0, dodge:0, armor:0 };
    let resistance = 0;
    if(p.isPC){
      const member = cachedRoster.find(m=>m.username===p.username);
      if(member) resistance = computeQualityMechanics(member.digimon.qualities).resistance;
    }
    (p.effects||[]).forEach(e=>{
      const def = EFFECT_DEFS.find(d=>d.key===e.key);
      if(!def) return;
      let potency = Number(e.potency||1);
      if(def.type==='negative' && resistance>0) potency = Math.max(1, potency - resistance);
      Object.keys(def.mods||{}).forEach(stat=>{
        mod[stat] += def.mods[stat] * potency;
      });
    });
    return mod;
  }

  function effectTagsHTML(p){
    if(!p.effects || p.effects.length===0) return '';
    return p.effects.map(e=>{
      const def = EFFECT_DEFS.find(d=>d.key===e.key);
      const color = def&&def.type==='positive'?'var(--cyan)':'var(--danger)';
      const borderColor = def&&def.type==='positive'?'var(--cyan-dim)':'rgba(255,93,93,0.4)';
      return `<details style="display:inline-block;margin:2px 4px 2px 0;vertical-align:top;">
        <summary class="tag" style="cursor:pointer;color:${color};border-color:${borderColor};">${effectIcon(e.key)} ${def?def.label:e.key} ${e.potency}(${e.duration})</summary>
        <div class="muted" style="font-size:10px;margin-top:2px;max-width:200px;">${escapeHTML(effectExplanationText(def))}</div>
      </details>`;
    }).join('');
  }

  async function tickEffectsForParticipant(code, combat, p){
    if(!p.effects || p.effects.length===0) return [];
    const logs = [];
    let resistance = 0;
    if(p.isPC){
      const member = cachedRoster.find(m=>m.username===p.username);
      if(member) resistance = computeQualityMechanics(member.digimon.qualities).resistance;
    }
    p.effects.forEach(e=>{
      const def = EFFECT_DEFS.find(d=>d.key===e.key);
      if(def && def.tick){
        const dmg = Math.max(1, Number(e.potency||1) - resistance);
        logs.push(`${p.name} subisce ${dmg} danno da ${def.label}${resistance>0?` (Resistance -${resistance})`:''}.`);
        applyDamageToParticipantSync(p, dmg);
      }
    });
    p.effects.forEach(e=>{ e.duration = Number(e.duration||1) - 1; });
    const expired = p.effects.filter(e=>e.duration<=0);
    expired.forEach(e=>{
      const def = EFFECT_DEFS.find(d=>d.key===e.key);
      logs.push(`${def?def.label:e.key} su ${p.name} è terminato.`);
    });
    p.effects = p.effects.filter(e=>e.duration>0);
    return logs;
  }

  function applyDamageToParticipantSync(p, amount){
    if(p.isPC){
      const member = cachedRoster.find(m=>m.username===p.username);
      if(member) member.digimon.currentWounds = Math.max(0, member.digimon.currentWounds - amount);
    } else {
      p.currentWounds = Math.max(0, (p.currentWounds||0) - amount);
    }
  }

  function getParticipantCombatStats(p){
    let base;
    let stanceMod = { accuracy:0, dodge:0, damage:0, armor:0 };
    let qMech = { certainStrike:0, weapon:0, ammoRank:0, combatMonster:0, monsterStrength:false };
    if(p.isPC){
      const member = cachedRoster.find(m=>m.username===p.username);
      base = member ? { accuracy: member.digimon.baseAccuracy, damage: member.digimon.baseDamage, dodge: member.digimon.baseDodge, armor: member.digimon.baseArmor } : { accuracy:0, damage:0, dodge:0, armor:0 };
      if(member){ stanceMod = stanceModifiers(member.digimon); qMech = computeQualityMechanics(member.digimon.qualities); }
    } else {
      base = { accuracy: p.accuracy||0, damage: p.damage||0, dodge: p.dodge||0, armor: p.armor||0 };
    }
    const mod = computeEffectModifiers(p);
    const nw = qMech.naturewalk || { accuracy:0, damage:0, dodge:0, armor:0 };
    const sc = qMech.supremeCode || 0;
    return {
      accuracy: Math.max(0, base.accuracy + mod.accuracy + stanceMod.accuracy + qMech.weapon + nw.accuracy + sc),
      damage: Math.max(0, base.damage + mod.damage + stanceMod.damage + qMech.weapon + nw.damage + sc),
      dodge: Math.max(0, base.dodge + mod.dodge + stanceMod.dodge + (qMech.instinctDodge||0) + nw.dodge + sc),
      armor: Math.max(0, base.armor + mod.armor + stanceMod.armor + (qMech.wardenArmor||0) + nw.armor + sc),
      certainStrike: qMech.certainStrike,
      combatMonsterRank: qMech.combatMonster,
      monsterStrength: qMech.monsterStrength,
      absoluteEvasion: qMech.absoluteEvasion||0
    };
  }

  function getParticipantResistance(p){
    if(p.isPC){
      const member = cachedRoster.find(m=>m.username===p.username);
      if(member) return computeQualityMechanics(member.digimon.qualities).resistance;
    }
    return 0;
  }

  function getParticipantSizeIndex(p){
    if(p.isPC){
      const member = cachedRoster.find(m=>m.username===p.username);
      if(member) return SIZES.indexOf(member.digimon.size) >=0 ? SIZES.indexOf(member.digimon.size) : 1;
    }
    return 1; // Medium default for enemies (Size not tracked for them)
  }
