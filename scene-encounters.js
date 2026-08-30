// js/scene-encounters.js
// Scena / Mappa / Incontri: la vista di Scena del Master e del giocatore (griglia dei Settori,
// spostamento del gruppo/singoli giocatori, audio di scena/combattimento), gli Incontri preparati
// (bozza da Digidex o homebrew, pannello di editing live nel Master con HP/disposizione/tag
// attacchi), il modal di dettaglio Incontro (auto-registrazione nel Digidex al primo sguardo), e
// il delegate di click globale che apre il dettaglio Incontro/la lightbox immagine/il dettaglio
// menzione ovunque compaiano quei data-attribute nella pagina.
//
// Dipende da (già globali, caricati prima nella catena degli script): escapeHTML/escapeAttr/
// displayName (js/util.js), apiPost (js/api.js), bestDigimonImage/findSectorAnywhere/
// luogoNameById/memberEffectiveSectorId/memberEffectiveLuogoId/pushLog/pushPrivateLog/saveMember
// (js/chat-log-engine.js), encounterCurrentWounds/encounterMaxWounds/normalizeEncounter
// (js/encounters.js), miniHpBarHTML/portraitHTML (js/ui-helpers.js), attackTagsHTML/
// attributeBadgeHTML/attributeIconHTML/splitCategoriesAttribute/DEX_ATTRIBUTES
// (js/digimon-card.js), openMentionDetail (js/chat-composer.js).
//
// Pattern onChanged (introdotto in fase 8-9, esteso qui): renderSectorMap/bindEncountersPanel/
// bindEncounterDraftCard/bindEncountersInnerActions non chiamano più refreshLiveParts() a mano
// libera (resta nell'IIFE principale di index.html) — ricevono un parametro onChanged opzionale e
// lo invocano al posto suo (if(onChanged) onChanged();); index.html lo passa esplicitamente ad
// ogni chiamata esterna.
//
// Aggiornamento del pannello Digidex (dex-live) dopo un'aggiunta rapida al Dex da un Incontro o
// l'apertura del dettaglio Incontro: dexListHTML/bindDexEditButtons sono globali (js/dex-admin.js,
// fase 13) quindi richiamate qui direttamente. Fino alla fase 13 questo passava per un hook
// globale temporaneo (window.__dvosRefreshDexPanel), necessario perché a quel punto
// dexListHTML/bindDexEditButtons erano ancora IIFE-local a index.html.

// ---------- data layer (spostate da index.html: thin wrapper su apiPost/apiPut, self-contained) ----------
  async function saveScene(code, scene){ const d = await apiPost('/api/state', { resource:'scene', code, ...scene }); return !!(d && d.ok); }
  async function addDexEntry(code, entry){ return apiPost('/api/dex', { code, ...entry }); }
  async function updateDexEntry(code, id, fields){ return apiPut('/api/dex', { code, id, ...fields }); }

// ---------- stato di modulo (spostato da index.html, usato solo qui) ----------
  let sectorMapSelectedId = null; // which Settore is expanded in the compact Mappa panel
  let moveOpenUsername = null; // quale giocatore ha aperto il modulo "Sposta" nel pannello unico "Posizione dei giocatori"
  let encounterDraft = null; // pending Digimon (from Dex or homebrew) being reviewed before adding to the scene

