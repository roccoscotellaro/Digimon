// js/chat-composer.js
// Toolkit condiviso di composizione chat, usato identico da Chat Generale (post del Master),
// Chat Privata Master e Sottogruppi di Chat (e dalla modale "Modifica messaggio"):
//   - allegare un'immagine (upload a /api/upload, o link diretto, o fallback base64 inline)
//   - menzionare una voce del Digidex o un NPC salvato (picker cercabile + dettaglio al click)
//   - scegliere "Parla come" (Master / Digimon di un giocatore / Incontro in scena / Nemico
//     personalizzato / NPC) con lo stesso picker cercabile invece di un <select> enorme
//
// Dipende da: apiPost (js/api.js), escapeHTML/escapeAttr/displayName (js/util.js),
// encName (js/encounters.js), loadSavedNpcs (js/npc-registry.js), cachedRoster/cachedDex/
// cachedScene/session (js/store.js) -- tutti globali, tutti caricati prima di questo file.
//
// Script classico (non un modulo ES), caricato PRIMA del blocco <script> principale in index.html
// -- restano funzioni/costanti globali esattamente come quando vivevano nella stessa IIFE del
// file grande, nessun cambiamento di comportamento. index.html continua a costruire i 3 pannelli
// chat (Generale/Privata/Sottogruppi) e a richiamare queste funzioni risalendo la catena di
// scope, esattamente come per le fasi precedenti.

  // ---------- CHAT/AVVISO IMAGE ATTACH ----------
  // Strategia a 3 livelli:
  //   1) Tenta /api/upload (endpoint serverless già esistente, target:'chat' -> bucket chat-uploads)
  //   2) Se 404 o errore, upload diretto a Supabase Storage via REST
  //   3) Se anche quello fallisce, usa il dataUrl base64 inline (funziona sempre, ma è pesante)
  //
  // NOTA STORICA: prima questo chiamava '/api/upload-chat', un endpoint che non è MAI esistito
  // nel progetto (le funzioni serverless sono solo state/notice/log/ai/roster/dex/upload). Quindi
  // il passo 1 falliva SEMPRE, il passo 2 era disattivato (SUPABASE_ANON vuota), e ogni immagine
  // di chat/avviso finiva incorporata come base64 (fino a qualche MB) direttamente nella riga di
  // `logs`/`notices` — scaricata per intero a ogni polling da ogni giocatore. Era una delle cause
  // principali dei consumi eccessivi di egress Supabase e Fast Origin Transfer Vercel.
  const SUPABASE_URL  = 'https://gsquzfhxgyqrnkrqdivc.supabase.co';
  const SUPABASE_ANON = ''; // <-- inserisci qui la tua anon key se vuoi l'upload diretto a Supabase
  const CHAT_UPLOAD_BUCKET = 'chat-uploads';

  async function uploadChatImage(code, dataUrl, folder){
    // 1) Prova endpoint serverless (upload.js, target 'chat' -> bucket chat-uploads su Supabase Storage)
    try{
      const res = await apiPost('/api/upload', { code, dataUrl, folder, target: 'chat' });
      if(res && res.ok && res.url) return res.url;
    }catch(e){}

    // 2) Prova upload diretto a Supabase Storage (richiede anon key e bucket pubblico)
    if(SUPABASE_ANON){
      try{
        const base64 = dataUrl.split(',')[1];
        const mimeMatch = dataUrl.match(/^data:(image\/\w+);/);
        const mime = mimeMatch ? mimeMatch[1] : 'image/png';
        const ext = mime.split('/')[1] || 'png';
        const blob = await fetch(dataUrl).then(r=>r.blob());
        const fileName = `${code}/${folder}/${Date.now()}_${Math.random().toString(36).slice(2,6)}.${ext}`;
        const uploadRes = await fetch(`${SUPABASE_URL}/storage/v1/object/${CHAT_UPLOAD_BUCKET}/${fileName}`, {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + SUPABASE_ANON,
            'apikey': SUPABASE_ANON,
            'Content-Type': mime,
            'x-upsert': 'true'
          },
          body: blob
        });
        if(uploadRes.ok){
          return `${SUPABASE_URL}/storage/v1/object/public/${CHAT_UPLOAD_BUCKET}/${fileName}`;
        }
      }catch(e){}
    }

    // 3) Fallback: usa direttamente il dataUrl base64 (sempre funzionante, nessun server necessario)
    return dataUrl;
  }

  function chatAttachHTML(prefix){
    return `<div style="display:flex;align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap;">
      <input type="file" accept="image/*" id="${prefix}-img-file" style="display:none;" />
      <button type="button" class="btn ghost small" id="${prefix}-img-btn">📎 Allega immagine</button>
      <button type="button" class="btn ghost small" id="${prefix}-img-link-btn">🔗 Incolla link</button>
      <span class="muted" id="${prefix}-img-status" style="font-size:11px;"></span>
      <span id="${prefix}-img-preview"></span>
    </div>
    <div id="${prefix}-img-link-row" style="display:none;margin-top:6px;gap:6px;">
      <input type="text" id="${prefix}-img-link-input" placeholder="https://... (link diretto a un'immagine)" style="flex:1;" />
      <button type="button" class="btn ghost small" id="${prefix}-img-link-confirm">OK</button>
    </div>`;
  }
  function bindChatAttach(prefix, code, folder, getPending, setPending){
    const fileInput = document.getElementById(prefix+'-img-file');
    const btn = document.getElementById(prefix+'-img-btn');
    const statusEl = document.getElementById(prefix+'-img-status');
    const previewEl = document.getElementById(prefix+'-img-preview');
    const linkBtn = document.getElementById(prefix+'-img-link-btn');
    const linkRow = document.getElementById(prefix+'-img-link-row');
    const linkInput = document.getElementById(prefix+'-img-link-input');
    const linkConfirm = document.getElementById(prefix+'-img-link-confirm');
    if(!fileInput || !btn) return;
    function renderPreview(){
      const url = getPending();
      if(previewEl) previewEl.innerHTML = url
        ? `<span style="display:inline-flex;align-items:center;gap:4px;"><img src="${escapeAttr(url)}" style="width:28px;height:28px;object-fit:cover;border-radius:4px;border:1px solid var(--line);" /><button type="button" class="btn ghost small" id="${prefix}-img-remove" style="padding:1px 6px;">✕</button></span>`
        : '';
      const removeBtn = document.getElementById(prefix+'-img-remove');
      if(removeBtn) removeBtn.onclick = ()=>{ setPending(null); renderPreview(); };
    }
    renderPreview();
    btn.onclick = ()=> fileInput.click();
    // Incollare un link diretto invece di caricare il file: nessuna chiamata di upload, nessun
    // byte trasferito dal nostro server — l'immagine resta ospitata dove già si trova (Imgur,
    // Discord CDN, ecc.). Alleggerisce sia lo storage sia il traffico verso Vercel/Supabase.
    if(linkBtn) linkBtn.onclick = ()=>{
      if(linkRow) linkRow.style.display = linkRow.style.display==='flex' ? 'none' : 'flex';
      if(linkInput) linkInput.focus();
    };
    if(linkConfirm) linkConfirm.onclick = ()=>{
      const url = (linkInput && linkInput.value || '').trim();
      if(!url){ if(statusEl) statusEl.textContent = 'Incolla un link valido.'; return; }
      if(!/^https?:\/\//i.test(url)){ if(statusEl) statusEl.textContent = '⚠ Deve iniziare con http:// o https://'; return; }
      setPending(url);
      renderPreview();
      if(statusEl) statusEl.textContent = '🔗 Immagine collegata (nessun upload).';
      if(linkInput) linkInput.value = '';
      if(linkRow) linkRow.style.display = 'none';
    };
    if(linkInput) linkInput.addEventListener('keydown', (ev)=>{ if(ev.key==='Enter'){ ev.preventDefault(); linkConfirm && linkConfirm.click(); } });
    fileInput.onchange = async ()=>{
      const file = fileInput.files[0];
      if(!file) return;
      // Limite ragionevole: 3 MB (come l'upload audio)
      if(file.size > 3 * 1024 * 1024){
        if(statusEl) statusEl.textContent = '⚠ Immagine troppo grande (max 3 MB).';
        fileInput.value = '';
        return;
      }
      if(statusEl) statusEl.textContent = 'Caricamento in corso...';
      btn.disabled = true;
      try{
        const dataUrl = await new Promise((resolve, reject)=>{
          const reader = new FileReader();
          reader.onload = ()=> resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        const url = await uploadChatImage(code, dataUrl, folder);
        if(url){
          setPending(url);
          renderPreview();
          if(statusEl) statusEl.textContent = url.startsWith('data:') ? '📎 (allegata localmente)' : '';
        } else {
          if(statusEl) statusEl.textContent = '⚠ Caricamento fallito.';
        }
      }catch(e){
        if(statusEl) statusEl.textContent = '⚠ Errore durante il caricamento: ' + e.message;
      }
      btn.disabled = false;
      fileInput.value = '';
    };
  }

  // Bottone "🔖 Menziona" accanto a un composer: apre il selezionatore e inserisce il token
  // scelto (Digidex o NPC salvato) al punto del cursore nella textarea indicata.
  function mentionButtonHTML(prefix){
    return `<button type="button" class="btn ghost small" id="${prefix}-mention-btn" style="margin-top:6px;">🔖 Menziona</button>`;
  }
  function bindMentionButton(prefix, code, textareaId){
    const btn = document.getElementById(prefix+'-mention-btn');
    if(!btn) return;
    btn.onclick = ()=> openMentionPicker(code, (token)=>{
      const ta = document.getElementById(textareaId);
      if(!ta) return;
      const pos = ta.selectionStart==null ? ta.value.length : ta.selectionStart;
      ta.value = ta.value.slice(0,pos) + token + ' ' + ta.value.slice(pos);
      ta.focus();
      const newPos = pos + token.length + 1;
      try{ ta.setSelectionRange(newPos, newPos); }catch(e){}
    });
  }
  function openMentionPicker(code, onPick){
    const old = document.getElementById('mention-picker-modal');
    if(old) old.remove();
    const modal = document.createElement('div');
    modal.id = 'mention-picker-modal';
    modal.className = 'enc-modal-backdrop';
    const npcs = loadSavedNpcs(code);
    modal.innerHTML = `
      <div class="enc-modal-card hud-frame" style="max-width:420px;max-height:80vh;overflow:auto;position:relative;">
        <button class="btn ghost small" id="mention-picker-close" style="position:absolute;top:8px;right:8px;">✕</button>
        <div class="section-title" style="margin-top:0;">🔖 Mostra chi stai citando</div>
        <input type="text" id="mention-picker-search" placeholder="Cerca nel Digidex o negli NPC..." style="width:100%;margin-bottom:10px;" />
        <div id="mention-picker-list"></div>
      </div>
    `;
    document.body.appendChild(modal);
    const closeIt = ()=>modal.remove();
    document.getElementById('mention-picker-close').onclick = closeIt;
    modal.onclick = (ev)=>{ if(ev.target===modal) closeIt(); };
    const listEl = document.getElementById('mention-picker-list');
    const searchEl = document.getElementById('mention-picker-search');
    // Ogni riga ha due modi per essere scelta: un tap sulla riga (nome+ritratto) inserisce la
    // menzione "completa" (chip col nome, scheda con descrizione al click — comportamento
    // invariato), il pulsante 🖼️ a destra (solo se c'è un'immagine) inserisce la variante "solo
    // immagine" invece. Le due azioni sono su elementi separati per non doversi chiedere ogni
    // volta "che tipo di menzione vuoi" in un secondo passaggio.
    function renderList(){
      const q = (searchEl.value||'').trim().toLowerCase();
      const dexMatches = cachedDex.filter(e=>!q || e.name.toLowerCase().includes(q)).slice(0,25);
      const npcMatches = npcs.filter(n=>!q || n.name.toLowerCase().includes(q)).slice(0,25);
      listEl.innerHTML = `
        ${dexMatches.length ? `<div class="muted" style="font-size:10px;text-transform:uppercase;margin:6px 0 4px;">Digidex</div>` + dexMatches.map(e=>`<div class="roster-item" style="display:flex;align-items:center;gap:8px;padding:6px 8px;">
          <span data-mention-pick="dex:${escapeAttr(e.id)}" style="flex:1;cursor:pointer;display:flex;align-items:center;gap:8px;">${e.image_url?`<img src="${escapeAttr(e.image_url)}" style="width:26px;height:26px;object-fit:cover;border-radius:4px;" />`:''}<span>${escapeHTML(e.name)}</span></span>
          ${e.image_url?`<button type="button" class="btn ghost small" data-mention-pick-img="dex:${escapeAttr(e.id)}" title="Inserisci solo l'immagine" style="padding:2px 6px;">🖼️</button>`:''}
        </div>`).join('') : ''}
        ${npcMatches.length ? `<div class="muted" style="font-size:10px;text-transform:uppercase;margin:10px 0 4px;">NPC</div>` + npcMatches.map(n=>`<div class="roster-item" style="display:flex;align-items:center;gap:8px;padding:6px 8px;">
          <span data-mention-pick="npc:${escapeAttr(encodeURIComponent(n.name))}" style="flex:1;cursor:pointer;display:flex;align-items:center;gap:8px;">${n.avatar?`<img src="${escapeAttr(n.avatar)}" style="width:26px;height:26px;object-fit:cover;border-radius:4px;" />`:''}<span>${escapeHTML(n.name)}</span></span>
          ${n.avatar?`<button type="button" class="btn ghost small" data-mention-pick-img="npc:${escapeAttr(encodeURIComponent(n.name))}" title="Inserisci solo l'immagine" style="padding:2px 6px;">🖼️</button>`:''}
        </div>`).join('') : ''}
        ${(!dexMatches.length && !npcMatches.length) ? '<div class="muted">Nessun risultato.</div>' : ''}
      `;
      listEl.querySelectorAll('[data-mention-pick]').forEach(item=>{
        item.onclick = ()=>{
          const val = item.getAttribute('data-mention-pick');
          onPick(`[[${val}]]`);
          closeIt();
        };
      });
      listEl.querySelectorAll('[data-mention-pick-img]').forEach(btn=>{
        btn.onclick = (ev)=>{
          ev.stopPropagation();
          const val = btn.getAttribute('data-mention-pick-img');
          const sep = val.indexOf(':');
          const kind = val.slice(0, sep); // "dex" o "npc"
          const rest = val.slice(sep+1);
          onPick(`[[${kind}-img:${rest}]]`);
          closeIt();
        };
      });
    }
    searchEl.oninput = renderList;
    renderList();
    searchEl.focus();
  }
  // ===== "Parla come" — picker cercabile invece del <select> gigante =====
  // Su mobile un <select> nativo con tutto il Digidex dentro diventa una ruota di scelta
  // interminabile e scomodissima da scorrere. Master/Digimon dei giocatori/Incontri in scena
  // restano in cima come lista fissa (di solito pochi elementi); Digidex e NPC salvati, che
  // possono essere centinaia, si vedono solo cercando. Usata da Chat Generale, Privata,
  // Sottogruppi e dalla modale di modifica messaggio, cosi' il comportamento resta identico
  // ovunque compaia "Parla come".
  function speakAsFieldHTML(hiddenId, btnId, initialLabel){
    return `
      <div class="field"><label>Parla come</label>
        <button type="button" class="btn ghost" id="${btnId}" style="width:100%;text-align:left;">${escapeHTML(initialLabel||'🎙️ Master (narrazione)')}</button>
        <input type="hidden" id="${hiddenId}" value="master" />
      </div>
    `;
  }
  // applyFn(mode) viene richiamata subito dopo la scelta, per riusare la stessa logica che già
  // mostra/nasconde i campi Nemico/NPC e precompila il colore — invariata rispetto a prima,
  // cambia solo come viene innescata (niente più .onchange su un <select>).
  function attachSpeakAsButton(hiddenId, btnId, code, memberUsernames, applyFn){
    const hidden = document.getElementById(hiddenId);
    const btn = document.getElementById(btnId);
    if(!btn || !hidden) return;
    btn.onclick = ()=> openSpeakAsPicker(code, memberUsernames, (value, label)=>{
      hidden.value = value;
      btn.textContent = label;
      if(applyFn) applyFn(value);
    });
  }
  function openSpeakAsPicker(code, memberUsernames, onPick){
    const old = document.getElementById('speak-as-picker-modal');
    if(old) old.remove();
    const modal = document.createElement('div');
    modal.id = 'speak-as-picker-modal';
    modal.className = 'enc-modal-backdrop';
    const npcs = loadSavedNpcs(code);
    const rosterPool = memberUsernames ? (cachedRoster||[]).filter(p=>memberUsernames.includes(p.username)) : (cachedRoster||[]);
    modal.innerHTML = `
      <div class="enc-modal-card hud-frame" style="max-width:420px;max-height:80vh;overflow:auto;position:relative;">
        <button class="btn ghost small" id="speak-as-picker-close" style="position:absolute;top:8px;right:8px;">✕</button>
        <div class="section-title" style="margin-top:0;">🎭 Parla come</div>
        <div id="speak-as-picker-fixed"></div>
        <input type="text" id="speak-as-picker-search" placeholder="Cerca nel Digidex o negli NPC..." style="width:100%;margin:10px 0;" />
        <div id="speak-as-picker-list"></div>
      </div>
    `;
    document.body.appendChild(modal);
    const closeIt = ()=>modal.remove();
    document.getElementById('speak-as-picker-close').onclick = closeIt;
    modal.onclick = (ev)=>{ if(ev.target===modal) closeIt(); };
    const pick = (value, label)=>{ onPick(value, label); closeIt(); };
    const fixedEl = document.getElementById('speak-as-picker-fixed');
    fixedEl.innerHTML = `
      <div class="roster-item" data-pick="master" data-pick-label="🎙️ Master (narrazione)" style="cursor:pointer;padding:6px 8px;">🎙️ Master (narrazione)</div>
      ${rosterPool.map(p=>{ const label = (p.digimon&&p.digimon.name) || (displayName(p)+' — Digimon'); return `<div class="roster-item" data-pick="digimon:${escapeAttr(p.username)}" data-pick-label="${escapeAttr(label)}" style="cursor:pointer;display:flex;align-items:center;gap:8px;padding:6px 8px;">${(p.digimon&&p.digimon.imageUrl)?`<img src="${escapeAttr(p.digimon.imageUrl)}" style="width:22px;height:22px;object-fit:cover;border-radius:4px;" />`:''}<span>${escapeHTML(label)}</span></div>`; }).join('')}
      ${((cachedScene&&cachedScene.encounters)||[]).map((e,i)=>{ const label = encName(e)||'Digimon'; return `<div class="roster-item" data-pick="encounter:${i}" data-pick-label="${escapeAttr(label)}" style="cursor:pointer;padding:6px 8px;">⚔️ ${escapeHTML(label)} (in scena)</div>`; }).join('')}
    `;
    const bindPickables = (root)=>{
      root.querySelectorAll('[data-pick]').forEach(item=>{
        item.onclick = ()=> pick(item.getAttribute('data-pick'), item.getAttribute('data-pick-label'));
      });
    };
    bindPickables(fixedEl);
    const listEl = document.getElementById('speak-as-picker-list');
    const searchEl = document.getElementById('speak-as-picker-search');
    function renderList(){
      const q = (searchEl.value||'').trim().toLowerCase();
      // Digidex/NPC compaiono solo cercando (sono le liste potenzialmente lunghissime); senza
      // testo digitato mostriamo solo un assaggio degli NPC recenti, così la lista non parte
      // già enorme.
      const dexMatches = q ? cachedDex.filter(e=>e.name.toLowerCase().includes(q)).slice(0,25) : [];
      const npcMatches = q ? npcs.filter(n=>n.name.toLowerCase().includes(q)).slice(0,25) : npcs.slice(0,10);
      listEl.innerHTML = `
        ${dexMatches.length ? `<div class="muted" style="font-size:10px;text-transform:uppercase;margin:6px 0 4px;">Digidex</div>` + dexMatches.map(e=>`<div class="roster-item" data-pick="dex:${escapeAttr(e.id)}" data-pick-label="${escapeAttr(e.name)}" style="cursor:pointer;display:flex;align-items:center;gap:8px;padding:6px 8px;">${e.image_url?`<img src="${escapeAttr(e.image_url)}" style="width:22px;height:22px;object-fit:cover;border-radius:4px;" />`:''}<span>${escapeHTML(e.name)}</span></div>`).join('') : ''}
        ${npcMatches.length ? `<div class="muted" style="font-size:10px;text-transform:uppercase;margin:10px 0 4px;">NPC salvati</div>` + npcMatches.map(n=>`<div class="roster-item" data-pick="npc-saved:${escapeAttr(n.name)}" data-pick-label="${escapeAttr(n.name)}" style="cursor:pointer;display:flex;align-items:center;gap:8px;padding:6px 8px;">${n.avatar?`<img src="${escapeAttr(n.avatar)}" style="width:22px;height:22px;object-fit:cover;border-radius:4px;" />`:''}<span>${escapeHTML(n.name)}</span></div>`).join('') : ''}
        <div class="roster-item" data-pick="enemy" data-pick-label="💀 Nemico personalizzato..." style="cursor:pointer;padding:6px 8px;">💀 Nemico personalizzato...</div>
        <div class="roster-item" data-pick="npc" data-pick-label="👤 NPC nuovo..." style="cursor:pointer;padding:6px 8px;">👤 NPC nuovo...</div>
        ${(q && !dexMatches.length && !npcMatches.length) ? '<div class="muted">Nessun risultato nel Digidex/NPC.</div>' : ''}
      `;
      bindPickables(listEl);
    }
    searchEl.oninput = renderList;
    renderList();
    searchEl.focus();
  }
  function openMentionDetail(key){
    if(key.startsWith('dex:')){
      const e = cachedDex.find(x=>String(x.id)===key.slice(4));
      if(!e) return;
      showMentionDetailModal({ name:e.name, image:e.image_url, description:e.description, stage:e.stage, categories:e.categories });
    } else if(key.startsWith('npc:')){
      const encName = key.slice(4);
      let name; try{ name = decodeURIComponent(encName); }catch(err){ name = encName; }
      const npcs = loadSavedNpcs(session && session.code);
      const n = npcs.find(x=>x.name===name);
      showMentionDetailModal({ name, image: n ? n.avatar : null, description:'', stage:null, categories:[] });
    }
  }
  function showMentionDetailModal({ name, image, description, stage, categories }){
    const old = document.getElementById('mention-detail-modal');
    if(old) old.remove();
    const modal = document.createElement('div');
    modal.id = 'mention-detail-modal';
    modal.className = 'enc-modal-backdrop';
    modal.innerHTML = `
      <div class="enc-modal-card hud-frame" style="max-width:380px;position:relative;">
        <button class="btn ghost small" id="mention-detail-close" style="position:absolute;top:8px;right:8px;">✕</button>
        ${image ? `<div class="enc-modal-img-wrap"><img src="${escapeAttr(image)}" onerror="this.style.display='none'" class="enc-modal-img" /></div>` : ''}
        <div style="margin-top:10px;">
          <b style="font-size:16px;">${escapeHTML(name)}</b>
          ${stage ? `<span class="tag" style="margin-left:6px;">${escapeHTML(stage)}</span>` : ''}
        </div>
        ${categories && categories.length ? `<div class="muted" style="font-size:11px;margin-top:4px;">${categories.map(c=>escapeHTML(c)).join(' · ')}</div>` : ''}
        ${description ? `<div style="margin-top:10px;font-size:13px;white-space:pre-wrap;">${escapeHTML(description)}</div>` : ''}
      </div>
    `;
    document.body.appendChild(modal);
    document.getElementById('mention-detail-close').onclick = ()=>modal.remove();
    modal.onclick = (ev)=>{ if(ev.target===modal) modal.remove(); };
  }
