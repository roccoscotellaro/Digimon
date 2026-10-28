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
// luogoNameById/memberEffectiveSectorId/memberEffectiveLuogoId/pushLog/pushPrivateLog/saveMember/
// getSubgroups (js/chat-log-engine.js), encounterCurrentWounds/encounterMaxWounds/normalizeEncounter
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
//
// Posizione degli Incontri (fase 21): ogni Incontro può avere un sectorId/luogoId facoltativo
// (vedi normalizeEncounter in js/encounters.js) che lo lega a un punto preciso della Scena, così
// ogni giocatore vede in Scena SOLO i Digimon presenti nella SUA posizione effettiva (o in quella
// del gruppo), invece che tutti gli Incontri della campagna indipendentemente da dove si trovi —
// vedi encounterMatchesLocation/encounterLocationLabel/locationOptionsHTML qui sotto ed
// encountersReadonlyHTML/sceneHTML per l'uso lato lettura, encountersEditableHTML/
// bindEncountersInnerActions/renderEncounterDraftCard/bindEncounterDraftCard per l'assegnazione
// lato Master.
//
// Invito in chat "Vuoi andare qui?" verso un Sottogruppo (richiesta di Rocco): il selettore
// "destinatario" aveva solo Chat Generale/Privata — un Sottogruppo non poteva essere scelto, quindi
// l'invito non poteva proprio essere mandato lì. Aggiunta un'opzione per Sottogruppo (letta da
// cachedSubgroups, popolata al bisogno qui sotto se non ancora caricata) più un secondo selettore
// "Modalità spostamento", visibile SOLO quando il destinatario è un Sottogruppo (per Generale/
// Privata non ha senso — vedi discussione con Rocco): 'each' (default, comportamento storico: chi
// clicca si sposta da solo), 'all' (il primo "sì" sposta tutto il sottogruppo), 'majority' (serve
// la maggioranza dei membri, poi si spostano tutti anche i non-cliccanti), 'unanimous' (aggiunta
// dopo, richiesta di Rocco: serve il "sì" di OGNI membro del sottogruppo, nessuno escluso, prima
// che si spostino — a differenza di 'majority' non sposta mai i non-cliccanti perché per
// definizione non ce ne sono più quando la soglia scatta). La logica di voto vera e propria vive in
// js/chat-log-engine.js (logHTML/attachLogModeration, branch [data-move-vote-id]) — lì anche il
// contatore "N/Tot" mostrato sotto al bottone, che si aggiorna da solo ad ogni voto senza bisogno
// di un messaggio di chat separato per ogni click (chiesto e chiarito con Rocco).

// ---------- data layer (spostate da index.html: thin wrapper su apiPost/apiPut, self-contained) ----------
  async function saveScene(code, scene){ const d = await apiPost('/api/state', { resource:'scene', code, ...scene }); return !!(d && d.ok); }
  async function addDexEntry(code, entry){ return apiPost('/api/dex', { code, ...entry }); }
  async function updateDexEntry(code, id, fields){ return apiPut('/api/dex', { code, id, ...fields }); }

  // Marca una voce del Digidex GIÀ ESISTENTE come "discovered" senza toccare nessun altro campo.
  // /api/dex PUT (dex.js) fa un UPDATE "a tutte le colonne" — qualunque campo NON incluso in questa
  // chiamata viene sovrascritto col default (stringa vuota/array vuoto/false), non lasciato
  // invariato (vedi il fix GIF-cancellata-dal-Digidex più sotto in openEncounterDetail). Rimandiamo
  // quindi indietro ESATTAMENTE i valori già presenti su dexMatch per ogni campo, così l'unico
  // effetto reale è discovered:true. Condivisa tra openEncounterDetail (scoperta automatica al
  // primo sguardo di qualcuno sulla card in Scena) e il bottone "📖 Scopri nel Dex" del pannello
  // Incontri del Master (richiesta di Rocco: "manca un tasto per far scoprire il digimon in scena
  // direttamente sul dex" — scoperta manuale immediata, senza dover aspettare che qualcuno clicchi
  // sulla card in Scena né passare da dex.html).
  async function markDexEntryDiscovered(code, dexMatch){
    if(!dexMatch || dexMatch.discovered) return true;
    const ok = await updateDexEntry(code, dexMatch.id, {
      name: dexMatch.name, stage: dexMatch.stage, description: dexMatch.description,
      imageUrl: dexMatch.image_url, gifUrl: dexMatch.gif_url||'', categories: dexMatch.categories||[], baseStats: dexMatch.base_stats||{},
      evolutions: dexMatch.evolutions||[], evolvesFrom: dexMatch.evolves_from||[], qualities: dexMatch.qualities||[], dpTotal: dexMatch.dp_total||0,
      attribute: dexMatch.attribute||'', family: dexMatch.family||'', originType: dexMatch.origin_type||'',
      signatureMove: dexMatch.signature_move||'', signatureMove2: dexMatch.signature_move_2||'',
      slideEvolution: !!dexMatch.slide_evolution, slideTargets: dexMatch.slide_targets||[],
      digimental: dexMatch.digimental||'', attackDesc: dexMatch.attack_desc||'', attackDesc2: dexMatch.attack_desc_2||'',
      extraAttacks: dexMatch.extra_attacks||[],
      discovered: true
    });
    if(ok) dexMatch.discovered = true;
    return ok;
  }

  // Trova, se esiste, la voce del Digidex collegata a un Incontro — prima per dexId (link diretto),
  // poi per nome (fallback, stesso identico criterio già usato in vari altri punti del file).
  function dexMatchForEncounter(e){
    return (e && e.dexId && cachedDex.find(d=>d.id===e.dexId)) || cachedDex.find(d=>String(d.name).trim().toLowerCase()===String(e && e.name || '').trim().toLowerCase());
  }

