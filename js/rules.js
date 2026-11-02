// js/rules.js
// Primitive pure del regolamento (nessuna dipendenza da session/roster/scena/DOM): le Stage e i
// loro indici, le Size, i modificatori di Stance, il cap della Battery, e la lettura delle
// Qualities in bonus meccanici. Sono il pezzo a rischio piu' basso della logica di combattimento
// da estrarre, e il prerequisito per combat-engine.js (che li usa).
//
// Estesa in fase 8 (parte chat) con la configurazione di campagna e le Skill dei Tamer
// (CAMPAIGN_LEVELS/campaignConfig/evaluateVsTN/SKILL_DEFS/prodigiousSkillBonus/ATTR_ABBR): la
// loro unica dipendenza esterna, cachedProgression, e' un global di js/store.js caricato prima
// di questo file, quindi non c'e' piu' bisogno che restino nella IIFE di index.html -- servono
// a js/chat-log-engine.js (attachLogModeration, per valutare i tiri richiesti in chat).
//
// Script classico (non un modulo ES), caricato PRIMA del blocco <script> principale in index.html
// -- restano funzioni/costanti globali esattamente come quando vivevano nella stessa IIFE del
// file grande, nessun cambiamento di comportamento.

  const STAGES = ['Fresh','Baby','Rookie','Champion','Ultimate','Mega'];

  const SIZES = ['Small','Medium','Large','Huge','Gigantic','Colossal'];

  function stageIndex(s){ const i = STAGES.indexOf(s); return i<0?0:i; }

  function stanceModifiers(d){
    const sv = stageIndex(d.stage);
    if(d.stance==='Offensive') return { accuracy: sv, dodge: -sv, damage:0, armor:0 };
    if(d.stance==='Defensive') return { accuracy: -sv, dodge: sv, damage:0, armor:0 };
    if(d.stance==='Fierce') return { accuracy:0, dodge:0, damage: sv, armor:0 };
    if(d.stance==='Brave') return { accuracy:0, dodge:0, damage:0, armor: sv };
    return { accuracy:0, dodge:0, damage:0, armor:0 };
  }

  function batteryCap(stage){ return stageIndex(stage)+1; }

  function computeQualityMechanics(qualities){
    const m = { certainStrike:0, weapon:0, ammoRank:0, combatMonster:0, monsterStrength:false, wrestlemania:false, resistance:0,
      instinctDodge:0, wardenArmor:0, brawlerClash:0, supremeCode:0, absoluteEvasion:0, heavyRecoil:false, naturewalk:{ accuracy:0, damage:0, dodge:0, armor:0, health:0 } };
    (qualities||[]).forEach(q=>{
      if(q.mechanic==='certainStrike') m.certainStrike += Number(q.rank||1);
      if(q.mechanic==='weapon') m.weapon += Number(q.rank||1);
      if(q.mechanic==='ammo') m.ammoRank = Math.max(m.ammoRank, Number(q.rank||1));
      if(q.mechanic==='combatMonster') m.combatMonster = Math.max(m.combatMonster, Number(q.rank||1));
      if(q.mechanic==='monsterStrength') m.monsterStrength = true;
      if(q.mechanic==='wrestlemania') m.wrestlemania = true;
      if(q.mechanic==='resistance') m.resistance += Number(q.rank||1);
      if(q.mechanic==='instinct') m.instinctDodge += Number(q.rank||1);
      if(q.mechanic==='dataOptWarden') m.wardenArmor += Number(q.rank||1);
      if(q.mechanic==='dataOptBrawler') m.brawlerClash += Number(q.rank||1);
      if(q.mechanic==='supremeCode') m.supremeCode += Number(q.rank||1);
      if(q.mechanic==='absoluteEvasion') m.absoluteEvasion += Number(q.rank||1);
      // Heavy Recoil (9.03/Qualities catalog): "un Attacco [RANGE] ignora la penalità di
      // Melee-adiacenza" -- ora che quella penalità è un vero -3 Accuracy meccanico (vedi
      // performAttackRoll in index.html), questo flag gli dà finalmente un effetto reale.
      if(q.mechanic==='heavyRecoil') m.heavyRecoil = true;
      if(q.mechanic==='naturewalk'){
        const target = q.statTarget || 'accuracy';
        m.naturewalk[target] = (m.naturewalk[target]||0) + Number(q.rank||1);
      }
    });
    return m;
  }

  const CAMPAIGN_LEVELS = {
    Standard: { ap:10, sp:25, cap:5, thresholds:[3,5,6,7], tnShift:0, startTorment:8 },
    Classic:  { ap:5,  sp:20, cap:3, thresholds:[2,3,4,5], tnShift:-2, startTorment:5 },
    Extreme:  { ap:15, sp:30, cap:7, thresholds:[4,6,8,10], tnShift:2, startTorment:10 }
  };

  function campaignConfig(){
    const level = (cachedProgression && cachedProgression.campaignLevel) || 'Standard';
    return CAMPAIGN_LEVELS[level] || CAMPAIGN_LEVELS.Standard;
  }

  function evaluateVsTN(total, tn, dice){
    if(tn===null || tn===undefined || tn==='') return null;
    if(cachedProgression && cachedProgression.naturalCriticalResults && Array.isArray(dice) && dice.length===3){
      if(dice.every(d=>d===6)) return { label:'Successo Critico', cls:'crit-success' };
      if(dice.every(d=>d===1)) return { label:'Fallimento Critico', cls:'crit-fail' };
    }
    const shift = campaignConfig().tnShift;
    const diff = total - (Number(tn) - shift);
    if(diff>=5) return { label:'Successo Critico', cls:'crit-success' };
    if(diff>=0) return { label:'Successo', cls:'success' };
    if(diff<=-5) return { label:'Fallimento Critico', cls:'crit-fail' };
    return { label:'Fallimento', cls:'fail' };
  }

  const SKILL_DEFS = [
    { key:'evade', label:'Evade', attrs:['agility','willpower'] },
    { key:'precision', label:'Precision', attrs:['agility','intelligence'] },
    { key:'stealth', label:'Stealth', attrs:['agility','body'] },
    { key:'athletics', label:'Athletics', attrs:['body','agility'] },
    { key:'endurance', label:'Endurance', attrs:['body','willpower'] },
    { key:'featsOfStrength', label:'Feats of Strength', attrs:['body','charisma'] },
    { key:'manipulate', label:'Manipulate', attrs:['charisma','body'] },
    { key:'perform', label:'Perform', attrs:['charisma','agility'] },
    { key:'persuasion', label:'Persuasion', attrs:['charisma','intelligence'] },
    { key:'decipherIntent', label:'Decipher Intent', attrs:['intelligence','charisma'] },
    { key:'survival', label:'Survival', attrs:['intelligence','willpower'] },
    { key:'knowledge', label:'Knowledge', attrs:['intelligence'] },
    { key:'fortitude', label:'Fortitude', attrs:['willpower','intelligence'] },
    { key:'bravery', label:'Bravery', attrs:['willpower','body'] },
    { key:'awareness', label:'Awareness', attrs:['willpower','agility'] }
  ];

  function prodigiousSkillBonus(me, def){
    const qualities = (me && me.digimon && Array.isArray(me.digimon.qualities)) ? me.digimon.qualities : [];
    let bonus = 0;
    qualities.forEach(q=>{
      if(!q) return;
      if(q.mechanic==='prodigiousSkill' && q.skillTarget===def.label) bonus += 3;
      if(q.mechanic==='mindOverMatter' && (q.skillTarget===def.label || q.skillTarget2===def.label)) bonus += 3;
    });
    return bonus;
  }

  const ATTR_ABBR = { agility:'AGI', body:'BODY', charisma:'CAR', intelligence:'INT', willpower:'WILL' };

  // ---------- Punti Ispirazione (regola 2.05) ----------
  // Richiesta Rocco ("automatizzare le fonti di IP senza intaccare il regolamento, e dare al
  // Master la possibilità di aggiungerne e toglierne"): unico punto in cui un IP viene AGGIUNTO
  // o TOLTO da una regola automatica o dal Master, così il tetto 2 + Willpower (2.05) vale
  // ovunque allo stesso modo. Le SPESE del giocatore (Ritira, Miracle) restano dove erano.
  function ipCap(tamer){ return 2 + Number((tamer && tamer.willpower)||0); }
  // Ritorna di quanto è cambiato davvero il valore (0 se il Tamer era già al tetto). Un valore
  // già sopra il tetto (schede vecchie, prima di questa regola) non viene mai tagliato da un
  // +1: semplicemente non sale oltre.
  function grantIP(me, amount){
    if(!me || !me.tamer) return 0;
    const cur = Number(me.tamer.inspirationPoints||0);
    const amt = Number(amount)||0;
    let next;
    if(amt>0) next = Math.max(cur, Math.min(ipCap(me.tamer), cur + amt));
    else next = Math.max(0, cur + amt);
    me.tamer.inspirationPoints = next;
    return next - cur;
  }
  // Lucky Number (2.05b): almeno 2 dei 3 dadi tenuti uguali al numero scelto dal Tamer.
  function isLuckyRoll(tamer, dice){
    const n = Number(tamer && tamer.luckyNumber);
    if(!(n>=1 && n<=6) || !Array.isArray(dice)) return false;
    return dice.filter(d=>Number(d)===n).length >= 2;
  }
  // Fonti automatiche di IP su un Check del Tamer: Fallimento Critico (2.05) + Lucky Number
  // (2.05b). `verdict` può essere l'oggetto di evaluateVsTN o la sola etichetta salvata in meta.
  // Applica subito gli IP (col tetto) e ritorna { gained, note } — gained va salvato nel meta
  // del messaggio, così un ri-tiro con Ispirazione che scarta questo risultato può toglierli.
  function applyCheckIP(me, dice, verdict){
    const label = verdict ? (typeof verdict==='string' ? verdict : verdict.label) : null;
    const reasons = [];
    if(label==='Fallimento Critico') reasons.push('Fallimento Critico');
    if(isLuckyRoll(me.tamer, dice)) reasons.push('Lucky Number '+me.tamer.luckyNumber);
    if(!reasons.length) return { gained:0, note:'' };
    const gained = grantIP(me, reasons.length);
    const note = gained>0
      ? ` · 💡 +${gained} IP (${reasons.join(', ')})`
      : ` · 💡 ${reasons.join(', ')}: IP già al massimo (${ipCap(me.tamer)})`;
    return { gained, note };
  }

  // ---------- Blocco Evoluzioni in Combattimento ----------
  // Richiesta Rocco ("poter bloccare le evoluzioni in un fight per uno o più giocatori"): flag
  // participant.evolutionLocked sul partecipante PC del Combattimento attivo, attivato/disattivato
  // dal Master col bottone 🔒 nella riga del partecipante (Gestione Combattimento, index.html).
  // Vive DENTRO cachedCombat.participants, quindi vale solo per quel fight: endCombatNow svuota
  // l'array e il blocco sparisce da solo, come tamerActionsLocked. Blocca solo le evoluzioni
  // VERSO L'ALTO (Evolvi, Forza, Blast, Slide, Dark, Armor, "Evolvi ora" in chat); tornare al
  // Default Stage / terminare Dark o Armor resta sempre permesso.
  function evolutionLockedFor(username){
    if(!username || typeof cachedCombat==='undefined' || !cachedCombat || !cachedCombat.active || !Array.isArray(cachedCombat.participants)) return false;
    return cachedCombat.participants.some(p=>p.isPC && p.username===username && p.evolutionLocked);
  }
  const EVOLUTION_LOCKED_MSG = '🔒 Il Master ha bloccato le evoluzioni per questo combattimento.';

  // ===== Forme alternative per lo stesso Stage =====
  // Richiesta Rocco 2026-11-02 ("dare a Nox e Gammamon la possibilità di evolvere in un altro tipo
  // di Gammamon, quello triceratopo"): un Digimon può avere PIÙ forme per lo stesso Stage (es.
  // Champion: BetelGammamon o WezenGammamon), ognuna con Stat, Qualities e Attacchi propri.
  // Modello dati, nella colonna JSONB `digimon` già esistente (nessuna migrazione):
  //   d.stageStats[stage]          -> la forma ATTIVA dello Stage (come sempre: tutto il resto del
  //                                   sito continua a leggere solo questa);
  //   d.altForms[stage] = [ { stats, qualities, freeBonus }, ... ] -> le altre forme, in attesa.
  // Cambiare forma = scambiare la forma attiva con una di quelle in attesa. Le forme si costruiscono
  // e si scelgono in Scheda Digimon (digimon.html, che ha una copia di queste funzioni); qui servono
  // al Tavolo, dove al momento di evolvere si sceglie in quale forma (pickStageForm).
  function stageAltForms(d, stage){
    return (d && d.altForms && Array.isArray(d.altForms[stage])) ? d.altForms[stage].filter(f=>f && f.stats && f.stats.name) : [];
  }
  // Rende attiva la forma alternativa n° idx dello Stage indicato. Se il Digimon si trova proprio su
  // quello Stage, aggiorna anche le Stat "dal vivo" (nome, immagine, stat, attacchi, Qualities).
  function switchStageForm(d, stage, idx){
    const alts = (d.altForms && d.altForms[stage]) || [];
    const chosen = alts[idx];
    if(!chosen || !chosen.stats) return false;
    const live = d.stage === stage && typeof applyStageChange === 'function';
    if(live && typeof snapshotCurrentStatsToStage === 'function') snapshotCurrentStatsToStage(d, stage);
    if(!d.stageStats) d.stageStats = {};
    if(!d.stageQualities) d.stageQualities = {};
    if(!d.stageFreeBonusApplied) d.stageFreeBonusApplied = {};
    const current = d.stageStats[stage] ? { stats: d.stageStats[stage], qualities: d.stageQualities[stage] || [], freeBonus: d.stageFreeBonusApplied[stage] || {} } : null;
    alts.splice(idx, 1);
    if(current) alts.push(current);
    d.altForms[stage] = alts;
    d.stageStats[stage] = chosen.stats;
    d.stageQualities[stage] = Array.isArray(chosen.qualities) ? chosen.qualities : [];
    d.stageFreeBonusApplied[stage] = chosen.freeBonus || {};
    if(live){
      // Ricarica la forma appena attivata usando lo stesso caricatore dell'Evoluzione: passiamo da
      // uno Stage segnaposto per non risalvare sopra la forma nuova la forma vecchia.
      const wounds = d.currentWounds;
      d.stage = '__forma__';
      applyStageChange(d, '__forma__', stage);
      ['stageStats','stageQualities','stageFreeBonusApplied'].forEach(k=>{ if(d[k]) delete d[k]['__forma__']; });
      d.currentWounds = Math.min(wounds, d.maxWounds);
    }
    return true;
  }
  // Prima di evolvere verso uno Stage con più forme: chiede quale usare. Risolve true per procedere
  // (eventualmente dopo aver cambiato forma), false se si annulla. Senza forme alternative risolve
  // subito true, senza mostrare nulla.
  function pickStageForm(d, stage){
    const alts = stageAltForms(d, stage);
    if(!alts.length || !d.stageStats || !d.stageStats[stage]) return Promise.resolve(true);
    return new Promise(resolve=>{
      const old = document.getElementById('stage-form-picker');
      if(old) old.remove();
      const forms = [{ idx:-1, f:{ stats:d.stageStats[stage] } }].concat(alts.map((f,i)=>({ idx:(d.altForms[stage]||[]).indexOf(f), f })));
      const modal = document.createElement('div');
      modal.id = 'stage-form-picker';
      modal.className = 'enc-modal-backdrop';
      modal.innerHTML = `<div class="enc-modal-card hud-frame" style="max-width:520px;">
        <div class="section-title" style="margin-top:0;">🧬 In quale forma evolve ${escapeHTML(d.name||'il Digimon')}? (${escapeHTML(stage)})</div>
        <div style="display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin:8px 0;">
          ${forms.map(o=>`<button type="button" class="btn ghost" data-stage-form-pick="${o.idx}" style="display:flex;flex-direction:column;align-items:center;gap:6px;padding:10px;min-width:130px;">
            ${o.f.stats.imageUrl ? `<img src="${escapeAttr(o.f.stats.imageUrl)}" style="width:72px;height:72px;object-fit:cover;border-radius:8px;" onerror="this.style.display='none'" />` : '<span style="font-size:40px;">🥚</span>'}
            <b>${escapeHTML(o.f.stats.name)}</b>
            <span class="muted" style="font-size:10px;">ACC ${o.f.stats.baseAccuracy} · DMG ${o.f.stats.baseDamage} · DOD ${o.f.stats.baseDodge} · ARM ${o.f.stats.baseArmor} · HP ${o.f.stats.baseHealth}</span>
          </button>`).join('')}
        </div>
        <button type="button" class="btn ghost small" data-stage-form-cancel style="width:100%;">Annulla</button>
      </div>`;
      document.body.appendChild(modal);
      const done = (v)=>{ modal.remove(); resolve(v); };
      modal.onclick = (e)=>{
        if(e.target===modal || e.target.closest('[data-stage-form-cancel]')) return done(false);
        const b = e.target.closest('[data-stage-form-pick]');
        if(!b) return;
        const idx = Number(b.getAttribute('data-stage-form-pick'));
        if(idx>=0) switchStageForm(d, stage, idx);
        done(true);
      };
    });
  }
