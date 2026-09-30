// js/dungeon.js
// Dungeon a caselle — vista di GIOCO dentro la Scena di index.html (Master e Giocatori).
// L'editor (disegno caselle, stanze, contenuti, dimensione griglia) vive invece in
// js/dungeon-editor.js, caricato da map.html. Server: /api/state?resource=dungeon (lib/dungeon.js).
//
// Regole (confermate da Rocco, 2026-09-30):
//   - una sola pedina per tutto il gruppo; la muove solo il 👑 Capofila, eletto a maggioranza dai
//     giocatori (si può rivotare in qualsiasi momento; il Master può anche nominarlo a mano);
//   - una casella alla volta (su/giù/sinistra/destra); ogni passo costa 1 ⚡ Punto Dungeon e fa
//     avanzare di 1 minuto l'Orologio di Gioco (canale Generale);
//   - 5 Punti; li ricarica il Master, oppure tornano pieni da soli 10 ore dopo la prima spesa;
//   - entrare in una stanza la rivela tutta (resta scoperta) e ne pubblica in chat nome,
//     descrizione e immagine;
//   - Trappola -> richiesta di tiro (::REQ::) al solo Capofila; Tesoro -> messaggio Loot in chat;
//     Incontro -> avviso in chat (il Master avvia il combattimento dal Combat Manager come sempre);
//     Porta chiusa -> si apre se un giocatore ha in Inventario l'oggetto chiave, o se la sblocca il
//     Master.
// Seconda richiesta (stesso giorno): terreno difficile (2 Punti), porte segrete (🔍 Cerca: una
// volta per ricarica, nella stanza o attorno alla pedina), scale/teletrasporti, punti di ristoro,
// leve, icone personalizzabili per ogni contenuto e immagine della stanza stesa sulla mappa.
// Collegamento a un luogo (quarta richiesta): un dungeon collegato a un Settore/Sottosezione
// (dg.link, scelto nell'editor) si attiva per i giocatori quando accettano l'invito "Vuoi andare
// a…?" mandato dal Master da qui (📨 Invita a entrare, stesse modalità degli inviti di Mappa). Il
// server lo mostra solo a chi si trova lì e fa votare/muovere solo i presenti (state.present).
// Sotto la mappa c'è la CHAT DEL DUNGEON: la Chat Generale filtrata sulla posizione del dungeon
// (stessi messaggi della chat normale con il filtro 📍 di quel luogo); tutti i messaggi automatici
// del dungeon vengono taggati con quella posizione (dgLog).
// Chi muove riceve dal server gli eventi appena scattati (una volta sola, grazie al
// compare-and-swap lato server) ed è il suo client a pubblicarli in chat con pushLog — stesso
// schema del voto di spostamento (justResolved) già in uso.
//
// Dipende da (globali già caricati): apiGet/apiPost (js/api.js), escapeHTML/escapeAttr/displayName
// (js/util.js), session/cachedRoster/cachedScene (js/store.js), SKILL_DEFS (js/rules.js),
// pushLog (js/chat-log-engine.js). Le funzioni che vivono dentro l'IIFE di index.html (Orologio di
// Gioco, notifiche push mirate) arrivano tramite il contesto passato a DungeonView.mount().

