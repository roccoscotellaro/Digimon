// js/chat-log-engine.js
// Motore condiviso del Registro (Chat Generale/Privata/Sottogruppi): stato dei filtri "Storico per
// Settore", le API di log/sottogruppi, le funzioni di posizione/location-key, il rendering dei
// messaggi (logHTML/formatLogText/mentionChipHTML/mentionImageOnlyHTML) e la moderazione
// (openEditLogModal/attachLogModeration — inclusa la logica di evasione dei tiri richiesti dal
// Master, che usa CAMPAIGN_LEVELS/SKILL_DEFS/evaluateVsTN/ATTR_ABBR/prodigiousSkillBonus di
// js/rules.js).
//
// Script classico (non un modulo ES), caricato PRIMA del blocco <script> principale in index.html,
// DOPO js/store.js, js/api.js, js/util.js, js/dice.js, js/rules.js, js/encounters.js,
// js/npc-registry.js e js/chat-composer.js (di cui usa rispettivamente cachedRoster/cachedScene/
// cachedDex/cachedLog/cachedSubgroups/cachedMasterPrivateLog/cachedSubgroupLog/session/
// cachedProgression, apiGet/apiPost/apiPut/apiDelete/lastApiError, escapeHTML/escapeAttr/
// displayName, DIE_FACES/rollPool/rollSkillCheck, SKILL_DEFS/evaluateVsTN/ATTR_ABBR/
// prodigiousSkillBonus, encName, loadSavedNpcs/rememberNpc, speakAsFieldHTML/attachSpeakAsButton).
//
// attachLogModeration/openEditLogModal NON chiamano più refreshLiveParts() direttamente (quella
// funzione resta nella IIFE di index.html, troppo centrale per diventare globale): al suo posto
// ricevono un parametro `onChanged` opzionale, invocato al posto della vecchia chiamata diretta.
// Ogni punto di index.html che chiama attachLogModeration passa `refreshLiveParts` come 6°
// argomento (vedi i call site in renderPlayer/renderMaster) — stesso identico comportamento di
// prima, solo iniettato dall'esterno invece che agganciato per nome.
//
// playerChatMode/playerActiveSubgroupId sono stati promossi qui da variabili locali alla IIFE a
// stato globale (esattamente come i filtri "Storico per Settore" più sotto): index.html li legge
// e scrive ancora, direttamente come prima, ma ora la lettura funziona anche da attachLogModeration
// (che vive fuori dalla IIFE) per decidere in che canale rispondere a un tiro richiesto.

  let playerChatMode = 'public';

  // Iniettato una sola volta: animazione "pulse" per il bottone "Evolvi ora" nel messaggio con cui
  // il Master sblocca l'Evoluzione (vedi logHTML più sotto, marcatore ::EVOUNLOCK::) — serve a far
  // notare al giocatore che c'è un'azione da fare, non solo un avviso testuale.
  if(typeof document!=='undefined' && !document.getElementById('evo-pulse-style')){
    const evoPulseStyleEl = document.createElement('style');
    evoPulseStyleEl.id = 'evo-pulse-style';
    evoPulseStyleEl.textContent = `
      @keyframes evo-pulse-glow {
        0%, 100% { box-shadow: 0 0 0 0 rgba(255,176,32,0.55); transform: scale(1); }
        50% { box-shadow: 0 0 0 7px rgba(255,176,32,0); transform: scale(1.04); }
      }
      .evo-pulse-btn { animation: evo-pulse-glow 1.6s ease-in-out infinite; }
    `;
    document.head.appendChild(evoPulseStyleEl);
  }

  let animatedLogIds = new Set();
  // Selettore "Storico per Settore" (vedi locationFilterSelectHTML/filterByLocation): null =
  // segue automaticamente la posizione attuale del gruppo; altrimenti una chiave location
  // esplicita scelta dalla persona, oppure "__all__" per tutto lo storico. Una variabile per
  // ciascuna chat perché sono superfici indipendenti (una persona potrebbe voler rivedere un
  // Settore vecchio in Privata mentre la Generale segue quello attuale).
  let publicLocationFilter = null;
  let privateLocationFilter = null;
  let subgroupLocationFilter = {}; // chiave = id del sottogruppo
  let masterPrivateLocationFilter = {}; // chiave = username del thread privato aperto dal Master
  let masterSubgroupLocationFilter = {}; // chiave = id del sottogruppo, lato Master

  // ---------- Sottogruppi di Chat ----------
  // Prima erano salvati in localStorage (solo sul dispositivo del Master, mai visti dai
  // giocatori). Ora passano dal server come tutto il resto, condivisi tra tutti i dispositivi.
  async function getSubgroups(code){ const d = await apiGet('/api/notice?resource=subgroup&code=' + encodeURIComponent(code), true); return d ? (d.groups||[]) : []; }
  async function saveSubgroup(code, { id, name, members }){ return apiPost('/api/notice', { resource:'subgroup', code, id, name, members }); }
  async function deleteSubgroup(code, id){ return apiDelete('/api/notice?resource=subgroup&code=' + encodeURIComponent(code) + '&id=' + encodeURIComponent(id)); }

  async function saveMember(code, member){ const d = await apiPost('/api/roster', { code, member }); return !!(d && d.ok); }

  function currentLocationKey(){
    if(!cachedScene) return '_|_|_';
    return `${cachedScene.currentMacroSceneId||'_'}|${cachedScene.currentSectorId||'_'}|${cachedScene.currentLuogoId||'_'}`;
  }

  function currentLocationLabel(){
    return locationLabelForKey(currentLocationKey());
  }

  function locationLabelForKey(key){
    if(!key || key==='__legacy__') return 'Storico precedente';
    const parts = String(key).split('|');
    const sectorId = parts[1], luogoId = parts[2];
    if(!sectorId || sectorId==='_') return 'Nessun Settore';
    const sName = sectorNameById(sectorId) || 'Settore eliminato';
    if(luogoId && luogoId!=='_'){
      const lName = luogoNameById(sectorId, luogoId);
      if(lName) return `${sName} — ${lName}`;
    }
    return sName;
  }

  function buildLocationOptions(entries, currentKey){
    const map = new Map();
    (entries||[]).forEach(e=>{
      const key = (e.meta && e.meta.location) || null;
      if(!key) return; // i messaggi "legacy" senza tag non diventano una voce a sé: restano sempre visibili (vedi filterByLocation)
      if(!map.has(key)) map.set(key, locationLabelForKey(key));
    });
    if(currentKey && !map.has(currentKey)) map.set(currentKey, locationLabelForKey(currentKey));
    const keys = Array.from(map.keys());
    keys.sort((a,b)=>{
      if(a===currentKey) return -1;
      if(b===currentKey) return 1;
      return map.get(a).localeCompare(map.get(b));
    });
    return keys.map(k=>({ key:k, label: map.get(k) }));
  }

  function filterByLocation(entries, selected, currentKey){
    const effective = (selected===null || selected===undefined) ? currentKey : selected;
    if(effective==='__all__') return entries||[];
    return (entries||[]).filter(e => !(e.meta && e.meta.location) || e.meta.location===effective);
  }

  function locationFilterSelectHTML(id, entries, currentKey, selected){
    const opts = buildLocationOptions(entries, currentKey);
    const selectedValue = (selected===null || selected===undefined) ? currentKey : selected;
    return `<select id="${id}" style="font-family:'Share Tech Mono',monospace;font-size:10.5px;padding:2px 4px;max-width:190px;background:var(--panel-2);color:var(--text);border:1px solid var(--line);border-radius:var(--radius);">
      ${opts.map(o=>`<option value="${escapeAttr(o.key)}" ${o.key===selectedValue?'selected':''}>📍 ${escapeHTML(o.label)}</option>`).join('')}
      <option value="__all__" ${selectedValue==='__all__'?'selected':''}>— Tutto lo storico —</option>
    </select>`;
  }

  function refreshLocationSelectOptions(selectEl, entries, currentKey, currentValue){
    if(!selectEl) return;
    const opts = buildLocationOptions(entries, currentKey);
    const selectedValue = (currentValue===null || currentValue===undefined) ? currentKey : currentValue;
    selectEl.innerHTML = opts.map(o=>`<option value="${escapeAttr(o.key)}" ${o.key===selectedValue?'selected':''}>📍 ${escapeHTML(o.label)}</option>`).join('')
      + `<option value="__all__" ${selectedValue==='__all__'?'selected':''}>— Tutto lo storico —</option>`;
  }

  function sceneLog(){
    return filterByLocation(scenePublicRawLog(), publicLocationFilter, currentLocationKey());
  }

  function scenePublicRawLog(){
    const sid = cachedScene && cachedScene.id;
    return (cachedLog||[]).filter(l=> !sid || !l.sceneId || l.sceneId===sid);
  }

  function exportVisibleLogAsText(entries, titleSuffix){
    const lines = (entries||[]).map(l=>{
      const when = l.created_at ? new Date(l.created_at).toLocaleString('it-IT') : '';
      return `[${when}] ${l.who||'?'}: ${(l.text||'').replace(/\n/g,' ')}`;
    });
    const header = `Digivice OS — Registro Chat${titleSuffix ? ' — ' + titleSuffix : ''}\nEsportato il ${new Date().toLocaleString('it-IT')}\n${'='.repeat(40)}\n\n`;
    const blob = new Blob([header + lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `digivice-chat-${new Date().toISOString().slice(0,10)}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function pushLog(code, entry){
    // Marca il messaggio con la location attuale (vedi sopra), a meno che chi chiama non
    // abbia già impostato esplicitamente meta.location (nessun caso attuale, ma per sicurezza).
    const meta = entry.meta ? { ...entry.meta } : {};
    if(meta.location===undefined) meta.location = currentLocationKey();
    return apiPost('/api/log', { code, username: session && session.username, ...entry, meta, sceneId: entry.sceneId || (cachedScene && cachedScene.id) || null });
  }

  // whoUpdate (opzionale) = { who, role, meta } per riassegnare anche il "mittente" di un
  // messaggio già inviato (vedi openEditLogModal), non solo correggerne il testo.
  async function editLogEntry(code, id, text, thread, whoUpdate){
    const body = thread ? { code, thread, id, text } : { code, id, text };
    if(whoUpdate){ Object.assign(body, whoUpdate); }
    return apiPut('/api/log', body);
  }

  async function deleteLogEntry(code, id, thread){ return apiDelete('/api/log?code=' + encodeURIComponent(code) + '&id=' + encodeURIComponent(id) + (thread ? '&thread=' + encodeURIComponent(thread) : '')); }

  async function clearLog(code){ return apiDelete('/api/log?code=' + encodeURIComponent(code) + '&clearAll=1'); }

  async function getPrivateLog(code, thread){ const d = await apiGet('/api/log?code=' + encodeURIComponent(code) + '&thread=' + encodeURIComponent(thread)); return d ? (d.log||[]) : []; }

  async function pushPrivateLog(code, thread, entry){
    // Stesso tag di location della Chat Generale (vedi pushLog sopra) — prima lo storico per
    // Settore era attivo SOLO lì; ora vale anche per Chat Privata e Sottogruppi.
    const meta = entry.meta ? { ...entry.meta } : {};
    if(meta.location===undefined) meta.location = currentLocationKey();
    return apiPost('/api/log', { code, thread, username: session && session.username, ...entry, meta });
  }

  async function correggiItaliano(testo){ const d = await apiPost('/api/ai', { mode:'correzione', text: testo }); return d && d.corrected ? d.corrected : testo; }

  let playerActiveSubgroupId = null;

  function memberEffectiveSectorId(member){
    const override = member && member.tamer && member.tamer.currentSectorId;
    return override || (cachedScene && cachedScene.currentSectorId) || null;
  }

  function memberEffectiveLuogoId(member){
    const luogoOverride = member && member.tamer && member.tamer.currentLuogoId;
    if(luogoOverride) return luogoOverride;
    const sectorOverride = member && member.tamer && member.tamer.currentSectorId;
    if(sectorOverride) return null;
    return (cachedScene && cachedScene.currentLuogoId) || null;
  }

  function memberLocationKey(member){
    if(!cachedScene) return '_|_|_';
    const sectorId = memberEffectiveSectorId(member);
    // Il Settore effettivo di un membro separato può appartenere a una Macroscena DIVERSA da
    // quella che il gruppo sta guardando in quel momento (es. gruppo su "Yokohama" ma il membro,
    // spostato singolarmente, si trova in un Settore della Macroscena "???"). Cerchiamo quindi la
    // Macroscena che contiene DAVVERO quel Settore invece di assumere sempre quella corrente del
    // gruppo, altrimenti la chiave mischierebbe Macroscena sbagliata + Settore/Luogo giusti e il
    // riconoscimento "stessa zona" tra due membri separati nella stessa Macroscena continuerebbe
    // a fallire.
    const found = sectorId ? findSectorAnywhere(cachedScene, sectorId) : null;
    const macroId = found ? found.macro.id : (cachedScene.currentMacroSceneId || null);
    return `${macroId||'_'}|${sectorId||'_'}|${memberEffectiveLuogoId(member)||'_'}`;
  }

  function subgroupLocationKey(group){
    const firstUsername = group && Array.isArray(group.members) && group.members[0];
    const member = firstUsername ? (cachedRoster||[]).find(m=>m.username===firstUsername) : null;
    return member ? memberLocationKey(member) : currentLocationKey();
  }

  function sectorNameById(sectorId){
    if(!sectorId) return null;
    for(const m of (cachedScene.macroScenes||[])){
      const s = (m.sectors||[]).find(x=>x.id===sectorId);
      if(s) return s.name;
    }
    return null;
  }

  function luogoNameById(sectorId, luogoId){
    if(!sectorId || !luogoId) return null;
    for(const m of (cachedScene.macroScenes||[])){
      const s = (m.sectors||[]).find(x=>x.id===sectorId);
      if(s){ const lg = (s.luoghi||[]).find(x=>x.id===luogoId); return lg ? lg.name : null; }
    }
    return null;
  }

  function findSectorAnywhere(scene, sectorId){
    if(!sectorId) return null;
    for(const m of ((scene && scene.macroScenes) || [])){
      const s = (m.sectors||[]).find(x=>x.id===sectorId);
      if(s) return { sector: s, macro: m };
    }
    return null;
  }

  // Fonte di verità unica per l'immagine "migliore" di un Digimon: cerca prima nel Digidex live
  // (dove GIF/immagine possono essere state aggiornate in qualunque momento), e solo se non trova
  // corrispondenza usa lo snapshot passato come fallback (preso al momento in cui quell'oggetto
  // — Incontro di scena, partecipante di combattimento, scheda giocatore — è stato creato/salvato).
  // Un solo punto da correggere invece di uno snapshot sparso in tre posti diversi.
  function bestDigimonImage(dexId, name, fallbackImage){
    let match = null;
    if(dexId) match = cachedDex.find(d=>d.id===dexId);
    if(!match && name) match = cachedDex.find(d=>String(d.name).trim().toLowerCase()===String(name).trim().toLowerCase());
    if(match && (match.gif_url || match.image_url)) return match.gif_url || match.image_url;
    return fallbackImage || '';
  }

  let masterPrivateThread = null;
  // Ultimo log privato caricato nella vista "chat privata" del Master (aggiornato ad ogni
  // render/refresh di quel pannello) — serve ad attachLogModeration per trovare il testo
  // originale del messaggio da modificare, dato che il log privato non passa da cachedLog.

  function resolveLogAvatar(l){
    // Se l'entry ha già un avatar esplicito in meta, lo usiamo (NPC/enemy/digimon parlati dal Master)
    if(l.meta && l.meta.avatar) return l.meta.avatar;
    // Player: cerca nel roster la miniatura del Tamer
    if(l.role==='player' || l.role==='roll'){
      const member = (cachedRoster||[]).find(m=>{
        const cn = m.tamer && m.tamer.characterName;
        const dn = (cn && String(cn).trim()) ? String(cn).trim() : m.username;
        return dn === l.who || m.username === l.who;
      });
      if(member && member.tamer){
        return member.tamer.imageThumbUrl || member.tamer.imageUrl || '';
      }
    }
    // Digimon: cerca gif/immagine tramite bestDigimonImage
    if(l.role==='digimon'){
      const member = (cachedRoster||[]).find(m=>{
        return m.digimon && (m.digimon.name === l.who);
      });
      if(member && member.digimon){
        return bestDigimonImage(null, member.digimon.name, member.digimon.imageUrl) || '';
      }
    }
    // GM (Master): nessun avatar di default
    return '';
  }

  function logHTML(log, canModerate){
    if(!log || log.length===0) return '<div class="muted">Il registro è vuoto. Le azioni appariranno qui.</div>';
    return log.map(l=>{
      let displayText = l.text;
      let fulfillBtn = '';
      let techDetailHTML = '';
      let hideDiceInline = false;
      if(l.text && l.text.includes('::TECH::')){
        const [shown, techLine] = l.text.split('::TECH::');
        displayText = shown;
        hideDiceInline = true;
        let diceInner = '';
        if(l.meta && Array.isArray(l.meta.dice)){
          diceInner = `<div style="margin:4px 0;">${l.meta.dice.map(d=>`<span style="display:inline-block;font-size:20px;color:var(--cyan);margin-right:2px;">${DIE_FACES[d]||d}</span>`).join('')}</div>`;
        }
        techDetailHTML = `<details style="margin-top:4px;"><summary class="muted" style="font-size:10px;cursor:pointer;">▸ dettagli attacco/difesa e dadi</summary><div style="margin-top:4px;">${diceInner}<div class="muted" style="font-size:10.5px;">${escapeHTML((techLine||'').trim())}</div></div></details>`;
      }
      if(l.role==='request' && l.text.includes('::REQ::')){
        const [shown, payload] = l.text.split('::REQ::');
        displayText = shown;
        const parts = payload.split('|');
        // Il primo campo può contenere più username separati da virgola (richiesta a più
        // giocatori contemporaneamente) — ognuno vede il proprio bottone sullo stesso messaggio.
        const targets = (parts[0]||'').split(',').filter(Boolean);
        const skillKey = parts[1], tn = parts[2]||'';
        if(session && session.role==='player' && targets.includes(session.username)){
          fulfillBtn = `<button class="btn amber small" style="margin-top:6px;" data-fulfill-target="${escapeAttr(parts[0])}" data-fulfill-skill="${escapeAttr(skillKey)}" data-fulfill-tn="${escapeAttr(tn)}">🎲 Tira ora</button>`;
        }
      }
      // Invito del Master a spostarsi ("Vuoi andare a XXX?"): visibile a chiunque legga questo
      // messaggio (non a un giocatore specifico come la richiesta di tiro) — ogni giocatore che
      // clicca si sposta DA SOLO, senza muovere il resto del gruppo.
      if(l.role==='moverequest' && l.text.includes('::MOVEREQ::')){
        const [shown, payload] = l.text.split('::MOVEREQ::');
        displayText = shown;
        const [moveSectorId, moveLuogoId] = payload.split('|');
        if(session && session.role==='player' && moveSectorId){
          fulfillBtn = `<button class="btn small" style="margin-top:6px;background:rgba(53,232,201,0.12);border-color:var(--cyan);color:var(--cyan);" data-move-accept-sector="${escapeAttr(moveSectorId)}" data-move-accept-luogo="${escapeAttr(moveLuogoId||'')}">🚶 Sì, andiamo!</button>`;
        }
      }
      // Sblocco Evoluzione da parte del Master (js/digimon-card.js, bottone 🔓/🔒): il messaggio
      // porta con sé lo username del giocatore sbloccato — solo LUI, leggendo questo messaggio,
      // vede un bottone pulsante che evolve subito al prossimo Stage se è già pronto (stesso
      // meccanismo di ::REQ::/::MOVEREQ:: sopra). Vedi il click handler in attachLogModeration.
      if(l.role==='gm' && l.text && l.text.includes('::EVOUNLOCK::')){
        const [shown, targetUsername] = l.text.split('::EVOUNLOCK::');
        displayText = shown;
        if(session && session.role==='player' && session.username===targetUsername){
          fulfillBtn = `<button class="btn amber small evo-pulse-btn" style="margin-top:6px;" data-evo-quick-username="${escapeAttr(targetUsername)}">🧬 Evolvi ora!</button>`;
        }
      }
      let diceHTML = '';
      if(!hideDiceInline && l.meta && Array.isArray(l.meta.dice)){
        const alreadyAnimated = animatedLogIds.has(l.id);
        diceHTML = `<div style="margin:4px 0;">${l.meta.dice.map((d,i)=>alreadyAnimated
          ? `<span style="display:inline-block;font-size:22px;color:var(--cyan);margin-right:2px;">${DIE_FACES[d]||d}</span>`
          : `<span class="die3d" style="font-size:22px;margin-right:2px;animation-delay:${(i*0.08).toFixed(2)}s;">${DIE_FACES[d]||d}</span>`
        ).join('')}</div>`;
        animatedLogIds.add(l.id);
      }
      return `
      <div class="log-entry ${l.role}">
        <div class="flex-between">
          <div>${(()=>{ const __av = resolveLogAvatar(l); return __av ? `<img class="who-avatar" src="${escapeAttr(__av)}" data-avatar-expand="${escapeAttr(__av)}" style="cursor:zoom-in;" onerror="this.style.display='none'" />` : ''; })()}<span class="who mono" ${l.meta && l.meta.color ? `style="color:${escapeAttr(l.meta.color)};"` : ''}>${escapeHTML(l.who)}</span><span class="meta">${new Date(l.ts).toLocaleTimeString('it-IT')}</span></div>
          ${canModerate ? `<div><button class="btn ghost small" data-log-edit="${l.id}" style="padding:2px 6px;">✎</button><button class="btn ghost small" data-log-del="${l.id}" style="padding:2px 6px;">✕</button></div>` : ''}
        </div>
        <div class="txt${l.meta && l.meta.digimoji ? ' digimoji-text' : ''}" ${l.meta && l.meta.digimoji ? `title="${escapeAttr(displayText)}"` : ''}>${formatLogText(displayText)}</div>
        ${l.meta && l.meta.digimoji ? `<div class="muted" style="font-size:10px;margin-top:2px;">(scritto in Digimoji — passa il mouse per leggere in chiaro)</div>` : ''}
        ${l.meta && l.meta.image ? `<img src="${escapeAttr(l.meta.image)}" class="log-image" data-avatar-expand="${escapeAttr(l.meta.image)}" onerror="this.style.display='none'" />` : ''}
        ${diceHTML}
        ${techDetailHTML}
        ${fulfillBtn}
      </div>
    `;
    }).join('');
  }

  // Modale "Modifica messaggio": sostituisce il vecchio window.prompt(), che su mobile (e non solo)
  // è un popup nativo minuscolo, non stilizzato, a riga singola — pessimo per correggere un
  // messaggio di più righe. Riusa lo stesso schema visivo degli altri modali della pagina
  // (.enc-modal-backdrop/.enc-modal-card, vedi openMissionsModal/showEncounterDetail).
  //
  // onChanged (opzionale): invocato al posto della vecchia chiamata diretta a refreshLiveParts()
  // dopo un salvataggio riuscito — vedi nota di testa del file.
  function openEditLogModal(entry, code, thread, onChanged){
    const old = document.getElementById('edit-log-modal');
    if(old) old.remove();
    const modal = document.createElement('div');
    modal.id = 'edit-log-modal';
    modal.className = 'enc-modal-backdrop';
    const currentAvatar = entry ? resolveLogAvatar(entry) : '';
    modal.innerHTML = `
      <div class="enc-modal-card hud-frame" style="max-width:520px;">
        <button class="btn ghost small" id="edit-log-modal-close" style="position:absolute;top:8px;right:8px;">✕</button>
        <div class="section-title" style="margin-top:0;">✎ Modifica messaggio</div>
        <textarea id="edit-log-modal-text" rows="5" style="width:100%;">${escapeHTML(entry ? entry.text : '')}</textarea>
        <div class="muted" style="font-size:11px;margin-top:10px;display:flex;align-items:center;gap:6px;">
          ${currentAvatar?`<img src="${escapeAttr(currentAvatar)}" style="width:20px;height:20px;border-radius:50%;object-fit:cover;" onerror="this.style.display='none'" />`:''}
          Attualmente: <b>${escapeHTML(entry ? entry.who : '')}</b>
        </div>
        <label style="display:flex;align-items:center;gap:6px;margin-top:8px;font-size:12px;">
          <input type="checkbox" id="edit-log-modal-change-who" /> Cambia anche chi ha "parlato"
        </label>
        <div id="edit-log-modal-who-fields" style="display:none;margin-top:8px;">
          ${speakAsFieldHTML('edit-log-modal-speak-as', 'edit-log-modal-speak-as-btn')}
          <div class="row" id="edit-log-modal-enemy-fields" style="display:none;margin-bottom:8px;">
            <input type="text" id="edit-log-modal-enemy-name" placeholder="Nome nemico" style="flex:2;" />
            <input type="text" id="edit-log-modal-enemy-img" placeholder="URL immagine (opz.)" style="flex:2;" />
          </div>
          <div class="row" id="edit-log-modal-npc-fields" style="display:none;margin-bottom:8px;">
            <input type="text" id="edit-log-modal-npc-name" placeholder="Nome NPC" style="flex:2;" />
            <input type="text" id="edit-log-modal-npc-img" placeholder="URL immagine (opz.)" style="flex:2;" />
          </div>
          <div class="row" style="margin-bottom:4px;align-items:center;">
            <label class="muted" style="flex:2;font-size:11px;">Colore scritta in chat</label>
            <input type="color" id="edit-log-modal-color" value="${escapeAttr((entry&&entry.meta&&entry.meta.color)||'#ff8a3d')}" style="flex:1;padding:2px;height:34px;" />
          </div>
        </div>
        <div class="err" id="edit-log-modal-status"></div>
        <div class="row" style="margin-top:10px;">
          <button class="btn ghost" id="edit-log-modal-cancel" style="flex:1;">Annulla</button>
          <button class="btn solid" id="edit-log-modal-save" style="flex:1;">Salva</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    const closeIt = ()=>modal.remove();
    document.getElementById('edit-log-modal-close').onclick = closeIt;
    document.getElementById('edit-log-modal-cancel').onclick = closeIt;
    modal.onclick = (ev)=>{ if(ev.target===modal) closeIt(); };
    const textEl = document.getElementById('edit-log-modal-text');
    textEl.focus();
    textEl.setSelectionRange(textEl.value.length, textEl.value.length);
    const changeWhoChk = document.getElementById('edit-log-modal-change-who');
    const whoFields = document.getElementById('edit-log-modal-who-fields');
    changeWhoChk.onchange = ()=>{ whoFields.style.display = changeWhoChk.checked ? 'block' : 'none'; };
    const speakSel = document.getElementById('edit-log-modal-speak-as');
    const enemyFields = document.getElementById('edit-log-modal-enemy-fields');
    const npcFields = document.getElementById('edit-log-modal-npc-fields');
    const colorInput = document.getElementById('edit-log-modal-color');
    attachSpeakAsButton('edit-log-modal-speak-as', 'edit-log-modal-speak-as-btn', code, null, (mode)=>{
      enemyFields.style.display = mode==='enemy' ? 'flex' : 'none';
      npcFields.style.display = mode==='npc' ? 'flex' : 'none';
      if(mode.startsWith('npc-saved:')){
        const name = mode.slice('npc-saved:'.length);
        const saved = loadSavedNpcs(code).find(n=>n.name===name);
        colorInput.value = (saved && saved.color) || '#ffd76a';
      } else if(mode==='enemy'){
        colorInput.value = '#ff8a3d';
      }
    });
    const saveBtn = document.getElementById('edit-log-modal-save');
    saveBtn.onclick = async ()=>{
      const newText = textEl.value.trim();
      const statusEl = document.getElementById('edit-log-modal-status');
      if(!newText){ statusEl.textContent = 'Il messaggio non può essere vuoto.'; return; }
      let whoUpdate = null;
      // Stessa logica di risoluzione who/role/avatar già usata dai bottoni "Invia" delle 3 chat
      // (vedi btn-gm-post / private / subgroup), applicata qui a un messaggio già esistente.
      if(changeWhoChk.checked){
        const mode = speakSel.value;
        let who = 'Master', role = 'gm', avatar = null;
        if(mode.startsWith('digimon:')){
          const username = mode.slice('digimon:'.length);
          const member = cachedRoster.find(m=>m.username===username);
          who = (member && member.digimon.name) ? member.digimon.name : username;
          role = 'digimon';
          avatar = member ? member.digimon.imageUrl : null;
        } else if(mode.startsWith('encounter:')){
          const idx = Number(mode.slice('encounter:'.length));
          const encObj = (cachedScene.encounters||[])[idx];
          who = encName(encObj) || 'Digimon';
          const dexMatch = cachedDex.find(e=>e.name.trim().toLowerCase()===who.trim().toLowerCase());
          role = 'enemy';
          avatar = (encObj && typeof encObj==='object' && encObj.image) ? encObj.image : (dexMatch ? dexMatch.image_url : null);
        } else if(mode.startsWith('dex:')){
          const dexId = mode.slice('dex:'.length);
          const dexEntry = cachedDex.find(e=>String(e.id)===dexId);
          who = dexEntry ? dexEntry.name : 'Digimon';
          role = 'enemy';
          avatar = dexEntry ? dexEntry.image_url : null;
        } else if(mode==='enemy'){
          who = document.getElementById('edit-log-modal-enemy-name').value.trim() || 'Nemico';
          role = 'enemy';
          avatar = document.getElementById('edit-log-modal-enemy-img').value.trim() || null;
        } else if(mode==='npc'){
          who = document.getElementById('edit-log-modal-npc-name').value.trim() || 'NPC';
          role = 'npc';
          avatar = document.getElementById('edit-log-modal-npc-img').value.trim() || null;
        } else if(mode.startsWith('npc-saved:')){
          const savedName = mode.slice('npc-saved:'.length);
          const saved = loadSavedNpcs(code).find(n=>n.name===savedName);
          who = (saved && saved.name) || savedName;
          role = 'npc';
          avatar = saved ? saved.avatar : null;
        }
        // meta: preserva eventuali chiavi già presenti sull'entry (es. image di un allegato,
        // digimoji) e aggiorna solo avatar/color, invece di sovrascrivere tutto il meta.
        const meta = Object.assign({}, entry.meta || {});
        if(avatar) meta.avatar = avatar; else delete meta.avatar;
        const chosenColor = colorInput.value;
        if(chosenColor) meta.color = chosenColor;
        if(role==='npc') rememberNpc(code, { name: who, color: chosenColor, avatar });
        whoUpdate = { who, role, meta };
      }
      saveBtn.disabled = true;
      const ok = await editLogEntry(code, entry.id, newText, thread, whoUpdate);
      if(!ok){ statusEl.textContent = '⚠ Errore: ' + (lastApiError || 'salvataggio non riuscito'); saveBtn.disabled = false; return; }
      closeIt();
      if(onChanged) onChanged();
    };
  }

  // onChanged (opzionale): invocato al posto della vecchia chiamata diretta a refreshLiveParts()
  // dopo edit/delete/tiro-evaso/spostamento-accettato — vedi nota di testa del file. Ereditato
  // anche da openEditLogModal (aperta dal bottone ✎).
  function attachLogModeration(container, code, me, isPrivate, subgroupThread, onChanged){
    if(!container || container.dataset.modBound) return;
    container.dataset.modBound = '1';
    container.addEventListener('click', async (e)=>{
      const editBtn = e.target.closest('[data-log-edit]');
      const delBtn = e.target.closest('[data-log-del]');
      const fulfillBtn = e.target.closest('[data-fulfill-target]');
      const moveAcceptBtn = e.target.closest('[data-move-accept-sector]');
      const evoQuickBtn = e.target.closest('[data-evo-quick-username]');
      // In chat privata il thread attuale può cambiare da un refresh all'altro (il Master
      // passa da un giocatore all'altro), quindi lo leggiamo dalla variabile globale al
      // momento del click, non lo "congeliamo" quando la funzione viene collegata.
      const thread = subgroupThread ? (typeof subgroupThread==='function'?subgroupThread():subgroupThread) : (isPrivate ? masterPrivateThread : null);
      const sourceLog = subgroupThread ? cachedSubgroupLog : (isPrivate ? cachedMasterPrivateLog : cachedLog);
      if(editBtn){
        const id = editBtn.getAttribute('data-log-edit');
        const entry = sourceLog.find(l=>String(l.id)===String(id));
        if(entry) openEditLogModal(entry, code, thread, onChanged);
      }
      if(delBtn){
        const id = delBtn.getAttribute('data-log-del');
        if(window.confirm('Eliminare questo messaggio dal registro?')){
          await deleteLogEntry(code, id, thread);
          if(onChanged) onChanged();
        }
      }
      if(fulfillBtn && me){
        const skillKey = fulfillBtn.getAttribute('data-fulfill-skill');
        const tn = fulfillBtn.getAttribute('data-fulfill-tn');
        const poolKeys = ['baseAccuracy','baseDodge','baseHealth'];
        let text = null;
        let rollMeta = null;
        if(poolKeys.includes(skillKey)){
          const { dice, successes } = rollPool(me.digimon[skillKey]);
          const label = skillKey==='baseAccuracy'?'Accuracy':(skillKey==='baseDodge'?'Dodge':'Health');
          text = `tira Pool Check ${label} (${me.digimon[skillKey]}d6): [${dice.join(',')}] → ${successes} successi (richiesto dal Master)`;
          rollMeta = { dice, successes };
        } else {
          const def = SKILL_DEFS.find(d=>d.key===skillKey);
          if(def){
            const attr = def.attrs[0];
            const attrVal = me.tamer[attr];
            const digimonBonus = prodigiousSkillBonus(me, def);
            const skillVal = Number(me.tamer.skills[def.key]||0) + digimonBonus;
            const { dice, total: baseTotal } = rollSkillCheck(attrVal, skillVal);
            let total = baseTotal;
            let aspectNote = digimonBonus>0 ? ` +${digimonBonus} dal Digimon (Prodigious Skill/Mind Over Matter)` : '';
            const majorLeft = me.tamer.majorAspect ? (me.tamer.majorAspect.usesLeft||0) : 0;
            const minorLeft = me.tamer.minorAspect ? (me.tamer.minorAspect.usesLeft||0) : 0;
            if(majorLeft>0 || minorLeft>0){
              const choice = window.prompt(`Usare un Aspect? Scrivi "major" (+4, ${majorLeft} usi), "minor" (+2, ${minorLeft} usi), o lascia vuoto per nessuno.`, '');
              if(choice && choice.trim().toLowerCase().startsWith('major') && majorLeft>0){
                total += 4; me.tamer.majorAspect.usesLeft -= 1;
                aspectNote = ` +4 Major Aspect (${me.tamer.majorAspect.text})`;
                await saveMember(session.code, me);
              } else if(choice && choice.trim().toLowerCase().startsWith('minor') && minorLeft>0){
                total += 2; me.tamer.minorAspect.usesLeft -= 1;
                aspectNote = ` +2 Minor Aspect (${me.tamer.minorAspect.text})`;
                await saveMember(session.code, me);
              }
            }
            const verdict = evaluateVsTN(total, tn, dice);
            text = `tira ${def.label} (${ATTR_ABBR[attr]}+Skill): 3d6[${dice.join(',')}] + ${attrVal} + ${skillVal}${aspectNote} = ${total}` + (verdict?` vs TN ${tn} → ${verdict.label}`:'') + ' (richiesto dal Master)';
            rollMeta = { dice, total, verdict: verdict?verdict.label:null };
          }
        }
        if(text){
          const entry = { who: displayName(me), role:'roll', text, meta: rollMeta };
          // Risponde nello stesso canale in cui il giocatore sta leggendo la richiesta: privato
          // col Master, il sottogruppo aperto, o generale — altrimenti (bug corretto) un tiro
          // fatto da dentro un sottogruppo finiva nella Chat Generale invece che nel sottogruppo.
          //
          // BUGFIX: qui sotto mancava il tag esplicito di location sulla RISPOSTA al tiro (stesso
          // identico bug già corretto sopra per la richiesta stessa in reqBtn.onclick — vedi
          // memberLocationKey/subgroupLocationKey). Senza meta.location esplicito, pushPrivateLog
          // la marca in automatico con currentLocationKey() (la posizione del gruppo INTERO),
          // invece della posizione EFFETTIVA di chi sta rispondendo. Se il giocatore/sottogruppo
          // si era separato dal gruppo, il risultato veniva sì salvato sul server, ma spariva
          // subito sotto il filtro di default "Settore attuale" della sua stessa chat — il tiro
          // sembrava non succedere affatto ("non compare il risultato").
          if(playerChatMode==='private'){
            await pushPrivateLog(code, session.username, { ...entry, meta: { ...(entry.meta||{}), location: memberLocationKey(me) } });
          } else if(playerChatMode==='subgroup' && playerActiveSubgroupId){
            const group = (cachedSubgroups||[]).find(g=>g.id===playerActiveSubgroupId) || null;
            await pushPrivateLog(code, 'subgroup:'+playerActiveSubgroupId, { ...entry, meta: { ...(entry.meta||{}), location: subgroupLocationKey(group) } });
          } else {
            await pushLog(code, entry);
          }
          if(onChanged) onChanged();
        }
      }
      if(moveAcceptBtn && me){
        // Il Master ha esplicitamente proposto questa destinazione in chat: lo spostamento va a
        // buon fine anche se lo "spostamento libero"/le connessioni non lo permetterebbero — qui
        // non è il giocatore a decidere di muoversi da solo, è un invito diretto del Master.
        const sectorId = moveAcceptBtn.getAttribute('data-move-accept-sector');
        const luogoId = moveAcceptBtn.getAttribute('data-move-accept-luogo') || null;
        if(sectorId){
          moveAcceptBtn.disabled = true;
          const prevSectorId = me.tamer.currentSectorId;
          const prevLuogoId = me.tamer.currentLuogoId;
          me.tamer.currentSectorId = sectorId;
          me.tamer.currentLuogoId = luogoId;
          const ok = await saveMember(code, me);
          if(!ok){
            me.tamer.currentSectorId = prevSectorId;
            me.tamer.currentLuogoId = prevLuogoId;
            moveAcceptBtn.disabled = false;
          } else {
            const destName = luogoId ? luogoNameById(sectorId, luogoId) : sectorNameById(sectorId);
            const entry = { who: displayName(me), role:'player', text: `🚶 ${displayName(me)} si sposta a "${destName||''}".` };
            if(playerChatMode==='private') await pushPrivateLog(code, session.username, entry);
            else if(playerChatMode==='subgroup' && playerActiveSubgroupId) await pushPrivateLog(code, 'subgroup:'+playerActiveSubgroupId, entry);
            else await pushLog(code, entry);
            if(onChanged) onChanged();
          }
        }
      }
      // Bottone "🧬 Evolvi ora!" pulsante (vedi logHTML/::EVOUNLOCK:: sopra): tenta di far evolvere
      // subito il proprio Digimon al prossimo Stage — se è già "costruito" (Scheda Digimon) e ci
      // sono Evolution Points a sufficienza, evolve sul colpo esattamente come il bottone "Evolvi"
      // della Scheda; altrimenti spiega perché non può ancora farlo, senza spostare il giocatore
      // altrove (nessuna azione fatta a metà, nessun log pushato se l'evoluzione non avviene).
      // Si può ricliccare più volte per salire più Stage di fila, uno alla volta, finché si resta
      // dentro il Default Range/EP disponibili — usa sempre lo Stage ATTUALE più recente, non
      // quello di quando il messaggio è stato inviato.
      if(evoQuickBtn && me && me.digimon){
        const d = me.digimon;
        const target = STAGES[Math.min(5, stageIndex(d.stage)+1)];
        if(target === d.stage){
          window.alert(`${d.name||'Il tuo Digimon'} è già al massimo Stage raggiungibile.`);
        } else if(!(d.stageStats && d.stageStats[target]) && target !== d.stage){
          window.alert(`Lo Stage ${target} non è ancora pronto: vai su Scheda Digimon → Evoluzione, assegna i punti per costruirlo (è come creare un Digimon nuovo, regola 3.19), poi potrai evolvere anche da qui.`);
        } else {
          const cost = evolutionCost(d, target);
          if(cost > Number(d.evolutionPoints||0)){
            window.alert(`Servono ${cost} Evolution Points per raggiungere ${target} (ne hai ${d.evolutionPoints||0}). Vai su Scheda Digimon per i dettagli, o aspetta di averne di più.`);
          } else {
            evoQuickBtn.disabled = true;
            d.evolutionPoints = Number(d.evolutionPoints||0) - cost;
            const oldName = d.name || 'Il Digimon';
            applyStageChange(d, d.stage, target);
            d.currentWounds = d.maxWounds;
            await saveMember(code, me);
            await pushPlayerNarration(code, me, { who: displayName(me), role:'player', text: `✨ ${oldName} è avvolto da un bagliore di dati... e digivolve in ${d.name||target}!${cost>0?` (spesi ${cost} Evolution Points)`:''} — Stat aggiornate automaticamente. Ricorda di segnare 1 Azione spesa.` });
            evoQuickBtn.disabled = false;
            if(onChanged) onChanged();
          }
        }
      }
    });
  }

  // escapeHTML/escapeAttr sono state spostate in js/util.js (funzioni pure, zero dipendenze).

  // Converte un testo grezzo (narrazione del Master, chat, ecc.) in HTML sicuro,
  // preservando gli a capo e un piccolo sottoinsieme di markdown: ### / ## / # per i titoli
  // e **testo** per il grassetto. L'escaping HTML avviene sempre PRIMA di interpretare
  // i simboli markdown, quindi non introduce rischi di injection.
  function formatLogText(raw){
    if(raw==null || raw==='') return '';
    const escaped = escapeHTML(String(raw)).replace(/\r\n/g,'\n');
    const lines = escaped.split('\n');
    let html = '';
    lines.forEach((line, i)=>{
      const h = line.match(/^(#{1,3})\s+(.*)$/);
      if(h){
        html += `<div class="log-h log-h${h[1].length}">${h[2]}</div>`;
      } else {
        html += line;
        if(i < lines.length-1) html += '<br>';
      }
    });
    // Discorso diretto: il testo tra virgolette viene evidenziato (colore + corsivo, vedi CSS
    // .log-speech) per distinguere a colpo d'occhio ciò che il personaggio DICE dal resto del
    // messaggio (narrazione/azione) — richiesto per rendere più leggibili i messaggi lunghi dove
    // si mescolano descrizione e battute. Riconosce le virgolette dritte "..." (diventate &quot;
    // dopo l'escaping HTML sopra) e quelle tipografiche "..."/«...» (non toccate dall'escaping).
    // Non greedy e senza attraversare <br>/<div> (escluso "<" dal contenuto): resta dentro una
    // singola riga, quindi non scatta per una virgoletta "aperta" dimenticata a fine messaggio.
    html = html
      .replace(/(&quot;)([^<]+?)(&quot;)/g, '$1<span class="log-speech">$2</span>$3')
      .replace(/(“)([^<]+?)(”)/g, '$1<span class="log-speech">$2</span>$3')
      .replace(/(«)([^<]+?)(»)/g, '$1<span class="log-speech">$2</span>$3');
    // grassetto **testo** (non a cavallo di righe già trasformate in <div>)
    html = html.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    // "Menziona": [[dex:ID]] / [[npc:NOME_CODIFICATO]] inseriti dal bottone 🔖 nel composer
    // diventano un badge cliccabile con mini-ritratto, invece di restare testo grezzo — mostra
    // subito a chi legge di chi si sta parlando, con un tap per vedere la scheda completa.
    // Varianti "solo immagine": [[dex-img:ID]] / [[npc-img:NOME_CODIFICATO]], inserite dal
    // picker scegliendo 🖼️ invece della riga intera — mostrano solo il ritratto (nessun nome/
    // chip), e un click ingrandisce l'immagine (stessa lightbox degli avatar/allegati) invece di
    // aprire la scheda completa. Vanno sostituite PRIMA delle varianti "chip" qui sotto, perché
    // altrimenti "dex-img:ID" non farebbe match di "dex:ID" (i due prefissi non si sovrappongono,
    // ma teniamole comunque in quest'ordine per chiarezza).
    html = html.replace(/\[\[dex-img:([a-zA-Z0-9_-]+)\]\]/g, (m, id)=>{
      const e = cachedDex.find(x=>String(x.id)===id);
      if(!e || !e.image_url) return m;
      return mentionImageOnlyHTML(e.image_url, e.name);
    });
    html = html.replace(/\[\[npc-img:([^\]]+)\]\]/g, (m, encName)=>{
      let name; try{ name = decodeURIComponent(encName); }catch(err){ name = encName; }
      const npcs = loadSavedNpcs(session && session.code);
      const n = npcs.find(x=>x.name===name);
      if(!n || !n.avatar) return m;
      return mentionImageOnlyHTML(n.avatar, name);
    });
    html = html.replace(/\[\[dex:([a-zA-Z0-9_-]+)\]\]/g, (m, id)=>{
      const e = cachedDex.find(x=>String(x.id)===id);
      if(!e) return m;
      return mentionChipHTML(e.image_url, e.name, 'dex:'+id);
    });
    html = html.replace(/\[\[npc:([^\]]+)\]\]/g, (m, encName)=>{
      let name; try{ name = decodeURIComponent(encName); }catch(err){ name = encName; }
      const npcs = loadSavedNpcs(session && session.code);
      const n = npcs.find(x=>x.name===name);
      return mentionChipHTML(n ? n.avatar : null, name, 'npc:'+encName);
    });
    return html;
  }
  function mentionChipHTML(avatar, name, dataKey){
    return `<span class="mention-chip" data-mention-open="${escapeAttr(dataKey)}">${avatar?`<img src="${escapeAttr(avatar)}" onerror="this.style.display='none'" />`:''}${escapeHTML(name)}</span>`;
  }
  // "Solo immagine": stesso data-avatar-expand già gestito dalla delegation globale (riga
  // ~10148) per avatar e allegati del Registro, quindi il click apre direttamente la lightbox
  // sull'immagine — niente scheda con nome/descrizione, come richiesto per questa modalità.
  function mentionImageOnlyHTML(avatar, name){
    return `<img class="who-avatar" src="${escapeAttr(avatar)}" alt="${escapeAttr(name)}" data-avatar-expand="${escapeAttr(avatar)}" style="width:22px;height:22px;border-radius:4px;object-fit:cover;cursor:zoom-in;vertical-align:middle;" onerror="this.style.display='none'" />`;
  }
