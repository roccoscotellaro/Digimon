// js/combat-manager.js
// Combat Manager (vista Master del combattimento): renderCombatManager e le funzioni di supporto
// che usa direttamente (risoluzione attacchi, applicazione danni/sconfitte, effetti istantanei,
// guardia anti-race dei tap su mobile). Estratto da index.html.
//
// Dichiarato FUORI da qualunque IIFE (come js/store.js, js/api.js, js/tamer-card.js...): le
// variabili di stato locali (combatExpandedIds, combatPresetAttackerId, ecc.) diventano globali
// di script e restano leggibili/scrivibili esattamente come prima dal resto del file (incluso
// index.html), risalendo la catena di scope fino al globale.
//
// Dipende da funzioni/costanti dichiarate in index.html, promosse fuori dalla sua IIFE apposta
// per restare visibili qui (vedi commento "Funzioni combattimento condivise" in index.html):
// ACTION_DEFS, AI_NARRATION_TIMEOUT_MS, DEFAULT_COMBAT_LOCK_MESSAGE, DIGIMON_ACTION_DEFS,
// MECHANIC_ACTION_KEYS, STANCE_OPTIONS, SUPPORT_ACTION_KEYS, TAMER_ACTION_DEFS,
// __combatMusicSynced, applyActionMechanic, applySupportActionEffect, attackResultCompactHTML,
// basicAttackNarration, bindActionInfoIcon, bindCombatSelfActions, bindZoneLineArrows,
// combatDisplayHTML, combatDisplayName, combatNarrationThread, combatSelfActionHTML,
// combatTurnTimerLabel, duplicateNameSuffix, getParticipantClashStats, jumpToCombatTurn,
// narrateAttack, pushCombatNarration, queuePendingRollBonus, refreshLiveParts, renderChatArea,
// saveCombat, startCombatMusic, trySpendAction, resolveParticipantImage, participantSideColor.
// Queste ultime due (resolveParticipantImage/participantSideColor) restano anche loro dichiarate
// in index.html perche' usate pure da combatSelfActionHTML/attacksCardHTML/combatDisplayHTML,
// che sono a loro volta condivise col rendering Player e quindi restano dentro la IIFE.
//
// index.html deve caricare questo file PRIMA del proprio <script> principale (come gli altri
// moduli js/*.js), cosi' che al momento della chiamata reale (mai prima dell'interazione utente)
// tutte le dichiarazioni siano gia' avvenute in entrambe le direzioni.