(function(){
  const ATTR_LABEL = { agility:'Agility', body:'Body', charisma:'Charisma', intelligence:'Intelligence', willpower:'Willpower' };
  const REFILL_MS = 10*60*60*1000;
  let ctx = null;
  let rootEl = null;
  let state = null;          // risposta GET (già filtrata dal server per i giocatori)
  let busy = false;
  let statusMsg = '';
  let masterMode = 'look';   // 'look' | 'teleport' | 'unlock'
  let lastLoadError = null;

  function injectStyles(){
    if(document.getElementById('dungeon-view-styles')) return;
    const st = document.createElement('style');
    st.id = 'dungeon-view-styles';
    st.textContent = `
      .dg-wrap{margin-top:12px;}
      .dg-grid{display:grid;gap:1px;background:#05080b;padding:1px;border:1px solid var(--line);width:max-content;max-width:100%;margin:6px auto;touch-action:manipulation;}
      .dg-cell{position:relative;display:flex;align-items:center;justify-content:center;font-size:11px;line-height:1;user-select:none;}
      .dg-unk{background:#020304;}
      .dg-wall{background:#1a2226;background-image:repeating-linear-gradient(45deg,rgba(255,255,255,0.03) 0 2px,transparent 2px 5px);}
      .dg-floor{background:#22343a;}
      .dg-room{background:#2b4a4f;}
      .dg-door{background:#5a3d1e;}
      .dg-ent{background:#1f5a3a;}
      .dg-exit{background:#5a1f4e;}
      .dg-hard{background:repeating-linear-gradient(135deg,#4a3d2b 0 3px,#382e22 3px 6px);}
      .dg-secret{background:#4d2d6b;}
      .dg-ico img{width:85%;height:85%;object-fit:contain;display:block;margin:auto;}
      .dg-hidden{opacity:0.45;}
      .dg-reach{outline:2px solid var(--cyan);outline-offset:-2px;cursor:pointer;animation:dgpulse 1.4s infinite;}
      .dg-click{cursor:pointer;}
      .dg-token{position:absolute;inset:8%;border-radius:50%;background:radial-gradient(circle,#ffd35a,#ff8a3d);box-shadow:0 0 8px #ffb020;display:flex;align-items:center;justify-content:center;overflow:hidden;z-index:2;}
      .dg-token img{width:100%;height:100%;object-fit:cover;}
      .dg-ico{position:relative;z-index:1;pointer-events:none;}
      @keyframes dgpulse{0%,100%{outline-color:var(--cyan);}50%{outline-color:rgba(53,232,201,0.25);}}
      .dg-bar{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;font-size:11.5px;margin:4px 0;}
      .dg-pad{display:grid;grid-template-columns:repeat(3,38px);grid-template-rows:repeat(3,34px);gap:3px;justify-content:center;margin:6px auto;}
      .dg-pad button{padding:0;font-size:15px;}
      .dg-room-card{display:flex;gap:10px;align-items:flex-start;padding:8px;border:1px solid var(--line);border-left:3px solid var(--cyan);border-radius:4px;background:var(--panel-2);margin:6px 0;}
      .dg-room-card img{width:120px;max-height:90px;object-fit:cover;border-radius:3px;cursor:zoom-in;flex:0 0 auto;}
      .dg-room-card .desc{font-size:11.5px;white-space:pre-wrap;color:var(--text);}
      .dg-legend{font-size:10px;color:var(--text-mute);text-align:center;}
      .dg-status{font-size:11px;min-height:14px;color:var(--amber);}
    `;
    document.head.appendChild(st);
  }

  function isMaster(){ return !!(ctx && ctx.role==='master'); }
  function isLinked(dg){ return !!(dg && dg.link && dg.link.sectorId); }
  // Chiave di posizione (stesso formato di currentLocationKey/memberLocationKey) usata per taggare
  // i messaggi del dungeon: il luogo collegato, oppure la posizione del gruppo se non collegato.
  function dungeonKey(dg){
    dg = dg || activeDungeon();
    if(isLinked(dg)) return `${dg.link.macroId||'_'}|${dg.link.sectorId}|${dg.link.subsectionId||'_'}|${dg.link.luogoId||'_'}`;
    return typeof currentLocationKey==='function' ? currentLocationKey() : undefined;
  }
  function entryInDungeon(e, dg){
    const raw = e && e.meta && e.meta.location;
    if(!raw || !dg) return false;
    const key = typeof normalizeLocationKey==='function' ? normalizeLocationKey(raw) : raw;
    const parts = String(key).split('|');
    if(isLinked(dg)) return parts[1]===dg.link.sectorId && (!dg.link.subsectionId || parts[2]===dg.link.subsectionId) && (!dg.link.luogoId || parts[3]===dg.link.luogoId);
    const dk = dungeonKey(dg);
    return !!dk && key===(typeof normalizeLocationKey==='function' ? normalizeLocationKey(dk) : dk);
  }
  function dgLog(entry){
    const meta = Object.assign({}, entry.meta||{});
    const key = dungeonKey();
    if(key && meta.location===undefined) meta.location = key;
    return pushLog(ctx.code, Object.assign({}, entry, { meta }));
  }
  function linkLabel(dg){
    if(!isLinked(dg)) return '';
    const sc = typeof cachedScene!=='undefined' ? cachedScene : null;
    let sName = null, subName = null, lName = null;
    ((sc && sc.macroScenes)||[]).forEach(m=>(m.sectors||[]).forEach(sct=>{ if(sct.id===dg.link.sectorId){
      sName = `${m.name} → ${sct.name}`;
      const sub = (sct.subsections||[]).find(x=>x.id===dg.link.subsectionId); if(sub) subName = sub.name;
      const lg = ((sub ? sub.luoghi : sct.luoghi)||[]).find(x=>x.id===dg.link.luogoId); if(lg) lName = lg.name;
    } }));
    return (sName || 'luogo non trovato in Mappa') + (subName ? ` → ${subName}` : '') + (lName ? ` → 📍 ${lName}` : '');
  }
  // Giocatori "nel dungeon": per un dungeon collegato, quelli che il server dice presenti; altrimenti tutti.
  function presentPlayers(){
    const dg = activeDungeon();
    if(!isLinked(dg)) return players();
    const pres = (state && state.present) || [];
    return players().filter(m=>pres.includes(m.username));
  }
  function players(){ return (cachedRoster||[]).filter(m=>m.role==='player'); }
  function nameOf(u){ const m = (cachedRoster||[]).find(x=>x.username===u); return m ? displayName(m) : (u||''); }
  function activeDungeon(){
    if(!state || !state.activeId) return null;
    return (state.dungeons||[]).find(d=>d.id===state.activeId) || null;
  }
  function amLeader(){ return !!(state && state.party && ctx && ctx.role==='player' && state.party.leader===ctx.username); }

  async function load(){
    const d = await apiGet('/api/state?resource=dungeon&code=' + encodeURIComponent(ctx.code) + '&username=' + encodeURIComponent(ctx.username), true);
    if(d && d.dungeon){ state = d.dungeon; lastLoadError = d.warning || null; }
    else if(!state) lastLoadError = 'Impossibile caricare il dungeon.';
  }

  async function op(body){
    busy = true;
    const d = await apiPost('/api/state', Object.assign({ resource:'dungeon', code: ctx.code, username: ctx.username }, body));
    busy = false;
    if(d && d.dungeon) state = d.dungeon;
    return d;
  }

  // ---------- rendering ----------
  function refillLabel(p){
    if(!p || !p.lastRefillAt || (p.points >= p.maxPoints && !p.searchUsed)) return '';
    const left = new Date(p.lastRefillAt).getTime() + REFILL_MS - Date.now();
    if(left <= 0) return ' · ricarica al prossimo aggiornamento';
    const h = Math.floor(left/3600000), m = Math.floor((left%3600000)/60000);
    return ` · ricarica tra ${h}h ${String(m).padStart(2,'0')}m`;
  }

  function leaderAvatar(){
    const u = state && state.party && state.party.leader;
    const m = u ? (cachedRoster||[]).find(x=>x.username===u) : null;
    // Il Digimon del Capofila, salvo che sia nascosto al gruppo: allora il ritratto del Tamer.
    const hidden = m && typeof isDigimonHiddenFromViewer==='function' && isDigimonHiddenFromViewer(m);
    const img = m ? ((!hidden && m.digimon && m.digimon.imageUrl) || (m.tamer && m.tamer.imageUrl) || '') : '';
    return img ? `<img src="${escapeAttr(img)}" onerror="this.remove()" />` : '';
  }

  function neighbors4(dg, idx){
    const r = Math.floor(idx/dg.cols), c = idx%dg.cols, out = [];
    if(r>0) out.push(idx-dg.cols);
    if(r<dg.rows-1) out.push(idx+dg.cols);
    if(c>0) out.push(idx-1);
    if(c<dg.cols-1) out.push(idx+1);
    return out;
  }
  const WALK = { f:1, d:1, e:1, x:1, h:1, s:1 };
  const DEFAULT_ICON = { key:'🗝️', trap:'⚠️', loot:'🎁', encounter:'⚔️', lock:'🔒', note:'📜', teleport:'🪜', rest:'⛺', lever:'🕹️' };
  function stepCost(dg, i){ return dg.grid[i]==='h' ? 2 : 1; }
  function icoHTML(ic){ return /^(https?:|data:|\/)/i.test(String(ic||'')) ? `<img src="${escapeAttr(ic)}" onerror="this.remove()" />` : escapeHTML(ic); }

  function cellClass(dg, i){
    const t = dg.grid[i];
    if(t==='?') return 'dg-unk';
    if(t==='.') return 'dg-wall';
    if(t==='d') return 'dg-door';
    if(t==='e') return 'dg-ent';
    if(t==='x') return 'dg-exit';
    if(t==='h') return 'dg-hard';
    if(t==='s') return 'dg-secret';
    return dg.roomOf[i] ? 'dg-room' : 'dg-floor';
  }

  function featureIcon(dg, i){
    const f = dg.features && dg.features[i];
    const run = dg.run || {};
    const fired = (run.fired||[]).includes(i);
    const unlocked = (run.unlocked||[]).includes(i);
    let ico = '';
    if(dg.grid[i]==='e') ico = '⛩️';
    if(dg.grid[i]==='x') ico = '🚪';
    if(dg.grid[i]==='s' && isMaster() && !(run.found||[]).includes(i)) return `<span class="dg-ico dg-hidden">🕳️</span>`;
    if(f){
      const own = f.icon || DEFAULT_ICON[f.type] || '';
      if(f.type==='lock') ico = (f.unlocked || unlocked) ? '🔓' : own;
      else if(f.type==='loot' || f.type==='key') ico = (f.taken || fired) ? '' : own;
      else if(f.type==='rest') ico = (f.once && (f.fired || fired)) ? '' : own;
      else if(f.type==='lever') ico = own;
      else ico = own;
      // Il Master vede anche i contenuti non ancora scattati (trappole, incontri, note), sbiaditi.
      if(isMaster() && !fired && ['trap','encounter','note'].includes(f.type)) return `<span class="dg-ico dg-hidden">${icoHTML(ico)}</span>`;
      if(f.type==='lever' && (f.fired || fired)) return `<span class="dg-ico dg-hidden">${icoHTML(ico)}</span>`;
    }
    return ico ? `<span class="dg-ico">${icoHTML(ico)}</span>` : '';
  }

  function gridHTML(dg){
    const avail = Math.max(160, (rootEl && rootEl.clientWidth ? rootEl.clientWidth : 320) - 12);
    const size = Math.max(10, Math.min(30, Math.floor(avail/dg.cols) - 1));
    const pos = dg.run ? dg.run.pos : null;
    const reach = new Set();
    const pts = Number(state.party && state.party.points)||0;
    if(pos!=null && amLeader()) neighbors4(dg, pos).forEach(i=>{ if(WALK[dg.grid[i]] && pts>=stepCost(dg, i)) reach.add(i); });
    // Immagine della stanza stesa sulle sue caselle (room.showOnMap), calcolata sul riquadro della stanza.
    const step = size+1, bbox = {};
    (dg.rooms||[]).forEach(rm=>{ if(rm.image && rm.showOnMap!==false) bbox[rm.id] = { r0:1e9, c0:1e9, r1:-1, c1:-1 }; });
    dg.roomOf.forEach((rid,i)=>{ const b = rid && bbox[rid]; if(!b) return; const rr = Math.floor(i/dg.cols), cc = i%dg.cols; b.r0=Math.min(b.r0,rr); b.c0=Math.min(b.c0,cc); b.r1=Math.max(b.r1,rr); b.c1=Math.max(b.c1,cc); });
    let html = `<div class="dg-grid" style="grid-template-columns:repeat(${dg.cols},${size}px);grid-auto-rows:${size}px;font-size:${Math.max(8, Math.floor(size*0.6))}px;">`;
    for(let i=0;i<dg.grid.length;i++){
      const cls = cellClass(dg, i);
      const r = reach.has(i);
      const masterClick = isMaster() && masterMode!=='look' && WALK[dg.grid[i]];
      const room = dg.roomOf[i] ? (dg.rooms||[]).find(x=>x.id===dg.roomOf[i]) : null;
      let bgStyle = '';
      const b = room && bbox[room.id];
      if(b && dg.grid[i]!=='?' && dg.grid[i]!=='.'){
        const rr = Math.floor(i/dg.cols), cc = i%dg.cols;
        bgStyle = `background-image:url('${String(room.image).replace(/'/g,'%27')}');background-size:${(b.c1-b.c0+1)*step}px ${(b.r1-b.r0+1)*step}px;background-position:${-(cc-b.c0)*step}px ${-(rr-b.r0)*step}px;`;
      }
      html += `<div class="dg-cell ${cls} ${r?'dg-reach':''} ${masterClick?'dg-click':''}" style="${bgStyle}" ${(r||masterClick)?`data-dg-cell="${i}"`:''} title="${room?escapeAttr(room.name):''}${dg.grid[i]==='h'?' (terreno difficile: 2 Punti)':''}">`
        + featureIcon(dg, i)
        + (i===pos ? `<div class="dg-token">${leaderAvatar()}</div>` : '')
        + `</div>`;
    }
    return html + '</div>';
  }

  function roomCardHTML(dg){
    const pos = dg.run ? dg.run.pos : null;
    if(pos==null) return '';
    const rid = dg.roomOf[pos];
    const room = rid ? (dg.rooms||[]).find(r=>r.id===rid) : null;
    if(!room){
      return `<div class="muted" style="font-size:11px;text-align:center;">Siete in un corridoio.</div>`;
    }
    return `<div class="dg-room-card">
      ${room.image ? `<img src="${escapeAttr(room.image)}" data-avatar-expand="${escapeAttr(room.image)}" onerror="this.remove()" />` : ''}
      <div><b>🏛️ ${escapeHTML(room.name)}</b>${room.desc ? `<div class="desc">${escapeHTML(room.desc)}</div>` : ''}</div>
    </div>`;
  }

  function partyHTML(){
    const p = state.party || {};
    const list = presentPlayers();
    const dgA = activeDungeon();
    const presentLine = isLinked(dgA) ? `<div class="dg-bar"><span class="muted">🧍 Nel dungeon: ${list.length ? list.map(m=>escapeHTML(displayName(m))).join(', ') : 'nessuno'}</span></div>` : '';
    const votes = p.votes || {};
    const need = Math.floor(list.length/2)+1;
    const counts = {};
    Object.keys(votes).forEach(v=>{ if(list.some(x=>x.username===v)) counts[votes[v]] = (counts[votes[v]]||0)+1; });
    const tally = Object.keys(counts).map(u=>`${escapeHTML(nameOf(u))} ${counts[u]}/${list.length}`).join(' · ');
    const myVote = ctx.role==='player' ? votes[ctx.username] : null;
    let voteUI = '';
    if(ctx.role==='player'){
      voteUI = `<div class="dg-bar">
        <span class="muted">🗳️ Vota il Capofila:</span>
        <select id="dg-vote-sel" style="max-width:160px;">${list.map(m=>`<option value="${escapeAttr(m.username)}" ${myVote===m.username?'selected':''}>${escapeHTML(displayName(m))}</option>`).join('')}</select>
        <button class="btn small" id="dg-vote-btn">${myVote?'Cambia voto':'Vota'}</button>
        <span class="muted" style="font-size:10.5px;">serve la maggioranza (${need}/${list.length})${tally?` — ${tally}`:''}</span>
      </div>`;
    } else {
      voteUI = `<div class="dg-bar"><span class="muted">🗳️ Voti: ${tally || 'nessuno'} (maggioranza ${need}/${list.length})</span></div>`;
    }
    return `<div class="dg-bar">
        <span>👑 Capofila: <b>${p.leader ? escapeHTML(nameOf(p.leader)) : '— da eleggere —'}</b></span>
        <span>⚡ Punti Dungeon: <b>${Number(p.points)||0}/${Number(p.maxPoints)||5}</b><span class="muted">${refillLabel(p)}</span></span>
      </div>${presentLine}${list.length ? voteUI : ''}`;
  }

  function padHTML(dg){
    if(!amLeader() || dg.run.pos==null) return '';
    const pos = dg.run.pos, r = Math.floor(pos/dg.cols), c = pos%dg.cols;
    const pts = Number(state.party.points)||0;
    const can = (idx, ok)=> ok && WALK[dg.grid[idx]] && pts>=stepCost(dg, idx) ? `data-dg-cell="${idx}"` : 'disabled';
    const up = can(pos-dg.cols, r>0), down = can(pos+dg.cols, r<dg.rows-1), left = can(pos-1, c>0), right = can(pos+1, c<dg.cols-1);
    const used = !!state.party.searchUsed;
    return `<div class="dg-pad">
      <span></span><button class="btn small" ${up}>⬆️</button><span></span>
      <button class="btn small" ${left}>⬅️</button><span style="display:flex;align-items:center;justify-content:center;font-size:10px;" class="muted">👑</span><button class="btn small" ${right}>➡️</button>
      <span></span><button class="btn small" ${down}>⬇️</button><span></span>
    </div>
    <div style="text-align:center;margin-bottom:4px;"><button class="btn ghost small" id="dg-search-btn" ${used?'disabled':''} title="Una volta per ricarica: cerca passaggi segreti nella stanza in cui siete (o attorno a voi, se siete in corridoio). Non costa Punti.">🔍 ${used?'Ricerca già usata (torna alla ricarica)':'Cerca passaggi segreti'}</button></div>`;
  }

  // Invito a entrare (solo dungeon collegati): stesso messaggio ::MOVEREQ:: degli inviti di Mappa.
  let inviteDgId = null;
  function inviteHTML(){
    const list = (state.dungeons||[]).filter(isLinked);
    if(!list.length) return `<div class="muted" style="font-size:10.5px;margin:2px 0 6px;">💡 Collega un dungeon a un Settore/Sottosezione nell'editor per poter invitare i giocatori a entrarci (e avere la sua chat).</div>`;
    if(!inviteDgId || !list.some(d=>d.id===inviteDgId)) inviteDgId = (list.find(d=>d.id===state.activeId) || list[0]).id;
    const subs = (typeof cachedSubgroups!=='undefined' && cachedSubgroups) ? cachedSubgroups : [];
    const cur = list.find(d=>d.id===inviteDgId);
    return `<div class="dg-bar" style="border:1px dashed var(--line);padding:6px;border-radius:4px;">
      <span>📨 Invita a entrare in</span>
      <select id="dg-inv-dg" style="max-width:170px;">${list.map(d=>`<option value="${escapeAttr(d.id)}" ${d.id===inviteDgId?'selected':''}>🏰 ${escapeHTML(d.name)}</option>`).join('')}</select>
      <span class="muted" style="font-size:10.5px;">📍 ${escapeHTML(linkLabel(cur))}</span>
      <select id="dg-inv-target" style="max-width:170px;">
        <option value="">📣 Chat Generale</option>
        ${subs.map(g=>`<option value="subgroup:${escapeAttr(g.id)}">👥 ${escapeHTML(g.name||'Sottogruppo')}</option>`).join('')}
        ${players().map(m=>`<option value="${escapeAttr(m.username)}">✉️ ${escapeHTML(displayName(m))}</option>`).join('')}
      </select>
      <select id="dg-inv-mode" style="max-width:190px;">
        <option value="each">Ognuno per sé</option>
        <option value="all">Tutti insieme (basta un sì)</option>
        <option value="majority">A maggioranza</option>
        <option value="unanimous">Aspetta tutti</option>
      </select>
      <button class="btn amber small" id="dg-inv-btn">📨 Invita</button>
    </div>`;
  }

  function masterHTML(){
    const list = state.dungeons || [];
    const dg = activeDungeon();
    return `<div class="dg-bar">
        <select id="dg-active-sel" style="max-width:190px;">
          <option value="">— il gruppo non è in un dungeon —</option>
          ${list.map(d=>`<option value="${escapeAttr(d.id)}" ${state.activeId===d.id?'selected':''}>🏰 ${escapeHTML(d.name)} (${d.cols}×${d.rows})</option>`).join('')}
        </select>
        <button class="btn small" id="dg-active-btn" title="Attiva subito il dungeon (per un dungeon collegato lo vede chi è già in quel luogo)">${state.activeId?'Cambia':'Attiva'}</button>
        ${state.activeId ? `<button class="btn ghost small" id="dg-exit-btn">Chiudi dungeon</button>` : ''}
        <a class="btn ghost small" href="map.html" target="_blank" style="text-decoration:none;">✏️ Editor (Mappa)</a>
      </div>
      ${inviteHTML()}
      <div class="dg-bar">
        <label class="muted" style="margin:0;">Max ⚡</label><input type="number" id="dg-max" min="1" max="99" value="${Number(state.party.maxPoints)||5}" style="width:52px;" />
        <button class="btn small" id="dg-refill-btn">↺ Ricarica Punti</button>
        <select id="dg-leader-sel" style="max-width:150px;"><option value="">— Capofila —</option>${players().map(m=>`<option value="${escapeAttr(m.username)}" ${state.party.leader===m.username?'selected':''}>${escapeHTML(displayName(m))}</option>`).join('')}</select>
        <button class="btn ghost small" id="dg-leader-btn">Nomina</button>
      </div>
      ${dg ? `<div class="dg-bar">
        <span class="muted">Clic sulla mappa:</span>
        <button class="btn ${masterMode==='look'?'':'ghost'} small" data-dg-mode="look">👁️ Guarda</button>
        <button class="btn ${masterMode==='teleport'?'':'ghost'} small" data-dg-mode="teleport">✋ Sposta pedina (gratis)</button>
        <button class="btn ${masterMode==='unlock'?'':'ghost'} small" data-dg-mode="unlock" title="Apre una porta chiusa o rivela una porta segreta">🔓 Sblocca / rivela</button>
        <button class="btn ghost small" id="dg-reset-btn">🧹 Azzera esplorazione</button>
      </div>` : ''}`;
  }

  let chatBuilt = false, chatSig = '';
  function clearShell(html){ rootEl.innerHTML = html || ''; chatBuilt = false; chatSig = ''; }
  function ensureShell(){
    if(rootEl.querySelector('#dg-main')) return;
    rootEl.innerHTML = `<div class="hud-frame card dg-wrap"><div id="dg-main"></div><div id="dg-chat-box"></div></div>`;
    chatBuilt = false; chatSig = '';
  }
  function render(){
    if(!rootEl || !ctx) return;
    if(!state){ clearShell(lastLoadError ? `<div class="muted" style="font-size:11px;">${escapeHTML(lastLoadError)}</div>` : ''); return; }
    const dg = activeDungeon();
    if(!isMaster() && !dg){ clearShell(''); return; }
    if(isMaster() && !(state.dungeons||[]).length && !dg){
      clearShell(`<div class="hud-frame card dg-wrap"><div class="section-title">🏰 Dungeon</div>
        <div class="muted" style="font-size:11px;">Nessun dungeon ancora. Crealo dall'editor in <a href="map.html" target="_blank">Mappa</a> (bottone "🏰 Dungeon").</div>
        ${lastLoadError?`<div class="err">${escapeHTML(lastLoadError)}</div>`:''}</div>`);
      return;
    }
    ensureShell();
    rootEl.querySelector('#dg-main').innerHTML = `
      <div class="section-title">🏰 ${dg ? escapeHTML(dg.name) : 'Dungeon'}</div>
      ${dg && isLinked(dg) ? `<div class="muted" style="font-size:10.5px;margin:-4px 0 4px;">📍 ${escapeHTML(linkLabel(dg))}</div>` : ''}
      ${isMaster() ? masterHTML() : ''}
      ${dg ? `
        ${dg.desc && !isMaster() ? `<div class="muted" style="font-size:11px;white-space:pre-wrap;">${escapeHTML(dg.desc)}</div>` : ''}
        ${partyHTML()}
        ${gridHTML(dg)}
        ${padHTML(dg)}
        <div class="dg-legend">⛩️ ingresso · 🚪 uscita · 🔒 porta chiusa · 🗝️ chiave · 🎁 tesoro · 🪜 scale · ⛺ ristoro · 🕹️ leva · ▦ terreno difficile (2 ⚡)${isMaster()?' — sbiaditi = non ancora scattati (li vedi solo tu)':''}</div>
        ${roomCardHTML(dg)}
      ` : ''}
      <div class="dg-status" id="dg-status">${escapeHTML(statusMsg)}</div>
      ${lastLoadError?`<div class="err">${escapeHTML(lastLoadError)}</div>`:''}`;
    bind();
    renderChat();
  }

  // ---------- chat del dungeon ----------
  function renderChat(){
    const box = rootEl && rootEl.querySelector('#dg-chat-box');
    if(!box) return;
    const dg = activeDungeon();
    if(!dg){ box.innerHTML = ''; chatBuilt = false; chatSig = ''; return; }
    if(!chatBuilt){
      box.innerHTML = `<div class="divider" style="margin:8px 0;"></div>
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-mute);margin-bottom:4px;">💬 Chat del dungeon${isLinked(dg)?'':' <span style="text-transform:none;">(posizione del gruppo)</span>'}</div>
        <div class="log" id="dg-chat-log" style="height:200px;overflow-y:auto;"></div>
        <div style="display:flex;gap:6px;margin-top:6px;">
          <input type="text" id="dg-chat-input" placeholder="${isMaster()?'Scrivi come Master nel dungeon…':'Scrivi nella chat del dungeon…'}" style="flex:1;" />
          <button class="btn small" id="dg-chat-send">Invia</button>
        </div>
        <div class="err" id="dg-chat-err"></div>`;
      chatBuilt = true; chatSig = '';
      const logEl = box.querySelector('#dg-chat-log');
      if(typeof attachLogModeration==='function'){
        const me = (!isMaster() && typeof cachedMe!=='undefined') ? cachedMe : undefined;
        attachLogModeration(logEl, ctx.code, me, undefined, undefined, ()=>{ if(ctx.onChanged) ctx.onChanged(); });
      }
      const input = box.querySelector('#dg-chat-input');
      const send = async ()=>{
        const text = input.value.trim();
        if(!text) return;
        const errEl = box.querySelector('#dg-chat-err');
        const meM = (cachedRoster||[]).find(m=>m.username===ctx.username);
        const entry = isMaster() ? { who:'Master', role:'gm', text } : { who: meM ? displayName(meM) : ctx.username, role:'player', text };
        const r = await dgLog(entry);
        if(!r){ if(errEl) errEl.textContent = 'Messaggio non inviato: ' + (lastApiError||'errore'); return; }
        if(errEl) errEl.textContent = '';
        input.value = '';
        if(Array.isArray(typeof cachedLog!=='undefined' ? cachedLog : null) && r.entry){ cachedLog.push(r.entry); renderChat(); }
        if(ctx.advanceClock) ctx.advanceClock(5);
        if(ctx.onChanged) ctx.onChanged();
      };
      box.querySelector('#dg-chat-send').onclick = send;
      input.onkeydown = (e)=>{ if(e.key==='Enter'){ e.preventDefault(); send(); } };
    }
    const all = (typeof cachedLog!=='undefined' && Array.isArray(cachedLog)) ? cachedLog : [];
    const entries = all.filter(e=>entryInDungeon(e, dg)).slice(-80);
    const sig = entries.length + ':' + (entries.length ? (entries[entries.length-1].id + '|' + JSON.stringify(entries[entries.length-1].meta||{}).length) : '') + ':' + entries.map(e=>e.meta&&e.meta.loot?JSON.stringify(e.meta.loot.claims||{}):'').join('');
    if(sig===chatSig) return;
    chatSig = sig;
    const logEl = box.querySelector('#dg-chat-log');
    const nearBottom = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 40;
    logEl.innerHTML = entries.length ? (typeof logHTML==='function' ? logHTML(entries, isMaster()) : entries.map(e=>`<div><b>${escapeHTML(e.who)}</b>: ${escapeHTML(e.text)}</div>`).join('')) : '<div class="muted" style="font-size:11px;">Ancora nessun messaggio nel dungeon.</div>';
    if(nearBottom || !logEl.dataset.scrolled){ logEl.scrollTop = logEl.scrollHeight; logEl.dataset.scrolled = '1'; }
  }

  function setStatus(msg){ statusMsg = msg || ''; const el = document.getElementById('dg-status'); if(el) el.textContent = statusMsg; }

  // ---------- eventi -> chat ----------
  async function announceRoom(room){
    if(!room) return;
    const meta = room.image ? { image: room.image } : {};
    await dgLog({ who:'Sistema', role:'gm', text: `🏛️ ${room.name}${room.desc ? '\n' + room.desc : ''}`, meta });
  }

  async function publishEvents(events){
    const leader = state && state.party ? state.party.leader : ctx.username;
    for(const ev of (events||[])){
      if(ev.type==='room'){ await announceRoom(ev.room); continue; }
      if(ev.type==='unlock'){
        await dgLog({ who:'Sistema', role:'gm', text: `🔓 ${nameOf(ev.by)} apre la porta con «${ev.key}»${ev.consumed ? ' (la chiave si consuma)' : ''}.${ev.text ? '\n' + ev.text : ''}` });
        continue;
      }
      if(ev.type==='difficult') continue;
      if(ev.type==='teleport'){ await dgLog({ who:'Sistema', role:'gm', text: `🪜 ${ev.text || 'Il gruppo prende un passaggio…'}${ev.toDungeon ? `\n🏰 Siete in: ${ev.toDungeon}` : ''}` }); continue; }
      if(ev.type==='rest'){ await dgLog({ who:'Sistema', role:'gm', text: `⛺ ${ev.text || 'Il gruppo riprende fiato.'}\n⚡ Punti Dungeon ricaricati.` }); continue; }
      if(ev.type==='lever'){ await dgLog({ who:'Sistema', role:'gm', text: `🕹️ ${ev.text || 'Un meccanismo scatta da qualche parte nel dungeon…'}` }); continue; }
      if(ev.type==='exit'){ await dgLog({ who:'Sistema', role:'gm', text: '🚪 Il gruppo ha trovato un\'uscita dal dungeon.' }); continue; }
      if(ev.type==='note'){ if(ev.text) await dgLog({ who:'Sistema', role:'gm', text: `📜 ${ev.text}` }); continue; }
      if(ev.type==='encounter'){
        const enc = ((cachedScene && cachedScene.encounters) || []).find(e=>e.id===ev.encounterId);
        await dgLog({ who:'Sistema', role:'gm', text: `⚔️ ${ev.text || 'Qualcosa si muove nell\'ombra...'}` });
        if(ctx.notifyMasters) ctx.notifyMasters('⚔️ Incontro nel dungeon', `Il gruppo ha fatto scattare un Incontro${enc && enc.name ? ': ' + enc.name : ''}. Avvialo dal Combat Manager.`);
        continue;
      }
      if(ev.type==='trap'){
        // Descrizione sempre; richiesta di tiro solo se prevista, a chi scelto nell'editor
        // (Capofila / tutti i presenti / un presente a caso).
        if(ev.roll===false){ await dgLog({ who:'Sistema', role:'gm', text: `⚠️ Trappola!${ev.text ? ' ' + ev.text : ''}` }); continue; }
        const def = (typeof SKILL_DEFS!=='undefined' ? SKILL_DEFS : []).find(d=>d.key===ev.skill);
        const label = def ? def.label : ev.skill;
        const attrPart = (def && ev.attr && ev.attr!==def.attrs[0]) ? ` (con ${ATTR_LABEL[ev.attr]||ev.attr})` : '';
        const pres = presentPlayers().map(m=>m.username);
        let targets = [leader];
        if(ev.who==='all') targets = pres.length ? pres : [leader];
        else if(ev.who==='random') targets = pres.length ? [pres[Math.floor(Math.random()*pres.length)]] : [leader];
        targets = targets.filter(Boolean);
        const payload = `${targets.join(',')}|${ev.skill}|${ev.tn||''}|${ev.attr||''}`;
        await dgLog({ who:'Master', role:'request', text: `⚠️ Trappola!${ev.text ? ' ' + ev.text : ''} Richiesta a ${targets.map(nameOf).join(', ')}: tira ${label}${attrPart} (TN ${ev.tn})::REQ::${payload}` });
        if(ctx.notifyPlayers) ctx.notifyPlayers(targets, '⚠️ Trappola!', `Tira ${label} (TN ${ev.tn}).`);
        continue;
      }
      if(ev.type==='key'){
        const allowed = presentPlayers().map(m=>m.username);
        if(ev.text) await dgLog({ who:'Sistema', role:'gm', text: `🗝️ ${ev.text}` });
        await dgLog({ who:'Master', role:'loot', text: `🗝️ Trovata una chiave: ${ev.name} (al primo che la prende)`, meta: { loot: { v:0, name: ev.name, qty: 1, category: 'chiave', desc: ev.desc||'', mode: 'first', allowed, claims:{} } } });
        continue;
      }
      if(ev.type==='loot'){
        const allowed = presentPlayers().map(m=>m.username);
        const modeText = ev.mode==='pool' ? ` (da spartire: ${ev.qty} in tutto)` : (ev.mode==='first' ? ' (al primo che lo prende)' : (ev.qty>1 ? ' (a testa)' : ''));
        if(ev.text) await dgLog({ who:'Sistema', role:'gm', text: `🎁 ${ev.text}` });
        await dgLog({ who:'Master', role:'loot', text: `🎁 Bottino: ${ev.name} ×${ev.qty}${modeText}`, meta: { loot: { v:0, name: ev.name, qty: ev.qty, category: ev.category||'altro', desc: ev.desc||'', mode: ev.mode||'first', allowed, claims:{} } } });
        continue;
      }
    }
  }

  async function doMove(index){
    if(busy) return;
    setStatus('…');
    const d = await op({ op:'move', index });
    if(!d){ setStatus(lastApiError || 'Movimento non riuscito.'); render(); return; }
    statusMsg = '';
    render();
    if(ctx.advanceClock) await ctx.advanceClock(1);
    await publishEvents(d.events);
    if(ctx.onChanged) ctx.onChanged();
  }

  function bind(){
    const master = isMaster();
    rootEl.querySelectorAll('[data-dg-cell]').forEach(el=>{
      el.onclick = async ()=>{
        const idx = Number(el.getAttribute('data-dg-cell'));
        if(master && masterMode==='teleport'){
          const d = await op({ op:'move', index: idx, free:true });
          if(!d){ setStatus(lastApiError); return; }
          render();
          if(d.enteredRoom) await announceRoom(d.enteredRoom);
          if(ctx.onChanged) ctx.onChanged();
          return;
        }
        if(master && masterMode==='unlock'){
          const dgA = activeDungeon();
          const secret = dgA && dgA.grid[idx]==='s';
          const d = await op({ op: secret ? 'reveal' : 'unlock', index: idx });
          if(!d){ setStatus(lastApiError); return; }
          setStatus(secret ? 'Porta segreta rivelata.' : 'Casella sbloccata.'); render();
          if(secret) await dgLog({ who:'Sistema', role:'gm', text: '🕳️ Un passaggio segreto si rivela!' });
          return;
        }
        await doMove(idx);
      };
    });
    const voteBtn = document.getElementById('dg-vote-btn');
    if(voteBtn) voteBtn.onclick = async ()=>{
      const cand = document.getElementById('dg-vote-sel').value;
      const d = await op({ op:'vote', candidate: cand });
      if(!d){ setStatus(lastApiError); return; }
      statusMsg = d.leaderChanged ? '' : 'Voto registrato.';
      render();
      if(d.leaderChanged) await dgLog({ who:'Sistema', role:'gm', text: `👑 ${nameOf(d.leaderChanged)} è il nuovo Capofila del gruppo.` });
    };
    const searchBtn = document.getElementById('dg-search-btn');
    if(searchBtn) searchBtn.onclick = async ()=>{
      if(busy) return;
      const d = await op({ op:'search' });
      if(!d){ setStatus(lastApiError); render(); return; }
      render();
      if(ctx.advanceClock) await ctx.advanceClock(1);
      const where = d.where ? `la stanza «${d.where}»` : 'i dintorni';
      await dgLog({ who:'Sistema', role:'gm', text: d.found ? `🔍 ${nameOf(ctx.username)} perlustra ${where}… e trova ${d.found===1?'un passaggio segreto':d.found+' passaggi segreti'}!` : `🔍 ${nameOf(ctx.username)} perlustra ${where}, ma non trova nulla.` });
      if(ctx.onChanged) ctx.onChanged();
    };
    if(!master) return;
    const invSel = document.getElementById('dg-inv-dg');
    if(invSel) invSel.onchange = ()=>{ inviteDgId = invSel.value; render(); };
    const invTarget = document.getElementById('dg-inv-target');
    const invMode = document.getElementById('dg-inv-mode');
    if(invTarget && invMode) invTarget.onchange = ()=>{ const priv = invTarget.value && !invTarget.value.startsWith('subgroup:'); invMode.style.display = priv ? 'none' : ''; };
    const invBtn = document.getElementById('dg-inv-btn');
    if(invBtn) invBtn.onclick = async ()=>{
      const dgI = (state.dungeons||[]).find(d=>d.id===inviteDgId);
      if(!dgI || !isLinked(dgI)) return;
      invBtn.disabled = true;
      // 1) il dungeon diventa quello attivo (pedina all'ingresso se è la prima volta): lo vedranno
      //    i giocatori appena accettano e si trovano nel suo luogo.
      if(state.activeId!==dgI.id){
        const d = await op({ op:'setActive', id: dgI.id });
        if(!d){ invBtn.disabled = false; setStatus(lastApiError); return; }
        // Presentazione del dungeon e della prima stanza, taggate col luogo del dungeon: le trova
        // in chat chi entra.
        await dgLog({ who:'Sistema', role:'gm', text: `🏰 ${dgI.name}${dgI.desc ? '\n' + dgI.desc : ''}`, meta: dgI.image ? { image: dgI.image } : {} });
        if(d.enteredRoom) await announceRoom(d.enteredRoom);
      }
      // 2) invito "Vuoi andare a…?" (::MOVEREQ::) come quelli della Mappa: accettando, il giocatore
      //    (o il gruppo, secondo la modalità) viene spostato nel Settore/Sottosezione del dungeon.
      const target = invTarget ? invTarget.value : '';
      const isPrivate = !!target && !target.startsWith('subgroup:');
      const mode = isPrivate ? 'each' : (invMode ? invMode.value : 'each');
      const text = `🏰 Volete entrare nel dungeon "${dgI.name}"?::MOVEREQ::${dgI.link.sectorId}|${dgI.link.subsectionId||''}|${dgI.link.luogoId||''}|${mode}`;
      let ok;
      if(target) ok = await pushPrivateLog(ctx.code, target, { who:'Master', role:'moverequest', text });
      else {
        const meta = {};
        if(mode!=='each'){
          const all = players();
          const hereKey = typeof currentLocationKey==='function' ? normalizeLocationKey(currentLocationKey()) : null;
          const here = hereKey ? all.filter(m=>normalizeLocationKey(memberLocationKey(m))===hereKey).map(m=>m.username) : [];
          meta.moveGroup = here.length ? here : all.map(m=>m.username);
        }
        ok = await pushLog(ctx.code, { who:'Master', role:'moverequest', text, meta });
      }
      invBtn.disabled = false;
      setStatus(ok ? 'Invito mandato: il dungeon si apre per chi accetta.' : ('Invito non inviato: ' + (lastApiError||'errore')));
      render();
      if(ctx.onChanged) ctx.onChanged();
    };
    const act = document.getElementById('dg-active-btn');
    if(act) act.onclick = async ()=>{
      const id = document.getElementById('dg-active-sel').value || null;
      const d = await op({ op:'setActive', id });
      if(!d){ setStatus(lastApiError); return; }
      render();
      const dg = activeDungeon();
      if(dg){
        await dgLog({ who:'Sistema', role:'gm', text: `🏰 Il gruppo entra in: ${dg.name}${dg.desc ? '\n' + dg.desc : ''}`, meta: dg.image ? { image: dg.image } : {} });
        if(d.enteredRoom) await announceRoom(d.enteredRoom);
      }
      if(ctx.onChanged) ctx.onChanged();
    };
    const exitBtn = document.getElementById('dg-exit-btn');
    if(exitBtn) exitBtn.onclick = async ()=>{
      const dg = activeDungeon();
      const d = await op({ op:'setActive', id: null });
      if(!d){ setStatus(lastApiError); return; }
      render();
      if(dg) await dgLog({ who:'Sistema', role:'gm', text: `🌄 Il gruppo esce da: ${dg.name}.` });
    };
    const refill = document.getElementById('dg-refill-btn');
    if(refill) refill.onclick = async ()=>{
      const d = await op({ op:'refill', maxPoints: Number(document.getElementById('dg-max').value)||5 });
      if(!d){ setStatus(lastApiError); return; }
      setStatus('Punti Dungeon ricaricati.'); render();
    };
    const lb = document.getElementById('dg-leader-btn');
    if(lb) lb.onclick = async ()=>{
      const leader = document.getElementById('dg-leader-sel').value || null;
      const d = await op({ op:'setLeader', leader });
      if(!d){ setStatus(lastApiError); return; }
      render();
      if(leader) await dgLog({ who:'Sistema', role:'gm', text: `👑 Il Master nomina ${nameOf(leader)} Capofila del gruppo.` });
    };
    rootEl.querySelectorAll('[data-dg-mode]').forEach(b=>{
      b.onclick = ()=>{ masterMode = b.getAttribute('data-dg-mode'); render(); };
    });
    const reset = document.getElementById('dg-reset-btn');
    if(reset) reset.onclick = async ()=>{
      if(!window.confirm('Azzerare l\'esplorazione? La pedina torna all\'ingresso, la mappa torna coperta e trappole/tesori/incontri potranno scattare di nuovo.')) return;
      const d = await op({ op:'resetRun' });
      if(!d){ setStatus(lastApiError); return; }
      setStatus('Esplorazione azzerata.'); render();
    };
  }

  // Non ridisegnare mentre il Master sta scegliendo in un menu o scrivendo nel campo Max.
  function isEditingHere(){
    const a = document.activeElement;
    const main = rootEl && rootEl.querySelector('#dg-main');
    return !!(a && main && main.contains(a) && (a.tagName==='SELECT' || a.tagName==='INPUT' || a.tagName==='TEXTAREA'));
  }

  window.DungeonView = {
    // ctx: { code, username, role, advanceClock(min), notifyPlayers(usernames,title,body), notifyMasters(title,body), onChanged() }
    async mount(el, context){
      injectStyles();
      rootEl = el;
      ctx = context;
      await load();
      render();
    },
    async refresh(){
      if(!rootEl || !ctx || busy || !document.body.contains(rootEl)) return;
      await load();
      if(!isEditingHere()) render(); else renderChat();
    }
  };
})();
