// js/master-panels.js
// Pannelli usati SOLO dalla Vista Master, estratti da index.html (richiesta Rocco 2026-10-28,
// "pulizia tecnica": index.html supera le 8.000 righe). Spostati senza modifiche:
//   - renderMountingTN (+ il suo stato mountingTNState) -> Strumenti > Regole, "🪜 Mounting TN"
//   - renderGMReference -> Strumenti > Regole, "📚 Compendio Master"
//   - renderEncounterBalance -> Battaglia, "Bilanciamento Incontro"
// Nessuno dei tre usa funzioni o variabili interne alla IIFE di index.html: leggono solo lo stato
// globale (js/store.js: cachedCombat, cachedRoster, cachedDex...) e gli helper globali di js/util.js
// ecc. Script classico, caricato PRIMA del blocco <script> principale come gli altri moduli: renderMaster
// li richiama risalendo la catena di scope fino al globale, esattamente come prima.

let mountingTNState = { modifier: 0, step: 0, log: [] };

function renderMountingTN(){
  const cardEl = document.getElementById('mounting-tn-card');
  if(!cardEl) return;
  const st = mountingTNState;
  cardEl.innerHTML = `
    <div class="section-title">🪜 Mounting TN</div>
    <div class="muted" style="margin-bottom:8px;">Per sequenze di Check concatenati (8.03c). Ogni TN sale di uno scaglione rispetto alla precedente — decidilo tu passo per passo. Il modificatore qui sotto si somma al PROSSIMO tiro del giocatore.</div>
    <div class="flex-between" style="margin-bottom:8px;">
      <span class="muted">Passo attuale</span><span class="mono">${st.step}</span>
    </div>
    <div class="flex-between" style="margin-bottom:10px;">
      <span class="muted">Modificatore per il prossimo tiro</span>
      <span class="mono" style="font-size:18px;color:${st.modifier>=0?'var(--cyan)':'var(--danger)'};">${st.modifier>=0?'+':''}${st.modifier}</span>
    </div>
    <div class="muted" style="margin-bottom:6px;">Registra l'esito del tiro appena fatto:</div>
    <div class="row">
      <button class="btn small" id="mtn-crit-success" style="flex:1;">Succ. Critico (+5)</button>
      <button class="btn small" id="mtn-success" style="flex:1;">Successo (+1)</button>
    </div>
    <div class="row" style="margin-top:6px;">
      <button class="btn ghost small" id="mtn-fail" style="flex:1;">Fallimento (-1)</button>
      <button class="btn ghost small" id="mtn-crit-fail" style="flex:1;">Fall. Critico (-5)</button>
    </div>
    <button class="btn ghost" id="mtn-reset" style="width:100%;margin-top:8px;">↺ Nuova Sequenza</button>
    <div class="muted" style="margin-top:8px;max-height:80px;overflow-y:auto;">${st.log.map(l=>`<div>${l}</div>`).join('')}</div>
  `;
  const record = (label, delta)=>{
    st.step += 1;
    st.log.push(`Passo ${st.step}: ${label} → modificatore prossimo tiro: ${st.modifier+delta>=0?'+':''}${st.modifier+delta}`);
    st.modifier += delta;
    renderMountingTN();
  };
  document.getElementById('mtn-crit-success').onclick = ()=>record('Successo Critico', 5);
  document.getElementById('mtn-success').onclick = ()=>record('Successo', 1);
  document.getElementById('mtn-fail').onclick = ()=>record('Fallimento', -1);
  document.getElementById('mtn-crit-fail').onclick = ()=>record('Fallimento Critico', -5);
  document.getElementById('mtn-reset').onclick = ()=>{ mountingTNState = { modifier:0, step:0, log:[] }; renderMountingTN(); };
}

