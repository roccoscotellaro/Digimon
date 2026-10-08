// js/progression.js
// Pannello "Progressione Party" del Master: Campaign Level, Variant Rules (Attribute Advantage,
// Natural Critical Results, Blast/Slide/Dark Evolution), i contatori Milestone/XP con i bottoni
// "+1 XP" per motivo, l'assegnazione di una Milestone Narrativa, l'annullamento dell'ultima
// Milestone concessa per errore (btn-milestone-undo), Break/Rest del party (8.04), la correzione
// manuale di Milestone/XP, e il pannello Punti Ispirazione (IP) del Master (+/- per giocatore
// con motivo, Inizia Sessione, Sconfitta del Party -- tetto 2+Willpower via grantIP, js/rules.js). Include anche grantMilestoneRewards (unico punto in cui una Milestone viene davvero
// concessa, sia da soglia XP sia da assegnazione Narrativa: +3 Growth Points/+1 IP/+3 DP Bonus a
// ogni giocatore, con l'istantanea in prog.lastMilestoneGrant usata da btn-milestone-undo per
// l'annullamento) e saveProgression (wrapper dati verso /api/state, usato solo da questo cluster
// -- portato qui insieme al resto invece di lasciarlo nell'IIFE di index.html, stesso schema gia'
// visto in fase 12 per saveScene/addDexEntry/updateDexEntry in js/scene-encounters.js).
// getProgression resta invece in index.html: e' usato anche da refreshLiveParts/renderMaster
// (nucleo di orchestrazione, mai estratto).
//
// Nota regole (2.05 -- Inspiration Points): l'IP e' una risorsa INDIVIDUALE di ogni Tamer (pool
// personale, cap 2+Willpower), non un pool condiviso dal party -- vedi p.tamer.inspirationPoints
// (gia' gestito correttamente per-giocatore da grantMilestoneRewards e dalla Scheda Tamer in
// js/tamer-card.js, coi bottoni +/- IP). Il vecchio campo party-wide cachedProgression.inspiration
// (mostrato prima come singolo numero "Ispirazione" qui e nella topbar) e' stato rimosso
// dall'interfaccia perche' ridondante/fuorviante: non veniva mai speso da nessuna parte nel
// codice, solo mostrato accanto al vero valore per-giocatore. Questo pannello ora mostra invece un
// riepilogo di sola lettura dell'IP di ciascun giocatore (la modifica resta sulla Scheda Tamer).
//
// Dipende da (gia' globali, caricati prima nella catena degli script): apiPost/lastApiError
// (js/api.js), escapeHTML/escapeAttr (js/util.js), pushLog/pushPrivateLog/getSubgroups/
// memberLocationKey/subgroupLocationKey/saveMember (js/chat-log-engine.js), session/cachedRoster/
// cachedProgression/cachedSubgroups (js/store.js), e TALENT_DEFS (js/tamer-card.js, usato solo
// dentro "Rest" per azzerare gli Special Order a cadenza settimanale/rest).
//
// Richiesta utente: poter scegliere DOVE pubblicare l'esito di Break/Rest (prima andava sempre e
// solo in Chat Generale) — stesso pattern Generale/Privata/Sottogruppo già usato da "Richiedi un
// Tiro" in index.html, con le checkbox lette al momento del click da publishDowntimeMessage
// invece che una volta sola al render (così restano valide anche dopo un giro di
// renderProgressionMaster interno, es. dopo aver mosso lo slider Campaign Level). "Privata" manda
// una copia a OGNI giocatore del party (Break/Rest non hanno un destinatario selezionabile, sono
// sempre un'azione di party) invece che a un sottoinsieme.
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
//
// Nota regole (2.05 -- Inspiration Points): l'IP e' una risorsa INDIVIDUALE di ogni Tamer (pool
// personale, cap 2+Willpower), non un pool condiviso dal party -- vedi p.tamer.inspirationPoints
// (gia' gestito correttamente per-giocatore da grantMilestoneRewards e dalla Scheda Tamer in
// js/tamer-card.js, coi bottoni +/- IP). Il vecchio campo party-wide cachedProgression.inspiration
// (mostrato prima come singolo numero "Ispirazione" qui e nella topbar) e' stato rimosso
// dall'interfaccia perche' ridondante/fuorviante: non veniva mai speso da nessuna parte nel
// codice, solo mostrato accanto al vero valore per-giocatore. Questo pannello ora mostra invece un
// riepilogo di sola lettura dell'IP di ciascun giocatore (la modifica resta sulla Scheda Tamer).

  // BUGFIX (Rocco 2026-10-08: "un Digimon sconfitto nella scorsa battaglia, nonostante il riposo
  // e la battaglia finita, dice che è stato sconfitto"): regola 9.12a -- un Digimon Sconfitto è
  // ignorato "per il resto della battaglia", non oltre. Il flag member.digimon.defeated però non
  // veniva mai tolto da Break/Rest né da un nuovo combattimento (solo a mano con ↩️), quindi restava
  // "Sconfitto" per sempre e veniva saltato anche nei fight successivi. Ora Break e Rest lo tolgono.
  // Se la scelta Regredisci/Uovo (defeatPending) non è ancora stata fatta, NON la si decide al posto
  // del Master: il flag resta e il messaggio lo ricorda (si risolve dalla Scheda Digimon).
  // Ritorna il nome del Digimon se aveva ancora una Sconfitta da risolvere, altrimenti null.
  function clearStaleDefeat(p){
    if(!p || !p.digimon || !p.digimon.defeated) return null;
    if(p.digimon.defeatPending) return p.digimon.name || displayName(p);
    p.digimon.defeated = false;
    return null;
  }
  function pendingDefeatNote(names){
    return names.length ? ` ⚠️ Sconfitta ancora da risolvere (Regredisci o Uovo) dalla Scheda Digimon: ${names.join(', ')}.` : '';
  }

  async function saveProgression(code, data){ return apiPost('/api/state', { resource:'progression', code, ...data }); }

  async function grantMilestoneRewards(code, prog, milestoneNumber, reason, xpConsumed){
    const players = cachedRoster.filter(m=>m.role==='player');
    // Richiesta Rocco (IP col tetto 2+Willpower, js/rules.js grantIP): l'IP della Milestone può
    // non entrare se il Tamer è già al massimo -- ipByUser registra quanto è stato DAVVERO dato,
    // così btn-milestone-undo toglie solo quello (e non un IP che il Tamer aveva già prima).
    const ipByUser = {};
    for(const p of players){
      p.tamer.unspentGrowthPoints = Number(p.tamer.unspentGrowthPoints||0) + 3;
      ipByUser[p.username] = grantIP(p, 1);
      p.digimon.unspentBonusDP = Number(p.digimon.unspentBonusDP||0) + 3;
      p.digimon.bonusDpLog = Array.isArray(p.digimon.bonusDpLog) ? p.digimon.bonusDpLog : [];
      p.digimon.bonusDpLog.push({ amount: 3, milestone: milestoneNumber, date: new Date().toISOString(), reason: reason || 'Milestone' });
      await saveMember(code, p);
    }
    if(prog){
      prog.lastMilestoneGrant = {
        milestone: milestoneNumber,
        reason: reason || 'Milestone',
        at: new Date().toISOString(),
        xpConsumed: xpConsumed || 0,
        playerUsernames: players.map(p=>p.username),
        ipByUser
      };
      await saveProgression(code, prog);
    }
  }

  async function renderProgressionMaster(code, onChanged){
    const cardEl = document.getElementById('progression-card');
    if(!cardEl) return;
    const prog = cachedProgression || { milestone:0, xp:0, campaignLevel:'Standard' };
    const players = (cachedRoster||[]).filter(m=>m.role==='player');
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
      <div class="grid-stats" style="grid-template-columns:repeat(2,1fr);margin-bottom:10px;">
        <div class="stat-box"><div class="v">${prog.milestone}</div><div class="l">Milestone</div></div>
        <div class="stat-box"><div class="v">${prog.xp}/7</div><div class="l">XP</div></div>
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
      <div class="muted" style="margin:2px 0 6px;font-size:11px;">Dove pubblicare l'esito (almeno uno) — vale anche per i Punti Ispirazione qui sotto:</div>
      <div class="checkbox-row">
        <input type="checkbox" id="downtime-chan-general" checked />
        <label for="downtime-chan-general">📣 Chat Generale (visibile a tutti)</label>
      </div>
      <div class="checkbox-row">
        <input type="checkbox" id="downtime-chan-private" />
        <label for="downtime-chan-private">✉️ Chat Privata (una copia per ciascun giocatore)</label>
      </div>
      <div class="checkbox-row">
        <input type="checkbox" id="downtime-chan-subgroup" />
        <label for="downtime-chan-subgroup">👥 Sottogruppo</label>
      </div>
      <div class="field" id="downtime-subgroup-field" style="display:none;"><label>Quale sottogruppo</label>
        <select id="downtime-subgroup-select"><option value="">Caricamento...</option></select>
      </div>
      <div class="row" style="margin-bottom:8px;">
        <button class="btn" id="btn-take-break" style="flex:1;">☕ Break</button>
        <button class="btn solid" id="btn-take-rest" style="flex:1;">😴 Rest</button>
      </div>
      <div class="muted" style="margin-bottom:8px;">Break: Ferite piene + 1 EP. Rest: Ferite piene + EP piene + rimuove penalità Torment + reset "Torment Check" e Aspects.</div>
      <div class="divider"></div>
      <div class="muted" style="margin-bottom:4px;">💡 Punti Ispirazione (2.05 — individuali, tetto 2 + Willpower)</div>
      <div class="muted" style="margin-bottom:6px;font-size:11px;">Automatici: Milestone, Torment Check riuscito, penalità del Major Aspect, Fallimento Critico su un Check, Lucky Number (anche sui Torment Check).</div>
      ${players.length ? players.map((p,i)=>`
        <div class="flex-between" style="margin-bottom:4px;">
          <span class="mono">${escapeHTML(displayName(p))}</span>
          <span style="display:flex;align-items:center;gap:6px;">
            <b class="mono" style="color:var(--cyan);">${Number(p.tamer.inspirationPoints||0)}</b><span class="muted">/ ${ipCap(p.tamer)}</span>
            <button class="btn ghost small" data-ip-adjust="-1" data-ip-user="${escapeAttr(p.username)}">−</button>
            <button class="btn ghost small" data-ip-adjust="1" data-ip-user="${escapeAttr(p.username)}">+</button>
          </span>
        </div>`).join('') : '<div class="muted">Nessun giocatore nel roster.</div>'}
      <div class="field" style="margin-top:6px;"><label>Motivo (facoltativo, finisce nel messaggio)</label><input type="text" id="ip-reason" placeholder="es. buon roleplay" /></div>
      <div class="row" style="margin-bottom:6px;">
        <button class="btn" id="btn-ip-session" style="flex:1;">🎬 Inizia Sessione</button>
        <button class="btn" id="btn-ip-defeat" style="flex:1;">💀 Sconfitta del Party</button>
      </div>
      <div class="muted" style="margin-bottom:8px;font-size:11px;">Inizia Sessione: +1 IP a chi è a 0. Sconfitta: +1 IP a ogni giocatore. Il tetto vale sempre, anche per i bottoni +/−.</div>
      <div class="muted" id="ip-status" style="margin-bottom:8px;"></div>
      <div class="muted" style="margin-top:8px;">Correzione manuale</div>
      <div class="row">
        <input type="number" id="prog-milestone-manual" value="${prog.milestone}" style="flex:1;" />
        <input type="number" id="prog-xp-manual" value="${prog.xp}" style="flex:1;" />
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
        hitMilestone = true;
      }
      await saveProgression(code, prog);
      cachedProgression = prog;
      await pushLog(code, { who:'Sistema', role:'gm', text: `+${amount} XP (${label}). XP: ${prog.xp}/7.` });
      if(hitMilestone){
        await grantMilestoneRewards(code, prog, prog.milestone, 'XP', 7);
        await pushLog(code, { who:'Sistema', role:'gm', text: `🌟 Milestone ${prog.milestone} raggiunta! Ogni giocatore riceve 3 Growth Points, 1 IP, e il proprio Digimon 3 DP Bonus.` });
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
      await saveProgression(code, prog);
      cachedProgression = prog;
      await grantMilestoneRewards(code, prog, prog.milestone, 'Narrativa', 0);
      await pushLog(code, { who:'Sistema', role:'gm', text: `🌟 Milestone ${prog.milestone} raggiunta (narrativa)! Ogni giocatore riceve 3 Growth Points, 1 IP, e il proprio Digimon 3 DP Bonus.` });
      renderProgressionMaster(code, onChanged);
      if(onChanged) onChanged();
    };
    const undoBtn = document.getElementById('btn-milestone-undo');
    if(undoBtn){
      undoBtn.onclick = async ()=>{
        const grant = prog.lastMilestoneGrant;
        if(!grant) return;
        if(!window.confirm(`Annullare la Milestone ${grant.milestone} (${grant.reason})? Toglierà 3 Growth Points, 1 IP e 3 DP Bonus a ogni giocatore che l'aveva ricevuta, e riporterà indietro la Milestone${grant.xpConsumed?` (e ${grant.xpConsumed} XP)`:''}. Se un giocatore ha già SPESO quei Growth Points/DP/IP, non è possibile recuperarli indietro automaticamente — resterà a 0 invece che in negativo, da sistemare a mano.`)) return;
        for(const username of (grant.playerUsernames||[])){
          const p = cachedRoster.find(m=>m.role==='player' && m.username===username);
          if(!p) continue;
          p.tamer.unspentGrowthPoints = Math.max(0, Number(p.tamer.unspentGrowthPoints||0) - 3);
          // ipByUser assente = Milestone consegnata prima del tetto IP: valeva sempre 1.
          const ipGiven = (grant.ipByUser && grant.ipByUser[username]!==undefined) ? Number(grant.ipByUser[username]||0) : 1;
          if(ipGiven) grantIP(p, -ipGiven);
          p.digimon.unspentBonusDP = Math.max(0, Number(p.digimon.unspentBonusDP||0) - 3);
          if(Array.isArray(p.digimon.bonusDpLog)){
            const idx = p.digimon.bonusDpLog.map((e,i)=>({e,i})).filter(x=>x.e && x.e.milestone===grant.milestone).map(x=>x.i).pop();
            if(idx!==undefined) p.digimon.bonusDpLog.splice(idx, 1);
          }
          await saveMember(code, p);
        }
        prog.milestone = Math.max(0, Number(prog.milestone||0) - 1);
        if(grant.xpConsumed) prog.xp = Number(prog.xp||0) + grant.xpConsumed;
        prog.lastMilestoneGrant = null;
        await saveProgression(code, prog);
        cachedProgression = prog;
        await pushLog(code, { who:'Sistema', role:'gm', text: `↩️ Milestone ${grant.milestone} annullata (era stata consegnata per: ${grant.reason}). Growth Points/IP/DP Bonus tolti a ogni giocatore, Milestone riportata indietro${grant.xpConsumed?`, ${grant.xpConsumed} XP restituiti al pool`:''}.` });
        renderProgressionMaster(code, onChanged);
        if(onChanged) onChanged();
      };
    }
    const downtimeSubChk = document.getElementById('downtime-chan-subgroup');
    const downtimeSubField = document.getElementById('downtime-subgroup-field');
    if(downtimeSubChk){
      downtimeSubChk.onchange = async ()=>{
        downtimeSubField.style.display = downtimeSubChk.checked ? 'block' : 'none';
        if(downtimeSubChk.checked){
          const groups = await getSubgroups(code);
          cachedSubgroups = groups;
          const sel = document.getElementById('downtime-subgroup-select');
          if(sel) sel.innerHTML = groups.length ? groups.map(g=>`<option value="${escapeAttr(g.id)}">${escapeHTML(g.name)}</option>`).join('') : '<option value="">Nessun sottogruppo creato</option>';
        }
      };
    }
    // privateTargets (opzionale): a chi mandare la copia in Chat Privata -- default tutto il party
    // (Break/Rest), un solo giocatore per un IP assegnato a mano dal Master.
    async function publishDowntimeMessage(entry, privateTargets){
      const sendGeneral = document.getElementById('downtime-chan-general').checked;
      const sendPrivate = document.getElementById('downtime-chan-private').checked;
      const sendSubgroup = downtimeSubChk ? downtimeSubChk.checked : false;
      const subSel = document.getElementById('downtime-subgroup-select');
      const subgroupId = subSel ? subSel.value : '';
      if(!sendGeneral && !sendPrivate && !(sendSubgroup && subgroupId)){
        await pushLog(code, entry);
        return;
      }
      if(sendGeneral) await pushLog(code, entry);
      if(sendPrivate){
        for(const p of (privateTargets || cachedRoster.filter(m=>m.role==='player'))){
          await pushPrivateLog(code, p.username, { ...entry, meta: { location: memberLocationKey(p) } });
        }
      }
      if(sendSubgroup && subgroupId){
        const group = (cachedSubgroups||[]).find(g=>g.id===subgroupId) || null;
        await pushPrivateLog(code, 'subgroup:'+subgroupId, { ...entry, meta: { location: subgroupLocationKey(group) } });
      }
    }
    // ---------- Punti Ispirazione: controllo del Master (richiesta Rocco) ----------
    // Tutte le variazioni passano da grantIP (js/rules.js), quindi rispettano il tetto 2+Willpower.
    const ipStatus = (msg, isErr)=>{ const el = document.getElementById('ip-status'); if(el){ el.style.color = isErr?'var(--danger)':'var(--text-mute)'; el.textContent = msg; } };
    const ipReason = ()=>{ const el = document.getElementById('ip-reason'); return el ? el.value.trim() : ''; };
    cardEl.querySelectorAll('[data-ip-adjust]').forEach(btn=>{
      btn.onclick = async ()=>{
        const p = cachedRoster.find(m=>m.role==='player' && m.username===btn.getAttribute('data-ip-user'));
        if(!p) return;
        const delta = grantIP(p, Number(btn.getAttribute('data-ip-adjust')));
        if(!delta){ ipStatus(Number(btn.getAttribute('data-ip-adjust'))>0 ? `${displayName(p)} è già al massimo (${ipCap(p.tamer)} IP).` : `${displayName(p)} non ha IP da togliere.`, true); return; }
        await saveMember(code, p);
        const why = ipReason();
        await publishDowntimeMessage({ who:'Sistema', role:'gm', text: `💡 ${displayName(p)} ${delta>0?'guadagna':'perde'} 1 IP${why?` (${why})`:''}. IP: ${Number(p.tamer.inspirationPoints||0)}/${ipCap(p.tamer)}.` }, [p]);
        renderProgressionMaster(code, onChanged);
        if(onChanged) onChanged();
      };
    });
    // Regola 2.05: "+1 IP se non ne hai all'inizio della sessione". Il sito non ha un concetto di
    // sessione, quindi è il Master a dichiararla con questo bottone.
    document.getElementById('btn-ip-session').onclick = async ()=>{
      const got = [];
      for(const p of cachedRoster.filter(m=>m.role==='player')){
        if(Number(p.tamer.inspirationPoints||0)===0 && grantIP(p, 1)){ await saveMember(code, p); got.push(displayName(p)); }
      }
      await publishDowntimeMessage({ who:'Sistema', role:'gm', text: `🎬 Inizia la sessione! ${got.length ? `+1 IP a chi non ne aveva: ${got.join(', ')}.` : 'Tutti hanno già almeno 1 IP.'}` });
      renderProgressionMaster(code, onChanged);
      if(onChanged) onChanged();
    };
    // Regola 2.05: "+1 IP se il party subisce una Sconfitta in Combattimento".
    document.getElementById('btn-ip-defeat').onclick = async ()=>{
      if(!window.confirm('Il party ha subito una Sconfitta? Ogni giocatore riceve 1 IP (regola 2.05, tetto 2 + Willpower).')) return;
      const got = [], full = [];
      for(const p of cachedRoster.filter(m=>m.role==='player')){
        if(grantIP(p, 1)){ await saveMember(code, p); got.push(displayName(p)); } else full.push(displayName(p));
      }
      await publishDowntimeMessage({ who:'Sistema', role:'gm', text: `💀 Il party subisce una Sconfitta. +1 IP a: ${got.length?got.join(', '):'nessuno'}${full.length?` (già al massimo: ${full.join(', ')})`:''}.` });
      renderProgressionMaster(code, onChanged);
      if(onChanged) onChanged();
    };
    document.getElementById('btn-take-break').onclick = async ()=>{
      const players = cachedRoster.filter(m=>m.role==='player');
      const pendingDefeats = [];
      for(const p of players){
        p.tamer.currentWounds = 3 + Number(p.tamer.skills.endurance||0);
        p.digimon.currentWounds = p.digimon.maxWounds;
        const cap = cachedProgression ? Number(cachedProgression.milestone||0) : 0;
        p.digimon.evolutionPoints = Math.min(cap, Number(p.digimon.evolutionPoints||0)+1);
        const pend = clearStaleDefeat(p); if(pend) pendingDefeats.push(pend);
        await saveMember(code, p);
      }
      await publishDowntimeMessage({ who:'Sistema', role:'gm', text: `☕ Il party prende un Break: Ferite recuperate del tutto, +1 Evolution Point a testa.${pendingDefeatNote(pendingDefeats)}` });
      if(onChanged) onChanged();
    };
    document.getElementById('btn-take-rest').onclick = async ()=>{
      const players = cachedRoster.filter(m=>m.role==='player');
      const pendingDefeats = [];
      for(const p of players){
        p.tamer.currentWounds = 3 + Number(p.tamer.skills.endurance||0);
        p.digimon.currentWounds = p.digimon.maxWounds;
        const cap = cachedProgression ? Number(cachedProgression.milestone||0) : 0;
        p.digimon.evolutionPoints = cap;
        p.tamer.tormentPenalty = 0;
        (p.tamer.torments||[]).forEach(t=>{ t.usedThisRest = false; });
        // BUGFIX (Rocco 2026-10-02: "quando il Master richiede il tiro non fa tirare major e
        // minor"): il messaggio di Rest e la descrizione del pannello promettevano il reset degli
        // Aspects, ma il codice non lo faceva -- una volta spesi, gli usi restavano a 0 per sempre e
        // "Tira ora" smetteva di proporli. Scelta di Rocco: si ricaricano al Rest (manuale 8.01b:
        // Major 1 uso, Minor 2 usi).
        if(p.tamer.majorAspect) p.tamer.majorAspect.usesLeft = 1;
        if(p.tamer.minorAspect) p.tamer.minorAspect.usesLeft = 2;
        if(!p.tamer.specialOrdersUsed) p.tamer.specialOrdersUsed = {};
        TALENT_DEFS.filter(t=>t.once==='rest').forEach(t=>{ p.tamer.specialOrdersUsed[t.order] = false; });
        (p.digimon.armorForms||[]).forEach(af=>{ af.usedThisRest = false; });
        const pend = clearStaleDefeat(p); if(pend) pendingDefeats.push(pend);
        await saveMember(code, p);
      }
      await publishDowntimeMessage({ who:'Sistema', role:'gm', text: `😴 Il party fa un Rest: Ferite ed Evolution Points recuperati del tutto, penalità Torment rimosse, Torment Check di nuovo disponibili, Aspects ricaricati (Major 1, Minor 2).${pendingDefeatNote(pendingDefeats)}` });
      // Richiesta utente (Razioni): oltre al Rest ufficiale (8.04) sopra, invia ai giocatori un
      // prompt per consumare le razioni giornaliere (2, oggetti inventario categoria 'cibo' — vedi
      // js/tamer-card.js/renderInventoryCard e il marcatore ::RATIONREQ:: gestito in
      // js/chat-log-engine.js). Un restId univoco per Rest (timestamp) distingue Rest diversi
      // sullo stesso giocatore, così un vecchio prompt già gestito non torna cliccabile e un
      // prompt nuovo non viene scambiato per uno già risolto.
      //
      // BUGFIX 2026-09-25 (Rocco: "ho mandato il messaggio in chat per il rest ma sembra non
      // essere partita l'opzione per chiedere quanto cibo consumare"): prima il prompt andava
      // SEMPRE e SOLO nella Chat Privata di ciascun giocatore, qualunque canale il Master avesse
      // scelto per il Rest — chi leggeva la Generale (o il Sottogruppo) vedeva il messaggio
      // "😴 Il party fa un Rest" ma nessuna scelta delle razioni, finita in un'altra chat. Ora il
      // prompt segue gli STESSI canali del messaggio di Rest (stesse checkbox, lette qui al
      // momento del click come fa publishDowntimeMessage): Generale/Sottogruppo = un solo
      // messaggio con tutti gli username interessati nel payload (ognuno vede solo il PROPRIO
      // select, vedi logHTML), Privata = una copia per ciascun giocatore come prima. Nessun
      // rischio di doppio consumo se lo stesso giocatore riceve più copie (es. Generale +
      // Privata): tamer.lastRationRestId blocca la seconda conferma per lo stesso restId.
      const rationRestId = Date.now();
      const rationText = (usernames)=> `🍱 Momento delle razioni: quante ne consumi questo Rest (2 al giorno)?::RATIONREQ::${usernames.join(',')}|${rationRestId}`;
      const rSendGeneral = document.getElementById('downtime-chan-general').checked;
      const rSendPrivate = document.getElementById('downtime-chan-private').checked;
      const rSubSel = document.getElementById('downtime-subgroup-select');
      const rSubgroupId = (downtimeSubChk && downtimeSubChk.checked && rSubSel) ? rSubSel.value : '';
      const rNoChannel = !rSendGeneral && !rSendPrivate && !rSubgroupId; // stesso fallback di publishDowntimeMessage: Generale
      if(players.length && (rSendGeneral || rNoChannel)){
        await pushLog(code, { who:'Sistema', role:'rationrequest', text: rationText(players.map(p=>p.username)) });
      }
      if(rSendPrivate){
        for(const p of players){
          await pushPrivateLog(code, p.username, {
            who:'Sistema', role:'rationrequest',
            text: rationText([p.username]),
            meta: { location: memberLocationKey(p) }
          });
        }
      }
      if(rSubgroupId){
        const group = (cachedSubgroups||[]).find(g=>g.id===rSubgroupId) || null;
        const groupPlayers = players.filter(p=> group && Array.isArray(group.members) && group.members.includes(p.username));
        if(groupPlayers.length){
          await pushPrivateLog(code, 'subgroup:'+rSubgroupId, {
            who:'Sistema', role:'rationrequest',
            text: rationText(groupPlayers.map(p=>p.username)),
            meta: { location: subgroupLocationKey(group) }
          });
        }
      }
      if(onChanged) onChanged();
    };
    document.getElementById('btn-prog-manual-save').onclick = async ()=>{
      prog.milestone = Number(document.getElementById('prog-milestone-manual').value)||0;
      prog.xp = Number(document.getElementById('prog-xp-manual').value)||0;
      const ok = await saveProgression(code, prog);
      cachedProgression = prog;
      const st = document.getElementById('prog-status');
      st.style.color = ok ? 'var(--text-mute)' : 'var(--danger)';
      st.textContent = ok ? 'Salvato.' : ('Errore: '+(lastApiError||''));
      renderProgressionMaster(code, onChanged);
    };
  }
