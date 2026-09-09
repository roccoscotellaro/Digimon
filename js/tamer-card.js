// js/tamer-card.js
// Scheda Tamer/Skills del giocatore: il pannello Skills (renderSkillsCard, con editing e i tiri
// diretti dalle singole Skill), la Scheda Tamer vera e propria (renderTamerCard, la piu' grande
// di questo file: HP/Willpower/Torment/Talenti/inventario rapido), i Talenti (TALENT_DEFS,
// SKILL_LABEL_BY_KEY, talentAbbr, computeUnlockedTalents -- sbloccati automaticamente in base ai
// Ranghi di Skill del personaggio), l'Inventario (renderInventoryCard), il pannello "Sidebar"
// unico che le assembla tutte e tre (renderSidebar, usato dalla scheda "Scheda" del giocatore),
// la scheda "Segnala un Bug" (renderBugReportCard), il pannello di tiro rapido di una Skill
// (openSkillRollPanel) e lo shortcut testuale per i tiri in chat (tryParseRollShortcut). Include
// anche i piccoli helper usati solo da questo blocco: rollTormentCheck (tiro di Torment/Marked),
// defaultSkills/skillMax (valori/limiti di partenza delle Skill) e defaultTamer (Tamer vuoto per
// un personaggio nuovo -- usato anche da normalizeMember in index.html per completare schede vecchie).
//
// Dipende da (gia' globali, caricati prima nella catena degli script): escapeHTML/escapeAttr/
// displayName (js/util.js), STAGES/stanceModifiers/evaluateVsTN/SKILL_DEFS/prodigiousSkillBonus/
// ATTR_ABBR (js/rules.js), rollSkillCheck/diceRowHTML (js/combat-engine.js), saveMember
// (js/chat-log-engine.js), session/cachedRoster/cachedCombat/cachedSubgroups (js/store.js), e da
// barHTML/portraitHTML/tamerAvatarHTML/siblingCardId (js/ui-helpers.js). Usa anche
// renderDigimonCard (js/digimon-card.js, caricato subito prima di questo file nella catena) dentro
// renderSidebar, per disegnare assieme le tre schede del giocatore.
//
// Script classico (non un modulo ES), caricato PRIMA del blocco <script> principale in index.html,
// dopo js/digimon-card.js.
//
// Pattern onChanged (introdotto in fase 8-9, gia' usato da renderDigimonCard): renderTamerCard/
// renderSkillsCard/openSkillRollPanel/renderSidebar non chiamano piu' refreshLiveParts() a mano
// libera (resta nell'IIFE principale di index.html, e' l'orchestratore centrale) -- ricevono un
// parametro onChanged opzionale e lo invocano al posto suo (if(onChanged) onChanged(););
// index.html lo passa esplicitamente ad ogni chiamata esterna (refreshLiveParts). renderInventoryCard
// e renderBugReportCard non toccano mai refreshLiveParts, quindi la loro firma resta invariata.

  function rollTormentCheck(boxes){
    const dice = [rollD6(), rollD6(), rollD6()];
    const total = dice.reduce((a,b)=>a+b,0);
    const tn = 8 + Number(boxes||0);
    const diff = total - tn;
    let outcome;
    if(cachedProgression && cachedProgression.naturalCriticalResults && dice.every(d=>d===6)) outcome = 'crit-success';
    else if(cachedProgression && cachedProgression.naturalCriticalResults && dice.every(d=>d===1)) outcome = 'crit-fail';
    else if(diff>=5) outcome = 'crit-success';
    else if(diff>=0) outcome = 'success';
    else if(diff<=-10) outcome = 'deep-crit-fail';
    else if(diff<=-5) outcome = 'crit-fail';
    else outcome = 'fail';
    return { dice, total, tn, outcome };
  }

  // diceRowHTML e' stata spostata in js/dice.js (usa DIE_FACES, ora definita li').


  function defaultSkills(){
    const s = {};
    SKILL_DEFS.forEach(sk=>{ s[sk.key] = 0; });
    return s;
  }
  // Legge il Digimon partner (stesso membro di roster — le due schede condividono lo stesso record)
  // per sommare eventuali bonus di Prodigious Skill / Mind Over Matter su questa Skill del Tamer:
  // +3 ai Check, per regola Companion 3.02a (aggiornata dal Changelog 21/11/25).
  function skillMax(t, def){
    return Math.max(...def.attrs.map(a=>Number(t[a])||0));
  }

  function defaultTamer(){
    return { agility:1, body:1, charisma:1, intelligence:1, willpower:1, imageUrl:'', currentWounds:null, inventory:[], skills: defaultSkills(), unspentGrowthPoints:0,
      inspirationPoints:0, tormentPenalty:0,
      torments: [],
      majorAspect: { text:'', usesLeft:1 },
      minorAspect: { text:'', usesLeft:2 },
      specialOrdersUsed: {},
      teamworkBonus: 0,
      built: false, // diventa true al completamento della Creazione Guidata — segnala che la scheda non è più "vuota"
      currentSectorId: null, // null = segue il Settore attuale del gruppo; un id esplicito = si è separato dal gruppo
      currentLuogoId: null, // null = segue il Luogo attuale del gruppo (solo se nello stesso Settore); un id esplicito = si è spostato da solo a un Luogo diverso
      characterName:'' // nome del personaggio mostrato in UI, indipendente dallo username di login (fallback: username)
    };
  }

  let editingSkills = false;

  // siblingCardId spostato in js/ui-helpers.js

  function renderSkillsCard(me, containerId, onChanged){
    containerId = containerId || 'skills-card';
    const cardEl = document.getElementById(containerId);
    if(!cardEl) return;
    const t = me.tamer;
    if(!editingSkills){
      const gp = Number(t.unspentGrowthPoints||0);
      cardEl.innerHTML = `
        <div class="flex-between"><div class="section-title" style="margin:0;border:none;padding:0;">Skill</div>
        <button class="btn small" id="btn-edit-skills">Modifica</button></div>
        ${gp>0 ? `
          <div class="hud-frame" style="padding:8px;margin:10px 0;border-color:var(--cyan-dim);">
            <div class="flex-between" style="margin-bottom:6px;"><span class="muted">Growth Points disponibili</span><span class="mono" style="color:var(--cyan);">${gp}</span></div>
            <div class="row">
              <select id="gp-skill-select" style="flex:2;">${SKILL_DEFS.map(d=>`<option value="${d.key}">${escapeHTML(d.label)}</option>`).join('')}</select>
              <button class="btn small" id="btn-gp-skill" style="flex:1;">+1 Skill (1 GP)</button>
            </div>
            ${gp>=3 ? `
            <div class="row" style="margin-top:6px;">
              <select id="gp-attr-select" style="flex:2;">
                <option value="agility">Agility</option><option value="body">Body</option><option value="charisma">Charisma</option><option value="intelligence">Intelligence</option><option value="willpower">Willpower</option>
              </select>
              <button class="btn small" id="btn-gp-attr" style="flex:1;">+1 Attributo (3 GP)</button>
            </div>` : ''}
            <div class="muted" id="gp-status" style="margin-top:4px;"></div>
          </div>
        ` : ''}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:12px;">
          ${SKILL_DEFS.map(def=>`
            <div class="stat-box" style="text-align:left;padding:6px 8px;">
              <div class="l" style="margin-bottom:2px;">${escapeHTML(def.label)}</div>
              <div style="display:flex;justify-content:space-between;align-items:baseline;">
                <span class="v" style="font-size:15px;">${Number(t.skills[def.key])||0}</span>
                <span style="display:flex;align-items:center;gap:4px;">
                  <span class="muted" style="font-size:9px;">${def.attrs.map(a=>ATTR_ABBR[a]).join('/')}</span>
                  <button class="roll-btn" data-roll-skill="${def.key}" title="Tira ${escapeAttr(def.label)}">🎲</button>
                </span>
              </div>
            </div>
          `).join('')}
        </div>
        <div id="skill-roll-panel-${containerId}" style="margin-top:12px;"></div>
      `;
      document.getElementById('btn-edit-skills').onclick = ()=>{ editingSkills = true; renderSkillsCard(me, containerId, onChanged); };
      const gpSkillBtn = document.getElementById('btn-gp-skill');
      if(gpSkillBtn){
        gpSkillBtn.onclick = async ()=>{
          const key = document.getElementById('gp-skill-select').value;
          const def = SKILL_DEFS.find(d=>d.key===key);
          const max = skillMax(t, def);
          const statusEl = document.getElementById('gp-status');
          if(Number(t.skills[key])||0 >= max){ statusEl.style.color='var(--danger)'; statusEl.textContent = `${def.label} è già al massimo consentito (${max}).`; return; }
          t.skills[key] = (Number(t.skills[key])||0) + 1;
          t.unspentGrowthPoints = Number(t.unspentGrowthPoints||0) - 1;
          await saveMember(session.code, me);
          renderSkillsCard(me, containerId, onChanged);
        };
      }
      const gpAttrBtn = document.getElementById('btn-gp-attr');
      if(gpAttrBtn){
        gpAttrBtn.onclick = async ()=>{
          const attr = document.getElementById('gp-attr-select').value;
          const statusEl = document.getElementById('gp-status');
          const current = Number(t[attr])||0;
          const milestone = cachedProgression ? Number(cachedProgression.milestone||0) : 0;
          let cap = 5;
          if(milestone>=6) cap = 7; else if(milestone>=3) cap = 6;
          if(current >= cap){ statusEl.style.color='var(--danger)'; statusEl.textContent = `Tetto attuale per gli Attributi: ${cap} (Milestone ${milestone}).`; return; }
          t[attr] = current + 1;
          t.unspentGrowthPoints = Number(t.unspentGrowthPoints||0) - 3;
          await saveMember(session.code, me);
          renderSkillsCard(me, containerId, onChanged);
          renderTamerCard(me, siblingCardId(containerId,'tamer'), onChanged);
        };
      }
      cardEl.querySelectorAll('[data-roll-skill]').forEach(btn=>{
        btn.onclick = ()=>{ openSkillRollPanel(me, btn.getAttribute('data-roll-skill'), containerId, onChanged); };
      });
    } else {
      cardEl.innerHTML = `
        <div class="section-title">Skill — Modifica</div>
        <div class="muted" style="margin-bottom:10px;">Una Skill non può superare il valore più alto tra i suoi Attributi collegati.</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          ${SKILL_DEFS.map(def=>{
            const max = skillMax(t, def);
            return `
            <div class="field" style="margin-bottom:6px;">
              <label>${escapeHTML(def.label)} <span class="muted">(max ${max}, ${def.attrs.map(a=>ATTR_ABBR[a]).join('/')})</span></label>
              <input type="number" min="0" max="${max}" id="e-sk-${def.key}" value="${Number(t.skills[def.key])||0}" />
            </div>`;
          }).join('')}
        </div>
        <div class="row" style="margin-top:10px;">
          <button class="btn ghost" id="btn-cancel-skills">Annulla</button>
          <button class="btn solid" id="btn-save-skills">Salva</button>
        </div>
        <div class="muted" id="save-status-skills" style="margin-top:6px;"></div>
      `;
      document.getElementById('btn-cancel-skills').onclick = ()=>{ editingSkills = false; renderSkillsCard(me, containerId, onChanged); };
      document.getElementById('btn-save-skills').onclick = async ()=>{
        SKILL_DEFS.forEach(def=>{
          const el = document.getElementById('e-sk-'+def.key);
          if(!el) return;
          const max = skillMax(t, def);
          let val = Number(el.value)||0;
          if(val > max) val = max;
          if(val < 0) val = 0;
          me.tamer.skills[def.key] = val;
        });
        const newMaxWounds = 3+Number(me.tamer.skills.endurance||0);
        if(me.tamer.currentWounds > newMaxWounds) me.tamer.currentWounds = newMaxWounds;
        const ok = await saveMember(session.code, me);
        const st = document.getElementById('save-status-skills');
        st.style.color = ok ? 'var(--text-mute)' : 'var(--danger)';
        st.textContent = ok ? 'Salvato.' : ('Errore: '+(lastApiError||''));
        if(ok){ editingSkills = false; renderSkillsCard(me, containerId, onChanged); renderTamerCard(me, siblingCardId(containerId,'tamer'), onChanged); }
      };
    }
  }

  const TALENT_DEFS = [
    { attr:'agility', threshold:3, name:'Quick Step', text:'Quando prendi l\'Azione Reposition, guadagni +1 Successo al risultato finale.' },
    { attr:'agility', threshold:5, name:'Strike Fast', text:'Special Order "FULL SPEED AHEAD" (2 Azioni): il Digimon guadagna 1 Azione extra, da usare per Muovi o Movimento Difficile.', order:'strikeFast', cost:2, once:null },
    { attr:'body', threshold:3, name:'Bulk Up', text:'Quando prendi l\'Azione Reinforce, guadagni +1 Successo al risultato finale.' },
    { attr:'body', threshold:5, name:'Energy Burst', text:'Special Order "DON\'T WORRY YOU\'LL HEAL" (1 Azione): il Digimon recupera 1 Casella Ferita (2 se ha Ferite Temporanee).', order:'energyBurst', cost:1, once:null },
    { attr:'body', threshold:7, name:'Overpower', text:'Special Order "I\'M WITH YOU" (1 Azione, una volta a riposo): dopo un tiro Accuracy del Digimon, i 4 contano come Successi.', order:'overpower', cost:1, once:'rest' },
    { attr:'charisma', threshold:3, name:'Direct Team', text:'La penalità -2 per dirigere Digimon che non sono il tuo si riduce a -1.' },
    { attr:'charisma', threshold:5, name:'Swagger', text:'Special Order "HEY YOU" (1 Azione): applica [TAUNT] a un Nemico per 3 round.', order:'swagger', cost:1, once:null },
    { attr:'charisma', threshold:6, name:'Peak Performance', text:'Special Order "I BELIEVE IN YOU" (2 Azioni, una volta a combattimento): un Digimon alleato guadagna [BASTION 2] fino al tuo prossimo turno.', order:'peakPerformance', cost:2, once:'combat' },
    { attr:'charisma', threshold:7, name:'Revitalize', text:'Special Order "WAKE UP, DON\'T QUIT NOW" (2 Azioni, una volta a riposo): rianima un Digimon sconfitto.', order:'revitalize', cost:2, once:'rest' },
    { attr:'intelligence', threshold:3, name:'Experienced', text:'Guadagni +1 Punto Skill extra da spendere.' },
    { attr:'intelligence', threshold:5, name:'Calculated', text:'Special Order: puoi trasformare Bolster in +1 Successo invece di +2 dadi.' },
    { attr:'intelligence', threshold:6, name:'Signature Versatility', text:'Special Order "TIME FOR PLAN B" (Azione Libera, una volta a combattimento): il prossimo Attacco del Digimon conta come Signature Move.', order:'signatureVersatility', cost:0, once:'combat' },
    { attr:'intelligence', threshold:7, name:'Enemy Scan', text:'Special Order "I\'VE FOUND AN EXPLOIT" (2 Azioni, una volta a riposo): infliggi [DEBILITATE] a un Nemico con Potenza pari al suo Stage.', order:'enemyScan', cost:2, once:'rest' },
    { attr:'willpower', threshold:3, name:'Potential', text:'Guadagni 1 Punto Ispirazione Temporaneo all\'inizio di ogni sessione.' },
    { attr:'willpower', threshold:5, name:'Purify Partner', text:'Special Order "TOUGH IT OUT" (1 Azione): cura il Digimon da un Effetto Negativo, come [CLEANSE].', order:'purifyPartner', cost:1, once:null },
    { attr:'willpower', threshold:6, name:'Challenger', text:'Quando si tira l\'Iniziativa, il tuo Digimon guadagna Ferite Temporanee pari ai tuoi Successi Willpower + lo Stage più alto tra i nemici (max 5).' },
    { attr:'willpower', threshold:7, name:'Miracle', text:'Spendendo 7 IP puoi aggiungere/sottrarre Willpower+5 a un Check, Dodge o Accuracy Pool.', order:'miracle', cost:0, once:null },

    // --- Talent basati su Skill (soglia 3/5/7, stesso framework delle soglie Attributo) ---
    { attr:'evade', skill:true, threshold:3, name:'Avoiding Consequences', text:'Un Fallimento Critico su Check/Torment Check diventa Fallimento normale se sommando i punti in Evade si raggiungerebbe quel risultato.' },
    { attr:'evade', skill:true, threshold:5, name:'Tuck and Roll', text:'Una Evade fallita in combattimento può diventare un Successo, una volta a Rest.' },
    { attr:'evade', skill:true, threshold:7, name:'Quickening', text:'Special Order "YOU\'RE ONE STEP BEHIND" (Interrupt, una volta a combattimento): il Digimon schiva automaticamente un Attacco in arrivo, senza tirare (nessuna Quality che richieda una Evade riuscita si attiva).', order:'quickening', cost:0, once:'combat' },

    { attr:'precision', skill:true, threshold:3, name:'Busy Hands', text:'Crea senza tiro un oggetto utile durante un Rest, che dà un bonus a una Skill scelta pari ai punti in Precision sopra 2 (un solo uso, un oggetto per Rest).' },
    { attr:'precision', skill:true, threshold:5, name:'Aim Assist', text:'Dirigendo il Digimon per migliorare l\'Accuracy con 2 Azioni (Highest Attribute), il bonus al Direct sale di +2.' },
    { attr:'precision', skill:true, threshold:7, name:'Auto Hit', text:'Special Order "PUT 100% INTO THIS" (2 Azioni, una volta a combattimento): un Attacco (non Signature Move) colpisce automaticamente con successi pari all\'SV dell\'attaccante, senza tirare Accuracy né Dodge.', order:'autoHit', cost:2, once:'combat' },

    { attr:'stealth', skill:true, threshold:3, name:'Overlooked', text:'Si mimetizza senza tiro; in combattimento può muoversi/agire senza essere notato finché non colpisce un nemico. Individuabile con Awareness TN 9 + punti in Stealth.' },
    { attr:'stealth', skill:true, threshold:5, name:'Silent Movement', text:'Tamer e Digimon non fanno rumore né lasciano impronte camminando.' },
    { attr:'stealth', skill:true, threshold:7, name:'Vanish', text:'Special Order "NOW YOU SEE US" (1 Azione, una volta a combattimento): Tamer e Digimon spariscono dalla vista di un nemico scelto ([BLIND] fino al prossimo turno del Tamer, durata non riducibile). Non dichiarabile se sono già state usate altre azioni quel turno; il turno in cui la si usa, il Digimon può solo Move o Reposition.', order:'vanish', cost:1, once:'combat' },

    { attr:'athletics', skill:true, threshold:3, name:'Natural Explorer', text:'Usa Athletics o Agility (il più alto) per il Movement; ottiene Climb/Swim/Jump pari al Movement e ignora il Terreno Difficile. Può guidare alleati (numero = punti in Athletics) attraverso terreno ostile usando la propria Athletics, a patto che restino dietro di lui.' },
    { attr:'athletics', skill:true, threshold:5, name:'Experienced Step', text:'Reposition da 2 Azioni: +1 Successo al risultato finale.' },
    { attr:'athletics', skill:true, threshold:7, name:'Bullrush', text:'Special Order "THIS TRAIN WON\'T STOP" (1 Azione, una volta a combattimento): il Digimon ottiene Difficult Move come Azione Gratuita, e fino a fine turno lo stesso Difficult Move costa 1 Azione in meno (min. 1).', order:'bullrush', cost:1, once:'combat' },

    { attr:'endurance', skill:true, threshold:3, name:'No Pain, No Gain', text:'Un Check fallito (non Torment) può essere ritirato come Check di Endurance con l\'Attributo pertinente, un numero di volte pari ai punti in Endurance sopra 2 (si ricarica a ogni Rest).' },
    { attr:'endurance', skill:true, threshold:5, name:'Grit', text:'Può schivare gli attacchi con Endurance invece di Evade (subisce comunque min. 1 danno anche se supera il Check); se ridotto a 0 Wound Box resta a 1. Una volta a Rest.' },
    { attr:'endurance', skill:true, threshold:7, name:'Thick Skin', text:'Special Order "NO, YOU MOVE" (Interrupt, una volta a combattimento): il Digimon ignora uno spostamento forzato subito. Con 1 Azione extra, la fonte dello spostamento lo subisce a sua volta.', order:'thickSkin', cost:0, once:'combat' },

    { attr:'featsOfStrength', skill:true, threshold:3, name:'Heavy Force', text:'Usa Feats of Strength al posto di Precision per attaccare in combattimento. Una volta a Rest, può aggiungere ai Check di Body/Agility un bonus pari ai punti in Feats of Strength.' },
    { attr:'featsOfStrength', skill:true, threshold:5, name:'Joint Effort', text:'In un Check di squadra (Feats of Strength) col proprio Digimon, il Tamer aggiunge l\'SV del Digimon al tiro.' },
    { attr:'featsOfStrength', skill:true, threshold:7, name:'Adrenaline Hit', text:'Special Order "HAVE SOME OF THIS" (2 Azioni, una volta a combattimento): il Tamer lancia un oggetto (approvato dal GM) infliggendo Danno Unalterable pari al proprio SV e [STUN] fino al prossimo turno del Tamer.', order:'adrenalineHit', cost:2, once:'combat' },

    { attr:'manipulate', skill:true, threshold:3, name:'Planted Idea', text:'Se il Tamer supera un Check di Manipulate in Roleplay, può impiantare un\'idea minore e ragionevole in un PNG, per una durata in minuti pari ai propri punti in Manipulate. Una volta a Rest; un PNG può subirlo una sola volta tra un Rest e l\'altro.' },
    { attr:'manipulate', skill:true, threshold:5, name:'Fakeout', text:'Se il Tamer usa 2 Azioni per Dirigere il proprio Digimon migliorandone l\'Accuracy, e l\'Attacco con quel bonus manca, il bersaglio subisce -2 al Dodge invece di -1 da quell\'Attacco.' },
    { attr:'manipulate', skill:true, threshold:7, name:'Hacking Pride', text:'Special Order "YOU\'VE ALREADY LOST" (1 Azione, una volta a combattimento): un Direct negativo contro un nemico, penalità al prossimo Pool di Accuracy o Dodge a scelta del Tamer. Non si può usare Direct lo stesso turno.', order:'hackingPride', cost:1, once:'combat' },

    { attr:'perform', skill:true, threshold:3, name:'Endless Dream', text:'Senza tirare nulla, un\'esibizione del Tamer dà IP Temporanei agli alleati, pari ai propri punti in Performance sopra 2, da dividere come preferisce (non a se stesso). Max 2 IP Temporanei a testa. Una volta a Rest.' },
    { attr:'perform', skill:true, threshold:5, name:'Personal Cheerleader', text:'Un Digimon che beneficia del Direct del Tamer, tirando un Accuracy o Dodge Pool, può ritirare fino a 2 dadi (deve tenere il nuovo risultato).' },
    { attr:'perform', skill:true, threshold:7, name:'Distracting Gesture', text:'Special Order "HEY, OVER HERE" (Interrupt, una volta a combattimento): quando un nemico attacca un alleato, dimezza i dadi tirati dal nemico per l\'Attacco.', order:'distractingGesture', cost:0, once:'combat' },

    { attr:'persuasion', skill:true, threshold:3, name:'Charming Influence', text:'Se il Tamer supera un Check di Persuasion in Roleplay, può "usare il fascino": i PNG bersaglio diventano amichevoli per una durata in minuti pari ai propri punti in Persuasion. Una volta a Rest; un PNG può subirlo una sola volta tra un Rest e l\'altro.' },
    { attr:'persuasion', skill:true, threshold:5, name:'Be the Winners', text:'Con 1 Azione extra, il Tamer può dividere il bonus del Direct fra il proprio Digimon e un altro Digimon consenziente, senza penalità per Dirigere il Digimon altrui (il proprio Digimon deve sempre ricevere almeno +2).' },
    { attr:'persuasion', skill:true, threshold:7, name:'Next Order', text:'Special Order "WE CAN DO THIS, TOGETHER" (1 Azione, una volta a combattimento): concede i benefici di un Direct a 2 alleati consenzienti (proprio Digimon incluso), senza penalità per Digimon altrui.', order:'nextOrder', cost:1, once:'combat' },

    { attr:'decipherIntent', skill:true, threshold:3, name:'Cyber Sleuth', text:'Il giocatore può fare una domanda al GM su un\'azione immediatamente disponibile, e il GM deve rispondere se avrà esiti buoni, cattivi o entrambi. Usi pari ai punti in Decipher Intent sopra 2, recuperati a ogni Rest.' },
    { attr:'decipherIntent', skill:true, threshold:5, name:'Best Laid Plans', text:'Usando Hold Action per sommare Intelligence all\'Accuracy/Dodge del Digimon, +1 Successo al risultato finale. Un nemico che stava investigando/interrogando o mentendo apertamente è considerato Sorpreso se il Tamer entra in Combattimento contro di lui.' },
    { attr:'decipherIntent', skill:true, threshold:7, name:'Predictable', text:'Special Order "I ALREADY KNOW YOUR NEXT MOVE" (2 Azioni, una volta a combattimento): dichiara un Hold Action con Trigger su qualsiasi Azione (Intercede incluse) del nemico bersaglio.', order:'predictable', cost:2, once:'combat' },

    { attr:'survival', skill:true, threshold:3, name:'Glorious World', text:'Senza tirare nulla, il Tamer cucina un pasto che dà Wound Box Temporanee a chi lo mangia, pari ai propri punti in Survival sopra 2, fino al prossimo Rest. Un personaggio ne beneficia una sola volta tra un Rest e l\'altro.' },
    { attr:'survival', skill:true, threshold:5, name:'Trailblazer', text:'Il Tamer ha un innato senso dell\'orientamento: sa sempre dov\'è il nord e la strada esatta per tornare all\'ultimo insediamento civilizzato visitato.' },
    { attr:'survival', skill:true, threshold:7, name:'Survival Instinct', text:'Special Order "FLOW WITH IT" (Interrupt, una volta a combattimento): il Danno di un Attacco subito viene dimezzato dopo l\'Armor e nessun Danno Unalterable viene applicato.', order:'survivalInstinct', cost:0, once:'combat' },

    { attr:'knowledge', skill:true, threshold:3, name:'Academic Advice', text:'Aiutando in un Check di Teamwork, il Tamer può usare un Check di Knowledge al posto di quello richiesto. Su Successo, il bonus dato aumenta per ogni punto in Knowledge sopra 2.' },
    { attr:'knowledge', skill:true, threshold:5, name:'Living Encyclopedia', text:'Se un Check di Knowledge per ricordare informazioni avrebbe TN 15 o meno, il Tamer può Riuscire Criticamente in automatico. Una volta a Rest.' },
    { attr:'knowledge', skill:true, threshold:7, name:'Hacker\'s Memory', text:'Special Order "I KNOW ALL YOUR TRICKS" (2 Azioni, una volta a combattimento): contro un nemico già affrontato, +1 alla Potenza delle proprie Quality/Effetti basati su Stat Derivate contro di lui, oppure -1 a quelle del nemico.', order:'hackersMemory', cost:2, once:'combat' },

    { attr:'fortitude', skill:true, threshold:3, name:'Calming Influence', text:'Se un altro Tamer fallisce un Torment Check, questo Tamer può fargli ritirare il Check con un bonus pari ai propri punti in Fortitude. Se diventa un Successo, entrambi i Tamer guadagnano 1 IP. Una volta a Rest.' },
    { attr:'fortitude', skill:true, threshold:5, name:'Team Player', text:'Partecipando in Teamwork con alleati: se aiuta, l\'alleato può ritirare gli 1 del Check (tenendo il nuovo risultato); se è chi inizia il Check, può ignorare il Fallimento Critico di un alleato.' },
    { attr:'fortitude', skill:true, threshold:7, name:'Take the Lead', text:'Special Order "NOW FOCUS" (1 Azione, una volta a combattimento): +5 a un Check del proprio Digimon, anche dopo aver visto il risultato; usabile come Interrupt se il Check avviene fuori turno.', order:'takeTheLead', cost:1, once:'combat' },

    { attr:'bravery', skill:true, threshold:3, name:'Break the Chain', text:'Il Tamer ottiene un bonus ai Torment Check pari ai propri punti in Bravery. Se Calming Influence viene usato per ritirare un Torment Check con questo bonus, si prende il bonus più alto invece di sommarli.' },
    { attr:'bravery', skill:true, threshold:5, name:'With the Will', text:'Se il Tamer dovrebbe fare un Torment Check, il proprio Digimon può usare un\'Interrupt Action per trasformarlo in un Teamwork Check, tirando un Check di Bravery (usando DOS) per aiutare. Una volta a Rest.' },
    { attr:'bravery', skill:true, threshold:7, name:'Heroic Exemplar', text:'Special Order "SHOW THEM WHAT YOU\'RE MADE OF" (2 Azioni, una volta a combattimento): dopo un Attacco andato a segno, Digimon e tutti gli alleati ottengono [BASTION 1] (Durata 3).', order:'heroicExemplar', cost:2, once:'combat' },

    { attr:'awareness', skill:true, threshold:3, name:'Hyper Alert', text:'Senza tirare, il Tamer può usare un Check di Awareness al posto del Check normale per evitare pericoli a sorpresa. Il Digimon del Tamer ottiene un bonus all\'Iniziativa per ogni punto in Awareness sopra 2.' },
    { attr:'awareness', skill:true, threshold:5, name:'Danger Sense', text:'Quando il Digimon userebbe un\'Interrupt Action, il Tamer può spendere 1 Azione propria al posto del Digimon. Una volta a Rest.' },
    { attr:'awareness', skill:true, threshold:7, name:'Realization', text:'Special Order "I\'VE FIGURED IT OUT" (2 Azioni, una volta a combattimento): infligge [EXPLOIT 3] a un nemico, bypassando immunità da Overwrite o Resistance, fino a fine combattimento.', order:'realization', cost:2, once:'combat' }
  ];

  const SKILL_LABEL_BY_KEY = { evade:'EVADE', precision:'PREC', stealth:'STEALTH', athletics:'ATHL', endurance:'END', featsOfStrength:'FOS', manipulate:'MANIP', perform:'PERF', persuasion:'PERS', decipherIntent:'D.INTENT', survival:'SURV', knowledge:'KNOW', fortitude:'FORT', bravery:'BRAV', awareness:'AWARE' };
  function talentAbbr(t){ return t.skill ? (SKILL_LABEL_BY_KEY[t.attr] || t.attr) : ATTR_ABBR[t.attr]; }

  function computeUnlockedTalents(tamer){
    const cfg = campaignConfig();
    const stdIdx = { 3:0, 5:1, 6:2, 7:3 };
    return TALENT_DEFS.filter(t => {
      const idx = stdIdx[t.threshold];
      const effectiveThreshold = idx!==undefined ? cfg.thresholds[idx] : t.threshold;
      const value = t.skill ? Number((tamer.skills && tamer.skills[t.attr])||0) : Number(tamer[t.attr]||0);
      return value >= effectiveThreshold;
    });
  }

  // STAGE_CREATION spostato in js/digimon-card.js

  function renderTamerCard(me, containerId, onChanged){
    containerId = containerId || 'tamer-card';
    const cardEl = document.getElementById(containerId);
    if(!cardEl) return;
    const t = me.tamer;
    const maxW = 3 + Number(t.skills.endurance||0);
    if(!editingTamer){
      cardEl.innerHTML = `
        <div class="flex-between"><div class="section-title" style="margin:0;border:none;padding:0;">Scheda Tamer</div>
        <span><a href="player.html" target="_blank" class="btn ghost small" style="margin-right:4px;text-decoration:none;">✏️ Scheda Completa</a><button class="btn small" id="btn-edit-tamer">Modifica</button>${containerId && containerId.indexOf('m-tamer-')===0 ? `<button class="btn ghost small" id="btn-reset-tamer" style="margin-left:4px;color:var(--danger);border-color:var(--danger);">🗑️ Azzera</button>` : ''}</span></div>
        <div class="sheet-head" style="margin-top:12px;">
          ${tamerAvatarHTML(t, displayName(me))}
          <div class="info"><div class="nm">${escapeHTML(displayName(me))}</div><div class="tg">AGI ${t.agility} · BODY ${t.body} · CAR ${t.charisma} · INT ${t.intelligence} · WILL ${t.willpower}</div></div>
          <div style="margin-left:auto;text-align:center;">
            ${t.digiviceImageUrl
              ? `<img src="${escapeAttr(t.digiviceImageUrl)}" onerror="this.style.visibility='hidden'" style="width:44px;height:44px;object-fit:contain;border:1px solid var(--cyan-dim);border-radius:var(--radius);background:var(--panel-2);padding:3px;" />`
              : `<div style="width:44px;height:44px;display:flex;align-items:center;justify-content:center;border:1px dashed var(--line);border-radius:var(--radius);color:var(--text-mute);font-size:18px;">📟</div>`}
            <div class="muted" style="font-size:9px;margin-top:2px;">Digivice</div>
          </div>
        </div>
        ${barHTML('Caselle Ferita', t.currentWounds, maxW, 'hp', 'tamer-w-minus', 'tamer-w-plus')}
        <div class="divider"></div>
        <div class="flex-between" style="margin-bottom:8px;">
          <span class="muted">Inspiration Points</span>
          <span style="display:flex;align-items:center;gap:6px;">
            <span class="mono" style="color:var(--cyan);font-size:16px;">${t.inspirationPoints||0}</span>
            <button class="btn ghost small" id="ip-minus">−</button>
            <button class="btn ghost small" id="ip-plus">+</button>
          </span>
        </div>
        <div class="flex-between" style="margin-bottom:8px;">
          <span class="muted">Growth Points (non spesi)</span>
          <span style="display:flex;align-items:center;gap:6px;">
            <span class="mono" style="color:var(--cyan);font-size:16px;">${t.unspentGrowthPoints||0}</span>
            <button class="btn ghost small" id="gp-manual-minus">−</button>
            <button class="btn ghost small" id="gp-manual-plus">+</button>
          </span>
        </div>
        ${Number(t.tormentPenalty||0)!==0 ? `<div class="muted" style="color:var(--danger);margin-bottom:8px;">Penalità Torment attiva: ${t.tormentPenalty} su Tiri/bonus finché non fai un Rest.</div>` : ''}
        <div class="divider"></div>
        <div class="muted" style="margin-bottom:6px;">Aspects — tratti di personalità che danno bonus o penalità ai Check, a scelta del giocatore</div>
        <div class="roster-item" style="padding:8px;margin-bottom:6px;">
          <div class="flex-between"><b>Major</b><span class="mono">${t.majorAspect.usesLeft||0} usi</span></div>
          <div class="muted" style="font-size:10px;margin-top:2px;">Un tratto prominente della personalità (es. "Track Star: atletico ma competitivo") — dà +4 a un Check pertinente, o -4 se ti giochi il lato negativo.</div>
          <div class="sub" style="margin:4px 0;">${escapeHTML(t.majorAspect.text)||'(non impostato — scrivilo in "Modifica")'}</div>
          ${(t.majorAspect.usesLeft||0)>0 ? `<button class="btn small" id="btn-aspect-major-use">Usa (+4 / −4)</button>` : ''}
        </div>
        <div class="roster-item" style="padding:8px;margin-bottom:6px;">
          <div class="flex-between"><b>Minor</b><span class="mono">${t.minorAspect.usesLeft||0} usi</span></div>
          <div class="muted" style="font-size:10px;margin-top:2px;">Un tratto più sottile, meno evidente del Major — dà +2 a un Check pertinente, o -2 se ti giochi il lato negativo.</div>
          <div class="sub" style="margin:4px 0;">${escapeHTML(t.minorAspect.text)||'(non impostato — scrivilo in "Modifica")'}</div>
          ${(t.minorAspect.usesLeft||0)>0 ? `<button class="btn small" id="btn-aspect-minor-use">Usa (+2 / −2)</button>` : ''}
        </div>
        <div class="divider"></div>
        <div class="flex-between" style="margin-bottom:6px;"><span class="muted">Torments</span><button class="btn ghost small" id="btn-add-torment">+ Nuovo</button></div>
        <div id="torments-list">
          ${(t.torments||[]).length===0 ? '<div class="muted">Nessun Torment registrato.</div>' : t.torments.map((tor,ti)=>`
            <div class="roster-item" style="padding:8px;margin-bottom:6px;">
              <div class="flex-between"><b>${escapeHTML(tor.name)}</b><span class="mono">${tor.boxes}/10</span></div>
              <div class="flex-between" style="margin-top:6px;">
                ${tormentBoxesHTML(tor.boxes)}
                <span style="display:flex;gap:4px;">
                  <button class="btn ghost small" data-torment-minus="${ti}" style="padding:3px 9px;">−</button>
                  <button class="btn ghost small" data-torment-plus="${ti}" style="padding:3px 9px;">+</button>
                </span>
              </div>
              <div class="row" style="margin-top:6px;">
                <button class="btn ghost small" data-torment-remove="${ti}" style="flex:1;">Rimuovi</button>
                <button class="btn small" data-torment-check="${ti}" style="flex:1;" ${tor.usedThisRest?'disabled':''}>${tor.usedThisRest?'Già tentato (Rest)':'Torment Check'}</button>
              </div>
              <div class="muted" id="torment-result-${ti}" style="margin-top:4px;"></div>
            </div>
          `).join('')}
        </div>
        <div class="divider"></div>
        <div class="hud-frame" style="padding:10px;border-color:var(--cyan-dim);">
          <details ${computeUnlockedTalents(t).length>0?'open':''}>
            <summary class="mono" style="cursor:pointer;color:var(--cyan);font-size:12px;text-transform:uppercase;letter-spacing:0.05em;">⭐ Tamer Talents sbloccati — ${computeUnlockedTalents(t).length}</summary>
            <div style="margin-top:8px;">
              ${(()=>{ const unlocked = computeUnlockedTalents(t); return unlocked.length===0
                ? '<div class="muted">Nessun Talent ancora sbloccato (servono almeno 3 punti in un Attributo).</div>'
                : unlocked.map(tal=>`<div class="roster-item" style="padding:6px 8px;margin-bottom:4px;"><div class="flex-between"><b>${escapeHTML(tal.name)}</b><span class="tag">${talentAbbr(tal)} ${tal.threshold}+</span></div><div class="sub" style="margin-top:2px;">${escapeHTML(tal.text)}</div></div>`).join(''); })()}
            </div>
          </details>
        </div>
      `;
      document.getElementById('btn-edit-tamer').onclick = ()=>{ editingTamer = true; renderTamerCard(me, containerId, onChanged); };
      const resetTamerBtn = document.getElementById('btn-reset-tamer');
      if(resetTamerBtn){
        resetTamerBtn.onclick = async ()=>{
          if(!window.confirm(`Azzerare la Scheda Tamer di ${displayName(me)}? Attributi, Skill, Torments, Aspetti e Inventario torneranno a zero e potrà rifare la Creazione Guidata. L'azione non è reversibile.`)) return;
          if(!window.confirm(`Sei sicuro? Questa è l'ultima conferma prima di azzerare definitivamente la Scheda Tamer di ${displayName(me)}.`)) return;
          me.tamer = defaultTamer();
          await saveMember(session.code, me);
          await pushLog(session.code, { who:'Master', role:'gm', text: `La Scheda Tamer di ${displayName(me)} è stata azzerata dal Master.` });
          renderTamerCard(me, containerId, onChanged);
          if(onChanged) onChanged();
        };
      }
      document.getElementById('tamer-w-minus').onclick = async ()=>{ me.tamer.currentWounds = Math.max(0, me.tamer.currentWounds-1); await saveMember(session.code, me); renderTamerCard(me, containerId, onChanged); };
      document.getElementById('tamer-w-plus').onclick = async ()=>{ me.tamer.currentWounds = Math.min(maxW, me.tamer.currentWounds+1); await saveMember(session.code, me); renderTamerCard(me, containerId, onChanged); };
      document.getElementById('ip-minus').onclick = async ()=>{ me.tamer.inspirationPoints = Math.max(0, (me.tamer.inspirationPoints||0)-1); await saveMember(session.code, me); renderTamerCard(me, containerId, onChanged); };
      document.getElementById('ip-plus').onclick = async ()=>{ me.tamer.inspirationPoints = (me.tamer.inspirationPoints||0)+1; await saveMember(session.code, me); renderTamerCard(me, containerId, onChanged); };
      // Richiesta utente: correzione manuale dei Growth Points non spesi, visibile sia al Master
      // (dalla propria vista Roster, containerId "m-tamer-N") sia al giocatore sulla propria
      // Scheda Tamer -- stesso pattern di ip-minus/ip-plus qui sopra. Serve perché finora l'unico
      // modo per togliere Growth Points concessi per errore era il bottone "Annulla ultima
      // Milestone" nel pannello Progressione, che però annulla SOLO l'ultima Milestone registrata
      // (prog.lastMilestoneGrant) e sparisce se quella non risulta più disponibile (es. dopo un
      //'Correzione manuale' sui contatori di party, che non tocca affatto i Growth Points dei
      // singoli giocatori) -- lasciando il Master senza alcun modo di correggere il numero.
      document.getElementById('gp-manual-minus').onclick = async ()=>{ me.tamer.unspentGrowthPoints = Math.max(0, Number(me.tamer.unspentGrowthPoints||0)-1); await saveMember(session.code, me); renderTamerCard(me, containerId, onChanged); };
      document.getElementById('gp-manual-plus').onclick = async ()=>{ me.tamer.unspentGrowthPoints = Number(me.tamer.unspentGrowthPoints||0)+1; await saveMember(session.code, me); renderTamerCard(me, containerId, onChanged); };
      const majorBtn = document.getElementById('btn-aspect-major-use');
      if(majorBtn) majorBtn.onclick = async ()=>{
        const asPenalty = window.confirm('OK = usa come bonus (+4, consuma 1 uso). Annulla = invoca la penalità (-4, ripristina l\'uso e guadagni 1 IP).');
        if(asPenalty){
          me.tamer.majorAspect.usesLeft = Math.max(0,(me.tamer.majorAspect.usesLeft||0)-1);
          await pushLog(session.code, { who: displayName(me), role:'player', text: `Usa il Major Aspect "${me.tamer.majorAspect.text}" (+4 al prossimo Check).` });
        } else {
          me.tamer.majorAspect.usesLeft = 1;
          me.tamer.inspirationPoints = (me.tamer.inspirationPoints||0)+1;
          await pushLog(session.code, { who: displayName(me), role:'player', text: `Invoca la penalità del Major Aspect "${me.tamer.majorAspect.text}" (-4), ripristina l'uso e guadagna 1 IP.` });
        }
        await saveMember(session.code, me);
        renderTamerCard(me, containerId, onChanged);
        if(onChanged) onChanged();
      };
      const minorBtn = document.getElementById('btn-aspect-minor-use');
      if(minorBtn) minorBtn.onclick = async ()=>{
        const asPenalty = window.confirm('OK = usa come bonus (+2, consuma 1 uso). Annulla = invoca la penalità (-2, ripristina entrambi gli usi).');
        if(asPenalty){
          me.tamer.minorAspect.usesLeft = Math.max(0,(me.tamer.minorAspect.usesLeft||0)-1);
          await pushLog(session.code, { who: displayName(me), role:'player', text: `Usa il Minor Aspect "${me.tamer.minorAspect.text}" (+2 al prossimo Check).` });
        } else {
          me.tamer.minorAspect.usesLeft = 2;
          await pushLog(session.code, { who: displayName(me), role:'player', text: `Invoca la penalità del Minor Aspect "${me.tamer.minorAspect.text}" (-2), ripristina entrambi gli usi.` });
        }
        await saveMember(session.code, me);
        renderTamerCard(me, containerId, onChanged);
        if(onChanged) onChanged();
      };
      document.getElementById('btn-add-torment').onclick = async ()=>{
        const name = window.prompt('Nome del Torment:');
        if(!name) return;
        const boxesStr = window.prompt('Caselle segnate iniziali (0-10):', '4');
        const boxes = Math.max(0, Math.min(10, Number(boxesStr)||0));
        if(!me.tamer.torments) me.tamer.torments = [];
        me.tamer.torments.push({ name, boxes, usedThisRest:false });
        await saveMember(session.code, me);
        renderTamerCard(me, containerId, onChanged);
      };
      cardEl.querySelectorAll('[data-torment-remove]').forEach(btn=>{
        btn.onclick = async ()=>{
          me.tamer.torments.splice(Number(btn.getAttribute('data-torment-remove')),1);
          await saveMember(session.code, me);
          renderTamerCard(me, containerId, onChanged);
        };
      });
      cardEl.querySelectorAll('[data-torment-plus]').forEach(btn=>{
        btn.onclick = async ()=>{
          const tor = me.tamer.torments[Number(btn.getAttribute('data-torment-plus'))];
          tor.boxes = Math.min(10, (Number(tor.boxes)||0)+1);
          await saveMember(session.code, me);
          renderTamerCard(me, containerId, onChanged);
        };
      });
      cardEl.querySelectorAll('[data-torment-minus]').forEach(btn=>{
        btn.onclick = async ()=>{
          const tor = me.tamer.torments[Number(btn.getAttribute('data-torment-minus'))];
          tor.boxes = Math.max(0, (Number(tor.boxes)||0)-1);
          await saveMember(session.code, me);
          renderTamerCard(me, containerId, onChanged);
        };
      });
      cardEl.querySelectorAll('[data-torment-check]').forEach(btn=>{
        btn.onclick = async ()=>{
          const idx = Number(btn.getAttribute('data-torment-check'));
          const tor = me.tamer.torments[idx];
          if(!tor || tor.usedThisRest) return;
          const result = rollTormentCheck(tor.boxes);
          let outcomeText;
          if(result.outcome==='crit-success'){
            tor.boxes = Math.max(0, tor.boxes-1);
            me.tamer.inspirationPoints = (me.tamer.inspirationPoints||0)+1;
            tor.usedThisRest = true;
            outcomeText = 'Successo Critico! Cancella 1 Casella Torment e guadagna 1 IP.';
          } else if(result.outcome==='success'){
            me.tamer.inspirationPoints = (me.tamer.inspirationPoints||0)+1;
            tor.usedThisRest = true;
            outcomeText = 'Successo! Guadagna 1 IP.';
          } else if(result.outcome==='deep-crit-fail'){
            tor.boxes = Math.min(10, tor.boxes+1);
            me.tamer.tormentPenalty = -5;
            tor.usedThisRest = true;
            outcomeText = 'Fallimento Critico Profondo! +1 Casella Torment, penalità -5 fino al Rest.';
          } else if(result.outcome==='crit-fail'){
            me.tamer.tormentPenalty = -2;
            tor.usedThisRest = true;
            outcomeText = 'Fallimento Critico! Penalità -2 fino al Rest.';
          } else {
            outcomeText = 'Fallimento. Nessun effetto, si può ritentare più tardi.';
          }
          await saveMember(session.code, me);
          const resEl = document.getElementById('torment-result-'+idx);
          if(resEl) resEl.innerHTML = `${diceRowHTML(result.dice)} <b>${result.total}</b> vs TN ${result.tn} — ${outcomeText}`;
          await pushLog(session.code, { who: displayName(me), role:'roll', text: `Torment Check su "${tor.name}": 3d6[${result.dice.join(',')}]=${result.total} vs TN ${result.tn} → ${outcomeText}`, meta:{dice: result.dice} });
          if(tor.usedThisRest){ btn.disabled = true; btn.textContent = 'Già tentato (Rest)'; }
          if(onChanged) onChanged();
        };
      });
    } else {
      cardEl.innerHTML = `
        <div class="section-title">Scheda Tamer — Modifica</div>
        <div class="field"><label>URL Immagine (opzionale)</label><input type="text" id="e-t-img" value="${escapeAttr(t.imageUrl)}" placeholder="https://..." /></div>
        <div class="field"><label>URL Immagine Digivice (opzionale)</label><input type="text" id="e-t-digivice-img" value="${escapeAttr(t.digiviceImageUrl)}" placeholder="https://..." /></div>
        <div class="grid-stats">
          ${statBox('AGI','e-t-agility',t.agility)}
          ${statBox('BODY','e-t-body',t.body)}
          ${statBox('CAR','e-t-charisma',t.charisma)}
          ${statBox('INT','e-t-intelligence',t.intelligence)}
          ${statBox('WILL','e-t-willpower',t.willpower)}
        </div>
        <div class="muted" style="margin-top:8px;">Endurance e le altre Skill si gestiscono nella card "Skill" qui sotto.</div>
        <div class="divider"></div>
        <div class="field"><label>Major Aspect</label><input type="text" id="e-t-aspect-major" value="${escapeAttr(t.majorAspect.text)}" placeholder="es. Track Star..." /></div>
        <div class="field"><label>Minor Aspect</label><input type="text" id="e-t-aspect-minor" value="${escapeAttr(t.minorAspect.text)}" placeholder="es. Smarter Than They Act..." /></div>
        <div class="row" style="margin-top:10px;">
          <button class="btn ghost" id="btn-cancel-tamer">Annulla</button>
          <button class="btn solid" id="btn-save-tamer">Salva</button>
        </div>
        <div class="muted" id="save-status-tamer" style="margin-top:6px;"></div>
      `;
      document.getElementById('btn-cancel-tamer').onclick = ()=>{ editingTamer = false; renderTamerCard(me, containerId, onChanged); };
      document.getElementById('btn-save-tamer').onclick = async ()=>{
        ['agility','body','charisma','intelligence','willpower'].forEach(k=>{
          const el = document.getElementById('e-t-'+k);
          if(el) me.tamer[k] = Number(el.value)||0;
        });
        me.tamer.imageUrl = document.getElementById('e-t-img').value.trim();
        me.tamer.digiviceImageUrl = document.getElementById('e-t-digivice-img').value.trim();
        me.tamer.majorAspect.text = document.getElementById('e-t-aspect-major').value.trim();
        me.tamer.minorAspect.text = document.getElementById('e-t-aspect-minor').value.trim();
        SKILL_DEFS.forEach(def=>{
          const max = skillMax(me.tamer, def);
          const cur = Number(me.tamer.skills[def.key])||0;
          if(cur > max) me.tamer.skills[def.key] = max;
        });
        const newMax = 3+Number(me.tamer.skills.endurance||0);
        if(me.tamer.currentWounds > newMax) me.tamer.currentWounds = newMax;
        const ok = await saveMember(session.code, me);
        const st = document.getElementById('save-status-tamer');
        st.style.color = ok ? 'var(--text-mute)' : 'var(--danger)';
        st.textContent = ok ? 'Salvato.' : ('Errore: '+(lastApiError||''));
        if(ok){ editingTamer = false; renderTamerCard(me, containerId, onChanged); renderSkillsCard(me, siblingCardId(containerId,'skills'), onChanged); }
      };
    }
  }

  function renderInventoryCard(me, containerId){
    containerId = containerId || 'inventory-card';
    const cardEl = document.getElementById(containerId);
    if(!cardEl) return;
    const items = me.tamer.inventory || [];
    cardEl.innerHTML = `
      <div class="section-title">Inventario</div>
      ${items.length===0 ? '<div class="muted" style="margin-bottom:10px;">Nessun oggetto.</div>' : items.map((it,i)=>`
        <div class="roster-item" style="padding:8px 10px;">
          <div class="flex-between">
            <div><span class="name">${escapeHTML(it.name)}</span> <span class="tag" style="margin-left:6px;">x${Number(it.qty)||1}</span></div>
            <button class="btn ghost small" data-remove-item="${i}">Rimuovi</button>
          </div>
          ${it.desc ? `<div class="sub" style="margin-top:3px;">${escapeHTML(it.desc)}</div>` : ''}
        </div>
      `).join('')}
      <div class="divider"></div>
      <div class="row">
        <div class="field"><label>Oggetto</label><input type="text" id="inv-name" placeholder="es. Digivice" /></div>
        <div class="field" style="max-width:70px;"><label>Q.tà</label><input type="number" id="inv-qty" value="1" min="1" /></div>
      </div>
      <div class="field"><label>Descrizione (opz.)</label><input type="text" id="inv-desc" placeholder="cosa fa..." /></div>
      <button class="btn solid" id="btn-inv-add" style="width:100%;">Aggiungi Oggetto</button>
    `;
    cardEl.querySelectorAll('[data-remove-item]').forEach(btn=>{
      btn.onclick = ()=>{
        const idx = Number(btn.getAttribute('data-remove-item'));
        me.tamer.inventory.splice(idx,1);
        // Ridisegna subito, salva in background (vedi p-inv-add in player.html per lo stesso fix).
        renderInventoryCard(me, containerId);
        saveMember(session.code, me).then(ok=>{ if(!ok) renderInventoryCard(me, containerId); });
      };
    });
    document.getElementById('btn-inv-add').onclick = ()=>{
      const name = document.getElementById('inv-name').value.trim();
      if(!name) return;
      const qty = Number(document.getElementById('inv-qty').value)||1;
      const desc = document.getElementById('inv-desc').value.trim();
      me.tamer.inventory.push({ name, qty, desc });
      renderInventoryCard(me, containerId);
      saveMember(session.code, me).then(ok=>{ if(!ok) renderInventoryCard(me, containerId); });
    };
  }

  function renderSidebar(me, onChanged){
    const content = document.getElementById('sidebar-content');
    if(!content) return;
    ['scheda','inventario','bug'].forEach(t=>{
      const btn = document.getElementById('tab-'+t);
      if(btn) btn.classList.toggle('active', t===sidebarTab);
    });
    if(sidebarTab==='scheda'){
      content.innerHTML = `
        <div class="hud-frame card" id="tamer-card"></div>
        <div class="hud-frame card" id="skills-card"></div>
        <div class="hud-frame card" id="digimon-card"></div>
      `;
      renderTamerCard(me, undefined, onChanged);
      renderSkillsCard(me, undefined, onChanged);
      renderDigimonCard(me, undefined, onChanged, renderTamerCard);
    } else if(sidebarTab==='inventario'){
      content.innerHTML = `<div class="hud-frame card" id="inventory-card"></div>`;
      renderInventoryCard(me);
    } else if(sidebarTab==='bug'){
      content.innerHTML = `<div class="hud-frame card" id="bugreport-card"></div>`;
      renderBugReportCard();
    } else {
      sidebarTab = 'scheda';
      renderSidebar(me, onChanged);
    }
  }

  function renderBugReportCard(){
    const cardEl = document.getElementById('bugreport-card');
    if(!cardEl) return;
    cardEl.innerHTML = `
      <div class="section-title">🐞 Segnala un Bug</div>
      <div class="muted" style="margin-bottom:10px;">Hai trovato qualcosa che non funziona come dovrebbe? Descrivilo qui — arriva direttamente al Master.</div>
      <textarea id="bug-text" rows="4" placeholder="Cosa è successo? Cosa ti aspettavi succedesse invece?"></textarea>
      <button class="btn solid" id="btn-send-bug" style="width:100%;margin-top:8px;">Invia Segnalazione</button>
      <div class="muted" id="bug-status" style="margin-top:6px;"></div>
    `;
    document.getElementById('btn-send-bug').onclick = async ()=>{
      const text = document.getElementById('bug-text').value.trim();
      const statusEl = document.getElementById('bug-status');
      if(!text){ statusEl.style.color='var(--danger)'; statusEl.textContent = 'Scrivi qualcosa prima di inviare.'; return; }
      statusEl.style.color='var(--text-mute)'; statusEl.textContent = 'Invio...';
      const res = await createBugReport(session.code, session.username, text);
      if(res && res.ok){
        statusEl.style.color='var(--cyan)'; statusEl.textContent = 'Segnalazione inviata, grazie!';
        document.getElementById('bug-text').value = '';
      } else {
        statusEl.style.color='var(--danger)'; statusEl.textContent = 'Errore: ' + (lastApiError||'sconosciuto');
      }
    };
  }

  // renderDexPanel spostata in js/dex-admin.js

  // Scheda Digimon / Evoluzione (SIZE_DEFS, computeDerivedStats, evolutionsReadonlyHTML/EditableHTML,
  // attributeIconHTML/attributeLegendHTML/attributeBadgeHTML/splitCategoriesAttribute, epDigiviceHTML,
  // memoryUpgradeRanks, maxAttackSlots, evolutionCost/snapshotCurrentStatsToStage/showEvolutionTransition/
  // applyStageChange (con STAGE_CREATION), attackTagsPlain/attackTagsHTML, computeDpSpent,
  // qualitiesReadonlyHTML/EditableHTML, renderDigimonCard) spostati in js/digimon-card.js

  function openSkillRollPanel(me, skillKey, containerId, onChanged){
    const def = SKILL_DEFS.find(d=>d.key===skillKey);
    if(!def) return;
    const panel = document.getElementById('skill-roll-panel-'+containerId);
    if(!panel) return;
    let chosenAttr = def.attrs[0];
    const majorLeft = me.tamer.majorAspect ? (me.tamer.majorAspect.usesLeft||0) : 0;
    const minorLeft = me.tamer.minorAspect ? (me.tamer.minorAspect.usesLeft||0) : 0;
    const hasMiracle = computeUnlockedTalents(me.tamer).some(t=>t.order==='miracle');
    const ipAvailable = Number(me.tamer.inspirationPoints||0);
    const teamworkBonus = Number(me.tamer.teamworkBonus||0);
    const draw = ()=>{
      panel.innerHTML = `
        <div class="hud-frame" style="padding:10px;">
          <div class="section-title" style="margin:0 0 8px;border:none;padding:0;">Tira ${escapeHTML(def.label)}</div>
          ${def.attrs.length>1 ? `
            <div class="row" style="margin-bottom:8px;">
              ${def.attrs.map(a=>`<button class="btn small ${a===chosenAttr?'active':''}" data-pick-attr="${a}" style="flex:1;${a===chosenAttr?'background:rgba(53,232,201,0.15);border-color:var(--cyan);color:var(--cyan);':''}">${ATTR_ABBR[a]}</button>`).join('')}
            </div>
          ` : ''}
          <div class="field"><label>TN (opzionale, la decide il Master)</label><input type="number" id="roll-tn-${containerId}" placeholder="es. 15" /></div>
          <div class="muted" style="margin-bottom:6px;">Stunt (bonus del Master per un'azione descritta con stile)</div>
          <div class="row" style="margin-bottom:8px;">
            <div class="field" style="margin-bottom:0;"><label>Bonus (+0/+3)</label><input type="number" id="roll-stunt-bonus-${containerId}" value="0" min="0" max="3" /></div>
            <div class="field" style="margin-bottom:0;"><label>Dadi Extra (0-5)</label><input type="number" id="roll-stunt-dice-${containerId}" value="0" min="0" max="5" /></div>
          </div>
          ${teamworkBonus!==0 ? `<div class="muted" style="margin-bottom:8px;color:var(--cyan);">🤝 Bonus Teamwork attivo: ${teamworkBonus>0?'+':''}${teamworkBonus} (si applica automaticamente e si consuma con questo tiro)</div>` : ''}
          ${majorLeft>0 || minorLeft>0 ? `
            <div class="muted" style="margin-bottom:6px;">Aspects (applica bonus al tiro)</div>
            <div class="row" style="margin-bottom:8px;">
              ${majorLeft>0 ? `<label style="display:flex;align-items:center;gap:4px;font-size:11px;flex:1;"><input type="checkbox" id="roll-aspect-major-${containerId}" /> Major (+4, ${majorLeft} usi)</label>` : ''}
              ${minorLeft>0 ? `<label style="display:flex;align-items:center;gap:4px;font-size:11px;flex:1;"><input type="checkbox" id="roll-aspect-minor-${containerId}" /> Minor (+2, ${minorLeft} usi)</label>` : ''}
            </div>
          ` : ''}
          ${hasMiracle && ipAvailable>=7 ? `
            <label style="display:flex;align-items:center;gap:4px;font-size:11px;margin-bottom:8px;"><input type="checkbox" id="roll-miracle-${containerId}" /> Miracle: +Willpower+5 (costa 7 IP, hai ${ipAvailable})</label>
          ` : ''}
          <button class="btn solid" id="roll-confirm-${containerId}" style="width:100%;">Tira 3d6</button>
          <div id="roll-result-${containerId}" style="margin-top:10px;"></div>
        </div>
      `;
      if(def.attrs.length>1){
        panel.querySelectorAll('[data-pick-attr]').forEach(b=>{
          b.onclick = ()=>{ chosenAttr = b.getAttribute('data-pick-attr'); draw(); };
        });
      }
      document.getElementById('roll-confirm-'+containerId).onclick = async ()=>{
        const tnVal = document.getElementById('roll-tn-'+containerId).value;
        const attrVal = me.tamer[chosenAttr];
        const digimonBonus = prodigiousSkillBonus(me, def);
        const skillVal = Number(me.tamer.skills[skillKey]||0) + digimonBonus;
        const stuntBonus = Math.max(0, Math.min(3, Number(document.getElementById('roll-stunt-bonus-'+containerId).value)||0));
        const stuntDice = Math.max(0, Math.min(5, Number(document.getElementById('roll-stunt-dice-'+containerId).value)||0));
        const { dice, total: baseTotal } = rollSkillCheck(attrVal, skillVal, stuntDice);
        let total = baseTotal + stuntBonus;
        let aspectNote = '';
        if(digimonBonus>0) aspectNote += ` +${digimonBonus} dal Digimon (Prodigious Skill/Mind Over Matter)`;
        if(stuntDice>0) aspectNote += ` +Stunt (${stuntDice} dadi extra, tenuti i 3 migliori)`;
        if(stuntBonus>0) aspectNote += ` +${stuntBonus} Stunt`;
        if(teamworkBonus!==0){
          total += teamworkBonus;
          aspectNote += ` ${teamworkBonus>0?'+':''}${teamworkBonus} Teamwork`;
          me.tamer.teamworkBonus = 0;
        }
        const majorBox = document.getElementById('roll-aspect-major-'+containerId);
        const minorBox = document.getElementById('roll-aspect-minor-'+containerId);
        const miracleBox = document.getElementById('roll-miracle-'+containerId);
        if(majorBox && majorBox.checked){
          total += 4;
          me.tamer.majorAspect.usesLeft = Math.max(0,(me.tamer.majorAspect.usesLeft||0)-1);
          aspectNote += ` +4 Major Aspect (${me.tamer.majorAspect.text})`;
        }
        if(minorBox && minorBox.checked){
          total += 2;
          me.tamer.minorAspect.usesLeft = Math.max(0,(me.tamer.minorAspect.usesLeft||0)-1);
          aspectNote += ` +2 Minor Aspect (${me.tamer.minorAspect.text})`;
        }
        if(miracleBox && miracleBox.checked && Number(me.tamer.inspirationPoints||0)>=7){
          const bonus = me.tamer.willpower + 5;
          total += bonus;
          me.tamer.inspirationPoints -= 7;
          aspectNote += ` +${bonus} Miracle (-7 IP)`;
        }
        await saveMember(session.code, me);
        const verdict = evaluateVsTN(total, tnVal, dice);
        const resEl = document.getElementById('roll-result-'+containerId);
        resEl.innerHTML = `${diceRowHTML(dice)}<span class="roll-total">${total}</span>${verdict?`<span class="roll-verdict ${verdict.cls}">${verdict.label}</span>`:''}`;
        const logText = `tira ${def.label} (${ATTR_ABBR[chosenAttr]}+Skill): 3d6[${dice.join(',')}] + ${attrVal} + ${skillVal}${aspectNote} = ${total}` + (verdict ? ` vs TN ${tnVal} → ${verdict.label}` : '');
        await pushLog(session.code, { who: displayName(me), role:'roll', text: logText, meta: { dice, total, verdict: verdict?verdict.label:null } });
        if(onChanged) onChanged();
      };
    };
    draw();
  }

  async function tryParseRollShortcut(raw, me){
    const m = raw.match(/^\/(tira|r)\s+(.+)$/i);
    if(!m) return null;
    let rest = m[2].trim();
    let tn = null;
    let aspectWanted = null;
    let parts = rest.split(/\s+/);
    let lastWord = parts[parts.length-1].toLowerCase();
    if(['major','maggiore'].includes(lastWord)){ aspectWanted='major'; parts = parts.slice(0,-1); lastWord = parts[parts.length-1]||''; }
    else if(['minor','minore'].includes(lastWord)){ aspectWanted='minor'; parts = parts.slice(0,-1); lastWord = parts[parts.length-1]||''; }
    if(/^\d+$/.test(lastWord)){
      tn = Number(lastWord);
      parts = parts.slice(0,-1);
    }
    rest = parts.join(' ');
    const query = rest.trim().toLowerCase();
    if(!query) return { text: `⚠ comando non riconosciuto: "${rest}". Usa /tira <NomeSkill|Accuracy|Dodge|Health> [TN] [major|minor]`, dice:null };

    const poolMap = { 'accuracy':'baseAccuracy', 'acc':'baseAccuracy', 'dodge':'baseDodge', 'schivata':'baseDodge', 'health':'baseHealth', 'hp':'baseHealth', 'salute':'baseHealth' };
    if(poolMap[query]){
      const statKey = poolMap[query];
      const { dice, successes } = rollPool(me.digimon[statKey]);
      return {
        dice, isPool:true, resultLabel: `${successes} successi`, verdict:null,
        text: `tira Pool Check ${query.toUpperCase()} (${me.digimon[statKey]}d6): [${dice.join(',')}] → ${successes} successi`
      };
    }

    const def = SKILL_DEFS.find(d=>d.label.toLowerCase()===query || d.label.toLowerCase().startsWith(query) || query.startsWith(d.label.toLowerCase()));
    if(def){
      const attr = def.attrs[0];
      const attrVal = me.tamer[attr];
      const digimonBonus = prodigiousSkillBonus(me, def);
      const skillVal = Number(me.tamer.skills[def.key]||0) + digimonBonus;
      const { dice, total: baseTotal } = rollSkillCheck(attrVal, skillVal);
      let total = baseTotal;
      let aspectNote = digimonBonus>0 ? ` +${digimonBonus} dal Digimon (Prodigious Skill/Mind Over Matter)` : '';
      if(aspectWanted==='major' && me.tamer.majorAspect && (me.tamer.majorAspect.usesLeft||0)>0){
        total += 4;
        me.tamer.majorAspect.usesLeft -= 1;
        aspectNote = ` +4 Major Aspect (${me.tamer.majorAspect.text})`;
        await saveMember(session.code, me);
      } else if(aspectWanted==='minor' && me.tamer.minorAspect && (me.tamer.minorAspect.usesLeft||0)>0){
        total += 2;
        me.tamer.minorAspect.usesLeft -= 1;
        aspectNote = ` +2 Minor Aspect (${me.tamer.minorAspect.text})`;
        await saveMember(session.code, me);
      } else if(aspectWanted){
        aspectNote = ` (nessun uso di Aspect ${aspectWanted} disponibile, ignorato)`;
      }
      const verdict = evaluateVsTN(total, tn, dice);
      return {
        dice, isPool:false, resultLabel: String(total), verdict,
        text: `tira ${def.label} (${ATTR_ABBR[attr]}+Skill): 3d6[${dice.join(',')}] + ${attrVal} + ${skillVal}${aspectNote} = ${total}` + (verdict ? ` vs TN ${tn} → ${verdict.label}` : '')
      };
    }
    return { text: `⚠ comando non riconosciuto: "${rest}". Usa /tira <NomeSkill|Accuracy|Dodge|Health> [TN] [major|minor]`, dice:null };
  }

  function statBox(label, id, val){
    return `<div class="stat-box"><div class="l">${label}</div><input type="number" min="0" max="10" id="${id}" value="${val}" /></div>`;
  }