function participantChipHTML(p, role, selected, combat){
    const color = participantSideColor(p);
    const defeated = isParticipantDefeated(p);
    // Richiesta utente: numerino per distinguere Digimon con lo stesso nome (vedi duplicateNameSuffix)
    // -- qui il Master vede sempre i nomi reali (isMaster=true), coerente col resto del suo pannello.
    const dupSuffix = combat ? duplicateNameSuffix(combat, p, true) : '';
    return `<button type="button" data-chip-role="${role}" data-chip-id="${p.id}" title="${escapeAttr(p.name+dupSuffix)} — ${p.side==='ally'?'Alleato':'Nemico'}" style="display:flex;flex-direction:column;align-items:center;gap:2px;padding:3px;width:52px;border-radius:8px;border:2px solid ${selected?color:'transparent'};background:${selected?'rgba(255,255,255,0.05)':'transparent'};cursor:pointer;opacity:${defeated?'0.45':'1'};">
      <div style="width:32px;height:32px;border-radius:6px;overflow:hidden;border:1px solid ${color};">${portraitHTML(resolveParticipantImage(p), p.name, 'sm', 'width:100%;height:100%;object-fit:contain;background:transparent;')}</div>
      <span style="font-size:9px;max-width:50px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:${color};">${escapeHTML(p.name)}${dupSuffix?`<b style="color:var(--amber);">${escapeHTML(dupSuffix)}</b>`:''}</span>
    </button>`;
  }
  // (getParticipantAttacks/getParticipantWounds/EFFECT_ICONS/effectIcon/effectExplanationText/EFFECT_TAG_ALIASES/EFFECT_DEFS/EFFECT_QUALITY_MAP/hasAttributeAdvantage/getParticipantAttribute/hasEffectQuality) spostato in js/combat-engine.js

  async function applyInstantEffect(code, target, key, potency){
    const def = EFFECT_DEFS.find(d=>d.key===key);
    if(!def || !def.instant) return null;
    if(def.instant==='pull'){
      const from = target.zone||'Medio';
      const steps = Math.max(1, potency);
      const zi = Math.max(0, zoneIndex(from)-steps);
      target.zone = ZONES[zi];
      return `${target.name} viene attirato da ${zoneLabel(from)} a ${zoneLabel(target.zone)}.`;
    }
    if(def.instant==='push'){
      const from = target.zone||'Medio';
      const steps = Math.max(1, potency);
      const zi = Math.min(ZONES.length-1, zoneIndex(from)+steps);
      target.zone = ZONES[zi];
      return `${target.name} viene respinto da ${zoneLabel(from)} a ${zoneLabel(target.zone)}.`;
    }
    if(def.instant==='cleanse'){
      let removedCount = 0;
      target.effects = (target.effects||[]).filter(e=>{
        const d = EFFECT_DEFS.find(x=>x.key===e.key);
        if(d && d.type==='negative' && removedCount<potency){ removedCount++; return false; }
        return true;
      });
      return `${target.name} viene purificato: rimossi ${removedCount} Effetti negativi.`;
    }
    if(def.instant==='shield'){
      if(target.isPC){
        const member = cachedRoster.find(m=>m.username===target.username);
        if(member){ member.digimon.tempWounds = Number(member.digimon.tempWounds||0)+potency; await saveMember(code, member); }
      } else {
        target.tempWounds = Number(target.tempWounds||0)+potency;
      }
      return `${target.name} guadagna ${potency} Caselle Ferita Temporanee.`;
    }
    return null;
  }

  // (computeEffectModifiers/effectTagsHTML/tickEffectsForParticipant/applyDamageToParticipantSync/getParticipantCombatStats/getParticipantResistance/getParticipantSizeIndex) spostato in js/combat-engine.js

  // Regola 9.12a — Sconfitta: un Digimon portato a 0 Wound Box scende al suo Default Stage,
  // resta a 1 Wound Box, ed è "Sconfitto" (cosciente, ma di norma ignorato per il resto del
  // combattimento salvo scelga di rientrare a proprio rischio — nessuna Azione speciale è
  // definita da regolamento per questo caso, è a discrezione del Master).
  // Se il Digimon è già al proprio Default Stage (o sotto), il caso limite è il Digitama.
  //
  // FEATURE (richiesta utente: "quando viene sconfitto mettilo sì a zero ma lascia scegliere al
  // master con un tasto se farlo regredire di livello o farlo finire in un uovo. Magari dai come
  // suggerimento [...] se davvero dovrebbe finire in un uovo"): PRIMA di questa modifica, la
  // regressione di Stage scattava qui sotto in automatico (nessuna scelta del Master), mentre il
  // caso "già al Default Stage minimo" era solo un messaggio di testo ("gestiscilo a mano") senza
  // alcun bottone reale per risolverlo. Ora applyDefeatIfNeeded si limita a marcare
  // Sconfitto+in-attesa-di-decisione, senza toccare Stage/Ferite: la scelta vera (Regredisci di
  // Stage / Richiudi nell'Uovo) è nei due bottoni sulla riga del partecipante in "Gestione
  // Combattimento" (vedi data-defeat-regress/data-defeat-egg più sotto, in renderCombatManager),
  // con l'esito consigliato da regola 9.12a mostrato solo come suggerimento, mai imposto — "Richiudi
  // nell'Uovo" riusa la stessa azione non distruttiva già presente nella Scheda Digimon (d-close-egg
  // in digimon.html: approved=false, Stat/Qualities/Attacchi restano quelli attuali).
  async function applyDefeatIfNeeded(code, participant){
    if(participant.isPC){
      const member = cachedRoster.find(m=>m.username===participant.username);
      if(!member || member.digimon.defeated || member.digimon.currentWounds>0) return null;
      const curIdx = stageIndex(member.digimon.stage);
      const defIdx = stageIndex(member.digimon.defaultStage);
      member.digimon.defeated = true;
      member.digimon.defeatPending = true;
      await saveMember(code, member);
      const canRegress = curIdx>defIdx;
      return { name: member.digimon.name||participant.name, digitama:!canRegress, canRegress, toStage: member.digimon.defaultStage };
    } else {
      if(participant.defeated || (participant.currentWounds||0)>0) return null;
      participant.defeated = true;
      return { name: participant.name, digitama:false, enemy:true };
    }
  }

  // Frase pronta per un messaggio di sistema STANDALONE in chat (include il nome del Digimon).
  function defeatNoticeText(defeatInfo, dispName){
    if(defeatInfo.enemy) return `🏳️ ${dispName} è Sconfitto!`;
    return defeatInfo.digitama
      ? `🏳️ ${dispName} è Sconfitto! È già al Default Stage minimo — da regolamento (9.12a) diventerebbe Digitama. Decidi dal pannello "Gestione Combattimento" (🥚 Richiudi nell'Uovo, o 🏳️ Regredisci se preferisci ignorare il suggerimento).`
      : `🏳️ ${dispName} è Sconfitto! Da regolamento (9.12a) potrebbe regredire a ${defeatInfo.toStage} con 1 Ferita — decidi dal pannello "Gestione Combattimento" se farlo regredire o richiuderlo nell'Uovo.`;
  }
  // Stessa informazione ma come clausola da APPENDERE in coda a una riga di log già esistente
  // (nessun nome ripetuto: il bersaglio è già nominato subito prima in quella riga).
  function defeatInlineNote(defeatInfo){
    if(!defeatInfo) return '';
    if(defeatInfo.enemy) return ' 🏳️ Sconfitto!';
    return defeatInfo.digitama
      ? ` 🏳️ Sconfitto! Già al Default Stage minimo — da regolamento diventerebbe Digitama (risolvi da "Gestione Combattimento").`
      : ` 🏳️ Sconfitto! Può regredire a ${defeatInfo.toStage} o essere richiuso nell'Uovo (risolvi da "Gestione Combattimento").`;
  }

  async function applyDamageToParticipant(code, combat, p, amount){
    if(p.isPC){
      const member = cachedRoster.find(m=>m.username===p.username);
      if(member){
        let remaining = amount;
        const shield = Number(member.digimon.tempWounds||0);
        if(shield>0 && remaining>0){
          const absorbed = Math.min(shield, remaining);
          member.digimon.tempWounds = shield - absorbed;
          remaining -= absorbed;
        }
        member.digimon.currentWounds = Math.max(0, member.digimon.currentWounds - remaining);
        const qMech = computeQualityMechanics(member.digimon.qualities);
        if(qMech.combatMonster>0 && amount>0){
          member.digimon.resolveCurrent = Math.min(Number(member.digimon.resolveMax||0), Number(member.digimon.resolveCurrent||0)+amount);
        }
        await saveMember(code, member);
      }
    } else {
      let remaining = amount;
      const shield = Number(p.tempWounds||0);
      if(shield>0 && remaining>0){
        const absorbed = Math.min(shield, remaining);
        p.tempWounds = shield - absorbed;
        remaining -= absorbed;
      }
      p.currentWounds = Math.max(0, (p.currentWounds||0) - remaining);
      await saveCombat(code, combat);
    }
  }

  // ---------- shared attack resolution (usato sia dal Combat Manager del Master sia dall'attacco in self-service del giocatore) ----------
  function validateAttackTargeting(attacker, target, atk){
    if(!attacker || !target || attacker.id===target.id){
      return { ok:false, error:'Scegli attaccante e bersaglio diversi.' };
    }
    const zDist = zoneDistance(attacker.zone||'Medio', target.zone||'Medio');
    if(atk && atk.shape==='Melee' && zDist>0){
      return { ok:false, error:`${atk.name} è [MELEE]: serve la stessa posizione di ${target.name} (ora: ${zoneLabel(attacker.zone||'Medio')}→${zoneLabel(target.zone||'Medio')}). Avvicinati prima di attaccare.` };
    }
    if(atk && atk.shape==='Range' && zDist > (atk.reach||1)){
      return { ok:false, error:`${atk.name} è [RANGE ${atk.reach||1}]: ${target.name} è troppo lontano (distanza ${zDist}, ${zoneLabel(attacker.zone||'Medio')}→${zoneLabel(target.zone||'Medio')}).` };
    }
    return { ok:true };
  }

  // Esegue i tiri Accuracy (attaccante) vs Dodge (bersaglio, automatico) e applica il danno se colpito.
  // Assume che validateAttackTargeting sia già stato chiamato con esito positivo.
  // Nome "sicuro" per i log tecnici (::TECH::): se il partecipante ha nameHidden, mostra
  // l'etichetta nascosta ("Nemico 1" ecc.) invece del nome reale, così espandendo i dettagli
  // in chat il giocatore non vede il vero nome del Digimon.
  function techLogName(p){ return (p && p.nameHidden) ? hiddenParticipantLabel(p) : (p ? p.name : ''); }

  async function performAttackRoll(code, combat, attacker, target, atk, opts){
    const aStats = getParticipantCombatStats(attacker);
    const tStats = getParticipantCombatStats(target);
    // BUGFIX (segnalato dall'utente: "la battery sugli attacchi non viene calcolata correttamente"):
    // il testo sulla Scheda Digimon (attacksBlockHTML) promette da tempo "ogni punto di Battery si
    // aggiunge ad Accuracy e Danno (o Potenza, se Support) quando la usi -- consuma tutta la Battery
    // all'uso", ma questo motore non l'ha MAI implementato: getParticipantCombatStats non legge mai
    // battery, quindi il bonus non veniva applicato a nessun tiro, a prescindere da quante tacche
    // avesse il Digimon. Qui la Battery si applica SOLO se il chiamante passa opts.useBattery=true
    // (scelta esplicita di chi attacca -- vedi il commento sulla card: "il giocatore può scegliere
    // di dichiararla e spendere Battery per potenziarla -- non è automatico"), solo su un Attacco
    // Signature Move, e solo se l'Attaccante ha davvero Battery > 0 in quel momento. Si azzera subito
    // dopo essere stata letta (viene "consumata all'uso" per regolamento, sia che l'Attacco vada a
    // segno sia che venga schivato -- il Digimon l'ha comunque spesa nel tentativo).
    let batteryBonus = 0, batteryNote = '';
    if(opts && opts.useBattery && atk && atk.signature && attacker.isPC){
      const aMemberForBattery = cachedRoster.find(m=>m.username===attacker.username);
      const curBattery = aMemberForBattery ? Number(aMemberForBattery.digimon.battery||0) : 0;
      if(curBattery>0){
        batteryBonus = curBattery;
        batteryNote = ` [+${batteryBonus} Battery su Signature Move, azzerata]`;
        aMemberForBattery.digimon.battery = 0;
        await saveMember(code, aMemberForBattery);
      }
    }
    const zDist = zoneDistance(attacker.zone||'Medio', target.zone||'Medio');
    // Point Blank (9.03, manuale reale): un Attacco [RANGE] contro un bersaglio nella propria
    // stessa zona subisce -3 Accuracy, a meno che l'Attaccante non abbia Heavy Recoil (che ora la
    // ignora davvero, non solo a parole). Non si applica a [MELEE] (che a distanza 0 è la norma).
    const pointBlank = !!(atk && atk.shape==='Range' && zDist===0 && !aStats.heavyRecoil);
    const zPenalty = zonePenalty(zDist, aStats.bit) + (pointBlank ? -3 : 0);
    // Bonus reale in coda da Direct/Aid/Guard/Bolster (9.06a/9.06b) -- si consuma qui, sul primo
    // dei due tiri che arriva (Accuracy per l'Attaccante, Dodge per il Bersaglio) -- vedi
    // applySupportActionEffect/queuePendingRollBonus qui sopra.
    let attackerBonus = 0, attackerBonusNote = '';
    if(attacker.pendingRollBonus && (attacker.pendingRollBonus.stat==='either' || attacker.pendingRollBonus.stat==='accuracy')){
      attackerBonus = attacker.pendingRollBonus.amount;
      attackerBonusNote = ` [+${attackerBonus} Accuracy da ${attacker.pendingRollBonus.source}]`;
      attacker.pendingRollBonus = null;
    }
    let targetBonus = 0, targetBonusNote = '';
    if(target.pendingRollBonus && (target.pendingRollBonus.stat==='either' || target.pendingRollBonus.stat==='dodge')){
      targetBonus = target.pendingRollBonus.amount;
      targetBonusNote = ` [+${targetBonus} Dodge da ${target.pendingRollBonus.source}]`;
      target.pendingRollBonus = null;
    }
    const effAccuracy = Math.max(0, aStats.accuracy + zPenalty + attackerBonus + batteryBonus);
    const overpowerUsed = !!attacker.overpowerActive;
    const accRoll = rollPool(effAccuracy, overpowerUsed);
    if(overpowerUsed) attacker.overpowerActive = false;
    if(aStats.certainStrike>0) accRoll.successes += aStats.certainStrike;
    let attrAdvNote = '';
    const attrRule = cachedProgression && cachedProgression.attributeAdvantage;
    if(attrRule && hasAttributeAdvantage(getParticipantAttribute(attacker), getParticipantAttribute(target))){
      if(attrRule==='minor'){
        const bonusDie = rollD6();
        accRoll.dice.push(bonusDie);
        if(bonusDie>=4) accRoll.successes += 1;
        attrAdvNote = ` [Attribute Advantage (Minor): +1d6(${bonusDie})]`;
      } else if(attrRule==='major'){
        accRoll.successes += 1;
        attrAdvNote = ' [Attribute Advantage (Major): +1 Successo automatico]';
      }
    }
    const dodgeRoll = rollPool(tStats.dodge + targetBonus);
    if(tStats.absoluteEvasion>0) dodgeRoll.successes += tStats.absoluteEvasion;
    // BUGFIX (segnalato dal Master: "un giocatore aveva fatto Guard/dodge ma sembra non lo abbia
    // calcolato, solo scritto"): il bonus da Direct/Aid/Guard/Bolster al Dodge del bersaglio VIENE
    // già tirato correttamente qui sopra (dodgeRoll = rollPool(tStats.dodge + targetBonus)) -- il
    // problema era solo nel LOG TECNICO: targetBonusNote finiva incollata dentro zoneNote, che si
    // stampa SOLO nella porzione "Accuracy" della riga (mai vicino a "Dodge"), e tutte le righe di
    // log sotto mostravano ${tStats.dodge}d6 come dimensione del pool di Dodge invece di
    // ${tStats.dodge + targetBonus}d6 -- quindi chi leggeva il log vedeva la nota "+N Dodge da
    // Guard" attaccata all'Accuracy dell'ATTACCANTE e un pool di Dodge che sembrava non essere
    // cresciuto, anche se i dadi extra erano stati davvero tirati. zoneNote ora contiene solo le
    // note lato Accuracy; targetBonusNote si stampa lato Dodge (vedi dodgeNote sotto).
    const zoneNote = (zPenalty!==0 ? ` (${zPenalty} Accuracy per distanza${pointBlank?' inclusa Point Blank -3':''}: ${zoneLabel(attacker.zone||'Medio')}→${zoneLabel(target.zone||'Medio')})` : '') + (overpowerUsed ? ' [Overpower: 4 conta come Successo]' : '') + attackerBonusNote + batteryNote;
    const dodgePool = tStats.dodge + targetBonus;
    const dodgeNote = targetBonusNote;
    const certainNote = (aStats.certainStrike>0 ? ` +${aStats.certainStrike} [CERTAIN]` : '') + attrAdvNote;
    const atkLabel = atk ? `${atk.name} ${attackTagsPlain(atk)}` : 'Attacco generico';
    // Nomi mascherati per i log tecnici: se il Digimon ha nameHidden, il log NON rivela il nome reale.
    const aName = techLogName(attacker);
    const tName = techLogName(target);
    let logText, dealt = 0;

    if(atk && atk.type==='Support'){
      const effDef = atk.effectKey ? EFFECT_DEFS.find(d=>d.key===atk.effectKey) : null;
      const isHelpful = effDef && effDef.type==='positive';
      const verb = isHelpful ? 'supporta' : 'colpisce';
      const resultTag = isHelpful ? 'RIUSCITO' : 'COLPITO';
      if(accRoll.successes < dodgeRoll.successes || accRoll.successes===0){
        logText = `✨ ${aName} usa ${atkLabel} su ${tName}: Accuracy ${effAccuracy}d6${zoneNote}[${accRoll.dice.join(',')}]${certainNote}=${accRoll.successes} succ. vs Dodge ${dodgePool}d6${dodgeNote}[${dodgeRoll.dice.join(',')}]=${dodgeRoll.successes} succ. → ${isHelpful?'NON RIUSCITO':'MANCATO'}, nessun Effetto applicato.`;
      } else if(atk.effectKey){
        const def = effDef;
        // Potenza 1 / Durata 3 di default (stessi valori dello strumento manuale "+Effetto" sulla riga
        // partecipante) — niente popup nativi del browser, che stonavano col resto dell'interfaccia.
        // Il Master può correggerli in un secondo momento rimuovendo e riapplicando l'Effetto a mano.
        // + Battery (se usata su questa Signature Move Support, vedi batteryBonus più sopra): sulla
        // card viene promesso che la Battery si applica "ad Accuracy e Danno (o Potenza, se Support)".
        const potency = 1 + batteryBonus;
        if(def && def.instant){
          const msg = await applyInstantEffect(code, target, atk.effectKey, potency);
          logText = `✨ ${aName} usa ${atkLabel} su ${tName}: Accuracy ${effAccuracy}d6${zoneNote}[${accRoll.dice.join(',')}]${certainNote}=${accRoll.successes} succ. vs Dodge ${dodgePool}d6${dodgeNote}[${dodgeRoll.dice.join(',')}]=${dodgeRoll.successes} succ. → ${resultTag}! ${msg}`;
        } else {
          const duration = 3;
          if(!target.effects) target.effects = [];
          target.effects.push({ key: atk.effectKey, potency, duration });
          logText = `✨ ${aName} usa ${atkLabel} su ${tName}: Accuracy ${effAccuracy}d6${zoneNote}[${accRoll.dice.join(',')}]${certainNote}=${accRoll.successes} succ. vs Dodge ${dodgePool}d6${dodgeNote}[${dodgeRoll.dice.join(',')}]=${dodgeRoll.successes} succ. → ${resultTag}! ${isHelpful?'Supporta':'Applica'} ${def?def.label:atk.effectKey} (Potenza ${potency}, Durata ${duration} — valori di default, correggibili a mano sulla riga di ${tName}).`;
        }
      } else {
        logText = `✨ ${aName} usa ${atkLabel} su ${tName}: ${verb}, ma non ha un Effetto collegato da applicare.`;
      }
    } else {
      if(accRoll.successes < dodgeRoll.successes || accRoll.successes===0){
        logText = `⚔ ${aName} usa ${atkLabel} su ${tName}: Accuracy ${effAccuracy}d6${zoneNote}[${accRoll.dice.join(',')}]${certainNote}=${accRoll.successes} succ. vs Dodge ${dodgePool}d6${dodgeNote}[${dodgeRoll.dice.join(',')}]=${dodgeRoll.successes} succ. → MANCATO (schivato)`;
      } else {
        const excess = accRoll.successes - dodgeRoll.successes;
        let raw = excess + aStats.damage + batteryBonus;
        let combatMonsterNote = '';
        if(attacker.isPC){
          const aMember = cachedRoster.find(m=>m.username===attacker.username);
          if(aMember && Number(aMember.digimon.resolveCurrent||0)>0 && computeQualityMechanics(aMember.digimon.qualities).combatMonster>0){
            const resolveSpent = Number(aMember.digimon.resolveCurrent||0);
            raw += resolveSpent;
            aMember.digimon.resolveCurrent = 0;
            await saveMember(code, aMember);
            combatMonsterNote = ` +${resolveSpent} Resolve (Combat Monster, azzerato)`;
          }
        }
        dealt = Math.max(0, raw - tStats.armor);
        await applyDamageToParticipant(code, combat, target, dealt);
        const w = getParticipantWounds(target);
        const defeatInfo = await applyDefeatIfNeeded(code, target);
        const defeatNote = defeatInlineNote(defeatInfo);
        logText = `⚔ ${aName} usa ${atkLabel} su ${tName}: Accuracy ${effAccuracy}d6${zoneNote}[${accRoll.dice.join(',')}]${certainNote}=${accRoll.successes} succ. vs Dodge ${dodgePool}d6${dodgeNote}[${dodgeRoll.dice.join(',')}]=${dodgeRoll.successes} succ. → COLPITO! (${excess}+DMG ${aStats.damage}${batteryBonus>0?`+${batteryBonus} Battery`:''})${combatMonsterNote}-ARM ${tStats.armor} = ${dealt} danno → ${tName} ${w.current}/${w.max} Ferite${defeatNote}`;
        return { logText, dealt, accRoll, dodgeRoll, atkLabel, defeatInfo };
      }
    }
    return { logText, dealt, accRoll, dodgeRoll, atkLabel, defeatInfo: null };
  }

  // Stato UI del Combat Manager (non salvato su DB, resettato solo al refresh pagina):
  // quali righe partecipante sono "espanse" (mostrano Azione/Muovi/Effetti), se il pannello
  // "Risolvi Attacco" è aperto, e quale partecipante è pre-selezionato come Attaccante.
  const combatExpandedIds = new Set();
  let combatAttackPanelOpen = false;
  let combatPresetAttackerId = null;
  let combatPresetTargetId = null;
  let combatSelectedAttackIndex = null;

  // BUGFIX (segnalato dall'utente): "durante la selezione attacchi la pagina refresha e spesso
  // gli fa selezionare il digimon sbagliato". Sia il pannello Master (#combat-mgr-card, chip
  // Attaccante/Bersaglio) sia il pannello Giocatore (#attacks-card, dropdown Bersaglio custom)
  // vengono ricostruiti da zero (innerHTML) ad ogni giro di polling (ogni 15s, vedi
  // refreshLiveParts) per tenere nomi/Ferite/Azioni aggiornati senza intervento manuale. Su
  // mobile un tap impiega qualche decina/centinaio di ms tra touchstart e touchend: se il poll
  // scatta esattamente in quella finestra, il nodo DOM toccato viene distrutto e ricreato, e il
  // touchend finisce per "cliccare" qualunque elemento occupi ORA quella posizione -- cioè spesso
  // il chip/pulsante di un Digimon diverso da quello voluto. Le variabili di stato persistente
  // (combatPresetAttackerId ecc., self-target-select) sopravvivono al ridisegno, ma non bastano a
  // evitare che il TAP STESSO finisca sul bersaglio sbagliato durante il ridisegno. Qui teniamo
  // traccia dell'ultima interazione (pointerdown/touchstart) dentro le due card e, se troppo
  // recente, saltiamo il ridisegno automatico di quel giro di polling: il tap ha tutto il tempo
  // di completarsi, e i dati si aggiornano comunque al giro successivo.
  let lastCombatUiTapAt = 0;
  // BUGFIX (segnalato dall'utente: "la risposta ai messaggi da telefono sembra non funzionare lato
  // giocatori"): stessa classe di bug di lastCombatUiTapAt qui sotto, ma per #log-live (Registro
  // chat). I bottoni ↩ Rispondi / ✎ / ✕ / 🎲 Tira ora / voto spostamento / Evolvi ora dentro ogni
  // riga del log (vedi logHTML/attachLogModeration) su mobile restano premuti abbastanza a lungo
  // tra touchstart e touchend da cadere nella finestra del poll periodico (refreshLiveParts, ogni
  // ~15s), che ricostruiva SEMPRE da zero l'HTML di #log-live tramite renderChatArea(...) senza
  // alcuna guardia -- il nodo toccato veniva distrutto e ricreato sotto al dito e il touchend
  // finiva sull'elemento sbagliato (o su nulla), dando l'impressione che il tap "non funzionasse".
  let lastLogTapAt = 0;
  let combatUiTapListenerBound = false;
  function ensureCombatUiTapListener(){
    if(combatUiTapListenerBound) return;
    combatUiTapListenerBound = true;
    const mark = (ev)=>{
      const t = ev.target;
      // BUGFIX (segnalato dall'utente: "continua a esserci un refresh troppo rapido quando uno dei
      // giocatori sta selezionando qualcosa dai menu a tendina"): #combat-self-actions (i <select>
      // Azione Digimon/Azione Tamer del pannello self-service, incluso quello di Reinforce/
      // Reposition/ecc. -- vedi combatSelfActionHTML) è una card SIBLING di #attacks-card, non un
      // suo discendente: un tap/tocco lì dentro non veniva mai registrato da questo listener, quindi
      // lastCombatUiTapAt restava vecchio e il refresh sotto (refreshLiveParts) non aveva alcuna
      // guardia per quella card -- veniva ridisegnata da zero a ogni giro di polling (~15s) anche
      // mentre il giocatore aveva un <select> aperto, resettandolo alla prima opzione o chiudendolo.
      if(t && t.closest && (t.closest('#combat-mgr-card') || t.closest('#attacks-card') || t.closest('#combat-self-actions'))) lastCombatUiTapAt = Date.now();
      // Vedi commento su lastLogTapAt più sopra: stessa guardia, per il Registro chat.
      if(t && t.closest && t.closest('#log-live')) lastLogTapAt = Date.now();
    };
    document.addEventListener('pointerdown', mark, true);
    document.addEventListener('touchstart', mark, true);
  }

  // grantMilestoneRewards/renderProgressionMaster (+ saveProgression, vedi sopra) spostati in
  // js/progression.js.

  // ---------- LOG BIO-RESONANCE SCAN (vista Master) ----------
  // Mostra a chi è stato assegnato ogni Digimon (e Crest, se il Tamer aveva il Digimedaglione),
  // con data/ora e numero del tentativo. Il Master può cancellare una riga per correggere un
  // errore, liberare un nome "preso" per errore, o restituire un tentativo a un giocatore.
  // renderScanLogMaster (Log Bio-Resonance Scan) spostato in js/notices.js

  // (privateReadKey/markPrivateThreadRead/isPrivateThreadUnread/checkMasterPrivateUnread/
  // updateMasterChatModeUI/bindMasterChatMode/renderPrivateChatMaster) spostato in js/private-chat.js


  // (zone-math: ZONES/zoneIndex/zoneDistance/zonePenalty/zoneLabel/zoneStepToward/zoneStepAway/zoneStepDirection/zoneSideEffectsNote) spostato in js/combat-engine.js
  function renderCombatManager(code, players){
    const cardEl = document.getElementById('combat-mgr-card');
    if(!cardEl) return;
    if(!cachedCombat) cachedCombat = defaultCombat();
    const combat = cachedCombat;
    // Preseleziona di default l'Attaccante = Digimon di cui è il turno (se non è già stato scelto
    // esplicitamente qualcun altro), per velocizzare la risoluzione del suo attacco.
    // Assegna etichette stabili ("Nemico 1", "Nemico 2") ai partecipanti con nome nascosto che
    // non hanno ancora un hiddenLabelNum — succede se il combattimento è stato creato prima di
    // questa feature o se il dato non è sopravvissuto a un reload.
    (combat.participants||[]).forEach(p => assignHiddenLabelNum(combat, p));

    if(!combatPresetAttackerId){
      const curr = currentTurnParticipant(combat);
      if(curr) combatPresetAttackerId = curr.id;
    }

    if(!combat.active){
      cardEl.innerHTML = `
        <div class="section-title">Gestione Combattimento</div>
        <div class="muted" style="margin-bottom:10px;">Nessun combattimento attivo.</div>
        <div class="field"><label>Zona di partenza Alleati</label>
          <select id="combat-start-zone-ally">${ZONES.map(z=>`<option value="${z}" ${z==='Molto Corto'?'selected':''}>${zoneLabel(z)}</option>`).join('')}</select>
        </div>
        <div class="field"><label>Zona di partenza Nemici</label>
          <select id="combat-start-zone-enemy">${ZONES.map(z=>`<option value="${z}" ${z==='Molto Lungo'?'selected':''}>${zoneLabel(z)}</option>`).join('')}</select>
        </div>
        <div class="muted" style="font-size:10px;margin-bottom:6px;">Default: Alleati e Nemici partono agli estremi opposti della linea — modificabile qui se la scena richiede altro.</div>
        <div class="field"><label>Chat da avvisare e bloccare</label>
          <select id="combat-start-chatlock">
            <option value="general">Chat Generale</option>
            ${(cachedSubgroups||[]).map(g=>`<option value="sub:${g.id}">Sottogruppo: ${escapeHTML(g.name)}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>Messaggio di avviso (modificabile, lasciare vuoto per non bloccare nessuna chat)</label>
          <textarea id="combat-start-chatlock-msg" rows="3" style="width:100%;">${escapeHTML(DEFAULT_COMBAT_LOCK_MESSAGE)}</textarea>
        </div>
        <button class="btn solid" id="btn-combat-start" style="width:100%;margin-top:6px;">Inizia Combattimento</button>
      `;
      // FIX: al primo render della vista Master, cachedSubgroups può essere ancora vuota (si popola
      // solo dentro refreshLiveParts, che gira in modo asincrono DOPO questo render) — così il
      // <select> qui sopra mostrava solo "Chat Generale" finché non scattava un giro di polling che
      // però non re-invoca mai renderCombatManager a combattimento inattivo. Stesso identico bug già
      // risolto per il <select> "Quale sottogruppo" della richiesta di tiro (vedi più sopra in questo
      // file): rinfreschiamo i sottogruppi al volo con un fetch fresco e, se sono arrivati gruppi non
      // ancora presenti nel <select>, ricostruiamo solo le sue opzioni (senza toccare zone/messaggio
      // già eventualmente compilati dall'utente).
      getSubgroups(code).then(groups=>{
        cachedSubgroups = groups;
        const sel = document.getElementById('combat-start-chatlock');
        if(!sel) return;
        const current = new Set(Array.from(sel.options).map(o=>o.value));
        const missing = (groups||[]).some(g=>!current.has('sub:'+g.id));
        if(missing){
          const prevVal = sel.value;
          sel.innerHTML = `<option value="general">Chat Generale</option>` +
            (groups||[]).map(g=>`<option value="sub:${g.id}">Sottogruppo: ${escapeHTML(g.name)}</option>`).join('');
          if(current.has(prevVal)) sel.value = prevVal;
        }
      });
      document.getElementById('btn-combat-start').onclick = async ()=>{
        const startZoneAllySel = document.getElementById('combat-start-zone-ally');
        const startZoneEnemySel = document.getElementById('combat-start-zone-enemy');
        const chatLockSel = document.getElementById('combat-start-chatlock');
        const chatLockMsgEl = document.getElementById('combat-start-chatlock-msg');
        cachedCombat = defaultCombat();
        cachedCombat.active = true;
        cachedCombat.startZoneAlly = (startZoneAllySel && startZoneAllySel.value) || 'Molto Corto';
        cachedCombat.startZoneEnemy = (startZoneEnemySel && startZoneEnemySel.value) || 'Molto Lungo';
        const chatLockMsg = (chatLockMsgEl && chatLockMsgEl.value || '').trim();
        if(chatLockSel && chatLockMsg){
          cachedCombat.chatLock = { location: chatLockSel.value, message: chatLockMsg };
        }
        await saveCombat(code, cachedCombat);
        if(cachedCombat.chatLock){
          await pushCombatNarration(cachedCombat, { who:'Sistema', role:'gm', text: '🔒 ' + cachedCombat.chatLock.message });
        }
        __combatMusicSynced = true;
        startCombatMusic(cachedScene);
        for(const p of players){
          const orderKeys = TALENT_DEFS.filter(t=>t.once==='combat').map(t=>t.order);
          let changed = false;
          orderKeys.forEach(k=>{ if(p.tamer.specialOrdersUsed && p.tamer.specialOrdersUsed[k]){ p.tamer.specialOrdersUsed[k]=false; changed=true; } });
          if(changed) await saveMember(code, p);
        }
        renderCombatManager(code, players);
        const combatLive = document.getElementById('combat-live');
        if(combatLive) combatLive.innerHTML = combatDisplayHTML(cachedCombat, true);
        bindZoneLineArrows(code, players);
      };
      return;
    }

    cardEl.innerHTML = `
      <div class="section-title">Gestione Combattimento</div>
      <div class="row" style="margin-bottom:4px;align-items:center;">
        <span class="muted" style="flex:1;">Zona di partenza Alleati</span>
        <select id="combat-startzone-ally-live" style="flex:1;">${ZONES.map(z=>`<option value="${z}" ${(combat.startZoneAlly||'Molto Corto')===z?'selected':''}>${zoneLabel(z)}</option>`).join('')}</select>
      </div>
      <div class="row" style="margin-bottom:8px;align-items:center;">
        <span class="muted" style="flex:1;">Zona di partenza Nemici</span>
        <select id="combat-startzone-enemy-live" style="flex:1;">${ZONES.map(z=>`<option value="${z}" ${(combat.startZoneEnemy||'Molto Lungo')===z?'selected':''}>${zoneLabel(z)}</option>`).join('')}</select>
      </div>
      <div id="combat-participants-list">
        ${combat.participants.length===0 ? '<div class="muted" style="margin-bottom:8px;">Nessun partecipante ancora aggiunto.</div>' : combat.participants.map((p,i)=>{
          const w = getParticipantWounds(p);
          const acts = p.actions===undefined?2:p.actions;
          const tamerActs = p.tamerActions===undefined?2:p.tamerActions;
          const isCurrentTurn = !!(combat.order && combat.order.length && combat.order[combat.currentIndex]===p.id);
          const defeated = isParticipantDefeated(p);
          const expanded = isCurrentTurn || combatExpandedIds.has(p.id);
          // FEATURE (richiesta utente sulla Sconfitta, vedi applyDefeatIfNeeded): finché
          // member.digimon.defeatPending resta true, la Sconfitta di questo PC non è ancora stata
          // risolta -- pCanRegress/pDefaultStage servono solo a mostrare il suggerimento da regola
          // 9.12a accanto ai due bottoni di scelta del Master (vedi defeatResolutionHTML più sotto).
          const pcMemberForDefeat = p.isPC ? cachedRoster.find(m=>m.username===p.username) : null;
          const pDefeatPending = !!(pcMemberForDefeat && pcMemberForDefeat.digimon.defeatPending);
          const pCanRegress = pDefeatPending && stageIndex(pcMemberForDefeat.digimon.stage) > stageIndex(pcMemberForDefeat.digimon.defaultStage);
          const pDefaultStage = pcMemberForDefeat ? pcMemberForDefeat.digimon.defaultStage : null;
          // Richiesta utente: numerino accanto al nome (vicino alle Ferite) per distinguere Digimon
          // con lo stesso nome — vedi duplicateNameSuffix. Il Master vede sempre i nomi reali.
          const dupSuffix = duplicateNameSuffix(combat, p, true);
          const header = `
            <div class="flex-between">
              <span>${isCurrentTurn?'▶ ':''}${escapeHTML(p.name)}${dupSuffix?`<b style="color:var(--amber);">${escapeHTML(dupSuffix)}</b>`:''} <button class="tag" data-toggle-side="${p.id}" style="cursor:pointer;background:none;color:${p.side==='ally'?'var(--cyan)':'var(--danger)'};border-color:${p.side==='ally'?'var(--cyan-dim)':'rgba(255,93,93,0.4)'};" title="Clicca per cambiare Alleato/Nemico">${p.side==='ally'?'Alleato':'Nemico'}</button> ${defeated?'<span class="tag" style="margin-left:4px;color:var(--danger);border-color:rgba(255,93,93,0.4);">🏳️ Sconfitto</span>':''} <span class="muted" style="margin-left:4px;font-size:10px;">${w.current}/${w.max} Ferite</span> <span style="margin-left:6px;font-size:12px;" title="Azioni Digimon rimaste: ${acts}/2">Dig ${Array.from({length:2}).map((_,i)=>i<acts?'<span style="color:var(--cyan);">●</span>':'<span style="color:var(--line);">○</span>').join('')}</span> <span style="margin-left:4px;font-size:12px;" title="Azioni Tamer rimaste: ${tamerActs}/2">Tam ${Array.from({length:2}).map((_,i)=>i<tamerActs?'<span style="color:var(--amber);">●</span>':'<span style="color:var(--line);">○</span>').join('')}</span></span>
              <span style="display:flex;align-items:center;gap:6px;">
                <input type="number" data-part-init="${p.id}" value="${p.initiative}" style="width:60px;padding:4px;" />
                ${defeated ? `<button class="btn ghost small" data-part-reenter="${p.id}" title="Rientra a proprio rischio (a discrezione del Master)">↩️</button>` : ''}
                ${isCurrentTurn ? '' : `<button class="btn ghost small" data-part-toggle="${p.id}">${expanded?'▲':'▼'}</button>`}
                <button class="btn ghost small" data-part-remove="${p.id}">✕</button>
              </span>
            </div>`;
          // FEATURE (richiesta utente sulla Sconfitta): sempre visibile, anche a riga non espansa --
          // è una decisione in sospeso, il Master deve accorgersene subito senza dover espandere.
          // "Regredisci" compare solo se ha ancora senso (uno Stage sopra il Default esiste
          // davvero); "Richiudi nell'Uovo" è sempre disponibile (riusa approved=false, non
          // distruttivo, stessa azione già presente sulla Scheda Digimon). "(consigliato)" segue
          // solo il suggerimento di regola 9.12a, il Master resta comunque libero di scegliere l'altro.
          const defeatResolutionHTML = pDefeatPending ? `
            <div style="margin:6px 0;padding:8px;border:1px solid rgba(255,93,93,0.4);border-radius:6px;background:rgba(255,93,93,0.06);">
              <div class="muted" style="font-size:11px;margin-bottom:6px;">🏳️ Sconfitto — risolvi la Sconfitta (regola 9.12a: ${pCanRegress?`consigliato regredire a ${escapeHTML(pDefaultStage)}`:'già al Default Stage minimo, consigliato Digitama'}):</div>
              <div class="row">
                ${pCanRegress ? `<button class="btn ghost small" data-defeat-regress="${p.id}" style="flex:1;">🏳️ Regredisci a ${escapeHTML(pDefaultStage)} (consigliato)</button>` : ''}
                <button class="btn ghost small" data-defeat-egg="${p.id}" style="flex:1;">🥚 Richiudi nell'Uovo${pCanRegress?'':' (consigliato)'}</button>
              </div>
            </div>` : '';
          if(!expanded){
            return `<div style="margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid var(--line);">${header}${defeatResolutionHTML}${(p.effects&&p.effects.length)?`<div style="margin-top:4px;">${effectTagsHTML(p)}</div>`:''}</div>`;
          }
          return `
          <div style="margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid var(--line);${isCurrentTurn?'background:rgba(53,232,201,0.06);border-radius:6px;padding:8px;':''}">
            ${header}
            ${defeatResolutionHTML}
            <!-- Richiesta utente: "manca un modo per danneggiare manualmente i digimon nemici" --
                 funziona su QUALSIASI partecipante (non solo Nemici: utile anche per correggere le
                 Ferite di un Alleato/PC per un Effetto/Trappola/terreno non coperto da un'Azione
                 automatizzata), riusando applyDamageToParticipant/applyDefeatIfNeeded -- stessa
                 funzione già usata dalla risoluzione automatica degli Attacchi, quindi Shield/tempWounds
                 assorbe per primo e il controllo Sconfitto scatta identico. -->
            <div class="row" style="margin-top:2px;margin-bottom:6px;align-items:center;">
              <input type="number" data-manual-wound-amt="${p.id}" value="1" min="1" style="width:56px;flex:0 0 auto;" />
              <button class="btn ghost small" data-manual-damage="${p.id}" style="flex:1;" title="Applica Danno manuale (es. Effetto/Trappola/Terreno non coperto da un'Azione automatizzata)">🩸 Danno</button>
              <button class="btn ghost small" data-manual-heal="${p.id}" style="flex:1;" title="Cura manuale (es. Regen/Cleanse non automatizzati)">💚 Cura</button>
            </div>
            <div class="muted" style="font-size:11px;margin-top:6px;margin-bottom:2px;color:var(--cyan);">Azione Digimon</div>
            <div class="row">
              <select data-daction-select="${p.id}" style="flex:2;">${DIGIMON_ACTION_DEFS.map(a=>`<option value="${a.key}">${escapeHTML(a.label)} (${a.cost} Az.)</option>`).join('')}</select>
              <button class="btn small" data-daction-use="${p.id}" style="flex:1;">Usa</button>
              <button type="button" class="btn ghost small" data-action-info="d-${p.id}" title="Spiega questa Azione" style="flex:0 0 auto;padding:4px 8px;">❓</button>
            </div>
            <div class="muted" data-daction-desc="${p.id}" style="margin:2px 0;font-size:11px;">${escapeHTML((DIGIMON_ACTION_DEFS[0]&&DIGIMON_ACTION_DEFS[0].desc)||'')}</div>
            <select data-stance-pick="${p.id}" style="display:none;margin-bottom:4px;width:100%;">${STANCE_OPTIONS.map(s=>`<option value="${s}">${s}</option>`).join('')}</select>
            <div class="muted" style="font-size:11px;margin-top:4px;margin-bottom:2px;color:var(--amber);">Azione Tamer</div>
            <div class="row">
              <select data-taction-select="${p.id}" style="flex:2;">${TAMER_ACTION_DEFS.map(a=>`<option value="${a.key}">${escapeHTML(a.label)} (${a.cost} Az.)</option>`).join('')}</select>
              <button class="btn small" data-taction-use="${p.id}" style="flex:1;">Usa</button>
              <button type="button" class="btn ghost small" data-action-info="t-${p.id}" title="Spiega questa Azione" style="flex:0 0 auto;padding:4px 8px;">❓</button>
            </div>
            <div class="muted" data-taction-desc="${p.id}" style="margin:2px 0;font-size:11px;">${escapeHTML((TAMER_ACTION_DEFS[0]&&TAMER_ACTION_DEFS[0].desc)||'')}</div>
            <select data-skill-pick="${p.id}" style="display:none;margin-bottom:4px;width:100%;">${SKILL_DEFS.map(s=>`<option value="${s.key}">${escapeHTML(s.label)}</option>`).join('')}</select>
            <div class="row" style="margin-top:4px;">
              <button class="btn ghost small" data-action-reset="${p.id}" style="flex:1;" title="Ripristina sia le Azioni Digimon che quelle Tamer a 2/2">↺ 2+2</button>
              <button class="btn ghost small" data-action-refund="${p.id}" style="flex:1;" title="Es. Successo Critico su Reload/Battle Cry/Horde Duelist: 'riottieni l'Azione spesa' (Digimon)">+1 Azione (Digimon)</button>
              <button class="btn ghost small" data-action-refund-tamer="${p.id}" style="flex:1;" title="Restituisci 1 Azione al pool del Tamer (es. Azione data per sbaglio, correzione manuale)">+1 Azione (Tamer)</button>
            </div>
            <div class="row" style="margin-top:4px;">
              <button class="btn ghost small" data-action-refund-attack="${p.id}" style="flex:1;" ${!p.attackedThisRound?'disabled':''} title="Es. Reload riuscito: 'riottieni l'uso dell'Attacco [AMMO]', ignora il limite di 1 Attacco a round">🔄 Restituisci Attacco</button>
            </div>
            <div class="row" style="margin-top:6px;">
              <!-- Richiesta utente: "non possono selezionare se stessi per potenziarsi" -- questo
                   select (di riferimento per Avvicina/Allontana) è riusato anche da bindActionUse
                   come bersaglio di Direct/Aid/Bolster (data-zone-ref), che possono legittimamente
                   avere come bersaglio il proprio Digimon (Direct sul proprio partner non ha
                   nemmeno la penalità -2, vedi applySupportActionEffect). Aggiunta "(te stesso)" in
                   fondo alla lista -- innocuo anche per Avvicina/Allontana (selezionare se stessi
                   come riferimento mostra solo "già alla stessa posizione", nessun crash). -->
              <select data-zone-ref="${p.id}" style="flex:2;">${combat.participants.filter(o=>o.id!==p.id).map(o=>`<option value="${o.id}">${escapeHTML(o.name+duplicateNameSuffix(combat, o, true))}</option>`).join('') || '<option value="">(nessun altro partecipante)</option>'}<option value="${p.id}">${escapeHTML(p.name+duplicateNameSuffix(combat, p, true))} (te stesso)</option></select>
              <button class="btn small" data-zone-closer="${p.id}" style="flex:1;">➡️ Avvicina</button>
              <button class="btn ghost small" data-zone-away="${p.id}" style="flex:1;">⬅️ Allontana</button>
            </div>
            <div class="row" style="margin-top:4px;">
              <select data-zone-select="${p.id}" style="flex:2;">${ZONES.map(z=>`<option value="${z}" ${p.zone===z?'selected':''}>${zoneLabel(z)}</option>`).join('')}</select>
              <button class="btn ghost small" data-zone-move="${p.id}" style="flex:1;">Imposta zona (1 Az.)</button>
            </div>
            <div id="zone-move-status-${p.id}" style="font-size:10px;margin-top:2px;min-height:12px;"></div>
            ${(()=>{
              if(!p.isPC) return '';
              const pMember = cachedRoster.find(m=>m.username===p.username);
              if(!pMember) return '';
              const orders = computeUnlockedTalents(pMember.tamer).filter(t=>t.order);
              if(orders.length===0) return '';
              return `<div class="row" style="margin-top:6px;">
                <select data-order-select="${p.id}" style="flex:2;">${orders.map(o=>{
                  const used = pMember.tamer.specialOrdersUsed && pMember.tamer.specialOrdersUsed[o.order];
                  const blocked = o.once && used;
                  return `<option value="${o.order}" ${blocked?'disabled':''}>${escapeHTML(o.name)} (${o.cost} Az. Tamer)${blocked?' — già usato':''}</option>`;
                }).join('')}</select>
                <button class="btn amber small" data-order-use="${p.id}" style="flex:1;" title="I Special Order sono Tamer Talent: il costo si scala dalle Azioni del Tamer, non da quelle del Digimon">✦ Special Order</button>
              </div>`;
            })()}
            <div style="margin-top:6px;">${effectTagsHTML(p)}${(p.effects||[]).map((e,ei)=>`<button class="btn ghost small" data-effect-remove="${p.id}|${ei}" style="padding:1px 6px;margin-left:2px;">✕</button>`).join('')}</div>
            <div class="row" style="margin-top:4px;">
              <select data-effect-select="${p.id}" style="flex:2;">${EFFECT_DEFS.map(e=>`<option value="${e.key}">${effectIcon(e.key)} ${escapeHTML(e.label)}</option>`).join('')}</select>
              <input type="number" data-effect-potency="${p.id}" value="1" min="1" placeholder="Pot." style="flex:1;" />
              <input type="number" data-effect-duration="${p.id}" value="3" min="1" max="3" placeholder="Dur." style="flex:1;" />
              <button class="btn small" data-effect-apply="${p.id}" style="flex:1;">+Effetto</button>
            </div>
          </div>
        `;}).join('')}
      </div>
      <div class="divider"></div>
      <div class="muted" style="font-size:10px;margin-bottom:2px;">Attaccante:</div>
      <div id="combat-attacker-picker" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;">
        ${combat.participants.map(p=>participantChipHTML(p,'attacker', combatPresetAttackerId===p.id, combat)).join('') || '<span class="muted" style="font-size:11px;">Nessun partecipante.</span>'}
      </div>
      <div class="muted" style="font-size:10px;margin-bottom:2px;">Bersaglio:</div>
      <div id="combat-target-picker" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;">
        ${combat.participants.map(p=>participantChipHTML(p,'target', combatPresetTargetId===p.id, combat)).join('') || '<span class="muted" style="font-size:11px;">Nessun partecipante.</span>'}
      </div>
      <select id="combat-attacker" style="display:none;">${combat.participants.map(p=>`<option value="${p.id}" ${combatPresetAttackerId===p.id?'selected':''}>${escapeHTML(p.name)}</option>`).join('')}</select>
      <select id="combat-target" style="display:none;">${combat.participants.map(p=>`<option value="${p.id}" ${combatPresetTargetId===p.id?'selected':''}>${escapeHTML(p.name)}</option>`).join('')}</select>
      <div class="muted" style="font-size:10px;margin:4px 0;">Tocca un ritratto per scegliere Attaccante/Bersaglio — bordo colorato = Alleato (ciano) o Nemico (rosso). Usati da Attacco, Clash e Jogress qui sotto.</div>
      <button class="btn amber" id="btn-combat-attack-toggle" style="width:100%;margin-top:4px;">⚔ ${combatAttackPanelOpen?'Chiudi':'Attacca...'}</button>
      <div id="combat-attack-panel" style="display:${combatAttackPanelOpen?'block':'none'};margin-top:6px;">
        <div class="section-title" style="font-size:11px;">⚔ Risolvi Attacco</div>
        <select id="combat-attack-choice" style="display:none;"><option value="">— scegli un Attacco —</option></select>
        <div id="combat-attack-buttons" style="display:grid;grid-template-columns:1fr 1fr;gap:6px;"></div>
        <label id="combat-battery-toggle-wrap" style="display:none;align-items:center;gap:6px;font-size:11px;color:var(--text-mute);margin:6px 0 0;">
          <input type="checkbox" id="combat-battery-toggle" /> <span id="combat-battery-toggle-label"></span>
        </label>
        <button class="btn amber" id="btn-combat-attack" style="width:100%;margin-top:6px;">⚔ Risolvi Attacco</button>
        <button class="btn" id="btn-combat-attack-area" style="width:100%;margin-top:6px;display:none;">🌪 Risolvi come Area (colpisce tutti nella zona del bersaglio)</button>
        <div id="combat-attack-result" style="margin-top:8px;"></div>
      </div>
      <div class="divider"></div>
      <div class="section-title" style="font-size:11px;">🤼 Clash (usa Attaccante/Bersaglio sopra)</div>
      <div class="row">
        <button class="btn small" id="btn-combat-clash-start" style="flex:1;">Inizia/Contesa</button>
        <button class="btn ghost small" id="btn-combat-clash-end" style="flex:1;">Termina</button>
      </div>
      <div id="combat-clash-result" style="margin-top:8px;"></div>
      <div id="combat-clash-actions" style="margin-top:8px;"></div>
      <div class="divider"></div>
      <label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text-mute);margin-bottom:6px;">
        <input type="checkbox" id="combat-jogress-unlock" ${combat.jogressUnlocked?'checked':''} /> 🔓 Sblocca Jogress per questo combattimento
      </label>
      ${combat.jogressUnlocked ? `
      <div class="section-title" style="font-size:11px;">🤝 Jogress (usa Attaccante/Bersaglio sopra, entrambi giocatori)</div>
      <div class="row">
        <button class="btn small" id="btn-jogress-attempt" style="flex:1;">🤝 Tenta Jogress (2 Az. ciascuno, TN 15)</button>
        <button class="btn ghost small" id="btn-jogress-end" style="flex:1;">↩️ Termina Jogress</button>
      </div>
      <div id="jogress-result" style="margin-top:8px;"></div>
      <div class="divider"></div>` : ''}
      <div class="row">
        <select id="combat-add-player" style="flex:2;">
          <option value="">Aggiungi giocatore...</option>
          ${players.map(p=>`<option value="${escapeAttr(p.username)}">${escapeHTML(displayName(p))}${p.digimon && p.digimon.name ? ' — '+escapeHTML(p.digimon.name) : ''}</option>`).join('')}
        </select>
        <button class="btn small" id="btn-combat-add-player" style="flex:1;">+ Aggiungi</button>
      </div>
      <div class="row" style="margin-top:8px;">
        <select id="combat-enemy-fromscene" style="flex:2;">
          <option value="">Digimon presenti in scena...</option>
          ${(cachedScene.encounters||[]).filter(e=>!combat.participants.some(p=>p.sourceEncounterId===e.id)).map(e=>{
            const disp = ENCOUNTER_DISPOSITIONS[e.disposition] || ENCOUNTER_DISPOSITIONS.enemy;
            return `<option value="${e.id}">${disp.icon} ${escapeHTML(e.name)} (${disp.label})${e.isBoss?' 👑':''}</option>`;
          }).join('')}
        </select>
        <select id="combat-fromscene-side" style="flex:1;">
          <option value="enemy">Nemico</option>
          <option value="ally">Alleato</option>
        </select>
        <button class="btn small" id="btn-combat-add-fromscene" style="flex:1;">+ Aggiungi</button>
      </div>
      <div class="row" style="margin-top:8px;">
        <select id="combat-enemy-fromdex" style="flex:1;">
          <option value="">Da Dex (opzionale, compila il form sotto)...</option>
          ${cachedDex.map(e=>`<option value="${e.id}">${escapeHTML(e.name)}</option>`).join('')}
        </select>
      </div>
      <div class="row" style="margin-top:6px;">
        <input type="text" id="combat-enemy-name" placeholder="Nome nemico" style="flex:2;" />
        <input type="number" id="combat-enemy-ram" placeholder="RAM" value="0" style="flex:1;" />
      </div>
      <div class="row" style="margin-top:6px;">
        <input type="number" id="combat-enemy-acc" placeholder="Accuracy" value="0" style="flex:1;" />
        <input type="number" id="combat-enemy-dmg" placeholder="Damage" value="0" style="flex:1;" />
      </div>
      <div class="row" style="margin-top:6px;">
        <input type="number" id="combat-enemy-dodge" placeholder="Dodge" value="0" style="flex:1;" />
        <input type="number" id="combat-enemy-arm" placeholder="Armor" value="0" style="flex:1;" />
        <input type="number" id="combat-enemy-hp" placeholder="Health" value="1" style="flex:1;" />
      </div>
      <div class="row" style="margin-top:6px;">
        <select id="combat-enemy-attribute" style="flex:1;">
          ${['Free','Vaccine','Data','Virus','Variable'].map(a=>`<option>${a}</option>`).join('')}
        </select>
      </div>
      <button class="btn small" id="btn-combat-add-enemy" style="width:100%;margin-top:6px;">+ Aggiungi Nemico</button>
      <div class="divider"></div>
      <button class="btn" id="btn-combat-roll-all" style="width:100%;margin-bottom:8px;">🎲 Tira Iniziativa per Tutti</button>
      <button class="btn solid" id="btn-combat-calc-order" style="width:100%;margin-bottom:8px;">Calcola Ordine</button>
      ${(combat.order && combat.order.length>0) ? `
      <div class="row" style="margin-bottom:8px;" title="Sposta il puntatore del turno direttamente su un partecipante a scelta, SENZA ricalcolare l'ordine (Azioni/Battery/round di tutti gli altri restano come sono) — utile per correggere un errore o far agire qualcuno fuori sequenza.">
        <select id="combat-jump-turn-select" style="flex:2;">${combat.order.map(pid=>{ const pp = combat.participants.find(x=>x.id===pid); if(!pp) return ''; return `<option value="${pid}">${escapeHTML(combatDisplayName(pp, true)+duplicateNameSuffix(combat, pp, true))}${pp.id===combat.order[combat.currentIndex]?' (turno attuale)':''}</option>`; }).join('')}</select>
        <button class="btn ghost small" id="btn-combat-jump-turn" style="flex:1;">➜ Vai al turno</button>
      </div>
      ` : ''}
      <div class="muted" style="margin-bottom:6px;">I tasti "Turno Successivo" / "Turno Precedente" / "Termina" si trovano nella scheda "Combattimento" qui sopra.</div>
      <div class="muted" id="combat-mgr-status" style="margin-top:6px;"></div>
    `;

    const persistAndRefresh = async ()=>{
      await saveCombat(code, cachedCombat);
      renderCombatManager(code, players);
      const combatLive = document.getElementById('combat-live');
      if(combatLive) combatLive.innerHTML = combatDisplayHTML(cachedCombat, true);
      bindZoneLineArrows(code, players);
    };

    const startZoneAllyLiveSel = document.getElementById('combat-startzone-ally-live');
    if(startZoneAllyLiveSel){
      startZoneAllyLiveSel.onchange = async ()=>{
        combat.startZoneAlly = startZoneAllyLiveSel.value;
        await saveCombat(code, combat);
      };
    }
    const startZoneEnemyLiveSel = document.getElementById('combat-startzone-enemy-live');
    if(startZoneEnemyLiveSel){
      startZoneEnemyLiveSel.onchange = async ()=>{
        combat.startZoneEnemy = startZoneEnemyLiveSel.value;
        await saveCombat(code, combat);
      };
    }
    const jogressUnlockCb = document.getElementById('combat-jogress-unlock');
    if(jogressUnlockCb){
      jogressUnlockCb.onchange = async ()=>{
        combat.jogressUnlocked = jogressUnlockCb.checked;
        await persistAndRefresh();
      };
    }

    function populateAttackChoice(){
      const attackerId = document.getElementById('combat-attacker').value;
      const attacker = combat.participants.find(p=>p.id===attackerId);
      const sel = document.getElementById('combat-attack-choice');
      const btnWrap = document.getElementById('combat-attack-buttons');
      if(!sel) return;
      const atks = getParticipantAttacks(attacker);
      // combatSelectedAttackIndex è la fonte di verità persistente (sopravvive a qualunque re-render
      // del pannello); se non è più valida per l'attaccante corrente (indice fuori range), si azzera.
      if(combatSelectedAttackIndex!==null && (combatSelectedAttackIndex<0 || combatSelectedAttackIndex>=atks.length)){
        combatSelectedAttackIndex = null;
      }
      if(atks.length===0){
        sel.innerHTML = '<option value="">⚠️ Nessun Attacco — importa da Dex</option>';
        if(btnWrap) btnWrap.innerHTML = '<div class="muted" style="font-size:11px;grid-column:1/-1;">⚠️ Nessun Attacco — importa da Dex.</div>';
      } else {
        sel.innerHTML = '<option value="">— scegli un Attacco —</option>' + atks.map((a,i)=>`<option value="${i}" ${combatSelectedAttackIndex===i?'selected':''}>${a.signature?'⭐ ':''}${escapeHTML(a.name)} — ${a.shape}/${a.type}</option>`).join('');
        sel.value = combatSelectedAttackIndex===null ? '' : String(combatSelectedAttackIndex);
        if(btnWrap){
          const applyHighlight = ()=>{
            btnWrap.querySelectorAll('[data-atk-btn]').forEach(b=>{
              const i = Number(b.getAttribute('data-atk-btn'));
              const a = atks[i];
              const typeColor = a.type==='Support' ? 'var(--cyan)' : 'var(--danger)';
              const isSel = combatSelectedAttackIndex === i;
              b.style.border = `2px solid ${isSel?typeColor:'var(--line)'}`;
              b.style.background = isSel?'rgba(255,255,255,0.06)':'var(--panel-2)';
            });
          };
          btnWrap.innerHTML = atks.map((a,i)=>{
            const typeColor = a.type==='Support' ? 'var(--cyan)' : 'var(--danger)';
            return `<button type="button" data-atk-btn="${i}" style="text-align:left;padding:8px;border-radius:8px;border:2px solid var(--line);background:var(--panel-2);cursor:pointer;">
              <div style="font-size:12px;font-weight:bold;color:${typeColor};">${a.signature?'⭐ ':''}${escapeHTML(a.name)}</div>
              <div class="muted" style="font-size:9px;">${a.shape} · ${a.type}${a.areaAttack?' · Area':''}</div>
            </button>`;
          }).join('');
          applyHighlight();
          btnWrap.querySelectorAll('[data-atk-btn]').forEach(b=>{
            b.onclick = ()=>{
              // Scritto sia sulla variabile persistente (sopravvive a QUALSIASI re-render, es. aprire
              // i dettagli di un altro partecipante) sia sulla select nascosta, che resta la fonte
              // letta da "Risolvi Attacco". Prima la scelta viveva solo nella select e spariva al
              // primo re-render causato da un click qualsiasi altrove nel pannello.
              combatSelectedAttackIndex = Number(b.getAttribute('data-atk-btn'));
              sel.value = b.getAttribute('data-atk-btn');
              applyHighlight();
              updateAreaButtonVisibility();
            };
          });
        }
      }
      updateAreaButtonVisibility();
    }
    function updateAreaButtonVisibility(){
      const attackerId = document.getElementById('combat-attacker').value;
      const attacker = combat.participants.find(p=>p.id===attackerId);
      const sel = document.getElementById('combat-attack-choice');
      const areaBtn = document.getElementById('btn-combat-attack-area');
      if(!sel || !areaBtn) return;
      let atk = null;
      if(attacker && sel.value !== ''){
        atk = getParticipantAttacks(attacker)[Number(sel.value)];
      }
      areaBtn.style.display = (atk && atk.areaAttack) ? 'block' : 'none';
      // BUGFIX (segnalato dall'utente: "la battery sugli attacchi non viene calcolata
      // correttamente"): mostra la spunta "Usa Battery" solo quando ha davvero senso -- Attacco
      // selezionato è una Signature Move E l'Attaccante ha Battery > 0 in questo momento -- così il
      // Master vede subito quanto sta per aggiungere, invece di scoprirlo solo nel log dopo il tiro.
      const batWrap = document.getElementById('combat-battery-toggle-wrap');
      const batLabel = document.getElementById('combat-battery-toggle-label');
      const batCb = document.getElementById('combat-battery-toggle');
      if(batWrap && batCb){
        const bat = attacker ? getParticipantBattery(attacker) : null;
        const show = !!(atk && atk.signature && bat && bat.current>0);
        batWrap.style.display = show ? 'flex' : 'none';
        if(!show){ batCb.checked = false; }
        else if(batLabel){ batLabel.textContent = `🔋 Usa Battery (${bat.current}/${bat.max}) su questa Signature Move: +${bat.current} Accuracy e +${bat.current} Danno (o Potenza se Support), poi si azzera.`; }
      }
    }
    const attackerSel = document.getElementById('combat-attacker');
    const targetSel = document.getElementById('combat-target');
    const attackChoiceSel = document.getElementById('combat-attack-choice');
    if(attackerSel) attackerSel.onchange = ()=>{ populateAttackChoice(); renderClashActions(); };
    if(targetSel) targetSel.onchange = renderClashActions;
    if(attackChoiceSel) attackChoiceSel.onchange = updateAreaButtonVisibility;
    populateAttackChoice();

    function renderClashActions(){
      const panel = document.getElementById('combat-clash-actions');
      if(!panel) return;
      const aId = document.getElementById('combat-attacker').value;
      const bId = document.getElementById('combat-target').value;
      const a = combat.participants.find(p=>p.id===aId);
      const b = combat.participants.find(p=>p.id===bId);
      if(!a || !b || a.id===b.id || a.clashWith!==b.id || b.clashWith!==a.id){
        panel.innerHTML = '<div class="muted">Seleziona due partecipanti attualmente in Clash tra loro per vedere le Azioni disponibili.</div>';
        return;
      }
      const controller = a.clashController ? a : (b.clashController ? b : null);
      const opponent = controller ? (controller===a ? b : a) : null;
      if(!controller){ panel.innerHTML = '<div class="muted">Nessun Controller determinato — usa "Inizia/Contesa".</div>'; return; }
      let hasWrestlemania = false;
      if(controller.isPC){
        const cMember = cachedRoster.find(m=>m.username===controller.username);
        if(cMember) hasWrestlemania = computeQualityMechanics(cMember.digimon.qualities).wrestlemania;
      }
      panel.innerHTML = `
        <div class="muted" style="margin-bottom:4px;">Controller: <b style="color:var(--cyan);">${escapeHTML(controller.name)}</b> · Opponent: <b>${escapeHTML(opponent.name)}</b>${opponent.clashPinned?' <span class="tag" style="color:var(--danger);border-color:var(--danger);">PINNATO</span>':''}</div>
        <div class="row">
          <button class="btn small" id="btn-clash-attack" style="flex:1;">⚔ Attacco (Dodge ½)</button>
          <button class="btn small" id="btn-clash-pin" style="flex:1;" ${opponent.clashPinned?'disabled':''}>📌 Pin</button>
          <button class="btn small" id="btn-clash-throw" style="flex:1;">🤾 Lancia</button>
        </div>
        ${hasWrestlemania ? `<div class="row" style="margin-top:6px;"><button class="btn amber" id="btn-clash-finisher" style="flex:1;">🏆 Finisher (Wrestlemania)</button></div>` : ''}
        <div class="row" style="margin-top:6px;">
          <button class="btn ghost small" id="btn-clash-weak" style="flex:1;">🥊 Attacco Disperato</button>
          <button class="btn ghost small" id="btn-clash-comeback" style="flex:1;" ${opponent.clashPinned?'disabled':''}>💪 Comeback</button>
          <button class="btn ghost small" id="btn-clash-contestpin" style="flex:1;" ${!opponent.clashPinned?'disabled':''}>🔓 Contest Pin</button>
        </div>
        <div class="muted" id="clash-action-result" style="margin-top:6px;"></div>
      `;
      const resEl = ()=>document.getElementById('clash-action-result');

      const finisherBtn = document.getElementById('btn-clash-finisher');
      if(finisherBtn){
        finisherBtn.onclick = async ()=>{
          const cStats = getParticipantCombatStats(controller);
          const oStats = getParticipantCombatStats(opponent);
          const accRoll = rollPool(cStats.accuracy);
          const dodgeRoll = rollPool(Math.floor(oStats.dodge/2));
          let text, techDetail, dealt=0;
          if(accRoll.successes<dodgeRoll.successes || accRoll.successes===0){
            text = `🏆 Finisher di ${narratorName(controller)} su ${narratorName(opponent)}: MANCATO — il Clash finisce comunque.`;
            techDetail = `Acc ${cStats.accuracy}d6[${accRoll.dice.join(',')}]=${accRoll.successes} succ. vs Dodge½ ${Math.floor(oStats.dodge/2)}d6[${dodgeRoll.dice.join(',')}]=${dodgeRoll.successes} succ.`;
          } else {
            const excess = accRoll.successes-dodgeRoll.successes;
            dealt = Math.max(0, excess+cStats.damage-oStats.armor);
            const cMember = cachedRoster.find(m=>m.username===controller.username);
            const stageNum = cMember ? stageIndex(cMember.digimon.stage)+1 : 1;
            const tn = 10+stageNum;
            const finVal = Math.max(cStats.cpu, cStats.bit||0);
            const { dice, total } = rollSkillCheck(finVal, 0);
            const verdict = evaluateVsTN(total, tn, dice);
            let bonus = 0, bonusNote='';
            if(verdict && (verdict.cls==='success'||verdict.cls==='crit-success')){
              bonus = stageNum;
              if(verdict.cls==='crit-success'){
                const bestDerived = Math.max(cStats.bit||0, cStats.dos||0, cStats.ram||0, cStats.cpu||0);
                if(bestDerived>stageNum) bonus = bestDerived;
              }
              dealt += bonus;
              bonusNote = ` +${bonus} bonus Finisher (Check ${total} vs TN ${tn}, ${verdict.label})`;
            } else {
              bonusNote = ` nessun bonus (Check ${total} vs TN ${tn}, Fallito)`;
            }
            await applyDamageToParticipant(code, combat, opponent, dealt);
            const w = getParticipantWounds(opponent);
            text = `🏆 Finisher di ${narratorName(controller)} su ${narratorName(opponent)}: COLPITO! ${dealt} danno → ${narratorName(opponent)} ${w.current}/${w.max} Ferite — il Clash finisce.`;
            techDetail = `Acc ${cStats.accuracy}d6[${accRoll.dice.join(',')}]=${accRoll.successes} succ. vs Dodge½ ${Math.floor(oStats.dodge/2)}d6[${dodgeRoll.dice.join(',')}]=${dodgeRoll.successes} succ.${bonusNote}`;
          }
          controller.clashWith=null; controller.clashController=false; controller.clashPinned=false; controller.clashComebackBonus=0;
          opponent.clashWith=null; opponent.clashController=false; opponent.clashPinned=false; opponent.clashComebackBonus=0;
          await pushCombatNarration(combat, { who:'Master', role:'roll', text: `${text}::TECH::${techDetail}`, meta:{dice:accRoll.dice.concat(dodgeRoll.dice), avatar: resolveParticipantImage(controller)} });
          await persistAndRefresh();
        };
      }

      document.getElementById('btn-clash-attack').onclick = async ()=>{
        const cStats = getParticipantCombatStats(controller);
        const oStats = getParticipantCombatStats(opponent);
        const accRoll = rollPool(cStats.accuracy);
        const dodgeRoll = rollPool(Math.floor(oStats.dodge/2));
        let dealt=0, text;
        const techDetail = `Acc ${cStats.accuracy}d6[${accRoll.dice.join(',')}]=${accRoll.successes} succ. vs Dodge½ ${Math.floor(oStats.dodge/2)}d6[${dodgeRoll.dice.join(',')}]=${dodgeRoll.successes} succ.`;
        if(accRoll.successes<dodgeRoll.successes || accRoll.successes===0){
          text = `⚔ ${narratorName(controller)} attacca ${narratorName(opponent)} nel Clash: MANCATO`;
        } else {
          const excess = accRoll.successes-dodgeRoll.successes;
          dealt = Math.max(0, excess+cStats.damage-oStats.armor);
          await applyDamageToParticipant(code, combat, opponent, dealt);
          const w = getParticipantWounds(opponent);
          text = `⚔ ${narratorName(controller)} attacca ${narratorName(opponent)} nel Clash: COLPITO! ${dealt} danno → ${narratorName(opponent)} ${w.current}/${w.max} Ferite`;
        }
        await pushCombatNarration(combat, { who:'Master', role:'roll', text: `${text}::TECH::${techDetail}`, meta:{dice:accRoll.dice.concat(dodgeRoll.dice), avatar: resolveParticipantImage(controller)} });
        await persistAndRefresh();
        renderClashActions();
      };
      document.getElementById('btn-clash-pin').onclick = async ()=>{
        opponent.clashPinned = true;
        await pushCombatNarration(combat, { who:'Master', role:'gm', text: `📌 ${narratorName(controller)} pinna ${narratorName(opponent)}: non può Fuggire o fare Comeback finché non riesce un Contest Pin.`, meta:{avatar: resolveParticipantImage(controller)} });
        await persistAndRefresh();
        renderClashActions();
      };
      document.getElementById('btn-clash-throw').onclick = async ()=>{
        const cStats = getParticipantCombatStats(controller);
        const oStats = getParticipantCombatStats(opponent);
        const cSizeIdx = getParticipantSizeIndex(controller);
        const oSizeIdx = getParticipantSizeIndex(opponent);
        if((oSizeIdx - cSizeIdx) >= 2 && !cStats.monsterStrength){
          const resEl2 = document.getElementById('clash-action-result');
          if(resEl2) resEl2.innerHTML = `<div class="err">${opponent.name} è 2+ Size più grande di ${controller.name}: serve Monster Strength (o Titan Power) per Lanciarlo.</div>`;
          return;
        }
        const dealt = Math.max(0, cStats.damage - oStats.armor);
        await applyDamageToParticipant(code, combat, opponent, dealt);
        const zi = Math.min(ZONES.length-1, zoneIndex(opponent.zone||'Medio')+1);
        opponent.zone = ZONES[zi];
        controller.clashWith=null; controller.clashController=false; controller.clashPinned=false; controller.clashComebackBonus=0;
        opponent.clashWith=null; opponent.clashController=false; opponent.clashPinned=false; opponent.clashComebackBonus=0;
        const w = getParticipantWounds(opponent);
        await pushCombatNarration(combat, { who:'Master', role:'gm', text: `🤾 ${narratorName(controller)} lancia ${narratorName(opponent)} (${dealt} danno, ora a ${zoneLabel(opponent.zone)}) — il Clash finisce.`, meta:{avatar: resolveParticipantImage(controller)} });
        await persistAndRefresh();
      };
      document.getElementById('btn-clash-weak').onclick = async ()=>{
        const oStats = getParticipantCombatStats(opponent);
        const cStats = getParticipantCombatStats(controller);
        const accRoll = rollPool(oStats.accuracy);
        const dodgeRoll = rollPool(Math.floor(cStats.dodge/2));
        let dealt=0, text;
        const techDetail = `Acc ${oStats.accuracy}d6[${accRoll.dice.join(',')}]=${accRoll.successes} succ. vs Dodge½ ${Math.floor(cStats.dodge/2)}d6[${dodgeRoll.dice.join(',')}]=${dodgeRoll.successes} succ.`;
        if(accRoll.successes<dodgeRoll.successes || accRoll.successes===0){
          text = `🥊 ${narratorName(opponent)} tenta un Attacco Disperato su ${narratorName(controller)}: MANCATO`;
        } else {
          const excess = accRoll.successes-dodgeRoll.successes;
          const raw = Math.max(0, excess+oStats.damage-cStats.armor);
          dealt = Math.ceil(raw/2);
          await applyDamageToParticipant(code, combat, controller, dealt);
          const w = getParticipantWounds(controller);
          text = `🥊 ${narratorName(opponent)} tenta un Attacco Disperato su ${narratorName(controller)}: COLPITO! ${dealt} danno (dimezzato) → ${narratorName(controller)} ${w.current}/${w.max} Ferite`;
        }
        await pushCombatNarration(combat, { who:'Master', role:'roll', text: `${text}::TECH::${techDetail}`, meta:{dice:accRoll.dice.concat(dodgeRoll.dice), avatar: resolveParticipantImage(opponent)} });
        await persistAndRefresh();
        renderClashActions();
      };
      document.getElementById('btn-clash-comeback').onclick = async ()=>{
        opponent.clashComebackBonus = 3;
        await pushCombatNarration(combat, { who:'Master', role:'gm', text: `💪 ${narratorName(opponent)} si prepara al Comeback: +3 alla prossima Contesa del Clash.`, meta:{avatar: resolveParticipantImage(opponent)} });
        await persistAndRefresh();
        renderClashActions();
      };
      document.getElementById('btn-clash-contestpin').onclick = async ()=>{
        const oStats = getParticipantClashStats(opponent);
        const cStats = getParticipantClashStats(controller);
        const tn = 12 + cStats.cpu;
        const val = Math.max(oStats.cpu, oStats.ram);
        const { dice, total } = rollSkillCheck(val, 0);
        const techDetail = `3d6[${dice.join(',')}]+${val}=${total} vs TN ${tn}`;
        let text;
        if(total >= tn){
          opponent.clashPinned = false;
          opponent.clashComebackBonus = 2;
          text = `🔓 ${narratorName(opponent)} tenta Contest Pin: Successo! Pin rotto, +2 alla prossima Contesa.`;
        } else {
          text = `🔓 ${narratorName(opponent)} tenta Contest Pin: Fallito, resta Pinnato.`;
        }
        await pushCombatNarration(combat, { who:'Master', role:'roll', text: `${text}::TECH::${techDetail}`, meta:{dice, avatar: resolveParticipantImage(opponent)} });
        await persistAndRefresh();
        renderClashActions();
      };
    }
    renderClashActions();

    const attackBtn = document.getElementById('btn-combat-attack');
    if(attackBtn){
      attackBtn.onclick = async ()=>{
        const attackerId = document.getElementById('combat-attacker').value;
        const targetId = document.getElementById('combat-target').value;
        const attacker = combat.participants.find(p=>p.id===attackerId);
        const target = combat.participants.find(p=>p.id===targetId);
        const resEl = document.getElementById('combat-attack-result');
        let atk = null;
        const atkChoiceEl = document.getElementById('combat-attack-choice');
        if(attacker && atkChoiceEl && atkChoiceEl.value !== ''){
          atk = getParticipantAttacks(attacker)[Number(atkChoiceEl.value)];
        }
        if(!atk){
          if(resEl) resEl.innerHTML = `<div class="err">Scegli un Attacco dalla lista (per regolamento non esiste un "attacco generico" — ogni Attacco ha sempre almeno [MELEE]/[RANGE] e [DAMAGE]/[SUPPORT]). Se ${attacker?escapeHTML(attacker.name):'il partecipante'} non ne ha, importali dal Dex.</div>`;
          return;
        }
        const validation = validateAttackTargeting(attacker, target, atk);
        if(!validation.ok){
          if(resEl) resEl.innerHTML = `<div class="err">${validation.error}</div>`;
          return;
        }
        // Applica il limite di 1 Attacco a round (eccetto Ammo Rank, già gestito da trySpendAction).
        const spend = trySpendAction(attacker, 'attack');
        if(!spend.ok){
          if(resEl) resEl.innerHTML = `<div class="err">${spend.msg}</div>`;
          return;
        }
        if(resEl) resEl.innerHTML = '<div class="muted" style="font-size:11px;">Tiro...</div>';
        const batteryCb = document.getElementById('combat-battery-toggle');
        const useBattery = !!(batteryCb && batteryCb.checked);
        const { logText, dealt, accRoll, dodgeRoll, defeatInfo } = await performAttackRoll(code, combat, attacker, target, atk, { useBattery });
        const hit = accRoll.successes > 0 && accRoll.successes >= dodgeRoll.successes;
        const detailHTML = `${diceRowHTML(accRoll.dice)}<span class="muted">vs</span>${diceRowHTML(dodgeRoll.dice)}<div class="muted" style="margin-top:4px;font-size:10.5px;">${escapeHTML(logText)}</div>`;
        const fallbackCompact = attackResultCompactHTML(null, hit, dealt, detailHTML);
        // Testo principale in chat = narrazione (di base, subito; sostituita dall'AI se arriva in tempo).
        // I dettagli tecnici (Accuracy/Dodge, tiri) restano dietro il marcatore ::TECH::, visibili solo espandendo.
        const baseNarr = basicAttackNarration(attacker, target, atk, hit, dealt, defeatInfo);
        const pushed = await pushCombatNarration(combat, { who: narratorName(attacker), role:'roll', text: `${baseNarr}::TECH::${logText}`, meta:{ dice: accRoll.dice.concat(dodgeRoll.dice), avatar: resolveParticipantImage(attacker) } });
        const rollEntryId = pushed && pushed.entry && pushed.entry.id;
        if(defeatInfo){
          const defeatDispName = target.nameHidden ? hiddenParticipantLabel(target) : defeatInfo.name;
          const noticeText = defeatNoticeText(defeatInfo, defeatDispName);
          await pushCombatNarration(combat, { who:'Sistema', role:'gm', text: noticeText });
        }
        await persistAndRefresh();
        // persistAndRefresh ricostruisce l'intera card (quindi anche #combat-attack-result vuoto):
        // riapplico subito il risultato (dadi/danno) — non aspetta l'AI, così il tiro non resta mai bloccato.
        const resEl2 = document.getElementById('combat-attack-result');
        if(resEl2) resEl2.innerHTML = fallbackCompact;
        // Narrazione AI: gareggia con un timeout (vedi AI_NARRATION_TIMEOUT_MS). Se arriva in tempo,
        // sostituisce la frase di base come testo principale dello STESSO messaggio (i dettagli
        // tecnici restano invariati dietro l'espandi).
        const narrTimeout = new Promise(resolve=>setTimeout(()=>resolve(null), AI_NARRATION_TIMEOUT_MS));
        Promise.race([narrateAttack(attacker, target, atk, hit, dealt, defeatInfo), narrTimeout]).then(async (narrLine)=>{
          if(!narrLine || !rollEntryId) return;
          await editLogEntry(code, rollEntryId, `${narrLine}::TECH::${logText}`, combatNarrationThread(combat));
          refreshLiveParts();
        });
      };
    }

    const areaAttackBtn = document.getElementById('btn-combat-attack-area');
    if(areaAttackBtn){
      areaAttackBtn.onclick = async ()=>{
        const attackerId = document.getElementById('combat-attacker').value;
        const targetId = document.getElementById('combat-target').value;
        const attacker = combat.participants.find(p=>p.id===attackerId);
        const centerTarget = combat.participants.find(p=>p.id===targetId);
        const resEl = document.getElementById('combat-attack-result');
        if(!attacker || !centerTarget){
          if(resEl) resEl.innerHTML = '<div class="err">Scegli attaccante e bersaglio.</div>';
          return;
        }
        const atkChoiceEl = document.getElementById('combat-attack-choice');
        let atk = null;
        if(atkChoiceEl && atkChoiceEl.value !== ''){
          atk = getParticipantAttacks(attacker)[Number(atkChoiceEl.value)];
        }
        if(!atk || !atk.areaAttack){
          if(resEl) resEl.innerHTML = '<div class="err">L\'attacco selezionato non è un Area Attack.</div>';
          return;
        }
        const spend = trySpendAction(attacker, 'attack');
        if(!spend.ok){
          if(resEl) resEl.innerHTML = `<div class="err">${spend.msg}</div>`;
          return;
        }
        const zone = centerTarget.zone || 'Medio';
        const victims = combat.participants.filter(p=>p.id!==attacker.id && p.side!==attacker.side && (p.zone||'Medio')===zone);
        if(victims.length===0){
          if(resEl) resEl.innerHTML = `<div class="err">Nessun bersaglio avversario nella zona ${zone}.</div>`;
          return;
        }
        const aStats = getParticipantCombatStats(attacker);
        const effAccuracy = Math.max(0, aStats.accuracy);
        const accRoll = rollPool(effAccuracy);
        if(aStats.certainStrike>0) accRoll.successes += aStats.certainStrike;
        const lines = [`🌪 ${narratorName(attacker)} usa ${atk.name} ${attackTagsPlain(atk)} come Area Attack sulla zona ${zone} (Accuracy ${effAccuracy}d6[${accRoll.dice.join(',')}]=${accRoll.successes} succ.):`];
        let combatMonsterGain = 0;
        for(const v of victims){
          const vStats = getParticipantCombatStats(v);
          const dodgeRoll = rollPool(vStats.dodge);
          if(vStats.absoluteEvasion>0) dodgeRoll.successes += vStats.absoluteEvasion;
          if(accRoll.successes < dodgeRoll.successes || accRoll.successes===0){
            lines.push(`— ${narratorName(v)}: MANCATO (Dodge ${vStats.dodge}d6[${dodgeRoll.dice.join(',')}]=${dodgeRoll.successes} succ.)`);
            continue;
          }
          const excess = accRoll.successes - dodgeRoll.successes;
          if(atk.type==='Support'){
            if(atk.effectKey){
              const def = EFFECT_DEFS.find(d=>d.key===atk.effectKey);
              const isPositive = def && def.type==='positive';
              const finalPotency = isPositive ? 0 : 1;
              if(def && def.instant){
                const msg = await applyInstantEffect(code, v, atk.effectKey, 1);
                lines.push(`— ${narratorName(v)}: COLPITO! ${msg}`);
              } else if(finalPotency>0){
                if(!v.effects) v.effects=[];
                v.effects.push({ key: atk.effectKey, potency:1, duration:1 });
                lines.push(`— ${narratorName(v)}: COLPITO! Applica ${def?def.label:atk.effectKey} (Potenza 1, Durata 1 — ridotto da Area).`);
              } else {
                lines.push(`— ${narratorName(v)}: COLPITO! Effetto positivo azzerato dalla penalità Area (nessun effetto).`);
              }
            } else {
              lines.push(`— ${narratorName(v)}: COLPITO! (nessun Effetto collegato)`);
            }
          } else {
            const raw = excess + aStats.damage;
            const dealt = Math.max(0, Math.ceil((raw - vStats.armor)/2));
            await applyDamageToParticipant(code, combat, v, dealt);
            if(dealt>0) combatMonsterGain += dealt;
            const w = getParticipantWounds(v);
            const vDefeat = await applyDefeatIfNeeded(code, v);
            const vDefeatNote = defeatInlineNote(vDefeat);
            lines.push(`— ${narratorName(v)}: COLPITO! ${dealt} danno (dimezzato da Area) → ${w.current}/${w.max} Ferite${vDefeatNote}`);
          }
        }
        if(attacker.isPC && atk.type!=='Support'){
          const aMember = cachedRoster.find(m=>m.username===attacker.username);
          if(aMember && Number(aMember.digimon.resolveCurrent||0)>0 && computeQualityMechanics(aMember.digimon.qualities).combatMonster>0){
            aMember.digimon.resolveCurrent = 0;
            await saveMember(code, aMember);
          }
        }
        if(resEl) resEl.innerHTML = '<div class="muted" style="font-size:11px;">Tiro in corso...</div>';
        const hitCount = victims.length - lines.filter(l=>l.includes('MANCATO')).length;
        const areaFriendly = `🌪 ${narratorName(attacker)} usa ${atk.name} come Area su ${zoneLabel(zone)}: ${hitCount}/${victims.length} colpiti.`;
        const compactHTML = attackResultCompactHTML(
          areaFriendly,
          hitCount>0, combatMonsterGain,
          `${diceRowHTML(accRoll.dice)}<div class="muted" style="margin-top:4px;font-size:10.5px;">${lines.map(escapeHTML).join('<br>')}</div>`
        );
        await pushCombatNarration(combat, { who:'Master', role:'roll', text: `${areaFriendly}::TECH::${lines.join(' | ')}`, meta:{ dice: accRoll.dice, avatar: resolveParticipantImage(attacker) } });
        await persistAndRefresh();
        const resEl2 = document.getElementById('combat-attack-result');
        if(resEl2) resEl2.innerHTML = compactHTML;
      };
    }

    const clashStartBtn = document.getElementById('btn-combat-clash-start');
    if(clashStartBtn){
      clashStartBtn.onclick = async ()=>{
        const aId = document.getElementById('combat-attacker').value;
        const bId = document.getElementById('combat-target').value;
        const a = combat.participants.find(p=>p.id===aId);
        const b = combat.participants.find(p=>p.id===bId);
        const resEl = document.getElementById('combat-clash-result');
        if(!a || !b || a.id===b.id){
          if(resEl) resEl.innerHTML = '<div class="err">Scegli due partecipanti diversi.</div>';
          return;
        }
        const aStats = getParticipantClashStats(a);
        const bStats = getParticipantClashStats(b);
        const wasClashPair = a.clashWith===b.id && b.clashWith===a.id;
        const aPinned = wasClashPair && a.clashPinned && !a.clashController;
        const bPinned = wasClashPair && b.clashPinned && !b.clashController;
        let winner, loser, aRoll, bRoll, autoWin=false;
        if(aPinned || bPinned){
          winner = aPinned ? b : a; loser = aPinned ? a : b;
          autoWin = true;
        } else {
          const aBonus = (a.clashComebackBonus||0) + (aStats.clashBonus||0);
          const bBonus = (b.clashComebackBonus||0) + (bStats.clashBonus||0);
          aRoll = rollSkillCheck(aStats.cpu, aStats.ram); aRoll.total += aBonus;
          bRoll = rollSkillCheck(bStats.cpu, bStats.ram); bRoll.total += bBonus;
          if(aRoll.total > bRoll.total){ winner=a; loser=b; }
          else if(bRoll.total > aRoll.total){ winner=b; loser=a; }
          else if(aStats.cpu !== bStats.cpu){ winner = aStats.cpu>bStats.cpu ? a : b; loser = winner===a?b:a; }
          else { winner = a; loser = b; }
        }
        a.clashComebackBonus = 0; b.clashComebackBonus = 0;
        a.clashPinned = false; b.clashPinned = false;
        a.clashWith = b.id; b.clashWith = a.id;
        a.clashController = (winner.id===a.id); b.clashController = (winner.id===b.id);
        if(a.isPC){ const m=cachedRoster.find(x=>x.username===a.username); if(m){ m.digimon.stance='Neutral'; await saveMember(code, m); } }
        if(b.isPC){ const m=cachedRoster.find(x=>x.username===b.username); if(m){ m.digimon.stance='Neutral'; await saveMember(code, m); } }
        const friendlyClash = autoWin
          ? `🤼 Clash: il Pin era ancora attivo, controlla automaticamente ${narratorName(winner)}. Entrambi tornano in Stance Neutrale.`
          : `🤼 Clash: controlla ${narratorName(winner)}. Entrambi tornano in Stance Neutrale.`;
        const techClash = autoWin
          ? `Pin attivo su ${narratorName(loser)}: nessun tiro, controllo automatico a ${narratorName(winner)}.`
          : `${narratorName(a)} 3d6+CPU${aStats.cpu}+RAM${aStats.ram}=${aRoll.total} vs ${narratorName(b)} 3d6+CPU${bStats.cpu}+RAM${bStats.ram}=${bRoll.total}`;
        const clashMeta = autoWin ? { avatar: resolveParticipantImage(winner) } : { dice:(aRoll.dice||[]).concat(bRoll.dice||[]), avatar: resolveParticipantImage(winner) };
        await pushCombatNarration(combat, { who:'Master', role:'gm', text: `${friendlyClash}::TECH::${techClash}`, meta: clashMeta });
        if(resEl) resEl.innerHTML = `<div class="muted">Controlla il Clash: <b style="color:var(--cyan);">${escapeHTML(winner.name)}</b></div>`;
        await persistAndRefresh();
      };
    }
    const clashEndBtn = document.getElementById('btn-combat-clash-end');
    if(clashEndBtn){
      clashEndBtn.onclick = async ()=>{
        const aId = document.getElementById('combat-attacker').value;
        const bId = document.getElementById('combat-target').value;
        const a = combat.participants.find(p=>p.id===aId);
        const b = combat.participants.find(p=>p.id===bId);
        if(a){ a.clashWith=null; a.clashController=false; a.clashPinned=false; a.clashComebackBonus=0; }
        if(b){ b.clashWith=null; b.clashController=false; b.clashPinned=false; b.clashComebackBonus=0; }
        await pushCombatNarration(combat, { who:'Master', role:'gm', text: `🏁 Il Clash tra ${a?narratorName(a):'?'} e ${b?narratorName(b):'?'} è terminato.` });
        const resEl = document.getElementById('combat-clash-result');
        if(resEl) resEl.innerHTML = '';
        await persistAndRefresh();
      };
    }

    const jogressAttemptBtn = document.getElementById('btn-jogress-attempt');
    if(jogressAttemptBtn){
      jogressAttemptBtn.onclick = async ()=>{
        const aId = document.getElementById('combat-attacker').value;
        const bId = document.getElementById('combat-target').value;
        const a = combat.participants.find(p=>p.id===aId);
        const b = combat.participants.find(p=>p.id===bId);
        const resEl = document.getElementById('jogress-result');
        if(!a || !b || a.id===b.id || !a.isPC || !b.isPC){
          if(resEl) resEl.innerHTML = '<div class="err">Scegli due partecipanti giocatori diversi in Attaccante/Bersaglio.</div>';
          return;
        }
        const aMember = cachedRoster.find(m=>m.username===a.username);
        const bMember = cachedRoster.find(m=>m.username===b.username);
        if(!aMember || !bMember) return;
        if(stageIndex(aMember.digimon.stage) !== stageIndex(bMember.digimon.stage)){
          if(resEl) resEl.innerHTML = `<div class="err">Jogress richiede due Digimon dello stesso Stage (${aMember.digimon.stage} vs ${bMember.digimon.stage}).</div>`;
          return;
        }
        a.actions = Math.max(0,(a.actions||0)-2); b.actions = Math.max(0,(b.actions||0)-2);
        const aRoll = rollSkillCheck(aMember.tamer.willpower, 0);
        const bRoll = rollSkillCheck(bMember.tamer.willpower, 0);
        const aOk = aRoll.total >= 15, bOk = bRoll.total >= 15;
        const jogressTech = `${a.name} (Willpower ${aMember.tamer.willpower}) 3d6[${aRoll.dice.join(',')}]=${aRoll.total} vs TN 15 (${aOk?'Successo':'Fallito'}) · ${b.name} (Willpower ${bMember.tamer.willpower}) 3d6[${bRoll.dice.join(',')}]=${bRoll.total} vs TN 15 (${bOk?'Successo':'Fallito'})`;
        if(!aOk || !bOk){
          if(resEl) resEl.innerHTML = `<div class="err">Jogress fallito.</div>`;
          await pushCombatNarration(combat, { who:'Master', role:'roll', text: `🤝 Tentativo di Jogress tra ${a.name} e ${b.name}: NON riuscito.::TECH::${jogressTech}`, meta:{dice:aRoll.dice.concat(bRoll.dice)} });
          await persistAndRefresh();
          return;
        }
        const fusionName = window.prompt('Nome del Digimon fuso:', `${aMember.digimon.name}+${bMember.digimon.name}`) || `${aMember.digimon.name}+${bMember.digimon.name}`;
        const newStageIdx = Math.min(5, Math.max(stageIndex(aMember.digimon.stage), stageIndex(bMember.digimon.stage))+1);
        const newStage = STAGES[newStageIdx];
        const fused = {
          id: 'p'+Date.now()+Math.random().toString(36).slice(2,6),
          name: fusionName, side: a.side, isPC:false,
          accuracy: Number(aMember.digimon.baseAccuracy)+Number(bMember.digimon.baseAccuracy),
          damage: Number(aMember.digimon.baseDamage)+Number(bMember.digimon.baseDamage),
          dodge: Number(aMember.digimon.baseDodge)+Number(bMember.digimon.baseDodge),
          armor: Number(aMember.digimon.baseArmor)+Number(bMember.digimon.baseArmor),
          maxWounds: Number(aMember.digimon.maxWounds)+Number(bMember.digimon.maxWounds),
          currentWounds: Number(aMember.digimon.currentWounds)+Number(bMember.digimon.currentWounds),
          ram: Number(aMember.digimon.baseDodge)+Number(bMember.digimon.baseDodge),
          initiative: Math.min(a.initiative||0, b.initiative||0),
          actions: 2, attackedThisRound:false, effects:[], zone: a.zone||'Medio',
          jogressOf: [a.username, b.username], jogressStage: newStage
        };
        combat.participants = combat.participants.filter(p=>p.id!==a.id && p.id!==b.id);
        combat.participants.push(fused);
        const jogressFriendly = `🤝 Successo! ${aMember.digimon.name} e ${bMember.digimon.name} si fondono in ${fusionName} (${newStage}).`;
        await pushCombatNarration(combat, { who:'Master', role:'roll', text: `${jogressFriendly}::TECH::${jogressTech}`, meta:{dice:aRoll.dice.concat(bRoll.dice)} });
        if(resEl) resEl.innerHTML = `<div class="muted">Fusione riuscita: <b style="color:var(--cyan);">${escapeHTML(fusionName)}</b></div>`;
        await persistAndRefresh();
      };
    }
    const jogressEndBtn = document.getElementById('btn-jogress-end');
    if(jogressEndBtn){
      jogressEndBtn.onclick = async ()=>{
        const targetId = document.getElementById('combat-target').value;
        const fused = combat.participants.find(p=>p.id===targetId && p.jogressOf);
        if(!fused){
          const resEl = document.getElementById('jogress-result');
          if(resEl) resEl.innerHTML = '<div class="err">Seleziona nel menu Bersaglio il Digimon fuso da sciogliere.</div>';
          return;
        }
        combat.participants = combat.participants.filter(p=>p.id!==fused.id);
        await pushCombatNarration(combat, { who:'Master', role:'gm', text: `↩️ La fusione ${fused.name} si scioglie. Riaggiungi ${fused.jogressOf.join(' e ')} manualmente dal menu "Aggiungi giocatore".` });
        const resEl = document.getElementById('jogress-result');
        if(resEl) resEl.innerHTML = '';
        await persistAndRefresh();
      };
    }

    cardEl.querySelectorAll('[data-part-init]').forEach(inp=>{
      inp.onchange = async ()=>{
        const id = inp.getAttribute('data-part-init');
        const p = combat.participants.find(x=>x.id===id);
        if(p) p.initiative = Number(inp.value)||0;
        await saveCombat(code, combat);
      };
    });
    cardEl.querySelectorAll('[data-part-remove]').forEach(btn=>{
      btn.onclick = async ()=>{
        const id = btn.getAttribute('data-part-remove');
        combat.participants = combat.participants.filter(x=>x.id!==id);
        await persistAndRefresh();
      };
    });
    cardEl.querySelectorAll('[data-part-toggle]').forEach(btn=>{
      btn.onclick = ()=>{
        const id = btn.getAttribute('data-part-toggle');
        if(combatExpandedIds.has(id)) combatExpandedIds.delete(id); else combatExpandedIds.add(id);
        renderCombatManager(code, players);
      };
    });
    cardEl.querySelectorAll('[data-toggle-side]').forEach(btn=>{
      btn.onclick = async ()=>{
        const id = btn.getAttribute('data-toggle-side');
        const p = combat.participants.find(x=>x.id===id);
        if(!p) return;
        p.side = p.side==='ally' ? 'enemy' : 'ally';
        await persistAndRefresh();
      };
    });
    cardEl.querySelectorAll('[data-part-reenter]').forEach(btn=>{
      btn.onclick = async ()=>{
        const id = btn.getAttribute('data-part-reenter');
        const p = combat.participants.find(x=>x.id===id);
        if(!p) return;
        if(!window.confirm(`${p.name} rientra in combattimento a proprio rischio (nessuna protezione da regolamento per questa scelta) — confermi?`)) return;
        if(p.isPC){
          const member = cachedRoster.find(m=>m.username===p.username);
          if(member){ member.digimon.defeated = false; await saveMember(code, member); }
        } else {
          p.defeated = false;
        }
        await pushCombatNarration(combat, { who:'Sistema', role:'gm', text: `↩️ ${p.name} rientra in combattimento a proprio rischio.` });
        await persistAndRefresh();
      };
    });
    cardEl.querySelectorAll('[data-chip-role]').forEach(btn=>{
      btn.onclick = ()=>{
        const role = btn.getAttribute('data-chip-role');
        const id = btn.getAttribute('data-chip-id');
        const sel = document.getElementById(role==='attacker' ? 'combat-attacker' : 'combat-target');
        if(sel) sel.value = id;
        if(role==='attacker'){ combatPresetAttackerId = id; combatSelectedAttackIndex = null; }
        else combatPresetTargetId = id;
        renderCombatManager(code, players);
      };
    });
    const attackToggleBtn = document.getElementById('btn-combat-attack-toggle');
    if(attackToggleBtn){
      attackToggleBtn.onclick = ()=>{
        combatAttackPanelOpen = !combatAttackPanelOpen;
        renderCombatManager(code, players);
      };
    }
    // Richiesta utente: "le scelte del tamer non si capiscono minimamente quali siano" -- mostra la
    // descrizione in chiaro dell'Azione scelta anche nella riga del Master, aggiornata ad ogni cambio.
    // Richiesta successiva: "dividi le azioni del digimon da quelle del tamer in due menu diversi" --
    // ora ci sono due select per riga (data-daction-select/data-taction-select), stessa logica di
    // binding applicata a entrambi tramite bindActionDesc.
    // pickAttr/pickShowKey: come lato giocatore (bindDesc in bindCombatSelfActions), mostra il
    // selettore Stance/Skill dedicato solo quando l'Azione che lo richiede è selezionata.
    const bindActionDesc = (attr, descAttr, defs, pickAttr, pickShowKey)=>{
      cardEl.querySelectorAll(`[${attr}]`).forEach(sel=>{
        const id = sel.getAttribute(attr);
        const descEl = cardEl.querySelector(`[${descAttr}="${id}"]`);
        const pickEl = pickAttr ? cardEl.querySelector(`[${pickAttr}="${id}"]`) : null;
        if(!descEl) return;
        const updateDesc = ()=>{
          const def = defs.find(a=>a.key===sel.value);
          descEl.textContent = (def && def.desc) || '';
          if(pickEl) pickEl.style.display = (sel.value===pickShowKey) ? '' : 'none';
        };
        sel.onchange = updateDesc;
        updateDesc();
      });
    };
    bindActionDesc('data-daction-select', 'data-daction-desc', DIGIMON_ACTION_DEFS, 'data-stance-pick', 'stance');
    bindActionDesc('data-taction-select', 'data-taction-desc', TAMER_ACTION_DEFS, 'data-skill-pick', 'skill_tamer');
    cardEl.querySelectorAll('[data-action-info]').forEach(btn=>{
      const infoId = btn.getAttribute('data-action-info');
      const isDigimon = infoId.startsWith('d-');
      const pid = infoId.slice(2);
      const sel = cardEl.querySelector(`[${isDigimon?'data-daction-select':'data-taction-select'}="${pid}"]`);
      const defs = isDigimon ? DIGIMON_ACTION_DEFS : TAMER_ACTION_DEFS;
      bindActionInfoIcon(btn, sel, defs);
    });

    const bindActionUse = (useAttr, selectAttr)=>{
      cardEl.querySelectorAll(`[${useAttr}]`).forEach(btn=>{
        btn.onclick = async ()=>{
          const id = btn.getAttribute(useAttr);
          const p = combat.participants.find(x=>x.id===id);
          const sel = cardEl.querySelector(`[${selectAttr}="${id}"]`);
          if(!p || !sel) return;
          if(sel.value==='attack'){
            // L'Azione "Attacca" viene spesa al momento della risoluzione effettiva nel pannello
            // "⚔ Risolvi Attacco" (che applica lì il limite di 1 Attacco a round) — qui apro solo il pannello.
            combatAttackPanelOpen = true;
            combatPresetAttackerId = p.id;
            combatSelectedAttackIndex = null;
            renderCombatManager(code, players);
            return;
          }
          const result = trySpendAction(p, sel.value);
          const statusEl = document.getElementById('combat-mgr-status');
          if(!result.ok){
            if(statusEl){ statusEl.style.color='var(--danger)'; statusEl.textContent = result.msg; }
            return;
          }
          // Direct/Aid/Guard/Bolster: bersaglio riusato dal select "Avvicina/Allontana" della stessa
          // riga (data-zone-ref) -- Guard non ha bisogno di bersaglio, si applica sempre a se stesso.
          let supportNote = '';
          let presetAttacker = false;
          if(SUPPORT_ACTION_KEYS.includes(sel.value)){
            const zoneRefSel = cardEl.querySelector(`[data-zone-ref="${id}"]`);
            const supportTarget = sel.value==='guard' ? p : (zoneRefSel && zoneRefSel.value ? combat.participants.find(x=>x.id===zoneRefSel.value) : null);
            const effect = await applySupportActionEffect(sel.value, p, supportTarget);
            supportNote = ' ' + effect.note;
          } else if(MECHANIC_ACTION_KEYS.includes(sel.value)){
            // Reinforce/Reposition/Resist/Stance/Skill Check/Clash: tutte azioni su se stessi (nessun
            // bersaglio esterno) -- vedi applyActionMechanic. Stance/Skill Tamer leggono la scelta dai
            // due selettori dedicati della riga (data-stance-pick/data-skill-pick).
            const stancePick = cardEl.querySelector(`[data-stance-pick="${id}"]`);
            const skillPick = cardEl.querySelector(`[data-skill-pick="${id}"]`);
            const extra = { stance: stancePick ? stancePick.value : undefined, skillKey: skillPick ? skillPick.value : undefined };
            const effect = await applyActionMechanic(code, sel.value, p, null, extra);
            supportNote = ' ' + effect.note;
            presetAttacker = !!effect.presetAttacker;
          }
          const usedPoolLabelGM = result.def.pool==='tamer' ? 'Tamer' : 'Digimon';
          const usedPoolLeftGM = result.def.pool==='tamer' ? p.tamerActions : p.actions;
          await pushCombatNarration(combat, { who: narratorName(p), role:'gm', text: `${narratorName(p)} usa ${result.def.label} (${result.def.cost} Azione/i, ${usedPoolLabelGM}) — restano ${usedPoolLeftGM}/2 Azioni (${usedPoolLabelGM}).${supportNote}`, meta:{avatar: resolveParticipantImage(p)} });
          // Clash: preseleziona l'Attaccante nel pannello "⚔ Risolvi Attacco" (Inizia/Contesa), stesso
          // comportamento già esistente per 'attack' più sopra -- qui il costo va comunque spesato
          // normalmente (a differenza di 'attack', il cui costo è dedotto più tardi nella risoluzione).
          // Impostato PRIMA di persistAndRefresh così il re-render che segue riflette già la preselezione
          // (evita un secondo render separato).
          if(presetAttacker){
            combatAttackPanelOpen = true;
            combatPresetAttackerId = p.id;
            combatSelectedAttackIndex = null;
          }
          await persistAndRefresh();
          refreshLiveParts();
        };
      });
    };
    bindActionUse('data-daction-use', 'data-daction-select');
    bindActionUse('data-taction-use', 'data-taction-select');
    cardEl.querySelectorAll('[data-action-reset]').forEach(btn=>{
      btn.onclick = async ()=>{
        const id = btn.getAttribute('data-action-reset');
        const p = combat.participants.find(x=>x.id===id);
        if(p){
          const pMember = p.isPC ? cachedRoster.find(m=>m.username===p.username) : null;
          p.actions = (pMember && pMember.digimon.hybridMode) ? 3 : 2;
          p.attackedThisRound = false;
          // Pool separato del Tamer (Indice Regole 9.01) -- vedi commento su ACTION_DEFS/trySpendAction.
          p.tamerActions = 2;
          p.attackedThisRoundTamer = false;
          // Vedi trySpendAction: chi riottiene Azioni non è più "esaurito" -- azzera il conto alla
          // rovescia del "Passa turno automatico dopo 5 minuti".
          p.actionsExhaustedAt = null;
        }
        await persistAndRefresh();
      };
    });
    cardEl.querySelectorAll('[data-action-refund]').forEach(btn=>{
      btn.onclick = async ()=>{
        const id = btn.getAttribute('data-action-refund');
        const p = combat.participants.find(x=>x.id===id);
        if(!p) return;
        const max = (p.isPC && (cachedRoster.find(m=>m.username===p.username)||{}).digimon||{}).hybridMode ? 3 : 2;
        const before = p.actions===undefined?2:p.actions;
        p.actions = Math.min(max, before+1);
        p.actionsExhaustedAt = null;
        await pushCombatNarration(combat, { who:'Sistema', role:'gm', text: `${narratorName(p)} riottiene 1 Azione (es. Reload/Battle Cry/Horde Duelist riuscito) — ora ${p.actions}/2.` });
        await persistAndRefresh();
      };
    });
    // Richiesta utente: "tasto per restituire azioni al tamer" -- gemello del bottone sopra ma per
    // il pool Azioni del Tamer (p.tamerActions), che prima non aveva alcun modo di essere
    // restituito manualmente (solo il reset completo "↺ 2+2" lo toccava). Il pool Tamer non ha un
    // equivalente di hybridMode (quello riguarda solo il Digimon), quindi il massimo resta sempre 2.
    cardEl.querySelectorAll('[data-action-refund-tamer]').forEach(btn=>{
      btn.onclick = async ()=>{
        const id = btn.getAttribute('data-action-refund-tamer');
        const p = combat.participants.find(x=>x.id===id);
        if(!p) return;
        const before = p.tamerActions===undefined?2:p.tamerActions;
        p.tamerActions = Math.min(2, before+1);
        p.actionsExhaustedAt = null;
        await pushCombatNarration(combat, { who:'Sistema', role:'gm', text: `${narratorName(p)} riottiene 1 Azione (Tamer) — ora ${p.tamerActions}/2.` });
        await persistAndRefresh();
      };
    });
    // Richiesta utente: "manca un modo per danneggiare manualmente i digimon nemici" -- generalizzato
    // a QUALSIASI partecipante (anche Alleati/PC, utile per un Effetto/Trappola/Terreno non coperto
    // da un'Azione automatizzata), riusando applyDamageToParticipant/applyDefeatIfNeeded -- le stesse
    // funzioni già usate dalla risoluzione automatica degli Attacchi: Shield/Ferite Temporanee
    // assorbono per primi (danno) e il controllo Sconfitto scatta identico. Per la Cura l'importo
    // viene limitato al massimo delle Ferite (applyDamageToParticipant di per sé non lo limita,
    // essendo pensata per la Cura "1 Casella" fissa di Revitalize).
    const bindManualWound = (attr, sign)=>{
      cardEl.querySelectorAll(`[${attr}]`).forEach(btn=>{
        btn.onclick = async ()=>{
          const id = btn.getAttribute(attr);
          const p = combat.participants.find(x=>x.id===id);
          if(!p) return;
          const amtInput = cardEl.querySelector(`[data-manual-wound-amt="${id}"]`);
          let amount = Math.max(0, Math.floor(Number(amtInput && amtInput.value) || 0));
          if(amount<=0) return;
          if(sign<0){
            const wBefore = getParticipantWounds(p);
            amount = Math.min(amount, Math.max(0, wBefore.max - wBefore.current));
            if(amount<=0) return;
          }
          await applyDamageToParticipant(code, combat, p, sign*amount);
          const w = getParticipantWounds(p);
          let note = `${narratorName(p)} ${sign>0?'subisce':'recupera'} ${amount} Ferit${amount===1?'a':'e'} (manuale) — ora ${w.current}/${w.max}.`;
          if(sign>0){
            const defeatInfo = await applyDefeatIfNeeded(code, p);
            note += defeatInlineNote(defeatInfo);
          }
          await pushCombatNarration(combat, { who:'Sistema', role:'gm', text: note, meta:{avatar: resolveParticipantImage(p)} });
          await persistAndRefresh();
        };
      });
    };
    bindManualWound('data-manual-damage', 1);
    bindManualWound('data-manual-heal', -1);
    // FEATURE (richiesta utente: scelta del Master tra Regredire di Stage o Richiudere nell'Uovo
    // quando un Digimon PC viene Sconfitto -- vedi applyDefeatIfNeeded/defeatResolutionHTML più
    // sopra). Entrambi i bottoni cancellano solo defeatPending (member.digimon.defeated resta true:
    // il partecipante resta "Sconfitto/ignorato" fino a un eventuale rientro a proprio rischio via
    // data-part-reenter, esattamente come già succedeva prima di questa modifica).
    cardEl.querySelectorAll('[data-defeat-regress]').forEach(btn=>{
      btn.onclick = async ()=>{
        const id = btn.getAttribute('data-defeat-regress');
        const p = combat.participants.find(x=>x.id===id);
        if(!p || !p.isPC) return;
        const member = cachedRoster.find(m=>m.username===p.username);
        if(!member) return;
        const fromStage = member.digimon.stage;
        applyStageChange(member.digimon, member.digimon.stage, member.digimon.defaultStage);
        member.digimon.currentWounds = 1;
        member.digimon.defeatPending = false;
        await saveMember(code, member);
        await pushCombatNarration(combat, { who:'Sistema', role:'gm', text: `🏳️ Il Master risolve la Sconfitta di ${narratorName(p)}: regredisce da ${fromStage} a ${member.digimon.defaultStage} con 1 Ferita.` });
        await persistAndRefresh();
      };
    });
    cardEl.querySelectorAll('[data-defeat-egg]').forEach(btn=>{
      btn.onclick = async ()=>{
        const id = btn.getAttribute('data-defeat-egg');
        const p = combat.participants.find(x=>x.id===id);
        if(!p || !p.isPC) return;
        const member = cachedRoster.find(m=>m.username===p.username);
        if(!member) return;
        if(!window.confirm(`Richiudere nell'Uovo il Digimon di ${narratorName(p)}? Il giocatore lo vedrà come Uovo finché non lo riapprovi dalla Scheda Digimon -- Stat/Qualities/Attacchi restano quelli attuali, nulla viene azzerato.`)) return;
        member.digimon.approved = false;
        member.digimon.defeatPending = false;
        await saveMember(code, member);
        await pushCombatNarration(combat, { who:'Sistema', role:'gm', text: `🥚 Il Master risolve la Sconfitta di ${narratorName(p)}: torna Digitama (richiuso nell'Uovo -- riapprovalo dalla Scheda Digimon quando si schiude di nuovo).` });
        await persistAndRefresh();
      };
    });
    cardEl.querySelectorAll('[data-action-refund-attack]').forEach(btn=>{
      btn.onclick = async ()=>{
        const id = btn.getAttribute('data-action-refund-attack');
        const p = combat.participants.find(x=>x.id===id);
        if(!p) return;
        p.attackedThisRound = false;
        await pushCombatNarration(combat, { who:'Sistema', role:'gm', text: `${narratorName(p)} riottiene l'uso del proprio Attacco questo round (es. Reload riuscito).` });
        await persistAndRefresh();
      };
    });
    cardEl.querySelectorAll('[data-zone-closer]').forEach(btn=>{
      btn.onclick = async ()=>{
        const id = btn.getAttribute('data-zone-closer');
        const p = combat.participants.find(x=>x.id===id);
        const refSel = cardEl.querySelector(`[data-zone-ref="${id}"]`);
        const localStatus = document.getElementById(`zone-move-status-${id}`);
        const showLocal = (msg, ok)=>{ if(localStatus){ localStatus.style.color = ok?'var(--cyan)':'var(--danger)'; localStatus.textContent = msg; } };
        if(!p || !refSel || !refSel.value){ showLocal('Scegli un Digimon di riferimento.', false); return; }
        const ref = combat.participants.find(x=>x.id===refSel.value);
        if(!ref) return;
        const newZone = zoneStepToward(p.zone||'Medio', ref.zone||'Medio');
        if(!newZone){ showLocal(`${p.name} è già alla stessa posizione di ${ref.name}.`, false); return; }
        const result = trySpendAction(p, 'move');
        if(!result.ok){ showLocal(result.msg, false); return; }
        const from = p.zone||'Medio';
        p.zone = newZone;
        await pushCombatNarration(combat, { who: narratorName(p), role:'gm', text: `${narratorName(p)} si avvicina a ${narratorName(ref)}: ${zoneLabel(from)} → ${zoneLabel(newZone)} (${result.freeReposition?'gratuito: Reposition':'1 Azione'}) — restano ${p.actions}/2 Azioni.${zoneSideEffectsNote(combat.participants, p.id, ref.id, from, newZone)}`, meta:{avatar: resolveParticipantImage(p)} });
        await persistAndRefresh();
      };
    });
    cardEl.querySelectorAll('[data-zone-away]').forEach(btn=>{
      btn.onclick = async ()=>{
        const id = btn.getAttribute('data-zone-away');
        const p = combat.participants.find(x=>x.id===id);
        const refSel = cardEl.querySelector(`[data-zone-ref="${id}"]`);
        const localStatus = document.getElementById(`zone-move-status-${id}`);
        const showLocal = (msg, ok)=>{ if(localStatus){ localStatus.style.color = ok?'var(--cyan)':'var(--danger)'; localStatus.textContent = msg; } };
        if(!p || !refSel || !refSel.value){ showLocal('Scegli un Digimon di riferimento.', false); return; }
        const ref = combat.participants.find(x=>x.id===refSel.value);
        if(!ref) return;
        const newZone = zoneStepAway(p.zone||'Medio', ref.zone||'Medio');
        if(!newZone){ showLocal(`${p.name} non può allontanarsi oltre da ${ref.name}.`, false); return; }
        const result = trySpendAction(p, 'move');
        if(!result.ok){ showLocal(result.msg, false); return; }
        const from = p.zone||'Medio';
        p.zone = newZone;
        await pushCombatNarration(combat, { who: narratorName(p), role:'gm', text: `${narratorName(p)} si allontana da ${narratorName(ref)}: ${zoneLabel(from)} → ${zoneLabel(newZone)} (${result.freeReposition?'gratuito: Reposition':'1 Azione'}) — restano ${p.actions}/2 Azioni.${zoneSideEffectsNote(combat.participants, p.id, ref.id, from, newZone)}`, meta:{avatar: resolveParticipantImage(p)} });
        await persistAndRefresh();
      };
    });
    cardEl.querySelectorAll('[data-zone-move]').forEach(btn=>{
      btn.onclick = async ()=>{
        const id = btn.getAttribute('data-zone-move');
        const p = combat.participants.find(x=>x.id===id);
        const sel = cardEl.querySelector(`[data-zone-select="${id}"]`);
        if(!p || !sel) return;
        const target = sel.value;
        const localStatus = document.getElementById(`zone-move-status-${id}`);
        if(target === (p.zone||'Medio')){ return; }
        const result = trySpendAction(p, 'move');
        if(!result.ok){
          if(localStatus){ localStatus.style.color='var(--danger)'; localStatus.textContent = result.msg; }
          return;
        }
        const from = p.zone||'Medio';
        p.zone = target;
        await pushCombatNarration(combat, { who: narratorName(p), role:'gm', text: `${narratorName(p)} viene posizionato in ${zoneLabel(target)} (${zoneLabel(from)} → ${zoneLabel(target)}, ${result.freeReposition?'gratuito: Reposition':'1 Azione'}, senza riferimento a un bersaglio specifico) — restano ${p.actions}/2 Azioni.`, meta:{avatar: resolveParticipantImage(p)} });
        await persistAndRefresh();
      };
    });
    cardEl.querySelectorAll('[data-order-use]').forEach(btn=>{
      btn.onclick = async ()=>{
        const id = btn.getAttribute('data-order-use');
        const p = combat.participants.find(x=>x.id===id);
        const sel = cardEl.querySelector(`[data-order-select="${id}"]`);
        if(!p || !sel || !p.isPC) return;
        const member = cachedRoster.find(m=>m.username===p.username);
        if(!member) return;
        const orderKey = sel.value;
        const talent = TALENT_DEFS.find(t=>t.order===orderKey);
        if(!talent) return;
        if(!member.tamer.specialOrdersUsed) member.tamer.specialOrdersUsed = {};
        if(talent.once && member.tamer.specialOrdersUsed[orderKey]){
          const statusEl = document.getElementById('combat-mgr-status');
          if(statusEl){ statusEl.style.color='var(--danger)'; statusEl.textContent = `${talent.name} già usato — serve un Rest/nuovo combattimento.`; }
          return;
        }
        if(talent.cost>0){
          // I Special Order sono Tamer Talent (TALENT_DEFS è indicizzato su Attributi/Skill del
          // Tamer): il loro costo in Azioni va scalato dal pool del Tamer, non da quello del Digimon
          // -- vedi claude/audit-regolamento-dda2e.md, Addendum 3.
          const tamerActsNow = p.tamerActions===undefined?2:p.tamerActions;
          if(tamerActsNow < talent.cost){
            const statusEl = document.getElementById('combat-mgr-status');
            if(statusEl){ statusEl.style.color='var(--danger)'; statusEl.textContent = 'Azioni del Tamer insufficienti per questo Special Order.'; }
            return;
          }
          p.tamerActions = tamerActsNow - talent.cost;
        }
        let logText = `✦ ${p.name} usa Special Order "${talent.name}".`;
        if(orderKey==='strikeFast'){
          // Il costo (2 Azioni Tamer) è già stato scalato sopra da p.tamerActions; il beneficio
          // concesso qui è invece 1 Azione extra al Digimon (da usare per Move/Difficult Move).
          p.actions = (p.actions===undefined?2:p.actions) + 1;
          logText += ' Il Digimon guadagna 1 Azione extra (da usare per Muovi).';
        } else if(orderKey==='energyBurst'){
          const heal = Number(member.digimon.tempWounds||0)>0 ? 2 : 1;
          member.digimon.currentWounds = Math.min(member.digimon.maxWounds, member.digimon.currentWounds+heal);
          logText += ` Recupera ${heal} Casella/e Ferita.`;
        } else if(orderKey==='overpower'){
          p.overpowerActive = true;
          logText += ' Il prossimo tiro Accuracy conta i 4 come Successi.';
        } else if(orderKey==='swagger'){
          const targetId = document.getElementById('combat-target').value;
          const tgt = combat.participants.find(x=>x.id===targetId);
          if(tgt){
            if(!tgt.effects) tgt.effects=[];
            tgt.effects.push({ key:'taunt', potency:1, duration:3 });
            logText += ` Applica [TAUNT] a ${tgt.name} per 3 round.`;
          } else {
            logText += ' (Scegli un Bersaglio nel menu Attaccante/Bersaglio prima di usarlo.)';
          }
        } else if(orderKey==='peakPerformance'){
          const targetId = document.getElementById('combat-target').value;
          const tgt = combat.participants.find(x=>x.id===targetId);
          if(tgt){
            if(!tgt.effects) tgt.effects=[];
            tgt.effects.push({ key:'bastion', potency:2, duration:1 });
            logText += ` ${tgt.name} guadagna [BASTION 2] fino al prossimo turno.`;
          } else {
            logText += ' (Scegli un Bersaglio alleato nel menu Attaccante/Bersaglio prima di usarlo.)';
          }
        } else if(orderKey==='revitalize'){
          const targetId = document.getElementById('combat-target').value;
          const tgt = combat.participants.find(x=>x.id===targetId);
          if(tgt){
            const w = getParticipantWounds(tgt);
            if(w.current<=0){
              await applyDamageToParticipant(code, combat, tgt, -1);
              logText += ` ${tgt.name} viene rianimato con 1 Casella Ferita.`;
            } else {
              logText += ` ${tgt.name} non è sconfitto — Revitalize richiede un Digimon a 0 Ferite.`;
            }
          } else {
            logText += ' (Scegli il Bersaglio sconfitto nel menu Attaccante/Bersaglio prima di usarlo.)';
          }
        } else if(orderKey==='signatureVersatility'){
          member.digimon.battery = Math.max(member.digimon.battery, 1);
          logText += ' Il prossimo Attacco può essere dichiarato come Signature Move anche a Battery bassa.';
        } else if(orderKey==='enemyScan'){
          const targetId = document.getElementById('combat-target').value;
          const tgt = combat.participants.find(x=>x.id===targetId);
          if(tgt){
            const tgtStage = tgt.isPC ? (cachedRoster.find(m=>m.username===tgt.username)?.digimon.stage) : null;
            const potency = tgtStage ? stageIndex(tgtStage)+1 : 2;
            if(!tgt.effects) tgt.effects=[];
            tgt.effects.push({ key:'debilitate', potency, duration:3 });
            logText += ` Applica [DEBILITATE ${potency}] a ${tgt.name} per 3 round.`;
          } else {
            logText += ' (Scegli il Bersaglio nemico nel menu Attaccante/Bersaglio prima di usarlo.)';
          }
        } else if(orderKey==='purifyPartner'){
          const msg = await applyInstantEffect(code, p, 'cleanse', 1);
          logText += ` ${msg}`;
        }
        member.tamer.specialOrdersUsed[orderKey] = true;
        await saveMember(code, member);
        await pushCombatNarration(combat, { who: p.name, role:'gm', text: logText });
        await persistAndRefresh();
      };
    });
    cardEl.querySelectorAll('[data-effect-apply]').forEach(btn=>{
      btn.onclick = async ()=>{
        const id = btn.getAttribute('data-effect-apply');
        const p = combat.participants.find(x=>x.id===id);
        if(!p) return;
        const key = cardEl.querySelector(`[data-effect-select="${id}"]`).value;
        const potency = Number(cardEl.querySelector(`[data-effect-potency="${id}"]`).value)||1;
        const duration = Math.min(3, Number(cardEl.querySelector(`[data-effect-duration="${id}"]`).value)||3);
        const def = EFFECT_DEFS.find(d=>d.key===key);
        if(def && def.instant){
          const msg = await applyInstantEffect(code, p, key, potency);
          await pushCombatNarration(combat, { who:'Master', role:'gm', text: `✨ ${msg}` });
        } else {
          if(!p.effects) p.effects = [];
          p.effects.push({ key, potency, duration });
          await pushCombatNarration(combat, { who:'Master', role:'gm', text: `${p.name} riceve ${def?def.label:key} (Potenza ${potency}, Durata ${duration}).` });
        }
        await persistAndRefresh();
      };
    });
    cardEl.querySelectorAll('[data-effect-remove]').forEach(btn=>{
      btn.onclick = async ()=>{
        const [id, idx] = btn.getAttribute('data-effect-remove').split('|');
        const p = combat.participants.find(x=>x.id===id);
        if(p && p.effects) p.effects.splice(Number(idx),1);
        await persistAndRefresh();
      };
    });

    document.getElementById('btn-combat-add-player').onclick = async ()=>{
      const username = document.getElementById('combat-add-player').value;
      if(!username) return;
      if(combat.participants.some(p=>p.username===username)) return;
      const member = cachedRoster.find(m=>m.username===username);
      const ram = member ? computeDerivedStats(member.digimon).ram : 0;
      const startActions = (member && member.digimon.hybridMode) ? 3 : 2;
      const fighterName = (member && member.digimon.name) ? member.digimon.name : (member ? displayName(member) : username);
      combat.participants.push({ id:'p'+Date.now()+Math.random().toString(36).slice(2,6), name:fighterName, side:'ally', ram, initiative:0, actions:startActions, attackedThisRound:false, effects:[], zone: combat.startZoneAlly||'Molto Corto', clashPinned:false, clashComebackBonus:0, isPC:true, username, imageUrl: (member && member.digimon.imageUrl) || '' });
      await persistAndRefresh();
    };
    const addFromSceneBtn = document.getElementById('btn-combat-add-fromscene');
    const fromSceneSelect = document.getElementById('combat-enemy-fromscene');
    if(fromSceneSelect){
      fromSceneSelect.onchange = ()=>{
        const enc = (cachedScene.encounters||[]).find(e=>String(e.id)===String(fromSceneSelect.value));
        const sideSel = document.getElementById('combat-fromscene-side');
        if(enc && sideSel){
          // Neutrale non ha un lato di Combat Manager dedicato: di default lo trattiamo come Nemico,
          // ma il Master può comunque cambiarlo a mano prima di premere "+ Aggiungi".
          sideSel.value = enc.disposition==='ally' ? 'ally' : 'enemy';
        }
      };
    }
    if(addFromSceneBtn){
      addFromSceneBtn.onclick = async ()=>{
        const sel = document.getElementById('combat-enemy-fromscene');
        const encId = sel.value;
        if(!encId) return;
        const enc = (cachedScene.encounters||[]).find(e=>String(e.id)===String(encId));
        if(!enc) return;
        if(cachedCombat.participants.some(p=>p.sourceEncounterId===enc.id)) return;
        const sideSel = document.getElementById('combat-fromscene-side');
        const side = (sideSel && sideSel.value==='ally') ? 'ally' : 'enemy';
        const bs = enc.baseStats || {};
        const dodge = Number(bs.baseDodge)||0;
        // Stessa formula usata ovunque altrove per un Incontro (Stage + Health×2, vedi
        // encounterMaxWounds in js/encounters.js) — prima qui si usava solo bs.baseHealth "nudo",
        // ignorando lo Stage: risultato, le Caselle Ferita in Gestione Combattimento non
        // corrispondevano a quelle mostrate in Composizione Scena per lo stesso Digimon.
        const maxWounds = encounterMaxWounds(enc);
        const currentWounds = encounterCurrentWounds(enc);
        const attribute = (enc.categories && enc.categories[0]) || 'Free';
        const newParticipant = {
          id:'p'+Date.now()+Math.random().toString(36).slice(2,6), name:enc.name, side,
          ram: Math.max(0, Math.floor(dodge/3)), initiative:0, actions:2, attackedThisRound:false, effects:[],
          zone: (side==='ally' ? cachedCombat.startZoneAlly : cachedCombat.startZoneEnemy) || (side==='ally'?'Molto Corto':'Molto Lungo'), clashPinned:false, clashComebackBonus:0, isPC:false,
          accuracy: Number(bs.baseAccuracy)||0, damage: Number(bs.baseDamage)||0, dodge,
          armor: Number(bs.baseArmor)||0, maxWounds, currentWounds, attribute,
          sourceEncounterId: enc.id, isBoss: !!enc.isBoss, attacks: enc.attacks || [], imageUrl: enc.image || '',
          nameHidden: !!enc.nameHidden
        };
        // Se il nome è nascosto, assegna subito un'etichetta stabile ("Nemico N") — vedi
        // assignHiddenLabelNum in js/encounters.js: va chiamata PRIMA del push, così il nuovo
        // partecipante non conta come "già presente" nel calcolo del prossimo numero libero.
        assignHiddenLabelNum(cachedCombat, newParticipant);
        cachedCombat.participants.push(newParticipant);
        await persistAndRefresh();
      };
    }
    const dexFillSelect = document.getElementById('combat-enemy-fromdex');
    let pendingDexEnemyAttacks = [];
    let pendingDexEnemyImage = '';
    if(dexFillSelect){
      dexFillSelect.onchange = ()=>{
        const entry = cachedDex.find(e=>String(e.id)===String(dexFillSelect.value));
        if(!entry){ pendingDexEnemyAttacks = []; pendingDexEnemyImage=''; return; }
        const bs = entry.base_stats || {};
        document.getElementById('combat-enemy-name').value = entry.name;
        document.getElementById('combat-enemy-acc').value = bs.baseAccuracy||0;
        document.getElementById('combat-enemy-dmg').value = bs.baseDamage||0;
        document.getElementById('combat-enemy-dodge').value = bs.baseDodge||0;
        document.getElementById('combat-enemy-arm').value = bs.baseArmor||0;
        document.getElementById('combat-enemy-hp').value = bs.baseHealth||1;
        document.getElementById('combat-enemy-ram').value = Math.max(0, Math.floor(Number(bs.baseDodge||0)/3));
        pendingDexEnemyAttacks = buildAttacksFromDexEntry(entry);
        pendingDexEnemyImage = entry.image_url || '';
      };
    }
    document.getElementById('btn-combat-add-enemy').onclick = async ()=>{
      const name = document.getElementById('combat-enemy-name').value.trim();
      if(!name) return;
      const ram = Number(document.getElementById('combat-enemy-ram').value)||0;
      const accuracy = Number(document.getElementById('combat-enemy-acc').value)||0;
      const damage = Number(document.getElementById('combat-enemy-dmg').value)||0;
      const dodge = Number(document.getElementById('combat-enemy-dodge').value)||0;
      const armor = Number(document.getElementById('combat-enemy-arm').value)||0;
      const maxWounds = Number(document.getElementById('combat-enemy-hp').value)||1;
      const attribute = document.getElementById('combat-enemy-attribute').value;
      combat.participants.push({
        id:'p'+Date.now()+Math.random().toString(36).slice(2,6), name, side:'enemy', ram, initiative:0, actions:2, attackedThisRound:false, effects:[], zone: combat.startZoneEnemy||'Molto Lungo', clashPinned:false, clashComebackBonus:0, isPC:false,
        accuracy, damage, dodge, armor, maxWounds, currentWounds: maxWounds, attribute, attacks: pendingDexEnemyAttacks.slice(), imageUrl: pendingDexEnemyImage
      });
      pendingDexEnemyAttacks = [];
      pendingDexEnemyImage = '';
      if(dexFillSelect) dexFillSelect.value = '';
      await persistAndRefresh();
    };
    document.getElementById('btn-combat-roll-all').onclick = async ()=>{
      if(combat.participants.length===0) return;
      const rollLines = combat.participants.map(p=>{
        const { dice, total } = rollSkillCheck(0, p.ram||0); // 3d6 + RAM (attrVal unused, pass 0)
        p.initiative = total;
        return `${escapeHTML(p.name)}: [${dice.join(', ')}] + RAM ${p.ram||0} = <b>${total}</b>`;
      });
      await persistAndRefresh();
      const statusEl = document.getElementById('combat-mgr-status');
      if(statusEl) statusEl.innerHTML = `🎲 Iniziativa tirata per tutti:<br>${rollLines.join('<br>')}<br><span class="muted">Ora premi "Calcola Ordine" per stabilire chi agisce per primo.</span>`;
    };
    document.getElementById('btn-combat-calc-order').onclick = async ()=>{
      if(combat.participants.length===0) return;
      recalcCombatOrder(combat);
      // Timer 24h (richiesta utente): il primo turno "parte" ufficialmente da qui, non dal click
      // su "Inizia Combattimento" (che apre solo il pannello di preparazione) — vedi
      // combatTurnTimerLabel.
      combat.turnStartedAt = new Date().toISOString();
      await persistAndRefresh();
      const statusEl = document.getElementById('combat-mgr-status');
      const orderNames = (combat.order||[]).map(id=>{ const p = combat.participants.find(x=>x.id===id); return p ? p.name : '?'; });
      if(statusEl) statusEl.innerHTML = orderNames.length ? `✅ Ordine dei turni calcolato: ${orderNames.map(escapeHTML).join(' → ')}<br><span class="muted">Vedi la scheda "Combattimento — Ordine dei Turni" qui sopra.</span>` : '<span class="err">Nessun ordine calcolabile.</span>';
    };
    const jumpTurnBtn = document.getElementById('btn-combat-jump-turn');
    if(jumpTurnBtn){
      jumpTurnBtn.onclick = async ()=>{
        const sel = document.getElementById('combat-jump-turn-select');
        if(!sel || !sel.value) return;
        await jumpToCombatTurn(code, players, sel.value);
      };
    }
  }
