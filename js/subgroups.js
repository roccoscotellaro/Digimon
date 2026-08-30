// js/subgroups.js
// Pannello "Sottogruppi di Chat" (vista Master): crea/modifica/elimina sottogruppi di giocatori
// che condividono un thread privato, e ne renderizza la chat dedicata. Ultimo pezzo della "parte
// chat" a essere estratto, perché dipendeva per intero da logHTML/attachLogModeration/
// filterByLocation/locationFilterSelectHTML/subgroupLocationKey/getSubgroups/saveSubgroup/
// deleteSubgroup/getPrivateLog/pushPrivateLog/correggiItaliano/currentLocationLabel/
// exportVisibleLogAsText (js/chat-log-engine.js), da speakAsFieldHTML/attachSpeakAsButton/
// chatAttachHTML/bindChatAttach/mentionButtonHTML/bindMentionButton (js/chat-composer.js), da
// rememberNpc/loadSavedNpcs (js/npc-registry.js) e da attachDigimojiInput/italianToHiragana
// (js/digimoji.js) — tutti ormai globali.
//
// Script classico (non un modulo ES), caricato PRIMA del blocco <script> principale in index.html,
// DOPO js/chat-log-engine.js (di cui usa le funzioni sopra elencate).
//
// renderSubgroupChatMaster/openSubgroupModal NON chiamano più refreshLiveParts() direttamente:
// come attachLogModeration/openEditLogModal (vedi js/chat-log-engine.js), ricevono un parametro
// `onChanged` opzionale, propagato sia alla propria chiamata interna di attachLogModeration sia
// alle proprie ri-esecuzioni ricorsive (dopo un salvataggio/eliminazione) e a openSubgroupModal.
// I due punti in index.html che avviano il pannello (nel render iniziale del Master e nel tab
// "Sottogruppo" della Chat) passano `refreshLiveParts` come argomento — stesso comportamento di
// prima, solo iniettato dall'esterno invece che agganciato per nome.

  let pendingSubgroupImageUrl = null; // immagine allegata in corso di invio nei Sottogruppi di Chat del Master

  // ===== SOTTOGRUPPI DI CHAT =====
  // Un sottogruppo è un thread privato condiviso tra più giocatori (e il Master).
  // I thread dei MESSAGGI usano la stessa API di pushPrivateLog/getPrivateLog con un nome
  // prefissato "subgroup:" per non collidere con quelli 1:1. La LISTA dei sottogruppi (chi
  // ne fa parte, nome) passa invece da /api/notice?resource=subgroup (tabella `subgroups` su
  // Supabase) — prima era in localStorage, quindi visibile solo sul dispositivo del Master e
  // mai su quello dei giocatori. Vedi getSubgroups/saveSubgroup/deleteSubgroup in chat-log-engine.js.
  let activeSubgroupId = null;

  async function renderSubgroupChatMaster(code, players, onChanged){
    const cardEl = document.getElementById('mchat-subgroup-slot');
    if(!cardEl) return;
    const groups = await getSubgroups(code);
    cachedSubgroups = groups;
    if(!activeSubgroupId && groups.length>0) activeSubgroupId = groups[0].id;
    const activeGroup = groups.find(g=>g.id===activeSubgroupId) || null;
    // Vedi subgroupLocationKey: la chiave "attuale" per il Sottogruppo è quella effettiva dei
    // suoi membri, non quella del gruppo intero (currentLocationKey).
    const subKey = subgroupLocationKey(activeGroup);
    const log = activeGroup ? await getPrivateLog(code, 'subgroup:'+activeGroup.id) : [];
    cachedSubgroupLog = log;

    cardEl.innerHTML = `
      <div class="section-title" style="margin-top:0;">👥 Sottogruppi di Chat</div>
      <div class="muted" style="font-size:11px;margin-bottom:10px;">Crea gruppi di giocatori che possono chattare tra loro. Solo i membri del gruppo (e il Master) vedono i messaggi.</div>
      <div class="row" style="margin-bottom:10px;flex-wrap:wrap;gap:4px;">
        ${groups.map(g=>`<button class="btn small ${g.id===activeSubgroupId?'active':''}" data-subgroup-select="${escapeAttr(g.id)}" style="${g.id===activeSubgroupId?'background:rgba(53,232,201,0.12);border-color:var(--cyan);color:var(--cyan);':''}">${escapeHTML(g.name)} (${g.members.length})</button>`).join('')}
        <button class="btn small ghost" id="btn-create-subgroup">＋ Nuovo</button>
      </div>
      ${activeGroup ? `
        <div class="muted" style="font-size:11px;margin-bottom:6px;">Membri: ${activeGroup.members.map(u=>escapeHTML(displayNameFor(u))).join(', ')}
          <button class="btn ghost small" data-subgroup-edit="${escapeAttr(activeGroup.id)}" style="margin-left:6px;">✎ Modifica</button>
          <button class="btn ghost small danger" data-subgroup-delete="${escapeAttr(activeGroup.id)}" style="margin-left:4px;">🗑️</button>
        </div>
        <div class="log" id="subgroup-log-live" style="height:200px;">${logHTML(filterByLocation(log, masterSubgroupLocationFilter[activeGroup.id], subKey), true)}</div>
        <div class="muted" style="font-size:10.5px;margin-bottom:8px;display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap;">
          ${locationFilterSelectHTML('subgroup-location-select', log, subKey, masterSubgroupLocationFilter[activeGroup.id])}
          <button class="btn ghost small" id="btn-subgroup-export-chat" style="padding:2px 8px;">⬇️ Esporta</button>
        </div>
        <div style="margin-top:10px;">${speakAsFieldHTML('subgroup-speak-as', 'subgroup-speak-as-btn')}</div>
        <div class="row" id="subgroup-enemy-fields" style="display:none;margin-bottom:8px;">
          <input type="text" id="subgroup-enemy-speak-name" placeholder="Nome nemico" style="flex:2;" />
          <input type="text" id="subgroup-enemy-speak-img" placeholder="URL immagine (opz.)" style="flex:2;" />
        </div>
        <div class="row" id="subgroup-npc-fields" style="display:none;margin-bottom:8px;">
          <input type="text" id="subgroup-npc-speak-name" placeholder="Nome NPC" style="flex:2;" />
          <input type="text" id="subgroup-npc-speak-img" placeholder="URL immagine (opz.)" style="flex:2;" />
        </div>
        <div class="row" style="margin-bottom:8px;align-items:center;">
          <label class="muted" style="flex:2;font-size:11px;">Colore scritta in chat</label>
          <input type="color" id="subgroup-speak-color" value="#ff8a3d" style="flex:1;padding:2px;height:34px;" />
        </div>
        <textarea id="subgroup-text" rows="2" placeholder="Scrivi nel sottogruppo..." style="margin-top:8px;"></textarea>
        <label style="display:flex;align-items:center;gap:6px;margin-top:4px;font-size:11px;color:var(--text-mute);">
          <input type="checkbox" id="subgroup-digimoji-toggle" /> ✍️ Scrivi in Digimoji
        </label>
        <div class="row" style="margin-top:6px;">
          <button class="btn ghost small" id="subgroup-btn-correct">Correggi Italiano</button>
        </div>
        <div class="muted" id="subgroup-correct-status" style="margin-top:2px;font-size:10.5px;"></div>
        ${chatAttachHTML('subgroup')}
        ${mentionButtonHTML('subgroup')}
        <button class="btn amber" id="btn-subgroup-send" style="width:100%;margin-top:6px;">Invia</button>
      ` : `<div class="muted">Nessun sottogruppo creato. Clicca "＋ Nuovo" per creare il primo.</div>`}
    `;

    // Bind group selection buttons
    cardEl.querySelectorAll('[data-subgroup-select]').forEach(btn=>{
      btn.onclick = ()=>{
        activeSubgroupId = btn.getAttribute('data-subgroup-select');
        renderSubgroupChatMaster(code, players, onChanged);
      };
    });

    // Create new subgroup
    const createBtn = document.getElementById('btn-create-subgroup');
    if(createBtn) createBtn.onclick = ()=>{ openSubgroupModal(code, players, null, onChanged); };

    // Edit subgroup
    cardEl.querySelectorAll('[data-subgroup-edit]').forEach(btn=>{
      btn.onclick = ()=>{
        const gid = btn.getAttribute('data-subgroup-edit');
        const g = groups.find(x=>x.id===gid);
        if(g) openSubgroupModal(code, players, g, onChanged);
      };
    });

    // Delete subgroup
    cardEl.querySelectorAll('[data-subgroup-delete]').forEach(btn=>{
      btn.onclick = async ()=>{
        if(!window.confirm('Eliminare questo sottogruppo? I messaggi resteranno salvati ma non saranno più visibili.')) return;
        const gid = btn.getAttribute('data-subgroup-delete');
        await deleteSubgroup(code, gid);
        const gs = groups.filter(x=>x.id!==gid);
        activeSubgroupId = gs.length>0 ? gs[0].id : null;
        renderSubgroupChatMaster(code, players, onChanged);
      };
    });

    // Send message
    const sendBtn = document.getElementById('btn-subgroup-send');
    if(activeGroup) bindChatAttach('subgroup', code, 'chat', ()=>pendingSubgroupImageUrl, (url)=>{ pendingSubgroupImageUrl = url; });
    if(activeGroup) bindMentionButton('subgroup', code, 'subgroup-text');
    // Correzione IT via AI: stessa funzione già usata in Chat Generale (Player) e ora anche in
    // Chat Privata (Master) — mancava qui, unica sezione rimasta senza.
    const subCorrectBtn = document.getElementById('subgroup-btn-correct');
    if(subCorrectBtn) subCorrectBtn.onclick = async ()=>{
      const ta = document.getElementById('subgroup-text');
      const status = document.getElementById('subgroup-correct-status');
      status.textContent = 'Correzione in corso...';
      const corrected = await correggiItaliano(ta.value);
      ta.value = corrected;
      status.textContent = lastApiError ? ('Errore: ' + lastApiError) : 'Testo corretto.';
    };
    const subLocSelect = document.getElementById('subgroup-location-select');
    if(subLocSelect && activeGroup) subLocSelect.onchange = ()=>{
      masterSubgroupLocationFilter[activeGroup.id] = subLocSelect.value;
      const subLogLive = document.getElementById('subgroup-log-live');
      if(subLogLive) subLogLive.innerHTML = logHTML(filterByLocation(log, subLocSelect.value, subKey), true);
    };
    const subExportBtn = document.getElementById('btn-subgroup-export-chat');
    if(subExportBtn && activeGroup) subExportBtn.onclick = ()=>{
      const filterVal = masterSubgroupLocationFilter[activeGroup.id];
      const filtered = filterByLocation(log, filterVal, subKey);
      const label = subLocSelect ? subLocSelect.options[subLocSelect.selectedIndex].textContent.replace('📍 ','') : currentLocationLabel();
      exportVisibleLogAsText(filtered, label);
    };
    const subSpeakAsSel = document.getElementById('subgroup-speak-as');
    const subEnemyFields = document.getElementById('subgroup-enemy-fields');
    const subNpcFields = document.getElementById('subgroup-npc-fields');
    const subColorInput = document.getElementById('subgroup-speak-color');
    if(subSpeakAsSel){
      const applySubSpeakAsMode = (mode)=>{
        subEnemyFields.style.display = mode==='enemy' ? 'flex' : 'none';
        subNpcFields.style.display = mode==='npc' ? 'flex' : 'none';
        if(mode.startsWith('digimon:')){
          const username = mode.slice('digimon:'.length);
          const member = cachedRoster.find(m=>m.username===username);
          if(subColorInput) subColorInput.value = (member && member.digimon.chatColor) || '#c896ff';
        } else if(mode.startsWith('encounter:')){
          if(subColorInput) subColorInput.value = '#ff5d5d';
        } else if(mode.startsWith('dex:')){
          if(subColorInput) subColorInput.value = '#ff5d5d';
        } else if(mode==='enemy'){
          if(subColorInput) subColorInput.value = '#ff5d5d';
        } else if(mode==='npc'){
          if(subColorInput) subColorInput.value = '#ffd76a';
        } else if(mode.startsWith('npc-saved:')){
          const name = mode.slice('npc-saved:'.length);
          const saved = loadSavedNpcs(code).find(n=>n.name===name);
          if(subColorInput) subColorInput.value = (saved && saved.color) || '#ffd76a';
        } else {
          if(subColorInput) subColorInput.value = '#ff8a3d';
        }
      };
      // Solo i Digimon dei membri di QUESTO sottogruppo, non di tutta la campagna — stesso
      // filtro che c'era prima nelle <option> generate lato server.
      attachSpeakAsButton('subgroup-speak-as', 'subgroup-speak-as-btn', code, activeGroup ? activeGroup.members : null, applySubSpeakAsMode);
    }
    if(sendBtn && activeGroup) sendBtn.onclick = async ()=>{
      const ta = document.getElementById('subgroup-text');
      const subDigimojiChkPre = document.getElementById('subgroup-digimoji-toggle');
      if(subDigimojiChkPre && subDigimojiChkPre.checked){ ta.value = italianToHiragana(ta.value); }
      const text = ta.value.trim();
      if(!text) return;
      const mode = subSpeakAsSel ? subSpeakAsSel.value : 'master';
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
        who = document.getElementById('subgroup-enemy-speak-name').value.trim() || 'Nemico';
        role = 'enemy';
        avatar = document.getElementById('subgroup-enemy-speak-img').value.trim() || null;
      } else if(mode==='npc'){
        who = document.getElementById('subgroup-npc-speak-name').value.trim() || 'NPC';
        role = 'npc';
        avatar = document.getElementById('subgroup-npc-speak-img').value.trim() || null;
      } else if(mode.startsWith('npc-saved:')){
        const savedName = mode.slice('npc-saved:'.length);
        const saved = loadSavedNpcs(code).find(n=>n.name===savedName);
        who = (saved && saved.name) || savedName;
        role = 'npc';
        avatar = saved ? saved.avatar : null;
      }
      const meta = {};
      if(avatar) meta.avatar = avatar;
      const chosenColor = subColorInput ? subColorInput.value : color;
      if(chosenColor) meta.color = chosenColor;
      if(pendingSubgroupImageUrl) meta.image = pendingSubgroupImageUrl;
      if(subDigimojiChkPre && subDigimojiChkPre.checked) meta.digimoji = true;
      // Tagga con la posizione EFFETTIVA del sottogruppo (vedi subgroupLocationKey), non quella
      // del gruppo intero — così un sottogruppo separato viene "riconosciuto" nel Settore giusto.
      meta.location = subgroupLocationKey(activeGroup);
      if(role==='npc') rememberNpc(code, { name: who, color: chosenColor, avatar });
      await pushPrivateLog(code, 'subgroup:'+activeGroup.id, { who, role, text, meta });
      ta.value='';
      pendingSubgroupImageUrl = null;
      renderSubgroupChatMaster(code, players, onChanged);
    };

    const logLive = document.getElementById('subgroup-log-live');
    if(logLive){
      attachLogModeration(logLive, code, null, false, ()=>'subgroup:'+activeSubgroupId, onChanged);
      logLive.scrollTop = logLive.scrollHeight;
    }
    if(activeGroup) attachDigimojiInput('subgroup-text', 'subgroup-digimoji-toggle');
  }

  function openSubgroupModal(code, players, existing, onChanged){
    const old = document.getElementById('subgroup-modal');
    if(old) old.remove();
    const modal = document.createElement('div');
    modal.id = 'subgroup-modal';
    modal.className = 'enc-modal-backdrop';
    modal.innerHTML = `
      <div class="enc-modal-card hud-frame" style="max-width:420px;">
        <button class="btn ghost small" id="subgroup-modal-close" style="position:absolute;top:8px;right:8px;">✕</button>
        <div class="section-title" style="margin-top:0;">${existing?'✎ Modifica':'＋ Nuovo'} Sottogruppo</div>
        <div class="field"><label>Nome del gruppo</label><input type="text" id="subgroup-modal-name" value="${existing?escapeAttr(existing.name):''}" placeholder="es. Squadra Alpha" /></div>
        <div class="field" style="margin-top:10px;"><label>Membri</label>
          ${players.map(p=>`<label style="display:flex;align-items:center;gap:6px;font-size:12px;margin-bottom:4px;">
            <input type="checkbox" class="subgroup-member-chk" value="${escapeAttr(p.username)}" ${existing && existing.members.includes(p.username)?'checked':''} />
            ${escapeHTML(displayName(p))}
          </label>`).join('')}
        </div>
        <div class="err" id="subgroup-modal-status"></div>
        <div class="row" style="margin-top:12px;">
          <button class="btn ghost" id="subgroup-modal-cancel" style="flex:1;">Annulla</button>
          <button class="btn solid" id="subgroup-modal-save" style="flex:1;">Salva</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    const closeIt = ()=>modal.remove();
    document.getElementById('subgroup-modal-close').onclick = closeIt;
    document.getElementById('subgroup-modal-cancel').onclick = closeIt;
    modal.onclick = (ev)=>{ if(ev.target===modal) closeIt(); };
    document.getElementById('subgroup-modal-save').onclick = async ()=>{
      const name = document.getElementById('subgroup-modal-name').value.trim();
      const statusEl = document.getElementById('subgroup-modal-status');
      if(!name){ statusEl.textContent = 'Inserisci un nome per il gruppo.'; return; }
      const members = Array.from(modal.querySelectorAll('.subgroup-member-chk:checked')).map(c=>c.value);
      if(members.length<1){ statusEl.textContent = 'Seleziona almeno un giocatore.'; return; }
      const saveBtn = document.getElementById('subgroup-modal-save');
      saveBtn.disabled = true; saveBtn.textContent = 'Salvataggio...';
      const res = await saveSubgroup(code, { id: existing ? existing.id : undefined, name, members });
      if(!res || !res.ok){
        statusEl.textContent = 'Errore: ' + (lastApiError||'sconosciuto');
        saveBtn.disabled = false; saveBtn.textContent = 'Salva';
        return;
      }
      if(!existing) activeSubgroupId = res.group ? res.group.id : null;
      closeIt();
      renderSubgroupChatMaster(code, (cachedRoster||[]).filter(m=>m.role==='player'), onChanged);
    };
  }
  // ===== fine Sottogruppi di Chat =====