// ---------- helper generici (spostati da index.html) ----------
  function onlineSummary(members){
    // Disattivato insieme all'heartbeat (vedi startPolling in index.html): senza last_seen
    // aggiornati in tempo reale, questa riga mostrerebbe sempre "nessun altro online" anche a
    // campagna piena. Ritorna stringa vuota così il contenitore resta semplicemente vuoto.
    return '';
  }

  // Un Digimon del roster segnato "hiddenFromParty" resta visibile SOLO a Master e proprietario —
  // serve a coprire il tempo tra la creazione/evoluzione di un Digimon e il momento in cui il
  // Master vuole rivelarlo narrativamente al resto del gruppo (es. un Digitama che si schiude
  // prima degli altri).
  function isDigimonHiddenFromViewer(member){
    if(!member || !member.digimon || !member.digimon.hiddenFromParty) return false;
    if(session && session.role==='master') return false;
    if(session && member.username===session.username) return false;
    return true;
  }

  // Stessa ricerca live nel Digidex di bestDigimonImage, ma per l'Attributo — usata per mostrare
  // l'iconcina Vaccine/Data/Virus/Free/Variable sui Digimon in scena senza doverlo salvare a parte
  // sull'Incontro (che potrebbe non essere mai stato sincronizzato con quel campo).
  function dexAttributeFor(dexId, name){
    let match = null;
    if(dexId) match = cachedDex.find(d=>d.id===dexId);
    if(!match && name) match = cachedDex.find(d=>String(d.name).trim().toLowerCase()===String(name).trim().toLowerCase());
    return match ? (match.attribute || '') : '';
  }

  function getGridSize(macro){
    const n = macro && Number(macro.gridSize);
    if(!n || isNaN(n) || n<1 || n>6) return 3;
    return n;
  }

  function liveActiveMacro(){
    return (cachedScene.macroScenes||[]).find(m=>m.id===cachedScene.currentMacroSceneId) || null;
  }

  function renderSectorMap(code, onChanged){
    const el = document.getElementById('sector-map-card');
    if(!el) return;
    const macroScenes = cachedScene.macroScenes || [];
    const activeMacro = macroScenes.find(m=>m.id===cachedScene.currentMacroSceneId) || null;
    const sectors = activeMacro ? (activeMacro.sectors||[]) : [];
    const gridSize = getGridSize(activeMacro);
    const gridTotal = gridSize*gridSize;
    const terrainBadge = (t)=> t==='Dangerous' ? '<span class="tag" style="color:var(--danger);border-color:var(--danger);">☠ Pericoloso</span>' : (t==='Difficult' ? '<span class="tag" style="color:var(--amber);border-color:var(--amber);">⚠ Difficile</span>' : '<span class="tag">Normale</span>');
    const usedPositions = sectors.map(s=>s.gridPos).filter(p=>p!=null);
    if(sectors.length>0 && !sectors.find(s=>s.id===sectorMapSelectedId)){
      sectorMapSelectedId = cachedScene.currentSectorId && sectors.find(s=>s.id===cachedScene.currentSectorId) ? cachedScene.currentSectorId : sectors[0].id;
    }
    if(sectors.length===0) sectorMapSelectedId = null;
    const selectedSector = sectors.find(s=>s.id===sectorMapSelectedId) || null;
    el.innerHTML = `
      <div class="section-title">🗺️ Mappa: Macroscene → Settori → Luoghi</div>
      <div class="muted" style="margin-bottom:8px;">Una Macroscena rappresenta una regione/location ampia (es. "Foresta di File"); si divide in Settori collegati tra loro (es. "Radura Nord"), che a loro volta contengono Luoghi specifici (es. "Vecchia Quercia"). Non sostituisce le zone Corto/Medio/Lungo del Combattimento. Assegna un'immagine e una posizione a ogni Settore per vederli nella griglia (dimensione impostabile in <b>map.html</b>, attualmente ${gridSize}×${gridSize}).</div>
      <div class="field"><label>Macroscena attiva</label>
        <select id="macro-select">
          <option value="">— nessuna —</option>
          ${macroScenes.map(m=>`<option value="${m.id}" ${cachedScene.currentMacroSceneId===m.id?'selected':''}>${escapeHTML(m.name)}</option>`).join('')}
        </select>
      </div>
      <div class="row">
        <input type="text" id="macro-name" placeholder="Nome nuova Macroscena" style="flex:2;" />
        <button class="btn small" id="btn-add-macro" style="flex:1;">+ Macroscena</button>
      </div>
      <div class="divider"></div>
      <div class="muted" style="margin-bottom:6px;">👥 Posizione dei giocatori <span title="Chi non è mai stato spostato singolarmente segue in automatico la posizione condivisa del gruppo (quella impostata più sotto con '📍 Sposta qui tutto il gruppo'). 'Sposta' invece manda UN SOLO giocatore in una Macroscena/Settore/Luogo qualsiasi senza cambiare cosa vede il resto del gruppo." style="cursor:help;">ⓘ</span></div>
      <div style="display:flex;flex-direction:column;gap:4px;margin-bottom:10px;">
        ${(cachedRoster||[]).filter(m=>m.role==='player').map(m=>{
          const sId = memberEffectiveSectorId(m);
          const lId = memberEffectiveLuogoId(m);
          const found2 = sId ? findSectorAnywhere(cachedScene, sId) : null;
          const crumb = [found2?found2.macro.name:null, found2?found2.sector.name:null, lId?luogoNameById(sId,lId):null].filter(Boolean).map(escapeHTML).join(' → ');
          const separated = !!(m.tamer && (m.tamer.currentSectorId || m.tamer.currentLuogoId));
          const isOpen = moveOpenUsername === m.username;
          const label = isDigimonHiddenFromViewer(m) ? '❔' : (m.digimon && m.digimon.name ? m.digimon.name : '(senza nome)');
          return `
          <div class="roster-item" style="padding:6px 8px;">
            <div class="flex-between">
              <span style="font-size:11px;">${separated?'🧭':'📍'} <b>${escapeHTML(displayName(m))}</b> <span class="muted">(${escapeHTML(label)}) — ${crumb || 'nessuna posizione'}</span></span>
              <span style="display:flex;gap:4px;">
                <button class="btn ${isOpen?'':'ghost'} small" data-move-toggle="${escapeAttr(m.username)}" style="padding:2px 6px;font-size:10px;">${isOpen?'✕ Chiudi':'Sposta'}</button>
                ${separated ? `<button class="btn ghost small" data-position-follow="${escapeAttr(m.username)}" style="padding:2px 6px;font-size:10px;">↩️ Rientra</button>` : ''}
              </span>
            </div>
            ${isOpen ? `
            <div style="margin-top:6px;display:flex;flex-direction:column;gap:4px;padding:6px;background:rgba(255,255,255,0.03);border-radius:6px;">
              <select id="move-macro-${escapeAttr(m.username)}">
                <option value="">— scegli Macroscena —</option>
                ${macroScenes.map(mm=>`<option value="${mm.id}">${escapeHTML(mm.name)}</option>`).join('')}
              </select>
              <select id="move-sector-${escapeAttr(m.username)}" disabled><option value="">— prima scegli la Macroscena —</option></select>
              <select id="move-luogo-${escapeAttr(m.username)}" disabled><option value="">— nessuno, segue solo il Settore —</option></select>
              <button class="btn small" data-move-confirm="${escapeAttr(m.username)}" disabled>🧭 Conferma spostamento</button>
            </div>
            ` : ''}
          </div>`;
        }).join('') || '<div class="muted" style="font-size:11px;">Nessun giocatore nel roster.</div>'}
      </div>
      <div class="divider"></div>
      ${activeMacro ? `
        <div class="muted" style="margin:8px 0 4px;">${escapeHTML(activeMacro.description||'')}</div>
        <div class="field" style="margin-bottom:8px;"><label>🎵 Musica Macroscena (mp3 diretto, opzionale)</label>
          <input type="text" id="macro-music" value="${escapeAttr(activeMacro.music||'')}" placeholder="https://.../traccia.mp3" style="width:100%;" />
        </div>
        <div class="field" style="margin-bottom:8px;"><label>🗡️ Musica da Combattimento Macroscena (opzionale)</label>
          <input type="text" id="macro-combat-music" value="${escapeAttr(activeMacro.combatMusic||'')}" placeholder="https://.../boss-theme.mp3" style="width:100%;" />
        </div>
        <div class="checkbox-row">
          <input type="checkbox" id="macro-allow-move" ${activeMacro.allowPlayerMovement?'checked':''} />
          <label for="macro-allow-move">🧭 Permetti ai giocatori di spostarsi da soli in <b>map.html</b> (solo verso Settori collegati a quello in cui si trovano)</label>
        </div>
        <div class="row" style="margin-bottom:8px;">
          <button class="btn ghost small" id="btn-remove-macro" style="width:100%;">🗑️ Elimina Macroscena "${escapeHTML(activeMacro.name)}"</button>
        </div>
        <div class="divider"></div>
        <div class="muted" style="margin-bottom:6px;">Settori di "${escapeHTML(activeMacro.name)}" (${sectors.length})</div>
        ${sectors.length===0 ? '<div class="muted" style="margin-bottom:8px;">Nessun settore ancora creato in questa Macroscena.</div>' : `
          <div class="field"><label>Seleziona Settore da gestire</label>
            <select id="sector-select">
              ${sectors.map(s=>`<option value="${s.id}" ${sectorMapSelectedId===s.id?'selected':''}>${escapeHTML(s.name)} — Casella ${s.gridPos!=null?(Number(s.gridPos)+1):'—'}${cachedScene.currentSectorId===s.id?' · 📍 Attuale':''}</option>`).join('')}
            </select>
          </div>
          ${selectedSector ? `
          <div class="roster-item" style="padding:6px 8px;margin-bottom:6px;${cachedScene.currentSectorId===selectedSector.id?'border-color:var(--cyan);':''}">
            <div class="flex-between">
              <span style="display:flex;align-items:center;gap:6px;">
                ${selectedSector.image ? `<img src="${escapeAttr(selectedSector.image)}" onerror="this.style.display='none'" style="width:28px;height:28px;object-fit:cover;border-radius:4px;" />` : ''}
                <b>${escapeHTML(selectedSector.name)}</b> ${terrainBadge(selectedSector.terrain)} <span class="tag">#${selectedSector.gridPos!=null?(Number(selectedSector.gridPos)+1):'—'}</span> ${cachedScene.currentSectorId===selectedSector.id && !cachedScene.currentLuogoId ?'<span class="tag" style="color:var(--cyan);border-color:var(--cyan);">📍 Attuale</span>':''}
              </span>
            </div>
            ${selectedSector.description ? `<div class="sub" style="margin-top:2px;">${escapeHTML(selectedSector.description)}</div>` : ''}
            <div class="muted" style="margin-top:2px;font-size:11px;">Collegato a: ${(selectedSector.connections||[]).map(cid=>{ const c = sectors.find(x=>x.id===cid); return c?escapeHTML(c.name):''; }).filter(Boolean).join(', ') || 'nessuno'}</div>
            <input type="text" data-sector-music="${selectedSector.id}" value="${escapeAttr(selectedSector.music||'')}" placeholder="🎵 URL Musica Settore (opzionale, sovrascrive quella della Macroscena)" style="width:100%;margin-top:4px;font-size:11px;" />
            <input type="text" data-sector-combat-music="${selectedSector.id}" value="${escapeAttr(selectedSector.combatMusic||'')}" placeholder="🗡️ URL Musica da Combattimento Settore (opzionale)" style="width:100%;margin-top:4px;font-size:11px;" />
            <div class="row" style="margin-top:4px;">
              <button class="btn small" data-sector-activate="${selectedSector.id}" style="flex:1;" title="Sposta qui l'intero gruppo, riunendo anche chi si era separato">📍 Sposta qui tutto il gruppo</button>
              <button class="btn ghost small" data-sector-image="${selectedSector.id}" style="flex:1;">🖼️ Immagine</button>
              <select data-sector-gridpos="${selectedSector.id}" style="flex:1;">
                ${(()=>{ const opts=[]; for(let p=0;p<gridTotal;p++) opts.push(p); if(selectedSector.gridPos!=null && selectedSector.gridPos>=gridTotal) opts.push(selectedSector.gridPos); return opts; })().map(p=>`<option value="${p}" ${selectedSector.gridPos===p?'selected':''}>Casella ${p+1}${p>=gridTotal?' (fuori griglia)':''}${usedPositions.includes(p) && selectedSector.gridPos!==p?' (occupata)':''}</option>`).join('')}
              </select>
              <button class="btn ghost small" data-sector-remove="${selectedSector.id}" style="flex:1;">🗑️</button>
            </div>
            <div class="checkbox-row">
              <input type="checkbox" id="sector-player-movable" ${selectedSector.playerMovable?'checked':''} />
              <label for="sector-player-movable">🚦 I giocatori possono raggiungere da soli questo Settore (in <b>map.html</b>, con "spostamento libero" attivo e se collegato — di default chiuso)</label>
            </div>
            <div class="field" style="margin-top:8px;margin-bottom:4px;"><label>💬 Invito in chat "Vuoi andare qui?" — destinatario</label>
              <select id="invite-target-select">
                <option value="">📣 Chat Generale (visibile a tutti)</option>
                ${(cachedRoster||[]).filter(m=>m.role==='player').map(m=>`<option value="${escapeAttr(m.username)}">✉️ Privata: ${escapeHTML(displayName(m))} (invisibile agli altri)</option>`).join('')}
              </select>
            </div>
            <button class="btn ghost small" data-sector-chat-invite="${selectedSector.id}" style="width:100%;">💬 Proponi qui il Settore</button>
            <div class="muted" style="margin-top:6px;font-size:11px;">Luoghi in questo Settore:</div>
            ${(selectedSector.luoghi||[]).length===0 ? '<div class="muted" style="font-size:11px;">Nessun luogo ancora.</div>' : (selectedSector.luoghi||[]).map(lg=>`
              <div class="flex-between" style="margin-top:3px;padding:3px 6px;background:rgba(255,255,255,0.03);border-radius:6px;">
                <span style="font-size:12px;display:flex;align-items:center;gap:5px;">${lg.image?`<img src="${escapeAttr(lg.image)}" onerror="this.style.display='none'" style="width:18px;height:18px;object-fit:cover;border-radius:3px;" />`:''}${escapeHTML(lg.name)} ${cachedScene.currentLuogoId===lg.id?'<span class="tag" style="color:var(--cyan);border-color:var(--cyan);font-size:9px;">📍</span>':''}${lg.description?`<span class="muted" style="font-size:10px;"> — ${escapeHTML(lg.description)}</span>`:''}</span>
                <span>
                  <button class="btn small" data-luogo-activate="${selectedSector.id}:${lg.id}" style="padding:2px 6px;font-size:10px;">📍</button>
                  <button class="btn ghost small" data-luogo-chat-invite="${selectedSector.id}:${lg.id}" style="padding:2px 6px;font-size:10px;" title="Manda l'invito 'Vuoi andare qui?' al destinatario scelto sopra (Generale o Privata)">💬</button>
                  <button class="btn ghost small" data-luogo-image="${selectedSector.id}:${lg.id}" style="padding:2px 6px;font-size:10px;">🖼️</button>
                  <button class="btn ghost small" data-luogo-remove="${selectedSector.id}:${lg.id}" style="padding:2px 6px;font-size:10px;">🗑️</button>
                </span>
              </div>
            `).join('')}
            <div class="row" style="margin-top:6px;">
              <input type="text" class="luogo-name-input" data-for-sector="${selectedSector.id}" placeholder="Nuovo Luogo (es. Vecchia Quercia)" style="flex:2;font-size:11px;" />
              <button class="btn small" data-luogo-add="${selectedSector.id}" style="flex:1;font-size:11px;">+ Luogo</button>
            </div>
          </div>
          ` : ''}
        `}
        <div class="divider"></div>
        <div class="muted" style="margin-bottom:4px;">Nuovo Settore in "${escapeHTML(activeMacro.name)}"</div>
        <div class="row">
          <input type="text" id="sector-name" placeholder="es. Villaggio - Piazza" style="flex:2;" />
          <select id="sector-terrain" style="flex:1;">
            <option value="Basic">Terreno Normale</option>
            <option value="Difficult">Terreno Difficile</option>
            <option value="Dangerous">Terreno Pericoloso</option>
          </select>
        </div>
        <input type="text" id="sector-desc" placeholder="Breve descrizione (opzionale)" style="width:100%;margin-top:6px;" />
        <input type="text" id="sector-image" placeholder="URL Immagine (opzionale)" style="width:100%;margin-top:6px;" />
        <input type="text" id="sector-music" placeholder="🎵 URL Musica Settore (opzionale)" style="width:100%;margin-top:6px;" />
        <div class="field" style="margin-top:6px;"><label>Posizione in griglia (1-${gridTotal})</label>
          <select id="sector-gridpos">
            ${Array.from({length:gridTotal},(_,p)=>p).map(p=>`<option value="${p}" ${usedPositions.includes(p)?'disabled':''}>Casella ${p+1}${usedPositions.includes(p)?' (occupata)':''}</option>`).join('')}
          </select>
        </div>
        ${sectors.length>0 ? `
          <div class="muted" style="margin:6px 0 2px;">Collega a:</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px;">
            ${sectors.map(s=>`<label style="display:flex;align-items:center;gap:4px;font-size:11px;"><input type="checkbox" class="sector-connect-chk" value="${s.id}" /> ${escapeHTML(s.name)}</label>`).join('')}
          </div>
        ` : ''}
        <button class="btn small" id="btn-add-sector" style="width:100%;margin-top:4px;">+ Aggiungi Settore</button>
      ` : '<div class="muted" style="margin-top:8px;">Seleziona o crea una Macroscena per gestirne i Settori.</div>'}
      <div class="muted" id="sector-status" style="margin-top:6px;"></div>
    `;
    const macroSel = document.getElementById('macro-select');
    if(macroSel) macroSel.onchange = async ()=>{
      cachedScene.currentMacroSceneId = macroSel.value || null;
      cachedScene.currentSectorId = null;
      cachedScene.currentLuogoId = null;
      sectorMapSelectedId = null;
      await saveScene(code, cachedScene);
      renderSectorMap(code, onChanged);
      if(onChanged) onChanged();
    };
    // Pannello unico "👥 Posizione dei giocatori": un solo modo per spostare un giocatore (in
    // qualunque Macroscena, senza toccare cachedScene.currentMacroSceneId/currentSectorId/
    // currentLuogoId, quindi senza disturbare cosa vede il resto del gruppo) o farlo rientrare.
    el.querySelectorAll('[data-move-toggle]').forEach(btn=>{
      btn.onclick = ()=>{
        const username = btn.getAttribute('data-move-toggle');
        moveOpenUsername = (moveOpenUsername===username) ? null : username;
        renderSectorMap(code, onChanged);
      };
    });
    el.querySelectorAll('[data-position-follow]').forEach(btn=>{
      btn.onclick = async ()=>{
        const username = btn.getAttribute('data-position-follow');
        const member = (cachedRoster||[]).find(m=>m.username===username);
        if(!member) return;
        btn.disabled = true;
        const prevSectorId = member.tamer.currentSectorId;
        const prevLuogoId = member.tamer.currentLuogoId;
        member.tamer.currentSectorId = null;
        member.tamer.currentLuogoId = null;
        const ok = await saveMember(code, member);
        if(!ok){ member.tamer.currentSectorId = prevSectorId; member.tamer.currentLuogoId = prevLuogoId; btn.disabled = false; return; }
        await pushLog(code, { who:'Sistema', role:'gm', text: `↩️ ${displayName(member)} rientra nel gruppo.` });
        renderSectorMap(code, onChanged);
        if(onChanged) onChanged();
      };
    });
    if(moveOpenUsername){
      const mvMacroSel = document.getElementById('move-macro-'+moveOpenUsername);
      const mvSectorSel = document.getElementById('move-sector-'+moveOpenUsername);
      const mvLuogoSel = document.getElementById('move-luogo-'+moveOpenUsername);
      const mvConfirmBtn = el.querySelector('[data-move-confirm="'+moveOpenUsername+'"]');
      function mvRefreshLuogo(){
        const m = macroScenes.find(x=>x.id===mvMacroSel.value);
        const s = m ? (m.sectors||[]).find(x=>x.id===mvSectorSel.value) : null;
        const luoghi = s ? (s.luoghi||[]) : [];
        mvLuogoSel.innerHTML = '<option value="">— nessuno, segue solo il Settore —</option>' + luoghi.map(lg=>`<option value="${lg.id}">${escapeHTML(lg.name)}</option>`).join('');
        mvLuogoSel.disabled = !s;
        if(mvConfirmBtn) mvConfirmBtn.disabled = !s;
      }
      function mvRefreshSector(){
        const m = macroScenes.find(x=>x.id===mvMacroSel.value);
        const secs = m ? (m.sectors||[]) : [];
        mvSectorSel.innerHTML = '<option value="">— scegli Settore —</option>' + secs.map(s=>`<option value="${s.id}">${escapeHTML(s.name)}</option>`).join('');
        mvSectorSel.disabled = !m;
        mvRefreshLuogo();
      }
      if(mvMacroSel){
        mvMacroSel.onchange = mvRefreshSector;
        mvSectorSel.onchange = mvRefreshLuogo;
        mvRefreshSector();
        if(mvConfirmBtn) mvConfirmBtn.onclick = async ()=>{
          const username = moveOpenUsername;
          const sectorId = mvSectorSel.value;
          const luogoId = mvLuogoSel.value || null;
          const member = (cachedRoster||[]).find(m=>m.username===username);
          if(!member || !sectorId) return;
          mvConfirmBtn.disabled = true;
          const prevSectorId = member.tamer.currentSectorId;
          const prevLuogoId = member.tamer.currentLuogoId;
          member.tamer.currentSectorId = sectorId;
          member.tamer.currentLuogoId = luogoId;
          const ok = await saveMember(code, member);
          if(!ok){
            member.tamer.currentSectorId = prevSectorId;
            member.tamer.currentLuogoId = prevLuogoId;
            mvConfirmBtn.disabled = false;
            return;
          }
          const destMacro = macroScenes.find(x=>x.id===mvMacroSel.value);
          const sectorName = (mvSectorSel.selectedOptions[0] || {}).text || '';
          moveOpenUsername = null;
          await pushLog(code, { who:'Sistema', role:'gm', text: `🧭 ${displayName(member)} si sposta in "${sectorName}" (${destMacro?destMacro.name:''}).` });
          renderSectorMap(code, onChanged);
          if(onChanged) onChanged();
        };
      }
    }
    const sectorSel = document.getElementById('sector-select');
    if(sectorSel) sectorSel.onchange = ()=>{
      sectorMapSelectedId = sectorSel.value;
      renderSectorMap(code, onChanged);
    };
    const addMacroBtn = document.getElementById('btn-add-macro');
    if(addMacroBtn) addMacroBtn.onclick = async ()=>{
      const name = document.getElementById('macro-name').value.trim();
      const statusEl = document.getElementById('sector-status');
      if(!name){ statusEl.textContent = 'Inserisci un nome per la Macroscena.'; return; }
      const id = 'ms'+Date.now()+Math.random().toString(36).slice(2,6);
      if(!cachedScene.macroScenes) cachedScene.macroScenes = [];
      cachedScene.macroScenes.push({ id, name, description:'', sectors:[], allowPlayerMovement:false });
      cachedScene.currentMacroSceneId = id;
      cachedScene.currentSectorId = null;
      cachedScene.currentLuogoId = null;
      await saveScene(code, cachedScene);
      renderSectorMap(code, onChanged);
      if(onChanged) onChanged();
    };
    const macroMusicEl = document.getElementById('macro-music');
    if(macroMusicEl) macroMusicEl.onchange = async ()=>{
      const liveMacro = liveActiveMacro();
      if(!liveMacro) return;
      liveMacro.music = macroMusicEl.value.trim();
      await saveScene(code, cachedScene);
      renderSectorMap(code, onChanged);
      if(onChanged) onChanged();
    };
    const macroCombatMusicEl = document.getElementById('macro-combat-music');
    if(macroCombatMusicEl) macroCombatMusicEl.onchange = async ()=>{
      const liveMacro = liveActiveMacro();
      if(!liveMacro) return;
      liveMacro.combatMusic = macroCombatMusicEl.value.trim();
      await saveScene(code, cachedScene);
      renderSectorMap(code, onChanged);
      if(onChanged) onChanged();
    };
    const macroAllowMoveEl = document.getElementById('macro-allow-move');
    if(macroAllowMoveEl) macroAllowMoveEl.onchange = async ()=>{
      const liveMacro = liveActiveMacro();
      if(!liveMacro) return;
      liveMacro.allowPlayerMovement = !!macroAllowMoveEl.checked;
      await saveScene(code, cachedScene);
      renderSectorMap(code, onChanged);
      if(onChanged) onChanged();
    };
    const removeMacroBtn = document.getElementById('btn-remove-macro');
    if(removeMacroBtn) removeMacroBtn.onclick = async ()=>{
      const liveMacro = liveActiveMacro();
      if(!liveMacro) return;
      const id = liveMacro.id;
      cachedScene.macroScenes = (cachedScene.macroScenes||[]).filter(m=>m.id!==id);
      if(cachedScene.currentMacroSceneId===id){ cachedScene.currentMacroSceneId=null; cachedScene.currentSectorId=null; cachedScene.currentLuogoId=null; }
      await saveScene(code, cachedScene);
      renderSectorMap(code, onChanged);
      if(onChanged) onChanged();
    };
    el.querySelectorAll('[data-sector-activate]').forEach(btn=>{
      btn.onclick = async ()=>{
        const liveMacro = liveActiveMacro();
        if(!liveMacro) return;
        cachedScene.currentSectorId = btn.getAttribute('data-sector-activate');
        cachedScene.currentLuogoId = null;
        const s = (liveMacro.sectors||[]).find(x=>x.id===cachedScene.currentSectorId);
        if(s) s.revealed = true; // standing there means the party has now seen it on the map
        const ok = await saveScene(code, cachedScene);
        const statusEl = document.getElementById('sector-status');
        if(!ok){ if(statusEl) statusEl.textContent = '⚠ Errore: ' + (lastApiError || 'salvataggio non riuscito'); return; }
        if(statusEl) statusEl.textContent = '';
        // Muovere l'intero gruppo riunisce anche chi si era separato: azzeriamo l'override di Settore
        // di ogni membro così tornano a seguire il Settore attuale della Scena.
        const separatedMembers = (cachedRoster||[]).filter(m=>m.role==='player' && m.tamer && (m.tamer.currentSectorId || m.tamer.currentLuogoId));
        for(const m of separatedMembers){ m.tamer.currentSectorId = null; m.tamer.currentLuogoId = null; await saveMember(code, m); }
        await pushLog(code, { who:'Sistema', role:'gm', text: `📍 Il gruppo si sposta a "${s?s.name:''}".` });
        renderSectorMap(code, onChanged);
        if(onChanged) onChanged();
      };
    });
    el.querySelectorAll('[data-sector-remove]').forEach(btn=>{
      btn.onclick = async ()=>{
        const liveMacro = liveActiveMacro();
        if(!liveMacro) return;
        const id = btn.getAttribute('data-sector-remove');
        if(!window.confirm('Eliminare questo Settore e tutti i suoi Luoghi?')) return;
        liveMacro.sectors = (liveMacro.sectors||[]).filter(s=>s.id!==id);
        liveMacro.sectors.forEach(s=>{ s.connections = (s.connections||[]).filter(cid=>cid!==id); });
        if(cachedScene.currentSectorId===id){ cachedScene.currentSectorId = null; cachedScene.currentLuogoId = null; }
        if(sectorMapSelectedId===id) sectorMapSelectedId = null;
        await saveScene(code, cachedScene);
        renderSectorMap(code, onChanged);
        if(onChanged) onChanged();
      };
    });
    // (lo spostamento/rientro dei singoli giocatori è gestito dal pannello unico "👥 Posizione dei
    // giocatori" più sopra — vedi data-move-toggle/data-position-follow/data-move-confirm)
    el.querySelectorAll('[data-sector-image]').forEach(btn=>{
      btn.onclick = async ()=>{
        const liveMacro = liveActiveMacro();
        if(!liveMacro) return;
        const id = btn.getAttribute('data-sector-image');
        const s = (liveMacro.sectors||[]).find(x=>x.id===id);
        if(!s) return;
        const url = window.prompt('URL immagine per "'+s.name+'":', s.image||'');
        if(url===null) return;
        s.image = url.trim();
        await saveScene(code, cachedScene);
        renderSectorMap(code, onChanged);
        if(onChanged) onChanged();
      };
    });
    el.querySelectorAll('[data-sector-gridpos]').forEach(sel=>{
      sel.onchange = async ()=>{
        const liveMacro = liveActiveMacro();
        if(!liveMacro) return;
        const id = sel.getAttribute('data-sector-gridpos');
        const s = (liveMacro.sectors||[]).find(x=>x.id===id);
        if(!s) return;
        s.gridPos = Number(sel.value);
        await saveScene(code, cachedScene);
        renderSectorMap(code, onChanged);
        if(onChanged) onChanged();
      };
    });
    el.querySelectorAll('[data-sector-music]').forEach(inp=>{
      inp.onchange = async ()=>{
        const liveMacro = liveActiveMacro();
        if(!liveMacro) return;
        const id = inp.getAttribute('data-sector-music');
        const s = (liveMacro.sectors||[]).find(x=>x.id===id);
        if(!s) return;
        s.music = inp.value.trim();
        await saveScene(code, cachedScene);
        renderSectorMap(code, onChanged);
        if(onChanged) onChanged();
      };
    });
    el.querySelectorAll('[data-sector-combat-music]').forEach(inp=>{
      inp.onchange = async ()=>{
        const liveMacro = liveActiveMacro();
        if(!liveMacro) return;
        const id = inp.getAttribute('data-sector-combat-music');
        const s = (liveMacro.sectors||[]).find(x=>x.id===id);
        if(!s) return;
        s.combatMusic = inp.value.trim();
        await saveScene(code, cachedScene);
        renderSectorMap(code, onChanged);
        if(onChanged) onChanged();
      };
    });
    const sectorPlayerMovableEl = document.getElementById('sector-player-movable');
    if(sectorPlayerMovableEl) sectorPlayerMovableEl.onchange = async ()=>{
      if(!selectedSector) return;
      selectedSector.playerMovable = !!sectorPlayerMovableEl.checked;
      await saveScene(code, cachedScene);
      renderSectorMap(code, onChanged);
      if(onChanged) onChanged();
    };
    // "Proponi in chat": manda un messaggio con un pulsante "🚶 Sì, andiamo!" — in Generale (tutti)
    // o in Privata a un solo giocatore, a scelta nel menu "destinatario" qui sopra. Chi lo clicca si
    // sposta DA SOLO (non tutto il gruppo) a quel Settore/Luogo, bypassando lo spostamento libero/le
    // connessioni: è il Master stesso a proporlo esplicitamente, quindi vale sempre.
    async function sendMoveInvite(text){
      const targetEl = document.getElementById('invite-target-select');
      const target = targetEl ? targetEl.value : '';
      if(target) await pushPrivateLog(code, target, { who:'Master', role:'moverequest', text });
      else await pushLog(code, { who:'Master', role:'moverequest', text });
    }
    el.querySelectorAll('[data-sector-chat-invite]').forEach(btn=>{
      btn.onclick = async ()=>{
        const liveMacro = liveActiveMacro();
        if(!liveMacro) return;
        const sectorId = btn.getAttribute('data-sector-chat-invite');
        const s = (liveMacro.sectors||[]).find(x=>x.id===sectorId);
        if(!s) return;
        s.revealed = true;
        const ok = await saveScene(code, cachedScene);
        const statusEl = document.getElementById('sector-status');
        if(!ok){ if(statusEl) statusEl.textContent = '⚠ Errore: ' + (lastApiError || 'salvataggio non riuscito'); return; }
        if(statusEl) statusEl.textContent = '';
        await sendMoveInvite(`Vuoi andare a "${s.name}"?::MOVEREQ::${sectorId}|`);
        renderSectorMap(code, onChanged);
        if(onChanged) onChanged();
      };
    });
    el.querySelectorAll('[data-luogo-chat-invite]').forEach(btn=>{
      btn.onclick = async ()=>{
        const liveMacro = liveActiveMacro();
        if(!liveMacro) return;
        const [sectorId, luogoId] = btn.getAttribute('data-luogo-chat-invite').split(':');
        const s = (liveMacro.sectors||[]).find(x=>x.id===sectorId);
        const lg = s ? (s.luoghi||[]).find(x=>x.id===luogoId) : null;
        if(!s || !lg) return;
        s.revealed = true;
        lg.revealed = true;
        const ok = await saveScene(code, cachedScene);
        const statusEl = document.getElementById('sector-status');
        if(!ok){ if(statusEl) statusEl.textContent = '⚠ Errore: ' + (lastApiError || 'salvataggio non riuscito'); return; }
        if(statusEl) statusEl.textContent = '';
        await sendMoveInvite(`Vuoi andare a "${lg.name}"?::MOVEREQ::${sectorId}|${luogoId}`);
        renderSectorMap(code, onChanged);
        if(onChanged) onChanged();
      };
    });
    el.querySelectorAll('[data-luogo-activate]').forEach(btn=>{
      btn.onclick = async ()=>{
        const liveMacro = liveActiveMacro();
        if(!liveMacro) return;
        const [sectorId, luogoId] = btn.getAttribute('data-luogo-activate').split(':');
        cachedScene.currentSectorId = sectorId;
        cachedScene.currentLuogoId = luogoId;
        const s = (liveMacro.sectors||[]).find(x=>x.id===sectorId);
        const lg = s ? (s.luoghi||[]).find(x=>x.id===luogoId) : null;
        if(s) s.revealed = true;
        if(lg) lg.revealed = true;
        const ok = await saveScene(code, cachedScene);
        const statusEl = document.getElementById('sector-status');
        if(!ok){ if(statusEl) statusEl.textContent = '⚠ Errore: ' + (lastApiError || 'salvataggio non riuscito'); return; }
        if(statusEl) statusEl.textContent = '';
        await pushLog(code, { who:'Sistema', role:'gm', text: `📍 Il gruppo arriva a "${lg?lg.name:''}" (${s?s.name:''}).` });
        renderSectorMap(code, onChanged);
        if(onChanged) onChanged();
      };
    });
    el.querySelectorAll('[data-luogo-remove]').forEach(btn=>{
      btn.onclick = async ()=>{
        const liveMacro = liveActiveMacro();
        if(!liveMacro) return;
        const [sectorId, luogoId] = btn.getAttribute('data-luogo-remove').split(':');
        const s = (liveMacro.sectors||[]).find(x=>x.id===sectorId);
        if(s) s.luoghi = (s.luoghi||[]).filter(l=>l.id!==luogoId);
        if(cachedScene.currentLuogoId===luogoId) cachedScene.currentLuogoId = null;
        await saveScene(code, cachedScene);
        renderSectorMap(code, onChanged);
        if(onChanged) onChanged();
      };
    });
    el.querySelectorAll('[data-luogo-image]').forEach(btn=>{
      btn.onclick = async ()=>{
        const liveMacro = liveActiveMacro();
        if(!liveMacro) return;
        const [sectorId, luogoId] = btn.getAttribute('data-luogo-image').split(':');
        const s = (liveMacro.sectors||[]).find(x=>x.id===sectorId);
        const lg = s ? (s.luoghi||[]).find(l=>l.id===luogoId) : null;
        if(!lg) return;
        const url = window.prompt('URL immagine per "'+lg.name+'":', lg.image||'');
        if(url===null) return;
        lg.image = url.trim();
        await saveScene(code, cachedScene);
        renderSectorMap(code, onChanged);
        if(onChanged) onChanged();
      };
    });
    el.querySelectorAll('[data-luogo-add]').forEach(btn=>{
      btn.onclick = async ()=>{
        const liveMacro = liveActiveMacro();
        if(!liveMacro) return;
        const sectorId = btn.getAttribute('data-luogo-add');
        const input = el.querySelector(`.luogo-name-input[data-for-sector="${sectorId}"]`);
        const name = input ? input.value.trim() : '';
        if(!name) return;
        const s = (liveMacro.sectors||[]).find(x=>x.id===sectorId);
        if(!s) return;
        if(!s.luoghi) s.luoghi = [];
        s.luoghi.push({ id:'l'+Date.now()+Math.random().toString(36).slice(2,6), name, description:'', revealed:false });
        await saveScene(code, cachedScene);
        renderSectorMap(code, onChanged);
        if(onChanged) onChanged();
      };
    });
    const addBtn = document.getElementById('btn-add-sector');
    if(addBtn){
      addBtn.onclick = async ()=>{
        const liveMacro = liveActiveMacro();
        if(!liveMacro) return;
        const name = document.getElementById('sector-name').value.trim();
        const statusEl = document.getElementById('sector-status');
        if(!name){ statusEl.textContent = 'Inserisci un nome per il settore.'; return; }
        const terrain = document.getElementById('sector-terrain').value;
        const description = document.getElementById('sector-desc').value.trim();
        const image = document.getElementById('sector-image').value.trim();
        const music = document.getElementById('sector-music').value.trim();
        const gridPosSel = document.getElementById('sector-gridpos').value;
        const gridPos = gridPosSel!=='' ? Number(gridPosSel) : null;
        const connections = Array.from(el.querySelectorAll('.sector-connect-chk:checked')).map(c=>c.value);
        const id = 's'+Date.now()+Math.random().toString(36).slice(2,6);
        if(!liveMacro.sectors) liveMacro.sectors = [];
        liveMacro.sectors.push({ id, name, description, terrain, connections, luoghi: [], image, music, gridPos, revealed:false, playerMovable:false });
        connections.forEach(cid=>{
          const other = liveMacro.sectors.find(s=>s.id===cid);
          if(other){ if(!other.connections) other.connections=[]; if(!other.connections.includes(id)) other.connections.push(id); }
        });
        sectorMapSelectedId = id;
        await saveScene(code, cachedScene);
        renderSectorMap(code, onChanged);
        if(onChanged) onChanged();
      };
    }
  }

  // ---------- Player audio: la scena può avere una traccia, ma i browser bloccano
  // l'autoplay finché l'utente non interagisce. Questo widget resta fuori da #scene-live
  // (che viene ricreato ad ogni polling) così l'audio non riparte da capo ad ogni refresh:
  // solo bindSceneAudio() aggiorna la sorgente quando il Master cambia traccia.
  function sceneAudioWidgetHTML(){
    return `<div class="row" id="scene-audio-wrap" style="align-items:center;gap:8px;margin-top:8px;">
      <button class="btn small" id="scene-audio-toggle" disabled>🔇 Nessuna traccia</button>
      <span class="muted" id="scene-audio-status" style="font-size:11px;"></span>
      <audio id="scene-audio-el" loop style="display:none;"></audio>
      <audio id="combat-audio-el" loop style="display:none;"></audio>
    </div>`;
  }
  function bindSceneAudioUpload(code){
    const fileInput = document.getElementById('scene-audio-file');
    const btn = document.getElementById('scene-audio-upload-btn');
    const statusEl = document.getElementById('scene-audio-upload-status');
    if(!fileInput || !btn) return;
    btn.onclick = ()=> fileInput.click();
    fileInput.onchange = async ()=>{
      const file = fileInput.files[0];
      if(!file) return;
      if(!file.type.startsWith('audio/')){ statusEl.textContent = '⚠ Seleziona un file audio.'; fileInput.value=''; return; }
      if(file.size > 3*1024*1024){ statusEl.textContent = '⚠ File troppo grande (limite 3MB): abbassa il bitrate o accorcia la traccia.'; fileInput.value=''; return; }
      statusEl.textContent = 'Caricamento in corso...';
      btn.disabled = true;
      try{
        const dataUrl = await new Promise((resolve, reject)=>{
          const reader = new FileReader();
          reader.onload = ()=> resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        const res = await apiPost('/api/upload', { resource:'audio', code, dataUrl });
        if(res && res.ok && res.url){
          const musicInput = document.getElementById('scene-music');
          if(musicInput) musicInput.value = res.url;
          statusEl.textContent = '✅ Caricata — premi "Aggiorna Scena" qui sotto per salvarla.';
        } else {
          statusEl.textContent = '⚠ Caricamento fallito: ' + (lastApiError || 'errore sconosciuto');
        }
      }catch(e){
        statusEl.textContent = '⚠ Errore durante il caricamento: ' + e.message;
      }
      btn.disabled = false;
      fileInput.value = '';
    };
  }

  // Gemella di bindSceneAudioUpload, ma carica nel campo "URL Musica da Combattimento" invece
  // che in quello della musica normale — stesso endpoint/bucket, stesso limite di 3MB.
  function bindSceneCombatAudioUpload(code){
    const fileInput = document.getElementById('scene-combat-audio-file');
    const btn = document.getElementById('scene-combat-audio-upload-btn');
    const statusEl = document.getElementById('scene-combat-audio-upload-status');
    if(!fileInput || !btn) return;
    btn.onclick = ()=> fileInput.click();
    fileInput.onchange = async ()=>{
      const file = fileInput.files[0];
      if(!file) return;
      if(!file.type.startsWith('audio/')){ statusEl.textContent = '⚠ Seleziona un file audio.'; fileInput.value=''; return; }
      if(file.size > 3*1024*1024){ statusEl.textContent = '⚠ File troppo grande (limite 3MB): abbassa il bitrate o accorcia la traccia.'; fileInput.value=''; return; }
      statusEl.textContent = 'Caricamento in corso...';
      btn.disabled = true;
      try{
        const dataUrl = await new Promise((resolve, reject)=>{
          const reader = new FileReader();
          reader.onload = ()=> resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        const res = await apiPost('/api/upload', { resource:'audio', code, dataUrl });
        if(res && res.ok && res.url){
          const combatMusicInput = document.getElementById('scene-combat-music');
          if(combatMusicInput) combatMusicInput.value = res.url;
          statusEl.textContent = '✅ Caricata — premi "Aggiorna Scena" qui sotto per salvarla.';
        } else {
          statusEl.textContent = '⚠ Caricamento fallito: ' + (lastApiError || 'errore sconosciuto');
        }
      }catch(e){
        statusEl.textContent = '⚠ Errore durante il caricamento: ' + e.message;
      }
      btn.disabled = false;
      fileInput.value = '';
    };
  }

  // La musica può arrivare da quattro livelli, in ordine di priorità: il campo manuale
  // "URL Musica" in Scena (sempre vince se compilato), la traccia del Luogo attuale (il più
  // specifico), la traccia del Settore attuale, la traccia della Macroscena attuale. Così il
  // Master può impostare una musica di default per zona/stanza/singolo luogo, ma può sempre
  // forzarne una diversa a mano per la singola Scena.
  function getEffectiveMusic(scene){
    if(!scene) return '';
    if(scene.music) return scene.music;
    const macroScenes = Array.isArray(scene.macroScenes) ? scene.macroScenes : [];
    const activeMacro = scene.currentMacroSceneId ? macroScenes.find(m=>m.id===scene.currentMacroSceneId) : null;
    const sectors = activeMacro ? (activeMacro.sectors||[]) : [];
    const current = scene.currentSectorId ? sectors.find(s=>s.id===scene.currentSectorId) : null;
    const currentLuogo = (current && scene.currentLuogoId) ? (current.luoghi||[]).find(l=>l.id===scene.currentLuogoId) : null;
    if(currentLuogo && currentLuogo.music) return currentLuogo.music;
    if(current && current.music) return current.music;
    if(activeMacro && activeMacro.music) return activeMacro.music;
    return '';
  }

  // Stessa identica cascata di getEffectiveMusic, ma per la Musica da Combattimento
  // (scene.combatMusic → luogo.combatMusic → settore.combatMusic → macroscena.combatMusic).
  // Se nessuno dei quattro livelli ne ha una impostata, torna stringa vuota: in quel caso il
  // combattimento NON interrompe la musica normale, che continua a suonare così com'è.
  function getEffectiveCombatMusic(scene){
    if(!scene) return '';
    if(scene.combatMusic) return scene.combatMusic;
    const macroScenes = Array.isArray(scene.macroScenes) ? scene.macroScenes : [];
    const activeMacro = scene.currentMacroSceneId ? macroScenes.find(m=>m.id===scene.currentMacroSceneId) : null;
    const sectors = activeMacro ? (activeMacro.sectors||[]) : [];
    const current = scene.currentSectorId ? sectors.find(s=>s.id===scene.currentSectorId) : null;
    const currentLuogo = (current && scene.currentLuogoId) ? (current.luoghi||[]).find(l=>l.id===scene.currentLuogoId) : null;
    if(currentLuogo && currentLuogo.combatMusic) return currentLuogo.combatMusic;
    if(current && current.combatMusic) return current.combatMusic;
    if(activeMacro && activeMacro.combatMusic) return activeMacro.combatMusic;
    return '';
  }

  function bindSceneAudio(scene){
    const btn = document.getElementById('scene-audio-toggle');
    const audioEl = document.getElementById('scene-audio-el');
    const statusEl = document.getElementById('scene-audio-status');
    if(!btn || !audioEl) return;
    const url = getEffectiveMusic(scene);
    if(audioEl.dataset.src !== url){
      const wasPlaying = !audioEl.paused && audioEl.dataset.src;
      audioEl.pause();
      audioEl.src = url;
      audioEl.dataset.src = url;
      btn.disabled = !url;
      if(url){
        btn.textContent = '▶️ Audio Scena';
        if(statusEl) statusEl.textContent = wasPlaying ? '🔄 Traccia cambiata: premi play' : '';
        if(wasPlaying){ audioEl.play().catch(()=>{ if(statusEl) statusEl.textContent = '⚠ Premi play per ascoltare'; }); if(audioEl && !audioEl.paused) btn.textContent = '⏸️ Pausa Audio'; }
      } else {
        btn.textContent = '🔇 Nessuna traccia';
        if(statusEl) statusEl.textContent = '';
      }
    }
    btn.onclick = ()=>{
      if(!audioEl.src) return;
      if(audioEl.paused){
        audioEl.play().then(()=>{ btn.textContent = '⏸️ Pausa Audio'; if(statusEl) statusEl.textContent = ''; })
          .catch(()=>{ if(statusEl) statusEl.textContent = '⚠ Riproduzione bloccata dal browser'; });
      } else {
        audioEl.pause();
        btn.textContent = '▶️ Audio Scena';
      }
    };
  }

  // Se viene passato viewerMember (il membro del roster di chi sta guardando), la scena mostra
  // il SUO Settore/Luogo effettivo (memberEffectiveSectorId/LuogoId) invece di quello del gruppo —
  // così un giocatore separato dal gruppo vede davvero l'immagine e la descrizione di dove si
  // trova lui, non quelle del resto del party. Senza viewerMember (vista Master) mostra il gruppo.
  function sceneHTML(scene, viewerMember){
    const macroScenes = (scene && Array.isArray(scene.macroScenes)) ? scene.macroScenes : [];
    const groupMacro = scene && scene.currentMacroSceneId ? macroScenes.find(m=>m.id===scene.currentMacroSceneId) : null;
    const effSectorId = viewerMember ? memberEffectiveSectorId(viewerMember) : (scene && scene.currentSectorId);
    const effLuogoId = viewerMember ? memberEffectiveLuogoId(viewerMember) : (scene && scene.currentLuogoId);
    const isSeparated = !!(viewerMember && (effSectorId !== (scene && scene.currentSectorId) || effLuogoId !== (scene && scene.currentLuogoId)));
    // Il Settore effettivo di un giocatore separato può appartenere a una Macroscena diversa da
    // quella attiva per il resto del gruppo (vedi il pannello "🧭 Separa in un'altra Macroscena"):
    // lo cerchiamo ovunque invece di limitarci ai Settori della sola Macroscena di gruppo, altrimenti
    // un separato in un'altra Macroscena non vedrebbe sfondo/breadcrumb della propria posizione reale.
    const found = effSectorId ? findSectorAnywhere(scene, effSectorId) : null;
    const current = found ? found.sector : null;
    const activeMacro = found ? found.macro : groupMacro;
    const sectors = activeMacro ? (activeMacro.sectors||[]) : [];
    const currentLuogo = current && effLuogoId ? (current.luoghi||[]).find(l=>l.id===effLuogoId) : null;
    const sectorBadge = current ? `<span class="tag">${current.terrain==='Dangerous'?'☠':(current.terrain==='Difficult'?'⚠':'')} ${escapeHTML(current.terrain)}</span>` : '';
    const separatedBadge = isSeparated ? `<span class="tag" style="color:var(--amber);border-color:var(--amber);">🧭 Ti sei separato dal gruppo</span>` : '';
    const breadcrumb = [activeMacro?activeMacro.name:null, current?current.name:null, currentLuogo?currentLuogo.name:null].filter(Boolean).map(escapeHTML).join(' → ');
    const sectorHTML = current ? `
      <div class="hud-frame card" style="margin-top:8px;padding:8px 10px;">
        <div class="flex-between" style="flex-wrap:wrap;gap:6px;"><span class="mono" style="color:var(--cyan);">📍 ${breadcrumb}</span><span style="display:flex;flex-wrap:wrap;gap:4px;">${sectorBadge}${separatedBadge}</span></div>
        ${currentLuogo && currentLuogo.description ? `<div class="sub" style="margin-top:4px;">${escapeHTML(currentLuogo.description)}</div>` : (current.description ? `<div class="sub" style="margin-top:4px;">${escapeHTML(current.description)}</div>` : '')}
        ${!currentLuogo && (current.luoghi||[]).length>0 ? `<div class="muted" style="margin-top:4px;font-size:11px;">Luoghi qui: ${(current.luoghi||[]).map(l=>escapeHTML(l.name)).join(', ')}</div>` : ''}
        <div class="muted" style="margin-top:4px;font-size:11px;">Puoi raggiungere: ${(current.connections||[]).map(cid=>{ const c=sectors.find(x=>x.id===cid); return c?escapeHTML(c.name):''; }).filter(Boolean).join(', ') || 'nessun altro settore collegato'}</div>
      </div>
    ` : '';
    const bgImage = (currentLuogo && currentLuogo.image) || (current && current.image) || (scene && scene.background) || '';
    if(!scene || (!bgImage && !scene.title)){
      return `<div class="scene-box"><div class="scene-empty">Nessuna scena impostata dal Master</div></div>` + sectorHTML + encountersReadonlyHTML(scene);
    }
    return `
      <div class="scene-box" ${bgImage?`data-scene-img-expand="${escapeAttr(bgImage)}"`:''}>
        ${bgImage ? `<img class="bg" src="${escapeAttr(bgImage)}" onerror="this.style.display='none'" />` : ''}
        <div class="overlay"></div>
        ${bgImage ? `<div class="scene-expand-hint">🔍</div>` : ''}
        ${scene.title ? `<div class="title">${escapeHTML(scene.title)}</div>` : ''}
      </div>
    ` + sectorHTML + encountersReadonlyHTML(scene);
  }

  function getEncImgLarge(){ try{ return localStorage.getItem('digivice_enc_img_large')==='1'; }catch(e){ return false; } }
  function setEncImgLarge(v){ try{ localStorage.setItem('digivice_enc_img_large', v?'1':'0'); }catch(e){} }

  function encountersReadonlyHTML(scene){
    const enc = (scene && Array.isArray(scene.encounters)) ? scene.encounters.map(normalizeEncounter) : [];
    const visible = enc.filter(e=>e.revealed!==false);
    if(visible.length===0) return '';
    // Group visually-identical entries (same name/stage/image) so duplicates show a ×N counter instead of repeating.
    const groups = [];
    visible.forEach(e=>{
      const key = e.name.trim().toLowerCase()+'|'+(e.stage||'')+'|'+(e.image||'');
      let g = groups.find(x=>x.key===key);
      if(!g){ g = { key, name:e.name, stage:e.stage, image:e.image, isBoss:false, count:0, single:e }; groups.push(g); }
      g.count++;
      if(e.isBoss) g.isBoss = true;
    });
    const large = getEncImgLarge();
    const imgSize = large ? 56 : 30;
    return `
      <div style="margin-top:8px;">
        <button type="button" class="btn ghost small" data-toggle-enc-size style="margin-bottom:8px;">${large?'🔎 Immagini più piccole':'🔍 Immagini più grandi'}</button>
        <div style="display:flex;flex-wrap:wrap;gap:10px;">
          ${groups.map(g=>{
            // Una barra vita si mostra solo per un individuo singolo: per un gruppo (×N) le Ferite si tracciano nel Combat Manager una volta ingaggiati.
            const showHp = g.count===1 && encounterMaxWounds(g.single) > 1;
            const cardW = showHp ? Math.max(imgSize+18, 90) : imgSize+18;
            const hpRow = showHp ? `<div style="width:100%;">${miniHpBarHTML(encounterCurrentWounds(g.single), encounterMaxWounds(g.single))}</div>` : '';
            return `
            <div class="enc-card-mini" data-enc-name="${escapeAttr(g.name)}" style="cursor:pointer;width:${cardW}px;padding:4px;border-radius:8px;border:2px solid ${g.isBoss?'var(--danger)':'transparent'};position:relative;" title="Clicca per i dettagli">
              ${g.count>1 ? `<span style="position:absolute;top:-4px;right:0px;background:var(--cyan);color:#04211c;font-size:9px;font-weight:700;border-radius:8px;padding:1px 5px;">×${g.count}</span>` : ''}
              ${g.image ? `<img src="${escapeAttr(g.image)}" onerror="this.style.display='none'" style="width:${imgSize}px;height:${imgSize}px;object-fit:cover;border-radius:6px;" />` : `<div style="width:${imgSize}px;height:${imgSize}px;display:flex;align-items:center;justify-content:center;background:var(--panel-2);border-radius:6px;color:var(--text-mute);font-size:16px;">${escapeHTML((g.name||'?')[0]||'?')}</div>`}
              <div style="font-size:10px;text-align:center;margin-top:3px;line-height:1.2;">${escapeHTML(g.name)}</div>
              ${hpRow}
            </div>
          `;}).join('')}
        </div>
      </div>
    `;
  }

  function isInDex(name){
    return cachedDex.some(e=>String(e.name).trim().toLowerCase()===String(name).trim().toLowerCase());
  }

  function encountersEditableHTML(list){
    const items = (list||[]).map(normalizeEncounter);
    if(items.length===0) return '<div class="muted">Nessun Digimon ancora aggiunto a questa scena.</div>';
    return items.map((e,i)=>{
      const already = !!e.dexId || isInDex(e.name);
      const visible = e.revealed!==false;
      const maxW = encounterMaxWounds(e);
      const curW = encounterCurrentWounds(e);
      const disp = ENCOUNTER_DISPOSITIONS[e.disposition] || ENCOUNTER_DISPOSITIONS.enemy;
      return `
        <div class="roster-item" style="padding:6px 8px;margin-bottom:6px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;${e.isBoss?'border-color:var(--danger);':''}border-left:3px solid ${disp.color};">
          ${(()=>{ const img = bestDigimonImage(e.dexId, e.name, e.gif || e.image); return img ? `<img src="${escapeAttr(img)}" onerror="this.style.display='none'" style="width:32px;height:32px;object-fit:cover;border-radius:4px;flex-shrink:0;" />` : ''; })()}
          <div style="flex:1;min-width:140px;">
            <div><b>${escapeHTML(e.name)}</b> ${e.stage?`<span class="tag">${escapeHTML(e.stage)}</span>`:''}${attributeIconHTML(dexAttributeFor(e.dexId, e.name), 14)}<button class="tag" data-cycle-disposition="${i}" style="cursor:pointer;color:${disp.color};border-color:${disp.color};background:none;" title="Clicca per cambiare (Nemico/Alleato/Neutrale) — si riflette nell'aggiunta al combattimento">${disp.icon} ${disp.label}</button>${e.isBoss?`<span class="tag" style="color:var(--danger);border-color:var(--danger);">👑 Boss</span>`:''}${(e.categories||[]).map(c=>`<span class="tag" style="font-size:9px;">${escapeHTML(c)}</span>`).join('')}</div>
            <div class="muted" style="font-size:11px;">${visible ? '👁️ Visibile ai giocatori' : '🙈 Nascosto — solo il Master lo vede'}</div>
            <div style="display:flex;align-items:center;gap:6px;max-width:220px;">
              ${miniHpBarHTML(curW, maxW)}
              <div class="bar-controls" style="margin-top:5px;">
                <button data-enchp-minus="${i}">−</button>
                <button data-enchp-plus="${i}">+</button>
              </div>
            </div>
            ${(e.attacks && e.attacks.length) ? `
            <details style="margin-top:4px;">
              <summary class="muted" style="font-size:11px;cursor:pointer;">⚔️ ${e.attacks.length} Attacchi (importati dal Digidex)</summary>
              <div style="margin-top:4px;">
                ${e.attacks.map(a=>`
                  <div style="margin-bottom:4px;padding:4px 6px;background:var(--panel-2);border-radius:4px;">
                    <div>${a.signature?'⭐ ':''}<b style="font-size:11px;">${escapeHTML(a.name)}</b> ${attackTagsHTML(a)}</div>
                    ${a.desc ? `<div class="muted" style="font-size:10.5px;margin-top:2px;">${escapeHTML(a.desc)}</div>` : ''}
                  </div>
                `).join('')}
              </div>
            </details>` : ''}
          </div>
          <button class="btn ${e.isBoss?'':'ghost'} small" data-toggle-boss="${i}" style="padding:4px 8px;font-size:10px;">${e.isBoss?'👑 Rimuovi Boss':'👑 Segna Boss'}</button>
          <button class="btn ${visible?'ghost':''} small" data-toggle-reveal="${i}" style="padding:4px 8px;font-size:10px;">${visible?'🙈 Nascondi':'👁️ Mostra ai giocatori'}</button>
          <button class="btn ghost small" data-dupe-enc="${i}" style="padding:4px 8px;font-size:10px;" title="Aggiunge una copia identica">+1 copia</button>
          ${already ? `<button class="btn ghost small" data-refresh-atk="${i}" style="padding:4px 8px;font-size:10px;" title="Ricarica Attacchi + Immagine/GIF dal Digidex — utile se sono stati aggiornati o se erano stati importati prima di una correzione">🔄 Sincronizza da Dex</button>` : ''}
          ${already ? '' : `<button class="btn small" data-quickdex="${i}" style="padding:4px 8px;font-size:10px;">+Dex</button>`}
          <button class="btn ghost small" data-rmenc="${i}" style="padding:4px 8px;font-size:10px;">×</button>
        </div>
      `;
    }).join('');
  }

  function renderEncounterDraftCard(){
    const cardEl = document.getElementById('encounter-draft-card');
    if(!cardEl) return;
    if(!encounterDraft){ cardEl.innerHTML = ''; return; }
    const d = encounterDraft;
    cardEl.innerHTML = `
      <div class="hud-frame" style="padding:10px 12px;">
        <div class="muted" style="margin-bottom:6px;">${d.dexId ? '📖 Trovato nel Digidex — controlla i valori prima di confermare:' : '✏️ Non presente nel Digidex — Digimon homebrew, compila i valori:'}</div>
        <div class="row">
          <div class="field" style="flex:2;"><label>Nome</label><input type="text" id="draft-name" value="${escapeAttr(d.name)}" /></div>
          <div class="field" style="flex:1;"><label>Stage</label>
            <select id="draft-stage">${['Baby','Rookie','Champion','Ultimate','Mega'].map(s=>`<option ${d.stage===s?'selected':''}>${s}</option>`).join('')}</select>
          </div>
        </div>
        <div class="row">
          <div class="field" style="flex:1;"><label>Attributo</label>
            <select id="draft-attribute">
              <option value="">— nessuno —</option>
              ${DEX_ATTRIBUTES.map(a=>`<option value="${a}" ${splitCategoriesAttribute(d.categories).attribute===a?'selected':''}>${a}</option>`).join('')}
            </select>
          </div>
          <div class="field" style="flex:2;"><label>Famiglia (separate da virgola, es. Deva, Angelo)</label><input type="text" id="draft-family" value="${escapeAttr(splitCategoriesAttribute(d.categories).family.join(', '))}" /></div>
        </div>
        <div class="field"><label>URL Immagine</label><input type="text" id="draft-image" value="${escapeAttr(d.image)}" placeholder="https://..." /></div>
        <div class="field"><label>Descrizione</label><textarea id="draft-desc" rows="2">${escapeHTML(d.description)}</textarea></div>
        <div class="muted" style="margin:6px 0 4px;">Stat base (puoi lasciarle a 0 e completarle dopo)</div>
        <div class="row">
          <div class="field"><label>Accuracy</label><input type="number" id="draft-acc" value="${d.baseStats.baseAccuracy||0}" min="0" /></div>
          <div class="field"><label>Damage</label><input type="number" id="draft-dmg" value="${d.baseStats.baseDamage||0}" min="0" /></div>
        </div>
        <div class="row">
          <div class="field"><label>Dodge</label><input type="number" id="draft-dodge" value="${d.baseStats.baseDodge||0}" min="0" /></div>
          <div class="field"><label>Armor</label><input type="number" id="draft-arm" value="${d.baseStats.baseArmor||0}" min="0" /></div>
        </div>
        <div class="field"><label>Health</label><input type="number" id="draft-hp" value="${d.baseStats.baseHealth||0}" min="0" /></div>
        <label style="font-size:11px;display:flex;align-items:center;gap:6px;margin:8px 0;"><input type="checkbox" id="draft-isboss" ${d.isBoss?'checked':''} /> 👑 Boss (bordo rosso nella scena)</label>
        <div class="row" style="margin-top:6px;">
          <button class="btn solid small" id="btn-confirm-encounter" style="flex:2;">✅ Conferma e Aggiungi alla Scena</button>
          <button class="btn ghost small" id="btn-cancel-encounter" style="flex:1;">Annulla</button>
        </div>
      </div>
    `;
  }

  function bindEncounterDraftCard(code, username, onChanged){
    const confirmBtn = document.getElementById('btn-confirm-encounter');
    if(confirmBtn) confirmBtn.onclick = async ()=>{
      const name = document.getElementById('draft-name').value.trim();
      if(!name) return;
      const attribute = document.getElementById('draft-attribute').value;
      const family = document.getElementById('draft-family').value.split(',').map(s=>s.trim()).filter(Boolean);
      const categories = [attribute, ...family].filter(Boolean);
      const image = document.getElementById('draft-image').value.trim();
      const description = document.getElementById('draft-desc').value.trim();
      const stage = document.getElementById('draft-stage').value;
      const isBoss = document.getElementById('draft-isboss').checked;
      const baseStats = {
        baseAccuracy: Number(document.getElementById('draft-acc').value)||0,
        baseDamage: Number(document.getElementById('draft-dmg').value)||0,
        baseDodge: Number(document.getElementById('draft-dodge').value)||0,
        baseArmor: Number(document.getElementById('draft-arm').value)||0,
        baseHealth: Number(document.getElementById('draft-hp').value)||0
      };
      const finalEncounter = { id: encounterDraft.id, name, dexId: encounterDraft.dexId, stage, categories, image, description, baseStats, attacks: encounterDraft.attacks || [], revealed:false, isBoss };
      cachedScene.encounters = cachedScene.encounters || [];
      cachedScene.encounters.push(finalEncounter);
      encounterDraft = null;
      await saveScene(code, cachedScene);
      const searchInput = document.getElementById('encounter-search');
      if(searchInput) searchInput.value='';
      document.getElementById('encounters-live').innerHTML = encountersEditableHTML(cachedScene.encounters);
      bindEncountersInnerActions(code, username, onChanged);
      renderEncounterDraftCard();
      if(onChanged) onChanged();
    };
    const cancelBtn = document.getElementById('btn-cancel-encounter');
    if(cancelBtn) cancelBtn.onclick = ()=>{ encounterDraft = null; renderEncounterDraftCard(); };
  }

  function bindEncountersPanel(code, username, onChanged){
    const prepBtn = document.getElementById('btn-prepare-encounter');
    if(prepBtn){
      prepBtn.onclick = ()=>{
        const input = document.getElementById('encounter-search');
        const name = input.value.trim();
        if(!name) return;
        const dexMatch = cachedDex.find(e=>String(e.name).trim().toLowerCase()===name.toLowerCase());
        encounterDraft = dexMatch ? {
          id:'enc'+Date.now()+Math.random().toString(36).slice(2,6),
          name: dexMatch.name,
          dexId: dexMatch.id,
          stage: dexMatch.stage || 'Rookie',
          categories: (dexMatch.categories||[]).slice(),
          image: dexMatch.image_url || '',
          description: dexMatch.description || '',
          baseStats: Object.assign({baseAccuracy:0,baseDamage:0,baseDodge:0,baseArmor:0,baseHealth:0}, dexMatch.base_stats||{}),
          attacks: buildAttacksFromDexEntry(dexMatch),
          revealed:false, isBoss:false
        } : {
          id:'enc'+Date.now()+Math.random().toString(36).slice(2,6),
          name, dexId:null, stage:'Rookie', categories:[], image:'', description:'',
          baseStats:{baseAccuracy:0,baseDamage:0,baseDodge:0,baseArmor:0,baseHealth:0}, attacks:[], revealed:false, isBoss:false
        };
        renderEncounterDraftCard();
        bindEncounterDraftCard(code, username, onChanged);
      };
    }
    const refreshAllBtn = document.getElementById('btn-refresh-all-atk');
    if(refreshAllBtn){
      refreshAllBtn.onclick = async ()=>{
        let updated = 0, skipped = 0;
        (cachedScene.encounters||[]).forEach(e=>{
          const dexMatch = (e.dexId && cachedDex.find(d=>d.id===e.dexId)) || cachedDex.find(d=>String(d.name).trim().toLowerCase()===String(e.name).trim().toLowerCase());
          if(dexMatch){
            e.attacks = buildAttacksFromDexEntry(dexMatch);
            // Risincronizza anche l'immagine/GIF: senza questo, un Incontro già in scena resta
            // ancorato allo snapshot preso al momento dell'aggiunta, anche se nel frattempo il
            // Digidex ha ricevuto una GIF (es. dopo il fix di dex.js).
            e.image = dexMatch.image_url || '';
            e.gif = dexMatch.gif_url || '';
            updated++;
          } else skipped++;
        });
        await saveScene(code, cachedScene);
        document.getElementById('encounters-live').innerHTML = encountersEditableHTML(cachedScene.encounters);
        bindEncountersInnerActions(code, username, onChanged);
        if(onChanged) onChanged();
        alert(`Attacchi e immagini/GIF ricaricati per ${updated} Digimon.${skipped>0?` ${skipped} non trovati nel Digidex (nomi non corrispondenti).`:''}`);
      };
    }
    bindEncountersInnerActions(code, username, onChanged);
  }

  function bindEncountersInnerActions(code, username, onChanged){
    const live = document.getElementById('encounters-live');
    if(!live) return;
    live.querySelectorAll('[data-rmenc]').forEach(btn=>{
      btn.onclick = async ()=>{
        const idx = Number(btn.getAttribute('data-rmenc'));
        cachedScene.encounters.splice(idx,1);
        await saveScene(code, cachedScene);
        live.innerHTML = encountersEditableHTML(cachedScene.encounters);
        bindEncountersInnerActions(code, username, onChanged);
        if(onChanged) onChanged();
      };
    });
    live.querySelectorAll('[data-toggle-reveal]').forEach(btn=>{
      btn.onclick = async ()=>{
        const idx = Number(btn.getAttribute('data-toggle-reveal'));
        const e = cachedScene.encounters[idx];
        if(!e) return;
        const isVisible = e.revealed!==false;
        e.revealed = !isVisible;
        await saveScene(code, cachedScene);
        live.innerHTML = encountersEditableHTML(cachedScene.encounters);
        bindEncountersInnerActions(code, username, onChanged);
        if(onChanged) onChanged();
      };
    });
    live.querySelectorAll('[data-toggle-boss]').forEach(btn=>{
      btn.onclick = async ()=>{
        const idx = Number(btn.getAttribute('data-toggle-boss'));
        const e = cachedScene.encounters[idx];
        if(!e) return;
        e.isBoss = !e.isBoss;
        await saveScene(code, cachedScene);
        live.innerHTML = encountersEditableHTML(cachedScene.encounters);
        bindEncountersInnerActions(code, username, onChanged);
        if(onChanged) onChanged();
      };
    });
    live.querySelectorAll('[data-cycle-disposition]').forEach(btn=>{
      btn.onclick = async ()=>{
        const idx = Number(btn.getAttribute('data-cycle-disposition'));
        const e = cachedScene.encounters[idx];
        if(!e) return;
        const order = ['enemy','ally','neutral'];
        const cur = order.indexOf(e.disposition||'enemy');
        e.disposition = order[(cur+1) % order.length];
        await saveScene(code, cachedScene);
        live.innerHTML = encountersEditableHTML(cachedScene.encounters);
        bindEncountersInnerActions(code, username, onChanged);
        if(onChanged) onChanged();
      };
    });
    live.querySelectorAll('[data-refresh-atk]').forEach(btn=>{
      btn.onclick = async ()=>{
        const idx = Number(btn.getAttribute('data-refresh-atk'));
        const e = cachedScene.encounters[idx];
        if(!e) return;
        const dexMatch = (e.dexId && cachedDex.find(d=>d.id===e.dexId)) || cachedDex.find(d=>String(d.name).trim().toLowerCase()===String(e.name).trim().toLowerCase());
        if(!dexMatch){
          alert(`Nessuna voce del Digidex corrisponde a "${e.name}" — impossibile ricaricare gli Attacchi.`);
          return;
        }
        e.attacks = buildAttacksFromDexEntry(dexMatch);
        e.image = dexMatch.image_url || '';
        e.gif = dexMatch.gif_url || '';
        await saveScene(code, cachedScene);
        live.innerHTML = encountersEditableHTML(cachedScene.encounters);
        bindEncountersInnerActions(code, username, onChanged);
        if(onChanged) onChanged();
      };
    });
    live.querySelectorAll('[data-dupe-enc]').forEach(btn=>{
      btn.onclick = async ()=>{
        const idx = Number(btn.getAttribute('data-dupe-enc'));
        const e = cachedScene.encounters[idx];
        if(!e) return;
        const copy = Object.assign({}, e, { id:'enc'+Date.now()+Math.random().toString(36).slice(2,6), currentWounds:null });
        cachedScene.encounters.splice(idx+1, 0, copy);
        await saveScene(code, cachedScene);
        live.innerHTML = encountersEditableHTML(cachedScene.encounters);
        bindEncountersInnerActions(code, username, onChanged);
        if(onChanged) onChanged();
      };
    });
    live.querySelectorAll('[data-enchp-minus]').forEach(btn=>{
      btn.onclick = async ()=>{
        const idx = Number(btn.getAttribute('data-enchp-minus'));
        const e = cachedScene.encounters[idx];
        if(!e) return;
        e.currentWounds = Math.max(0, encounterCurrentWounds(e)-1);
        await saveScene(code, cachedScene);
        live.innerHTML = encountersEditableHTML(cachedScene.encounters);
        bindEncountersInnerActions(code, username, onChanged);
        if(onChanged) onChanged();
      };
    });
    live.querySelectorAll('[data-enchp-plus]').forEach(btn=>{
      btn.onclick = async ()=>{
        const idx = Number(btn.getAttribute('data-enchp-plus'));
        const e = cachedScene.encounters[idx];
        if(!e) return;
        e.currentWounds = Math.min(encounterMaxWounds(e), encounterCurrentWounds(e)+1);
        await saveScene(code, cachedScene);
        live.innerHTML = encountersEditableHTML(cachedScene.encounters);
        bindEncountersInnerActions(code, username, onChanged);
        if(onChanged) onChanged();
      };
    });
    live.querySelectorAll('[data-quickdex]').forEach(btn=>{
      btn.onclick = async ()=>{
        const idx = Number(btn.getAttribute('data-quickdex'));
        const e = cachedScene.encounters[idx];
        const name = encName(e);
        const d = await addDexEntry(code, {
          name,
          stage: (e && e.stage) || 'Rookie',
          description: (e && e.description) || '',
          imageUrl: (e && e.image) || '',
          addedBy: username,
          categories: (e && e.categories) || [],
          baseStats: (e && e.baseStats) || {},
          discovered: true
        });
        if(d && d.entry){
          cachedDex.push(d.entry);
          if(e && typeof e === 'object') e.dexId = d.entry.id;
          live.innerHTML = encountersEditableHTML(cachedScene.encounters);
          bindEncountersInnerActions(code, username, onChanged);
          const dexLive = document.getElementById('dex-live');
          if(dexLive){ dexLive.innerHTML = dexListHTML(cachedDex, true); bindDexEditButtons(code); }
        }
      };
    });
  }

  // Risolve l'avatar da mostrare in chat per ogni entry del log. Per i player usa la miniatura
  // del Tamer (imageThumbUrl → imageUrl); per i digimon usa bestDigimonImage (gif se disponibile);
  // per NPC/enemy/gm usa l.meta.avatar (già presente). Restituisce un URL o ''.
  // (mentionButtonHTML/bindMentionButton/openMentionPicker, speakAsFieldHTML/attachSpeakAsButton/openSpeakAsPicker, openMentionDetail/showMentionDetailModal) spostati in js/chat-composer.js
  // Le "evolutions" di una voce Digidex sono oggetti { name, imageUrl, ... }, non semplici stringhe.
  // Estrae sempre il nome in modo sicuro, altrimenti finisce per stampare "[object Object]" a video
  // (ed è quello che finiva salvato dentro unlockedEvolutions dalla checkbox del Master).
  function evoName(ev){ if(ev==null) return ''; return typeof ev==='string' ? ev : String(ev.name||''); }
  // Specchio di digimon.html: spacca le mosse del Digidex ("Nome — [TAG][TAG]") nello schema attacks.
  function parseDexAttackString(raw){
    if(!raw) return null;
    const dashSplit = raw.split(/\s+—\s+/);
    const name = (dashSplit[0] || raw).trim();
    if(!name) return null;
    const tagBlock = dashSplit.slice(1).join(' — ');
    const tags = Array.from(tagBlock.matchAll(/\[([^\]]+)\]/g)).map(m=>m[1].trim());
    const shape = tags.some(t=>/^MELEE$/i.test(t)) ? 'Melee' : 'Range';
    const hasDamage = tags.some(t=>/^DAMAGE/i.test(t));
    const type = hasDamage ? 'Damage' : 'Support';
    // BUG STORICO: un Tag come [FEAR] o [SLOW] nel testo veniva mostrato come semplice etichetta
    // ma non era mai collegato a un vero effectKey — quindi ogni Attacco [SUPPORT] importato dal
    // Digidex non applicava MAI il suo Effetto in combattimento, nonostante il testo lo dichiarasse.
    // Ora riconosciamo automaticamente il primo Tag che corrisponde a un'etichetta di EFFECT_DEFS
    // (es. "[FEAR]", anche con numero dietro tipo "[FEAR 2]") e lo agganciamo.
    // EFFECT_TAG_ALIASES copre varianti di testo già presenti nel Digidex che non coincidono
    // esattamente con l'etichetta interna (es. "[CONFUSION]" nel testo vs chiave 'confuse').
    let effectKey = '';
    for(const t of tags){
      const word = t.split(/\s+/)[0].toUpperCase();
      const aliasKey = EFFECT_TAG_ALIASES[word];
      if(aliasKey){ effectKey = aliasKey; break; }
      const match = EFFECT_DEFS.find(d=>d.label.toUpperCase()===word);
      if(match){ effectKey = match.key; break; }
    }
    const extraTags = tags.filter(t=>!/^MELEE$/i.test(t) && !/^RANGE$/i.test(t)).join(' · ');
    return { name, shape, type, extraTags, effectKey };
  }
  // Rilegge TUTTO il Digidex con la stessa logica di parseDexAttackString usata in combattimento
  // (quindi cattura automaticamente anche gli alias tipo CONFUSION→confuse) e segnala ogni mossa
  // [SUPPORT] il cui Tag di Effetto non corrisponde a nessuno dei 45 Effetti ufficiali — che sia
  // per un refuso nel testo, un tag inventato, o perché manca del tutto.
  function buildAttacksFromDexEntry(dexEntry){
    if(!dexEntry) return [];
    const list = [];
    const addMove = (raw, desc, signature) => {
      const parsed = parseDexAttackString(raw);
      if(!parsed) return;
      list.push({ name: parsed.name, shape: parsed.shape, type: parsed.type, effectKey: parsed.effectKey || '', extraTags: parsed.extraTags, desc: desc||'', signature: !!signature, reach: parsed.shape==='Range'?1:0, areaAttack:false });
    };
    if(dexEntry.signature_move) addMove(dexEntry.signature_move, dexEntry.attack_desc, true);
    (dexEntry.extra_attacks||[]).forEach(ea=>{ if(ea && ea.move) addMove(ea.move, ea.desc, false); });
    if(dexEntry.signature_move_2) addMove(dexEntry.signature_move_2, dexEntry.attack_desc_2, true);
    return list;
  }

  // (normalizeEncounter, ENCOUNTER_DISPOSITIONS, encounterMaxWounds, encounterCurrentWounds, encName) spostati in js/encounters.js

  function findCurrentSector(){
    if(!cachedScene.currentSectorId) return null;
    for(const m of (cachedScene.macroScenes||[])){
      const s = (m.sectors||[]).find(x=>x.id===cachedScene.currentSectorId);
      if(s) return s;
    }
    return null;
  }

  function sceneCurrentSectorLuoghiHTML(){
    const s = findCurrentSector();
    if(!s) return '<div class="muted" style="font-size:11px;">Nessun Settore attuale impostato (gestiscilo dal pannello Mappa qui sotto).</div>';
    const luoghi = s.luoghi || [];
    if(luoghi.length===0) return `<div class="muted" style="font-size:11px;">Il Settore attuale ("${escapeHTML(s.name)}") non ha Luoghi specifici.</div>`;
    return luoghi.map(lg=>{
      const isCurrent = cachedScene.currentLuogoId===lg.id;
      return `
        <div class="flex-between" style="padding:4px 6px;margin-top:3px;background:rgba(255,255,255,0.03);border-radius:6px;">
          <span style="font-size:12px;display:flex;align-items:center;gap:5px;">
            ${lg.image?`<img src="${escapeAttr(lg.image)}" onerror="this.style.display='none'" style="width:18px;height:18px;object-fit:cover;border-radius:3px;" />`:''}
            ${escapeHTML(lg.name)} ${isCurrent?'<span class="tag" style="color:var(--cyan);border-color:var(--cyan);font-size:9px;">📍 Attuale</span>':''}
          </span>
          <span>
            <button class="btn ${isCurrent?'ghost':''} small" data-scene-luogo-activate="${lg.id}" style="padding:2px 6px;font-size:10px;">${isCurrent?'Attivo':'📍 Attiva'}</button>
            <button class="btn ghost small" data-scene-luogo-reveal="${lg.id}" style="padding:2px 6px;font-size:10px;">${lg.revealed?'🙈 Nascondi':'👁️ Rivela'}</button>
          </span>
        </div>
      `;
    }).join('');
  }

  function bindSceneCurrentSectorLuoghi(code){
    const el = document.getElementById('scene-luoghi-live');
    if(!el) return;
    el.querySelectorAll('[data-scene-luogo-activate]').forEach(btn=>{
      btn.onclick = async ()=>{
        const luogoId = btn.getAttribute('data-scene-luogo-activate');
        const s = findCurrentSector();
        if(!s) return;
        const lg = (s.luoghi||[]).find(x=>x.id===luogoId);
        if(!lg) return;
        cachedScene.currentLuogoId = luogoId;
        lg.revealed = true;
        await saveScene(code, cachedScene);
        el.innerHTML = sceneCurrentSectorLuoghiHTML();
        bindSceneCurrentSectorLuoghi(code);
        if(onChanged) onChanged();
      };
    });
    el.querySelectorAll('[data-scene-luogo-reveal]').forEach(btn=>{
      btn.onclick = async ()=>{
        const luogoId = btn.getAttribute('data-scene-luogo-reveal');
        const s = findCurrentSector();
        if(!s) return;
        const lg = (s.luoghi||[]).find(x=>x.id===luogoId);
        if(!lg) return;
        lg.revealed = !lg.revealed;
        await saveScene(code, cachedScene);
        el.innerHTML = sceneCurrentSectorLuoghiHTML();
        bindSceneCurrentSectorLuoghi(code);
      };
    });
  }

  // ---------- SCENE ENCOUNTER DETAIL: click-to-inspect modal (players & master) ----------
  function closeEncounterDetail(){
    const modal = document.getElementById('enc-detail-modal');
    if(modal) modal.remove();
  }

  function evoUnlockedHTML(ev){
    const dexMatch = cachedDex.find(d=>String(d.name).trim().toLowerCase()===String(ev.name).trim().toLowerCase());
    const unlocked = !!(dexMatch && dexMatch.discovered);
    if(unlocked){
      return `<div style="display:flex;flex-direction:column;align-items:center;width:56px;">
        ${portraitHTML(ev.imageUrl, ev.name, 'sm')}
        <div class="muted" style="font-size:10px;text-align:center;margin-top:2px;">${escapeHTML(ev.name)}</div>
      </div>`;
    }
    return `<div style="display:flex;flex-direction:column;align-items:center;width:56px;">
      <div class="portrait-sm" style="display:flex;align-items:center;justify-content:center;color:var(--text-mute);font-size:20px;">❓</div>
      <div class="muted" style="font-size:10px;text-align:center;margin-top:2px;">???</div>
    </div>`;
  }

  async function openEncounterDetail(name, code, username){
    const e = (cachedScene.encounters||[]).map(normalizeEncounter).find(x=>x.revealed!==false && x.name.trim().toLowerCase()===String(name).trim().toLowerCase());
    if(!e) return;
    // Auto-register in the Digidex the moment someone looks this Digimon up, since they've now "met" it.
    let dexMatch = cachedDex.find(d=>String(d.name).trim().toLowerCase()===e.name.trim().toLowerCase());
    try{
      if(!dexMatch){
        const d = await addDexEntry(code, {
          name: e.name, stage: e.stage||'Rookie', description: e.description||'', imageUrl: e.image||'',
          categories: e.categories||[], baseStats: e.baseStats||{}, addedBy: username, discovered: true
        });
        if(d && d.entry){ cachedDex.push(d.entry); dexMatch = d.entry; }
      } else if(!dexMatch.discovered){
        const ok = await updateDexEntry(code, dexMatch.id, {
          name: dexMatch.name, stage: dexMatch.stage, description: dexMatch.description,
          imageUrl: dexMatch.image_url, categories: dexMatch.categories||[], baseStats: dexMatch.base_stats||{},
          evolutions: dexMatch.evolutions||[], qualities: dexMatch.qualities||[], dpTotal: dexMatch.dp_total||0,
          discovered: true
        });
        if(ok) dexMatch.discovered = true;
      }
      const dexLive = document.getElementById('dex-live');
      if(dexLive) dexLive.innerHTML = dexListHTML(cachedDex, session && session.role==='master');
    }catch(err){ /* non-blocking: still show the detail card even if auto-registration fails */ }

    const evolutions = (dexMatch && Array.isArray(dexMatch.evolutions)) ? dexMatch.evolutions : [];
    // Pre-evolutions: any Dex entry that lists this name among ITS evolutions.
    const preEvolutions = cachedDex
      .filter(d => Array.isArray(d.evolutions) && d.evolutions.some(ev => String(ev.name).trim().toLowerCase() === e.name.trim().toLowerCase()))
      .map(d => ({ name: d.name, imageUrl: d.image_url }));
    const description = e.description || (dexMatch && dexMatch.description) || '';
    const categories = (dexMatch && dexMatch.categories && dexMatch.categories.length) ? dexMatch.categories : (e.categories||[]);
    const { attribute, family } = splitCategoriesAttribute(categories);
    const oldModal = document.getElementById('enc-detail-modal');
    if(oldModal) oldModal.remove();
    const modal = document.createElement('div');
    modal.id = 'enc-detail-modal';
    modal.className = 'enc-modal-backdrop';
    modal.innerHTML = `
      <div class="enc-modal-card hud-frame">
        <button class="btn ghost small" id="enc-modal-close" style="position:absolute;top:8px;right:8px;">✕</button>
        ${e.image ? `<div class="enc-modal-img-wrap"><img src="${escapeAttr(e.image)}" onerror="this.style.display='none'" class="enc-modal-img" /></div>` : ''}
        <div class="flex-between" style="margin-top:10px;">
          <b style="font-size:16px;">${escapeHTML(e.name)}</b>
          <span>${e.stage?`<span class="tag">${escapeHTML(e.stage)}</span>`:''}${e.isBoss?`<span class="tag" style="color:var(--danger);border-color:var(--danger);">👑 Boss</span>`:''}</span>
        </div>
        ${(attribute || family.length) ? `<div style="margin-top:4px;display:flex;flex-wrap:wrap;gap:4px;">${attributeBadgeHTML(attribute)}${family.map(c=>`<span class="tag" style="font-size:9px;">${escapeHTML(c)}</span>`).join('')}</div>` : ''}
        ${description ? `<div class="sub" style="margin-top:8px;">${escapeHTML(description)}</div>` : '<div class="muted" style="margin-top:8px;">Nessuna descrizione disponibile.</div>'}
        ${preEvolutions.length ? `
          <div class="muted" style="margin-top:14px;margin-bottom:4px;">Pre-Evoluzioni</div>
          <div style="display:flex;flex-wrap:wrap;gap:8px;">${preEvolutions.map(ev=>evoUnlockedHTML(ev)).join('')}</div>
        ` : ''}
        ${evolutions.length ? `
          <div class="muted" style="margin-top:14px;margin-bottom:4px;">Possibili Evoluzioni</div>
          <div style="display:flex;flex-wrap:wrap;gap:8px;">${evolutions.map(ev=>evoUnlockedHTML(ev)).join('')}</div>
        ` : ''}
      </div>
    `;
    document.body.appendChild(modal);
    document.getElementById('enc-modal-close').onclick = closeEncounterDetail;
    modal.onclick = (ev)=>{ if(ev.target===modal) closeEncounterDetail(); };
  }

  function rerenderSceneLive(){
    const el = document.getElementById('scene-live');
    const pinEl = document.getElementById('scene-pin-live');
    if(!el && !pinEl) return;
    const sceneViewer = (session && session.role==='player') ? (cachedRoster.find(m=>m.username===session.username) || cachedMe) : null;
    if(el) el.innerHTML = `<div class="muted mono" style="margin-bottom:8px;">${onlineSummary(cachedRoster)}</div>` + sceneHTML(cachedScene, sceneViewer);
    // La barra Scena fissa mobile (.mobile-scene-pin) resta sincronizzata con lo stesso Settore/
    // Incontri di #scene-live, ma senza il "chi è online" (troppo lungo per restare compatta).
    if(pinEl) pinEl.innerHTML = sceneHTML(cachedScene, sceneViewer);
  }

  // Global delegation: works no matter which render function last drew the scene box
  // (master preview, player view, or a periodic refresh), without needing to rebind per-render.
  document.addEventListener('click', (ev)=>{
    if(!session) return;
    const chip = ev.target.closest('[data-enc-name]');
    if(chip){ openEncounterDetail(chip.getAttribute('data-enc-name'), session.code, session.username); return; }
    const sizeBtn = ev.target.closest('[data-toggle-enc-size]');
    if(sizeBtn){ setEncImgLarge(!getEncImgLarge()); rerenderSceneLive(); return; }
    const sceneImg = ev.target.closest('[data-scene-img-expand]');
    if(sceneImg){ openImageLightbox(sceneImg.getAttribute('data-scene-img-expand')); return; }
    // Avatar di chi parla e immagini allegate nel Registro (Generale/Privata/Sottogruppi): un
    // click le ingrandisce nella stessa lightbox usata per lo sfondo della Scena, invece di
    // aprire una nuova scheda del browser (com'era prima per le sole immagini allegate).
    const avatarImg = ev.target.closest('[data-avatar-expand]');
    if(avatarImg){ openImageLightbox(avatarImg.getAttribute('data-avatar-expand')); return; }
    const mentionChip = ev.target.closest('[data-mention-open]');
    if(mentionChip){ openMentionDetail(mentionChip.getAttribute('data-mention-open')); return; }
  });