// ---------- stato di modulo (spostato da index.html, usato solo qui) ----------
  let encounterDraft = null; // pending Digimon (from Dex or homebrew) being reviewed before adding to the scene
  let sectorMapSubgroupsLoaded = false; // true dopo il primo fetch di cachedSubgroups innescato da renderSectorMap (vedi sotto)

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

  // ---------- Posizione degli Incontri (fase 21) ----------
  // Un Incontro senza sectorId (null/assente, il default per tutto ciò che esisteva prima di
  // questa fase) è "Ovunque nella scena": lo vedono tutti, sempre — esattamente il comportamento
  // di prima. Un Incontro con sectorId impostato si vede solo a chi si trova (effettivamente,
  // gruppo o singolo separato) in quel Settore; se ha anche luogoId, serve essere esattamente in
  // quel Luogo, non basta il solo Settore.
  // Sottosezioni (fase Sottosezioni): un Incontro con sectorId ma SENZA subsectionId resta
  // visibile in tutto il Settore, comprese le sue Sottosezioni (comportamento storico invariato);
  // un Incontro con subsectionId impostato richiede di essere ESATTAMENTE in quella Sottosezione
  // (e, se ha anche luogoId, in quel Luogo preciso dentro la Sottosezione). Un luogoId senza
  // subsectionId resta un Luogo "diretto" del Settore, come sempre.
  function encounterMatchesLocation(e, viewSectorId, viewSubsectionId, viewLuogoId){
    if(!e || !e.sectorId) return true;
    if(e.sectorId !== viewSectorId) return false;
    if(e.subsectionId){
      if(e.subsectionId !== viewSubsectionId) return false;
      if(e.luogoId && e.luogoId !== viewLuogoId) return false;
      return true;
    }
    if(e.luogoId && e.luogoId !== viewLuogoId) return false;
    return true;
  }

  // Etichetta leggibile ("Macroscena → Settore → Sottosezione → Luogo") della posizione assegnata
  // a un Incontro, usata sia nel pannello di gestione del Master sia per titolare le opzioni del
  // selettore posizione. Cerca il Settore in TUTTE le Macroscene (non solo quella attiva), perché
  // un Incontro può restare assegnato a un Settore anche dopo che il Master è passato a un'altra
  // Macroscena.
  function encounterLocationLabel(e){
    if(!e || !e.sectorId) return '🌐 Ovunque nella scena';
    const found = findSectorAnywhere(cachedScene, e.sectorId);
    if(!found) return '🌐 Ovunque nella scena';
    let sub = null, lg = null;
    if(e.subsectionId){
      sub = (found.sector.subsections||[]).find(x=>x.id===e.subsectionId) || null;
      lg = (e.luogoId && sub) ? (sub.luoghi||[]).find(l=>l.id===e.luogoId) : null;
    } else {
      lg = e.luogoId ? (found.sector.luoghi||[]).find(l=>l.id===e.luogoId) : null;
    }
    return '📍 ' + [found.macro.name, found.sector.name, sub?sub.name:null, lg?lg.name:null].filter(Boolean).map(escapeHTML).join(' → ');
  }

  // Opzioni del <select> di posizione: "Ovunque nella scena" + ogni Settore di ogni Macroscena +
  // ogni Luogo diretto del Settore + ogni Sottosezione del Settore + ogni Luogo di ogni
  // Sottosezione. Valori: "sectorId" | "sectorId:luogoId" (Luogo diretto, invariato) |
  // "sectorId:sub:subsectionId" (nuovo) | "sectorId:sub:subsectionId:luogoId" (nuovo, Luogo dentro
  // una Sottosezione). Usato sia nella card di creazione (renderEncounterDraftCard) sia nella riga
  // di ogni Incontro già esistente (encountersEditableHTML).
  function locationOptionsHTML(selectedSectorId, selectedSubsectionId, selectedLuogoId){
    const macros = cachedScene.macroScenes || [];
    let opts = `<option value="">🌐 Ovunque nella scena</option>`;
    macros.forEach(m=>{
      (m.sectors||[]).forEach(s=>{
        const sectorSel = selectedSectorId===s.id && !selectedSubsectionId && !selectedLuogoId;
        opts += `<option value="${escapeAttr(s.id)}" ${sectorSel?'selected':''}>${escapeHTML(m.name)} → ${escapeHTML(s.name)}</option>`;
        (s.luoghi||[]).forEach(lg=>{
          const val = `${s.id}:${lg.id}`;
          const sel = selectedSectorId===s.id && !selectedSubsectionId && selectedLuogoId===lg.id;
          opts += `<option value="${escapeAttr(val)}" ${sel?'selected':''}>${escapeHTML(m.name)} → ${escapeHTML(s.name)} → ${escapeHTML(lg.name)}</option>`;
        });
        (s.subsections||[]).forEach(sub=>{
          const subVal = `${s.id}:sub:${sub.id}`;
          const subSel = selectedSectorId===s.id && selectedSubsectionId===sub.id && !selectedLuogoId;
          opts += `<option value="${escapeAttr(subVal)}" ${subSel?'selected':''}>${escapeHTML(m.name)} → ${escapeHTML(s.name)} → ${escapeHTML(sub.name)}</option>`;
          (sub.luoghi||[]).forEach(lg=>{
            const val = `${s.id}:sub:${sub.id}:${lg.id}`;
            const sel = selectedSectorId===s.id && selectedSubsectionId===sub.id && selectedLuogoId===lg.id;
            opts += `<option value="${escapeAttr(val)}" ${sel?'selected':''}>${escapeHTML(m.name)} → ${escapeHTML(s.name)} → ${escapeHTML(sub.name)} → ${escapeHTML(lg.name)}</option>`;
          });
        });
      });
    });
    return opts;
  }

  // Legge il valore del <select> di posizione costruito da locationOptionsHTML e lo scompone in
  // {sectorId, subsectionId, luogoId} — condivisa tra renderEncounterDraftCard/bindEncounterDraftCard
  // e bindEncountersInnerActions (data-enc-location) invece di ripetere due volte lo stesso parsing.
  function parseLocationOptionValue(val){
    if(!val) return { sectorId:null, subsectionId:null, luogoId:null };
    const parts = val.split(':');
    if(parts[1]==='sub') return { sectorId: parts[0], subsectionId: parts[2]||null, luogoId: parts[3]||null };
    return { sectorId: parts[0], subsectionId:null, luogoId: parts[1]||null };
  }

  function getGridSize(macro){
    const n = macro && Number(macro.gridSize);
    if(!n || isNaN(n) || n<1 || n>6) return 3;
    return n;
  }

  // Sottosezioni: stessa identica logica di getGridSize ma per la griglia di Sottosezioni dentro
  // un Settore (settore.subsectionGridSize, default 3 — stesso default della griglia di Settori).
  function getSubsectionGridSize(sector){
    const n = sector && Number(sector.subsectionGridSize);
    if(!n || isNaN(n) || n<1 || n>6) return 3;
    return n;
  }

  function liveActiveMacro(){
    return (cachedScene.macroScenes||[]).find(m=>m.id===cachedScene.currentMacroSceneId) || null;
  }

  // ===== Pannello "🧭 Spostamenti" nella Vista Master =====
  // Richiesta Rocco 2026-10-28: "sistemerai la creazione di mappe in home rimandando tutto alla
  // sezione apposita, così da avere meno spazio, e sistemerei unicamente meglio la funzione per
  // spostare i giocatori nelle aree". Prima questo pannello (~1000 righe) duplicava quasi tutta la
  // gestione della mappa di map.html: creare/eliminare Macroscene, Settori, Sottosezioni, Luoghi,
  // immagini, musiche, caselle della griglia, collegamenti... Ora la creazione e la modifica stanno
  // SOLO in map.html (bottone "🗺️ Apri la Mappa"), e qui resta un unico strumento per spostare:
  //   1. DOVE — una destinazione, scelta a cascata (Macroscena → Settore → Sottosezione → Luogo),
  //      che parte già dalla posizione attuale del gruppo;
  //   2. CHI — tutto il gruppo, oppure solo alcuni giocatori (spunte);
  //   3. COME — "📍 Sposta ora" (subito, con avviso in chat) oppure "💬 Proponi in chat" (il
  //      messaggio "Vuoi andare qui?" col bottone "🚶 Sì, andiamo!", con le stesse modalità di
  //      voto di prima).
  // Sotto, l'elenco dei giocatori con la posizione di ciascuno e "↩️ Rientra" per chi si è separato.
  // Le regole di spostamento sono IDENTICHE a quelle di prima (stesse proprietà salvate):
  //   - gruppo: cachedScene.currentMacroSceneId/currentSectorId/currentSubsectionId/currentLuogoId,
  //     e chi si era separato torna a seguire il gruppo;
  //   - singoli: member.tamer.currentSectorId/currentSubsectionId/currentLuogoId (senza cambiare cosa
  //     vede il resto del gruppo). Se un singolo viene mandato esattamente dove si trova già il
  //     gruppo, invece di "separarlo" lo si fa rientrare nel gruppo (stesso risultato, più pulito).
  let travelDest = null;      // { macroId, sectorId, subId, luogoId } — destinazione scelta
  let travelWho = 'group';    // 'group' | 'some'
  let travelPicked = [];      // username spuntati quando travelWho==='some'
  let travelInviteOpen = false;

  function groupPosition(){
    return { macroId: cachedScene.currentMacroSceneId || null, sectorId: cachedScene.currentSectorId || null, subId: cachedScene.currentSubsectionId || null, luogoId: cachedScene.currentLuogoId || null };
  }
  function travelPlaceLabel(pos){
    if(!pos || !pos.sectorId){
      const m = (cachedScene.macroScenes||[]).find(x=>x.id===(pos&&pos.macroId));
      return m ? m.name : '';
    }
    const found = findSectorAnywhere(cachedScene, pos.sectorId);
    return [found?found.macro.name:null, found?found.sector.name:null, pos.subId?subsectionNameById(pos.sectorId,pos.subId):null, pos.luogoId?luogoNameAnywhere(pos.sectorId,pos.subId,pos.luogoId):null].filter(Boolean).join(' → ');
  }
  function travelDestName(pos){
    if(!pos || !pos.sectorId) return '';
    if(pos.luogoId) return luogoNameAnywhere(pos.sectorId, pos.subId, pos.luogoId) || '';
    if(pos.subId) return subsectionNameById(pos.sectorId, pos.subId) || '';
    return sectorNameById(pos.sectorId) || '';
  }

  function renderSectorMap(code, onChanged){
    const el = document.getElementById('sector-map-card');
    if(!el) return;
    // Il destinatario "Sottogruppo" dell'invito ha bisogno di cachedSubgroups: lo carichiamo una
    // volta (se il Master non ha ancora aperto la scheda Gruppi) e ridisegniamo quando arriva.
    if(!sectorMapSubgroupsLoaded){
      sectorMapSubgroupsLoaded = true;
      getSubgroups(code).then(groups=>{ cachedSubgroups = groups; renderSectorMap(code, onChanged); }).catch(()=>{});
    }
    const macroScenes = cachedScene.macroScenes || [];
    const players = (cachedRoster||[]).filter(m=>m.role==='player');
    const grp = groupPosition();
    if(!travelDest) travelDest = Object.assign({}, grp);
    // La destinazione deve sempre puntare a cose che esistono ancora (map.html può averle cambiate).
    const dMacro = macroScenes.find(m=>m.id===travelDest.macroId) || null;
    if(!dMacro) travelDest = { macroId: null, sectorId: null, subId: null, luogoId: null };
    const dSector = dMacro ? (dMacro.sectors||[]).find(s=>s.id===travelDest.sectorId) || null : null;
    if(!dSector){ travelDest.sectorId = null; travelDest.subId = null; travelDest.luogoId = null; }
    const dSub = dSector ? (dSector.subsections||[]).find(s=>s.id===travelDest.subId) || null : null;
    if(!dSub) travelDest.subId = null;
    const dLuoghi = dSub ? (dSub.luoghi||[]) : (dSector ? (dSector.luoghi||[]) : []);
    if(!dLuoghi.find(l=>l.id===travelDest.luogoId)) travelDest.luogoId = null;
    travelPicked = travelPicked.filter(u=>players.some(p=>p.username===u));

    const destReady = !!travelDest.sectorId;
    const destIsGroupPos = destReady && travelDest.sectorId===grp.sectorId && (travelDest.subId||null)===(grp.subId||null) && (travelDest.luogoId||null)===(grp.luogoId||null);
    const whoCount = travelWho==='group' ? players.length : travelPicked.length;
    const canAct = destReady && (travelWho==='group' || travelPicked.length>0);
    const inviteDefaultTarget = (travelWho==='some' && travelPicked.length===1) ? travelPicked[0] : '';
    const posOf = (m)=> ({ sectorId: memberEffectiveSectorId(m), subId: memberEffectiveSubsectionId(m), luogoId: memberEffectiveLuogoId(m) });

    el.innerHTML = `
      <div class="flex-between" style="align-items:center;gap:8px;flex-wrap:wrap;">
        <div class="section-title" style="margin:0;border:none;padding:0;">🧭 Spostamenti</div>
        <a href="map.html" target="_blank" class="btn ghost small" style="text-decoration:none;" title="Creare e modificare Macroscene, Settori, Sottosezioni e Luoghi (immagini, musiche, collegamenti, griglia)">🗺️ Apri la Mappa →</a>
      </div>
      <div class="muted" style="font-size:11px;margin:6px 0 10px;">📍 Il gruppo è a: <b style="color:var(--cyan);">${escapeHTML(travelPlaceLabel(grp)) || 'nessuna posizione'}</b><br>Creare o modificare i luoghi si fa nella Mappa; qui si spostano i giocatori.</div>
      ${macroScenes.length===0 ? `<div class="muted">Nessuna Macroscena ancora: creane una nella <a href="map.html" target="_blank">Mappa</a>.</div>` : `
      <div class="travel-step"><span class="travel-num">1</span> Dove</div>
      <div class="travel-grid">
        <select id="travel-macro"><option value="">— Macroscena —</option>${macroScenes.map(m=>`<option value="${escapeAttr(m.id)}" ${travelDest.macroId===m.id?'selected':''}>${escapeHTML(m.name)}${grp.macroId===m.id?' · 📍':''}</option>`).join('')}</select>
        <select id="travel-sector" ${dMacro?'':'disabled'}><option value="">— Settore —</option>${dMacro?(dMacro.sectors||[]).map(s=>`<option value="${escapeAttr(s.id)}" ${travelDest.sectorId===s.id?'selected':''}>${escapeHTML(s.name)}${grp.sectorId===s.id?' · 📍':''}</option>`).join(''):''}</select>
        <select id="travel-sub" ${dSector && (dSector.subsections||[]).length?'':'disabled'}><option value="">${dSector && (dSector.subsections||[]).length ? '— nessuna Sottosezione —' : '(nessuna Sottosezione)'}</option>${dSector?(dSector.subsections||[]).map(s=>`<option value="${escapeAttr(s.id)}" ${travelDest.subId===s.id?'selected':''}>${escapeHTML(s.name)}${grp.subId===s.id?' · 📍':''}</option>`).join(''):''}</select>
        <select id="travel-luogo" ${dLuoghi.length?'':'disabled'}><option value="">${dLuoghi.length ? '— nessun Luogo —' : '(nessun Luogo)'}</option>${dLuoghi.map(l=>`<option value="${escapeAttr(l.id)}" ${travelDest.luogoId===l.id?'selected':''}>${escapeHTML(l.name)}${grp.luogoId===l.id?' · 📍':''}</option>`).join('')}</select>
      </div>
      <div class="travel-step"><span class="travel-num">2</span> Chi</div>
      <div class="chat-seg" style="margin-bottom:6px;">
        <button type="button" class="chat-seg-btn ${travelWho==='group'?'active':''}" data-travel-who="group">👥 Tutto il gruppo</button>
        <button type="button" class="chat-seg-btn ${travelWho==='some'?'active':''}" data-travel-who="some">🙋 Solo alcuni</button>
      </div>
      <div class="travel-players">
        ${players.length===0 ? '<div class="muted" style="font-size:11px;">Nessun giocatore nel roster.</div>' : players.map(m=>{
          const pos = posOf(m);
          const separated = !!(m.tamer && (m.tamer.currentSectorId || m.tamer.currentSubsectionId || m.tamer.currentLuogoId));
          const picked = travelWho==='some' && travelPicked.includes(m.username);
          return `<div class="travel-player${picked?' picked':''}">
            ${travelWho==='some' ? `<input type="checkbox" data-travel-pick="${escapeAttr(m.username)}" ${picked?'checked':''} />` : `<span style="width:16px;text-align:center;">${separated?'🧭':'📍'}</span>`}
            <div style="flex:1;min-width:0;${travelWho==='some'?'cursor:pointer;':''}" ${travelWho==='some'?`data-travel-pick-row="${escapeAttr(m.username)}"`:''}>
              <b>${escapeHTML(displayName(m))}</b>${separated?' <span class="tag" style="font-size:9px;">separato</span>':''}
              <div class="muted" style="font-size:10.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHTML(travelPlaceLabel(pos)) || 'nessuna posizione'}</div>
            </div>
            ${separated ? `<button type="button" class="btn ghost small" data-position-follow="${escapeAttr(m.username)}" style="padding:2px 6px;font-size:10px;" title="Torna a seguire la posizione del gruppo">↩️ Rientra</button>` : ''}
          </div>`;
        }).join('')}
      </div>
      <div class="travel-step"><span class="travel-num">3</span> Come</div>
      <div class="row" style="gap:6px;">
        <button type="button" class="btn solid" id="travel-move-now" style="flex:1;" ${canAct?'':'disabled'}>📍 Sposta ora${canAct?` (${travelWho==='group'?'gruppo':whoCount})`:''}</button>
        <button type="button" class="btn ${travelInviteOpen?'':'ghost'}" id="travel-invite-toggle" style="flex:1;" ${destReady?'':'disabled'}>💬 Proponi in chat ${travelInviteOpen?'▴':'▾'}</button>
      </div>
      <div class="muted" style="font-size:10.5px;margin-top:4px;">${!destReady ? 'Scegli almeno un Settore di destinazione.' : (travelWho==='some' && !travelPicked.length ? 'Spunta almeno un giocatore.' : (travelWho==='group' ? `Tutto il gruppo va a «${escapeHTML(travelDestName(travelDest))}»; chi si era separato si riunisce.` : (destIsGroupPos ? 'Destinazione = posizione del gruppo: i giocatori scelti rientrano nel gruppo.' : `Solo i giocatori spuntati vanno a «${escapeHTML(travelDestName(travelDest))}»; il resto del gruppo resta dov'è.`)))}</div>
      ${travelInviteOpen && destReady ? `
      <div class="travel-invite">
        <div class="field" style="margin-bottom:6px;"><label>A chi mandare l'invito "Vuoi andare a «${escapeHTML(travelDestName(travelDest))}»?"</label>
          <select id="invite-target-select">
            <option value="" ${inviteDefaultTarget===''?'selected':''}>📣 Chat Generale (visibile a tutti)</option>
            ${players.map(m=>`<option value="${escapeAttr(m.username)}" ${inviteDefaultTarget===m.username?'selected':''}>✉️ Privata: ${escapeHTML(displayName(m))}</option>`).join('')}
            ${(cachedSubgroups||[]).map(g=>`<option value="subgroup:${escapeAttr(g.id)}">👥 Sottogruppo: ${escapeHTML(g.name)} (${(g.members||[]).length})</option>`).join('')}
          </select>
        </div>
        <div class="field" id="invite-mode-field" style="margin-bottom:6px;"><label>Chi si sposta</label>
          <select id="invite-mode-select">
            <option value="each">Ognuno che clicca "Sì" si sposta da solo</option>
            <option value="all">Basta un "Sì" per spostare tutti</option>
            <option value="majority">Si spostano tutti quando la maggioranza dice "Sì"</option>
            <option value="unanimous">Si spostano tutti solo quando TUTTI dicono "Sì"</option>
          </select>
        </div>
        <button type="button" class="btn amber" id="travel-invite-send" style="width:100%;">💬 Manda l'invito</button>
      </div>` : ''}
      `}
      <div class="muted" id="sector-status" style="margin-top:6px;"></div>
    `;

    const rerender = ()=> renderSectorMap(code, onChanged);
    const setStatus = (t)=>{ const s = document.getElementById('sector-status'); if(s) s.textContent = t || ''; };
    const macroSel = document.getElementById('travel-macro');
    if(macroSel) macroSel.onchange = ()=>{ travelDest = { macroId: macroSel.value || null, sectorId: null, subId: null, luogoId: null }; rerender(); };
    const sectorSel = document.getElementById('travel-sector');
    if(sectorSel) sectorSel.onchange = ()=>{ travelDest.sectorId = sectorSel.value || null; travelDest.subId = null; travelDest.luogoId = null; rerender(); };
    const subSel = document.getElementById('travel-sub');
    if(subSel) subSel.onchange = ()=>{ travelDest.subId = subSel.value || null; travelDest.luogoId = null; rerender(); };
    const luogoSel = document.getElementById('travel-luogo');
    if(luogoSel) luogoSel.onchange = ()=>{ travelDest.luogoId = luogoSel.value || null; rerender(); };
    el.querySelectorAll('[data-travel-who]').forEach(b=>{ b.onclick = ()=>{ travelWho = b.getAttribute('data-travel-who'); rerender(); }; });
    const togglePick = (u)=>{ travelPicked = travelPicked.includes(u) ? travelPicked.filter(x=>x!==u) : travelPicked.concat([u]); rerender(); };
    el.querySelectorAll('[data-travel-pick]').forEach(chk=>{ chk.onchange = ()=> togglePick(chk.getAttribute('data-travel-pick')); });
    el.querySelectorAll('[data-travel-pick-row]').forEach(row=>{ row.onclick = ()=> togglePick(row.getAttribute('data-travel-pick-row')); });
    const inviteToggle = document.getElementById('travel-invite-toggle');
    if(inviteToggle) inviteToggle.onclick = ()=>{ travelInviteOpen = !travelInviteOpen; rerender(); };

    // Il campo "Chi si sposta" ha senso solo per Generale/Sottogruppo (in Privata c'è un solo
    // giocatore, che si sposta sempre da solo).
    const inviteTargetSel = document.getElementById('invite-target-select');
    const inviteModeField = document.getElementById('invite-mode-field');
    if(inviteTargetSel && inviteModeField){
      const isPrivateTarget = (v)=> !!v && !v.startsWith('subgroup:');
      const syncInviteModeVisibility = ()=>{ inviteModeField.style.display = isPrivateTarget(inviteTargetSel.value) ? 'none' : 'block'; };
      inviteTargetSel.onchange = syncInviteModeVisibility;
      syncInviteModeVisibility();
      // Sottogruppi creati dopo l'apertura del pannello: li ricarichiamo quando si apre il menu.
      inviteTargetSel.onfocus = ()=>{
        getSubgroups(code).then(groups=>{
          const known = (cachedSubgroups||[]).map(g=>g.id+':'+(g.members||[]).length).join(',');
          const fresh = (groups||[]).map(g=>g.id+':'+(g.members||[]).length).join(',');
          cachedSubgroups = groups;
          if(known!==fresh){
            const keep = inviteTargetSel.value;
            Array.from(inviteTargetSel.querySelectorAll('option[value^="subgroup:"]')).forEach(o=>o.remove());
            groups.forEach(g=>{ const o = document.createElement('option'); o.value = 'subgroup:'+g.id; o.textContent = `👥 Sottogruppo: ${g.name} (${(g.members||[]).length})`; inviteTargetSel.appendChild(o); });
            inviteTargetSel.value = keep;
            if(inviteTargetSel.value!==keep) inviteTargetSel.value = '';
            syncInviteModeVisibility();
          }
        }).catch(()=>{});
      };
    }

    // Segna come "scoperti" sulla mappa dei giocatori i posti della destinazione (come prima: chi ci
    // va, o chi riceve l'invito, li vede comparire in map.html).
    function revealDest(){
      const found = findSectorAnywhere(cachedScene, travelDest.sectorId);
      if(!found) return null;
      const s = found.sector;
      s.revealed = true;
      const sub = travelDest.subId ? (s.subsections||[]).find(x=>x.id===travelDest.subId) : null;
      if(sub) sub.revealed = true;
      const lg = travelDest.luogoId ? ((sub ? sub.luoghi : s.luoghi)||[]).find(x=>x.id===travelDest.luogoId) : null;
      if(lg) lg.revealed = true;
      return { macro: found.macro, sector: s, sub, lg };
    }

    // "📍 Sposta ora"
    const moveNowBtn = document.getElementById('travel-move-now');
    if(moveNowBtn) moveNowBtn.onclick = async ()=>{
      if(!travelDest.sectorId) return;
      moveNowBtn.disabled = true;
      setStatus('Spostamento in corso...');
      const placed = revealDest();
      if(!placed){ setStatus('⚠ Destinazione non trovata: forse è stata modificata nella Mappa.'); moveNowBtn.disabled = false; return; }
      const destName = travelDestName(travelDest);
      if(travelWho==='group'){
        cachedScene.currentMacroSceneId = placed.macro.id;
        cachedScene.currentSectorId = travelDest.sectorId;
        cachedScene.currentSubsectionId = travelDest.subId || null;
        cachedScene.currentLuogoId = travelDest.luogoId || null;
        const ok = await saveScene(code, cachedScene);
        if(!ok){ setStatus('⚠ Errore: ' + (lastApiError || 'salvataggio non riuscito')); moveNowBtn.disabled = false; return; }
        // Muovere l'intero gruppo riunisce anche chi si era separato (stesso comportamento di prima).
        const separatedMembers = players.filter(m=>m.tamer && (m.tamer.currentSectorId || m.tamer.currentSubsectionId || m.tamer.currentLuogoId));
        for(const m of separatedMembers){ m.tamer.currentSectorId = null; m.tamer.currentSubsectionId = null; m.tamer.currentLuogoId = null; await saveMember(code, m); }
        await pushLog(code, { who:'Sistema', role:'gm', text: `📍 Il gruppo si sposta a "${destName}"${placed.sub||placed.lg ? ` (${placed.sector.name})` : ''}.` });
      } else {
        // Le modifiche alla Scena (posti "scoperti") vanno salvate anche qui.
        await saveScene(code, cachedScene);
        const moved = [];
        for(const u of travelPicked){
          const member = players.find(m=>m.username===u);
          if(!member) continue;
          const prev = [member.tamer.currentSectorId, member.tamer.currentSubsectionId, member.tamer.currentLuogoId];
          if(destIsGroupPos){
            member.tamer.currentSectorId = null; member.tamer.currentSubsectionId = null; member.tamer.currentLuogoId = null;
          } else {
            member.tamer.currentSectorId = travelDest.sectorId;
            member.tamer.currentSubsectionId = travelDest.subId || null;
            member.tamer.currentLuogoId = travelDest.luogoId || null;
          }
          const ok = await saveMember(code, member);
          if(!ok){ [member.tamer.currentSectorId, member.tamer.currentSubsectionId, member.tamer.currentLuogoId] = prev; continue; }
          moved.push(displayName(member));
        }
        if(!moved.length){ setStatus('⚠ Errore: ' + (lastApiError || 'nessuno spostamento salvato')); moveNowBtn.disabled = false; return; }
        const names = moved.length===1 ? moved[0] : moved.slice(0,-1).join(', ') + ' e ' + moved[moved.length-1];
        await pushLog(code, { who:'Sistema', role:'gm', text: destIsGroupPos ? `↩️ ${names} ${moved.length===1?'rientra':'rientrano'} nel gruppo.` : `🧭 ${names} ${moved.length===1?'si sposta':'si spostano'} a "${destName}" (${placed.macro.name}).` });
        travelPicked = [];
      }
      setStatus('');
      rerender();
      if(onChanged) onChanged();
    };

    // "↩️ Rientra": il giocatore torna a seguire la posizione del gruppo.
    el.querySelectorAll('[data-position-follow]').forEach(btn=>{
      btn.onclick = async (ev)=>{
        ev.stopPropagation();
        const username = btn.getAttribute('data-position-follow');
        const member = players.find(m=>m.username===username);
        if(!member) return;
        btn.disabled = true;
        const prev = [member.tamer.currentSectorId, member.tamer.currentSubsectionId, member.tamer.currentLuogoId];
        member.tamer.currentSectorId = null;
        member.tamer.currentSubsectionId = null;
        member.tamer.currentLuogoId = null;
        const ok = await saveMember(code, member);
        if(!ok){ [member.tamer.currentSectorId, member.tamer.currentSubsectionId, member.tamer.currentLuogoId] = prev; btn.disabled = false; return; }
        await pushLog(code, { who:'Sistema', role:'gm', text: `↩️ ${displayName(member)} rientra nel gruppo.` });
        rerender();
        if(onChanged) onChanged();
      };
    });

    // "💬 Manda l'invito": stesso messaggio ::MOVEREQ:: di prima (vedi parseMoveReqPayload e il voto
    // in js/chat-log-engine.js). In Privata chi clicca si sposta sempre da solo (mode 'each'); in
    // Generale/Sottogruppo vale la modalità scelta. In Generale con voto, il "gruppo" che vota sono i
    // giocatori che ORA sono nella posizione del gruppo (meta.moveGroup), come prima.
    const inviteSendBtn = document.getElementById('travel-invite-send');
    if(inviteSendBtn) inviteSendBtn.onclick = async ()=>{
      if(!travelDest.sectorId) return;
      inviteSendBtn.disabled = true;
      const placed = revealDest();
      if(!placed){ setStatus('⚠ Destinazione non trovata.'); inviteSendBtn.disabled = false; return; }
      const ok = await saveScene(code, cachedScene);
      if(!ok){ setStatus('⚠ Errore: ' + (lastApiError || 'salvataggio non riuscito')); inviteSendBtn.disabled = false; return; }
      const target = inviteTargetSel ? inviteTargetSel.value : '';
      const isSubgroup = target.startsWith('subgroup:');
      const isGeneral = !target;
      const modeEl = document.getElementById('invite-mode-select');
      const mode = ((isSubgroup || isGeneral) && modeEl) ? modeEl.value : 'each';
      const text = `Vuoi andare a "${travelDestName(travelDest)}"?::MOVEREQ::${travelDest.sectorId}|${travelDest.subId||''}|${travelDest.luogoId||''}|${mode}`;
      if(target) await pushPrivateLog(code, target, { who:'Master', role:'moverequest', text });
      else {
        const meta = {};
        if(mode!=='each'){
          const hereKey = normalizeLocationKey(currentLocationKey());
          const here = players.filter(m=>normalizeLocationKey(memberLocationKey(m))===hereKey).map(m=>m.username);
          meta.moveGroup = here.length ? here : players.map(m=>m.username);
        }
        await pushLog(code, { who:'Master', role:'moverequest', text, meta });
      }
      travelInviteOpen = false;
      setStatus('✅ Invito mandato.');
      rerender();
      setStatus('✅ Invito mandato.');
      if(onChanged) onChanged();
    };
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
  // Gli Incontri mostrati (encountersReadonlyHTML) sono filtrati sulla STESSA posizione effettiva
  // (effSectorId/effLuogoId) qui calcolata — vedi fase 21.
  function sceneHTML(scene, viewerMember){
    const macroScenes = (scene && Array.isArray(scene.macroScenes)) ? scene.macroScenes : [];
    const groupMacro = scene && scene.currentMacroSceneId ? macroScenes.find(m=>m.id===scene.currentMacroSceneId) : null;
    const effSectorId = viewerMember ? memberEffectiveSectorId(viewerMember) : (scene && scene.currentSectorId);
    // Sottosezioni: stesso pattern di effSectorId/effLuogoId qui sotto, un livello in mezzo.
    const effSubsectionId = viewerMember ? memberEffectiveSubsectionId(viewerMember) : (scene && scene.currentSubsectionId);
    const effLuogoId = viewerMember ? memberEffectiveLuogoId(viewerMember) : (scene && scene.currentLuogoId);
    const isSeparated = !!(viewerMember && (effSectorId !== (scene && scene.currentSectorId) || effSubsectionId !== (scene && scene.currentSubsectionId) || effLuogoId !== (scene && scene.currentLuogoId)));
    // Il Settore effettivo di un giocatore separato può appartenere a una Macroscena diversa da
    // quella attiva per il resto del gruppo (vedi il pannello "🧭 Separa in un'altra Macroscena"):
    // lo cerchiamo ovunque invece di limitarci ai Settori della sola Macroscena di gruppo, altrimenti
    // un separato in un'altra Macroscena non vedrebbe sfondo/breadcrumb della propria posizione reale.
    const found = effSectorId ? findSectorAnywhere(scene, effSectorId) : null;
    const current = found ? found.sector : null;
    const activeMacro = found ? found.macro : groupMacro;
    const sectors = activeMacro ? (activeMacro.sectors||[]) : [];
    const currentSubsection = current && effSubsectionId ? (current.subsections||[]).find(x=>x.id===effSubsectionId) : null;
    const subsections = current ? (current.subsections||[]) : [];
    // Un Luogo effettivo vive dentro la Sottosezione attuale (se c'è) o direttamente nel Settore —
    // stesso criterio di luogoNameAnywhere in js/chat-log-engine.js.
    const currentLuogo = effLuogoId
      ? (currentSubsection ? (currentSubsection.luoghi||[]).find(l=>l.id===effLuogoId) : (current ? (current.luoghi||[]).find(l=>l.id===effLuogoId) : null))
      : null;
    const sectorBadge = current ? `<span class="tag">${current.terrain==='Dangerous'?'☠':(current.terrain==='Difficult'?'⚠':'')} ${escapeHTML(current.terrain)}</span>` : '';
    const separatedBadge = isSeparated ? `<span class="tag" style="color:var(--amber);border-color:var(--amber);">🧭 Ti sei separato dal gruppo</span>` : '';
    const breadcrumb = [activeMacro?activeMacro.name:null, current?current.name:null, currentSubsection?currentSubsection.name:null, currentLuogo?currentLuogo.name:null].filter(Boolean).map(escapeHTML).join(' → ');
    const sectorHTML = current ? `
      <div class="hud-frame card" style="margin-top:8px;padding:8px 10px;">
        <div class="flex-between" style="flex-wrap:wrap;gap:6px;"><span class="mono" style="color:var(--cyan);">📍 ${breadcrumb}</span><span style="display:flex;flex-wrap:wrap;gap:4px;">${sectorBadge}${separatedBadge}</span></div>
        ${currentLuogo && currentLuogo.description ? `<div class="sub" style="margin-top:4px;">${escapeHTML(currentLuogo.description)}</div>` : (currentSubsection && currentSubsection.description ? `<div class="sub" style="margin-top:4px;">${escapeHTML(currentSubsection.description)}</div>` : (current.description ? `<div class="sub" style="margin-top:4px;">${escapeHTML(current.description)}</div>` : ''))}
        ${!currentLuogo && !currentSubsection && (current.luoghi||[]).length>0 ? `<div class="muted" style="margin-top:4px;font-size:11px;">Luoghi qui: ${(current.luoghi||[]).map(l=>escapeHTML(l.name)).join(', ')}</div>` : ''}
        ${!currentLuogo && currentSubsection && (currentSubsection.luoghi||[]).length>0 ? `<div class="muted" style="margin-top:4px;font-size:11px;">Luoghi qui: ${(currentSubsection.luoghi||[]).map(l=>escapeHTML(l.name)).join(', ')}</div>` : ''}
        ${currentSubsection ? `<div class="muted" style="margin-top:4px;font-size:11px;">Sottosezione: puoi raggiungere ${(currentSubsection.connections||[]).map(cid=>{ const c=subsections.find(x=>x.id===cid); return c?escapeHTML(c.name):''; }).filter(Boolean).join(', ') || 'nessuna altra sottosezione collegata'}</div>` : ''}
        <div class="muted" style="margin-top:4px;font-size:11px;">Puoi raggiungere: ${(current.connections||[]).map(cid=>{ const c=sectors.find(x=>x.id===cid); return c?escapeHTML(c.name):''; }).filter(Boolean).join(', ') || 'nessun altro settore collegato'}</div>
      </div>
    ` : '';
    const bgImage = (currentLuogo && currentLuogo.image) || (currentSubsection && currentSubsection.image) || (current && current.image) || (scene && scene.background) || '';
    if(!scene || (!bgImage && !scene.title)){
      return `<div class="scene-box"><div class="scene-empty">Nessuna scena impostata dal Master</div></div>` + sectorHTML + encountersReadonlyHTML(scene, effSectorId, effSubsectionId, effLuogoId);
    }
    return `
      <div class="scene-box" ${bgImage?`data-scene-img-expand="${escapeAttr(bgImage)}"`:''}>
        ${bgImage ? `<img class="bg" src="${escapeAttr(bgImage)}" onerror="this.style.display='none'" />` : ''}
        <div class="overlay"></div>
        ${bgImage ? `<div class="scene-expand-hint">🔍</div>` : ''}
        ${scene.title ? `<div class="title">${escapeHTML(scene.title)}</div>` : ''}
      </div>
    ` + sectorHTML + encountersReadonlyHTML(scene, effSectorId, effSubsectionId, effLuogoId);
  }

  function getEncImgLarge(){ try{ return localStorage.getItem('digivice_enc_img_large')==='1'; }catch(e){ return false; } }
  function setEncImgLarge(v){ try{ localStorage.setItem('digivice_enc_img_large', v?'1':'0'); }catch(e){} }

  // Un Incontro è "identificato" (nome/immagine/descrizione mostrabili a un giocatore) finché il
  // Master non spunta "🎭 Nascondi Nome" su quell'Incontro — vedi encountersReadonlyHTML, che la
  // usa per decidere se mostrare la card mascherata ("❔ ???") a chi non è Master.
  function isEncounterIdentityKnown(e){
    if(e && e.nameHidden) return false;
    return true;
  }

  // viewSectorId/viewLuogoId (fase 21): posizione effettiva di chi guarda (già calcolata da
  // sceneHTML) — usata per nascondere gli Incontri assegnati a un Settore/Luogo diverso dal suo,
  // così ogni giocatore vede in Scena solo i Digimon del punto in cui si trova davvero. Un
  // Incontro senza posizione assegnata (sectorId nullo, il default storico) resta visibile a
  // chiunque, come sempre.
  function encountersReadonlyHTML(scene, viewSectorId, viewSubsectionId, viewLuogoId){
    const enc = (scene && Array.isArray(scene.encounters)) ? scene.encounters.map(normalizeEncounter) : [];
    const visible = enc.filter(e=>e.revealed!==false && encounterMatchesLocation(e, viewSectorId, viewSubsectionId, viewLuogoId));
    if(visible.length===0) return '';
    const isMasterView = !!(session && session.role==='master');
    // Group visually-identical entries (same name/stage/image/nameHidden) so duplicates show a
    // ×N counter instead of repeating.
    const groups = [];
    visible.forEach(e=>{
      const key = e.name.trim().toLowerCase()+'|'+(e.stage||'')+'|'+(e.image||'')+'|'+(e.nameHidden?'1':'0');
      let g = groups.find(x=>x.key===key);
      if(!g){ g = { key, name:e.name, stage:e.stage, image:e.image, isBoss:false, count:0, single:e, nameHidden: !!e.nameHidden }; groups.push(g); }
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
            // Master a parte: chi non è Master vede solo la presenza ("qualcosa è qui"), mai nome,
            // immagine o descrizione, finché il Master non toglie "🎭 Nascondi Nome" da questo
            // Incontro — niente attributo data-enc-name, quindi il click non apre nemmeno il
            // dettaglio (che rivelerebbe nome/descrizione/evoluzioni).
            const masked = !isEncounterIdentityKnown(g) && !isMasterView;
            if(masked){
              // Presenza nascosta: la Scena mostra CHE qualcosa/qualcuno è lì (immagine visibile,
              // se impostata), solo nome/descrizione restano "???" finché il Master non rivela —
              // niente data-enc-name, quindi il click non apre comunque il dettaglio.
              const cardW = imgSize+18;
              const maskedImg = g.image
                ? `<img src="${escapeAttr(g.image)}" onerror="this.style.display='none'" style="width:${imgSize}px;height:${imgSize}px;object-fit:cover;border-radius:6px;" />`
                : `<div style="width:${imgSize}px;height:${imgSize}px;display:flex;align-items:center;justify-content:center;background:var(--panel-2);border-radius:6px;color:var(--text-mute);font-size:16px;">❔</div>`;
              return `
              <div class="enc-card-mini" style="width:${cardW}px;padding:4px;border-radius:8px;border:2px solid transparent;position:relative;" title="Presenza non identificata">
                ${g.count>1 ? `<span style="position:absolute;top:-4px;right:0px;background:var(--cyan);color:#04211c;font-size:9px;font-weight:700;border-radius:8px;padding:1px 5px;">×${g.count}</span>` : ''}
                ${maskedImg}
                <div style="font-size:10px;text-align:center;margin-top:3px;line-height:1.2;">???</div>
              </div>`;
            }
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
      // Bottone "📖 Scopri nel Dex" (richiesta di Rocco: "manca un tasto per far scoprire il
      // digimon in scena direttamente sul dex") — visibile solo se l'Incontro è già collegato a
      // una voce del Digidex ma quella voce non è ancora discovered. Prima l'unico modo era
      // aspettare che qualcuno cliccasse sulla card in Scena (openEncounterDetail) o passare da
      // dex.html: ora il Master può rivelarlo all'istante da qui.
      const dexMatch = already ? dexMatchForEncounter(e) : null;
      const needsDiscover = !!(dexMatch && !dexMatch.discovered);
      const visible = e.revealed!==false;
      const maxW = encounterMaxWounds(e);
      const curW = encounterCurrentWounds(e);
      const disp = ENCOUNTER_DISPOSITIONS[e.disposition] || ENCOUNTER_DISPOSITIONS.enemy;
      return `
        <div class="roster-item" style="padding:6px 8px;margin-bottom:6px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;${e.isBoss?'border-color:var(--danger);':''}border-left:3px solid ${disp.color};">
          ${(()=>{ const img = bestDigimonImage(e.dexId, e.name, e.gif || e.image); return img ? `<img src="${escapeAttr(img)}" onerror="this.style.display='none'" style="width:32px;height:32px;object-fit:cover;border-radius:4px;flex-shrink:0;" />` : ''; })()}
          <div style="flex:1;min-width:140px;">
            <div><b>${escapeHTML(e.name)}</b> ${e.stage?`<span class="tag">${escapeHTML(e.stage)}</span>`:''}${attributeIconHTML(dexAttributeFor(e.dexId, e.name), 14)}<button class="tag" data-cycle-disposition="${i}" style="cursor:pointer;color:${disp.color};border-color:${disp.color};background:none;" title="Clicca per cambiare (Nemico/Alleato/Neutrale) — si riflette nell'aggiunta al combattimento">${disp.icon} ${disp.label}</button>${e.isBoss?`<span class="tag" style="color:var(--danger);border-color:var(--danger);" title="${e.bossBonusStat?('Bonus Boss: +'+e.bossBonusAmount+' '+escapeAttr(BOSS_BONUS_STATS[e.bossBonusStat]||e.bossBonusStat)):'Nessun bonus Statistica assegnato'}">👑 Boss${e.bossBonusStat?` (+${e.bossBonusAmount} ${escapeHTML(BOSS_BONUS_STATS[e.bossBonusStat]||e.bossBonusStat)})`:''}</span>`:''}${e.nameHidden?`<span class="tag" style="color:var(--violet, #b98cf0);border-color:var(--violet, #b98cf0);">🎭 Nome Nascosto</span>`:''}${needsDiscover?`<span class="tag" style="color:var(--text-mute);border-color:var(--line);" title="Non ancora scoperto sul Digidex">❔ Non scoperto</span>`:''}${(e.categories||[]).map(c=>`<span class="tag" style="font-size:9px;">${escapeHTML(c)}</span>`).join('')}</div>
            <div class="muted" style="font-size:11px;">${visible ? '👁️ Visibile ai giocatori' : '🙈 Nascosto — solo il Master lo vede'}${visible ? (e.nameHidden ? ' · 🎭 Presenza visibile, nome e descrizione nascosti ai giocatori' : '') : ''} · ${encounterLocationLabel(e)}</div>
            <div style="margin-top:4px;">
              <select data-enc-location="${i}" style="font-size:10px;padding:2px 4px;max-width:260px;" title="Dove si trova questo Digimon nella Scena — i giocatori lo vedranno in Scena solo quando la loro posizione corrisponde. 'Ovunque' = comportamento di prima, sempre visibile.">
                ${locationOptionsHTML(e.sectorId, e.subsectionId, e.luogoId)}
              </select>
            </div>
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
          <input type="color" data-enc-chatcolor="${i}" class="chat-color-swatch" style="width:28px;height:28px;" value="${escapeAttr(e.chatColor||'#ff5d5d')}" title="Colore scritta in chat quando lo fai 'Parlare' (Parla come) — resta questo ogni volta, senza doverlo re-impostare" />
          <button class="btn ${e.isBoss?'':'ghost'} small" data-toggle-boss="${i}" style="padding:4px 8px;font-size:10px;">${e.isBoss?'👑 Rimuovi Boss':'👑 Segna Boss'}</button>
          <button class="btn ${visible?'ghost':''} small" data-toggle-reveal="${i}" style="padding:4px 8px;font-size:10px;">${visible?'🙈 Nascondi':'👁️ Mostra ai giocatori'}</button>
          <button class="btn ${e.nameHidden?'':'ghost'} small" data-toggle-namehidden="${i}" style="padding:4px 8px;font-size:10px;" title="Il Digimon resta visibile in Scena, ma nome/descrizione restano '???' per i giocatori finché non lo riveli">${e.nameHidden?'🏷️ Rivela Nome':'🎭 Nascondi Nome'}</button>
          <button class="btn ghost small" data-dupe-enc="${i}" style="padding:4px 8px;font-size:10px;" title="Aggiunge una copia identica">+1 copia</button>
          ${already ? `<button class="btn ghost small" data-refresh-atk="${i}" style="padding:4px 8px;font-size:10px;" title="Ricarica Attacchi + Immagine/GIF dal Digidex — utile se sono stati aggiornati o se erano stati importati prima di una correzione">🔄 Sincronizza da Dex</button>` : ''}
          ${needsDiscover ? `<button class="btn small" data-discover-dex="${i}" style="padding:4px 8px;font-size:10px;background:var(--amber, #ffb347);color:#241a03;" title="Segna questo Digimon come scoperto sul Digidex — lo rivela lì (nome/immagine/evoluzioni) subito, senza dover aspettare che qualcuno lo clicchi in Scena">📖 Scopri nel Dex</button>` : ''}
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
        <div class="field" style="margin-top:6px;"><label>📍 Dove si trova (i giocatori lo vedranno in Scena solo da lì — "Ovunque" = comportamento di prima, sempre visibile)</label>
          <select id="draft-location">${locationOptionsHTML(cachedScene.currentSectorId, cachedScene.currentSubsectionId, cachedScene.currentLuogoId)}</select>
        </div>
        <div class="chat-color-field" style="margin-top:6px;">
          <label class="muted">🎨 Colore scritta in chat (quando lo fai "Parlare" — resta questo ogni volta, senza doverlo re-impostare)</label>
          <input type="color" id="draft-chatcolor" class="chat-color-swatch" value="${escapeAttr(d.chatColor||'#ff5d5d')}" />
        </div>
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
        <label style="font-size:11px;display:flex;align-items:center;gap:6px;margin:8px 0 4px;"><input type="checkbox" id="draft-isboss" ${d.isBoss?'checked':''} /> 👑 Boss (bordo rosso nella scena)</label>
        <div class="row" id="draft-boss-bonus-wrap" style="display:${d.isBoss?'flex':'none'};margin-bottom:8px;">
          <div class="field" style="flex:2;"><label>Bonus Boss a</label>
            <select id="draft-boss-stat">
              <option value="">— nessuno —</option>
              ${Object.entries(BOSS_BONUS_STATS).map(([k,v])=>`<option value="${k}" ${d.bossBonusStat===k?'selected':''}>${v}</option>`).join('')}
            </select>
          </div>
          <div class="field" style="flex:1;"><label>Di quanto</label><input type="number" id="draft-boss-bonus" value="${d.bossBonusAmount||2}" min="0" /></div>
        </div>
        <div class="row" style="margin-top:6px;">
          <button class="btn solid small" id="btn-confirm-encounter" style="flex:2;">✅ Conferma e Aggiungi alla Scena</button>
          <button class="btn ghost small" id="btn-cancel-encounter" style="flex:1;">Annulla</button>
        </div>
      </div>
    `;
    // Richiesta utente ("vogliamo creare questo automatismo?" sul flag Boss): mostra il
    // selettore Statistica/Bonus solo quando la spunta Boss è attiva, così chi non vuole dare
    // nessun bonus non vede campi in più — invariato rispetto a prima se si lascia "— nessuno —".
    const draftBossChk = document.getElementById('draft-isboss');
    const draftBossBonusWrap = document.getElementById('draft-boss-bonus-wrap');
    if(draftBossChk && draftBossBonusWrap){
      draftBossChk.onchange = ()=>{ draftBossBonusWrap.style.display = draftBossChk.checked ? 'flex' : 'none'; };
    }
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
      const locEl = document.getElementById('draft-location');
      const locVal = locEl ? locEl.value : '';
      const { sectorId, subsectionId, luogoId } = parseLocationOptionValue(locVal);
      const chatColorEl = document.getElementById('draft-chatcolor');
      const chatColor = chatColorEl ? chatColorEl.value : '#ff5d5d';
      const baseStats = {
        baseAccuracy: Number(document.getElementById('draft-acc').value)||0,
        baseDamage: Number(document.getElementById('draft-dmg').value)||0,
        baseDodge: Number(document.getElementById('draft-dodge').value)||0,
        baseArmor: Number(document.getElementById('draft-arm').value)||0,
        baseHealth: Number(document.getElementById('draft-hp').value)||0
      };
      // Richiesta utente: segnare Boss durante la costruzione chiede a quale Statistica dare il
      // bonus (invece di un bonus fisso automatico) — applicato qui direttamente alle Stat base
      // prima di salvare l'Incontro, e tracciato su bossBonusStat/bossBonusAmount così togliere
      // il flag Boss in seguito (vedi data-toggle-boss più sotto) può annullarlo esattamente.
      let bossBonusStat = null, bossBonusAmount = 0;
      if(isBoss){
        const statSel = document.getElementById('draft-boss-stat');
        const amountInp = document.getElementById('draft-boss-bonus');
        const statKey = statSel ? statSel.value : '';
        const amount = amountInp ? Math.max(0, Number(amountInp.value)||0) : 0;
        if(statKey && amount>0 && BOSS_BONUS_STATS[statKey]){
          baseStats[statKey] = Number(baseStats[statKey]||0) + amount;
          bossBonusStat = statKey;
          bossBonusAmount = amount;
        }
      }
      const finalEncounter = { id: encounterDraft.id, name, dexId: encounterDraft.dexId, stage, categories, image, description, baseStats, attacks: encounterDraft.attacks || [], revealed:false, isBoss, bossBonusStat, bossBonusAmount, sectorId, subsectionId, luogoId, chatColor };
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
          revealed:false, isBoss:false, bossBonusStat:null, bossBonusAmount:0, chatColor:'#ff5d5d'
        } : {
          id:'enc'+Date.now()+Math.random().toString(36).slice(2,6),
          name, dexId:null, stage:'Rookie', categories:[], image:'', description:'',
          baseStats:{baseAccuracy:0,baseDamage:0,baseDodge:0,baseArmor:0,baseHealth:0}, attacks:[], revealed:false, isBoss:false, bossBonusStat:null, bossBonusAmount:0, chatColor:'#ff5d5d'
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
    // Posizione dell'Incontro (fase 21): valore "" = Ovunque nella scena, "sectorId" = quel
    // Settore (qualunque Luogo), "sectorId:luogoId" = esattamente quel Luogo.
    live.querySelectorAll('[data-enc-location]').forEach(sel=>{
      sel.onchange = async ()=>{
        const idx = Number(sel.getAttribute('data-enc-location'));
        const e = cachedScene.encounters[idx];
        if(!e) return;
        const val = sel.value;
        const { sectorId, subsectionId, luogoId } = parseLocationOptionValue(val);
        e.sectorId = sectorId;
        e.subsectionId = subsectionId;
        e.luogoId = luogoId;
        await saveScene(code, cachedScene);
        live.innerHTML = encountersEditableHTML(cachedScene.encounters);
        bindEncountersInnerActions(code, username, onChanged);
        if(onChanged) onChanged();
      };
    });
    // Colore scritta in chat (richiesta utente: "fai sì che possa sceglierlo quando lo aggiungo in
    // scena così che resti sempre lo stesso e non devo cambiarlo ogni volta"): persistito
    // sull'Incontro (chatColor, vedi js/encounters.js) così ogni volta che il Master lo fa
    // "Parlare" (Parla come, nelle tre chat) il picker si precompila da solo con questo colore —
    // vedi applySpeakAsMode/applyPrivSpeakAsMode/applySubSpeakAsMode. Editabile anche qui per un
    // Incontro già piazzato, non solo alla creazione (renderEncounterDraftCard).
    live.querySelectorAll('[data-enc-chatcolor]').forEach(inp=>{
      inp.onchange = async ()=>{
        const idx = Number(inp.getAttribute('data-enc-chatcolor'));
        const e = cachedScene.encounters[idx];
        if(!e) return;
        e.chatColor = inp.value;
        await saveScene(code, cachedScene);
        live.innerHTML = encountersEditableHTML(cachedScene.encounters);
        bindEncountersInnerActions(code, username, onChanged);
        if(onChanged) onChanged();
      };
    });
    // "🎭 Nascondi Nome" / "🏷️ Rivela Nome": indipendente dalla visibilità dell'Incontro (sopra).
    // Il Digimon resta visto (presenza in Scena), ma nome/immagine/descrizione restano "???" ai
    // giocatori finché il Master non lo rivela — vedi encountersReadonlyHTML e combatDisplayName.
    live.querySelectorAll('[data-toggle-namehidden]').forEach(btn=>{
      btn.onclick = async ()=>{
        const idx = Number(btn.getAttribute('data-toggle-namehidden'));
        const e = cachedScene.encounters[idx];
        if(!e) return;
        e.nameHidden = !e.nameHidden;
        // Propaga lo stesso stato ai partecipanti al combattimento già collegati a questo
        // Incontro (se ce ne sono), così la linea delle distanze/l'ordine dei turni si aggiornano
        // subito senza dover ri-aggiungere il Digimon al combattimento.
        if(cachedCombat && Array.isArray(cachedCombat.participants)){
          cachedCombat.participants.forEach(p=>{
            if(p.sourceEncounterId!==e.id) return;
            p.nameHidden = e.nameHidden;
            // Se lo nascondiamo ORA (non aveva già un'etichetta), assegna subito un numero
            // stabile ("Nemico N") — vedi assignHiddenLabelNum in js/encounters.js.
            if(p.nameHidden) assignHiddenLabelNum(cachedCombat, p);
          });
          // Non possiamo chiamare saveCombat(): è definita dentro la IIFE principale di
          // index.html (script caricato DOPO questo file), quindi invisibile da qui — a
          // differenza di saveScene, che è stata spostata in questo stesso file. apiPost
          // (js/api.js, vera funzione globale) replica esattamente ciò che fa saveCombat.
          if(cachedCombat.active) await apiPost('/api/state', { resource:'combat', code, data: cachedCombat });
        }
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
        if(!e.baseStats) e.baseStats = {baseAccuracy:0,baseDamage:0,baseDodge:0,baseArmor:0,baseHealth:0};
        if(!e.isBoss){
          // Attivazione: richiesta utente ("durante la costruzione chiede a cosa dare bonus") —
          // questo bottone marca Boss anche su un Incontro GIÀ aggiunto alla Scena (non solo in
          // fase di bozza), quindi la stessa domanda va posta anche qui. window.prompt perché
          // questo bottone non ha un form proprio attorno (stesso pattern già usato altrove in
          // questo file, es. URL immagine Settore/Luogo).
          const keys = Object.keys(BOSS_BONUS_STATS);
          const menu = keys.map((k,i)=>`${i+1}. ${BOSS_BONUS_STATS[k]}`).join('\n');
          const choice = window.prompt(`A quale Statistica dare il bonus Boss? Scrivi il numero (lascia vuoto per nessun bonus):\n${menu}`, '');
          if(choice && choice.trim()){
            const statKey = keys[Number(choice.trim())-1];
            if(statKey){
              const amountRaw = window.prompt(`Di quanto aumentare ${BOSS_BONUS_STATS[statKey]}?`, '2');
              const amount = Math.max(0, Number(amountRaw)||0);
              if(amount>0){
                e.baseStats[statKey] = Number(e.baseStats[statKey]||0) + amount;
                e.bossBonusStat = statKey;
                e.bossBonusAmount = amount;
              }
            }
          }
        } else if(e.bossBonusStat && e.bossBonusAmount){
          // Disattivazione: annulla ESATTAMENTE il bonus dato all'attivazione, così il flag Boss
          // resta reversibile invece di lasciare la Statistica gonfiata per sempre anche dopo
          // averlo tolto.
          e.baseStats[e.bossBonusStat] = Math.max(0, Number(e.baseStats[e.bossBonusStat]||0) - e.bossBonusAmount);
          e.bossBonusStat = null;
          e.bossBonusAmount = 0;
        }
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
          gifUrl: (e && e.gif) || '',
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
    // Bottone "📖 Scopri nel Dex" (richiesta di Rocco): marca all'istante come discovered la
    // voce del Digidex già collegata a questo Incontro, senza dover aspettare che qualcuno
    // clicchi sulla sua card in Scena (openEncounterDetail) né passare da dex.html. Usa
    // markDexEntryDiscovered, la stessa funzione (fattorizzata da questo stesso file) che fa la
    // scoperta automatica, quindi stessa identica salvaguardia contro la cancellazione di
    // GIF/mosse/evoluzioni per un PUT parziale su /api/dex.
    live.querySelectorAll('[data-discover-dex]').forEach(btn=>{
      btn.onclick = async ()=>{
        const idx = Number(btn.getAttribute('data-discover-dex'));
        const e = cachedScene.encounters[idx];
        if(!e) return;
        const dexMatch = dexMatchForEncounter(e);
        if(!dexMatch) return;
        btn.disabled = true;
        const ok = await markDexEntryDiscovered(code, dexMatch);
        if(!ok){
          btn.disabled = false;
          alert('⚠ Errore: impossibile aggiornare il Digidex (' + (lastApiError || 'sconosciuto') + ').');
          return;
        }
        live.innerHTML = encountersEditableHTML(cachedScene.encounters);
        bindEncountersInnerActions(code, username, onChanged);
        const dexLive = document.getElementById('dex-live');
        if(dexLive){ dexLive.innerHTML = dexListHTML(cachedDex, true); bindDexEditButtons(code); }
        if(onChanged) onChanged();
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
          name: e.name, stage: e.stage||'Rookie', description: e.description||'', imageUrl: e.image||'', gifUrl: e.gif||'',
          categories: e.categories||[], baseStats: e.baseStats||{}, addedBy: username, discovered: true
        });
        if(d && d.entry){ cachedDex.push(d.entry); dexMatch = d.entry; }
      } else if(!dexMatch.discovered){
        // FIX GIF cancellata dal Digidex (segnalato da Rocco) + fattorizzazione (richiesta "manca
        // un tasto per far scoprire il digimon in scena direttamente sul dex"): questa logica ora
        // vive in markDexEntryDiscovered (data layer, cima del file), condivisa con il bottone
        // "📖 Scopri nel Dex" del pannello Incontri — stessa identica salvaguardia contro un PUT
        // parziale su /api/dex che azzererebbe GIF/mosse/evoluzioni non incluse nella chiamata.
        await markDexEntryDiscovered(code, dexMatch);
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
