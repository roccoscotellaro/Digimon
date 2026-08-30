// js/private-chat.js
// Chat Privata 1:1 del Master con un singolo giocatore (distinta dalla Chat Generale e dai
// Sottogruppi, vedi js/subgroups.js): il selettore "Con chi", il pallino rosso di non letto per
// thread, e il tab-switcher che decide quale delle tre chat (Generale/Privata/Sottogruppo) è
// visibile nel pannello del Master.
//
// Dipende da masterPrivateThread/masterPrivateLocationFilter/masterSubgroupLocationFilter
// (già globali, vedi js/chat-log-engine.js) e da logHTML/attachLogModeration/filterByLocation/
// locationFilterSelectHTML/getPrivateLog/pushPrivateLog/correggiItaliano/currentLocationLabel/
// exportVisibleLogAsText/memberLocationKey (idem), da speakAsFieldHTML/attachSpeakAsButton/
// chatAttachHTML/bindChatAttach/mentionButtonHTML/bindMentionButton (js/chat-composer.js), da
// rememberNpc/loadSavedNpcs (js/npc-registry.js), da attachDigimojiInput/italianToHiragana
// (js/digimoji.js) e da renderSubgroupChatMaster (js/subgroups.js) — tutti ormai globali.
//
// Script classico (non un modulo ES), caricato PRIMA del blocco <script> principale in index.html,
// DOPO js/chat-log-engine.js e js/subgroups.js (di cui usa le funzioni sopra elencate).
//
// checkMasterPrivateUnread/bindMasterChatMode/renderPrivateChatMaster NON chiamano più
// refreshLiveParts()/maybeNotifyNew() direttamente (entrambe restano dentro l'IIFE di index.html —
// la prima è l'orchestratore centrale, la seconda dipende da stato di notifica anch'esso locale
// alla IIFE): come attachLogModeration/renderSubgroupChatMaster (vedi js/chat-log-engine.js e
// js/subgroups.js), ricevono un parametro opzionale `onChanged` (al posto di refreshLiveParts) e/o
// `notify` (al posto di maybeNotifyNew), propagati a ogni chiamata interna e a ogni ri-esecuzione
// ricorsiva. I punti in index.html che avviano questo modulo passano `refreshLiveParts` e
// `maybeNotifyNew` come argomenti — stesso comportamento di prima, iniettato dall'esterno invece
// che agganciato per nome.

  let masterChatMode = 'general';
  let masterPrivateUnread = {}; // { username: true } — thread ha messaggi non ancora visti dal Master
  let pendingPrivateImageUrl = null; // immagine allegata in corso di invio nella Chat Privata del Master

  function privateReadKey(code, thread){ return `dvos_privread_${code}_${thread}`; }
  function markPrivateThreadRead(code, thread, log){
    if(!log || !log.length) return;
    try{ localStorage.setItem(privateReadKey(code, thread), String(log[log.length-1].id)); }catch(e){}
    delete masterPrivateUnread[thread];
  }
  function isPrivateThreadUnread(code, thread, log){
    if(!log || !log.length) return false;
    const last = log[log.length-1];
    let lastRead = null;
    try{ lastRead = localStorage.getItem(privateReadKey(code, thread)); }catch(e){}
    return String(last.id) !== String(lastRead);
  }
  // Controlla in background (durante il polling) se ci sono messaggi privati non letti in QUALSIASI
  // thread, non solo in quello aperto — serve per il pallino rosso sul bottone "Privata".
  // notify (opzionale) = maybeNotifyNew di index.html, per la notifica istantanea di un nuovo messaggio.
  async function checkMasterPrivateUnread(code, players, notify){
    for(const p of players){
      const log = await getPrivateLog(code, p.username);
      const lastFromPlayer = log.length>0 && log[log.length-1].who !== 'Master';
      if(lastFromPlayer && isPrivateThreadUnread(code, p.username, log)) masterPrivateUnread[p.username] = true;
      else delete masterPrivateUnread[p.username];
      if(log.length && notify) notify('private', p.username, log[log.length-1], 'Master');
    }
    const badge = document.getElementById('mchat-unread-badge');
    const count = Object.keys(masterPrivateUnread).length;
    if(badge) badge.innerHTML = count>0 ? `<span style="background:var(--danger);color:#fff;border-radius:8px;padding:1px 6px;font-size:10px;">${count}</span>` : '';
  }
  function updateMasterChatModeUI(){
    const genBlock = document.getElementById('mchat-general-block');
    const privSlot = document.getElementById('mchat-private-slot');
    const subSlot = document.getElementById('mchat-subgroup-slot');
    const genBtn = document.getElementById('mchatmode-general');
    const privBtn = document.getElementById('mchatmode-private');
    const subBtn = document.getElementById('mchatmode-subgroup');
    if(genBlock) genBlock.style.display = masterChatMode==='general' ? '' : 'none';
    if(privSlot) privSlot.style.display = masterChatMode==='private' ? '' : 'none';
    if(subSlot) subSlot.style.display = masterChatMode==='subgroup' ? '' : 'none';
    if(genBtn) genBtn.classList.toggle('active', masterChatMode==='general');
    if(privBtn) privBtn.classList.toggle('active', masterChatMode==='private');
    if(subBtn) subBtn.classList.toggle('active', masterChatMode==='subgroup');
  }
  function bindMasterChatMode(code, players, onChanged, notify){
    const genBtn = document.getElementById('mchatmode-general');
    const privBtn = document.getElementById('mchatmode-private');
    const subBtn = document.getElementById('mchatmode-subgroup');
    if(genBtn) genBtn.onclick = ()=>{ masterChatMode='general'; updateMasterChatModeUI(); };
    if(privBtn) privBtn.onclick = async ()=>{ masterChatMode='private'; updateMasterChatModeUI(); await renderPrivateChatMaster(code, players, onChanged, notify); };
    if(subBtn) subBtn.onclick = async ()=>{ masterChatMode='subgroup'; updateMasterChatModeUI(); await renderSubgroupChatMaster(code, players, onChanged); };
    const clearBtn = document.getElementById('btn-clear-chat');
    if(clearBtn) clearBtn.onclick = async ()=>{
      if(!window.confirm('Cancellare TUTTA la chat generale? Non si può annullare. Le chat private non vengono toccate.')) return;
      clearBtn.disabled = true;
      await clearLog(code);
      cachedLog = await getLog(code);
      const logLive = document.getElementById('log-live');
      if(logLive) logLive.innerHTML = logHTML(sceneLog(), true);
      clearBtn.disabled = false;
    };
    const masterLocSelect = document.getElementById('master-chat-location-select');
    if(masterLocSelect) masterLocSelect.onchange = ()=>{
      publicLocationFilter = masterLocSelect.value;
      const logLive = document.getElementById('log-live');
      if(logLive) logLive.innerHTML = logHTML(sceneLog(), true);
    };
    const masterExportBtn = document.getElementById('btn-master-export-chat');
    if(masterExportBtn) masterExportBtn.onclick = ()=>{
      const label = masterLocSelect ? masterLocSelect.options[masterLocSelect.selectedIndex].textContent.replace('📍 ','') : currentLocationLabel();
      exportVisibleLogAsText(sceneLog(), label);
    };
    updateMasterChatModeUI();
    checkMasterPrivateUnread(code, players, notify);
  }
  async function renderPrivateChatMaster(code, players, onChanged, notify){
    const cardEl = document.getElementById('mchat-private-slot');
    if(!cardEl) return;
    if(!masterPrivateThread && players.length>0) masterPrivateThread = players[0].username;
    if(players.length===0){
      cardEl.innerHTML = `<div class="muted">Nessun giocatore ancora collegato.</div>`;
      return;
    }
    const log = masterPrivateThread ? await getPrivateLog(code, masterPrivateThread) : [];
    cachedMasterPrivateLog = log;
    // "Parla come" + "Colore scritta in chat" — stessa funzionalità già presente sulla Chat
    // Generale (vedi #speak-as/#speak-color e btn-gm-post), replicata qui con id prefissati
    // "private-" per non collidere con quella. Le opzioni (Master / Digimon di un giocatore /
    // Incontro in scena / Nemico personalizzato) e la logica di risoluzione who/role/avatar/color
    // sono intenzionalmente identiche, per coerenza tra le due chat.
    // Vedi memberLocationKey: la chiave "attuale" per la Chat Privata è quella effettiva del
    // giocatore del thread aperto, non quella del gruppo intero (currentLocationKey).
    const privKey = memberLocationKey(players.find(p=>p.username===masterPrivateThread));
    cardEl.innerHTML = `
      <div class="field"><label>Con chi</label>
        <select id="private-thread-select">${players.map(p=>`<option value="${escapeAttr(p.username)}" ${p.username===masterPrivateThread?'selected':''}>${masterPrivateUnread[p.username]?'🔴 ':''}${escapeHTML(displayName(p))}</option>`).join('')}</select>
      </div>
      <div class="log" id="private-log-live-master" style="height:220px;">${logHTML(filterByLocation(log, masterPrivateLocationFilter[masterPrivateThread], privKey), true)}</div>
      <div class="muted" style="font-size:10.5px;margin-bottom:8px;display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap;">
        ${locationFilterSelectHTML('private-location-select', log, privKey, masterPrivateLocationFilter[masterPrivateThread])}
        <button class="btn ghost small" id="btn-private-export-chat" style="padding:2px 8px;">⬇️ Esporta</button>
      </div>
      <div style="margin-top:10px;">${speakAsFieldHTML('private-speak-as', 'private-speak-as-btn')}</div>
      <div class="row" id="private-enemy-fields" style="display:none;margin-bottom:8px;">
        <input type="text" id="private-enemy-speak-name" placeholder="Nome nemico" style="flex:2;" />
        <input type="text" id="private-enemy-speak-img" placeholder="URL immagine (opz.)" style="flex:2;" />
      </div>
      <div class="row" id="private-npc-fields" style="display:none;margin-bottom:8px;">
        <input type="text" id="private-npc-speak-name" placeholder="Nome NPC" style="flex:2;" />
        <input type="text" id="private-npc-speak-img" placeholder="URL immagine (opz.)" style="flex:2;" />
      </div>
      <div class="row" style="margin-bottom:8px;align-items:center;">
        <label class="muted" style="flex:2;font-size:11px;">Colore scritta in chat</label>
        <input type="color" id="private-speak-color" value="#ff8a3d" style="flex:1;padding:2px;height:34px;" />
      </div>
      <textarea id="private-text-master" rows="2" placeholder="Scrivi in privato..." style="margin-top:8px;"></textarea>
      <label style="display:flex;align-items:center;gap:6px;margin-top:4px;font-size:11px;color:var(--text-mute);">
        <input type="checkbox" id="private-digimoji-toggle" /> ✍️ Scrivi in Digimoji
      </label>
      <div class="row" style="margin-top:6px;">
        <button class="btn ghost small" id="private-btn-correct">Correggi Italiano</button>
      </div>
      <div class="muted" id="private-correct-status" style="margin-top:2px;font-size:10.5px;"></div>
      ${chatAttachHTML('private')}
      ${mentionButtonHTML('private')}
      <button class="btn amber" id="btn-private-send-master" style="width:100%;margin-top:6px;">Invia</button>
    `;
    if(masterChatMode==='private') markPrivateThreadRead(code, masterPrivateThread, log);
    document.getElementById('mchat-unread-badge') && checkMasterPrivateUnread(code, players, notify);
    document.getElementById('private-thread-select').onchange = (e)=>{
      masterPrivateThread = e.target.value;
      renderPrivateChatMaster(code, players, onChanged, notify);
    };
    bindChatAttach('private', code, 'avviso', ()=>pendingPrivateImageUrl, (url)=>{ pendingPrivateImageUrl = url; });
    bindMentionButton('private', code, 'private-text-master');
    // Correzione IT via AI: stessa funzione già usata in Chat Generale (Player) — mancava qui,
    // costringendo il Master a correggere a mano i messaggi di Chat Privata.
    const privCorrectBtn = document.getElementById('private-btn-correct');
    if(privCorrectBtn) privCorrectBtn.onclick = async ()=>{
      const ta = document.getElementById('private-text-master');
      const status = document.getElementById('private-correct-status');
      status.textContent = 'Correzione in corso...';
      const corrected = await correggiItaliano(ta.value);
      ta.value = corrected;
      status.textContent = lastApiError ? ('Errore: ' + lastApiError) : 'Testo corretto.';
    };
    const privLocSelect = document.getElementById('private-location-select');
    if(privLocSelect) privLocSelect.onchange = ()=>{
      masterPrivateLocationFilter[masterPrivateThread] = privLocSelect.value;
      const privLogLive = document.getElementById('private-log-live-master');
      if(privLogLive) privLogLive.innerHTML = logHTML(filterByLocation(log, privLocSelect.value, privKey), true);
    };
    const privExportBtn = document.getElementById('btn-private-export-chat');
    if(privExportBtn) privExportBtn.onclick = ()=>{
      const filterVal = masterPrivateLocationFilter[masterPrivateThread];
      const filtered = filterByLocation(log, filterVal, privKey);
      const label = privLocSelect ? privLocSelect.options[privLocSelect.selectedIndex].textContent.replace('📍 ','') : currentLocationLabel();
      exportVisibleLogAsText(filtered, label);
    };
    const privSpeakAsSel = document.getElementById('private-speak-as');
    const privEnemyFields = document.getElementById('private-enemy-fields');
    const privNpcFields = document.getElementById('private-npc-fields');
    const privColorInput = document.getElementById('private-speak-color');
    function applyPrivSpeakAsMode(mode){
      privEnemyFields.style.display = mode==='enemy' ? 'flex' : 'none';
      privNpcFields.style.display = mode==='npc' ? 'flex' : 'none';
      if(mode.startsWith('digimon:')){
        const username = mode.slice('digimon:'.length);
        const member = cachedRoster.find(m=>m.username===username);
        if(privColorInput) privColorInput.value = (member && member.digimon.chatColor) || '#c896ff';
      } else if(mode.startsWith('encounter:')){
        if(privColorInput) privColorInput.value = '#ff5d5d';
      } else if(mode.startsWith('dex:')){
        if(privColorInput) privColorInput.value = '#ff5d5d';
      } else if(mode==='enemy'){
        if(privColorInput) privColorInput.value = '#ff5d5d';
      } else if(mode==='npc'){
        if(privColorInput) privColorInput.value = '#ffd76a';
      } else if(mode.startsWith('npc-saved:')){
        const name = mode.slice('npc-saved:'.length);
        const saved = loadSavedNpcs(code).find(n=>n.name===name);
        if(privColorInput) privColorInput.value = (saved && saved.color) || '#ffd76a';
      } else {
        if(privColorInput) privColorInput.value = '#ff8a3d';
      }
    }
    attachSpeakAsButton('private-speak-as', 'private-speak-as-btn', code, null, applyPrivSpeakAsMode);
    document.getElementById('btn-private-send-master').onclick = async ()=>{
      const ta = document.getElementById('private-text-master');
      const privDigimojiChkPre = document.getElementById('private-digimoji-toggle');
      if(privDigimojiChkPre && privDigimojiChkPre.checked){ ta.value = italianToHiragana(ta.value); }
      const text = ta.value.trim();
      if(!text || !masterPrivateThread) return;
      const mode = privSpeakAsSel ? privSpeakAsSel.value : 'master';
      let who = 'Master', role = 'gm', avatar = null, color = null;
      if(mode.startsWith('digimon:')){
        const username = mode.slice('digimon:'.length);
        const member = cachedRoster.find(m=>m.username===username);
        who = (member && member.digimon.name) ? member.digimon.name : username;
        role = 'digimon';
        avatar = member ? member.digimon.imageUrl : null;
        color = member ? member.digimon.chatColor : null;
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
        who = document.getElementById('private-enemy-speak-name').value.trim() || 'Nemico';
        role = 'enemy';
        avatar = document.getElementById('private-enemy-speak-img').value.trim() || null;
      } else if(mode==='npc'){
        who = document.getElementById('private-npc-speak-name').value.trim() || 'NPC';
        role = 'npc';
        avatar = document.getElementById('private-npc-speak-img').value.trim() || null;
      } else if(mode.startsWith('npc-saved:')){
        const savedName = mode.slice('npc-saved:'.length);
        const saved = loadSavedNpcs(code).find(n=>n.name===savedName);
        who = (saved && saved.name) || savedName;
        role = 'npc';
        avatar = saved ? saved.avatar : null;
      }
      const meta = {};
      if(avatar) meta.avatar = avatar;
      const chosenColor = privColorInput ? privColorInput.value : color;
      if(chosenColor) meta.color = chosenColor;
      if(pendingPrivateImageUrl) meta.image = pendingPrivateImageUrl;
      const privDigimojiChk = document.getElementById('private-digimoji-toggle');
      if(privDigimojiChk && privDigimojiChk.checked) meta.digimoji = true;
      // Stessa correzione della Chat Privata/Sottogruppi: tagga con la posizione effettiva del
      // giocatore destinatario, non quella del gruppo intero (vedi memberLocationKey sopra).
      meta.location = memberLocationKey(cachedRoster.find(m=>m.username===masterPrivateThread));
      if(role==='npc') rememberNpc(code, { name: who, color: chosenColor, avatar });
      await pushPrivateLog(code, masterPrivateThread, { who, role, text, meta });
      ta.value='';
      pendingPrivateImageUrl = null;
      // renderPrivateChatMaster ricostruisce anche la select "Parla come" da loadSavedNpcs(code),
      // quindi un NPC nuovo qui compare già pronto per la prossima volta senza bisogno di un patch
      // manuale del DOM come nella chat generale (questa vista si ridisegna comunque per intero).
      renderPrivateChatMaster(code, players, onChanged, notify);
    };
    const logLive = document.getElementById('private-log-live-master');
    attachLogModeration(logLive, code, null, true, undefined, onChanged);
    if(logLive) logLive.scrollTop = logLive.scrollHeight;
    attachDigimojiInput('private-text-master', 'private-digimoji-toggle');
  }
