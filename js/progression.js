// js/progression.js
// Pannello "Progressione Party" del Master: Campaign Level, Variant Rules (Attribute Advantage,
// Natural Critical Results, Blast/Slide/Dark Evolution), i contatori Milestone/XP/Ispirazione con
// i bottoni "+1 XP" per motivo, l'assegnazione di una Milestone Narrativa, l'annullamento
// dell'ultima Milestone concessa per errore (btn-milestone-undo), Break/Rest del party (8.04), e
// la correzione manuale di Milestone/XP/Ispirazione. Include anche grantMilestoneRewards (unico
// punto in cui una Milestone viene davvero concessa, sia da soglia XP sia da assegnazione
// Narrativa: +3 Growth Points/+1 IP/+3 DP Bonus a ogni giocatore, con l'istantanea in
// prog.lastMilestoneGrant usata da btn-milestone-undo per l'annullamento) e saveProgression
// (wrapper dati verso /api/state, usato solo da questo cluster -- portato qui insieme al resto
// invece di lasciarlo nell'IIFE di index.html, stesso schema gia' visto in fase 12 per
// saveScene/addDexEntry/updateDexEntry in js/scene-encounters.js). getProgression resta invece in
// index.html: e' usato anche da refreshLiveParts/renderMaster (nucleo di orchestrazione, mai
// estratto).
//
// Dipende da (gia' globali, caricati prima nella catena degli script): apiPost/lastApiError
// (js/api.js), escapeHTML/escapeAttr (js/util.js), pushLog/saveMember (js/chat-log-engine.js),
// session/cachedRoster/cachedProgression (js/store.js), e TALENT_DEFS (js/tamer-card.js, usato
// solo dentro "Rest" per azzerare gli Special Order a cadenza settimanale/rest).
//
// Script classico (non un modulo ES), caricato nella catena degli script prima del blocco
// <script> principale di index.html.
//
// Pattern onChanged (stesso di js/tamer-card.js/js/scene-encounters.js): renderProgressionMaster
// chiamava refreshLiveParts() per nome fisso in 8 punti (dopo ogni azione che cambia lo stato di
// Progressione/party) -- ora parametrizzata con un onChanged opzionale (if(onChanged) onChanged();),
// propagato anche alle chiamate ricorsive interne (i vari onchange/onclick che si concludono con
// un nuovo giro di renderProgressionMaster(code, onChanged), per non perdere il collegamento al
// giro successivo). index.html lo passa esplicitamente (refreshLiveParts) all'unico call site
// esterno rimasto (dentro renderMaster). grantMilestoneRewards non tocca mai refreshLiveParts
// (viene sempre chiamata da dentro renderProgressionMaster, che gestisce lei il refresh dopo),
// quindi la sua firma resta invariata.

  async function saveProgression(code, data){ return apiPost('/api/state', { resource:'progression', code, ...data }); }

  async function grantMilestoneRewards(code, prog, milestoneNumber, reason, xpConsumed){
    const players = cachedRoster.filter(m=>m.role==='player');
    for(const p of players){
      p.tamer.unspentGrowthPoints = Number(p.tamer.unspentGrowthPoints||0) + 3;
      p.tamer.inspirationPoints = Number(p.tamer.inspirationPoints||0) + 1;
      p.digimon.unspentBonusDP = Number(p.digimon.unspentBonusDP||0) + 3;
      // Traccia l'origine di ogni concessione (quale Milestone, quando, come) — prima si perdeva,
      // lasciando solo un numero grezzo senza modo di risalire al perché per il Master.
      p.digimon.bonusDpLog = Array.isArray(p.digimon.bonusDpLog) ? p.digimon.bonusDpLog : [];
      p.digimon.bonusDpLog.push({ amount: 3, milestone: milestoneNumber, date: new Date().toISOString(), reason: reason || 'Milestone' });
      await saveMember(code, p);
    }
    // Richiesta utente: poter annullare l'ULTIMA Milestone consegnata per errore. Registra qui
    // (unico punto in cui una Milestone viene davvero concessa, sia da XP sia Narrativa) un
    // istantanea di cosa è stato dato, così "btn-milestone-undo" può ripetere esattamente
    // l'operazione inversa senza dover indovinare — sovrascritta a ogni nuova Milestone concessa (solo
    // l'ULTIMA è annullabile, non uno storico completo). `xpConsumed` è i 7 XP tolti dal pool per
    // arrivare a questa Milestone (0 per una Milestone Narrativa, che non tocca gli XP) — da
    // restituire se annullata, altrimenti gli XP "spariscono" insieme alla Milestone.
    if(prog){
      prog.lastMilestoneGrant = {
        milestone: milestoneNumber,
        reason: reason || 'Milestone',
        at: new Date().toISOString(),
        xpConsumed: xpConsumed || 0,
        playerUsernames: players.map(p=>p.username)
      };
      await saveProgression(code, prog);
    }
  }

  async function renderProgressionMaster(code, onChanged){
    const cardEl = document.getElementById('progression-card');
    if(!cardEl) return;
    const prog = cachedProgression || { milestone:0, xp:0, inspiration:0, campaignLevel:'Standard' };
    cardEl.innerHTML = `
      <div class="section-title">Progressione Party</div>
      <div class="field"><label>Campaign Level</label>
        <select id="campaign-level-select">
          <option value="Standard" ${prog.campaignLevel==='Standard'?'selected':''}>Standard</option>
          <option value="Classic" ${prog.campaignLevel==='Classic'?'selected':''}>Classic (più corta, TN -2)</option>
          <option value="Extreme" ${prog.campaignLevel==='Extreme'?'selected':''}>Extreme (più lunga, TN +2)</option>
        </select>
      </div>
      <div class="field"><label>Variant Rule 2.05c — Attribute Advantage</label>
        <select id="attr-advantage-select">
          <option value="" ${!prog.attributeAdvantage?'selected':''}>Disattivata</option>
          <option value="minor" ${prog.attributeAdvantage==='minor'?'selected':''}>Minor Advantage (+1d6 Accuracy)</option>
          <option value="major" ${prog.attributeAdvantage==='major'?'selected':''}>Major Advantage (+1 Successo automatico)</option>
        </select>
      </div>
      <div class="muted" style="margin-bottom:8px;">Vaccine batte Virus, Virus batte Data, Data batte Vaccine. Free non partecipa. Variable sceglie l'Attributo all'Iniziativa (impostalo nella scheda Digimon).</div>
      <label style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">
        <input type="checkbox" id="natcrit-toggle" ${prog.naturalCriticalResults?'checked':''} />
        <span class="muted">Variant Rule 2.06d — Natural Critical Results (3d6 tutti 6 = Successo Critico automatico, tutti 1 = Fallimento Critico automatico, su Check e Torment Check)</span>
      </label>
      <div class="divider"></div>
      <div class="muted" style="margin-bottom:6px;">Variant Rules 2.02a — visibili ai giocatori solo se attivate qui:</div>
      <label style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
        <input type="checkbox" id="blastevo-toggle" ${prog.blastEvolutionEnabled?'checked':''} />
        <span class="muted">💥 Blast Evolution</span>
      </label>
      <label style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
        <input type="checkbox" id="slideevo-toggle" ${prog.slideEvolutionEnabled?'checked':''} />
        <span class="muted">🔀 Slide Evolution</span>
      </label>
      <label style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">
        <input type="checkbox" id="darkevo-toggle" ${prog.darkEvolutionEnabled?'checked':''} />
        <span class="muted">🌑 Dark Evolution</span>
      </label>
      <div class="grid-stats" style="grid-template-columns:repeat(3,1fr);margin-bottom:10px;">
        <div class="stat-box"><div class="v">${prog.milestone}</div><div class="l">Milestone</div></div>
        <div class="stat-box"><div class="v">${prog.xp}/7</div><div class="l">XP</div></div>
        <div class="stat-box"><div class="v">${prog.inspiration}</div><div class="l">Ispirazione</div></div>
      </div>
      <div class="muted" style="margin-bottom:6px;">Aggiungi XP</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px;">
        <button class="btn small" data-xp-add="1" data-xp-label="Sessione senza Combattimento">+1 No-Combat</button>
        <button class="btn small" data-xp-add="1" data-xp-label="Combattimento Concluso">+1 Combattimento</button>
        <button class="btn small" data-xp-add="1" data-xp-label="Boss Extra">+1 Boss</button>
        <button class="btn small" data-xp-add="1" data-xp-label="Torment Box rimosso">+1 Torment</button>
      </div>
      <button class="btn amber" id="btn-milestone-narrative" style="width:100%;margin-bottom:6px;">🌟 Assegna Milestone (Narrativo)</button>
      ${prog.lastMilestoneGrant ? `<button class="btn ghost" id="btn-milestone-undo" style="width:100%;margin-bottom:6px;" title="Annulla la Milestone ${escapeAttr(String(prog.lastMilestoneGrant.milestone))} (${escapeAttr(prog.lastMilestoneGrant.reason)}), consegnata il ${escapeAttr(new Date(prog.lastMilestoneGrant.at).toLocaleString('it-IT'))}">↩️ Annulla ultima Milestone (${escapeHTML(String(prog.lastMilestoneGrant.milestone))})</button>` : ''}
      <div class="divider"></div>
      <div class="muted" style="margin-bottom:6px;">Downtime del Party (8.04)</div>
      <div class="row" style="margin-bottom:8px;">
        <button class="btn" id="btn-take-break" style="flex:1;">☕ Break</button>
        <button class="btn solid" id="btn-take-rest" style="flex:1;">😴 Rest</button>
      </div>
      <div class="muted" style="margin-bottom:8px;">Break: Ferite piene + 1 EP. Rest: Ferite piene + EP piene + rimuove penalità Torment + reset "Torment Check" e Aspects.</div>
      <div class="muted" style="margin-top:8px;">Correzione manuale</div>
      <div class="row">
        <input type="number" id="prog-milestone-manual" value="${prog.milestone}" style="flex:1;" />
        <input type="number" id="prog-xp-manual" value="${prog.xp}" style="flex:1;" />
        <input type="number" id="prog-insp-manual" value="${prog.inspiration}" style="flex:1;" />
        <button class="btn ghost small" id="btn-prog-manual-save" style="flex:1;">Salva</button>
      </div>
      <div class="muted" id="prog-status" style="margin-top:6px;"></div>
    `;

    async function applyXp(amount, label){
      prog.xp = Number(prog.xp||0) + amount;
      let hitMilestone = false;
      while(prog.xp >= 7){
        prog.xp -= 7;
        prog.milestone += 1;
        prog.inspiration = Number(prog.inspiration||0) + 1;
        hitMilestone = true;
      }
      await saveProgression(code, prog);
      cachedProgression = prog;
      await pushLog(code, { who:'Sistema', role:'gm', text: `+${amount} XP (${label}). XP: ${prog.xp}/7.` });
      if(hitMilestone){
        await grantMilestoneRewards(code, prog, prog.milestone, 'XP', 7);
        await pushLog(code, { who:'Sistema', role:'gm', text: `🌟 Milestone ${prog.milestone} raggiunta! Ogni giocatore riceve 3 Growth Points, 1 IP, e il proprio Digimon 3 DP Bonus. Il party guadagna 1 Punto Ispirazione.` });
      }
      renderProgressionMaster(code, onChanged);
      if(onChanged) onChanged();
    }

    cardEl.querySelectorAll('[data-xp-add]').forEach(btn=>{
      btn.onclick = ()=> applyXp(Number(btn.getAttribute('data-xp-add')), btn.getAttribute('data-xp-label'));
    });
    document.getElementById('campaign-level-select').onchange = async (e)=>{
      prog.campaignLevel = e.target.value;
      await saveProgression(code, prog);
      cachedProgression = prog;
      await pushLog(code, { who:'Sistema', role:'gm', text: `⚙ Campaign Level impostato su ${prog.campaignLevel}.` });
      renderProgressionMaster(code, onChanged);
    };
    document.getElementById('attr-advantage-select').onchange = async (e)=>{
      prog.attributeAdvantage = e.target.value;
      await saveProgression(code, prog);
      cachedProgression = prog;
      const label = e.target.value==='minor' ? 'Minor Advantage' : (e.target.value==='major' ? 'Major Advantage' : 'Disattivata');
      await pushLog(code, { who:'Sistema', role:'gm', text: `⚙ Variant Rule Attribute Advantage: ${label}.` });
      renderProgressionMaster(code, onChanged);
    };
    document.getElementById('natcrit-toggle').onchange = async (e)=>{
      prog.naturalCriticalResults = e.target.checked;
      await saveProgression(code, prog);
      cachedProgression = prog;
      await pushLog(code, { who:'Sistema', role:'gm', text: `⚙ Variant Rule Natural Critical Results: ${prog.naturalCriticalResults?'Attiva':'Disattivata'}.` });
      renderProgressionMaster(code, onChanged);
    };
    document.getElementById('blastevo-toggle').onchange = async (e)=>{
      prog.blastEvolutionEnabled = e.target.checked;
      await saveProgression(code, prog);
      cachedProgression = prog;
      await pushLog(code, { who:'Sistema', role:'gm', text: `⚙ Blast Evolution ${prog.blastEvolutionEnabled?'resa disponibile ai giocatori':'nascosta ai giocatori'}.` });
      renderProgressionMaster(code, onChanged);
      if(onChanged) onChanged();
    };
    document.getElementById('slideevo-toggle').onchange = async (e)=>{
      prog.slideEvolutionEnabled = e.target.checked;
      await saveProgression(code, prog);
      cachedProgression = prog;
      await pushLog(code, { who:'Sistema', role:'gm', text: `⚙ Slide Evolution ${prog.slideEvolutionEnabled?'resa disponibile ai giocatori':'nascosta ai giocatori'}.` });
      renderProgressionMaster(code, onChanged);
      if(onChanged) onChanged();
    };
    document.getElementById('darkevo-toggle').onchange = async (e)=>{
      prog.darkEvolutionEnabled = e.target.checked;
      await saveProgression(code, prog);
      cachedProgression = prog;
      await pushLog(code, { who:'Sistema', role:'gm', text: `⚙ Dark Evolution ${prog.darkEvolutionEnabled?'resa disponibile':'nascosta'}.` });
      renderProgressionMaster(code, onChanged);
      if(onChanged) onChanged();
    };
    document.getElementById('btn-milestone-narrative').onclick = async ()=>{
      prog.milestone += 1;
      prog.inspiration = Number(prog.inspiration||0) + 1;
      await saveProgression(code, prog);
      cachedProgression = prog;
      await grantMilestoneRewards(code, prog, prog.milestone, 'Narrativa', 0);
      await pushLog(code, { who:'Sistema', role:'gm', text: `🌟 Milestone ${prog.milestone} raggiunta (narrativa)! Ogni giocatore riceve 3 Growth Points, 1 IP, e il proprio Digimon 3 DP Bonus. Il party guadagna 1 Punto Ispirazione.` });
      renderProgressionMaster(code, onChanged);
      if(onChanged) onChanged();
    };
    // Richiesta utente: "un modo per tornare indietro e recuperare l'ultima milestone consegnata
    // per errore". Ripete al contrario esattamente ciò che grantMilestoneRewards ha registrato in
    // prog.lastMilestoneGrant (unica Milestone annullabile: l'ultima, non uno storico completo —
    // sovrascritto ad ogni nuova concessione).
    const undoBtn = document.getElementById('btn-milestone-undo');
    if(undoBtn){
      undoBtn.onclick = async ()=>{
        const grant = prog.lastMilestoneGrant;
        if(!grant) return;
        if(!window.confirm(`Annullare la Milestone ${grant.milestone} (${grant.reason})? Toglierà 3 Growth Points, 1 IP e 3 DP Bonus a ogni giocatore che l'aveva ricevuta, e riporterà indietro Milestone/Ispirazione di party${grant.xpConsumed?` (e ${grant.xpConsumed} XP)`:''}. Se un giocatore ha già SPESO quei Growth Points/DP, non è possibile recuperarli indietro automaticamente — resterà a 0 invece che in negativo, da sistemare a mano.`)) return;
        for(const username of (grant.playerUsernames||[])){
          const p = cachedRoster.find(m=>m.role==='player' && m.username===username);
          if(!p) continue; // giocatore non più nel roster: nulla da annullare per lui
          p.tamer.unspentGrowthPoints = Math.max(0, Number(p.tamer.unspentGrowthPoints||0) - 3);
          p.tamer.inspirationPoints = Math.max(0, Number(p.tamer.inspirationPoints||0) - 1);
          p.digimon.unspentBonusDP = Math.max(0, Number(p.digimon.unspentBonusDP||0) - 3);
          if(Array.isArray(p.digimon.bonusDpLog)){
            const idx = p.digimon.bonusDpLog.map((e,i)=>({e,i})).filter(x=>x.e && x.e.milestone===grant.milestone).map(x=>x.i).pop();
            if(idx!==undefined) p.digimon.bonusDpLog.splice(idx, 1);
          }
          await saveMember(code, p);
        }
        prog.milestone = Math.max(0, Number(prog.milestone||0) - 1);
        prog.inspiration = Math.max(0, Number(prog.inspiration||0) - 1);
        if(grant.xpConsumed) prog.xp = Number(prog.xp||0) + grant.xpConsumed;
        prog.lastMilestoneGrant = null;
        await saveProgression(code, prog);
        cachedProgression = prog;
        await pushLog(code, { who:'Sistema', role:'gm', text: `↩️ Milestone ${grant.milestone} annullata (era stata consegnata per: ${grant.reason}). Growth Points/IP/DP Bonus tolti a ogni giocatore, Milestone/Ispirazione di party riportate indietro${grant.xpConsumed?`, ${grant.xpConsumed} XP restituiti al pool`:''}.` });
        renderProgressionMaster(code, onChanged);
        if(onChanged) onChanged();
      };
    }
    document.getElementById('btn-take-break').onclick = async ()=>{
      const players = cachedRoster.filter(m=>m.role==='player');
      for(const p of players){
        p.tamer.currentWounds = 3 + Number(p.tamer.skills.endurance||0);
        p.digimon.currentWounds = p.digimon.maxWounds;
        const cap = cachedProgression ? Number(cachedProgression.milestone||0) : 0;
        p.digimon.evolutionPoints = Math.min(cap, Number(p.digimon.evolutionPoints||0)+1);
        await saveMember(code, p);
      }
      await pushLog(code, { who:'Sistema', role:'gm', text: `☕ Il party prende un Break: Ferite recuperate del tutto, +1 Evolution Point a testa.` });
      if(onChanged) onChanged();
    };
    document.getElementById('btn-take-rest').onclick = async ()=>{
      const players = cachedRoster.filter(m=>m.role==='player');
      for(const p of players){
        p.tamer.currentWounds = 3 + Number(p.tamer.skills.endurance||0);
        p.digimon.currentWounds = p.digimon.maxWounds;
        const cap = cachedProgression ? Number(cachedProgression.milestone||0) : 0;
        p.digimon.evolutionPoints = cap;
        p.tamer.tormentPenalty = 0;
        (p.tamer.torments||[]).forEach(t=>{ t.usedThisRest = false; });
        if(!p.tamer.specialOrdersUsed) p.tamer.specialOrdersUsed = {};
        TALENT_DEFS.filter(t=>t.once==='rest').forEach(t=>{ p.tamer.specialOrdersUsed[t.order] = false; });
        (p.digimon.armorForms||[]).forEach(af=>{ af.usedThisRest = false; });
        await saveMember(code, p);
      }
      await pushLog(code, { who:'Sistema', role:'gm', text: `😴 Il party fa un Rest: Ferite ed Evolution Points recuperati del tutto, penalità Torment rimosse, Torment Check di nuovo disponibili.` });
      if(onChanged) onChanged();
    };
    document.getElementById('btn-prog-manual-save').onclick = async ()=>{
      prog.milestone = Number(document.getElementById('prog-milestone-manual').value)||0;
      prog.xp = Number(document.getElementById('prog-xp-manual').value)||0;
      prog.inspiration = Number(document.getElementById('prog-insp-manual').value)||0;
      const ok = await saveProgression(code, prog);
      cachedProgression = prog;
      const st = document.getElementById('prog-status');
      st.style.color = ok ? 'var(--text-mute)' : 'var(--danger)';
      st.textContent = ok ? 'Salvato.' : ('Errore: '+(lastApiError||''));
      renderProgressionMaster(code, onChanged);
    };
  }