function renderGMReference(){
  const el = document.getElementById('gm-reference-card');
  if(!el) return;
  el.innerHTML = `
    <div class="section-title">📚 Compendio Master (Cap. 1.04-1.06)</div>
    <details style="margin-bottom:8px;">
      <summary style="cursor:pointer;color:var(--cyan);">🔧 Digivice Design (1.04)</summary>
      <div class="muted" style="margin-top:6px;">Spunti per personalizzare i Digivice del party (non esaustivo, inventane pure altri):</div>
      <ul class="muted" style="margin:6px 0 0 18px;padding:0;">
        <li><b>Reader (Booster/Card)</b>: legge Card/Chip che danno bonus temporanei.</li>
        <li><b>Data Scanner</b>: scansiona e archivia dati sui Digimon incontrati.</li>
        <li><b>Mappa Digitale</b>: mostra una mappa dell'area (raggio da definire).</li>
        <li><b>Comunicatore</b>: voce o video tra Digivice (distanza da definire).</li>
        <li><b>Evolution Pause</b>: blocca temporaneamente l'Evoluzione di un Digimon, facendolo regredire di uno Stage per una Durata a scelta del Master.</li>
        <li><b>Digi-Gate</b>: apre un varco tra Mondo Reale e Digitale.</li>
      </ul>
    </details>
    <details style="margin-bottom:8px;">
      <summary style="cursor:pointer;color:var(--cyan);">⚖️ Opposed Rolls (1.06)</summary>
      <div class="muted" style="margin-top:6px;">Quando due personaggi si contrappongono fuori dal Combattimento standard, scegli una coppia "Attaccante" e una "Difensore" in base alla scena — chi tira più alto vince. Esempi guida:</div>
      <ul class="muted" style="margin:6px 0 0 18px;padding:0;">
        <li><b>Confronto di forza pura</b> (sollevare, afferrare): stessa Skill per entrambi (es. Feats of Strength, o CPU per i Digimon).</li>
        <li><b>Furtività vs Percezione</b>: Agilità+Stealth (RAM) contro Volontà+Awareness (BIT).</li>
        <li><b>Distrarre e intrufolarsi</b>: 2 tiri — Carisma+Perform (RAM) vs Volontà+Decipher Intent (BIT), poi Agilità+Stealth (RAM) vs Volontà+Awareness (BIT).</li>
        <li><b>Persuadere onestamente</b>: Carisma+Persuasion (BIT) vs Volontà pura (BIT).</li>
        <li><b>Manipolare/ingannare</b>: Carisma+Manipulate (BIT) vs Volontà+Decipher Intent (BIT).</li>
      </ul>
      <div class="muted" style="margin-top:6px;">Non esistono coppie fisse per ogni caso: valuta sempre la scena. In generale c'è un lato "Attaccante" e uno "Difensore".</div>
    </details>
    <details>
      <summary style="cursor:pointer;color:var(--cyan);">🏷️ Families, Attributes, Types (1.05)</summary>
      <div class="muted" style="margin-top:6px;"><b>Attributi</b>: Vaccine, Data, Virus, Free, Variable (usati da Attribute Advantage, Variant 2.05c — vedi sotto).</div>
      <div class="muted" style="margin-top:4px;"><b>Famiglie</b> (field): Nature Spirits, Deep Savers, Wind Guardians, Metal Empire, Virus Busters, Nightmare Soldiers, Dragon's Roar, Jungle Troopers, Dark Area, Unknown.</div>
      <div class="muted" style="margin-top:4px;"><b>Tipi</b>: categorie narrative libere (Drago, Bestia, Demone, Angelo, Insetto, Rettile, ecc.) usate soprattutto da Slayer e Naturewalk per il flavor.</div>
      <div class="muted" style="margin-top:4px;">Puoi taggare queste categorie su ogni Digimon nel Digidex, campo "Categorie" (es. "Deva, Angelo, Vaccine").</div>
    </details>
  `;
}

