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
// Oggetti nascosti + 🔎 Punto di scoperta (ottava richiesta): arrivando sulla piastrella parte
// una richiesta di tiro con meta.dgCheck; quando il giocatore tira ("🎲 Tira ora", in
// js/chat-log-engine.js) l'esito arriva a DungeonView.reportCheck → op 'checkResult' sul server,
// che rivela leve/tesori/… collegati. Il Master vede gli oggetti nascosti sbiaditi con 🙈 e può
// rivelarli a mano (🔓 Sblocca / rivela).
// NONA RICHIESTA: (1) la chat del dungeon È la chat normale: la card Chat vera (con "parla come"
// Tamer/Digimon, NPC del Master, allegati, dadi, risposte…) viene "agganciata" sotto la mappa
// (dockChat/undockChat, i nodi vengono spostati, non copiati, quindi funziona tutto come prima) e
// al suo posto resta un segnaposto "💬 La chat è sotto la mappa del dungeon". Per il Master, con un
// dungeon collegato, window.__dvosMasterLocationOverride fa sì che i suoi messaggi e il filtro 📍
// della Chat Generale seguano il luogo del dungeon (vedi currentLocationKey in chat-log-engine).
// (2) Stanze che rivelano oggetti e Incontri in Scena al primo ingresso (evento 'roomReveal').
// (3) Mobile: mappa in un riquadro scorrevole con zoom ➖/➕, centrata sulla pedina; frecce grandi;
// chat agganciata con le stesse regole mobile della scheda Chat.
// DECIMA RICHIESTA (rivede la nona): la chat NON si sposta più. È il dungeon che si mette subito
// SOPRA la card Chat (placeRoot: #dungeon-live viene spostato, la sua posizione originale nella
// Scena resta segnata da un commento-ancora e da un avviso "🏰 Il dungeon è sopra la chat"). Da
// telefono quindi mappa e chat stanno insieme nella scheda Chat. Sezione del voto più evidente
// (candidati con miniatura, da toccare) e pedina = miniatura del Tamer Capofila.
// UNDICESIMA RICHIESTA: (1) le immagini delle stanze non coprono più le caselle: toccando una
// casella di una stanza con immagine (segnata da 🖼️) o la scheda della stanza si apre la lightbox.
// (2) Timer del Capofila: 6 ore "attive" (ferme tra mezzanotte e le 10, ora italiana) dall'ultima
// azione di chi ha il comando; a timer scaduto qualsiasi giocatore presente può muovere/cercare
// e prende il comando finché non finiscono i Punti Dungeon, poi torna al Capofila (che può
// comunque riprenderselo in qualsiasi momento). Logica e calcolo del tempo sul server
// (claimControl/afterControlAction/controlInfo in lib/dungeon.js); qui solo mostra state.control.
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
  let masterPlayerView = false; // il Master vede la mappa con la nebbia dei giocatori

  // FOG OF WAR (sesta richiesta): stessa logica di visibleFrom in lib/dungeon.js. Le caselle già
  // esplorate ma fuori dalla vista attuale del gruppo (raggio dg.vision + linea di vista, o la
  // stanza intera se ci si è dentro) restano sulla mappa ma scurite.
  function nb8(dg, idx){
    const r = Math.floor(idx/dg.cols), c = idx%dg.cols, out = [];
    for(let dr=-1; dr<=1; dr++) for(let dc=-1; dc<=1; dc++){ if(!dr && !dc) continue; const rr=r+dr, cc=c+dc; if(rr>=0 && rr<dg.rows && cc>=0 && cc<dg.cols) out.push(rr*dg.cols+cc); }
    return out;
  }
  // PORTE APERTE/CHIUSE (settima richiesta): stessa logica di doorState in lib/dungeon.js.
  // 'open' | 'closed' (si apre passandoci) | 'locked' (chiave) | 'barred' (solo leva/Master).
  function isDoorCell(dg, i){
    const f = dg.features && dg.features[i];
    return dg.grid[i]==='d' || !!(f && f.type==='lock' && WALK[dg.grid[i]]);
  }
  function doorState(dg, i){
    if(!isDoorCell(dg, i)) return null;
    const run = dg.run || {};
    const ov = run.doors && run.doors[i];
    if(ov) return ov;
    const f = dg.features && dg.features[i];
    if(f && f.type==='lock') return (f.unlocked || (run.unlocked||[]).includes(i)) ? 'open' : 'locked';
    if(f && f.type==='door' && f.closed) return 'closed';
    return 'open';
  }
  function isOpaque(dg, i){
    const t = dg.grid[i];
    if(t==='.' || t==='?') return true;
    const run = dg.run || {};
    if(t==='s' && !(run.found||[]).includes(i)) return true;
    if(isDoorCell(dg, i) && doorState(dg, i)!=='open') return true;
    return false;
  }
  function visibleFrom(dg, pos){
    const vis = new Set();
    if(pos==null || pos<0) return vis;
    const R = Math.max(1, Math.min(8, Math.floor(Number(dg.vision)||2)));
    const pr = Math.floor(pos/dg.cols), pc = pos%dg.cols;
    vis.add(pos); nb8(dg, pos).forEach(j=>vis.add(j));
    for(let r=Math.max(0,pr-R); r<=Math.min(dg.rows-1,pr+R); r++){
      for(let c=Math.max(0,pc-R); c<=Math.min(dg.cols-1,pc+R); c++){
        if((r-pr)*(r-pr)+(c-pc)*(c-pc) > (R+0.5)*(R+0.5)) continue;
        let x=pc, y=pr; const dx=Math.abs(c-pc), sx=pc<c?1:-1, dy=-Math.abs(r-pr), sy=pr<r?1:-1;
        let err=dx+dy, ok=true;
        while(!(x===c && y===r)){
          const e2=2*err;
          if(e2>=dy){ err+=dy; x+=sx; }
          if(e2<=dx){ err+=dx; y+=sy; }
          if(x===c && y===r) break;
          if(isOpaque(dg, y*dg.cols+x)){ ok=false; break; }
        }
        if(ok) vis.add(r*dg.cols+c);
      }
    }
    const roomId = dg.roomOf[pos];
    if(roomId) dg.roomOf.forEach((rid,i)=>{ if(rid===roomId){ vis.add(i); nb8(dg, i).forEach(j=>vis.add(j)); } });
    return vis;
  }
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
      .dg-door-open{background:#22343a;box-shadow:inset 0 0 0 2px #7a5426;}
      .dg-door-barred{background:repeating-linear-gradient(45deg,#5a2a1e 0 4px,#3a1a14 4px 8px);}
      .dg-ent{background:#1f5a3a;}
      .dg-exit{background:#5a1f4e;}
      .dg-hard{background:repeating-linear-gradient(135deg,#4a3d2b 0 3px,#382e22 3px 6px);}
      .dg-secret{background:#4d2d6b;}
      .dg-ico img{width:85%;height:85%;object-fit:contain;display:block;margin:auto;}
      .dg-hidden{opacity:0.45;}
      .dg-fog::after{content:'';position:absolute;inset:0;background:rgba(2,4,6,0.62);pointer-events:none;z-index:1;transition:background .35s;}
      .dg-fog .dg-ico{filter:grayscale(1);}
      .dg-cell.dg-lit{transition:filter .35s;}
      .dg-reach{outline:2px solid var(--cyan);outline-offset:-2px;cursor:pointer;animation:dgpulse 1.4s infinite;}
      .dg-click{cursor:pointer;}
      .dg-token{position:absolute;inset:6%;border-radius:50%;background:radial-gradient(circle,#ffd35a,#ff8a3d);box-shadow:0 0 8px #ffb020;display:flex;align-items:center;justify-content:center;overflow:hidden;z-index:2;color:#2a1600;font-weight:700;}
      .dg-token.dg-token-img{background:#05080b;border:2px solid #ffd35a;box-sizing:border-box;inset:2%;}
      .dg-token img{width:100%;height:100%;object-fit:cover;display:block;}
      .dg-vote{border:1px solid var(--line);border-radius:6px;padding:8px;margin:6px 0;background:var(--panel-2);}
      .dg-vote.dg-vote-need{border:2px solid var(--amber);box-shadow:0 0 10px rgba(255,176,32,0.35);animation:dgvote 2s infinite;}
      @keyframes dgvote{0%,100%{box-shadow:0 0 10px rgba(255,176,32,0.35);}50%{box-shadow:0 0 2px rgba(255,176,32,0.1);}}
      .dg-vote-head{font-size:13px;margin-bottom:6px;}
      .dg-vote-need .dg-vote-head{color:var(--amber);font-weight:700;}
      .dg-vote-list{display:flex;flex-wrap:wrap;gap:6px;}
      .dg-cand{display:flex;align-items:center;gap:6px;padding:5px 9px 5px 5px;border:1px solid var(--line);border-radius:20px;background:#0b1216;color:var(--text);font:inherit;font-size:12px;cursor:pointer;min-height:36px;}
      .dg-cand:disabled{cursor:default;opacity:1;}
      .dg-cand.mine{border-color:var(--cyan);box-shadow:0 0 0 1px var(--cyan) inset;}
      .dg-cand.leader{border-color:#ffd35a;}
      .dg-cand .av{width:26px;height:26px;border-radius:50%;overflow:hidden;background:#1a2226;display:flex;align-items:center;justify-content:center;font-size:12px;flex:0 0 auto;}
      .dg-cand .av img{width:100%;height:100%;object-fit:cover;}
      .dg-cand .ct{font-size:10.5px;color:var(--text-mute);}
      .dg-vote-foot{font-size:10.5px;color:var(--text-mute);margin-top:6px;}
      .dg-lead-av{display:inline-flex;width:22px;height:22px;border-radius:50%;overflow:hidden;vertical-align:middle;border:1px solid #ffd35a;margin-right:4px;}
      .dg-lead-av img{width:100%;height:100%;object-fit:cover;}
      .dg-scene-note{text-align:center;font-size:12px;margin-top:10px;padding:8px;border:1px dashed var(--line);border-radius:4px;}
      .dg-ico{position:relative;z-index:1;pointer-events:none;}
      @keyframes dgpulse{0%,100%{outline-color:var(--cyan);}50%{outline-color:rgba(53,232,201,0.25);}}
      .dg-bar{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;font-size:11.5px;margin:4px 0;}
      .dg-pad{display:grid;grid-template-columns:repeat(3,38px);grid-template-rows:repeat(3,34px);gap:3px;justify-content:center;margin:6px auto;}
      .dg-pad button{padding:0;font-size:15px;}
      #dungeon-live{min-width:0;max-width:100%;}
      .grid2 > div:has(#dungeon-live), .mobile-section:has(#dungeon-live){min-width:0;max-width:100%;}
      .dg-wrap{min-width:0;max-width:100%;box-sizing:border-box;}
      #dg-main{min-width:0;max-width:100%;overflow:hidden;}
      .dg-scroll{width:100%;box-sizing:border-box;max-width:100%;max-height:62vh;overflow:auto;-webkit-overflow-scrolling:touch;margin:6px auto;border:1px solid var(--line);border-radius:4px;background:#05080b;}
      .dg-scroll .dg-grid{margin:0 auto;border:none;}
      .dg-zoom{display:flex;gap:4px;justify-content:center;align-items:center;font-size:11px;}
      .dg-zoom .btn{min-width:32px;}
      @media (max-width: 760px){
        .dg-scroll{max-height:55svh;}
        .dg-pad{grid-template-columns:repeat(3,52px);grid-template-rows:repeat(3,46px);gap:6px;}
        .dg-pad button{font-size:20px;}
        .dg-bar{font-size:12px;}
        .mobile-section[data-mobile-tab="chat"] #dungeon-live .dg-scroll{max-height:45svh;}
        .mobile-section[data-mobile-tab="chat"]:has(#dungeon-live .dg-scroll) .log{height:50svh !important;min-height:200px;}
        .dg-cand{font-size:13px;min-height:42px;}
        .dg-cand .av{width:30px;height:30px;}
      }
      .dg-room-card{display:flex;gap:10px;align-items:flex-start;padding:8px;border:1px solid var(--line);border-left:3px solid var(--cyan);border-radius:4px;background:var(--panel-2);margin:6px 0;}
      .dg-room-card img{width:120px;max-height:90px;object-fit:cover;border-radius:3px;cursor:zoom-in;flex:0 0 auto;}
      .dg-room-card .desc{font-size:11.5px;white-space:pre-wrap;color:var(--text);}
      .dg-imgmark{position:absolute;top:0;left:1px;font-size:9px;line-height:1;z-index:3;cursor:zoom-in;filter:drop-shadow(0 0 2px #000);}
      .dg-room-card .dg-img-btn{margin-top:6px;}
      .dg-ctl{font-size:11.5px;margin:4px 0;padding:5px 8px;border-radius:4px;background:#0b1216;border:1px solid var(--line);}
      .dg-ctl.dg-ctl-free{border-color:var(--cyan);color:var(--cyan);}
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
  // ---- timer del Capofila (state.control arriva dal server) ----
  let stateAt = Date.now();
  function controlLeftMs(){
    const c = state && state.control;
    if(!c) return Infinity;
    return Math.max(0, (Number(c.remainingMs)||0) - (c.paused ? 0 : Date.now() - stateAt));
  }
  function controlExpired(){ return !!(state && state.control) && (state.control.expired || controlLeftMs() <= 0); }
  function driverOf(){ return (state && state.party && state.party.driver) || null; }
  function amPresent(){ return presentPlayers().some(m=>m.username===ctx.username); }
  // Chi ha il comando ADESSO (per la pedina e per chi tira "come Capofila").
  function controllerOf(){ return driverOf() || (state && state.party && state.party.leader) || null; }
  // Posso muovere/cercare? Capofila, chi ha già preso il comando, o chiunque a timer scaduto.
  function canAct(){
    if(!state || !state.party || !ctx || ctx.role!=='player' || !amPresent()) return false;
    const u = ctx.username;
    return state.party.leader===u || driverOf()===u || controlExpired();
  }
  function fmtLeft(ms){ const h = Math.floor(ms/3600000), m = Math.floor((ms%3600000)/60000); return `${h}h ${String(m).padStart(2,'0')}m`; }
  function controlLine(){
    const p = state.party || {};
    const drv = driverOf();
    if(drv) return `🎮 Comando a <b>${escapeHTML(nameOf(drv))}</b> finché ha Punti Dungeon, poi torna ${p.leader ? 'al Capofila' : 'libero'}.`;
    if(controlExpired()) return p.leader
      ? `⏰ ${escapeHTML(nameOf(p.leader))} è fermo da 6 ore: <b>chiunque nel dungeon può muovere</b> (il comando torna al Capofila a Punti finiti).`
      : `⏰ Nessun Capofila da 6 ore: <b>chiunque nel dungeon può muovere</b>.`;
    const paused = state.control && state.control.paused;
    return `⏳ ${p.leader ? 'Turno del Capofila' : 'Senza Capofila'}: tra <b>${fmtLeft(controlLeftMs())}</b> potrà muovere chiunque${paused ? ' <span class="muted">(timer in pausa fino alle 10:00)</span>' : ''}.`;
  }

  async function load(){
    const d = await apiGet('/api/state?resource=dungeon&code=' + encodeURIComponent(ctx.code) + '&username=' + encodeURIComponent(ctx.username), true);
    if(d && d.dungeon){ state = d.dungeon; stateAt = Date.now(); lastLoadError = d.warning || null; }
    else if(!state) lastLoadError = 'Impossibile caricare il dungeon.';
  }

  async function op(body){
    busy = true;
    const d = await apiPost('/api/state', Object.assign({ resource:'dungeon', code: ctx.code, username: ctx.username }, body));
    busy = false;
    if(d && d.dungeon){ state = d.dungeon; stateAt = Date.now(); }
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

  // Miniatura del Tamer (quella del cerchio della scheda: imageThumbUrl, altrimenti imageUrl).
  function thumbOf(u){
    const m = u ? (cachedRoster||[]).find(x=>x.username===u) : null;
    return (m && m.tamer && (m.tamer.imageThumbUrl || m.tamer.imageUrl)) || '';
  }
  function avatarHTML(u){
    const img = thumbOf(u);
    if(img) return `<img src="${escapeAttr(img)}" onerror="this.remove()" />`;
    return escapeHTML(initialOf(u));
  }
  function initialOf(u){ const n = String(nameOf(u)||'?').trim(); return (n[0]||'?').toUpperCase(); }
  // Pedina del gruppo = miniatura del Capofila (senza Capofila: il pallino dorato).
  function tokenHTML(){
    const u = controllerOf();
    if(!u) return `<div class="dg-token"></div>`;
    const img = thumbOf(u);
    return img ? `<div class="dg-token dg-token-img" title="👑 ${escapeAttr(nameOf(u))}">${avatarHTML(u)}</div>`
               : `<div class="dg-token" title="👑 ${escapeAttr(nameOf(u))}">${escapeHTML(initialOf(u))}</div>`;
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
  const DEFAULT_ICON = { search:'🔎', key:'🗝️', trap:'⚠️', loot:'🎁', encounter:'⚔️', lock:'🔒', note:'📜', teleport:'🪜', rest:'⛺', lever:'🕹️' };
  function stepCost(dg, i){ return dg.grid[i]==='h' ? 2 : 1; }
  function icoHTML(ic){ return /^(https?:|data:|\/)/i.test(String(ic||'')) ? `<img src="${escapeAttr(ic)}" onerror="this.remove()" />` : escapeHTML(ic); }

  function cellClass(dg, i){
    const t = dg.grid[i];
    if(t==='?') return 'dg-unk';
    if(t==='.') return 'dg-wall';
    if(t==='d'){ const st = doorState(dg, i); return st==='open' ? 'dg-door-open' : (st==='barred' ? 'dg-door-barred' : 'dg-door'); }
    if(t==='e') return 'dg-ent';
    if(t==='x') return 'dg-exit';
    if(t==='h') return 'dg-hard';
    if(t==='s') return 'dg-secret';
    return dg.roomOf[i] ? 'dg-room' : 'dg-floor';
  }

  function hiddenSetOf(dg){
    const out = new Set(); const rev = new Set((dg.run && dg.run.revealedFeat) || []);
    Object.values(dg.features || {}).forEach(f=>{ if(f && f.type==='search') (f.targets||[]).forEach(t=>{ if(!rev.has(t)) out.add(t); }); });
    return out;
  }
  function featureIcon(dg, i){
    const f = dg.features && dg.features[i];
    if(f && f.type==='search'){
      const solved = f.solved || ((dg.run && dg.run.solved)||[]).includes(i);
      return `<span class="dg-ico dg-hidden" title="${solved?'Punto di scoperta risolto':'Punto di scoperta'}">${icoHTML(f.icon||'🔎')}</span>`;
    }
    if(f && isMaster() && hiddenSetOf(dg).has(i)){
      const own = f.icon || DEFAULT_ICON[f.type] || '';
      return `<span class="dg-ico dg-hidden" title="Nascosto: si rivela con un Punto di scoperta" style="opacity:0.35;">${icoHTML(own)}</span>`;
    }
    const run = dg.run || {};
    const fired = (run.fired||[]).includes(i);
    const unlocked = (run.unlocked||[]).includes(i);
    let ico = '';
    if(dg.grid[i]==='e') ico = '⛩️';
    if(dg.grid[i]==='x') ico = '🚪';
    if(dg.grid[i]==='s' && isMaster() && !(run.found||[]).includes(i)) return `<span class="dg-ico dg-hidden">🕳️</span>`;
    const ds = doorState(dg, i);
    if(ds){
      // Le porte mostrano sempre il loro stato attuale.
      if(ds==='barred') return `<span class="dg-ico" title="Porta sbarrata">⛔</span>`;
      if(ds==='locked') return `<span class="dg-ico" title="Porta chiusa a chiave">${icoHTML((f && f.type==='lock' && f.icon) || '🔒')}</span>`;
      if(ds==='closed') return `<span class="dg-ico" title="Porta chiusa">🚪</span>`;
      if(f && f.type==='lock') return `<span class="dg-ico dg-hidden" title="Porta aperta">🔓</span>`;
      return '';
    }
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

  // Zoom della mappa (per chi guarda, ricordato nel browser): 1 = la mappa entra in larghezza.
  let dgZoom = (()=>{ try{ return Number(localStorage.getItem('dvos_dg_zoom'))||1; }catch(e){ return 1; } })();
  let lastCenteredPos = null, lastScroll = null;
  function gridHTML(dg){
    const avail = Math.max(160, (rootEl && rootEl.clientWidth ? rootEl.clientWidth : 320) - 16);
    const fit = Math.floor(avail/dg.cols) - 1;
    const size = Math.max(10, Math.min(48, Math.round(Math.max(fit, dgZoom>1 ? 16 : 10) * dgZoom)));
    const pos = dg.run ? dg.run.pos : null;
    const reach = new Set();
    const pts = Number(state.party && state.party.points)||0;
    if(pos!=null && canAct()) neighbors4(dg, pos).forEach(i=>{ if(WALK[dg.grid[i]] && pts>=stepCost(dg, i) && doorState(dg, i)!=='barred') reach.add(i); });
    // Immagine della stanza: NON copre le caselle (undicesima richiesta). Si apre toccando una
    // casella della stanza; la prima casella (in alto a sinistra) porta il segno 🖼️.
    const firstCell = {};
    dg.roomOf.forEach((rid,i)=>{ if(rid && firstCell[rid]==null && dg.grid[i]!=='?' && dg.grid[i]!=='.') firstCell[rid] = i; });
    // Nebbia: per i giocatori sempre; per il Master solo con "👁️ Vista giocatori" attiva.
    const fogOn = !isMaster() || masterPlayerView;
    const visible = visibleFrom(dg, pos);
    const seenSet = new Set((dg.run && dg.run.seen) || []);
    let html = `<div class="dg-zoom"><button class="btn ghost small" data-dg-zoom="-1" title="Rimpicciolisci">➖</button><button class="btn ghost small" data-dg-zoom="0" title="Centra sulla pedina">🎯</button><button class="btn ghost small" data-dg-zoom="1" title="Ingrandisci">➕</button></div>
      <div class="dg-scroll" id="dg-scroll"><div class="dg-grid" style="grid-template-columns:repeat(${dg.cols},${size}px);grid-auto-rows:${size}px;font-size:${Math.max(8, Math.floor(size*0.6))}px;">`;
    for(let i=0;i<dg.grid.length;i++){
      const unknownForPlayers = isMaster() && masterPlayerView && !seenSet.has(i);
      const cls = unknownForPlayers ? 'dg-unk' : cellClass(dg, i);
      const fog = fogOn && !unknownForPlayers && cls!=='dg-unk' && !visible.has(i);
      const r = reach.has(i);
      const masterClick = isMaster() && masterMode!=='look' && WALK[dg.grid[i]];
      const room = dg.roomOf[i] ? (dg.rooms||[]).find(x=>x.id===dg.roomOf[i]) : null;
      const imgOpen = room && room.image && !unknownForPlayers && !r && !masterClick && dg.grid[i]!=='?' && dg.grid[i]!=='.';
      html += `<div class="dg-cell ${cls} ${fog?'dg-fog':'dg-lit'} ${r?'dg-reach':''} ${(masterClick||imgOpen)?'dg-click':''}" ${(r||masterClick)?`data-dg-cell="${i}"`:''} ${imgOpen?`data-avatar-expand="${escapeAttr(room.image)}"`:''} title="${room && !unknownForPlayers?escapeAttr(room.name) + (room.image ? ' — tocca per vedere l\'immagine' : ''):''}${dg.grid[i]==='h' && !unknownForPlayers?' (terreno difficile: 2 Punti)':''}">`
        + (unknownForPlayers ? '' : featureIcon(dg, i))
        + (room && room.image && !unknownForPlayers && !r && firstCell[room.id]===i ? `<span class="dg-imgmark" data-avatar-expand="${escapeAttr(room.image)}">🖼️</span>` : '')
        + (i===pos ? tokenHTML() : '')
        + `</div>`;
    }
    return html + '</div></div>';
  }
  // Centra la mappa sulla pedina quando si muove (o al primo disegno); altrimenti mantiene lo
  // scorrimento fatto a mano da chi guarda.
  function positionScroll(dg, force){
    const sc = rootEl && rootEl.querySelector('#dg-scroll');
    if(!sc) return;
    const pos = dg && dg.run ? dg.run.pos : null;
    const tok = sc.querySelector('.dg-token');
    if(force || (pos!==lastCenteredPos && tok)){
      if(tok){ const cell = tok.parentNode; sc.scrollLeft = cell.offsetLeft - sc.clientWidth/2 + cell.offsetWidth/2; sc.scrollTop = cell.offsetTop - sc.clientHeight/2 + cell.offsetHeight/2; }
      lastCenteredPos = pos;
    } else if(lastScroll){ sc.scrollLeft = lastScroll.x; sc.scrollTop = lastScroll.y; }
    sc.onscroll = ()=>{ lastScroll = { x: sc.scrollLeft, y: sc.scrollTop }; };
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
      <div><b>🏛️ ${escapeHTML(room.name)}</b>${room.desc ? `<div class="desc">${escapeHTML(room.desc)}</div>` : ''}${room.image ? `<div class="dg-img-btn"><button class="btn ghost small" data-avatar-expand="${escapeAttr(room.image)}">🖼️ Apri immagine</button></div>` : ''}</div>
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
    const iAmIn = ctx.role==='player' && list.some(m=>m.username===ctx.username);
    let voteUI = '';
    if(list.length){
      const head = !p.leader
        ? (ctx.role==='player' ? '🗳️ Eleggete il Capofila! Senza Capofila la pedina non si muove.' : '🗳️ I giocatori devono eleggere il Capofila.')
        : (ctx.username===p.leader ? '👑 Sei tu il Capofila: muovi la pedina con le frecce sotto la mappa.' : `🗳️ Capofila: <b>${escapeHTML(nameOf(p.leader))}</b>${iAmIn ? ' — puoi cambiare voto quando volete.' : ''}`);
      const ctlFree = controlExpired() || !!driverOf();
      const chips = list.map(m=>{
        const u = m.username, n = counts[u]||0;
        const cls = `dg-cand ${myVote===u?'mine':''} ${p.leader===u?'leader':''}`;
        return `<button class="${cls}" ${iAmIn ? `data-dg-vote="${escapeAttr(u)}"` : 'disabled'} title="${iAmIn ? 'Vota ' + escapeAttr(displayName(m)) : ''}">
          <span class="av">${avatarHTML(u)}</span><span class="nm">${p.leader===u?'👑 ':''}${escapeHTML(displayName(m))}</span><span class="ct">${n} ${n===1?'voto':'voti'}${myVote===u?' · tuo':''}</span></button>`;
      }).join('');
      voteUI = `<div class="dg-vote ${p.leader?'':'dg-vote-need'}">
        <div class="dg-vote-head">${head}</div>
        <div class="dg-ctl ${ctlFree?'dg-ctl-free':''}">${controlLine()}</div>
        <div class="dg-vote-list">${chips}</div>
        <div class="dg-vote-foot">Serve la maggioranza: ${need} su ${list.length}.${iAmIn ? (myVote ? ` Hai votato ${escapeHTML(nameOf(myVote))}: tocca un altro nome per cambiare.` : ' Tocca un nome per votare.') : ''}</div>
      </div>`;
    }
    return `<div class="dg-bar">
        <span>👑 Capofila: ${p.leader ? `<span class="dg-lead-av">${thumbOf(p.leader) ? avatarHTML(p.leader) : ''}</span><b>${escapeHTML(nameOf(p.leader))}</b>` : '<b>— da eleggere —</b>'}</span>
        <span>⚡ Punti Dungeon: <b>${Number(p.points)||0}/${Number(p.maxPoints)||5}</b><span class="muted">${refillLabel(p)}</span></span>
      </div>${presentLine}${voteUI}`;
  }

  function padHTML(dg){
    if(!canAct() || dg.run.pos==null) return '';
    const takeover = !amLeader() && driverOf()!==ctx.username;
    const pos = dg.run.pos, r = Math.floor(pos/dg.cols), c = pos%dg.cols;
    const pts = Number(state.party.points)||0;
    const can = (idx, ok)=> ok && WALK[dg.grid[idx]] && pts>=stepCost(dg, idx) && doorState(dg, idx)!=='barred' ? `data-dg-cell="${idx}"` : 'disabled';
    const up = can(pos-dg.cols, r>0), down = can(pos+dg.cols, r<dg.rows-1), left = can(pos-1, c>0), right = can(pos+1, c<dg.cols-1);
    const used = !!state.party.searchUsed;
    return `<div class="dg-pad">
      <span></span><button class="btn small" ${up}>⬆️</button><span></span>
      <button class="btn small" ${left}>⬅️</button><span style="display:flex;align-items:center;justify-content:center;font-size:10px;" class="muted">${amLeader() ? '👑' : '🎮'}</span><button class="btn small" ${right}>➡️</button>
      <span></span><button class="btn small" ${down}>⬇️</button><span></span>
    </div>
    ${takeover ? `<div class="muted" style="text-align:center;font-size:10.5px;">🎮 Muovendo prendi il comando: torna ${state.party.leader ? 'al Capofila' : 'libero'} quando finiscono i Punti.</div>` : ''}
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
        <button class="btn ${masterPlayerView?'':'ghost'} small" id="dg-pview-btn" title="Mostra la mappa con la nebbia che vedono i giocatori">🌫️ Vista giocatori</button>
        <button class="btn ${masterMode==='teleport'?'':'ghost'} small" data-dg-mode="teleport">✋ Sposta pedina (gratis)</button>
        <button class="btn ${masterMode==='door'?'':'ghost'} small" data-dg-mode="door" title="Clic su una porta: aperta ↔ chiusa">🚪 Apri / chiudi porta</button>
        <button class="btn ${masterMode==='unlock'?'':'ghost'} small" data-dg-mode="unlock" title="Apre una porta chiusa o rivela una porta segreta">🔓 Sblocca / rivela</button>
        <button class="btn ghost small" id="dg-reset-btn">🧹 Azzera esplorazione</button>
      </div>` : ''}`;
  }

  // ---------- posizione: il dungeon sta subito SOPRA la card Chat ----------
  // Si sposta #dungeon-live (non la chat): la chat resta com'è. Al suo posto nella Scena resta
  // un'ancora (commento) per riportarlo indietro quando il dungeon si chiude, più un avviso.
  let homeAnchor = null, sceneNote = null;
  let masterFollow = (()=>{ try{ return localStorage.getItem('dvos_dg_masterfollow')!=='off'; }catch(e){ return true; } })();
  function chatCardEl(){ return document.querySelector('.mobile-section[data-mobile-tab="chat"] > .hud-frame.card'); }
  function placeRoot(above){
    if(!rootEl || !rootEl.parentNode) return;
    if(!homeAnchor){ homeAnchor = document.createComment('dungeon-home'); rootEl.parentNode.insertBefore(homeAnchor, rootEl); }
    const card = above ? chatCardEl() : null;
    if(card){
      if(rootEl.nextElementSibling !== card) card.parentNode.insertBefore(rootEl, card);
      if((!sceneNote || !sceneNote.parentNode) && homeAnchor.parentNode){
        sceneNote = document.createElement('div');
        sceneNote.className = 'dg-scene-note';
        sceneNote.innerHTML = `🏰 Il dungeon è sopra la chat. <button class="btn small" data-dg-goto="1">Vai al dungeon</button>`;
        homeAnchor.parentNode.insertBefore(sceneNote, homeAnchor.nextSibling);
        sceneNote.querySelector('[data-dg-goto]').onclick = ()=>{
          if(typeof switchMobileTab==='function' && typeof isMobile==='function' && isMobile()) switchMobileTab('chat');
          setTimeout(()=>{ if(rootEl) rootEl.scrollIntoView({ behavior:'smooth', block:'start' }); }, 60);
        };
      }
    } else {
      if(homeAnchor.parentNode && homeAnchor.nextSibling !== rootEl) homeAnchor.parentNode.insertBefore(rootEl, homeAnchor.nextSibling);
      if(sceneNote && sceneNote.parentNode) sceneNote.remove();
      sceneNote = null;
    }
  }
  // Master + dungeon collegato: i suoi messaggi in Generale (e il filtro 📍) seguono il dungeon.
  function applyMasterOverride(){
    if(!isMaster()) return;
    const dg = activeDungeon();
    const want = (masterFollow && dg && isLinked(dg)) ? dungeonKey(dg) : null;
    const prev = window.__dvosMasterLocationOverride || null;
    if(want) window.__dvosMasterLocationOverride = want; else delete window.__dvosMasterLocationOverride;
    if(prev !== want && ctx && ctx.onChanged) setTimeout(()=>ctx.onChanged(), 0);
  }
  function clearShell(html){ placeRoot(false); rootEl.innerHTML = html || ''; }
  function ensureShell(){
    if(rootEl.querySelector('#dg-main')) return;
    rootEl.innerHTML = `<div class="hud-frame card dg-wrap"><div id="dg-main"></div></div>`;
  }
  function render(){
    if(!rootEl || !ctx) return;
    applyMasterOverride();
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
    placeRoot(!!dg);
    const sc0 = rootEl.querySelector('#dg-scroll');
    if(sc0) lastScroll = { x: sc0.scrollLeft, y: sc0.scrollTop };
    rootEl.querySelector('#dg-main').innerHTML = `
      <div class="section-title">🏰 ${dg ? escapeHTML(dg.name) : 'Dungeon'}</div>
      ${dg && isLinked(dg) ? `<div class="muted" style="font-size:10.5px;margin:-4px 0 4px;">📍 ${escapeHTML(linkLabel(dg))}</div>` : ''}
      ${isMaster() ? masterHTML() : ''}
      ${dg ? `
        ${dg.desc && !isMaster() ? `<div class="muted" style="font-size:11px;white-space:pre-wrap;">${escapeHTML(dg.desc)}</div>` : ''}
        ${partyHTML()}
        ${gridHTML(dg)}
        ${padHTML(dg)}
        <div class="dg-legend">⛩️ ingresso · 🔎 scoperta · 🚪 porta chiusa · 🔒 a chiave · ⛔ sbarrata · 🗝️ chiave · 🎁 tesoro · 🪜 scale · ⛺ ristoro · 🕹️ leva · ▦ terreno difficile (2 ⚡)${isMaster()?' — sbiaditi = non ancora scattati o nascosti (li vedi solo tu)':''}</div>
        ${roomCardHTML(dg)}
        ${isMaster() && isLinked(dg) ? `<div class="dg-bar" style="justify-content:center;"><button class="btn ghost small" id="dg-follow-btn" title="I tuoi messaggi in Chat Generale (e il filtro 📍) vanno nel luogo del dungeon">${masterFollow ? '🎙️ Parli nel dungeon: sì' : '🎙️ Parli nel dungeon: no'}</button></div>` : ''}
      ` : ''}
      <div class="dg-status" id="dg-status">${escapeHTML(statusMsg)}</div>
      ${lastLoadError?`<div class="err">${escapeHTML(lastLoadError)}</div>`:''}`;
    bind();
    positionScroll(dg, false);
  }

  function setStatus(msg){ statusMsg = msg || ''; const el = document.getElementById('dg-status'); if(el) el.textContent = statusMsg; }

  const REVEAL_LABEL = { lever:'🕹️ una leva', loot:'🎁 un tesoro', key:'🗝️ una chiave', teleport:'🪜 un passaggio', rest:'⛺ un punto di ristoro', note:'📜 qualcosa di scritto', trap:'⚠️ una trappola', encounter:'⚔️ qualcosa', lever2:'' };
  async function announceReveal(list, who){
    if(!list || !list.length) return;
    const what = list.map(x=>REVEAL_LABEL[x.type] || '❔ qualcosa').join(', ');
    await dgLog({ who:'Sistema', role:'gm', text: `🔎 ${who ? who + ' nota' : 'Si scopre'}: ${what}!` });
  }
  // Chiamata da js/chat-log-engine.js quando un giocatore tira su una richiesta con meta.dgCheck.
  async function reportCheck(attr, success, who){
    if(!ctx) return;
    const [dungeonId, idx] = String(attr||'').split('|');
    const d = await op({ op:'checkResult', id: dungeonId, index: Number(idx), success: !!success });
    if(!d){ return; } // check già risolto o non più in attesa: niente da fare
    render();
    if(d.success) await announceReveal(d.revealed, who);
    else if(d.allFailed) await dgLog({ who:'Sistema', role:'gm', text: `🔎 Nessuno nota nulla di strano… per ora.` });
    if(ctx.onChanged) ctx.onChanged();
  }

  // ---------- eventi -> chat ----------
  async function announceRoom(room){
    if(!room) return;
    const meta = room.image ? { image: room.image } : {};
    await dgLog({ who:'Sistema', role:'gm', text: `🏛️ ${room.name}${room.desc ? '\n' + room.desc : ''}`, meta });
  }

  async function publishEvents(events, mover){
    const leader = mover || (state && state.party ? state.party.leader : ctx.username);
    for(const ev of (events||[])){
      if(ev.type==='room'){ await announceRoom(ev.room); continue; }
      if(ev.type==='unlock'){
        await dgLog({ who:'Sistema', role:'gm', text: `🔓 ${nameOf(ev.by)} apre la porta con «${ev.key}»${ev.consumed ? ' (la chiave si consuma)' : ''}.${ev.text ? '\n' + ev.text : ''}` });
        continue;
      }
      if(ev.type==='difficult') continue;
      if(ev.type==='roomReveal'){
        if((ev.objects||[]).length) await dgLog({ who:'Sistema', role:'gm', text: `✨ In «${ev.room}» notate: ${ev.objects.map(x=>REVEAL_LABEL[x.type] || '❔ qualcosa').join(', ')}!` });
        const names = ev.encounterNames || [];
        if((ev.encounters||[]).length){
          await dgLog({ who:'Sistema', role:'gm', text: `⚔️ In «${ev.room}» non siete soli${names.length ? ': ' + names.join(', ') : ''}!` });
          if(ctx.notifyMasters) ctx.notifyMasters('⚔️ Digimon in Scena', `Il gruppo è entrato in «${ev.room}»: ${names.join(', ') || 'Incontri'} ora visibili in Scena. Prepara lo scontro!`);
        }
        continue;
      }
      if(ev.type==='search'){
        const def = (typeof SKILL_DEFS!=='undefined' ? SKILL_DEFS : []).find(d=>d.key===ev.skill);
        const label = def ? def.label : ev.skill;
        const attrPart = (def && ev.attr && ev.attr!==def.attrs[0]) ? ` (con ${ATTR_LABEL[ev.attr]||ev.attr})` : '';
        const targets = (ev.targets||[]).filter(Boolean);
        const payload = `${targets.join(',')}|${ev.skill}|${ev.tn||''}|${ev.attr||''}`;
        await dgLog({ who:'Master', role:'request', text: `🔎 ${ev.text || 'Qualcosa attira la vostra attenzione…'} Richiesta a ${targets.map(nameOf).join(', ')}: tira ${label}${attrPart} (TN ${ev.tn})::REQ::${payload}`, meta: { dgCheck: { dungeonId: ev.dungeonId, index: ev.index } } });
        if(ctx.notifyPlayers) ctx.notifyPlayers(targets, '🔎 Tiro di scoperta', `Tira ${label} (TN ${ev.tn}).`);
        continue;
      }
      if(ev.type==='dooropen'){ await dgLog({ who:'Sistema', role:'gm', text: `🚪 ${nameOf(leader)} apre la porta.${ev.text ? '\n' + ev.text : ''}` }); continue; }
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
        const nClosed = (ev.closedDoors||[]).length;
        const doorLine = nClosed ? (ev.closeMode==='barred' ? `\n⛔ ${nClosed===1?'Una porta si sbarra':nClosed+' porte si sbarrano'}: si riapriranno solo con un meccanismo…` : `\n🚪 ${nClosed===1?'Una porta si richiude':nClosed+' porte si richiudono'} di colpo!`) : '';
        if(ev.roll===false){ await dgLog({ who:'Sistema', role:'gm', text: `⚠️ Trappola!${ev.text ? ' ' + ev.text : ''}${doorLine}` }); continue; }
        if(doorLine) await dgLog({ who:'Sistema', role:'gm', text: doorLine.trim() });
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
    await announceControl(d);
    await publishEvents(d.events, d.mover);
    if(ctx.onChanged) ctx.onChanged();
  }
  async function announceControl(d){
    if(!d) return;
    const leader = state && state.party && state.party.leader;
    if(d.tookControl) await dgLog({ who:'Sistema', role:'gm', text: `🎮 ${leader ? `${nameOf(leader)} è fermo da 6 ore: ` : 'Nessun Capofila da 6 ore: '}${nameOf(d.tookControl)} prende il comando finché ci sono Punti Dungeon.` });
    if(d.controlReturned) await dgLog({ who:'Sistema', role:'gm', text: leader ? `👑 Punti Dungeon finiti: il comando torna a ${nameOf(leader)}.` : '👑 Punti Dungeon finiti: il comando è di nuovo libero.' });
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
          await publishEvents(d.events);
          if(ctx.onChanged) ctx.onChanged();
          return;
        }
        if(master && masterMode==='door'){
          const dgA = activeDungeon();
          if(!dgA || !isDoorCell(dgA, idx)){ setStatus('Clicca una porta.'); return; }
          const d = await op({ op:'door', index: idx });
          if(!d){ setStatus(lastApiError); return; }
          setStatus(d.door==='open' ? 'Porta aperta.' : 'Porta chiusa.'); render();
          await dgLog({ who:'Sistema', role:'gm', text: d.door==='open' ? '🚪 Una porta si apre.' : '🚪 Una porta si chiude.' });
          return;
        }
        if(master && masterMode==='unlock'){
          const dgA = activeDungeon();
          const fA = dgA && dgA.features && dgA.features[idx];
          if(dgA && fA && (fA.type==='search' || hiddenSetOf(dgA).has(idx))){
            const d = await op({ op:'revealFeat', index: idx });
            if(!d){ setStatus(lastApiError); return; }
            setStatus('Oggetto rivelato.'); render();
            await announceReveal(d.revealed, null);
            return;
          }
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
    rootEl.querySelectorAll('[data-dg-vote]').forEach(btn=> btn.onclick = async ()=>{
      const cand = btn.getAttribute('data-dg-vote');
      const myVote = state && state.party && state.party.votes ? state.party.votes[ctx.username] : null;
      if(busy || cand===myVote) return;
      const d = await op({ op:'vote', candidate: cand });
      if(!d){ setStatus(lastApiError); return; }
      statusMsg = d.leaderChanged ? '' : 'Voto registrato.';
      render();
      if(d.leaderChanged) await dgLog({ who:'Sistema', role:'gm', text: `👑 ${nameOf(d.leaderChanged)} è il nuovo Capofila del gruppo.` });
    });
    rootEl.querySelectorAll('[data-dg-zoom]').forEach(b=> b.onclick = ()=>{
      const k = Number(b.getAttribute('data-dg-zoom'));
      if(k===0){ positionScroll(activeDungeon(), true); return; }
      dgZoom = Math.max(1, Math.min(3, Math.round((dgZoom + k*0.5)*2)/2));
      try{ localStorage.setItem('dvos_dg_zoom', String(dgZoom)); }catch(e){}
      lastCenteredPos = null; render();
    });
    const fBtn = document.getElementById('dg-follow-btn');
    if(fBtn) fBtn.onclick = ()=>{ masterFollow = !masterFollow; try{ localStorage.setItem('dvos_dg_masterfollow', masterFollow?'on':'off'); }catch(e){} render(); };
    const searchBtn = document.getElementById('dg-search-btn');
    if(searchBtn) searchBtn.onclick = async ()=>{
      if(busy) return;
      const d = await op({ op:'search' });
      if(!d){ setStatus(lastApiError); render(); return; }
      render();
      if(ctx.advanceClock) await ctx.advanceClock(1);
      await announceControl(d);
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
        await publishEvents(d.events);
      }
      // 2) invito "Vuoi andare a…?" (::MOVEREQ::) come quelli della Mappa: accettando, il giocatore
      //    (o il gruppo, secondo la modalità) viene spostato nel Settore/Sottosezione del dungeon.
      const target = invTarget ? invTarget.value : '';
      const isPrivate = !!target && !target.startsWith('subgroup:');
      const mode = isPrivate ? 'each' : (invMode ? invMode.value : 'each');
      const text = `🏰 Volete entrare nel dungeon "${dgI.name}"?::MOVEREQ::${dgI.link.sectorId}|${dgI.link.subsectionId||''}|${dgI.link.luogoId||''}|${mode}`;
      let ok;
      // L'invito va dove si trovano ADESSO i giocatori (non nel dungeon: il Master potrebbe
      // "parlare nel dungeon"), quindi la posizione del messaggio è sempre esplicita.
      const sc = (typeof cachedScene!=='undefined' && cachedScene) || {};
      const groupKey = `${sc.currentMacroSceneId||'_'}|${sc.currentSectorId||'_'}|${sc.currentSubsectionId||'_'}|${sc.currentLuogoId||'_'}`;
      if(target && target.startsWith('subgroup:')){
        const g = ((typeof cachedSubgroups!=='undefined' && cachedSubgroups)||[]).find(x=>'subgroup:'+x.id===target);
        ok = await pushPrivateLog(ctx.code, target, { who:'Master', role:'moverequest', text, meta: { location: g && typeof subgroupLocationKey==='function' ? subgroupLocationKey(g) : groupKey } });
      } else if(target){
        const m = (cachedRoster||[]).find(x=>x.username===target);
        ok = await pushPrivateLog(ctx.code, target, { who:'Master', role:'moverequest', text, meta: { location: m && typeof memberLocationKey==='function' ? memberLocationKey(m) : groupKey } });
      } else {
        const meta = { location: groupKey };
        if(mode!=='each'){
          const all = players();
          const here = all.filter(m=>normalizeLocationKey(memberLocationKey(m))===normalizeLocationKey(groupKey)).map(m=>m.username);
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
        await publishEvents(d.events);
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
    const pv = document.getElementById('dg-pview-btn');
    if(pv) pv.onclick = ()=>{ masterPlayerView = !masterPlayerView; render(); };
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
      homeAnchor = null; sceneNote = null; lastCenteredPos = null; lastScroll = null; // pagina ridisegnata da capo
      await load();
      render();
    },
    reportCheck: (attr, success, who)=> reportCheck(attr, success, who),
    async refresh(){
      if(!rootEl || !ctx || busy || !document.body.contains(rootEl)) return;
      const wasVisible = !!activeDungeon();
      await load();
      if(!isEditingHere()) render();
      // Appena il dungeon compare (es. dopo "Sì, andiamo!") ridisegniamo subito anche la chat,
      // così il filtro 📍 passa al luogo del dungeon senza aspettare il giro di polling successivo.
      if(!wasVisible && activeDungeon() && ctx.onChanged) setTimeout(()=>ctx.onChanged(), 2700);
    }
  };
})();