function renderEncounterBalance(){
  const cardEl = document.getElementById('encounter-balance-card');
  if(!cardEl) return;
  const milestone = cachedProgression ? Number(cachedProgression.milestone||0) : 0;
  const partySize = cachedRoster.filter(m=>m.role==='player').length || 1;
  cardEl.innerHTML = `
    <div class="section-title">Bilanciamento Incontro</div>
    <div class="muted" style="margin-bottom:8px;">Formula del manuale (Game Master's Index 3.0): (DP Base Default Range + Milestone×4 + Bonus Difficoltà) × N. Giocatori.</div>
    <div class="row">
      <div class="field"><label>DP Base Default Range</label><input type="number" id="eb-basedp" value="10" min="0" /></div>
      <div class="field"><label>Difficoltà</label>
        <select id="eb-difficulty">
          <option value="0">Easy (+0)</option>
          <option value="5" selected>Normal (+5)</option>
          <option value="10">Hard (+10)</option>
        </select>
      </div>
    </div>
    <div class="row">
      <div class="field"><label>Milestone Party</label><input type="number" id="eb-milestone" value="${milestone}" min="0" /></div>
      <div class="field"><label>N. Giocatori</label><input type="number" id="eb-partysize" value="${partySize}" min="1" /></div>
    </div>
    <div class="muted" style="margin:8px 0;">Budget Incontro: <span class="mono" id="eb-budget" style="color:var(--cyan);font-size:16px;">0</span> DP</div>
    <div class="divider"></div>
    <div class="muted" style="margin-bottom:6px;">Distribuzione tra Nemici</div>
    <div class="row">
      <div class="field"><label>N. Nemici</label><input type="number" id="eb-enemies" value="3" min="1" /></div>
      <div class="field"><label>Stage sopra Default Range (ognuno)</label><input type="number" id="eb-stagesabove" value="0" min="0" /></div>
    </div>
    <div class="muted" id="eb-result" style="margin-top:6px;"></div>
    <div class="divider"></div>
    <div class="section-title" style="font-size:13px;">Tipo di Boss (GM Index 3.03)</div>
    <div class="field"><label>Struttura</label>
      <select id="eb-bosstype">
        <option value="">Incontro normale (nessuna struttura Boss)</option>
        <option value="pool">Opzione 1: Big Scary DP Pool</option>
        <option value="template">Opzione 2: Boss Template</option>
        <option value="tagteam">Opzione 3: Tag Team Boss</option>
        <option value="raid">Opzione 4: Raid Boss</option>
        <option value="multistage">Opzione 5: Multi-Stage Boss</option>
      </select>
    </div>
    <div class="muted" id="eb-bosstype-desc" style="margin-top:6px;"></div>
    <div class="divider"></div>
    <div class="section-title" style="font-size:13px;">⚠️ Qualities da usare con cautela sui Nemici (GM Index 3.02)</div>
    <div class="muted" style="margin-top:4px;">
      <b>Second Wind</b>: non darlo a Nemici con tanti Wound Boxes (li trasforma in mini-Boss "a fasi"); meglio su Digimon con Health basso.<br/>
      <b>Brave Heart</b>: solo su UN Nemico alla volta, e solo se il suo Armor di base è basso (mai come Stat più alta).<br/>
      <b>Combat Monster</b>: tieni il Damage del Nemico basso/dumpato (mai come Stat più alta), specie con i Wound Boxes più alti tipici dei Nemici.<br/>
      <b>Resistant</b>: solo se il Nemico è in inferiorità numerica; evitalo su ruoli da tank/protettore.<br/>
      <b>Huge Power</b>: solo se l'Accuracy non è la Stat più alta; evita di sommarci Weapon.<br/>
      <b>Zoner: Bombardment</b>: SOLO se il Nemico ha Alleati in combattimento, altrimenti è Danno gratuito senza rischio.
    </div>
  `;
  const bossDescs = {
    '': '',
    pool: 'Nemico molto resistente con DP Pool tra il 10% e il 100% in più della media dei giocatori, investito soprattutto in Wound Boxes/Armor. Colpisce piano ma dura a lungo. Attenzione a non esagerare: un singolo nemico verrà comunque sopraffatto dal numero di Azioni del gruppo.',
    template: 'Un solo Nemico ma con un Turno e un Pool di Ferite separato per ogni giocatore (es. Giocatore 1 ↔ Pool 1): ogni giocatore lo affronta "per conto suo" finché il suo Pool non è esaurito. Il lato debole è che il Boss può occupare un solo spazio alla volta e deve scegliere se restare Ranged, concentrarsi su un bersaglio, o spendere Azioni per spostarsi.',
    tagteam: 'Crea un numero di Digimon nemici pari ai giocatori, tutti considerati "Boss": qualsiasi giocatore può attaccare chiunque di loro (diversamente dal Boss Template). Più lungo da preparare, ma molto efficace per rallentare o fermare l\'intero gruppo.',
    raid: 'Mix dei tre precedenti: +50% DP rispetto alla media giocatori, investito soprattutto in Health; dagli Resistenza (non Immunità) a molti Effetti negativi. Ha una Raid Action a inizio Iniziativa che impiega un round intero per attivarsi: i giocatori possono fare un Check Decipher Intent (Azione Interrupt, TN 10+Stage Boss+Milestone Party) per capirne gli effetti e adattarsi prima che scatti.',
    multistage: 'Il Boss attraversa più Fasi (di solito via Evoluzione o Mode Change), ognuna trattata come un nuovo Combattimento: Recovery Check rapido a ogni cambio fase, si azzerano gli usi "per Combattimento" ma NON si ottengono i benefici di un Riposo. Rendi le prime Fasi più facili delle successive.'
  };
  const bossSel = document.getElementById('eb-bosstype');
  bossSel.addEventListener('change', ()=>{ document.getElementById('eb-bosstype-desc').textContent = bossDescs[bossSel.value] || ''; });
  const recalc = ()=>{
    const baseDp = Number(document.getElementById('eb-basedp').value)||0;
    const diff = Number(document.getElementById('eb-difficulty').value)||0;
    const ms = Number(document.getElementById('eb-milestone').value)||0;
    const ps = Number(document.getElementById('eb-partysize').value)||1;
    const budget = (baseDp + ms*4 + diff) * ps;
    document.getElementById('eb-budget').textContent = budget;
    const enemies = Number(document.getElementById('eb-enemies').value)||1;
    const stagesAbove = Number(document.getElementById('eb-stagesabove').value)||0;
    const spentOnEntry = enemies*10 + enemies*stagesAbove*20;
    const remaining = budget - spentOnEntry;
    const perEnemy = Math.floor(remaining / enemies);
    const resEl = document.getElementById('eb-result');
    resEl.style.color = remaining<0 ? 'var(--danger)' : 'var(--text-mute)';
    resEl.innerHTML = `Costo ingresso Nemici: ${spentOnEntry} DP (10/nemico + 20/Stage sopra il range).<br/>DP Bonus rimanenti da distribuire: <b>${remaining}</b> (~${perEnemy} DP a testa, min. 3 in Health ciascuno).`;
  };
  cardEl.querySelectorAll('input, select').forEach(el=> el.addEventListener('input', recalc));
  recalc();
}
