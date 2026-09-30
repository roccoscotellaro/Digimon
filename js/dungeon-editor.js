// js/dungeon-editor.js
// Editor dei Dungeon a caselle — caricato SOLO da map.html (bottone Master "🏰 Dungeon").
// La vista di gioco (pedina, Capofila, Punti Dungeon) è in js/dungeon.js dentro index.html; il
// server è /api/state?resource=dungeon (lib/dungeon.js, dove c'è anche la migrazione SQL).
//
// Script autonomo: map.html tiene i suoi helper (apiPost, escapeHTML, ...) dentro la propria
// IIFE, quindi qui ne usiamo di propri, senza dipendenze esterne. Si monta con
// window.DungeonEditor.mount(elemento, session) e non fa polling: salva solo col bottone 💾.
//
// Cosa si disegna:
//   - dimensione griglia scelta dal Master (colonne × righe, 3–40);
//   - STANZE (seconda richiesta di Rocco, 2026-09-30: "non mi fa disegnare le stanze"): si
//     disegnano trascinando un rettangolo (▭), si allargano col pennello (🖌️, che trasforma da solo
//     i muri in pavimento), e hanno nome, descrizione e immagine. L'immagine può essere stesa
//     direttamente sopra le caselle della stanza sulla mappa ("Mostra l'immagine sulla mappa");
//   - caselle: Muro/vuoto, Pavimento, Porta, Porta segreta, Terreno difficile (2 Punti),
//     Ingresso (⛩️, la pedina parte da qui), Uscita (🏁);
//   - Contenuti su singole caselle: Trappola, Tesoro, Incontro, Porta chiusa (con chiave), Nota,
//     Scale/Teletrasporto, Punto di ristoro, Leva — ognuno con un'icona a scelta (emoji dal menu
//     o un'immagine caricata).
// SALVATAGGIO (terza richiesta, "ne avevo completato uno ma non me lo ha salvato"): prima si
// salvava SOLO premendo 💾 — chiudendo/ricaricando la pagina, o se il salvataggio veniva bloccato
// da un controllo (es. nessun pavimento), il lavoro andava perso senza che fosse evidente. Ora:
//   - salvataggio AUTOMATICO sul server ~2,5 s dopo l'ultima modifica (se il dungeon ha almeno una
//     casella calpestabile), con lo stato sempre visibile accanto al bottone 💾;
//   - copia di sicurezza nel browser (localStorage) a ogni modifica: se la pagina si chiude prima
//     del salvataggio, alla riapertura dell'editor compare "Ripristina bozza";
//   - avviso del browser se si prova a lasciare la pagina con modifiche non ancora salvate;
//   - i campi del contenuto di una casella si applicano subito (il bottone "Applica" non è più
//     indispensabile).
// COLLEGAMENTO (quarta richiesta): "📍 Collegato a" lega il dungeon a un Settore o a una
// Sottosezione della Mappa (dg.link). Così il Master può invitare i giocatori a entrarci dal
// pannello 🏰 del Tavolo, e sotto la mappa del dungeon compare la chat di quel luogo.
// QUINTA RICHIESTA: collegamento anche a un Luogo; trappole con descrizione, tiro sì/no, quale
// tiro e chi tira; porte aperte (🚪) e chiuse (🔒, con chiave e "la chiave si consuma"); chiavi
// da trovare nel dungeon (🗝️); AREA DI PROVA (▶️ Prova): si gioca il dungeon come Capofila con la
// vera logica del server, ma su uno stato separato — niente chat, niente Inventari, partita vera
// intatta.
// SESTA RICHIESTA: collegamento esplicito chiave ↔ porta chiusa (dal pannello della porta: menu
// delle chiavi o "📍 Scegli la chiave sulla mappa"; dal pannello della chiave: "📍 Collega a una
// porta"; i collegamenti si vedono evidenziati in magenta e rinominare una chiave aggiorna le sue
// porte); "👁️ Raggio di vista" per la FOG OF WAR (dg.vision) e nebbia anche nell'area di prova.
// SETTIMA RICHIESTA: porte con stato iniziale Aperta / Chiusa (si apre passandoci) / Chiusa a
// chiave (strumenti 🚪 Porta aperta, 🚪 Porta chiusa, 🔒 Porta a chiave; cliccando una porta con
// 👆 Seleziona si cambia lo stato), e trappole che chiudono porte ("🚪 Chiude queste porte":
// richiuse oppure sbarrate — le sbarrate si riaprono solo con una Leva o dal Master).
// Cambiare le dimensioni di un dungeon già esplorato azzera l'esplorazione (lo fa il server,
// perché le posizioni salvate non corrisponderebbero più alle caselle).

(function(){
  const TILE_TOOLS = [
    { key:'.', label:'🧱 Muro' },
    { key:'f', label:'⬜ Pavimento' },
    { key:'d', label:'🚪 Porta aperta' },
    { key:'C', label:'🚪 Porta chiusa' },
    { key:'L', label:'🔒 Porta a chiave' },
    { key:'s', label:'🕳️ Porta segreta' },
    { key:'h', label:'🪨 Terreno difficile' },
    { key:'e', label:'⛩️ Ingresso' },
    { key:'x', label:'🏁 Uscita' }
  ];
  const SKILLS = [
    ['awareness','Awareness'],['evade','Evade'],['athletics','Athletics'],['endurance','Endurance'],['survival','Survival'],
    ['knowledge','Knowledge'],['precision','Precision'],['stealth','Stealth'],['featsOfStrength','Feats of Strength'],
    ['fortitude','Fortitude'],['bravery','Bravery'],['decipherIntent','Decipher Intent'],['manipulate','Manipulate'],
    ['perform','Perform'],['persuasion','Persuasion']
  ];
  const ATTRS = [['','(standard della Skill)'],['agility','Agility'],['body','Body'],['charisma','Charisma'],['intelligence','Intelligence'],['willpower','Willpower']];
  const CATEGORIES = [['altro','Altro'],['cibo','Cibo'],['indossabile','Indossabile'],['arma','Arma'],['strumento','Strumento'],['chiave','Chiave/Quest']];
  const FEATURE_TYPES = [['','— nessuno —'],['trap','⚠️ Trappola'],['loot','🎁 Tesoro'],['encounter','⚔️ Incontro'],['lock','🔒 Porta chiusa (serratura)'],['key','🗝️ Chiave da trovare'],['note','📜 Nota'],['teleport','🪜 Scale / Teletrasporto'],['rest','⛺ Punto di ristoro'],['lever','🕹️ Leva / interruttore']];
  // Icona predefinita (la prima) + alternative proposte nel menu, per tipo di contenuto.
  const ICONS = {
    trap:['⚠️','🕳️','🔥','⚡','🗡️','☠️','🕸️','💥'],
    loot:['🎁','💰','💎','🧰','📦','🗝️','⚗️','🍖','📜','🪙'],
    encounter:['⚔️','👁️','💀','🐉','👾','🦴','🌑'],
    lock:['🔒','⛓️','🚧','🔐'],
    door:['🚪'],
    key:['🗝️','🔑','🪪','💠'],
    note:['📜','📖','🪧','❗','❓','🗿','🕯️'],
    teleport:['🪜','🌀','⬆️','⬇️','✨','🔮','🚪'],
    rest:['⛺','🔥','⛲','🛏️','🍵','💚'],
    lever:['🕹️','⚙️','🔘','🗜️','🔔']
  };
  const ROOM_COLORS = ['#2f7f86','#7a5a2a','#5d3f86','#2f7a4a','#86303f','#3a5a8a','#7a7a2a','#2a7a7a'];

  let session = null, root = null;
  let data = null;          // stato completo (vista Master)
  let encounters = [];      // Incontri della Scena, per collegarli a una casella
  let macroScenes = [];     // Macroscene → Settori → Sottosezioni, per collegare il dungeon a un luogo
  let dg = null;            // copia di lavoro del dungeon in modifica
  let tool = 'rect';        // chiave casella | 'rect' | 'room' | 'unroom' | 'select'
  let selRoom = null;       // stanza selezionata (pennello + pannello dettagli)
  let selCell = null;       // casella selezionata (pannello contenuto)
  let draft = null;         // bozza del contenuto della casella selezionata
  let pick = null;          // 'teleport' | 'lever' | 'lockKey' | 'keyDoor' — il prossimo clic sulla mappa sceglie un bersaglio
  let rectStart = null, rectEnd = null;
  let dirty = false;
  let painting = false;
  let msg = '';
  let autoTimer = null, saving = false, changeSeq = 0, saveState = '';
  // Area di prova
  let testMode = false, testView = null, testParty = null, testLog = [], testKeys = true, testErr = '';
  const DRAFT_KEY = () => 'dvos_dungeon_draft_' + (session ? session.code : '');

  const esc = s => String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const uid = p => p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2,6);
  const isImg = s => /^(https?:|data:|\/)/i.test(String(s||''));
  let lastError = null;
  async function readJson(r){ const t = await r.text(); try{ return JSON.parse(t); }catch(e){ return { error:'Risposta non valida dal server (HTTP '+r.status+')' }; } }
  async function get(url){ try{ const r = await fetch(url); const d = await readJson(r); if(!r.ok){ lastError = d.error; return null; } return d; }catch(e){ lastError = 'Impossibile contattare il server.'; return null; } }
  async function post(body){ try{ const r = await fetch('/api/state', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) }); const d = await readJson(r); if(!r.ok){ lastError = d.error; return null; } return d; }catch(e){ lastError = 'Impossibile contattare il server.'; return null; } }

  function blank(rows, cols){
    const n = rows*cols;
    return { id: uid('dg'), name:'Nuovo Dungeon', desc:'', image:'', rows, cols, grid: Array(n).fill('.'), roomOf: Array(n).fill(null), rooms: [], features: {}, _new:true };
  }
  function clone(o){ return JSON.parse(JSON.stringify(o)); }
  const normName = s => String(s||'').trim().toLowerCase().replace(/\s+/g,' ');
  function keysInDungeon(){ const out = []; Object.keys(dg.features).forEach(k=>{ const f = dg.features[k]; if(f.type==='key' && f.name) out.push({ idx:+k, name:f.name }); }); return out; }
  function locksForKey(name){ const out = []; Object.keys(dg.features).forEach(k=>{ const f = dg.features[k]; if(f.type==='lock' && f.key && normName(f.key)===normName(name)) out.push(+k); }); return out; }
  function rc(i){ return { r: Math.floor(i/dg.cols), c: i%dg.cols }; }
  function cellLabel(i){ const p = rc(i); return `riga ${p.r+1}, col. ${p.c+1}`; }

  async function load(){
    const d = await get('/api/state?resource=dungeon&code=' + encodeURIComponent(session.code) + '&username=' + encodeURIComponent(session.username));
    data = d && d.dungeon ? d.dungeon : { dungeons: [] };
    if(d && d.warning) msg = d.warning;
    const sc = await get('/api/state?resource=scene&code=' + encodeURIComponent(session.code));
    encounters = (sc && sc.scene && Array.isArray(sc.scene.encounters)) ? sc.scene.encounters : [];
    macroScenes = (sc && sc.scene && Array.isArray(sc.scene.macroScenes)) ? sc.scene.macroScenes : [];
  }

  function roomById(id){ return dg.rooms.find(r=>r.id===id) || null; }
  function roomColor(id){
    const i = dg.rooms.findIndex(r=>r.id===id);
    return ROOM_COLORS[(i<0?0:i) % ROOM_COLORS.length];
  }
  function roomBBox(id){
    let r0=1e9,c0=1e9,r1=-1,c1=-1;
    dg.roomOf.forEach((rid,i)=>{ if(rid===id){ const p = rc(i); r0=Math.min(r0,p.r); c0=Math.min(c0,p.c); r1=Math.max(r1,p.r); c1=Math.max(c1,p.c); } });
    return r1<0 ? null : { r0, c0, w: c1-c0+1, h: r1-r0+1 };
  }

  let cellSize = 24;
  function cellStyle(i){
    const t = dg.grid[i];
    let bg = '#141b1f';
    if(t==='f') bg = '#3a4c52';
    const dfe = dg.features[i];
    const doorClosed = t==='d' && dfe && (dfe.type==='lock' || (dfe.type==='door' && dfe.closed));
    if(t==='d') bg = doorClosed ? '#8a5a26' : '#3a4c52';
    if(t==='s') bg = '#4d2d6b';
    if(t==='h') bg = 'repeating-linear-gradient(135deg,#5a4a33 0 3px,#43372a 3px 6px)';
    if(t==='e') bg = '#2a8a55';
    if(t==='x') bg = '#8a2a73';
    const rid = t!=='.' ? dg.roomOf[i] : null;
    const room = rid ? roomById(rid) : null;
    let extra = (t==='d' && !doorClosed) ? 'box-shadow:inset 0 0 0 3px #8a5a26;' : '';
    if(room){
      if(t==='f') bg = roomColor(rid);
      extra += `box-shadow:inset 0 0 0 2px ${roomColor(rid)};`;
      if(room.image && room.showOnMap!==false){
        const bb = roomBBox(rid), p = rc(i), step = cellSize+1;
        extra += `background-image:linear-gradient(rgba(0,0,0,0.15),rgba(0,0,0,0.15)),url('${String(room.image).replace(/'/g,'%27')}');background-size:${bb.w*step}px ${bb.h*step}px;background-position:${-(p.c-bb.c0)*step}px ${-(p.r-bb.r0)*step}px;`;
      }
    }
    if(selRoom && rid===selRoom) extra += 'filter:brightness(1.25);';
    return `background:${bg};${extra}`;
  }
  function iconHTML(ic){
    if(!ic) return '';
    return isImg(ic) ? `<img src="${esc(ic)}" style="width:85%;height:85%;object-fit:contain;pointer-events:none;" onerror="this.remove()" />` : esc(ic);
  }
  function cellIcon(i){
    const f = dg.features[i];
    if(f) return iconHTML(f.icon || (ICONS[f.type]||[''])[0]);
    if(dg.grid[i]==='e') return '⛩️';
    if(dg.grid[i]==='x') return '🏁';
    if(dg.grid[i]==='s') return '<span style="opacity:0.7">🕳️</span>';
    return '';
  }

  function listHTML(){
    const list = data.dungeons || [];
    return `<div class="row" style="gap:6px;align-items:center;flex-wrap:wrap;">
      <select id="dge-pick" style="flex:2;min-width:160px;">
        <option value="">— scegli un dungeon —</option>
        ${list.map(d=>`<option value="${esc(d.id)}" ${dg && dg.id===d.id?'selected':''}>🏰 ${esc(d.name)} (${d.cols}×${d.rows})${data.activeId===d.id?' · gruppo dentro':''}</option>`).join('')}
      </select>
      <input type="number" class="dge-num" id="dge-new-cols" min="3" max="40" value="15" style="width:56px;" title="Colonne" />×<input type="number" class="dge-num" id="dge-new-rows" min="3" max="40" value="15" style="width:56px;" title="Righe" />
      <button class="btn small" id="dge-new">+ Nuovo</button>
    </div>`;
  }

  function gridHTML(){
    const w = root.clientWidth || 600;
    cellSize = Math.max(12, Math.min(28, Math.floor((w-16)/dg.cols) - 1));
    const inRect = rectRange();
    let h = `<div id="dge-grid" style="display:grid;grid-template-columns:repeat(${dg.cols},${cellSize}px);grid-auto-rows:${cellSize}px;gap:1px;background:#05080b;padding:1px;width:max-content;max-width:100%;overflow:auto;margin:6px auto;user-select:none;touch-action:none;font-size:${Math.max(8,Math.floor(cellSize*0.55))}px;cursor:${pick?'cell':'crosshair'};">`;
    for(let i=0;i<dg.grid.length;i++){
      const sel = selCell===i ? 'outline:2px solid #ffd35a;outline-offset:-2px;' : '';
      const rect = inRect && inRect(i) ? 'outline:2px dashed #35e8c9;outline-offset:-2px;' : '';
      const fi = dg.features[i];
      const keyLinked = draft && ((draft.type==='key' && draft.name && fi && fi.type==='lock' && normName(fi.key)===normName(draft.name))
        || (draft.type==='lock' && draft.key && fi && fi.type==='key' && normName(fi.name)===normName(draft.key)));
      const trapLinked = draft && draft.type==='trap' && (draft.closeDoors||[]).includes(i);
      const linked = draft && (keyLinked || trapLinked || (draft.type==='teleport' && !draft.targetDungeon && draft.targetIndex===i) || (draft.type==='lever' && (draft.targets||[]).includes(i))) ? 'outline:2px solid #ff5dd2;outline-offset:-2px;' : '';
      h += `<div data-dge-cell="${i}" title="${esc(cellLabel(i))}" style="${cellStyle(i)}display:flex;align-items:center;justify-content:center;${sel}${rect}${linked}">${cellIcon(i)}</div>`;
    }
    return h + '</div>';
  }
  function rectRange(){
    if(rectStart==null || rectEnd==null) return null;
    const a = rc(rectStart), b = rc(rectEnd);
    const r0 = Math.min(a.r,b.r), r1 = Math.max(a.r,b.r), c0 = Math.min(a.c,b.c), c1 = Math.max(a.c,b.c);
    return (i)=>{ const p = rc(i); return p.r>=r0 && p.r<=r1 && p.c>=c0 && p.c<=c1; };
  }

  function toolsHTML(){
    const btn = (key, label, title)=>`<button class="btn ${tool===key?'':'ghost'} small" data-dge-tool="${key}" title="${esc(title||'')}">${label}</button>`;
    const help = {
      rect: 'Trascina sulla griglia da un angolo all\'altro: nasce una nuova stanza (i muri dentro diventano pavimento). Poi dalle le info qui sotto.',
      room: selRoom ? `Pennello attivo su "${esc((roomById(selRoom)||{}).name||'')}": clic o trascina per aggiungere caselle a questa stanza.` : 'Seleziona prima una stanza dall\'elenco qui sotto (o creane una col rettangolo).',
      unroom: 'Clic o trascina per togliere caselle dalla loro stanza (restano pavimento).',
      select: 'Clic su una casella per metterci un contenuto (trappola, tesoro, chiave, scale…) e per vedere la stanza a cui appartiene.',
      L: 'Clic su una casella per metterci una porta chiusa a chiave, poi scegli qui sotto la chiave che la apre e se la chiave si consuma. (🚪 Porta aperta toglie la serratura.)',
      C: 'Clic su una casella per metterci una porta chiusa: si apre da sola quando il gruppo ci passa (costa il passo). Può essere richiusa da una trappola.',
      d: 'Clic su una casella per metterci una porta aperta (toglie anche serrature e chiusure).'
    }[tool] || 'Clic o trascina per disegnare le caselle.';
    return `<div style="display:flex;flex-wrap:wrap;gap:4px;margin:6px 0;align-items:center;">
      <span class="muted" style="font-size:10px;text-transform:uppercase;">Stanze</span>
      ${btn('rect','▭ Nuova stanza','Trascina un rettangolo')}${btn('room','🖌️ Allarga stanza')}${btn('unroom','🧽 Togli da stanza')}
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:4px;margin:6px 0;align-items:center;">
      <span class="muted" style="font-size:10px;text-transform:uppercase;">Caselle</span>
      ${TILE_TOOLS.map(t=>btn(t.key, t.label)).join('')}
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:4px;margin:6px 0;align-items:center;">
      <span class="muted" style="font-size:10px;text-transform:uppercase;">Contenuti</span>
      ${btn('select','👆 Seleziona casella / contenuto')}
    </div>
    <div class="muted" style="font-size:10.5px;">${pick ? `<b style="color:#ff5dd2;">📍 ${({ trapDoors:'Clicca sulla mappa le porte che la trappola chiude (anche più di una).', lockKey:'Clicca sulla mappa la 🗝️ chiave che apre questa porta.', keyDoor:'Clicca sulla mappa le porte che questa chiave apre (anche più di una; una porta aperta diventa chiusa).', lever:'Clicca sulla mappa le caselle che la leva apre (anche più di una).' })[pick] || 'Clicca sulla mappa la casella di destinazione.'}</b> <button class="btn ghost small" id="dge-pick-done">Fine</button>` : help}</div>`;
  }

  function roomsHTML(){
    return `<div style="margin-top:10px;"><div class="muted" style="font-size:10px;text-transform:uppercase;letter-spacing:0.06em;">🏛️ Stanze (${dg.rooms.length}) — clicca una stanza per modificarla</div>
      ${dg.rooms.map((r,idx)=>{
        const n = dg.roomOf.filter(x=>x===r.id).length;
        if(r.id!==selRoom) return `<div class="hud-frame" data-dge-room-sel="${esc(r.id)}" style="padding:6px 8px;margin:4px 0;border-left:4px solid ${roomColor(r.id)};cursor:pointer;display:flex;gap:8px;align-items:center;">
          ${r.image ? `<img src="${esc(r.image)}" style="height:26px;width:40px;object-fit:cover;border-radius:2px;" onerror="this.remove()" />` : '<span style="width:40px;text-align:center;">🏛️</span>'}
          <span style="font-size:12px;">${esc(r.name)}</span><span class="muted" style="font-size:10px;">${n} caselle</span></div>`;
        return `<div class="hud-frame" id="dge-room-open" style="padding:8px;margin:6px 0;border-left:4px solid ${roomColor(r.id)};">
          <div class="row" style="gap:6px;align-items:center;"><input type="text" data-dge-room-name="${idx}" value="${esc(r.name)}" placeholder="Nome stanza" style="flex:2;" />
            <span class="muted" style="font-size:10px;">${n} caselle</span>
            <button class="btn ghost small" data-dge-room-del="${idx}" title="Elimina stanza">🗑️</button></div>
          <textarea data-dge-room-desc="${idx}" rows="3" placeholder="Descrizione mostrata ai giocatori quando il gruppo entra" style="width:100%;margin-top:4px;">${esc(r.desc)}</textarea>
          <div class="row" style="gap:6px;margin-top:4px;align-items:center;">
            <input type="text" data-dge-room-img="${idx}" value="${esc(r.image)}" placeholder="URL immagine della stanza" style="flex:2;" />
            <input type="file" accept="image/*" data-dge-upload="room:${idx}" id="dge-up-room-${idx}" style="display:none;" />
            <button class="btn ghost small" data-dge-upload-btn="room:${idx}">📤 Carica immagine</button>
          </div>
          ${r.image ? `<img src="${esc(r.image)}" style="max-width:100%;max-height:140px;margin-top:6px;border-radius:3px;display:block;" onerror="this.remove()" />` : ''}
          <label style="display:flex;gap:6px;align-items:center;font-size:11px;margin-top:6px;text-transform:none;"><input type="checkbox" data-dge-room-onmap="${idx}" ${r.showOnMap!==false?'checked':''} style="width:auto;" /> Mostra l'immagine sulla mappa, stesa sulle caselle della stanza</label>
          <div class="muted" style="font-size:10px;margin-top:4px;">Con 🖌️ Allarga stanza aggiungi caselle a questa stanza; con 🧽 le togli.</div>
        </div>`;
      }).join('')}
    </div>`;
  }

  function iconPickerHTML(){
    const presets = ICONS[draft.type] || [];
    const cur = draft.icon || '';
    return `<div class="field"><label>Icona sulla mappa</label>
      <div style="display:flex;flex-wrap:wrap;gap:3px;align-items:center;">
        ${presets.map((ic,k)=>`<button type="button" class="btn ${(cur===ic || (!cur && k===0))?'':'ghost'} small" data-dge-icon="${esc(ic)}" style="padding:2px 6px;font-size:15px;">${ic}</button>`).join('')}
        ${isImg(cur) ? `<span class="btn small" style="padding:2px 4px;"><img src="${esc(cur)}" style="height:20px;vertical-align:middle;" /></span>` : ''}
        <input type="file" accept="image/*" data-dge-upload="icon" id="dge-up-icon" style="display:none;" />
        <button type="button" class="btn ghost small" data-dge-upload-btn="icon">📤 Icona personale</button>
      </div></div>`;
  }

  function featureHTML(){
    if((tool!=='select' && tool!=='L') || selCell==null) return '';
    const f = draft || { type:'' };
    const walk = dg.grid[selCell]!=='.';
    const room = dg.roomOf[selCell] ? roomById(dg.roomOf[selCell]) : null;
    const sel = (id, opts, val)=>`<select id="${id}" data-dge-draft="${id}">${opts.map(([v,l])=>`<option value="${esc(v)}" ${String(val)===String(v)?'selected':''}>${esc(l)}</option>`).join('')}</select>`;
    const inp = (id, val, extra)=>`<input id="${id}" data-dge-draft="${id}" value="${esc(val==null?'':val)}" ${extra||'type="text"'} />`;
    let fields = '';
    const isDoor = dg.grid[selCell]==='d';
    const doorSt = !isDoor ? null : (f.type==='lock' ? 'locked' : (f.type==='door' && f.closed ? 'closed' : 'open'));
    if(f.type==='trap') fields = `
      <label style="display:flex;gap:6px;align-items:center;font-size:11px;text-transform:none;margin:4px 0;"><input type="checkbox" id="dge-f-roll" data-dge-draft="dge-f-roll" ${f.roll!==false?'checked':''} style="width:auto;" /> Quando scatta, parte una <b>richiesta di tiro</b> in chat</label>
      ${f.roll!==false ? `<div class="row" style="gap:6px;"><div class="field" style="flex:2;"><label>Tiro richiesto (Skill)</label>${sel('dge-f-skill', SKILLS, f.skill||'awareness')}</div>
      <div class="field" style="flex:2;"><label>Caratteristica</label>${sel('dge-f-attr', ATTRS, f.attr||'')}</div>
      <div class="field" style="flex:1;"><label>TN</label>${inp('dge-f-tn', Number(f.tn)||12, 'type="number" class="dge-num" min="1" max="40"')}</div></div>
      <div class="field"><label>Chi tira</label>${sel('dge-f-who', [['leader','👑 Il Capofila'],['all','🧍 Tutti i presenti nel dungeon'],['random','🎲 Un presente a caso']], f.who||'leader')}</div>` : '<div class="muted" style="font-size:10.5px;">Nessun tiro: in chat esce solo la descrizione (l\'effetto lo gestisci tu).</div>'}`;
    if(f.type==='trap') fields += `
      <div class="field" style="margin-top:6px;"><label>🚪 Chiude queste porte quando scatta</label>
        <div style="display:flex;flex-wrap:wrap;gap:4px;margin:2px 0;">${(f.closeDoors||[]).map(t=>`<span class="tag" style="font-size:10.5px;">🚪 ${esc(cellLabel(t))} <a href="#" data-dge-trapdoor-del="${t}" style="color:inherit;">✕</a></span>`).join('') || '<span class="muted" style="font-size:10.5px;">nessuna</span>'}</div>
        <div class="row" style="gap:6px;align-items:center;flex-wrap:wrap;">
          <button type="button" class="btn ghost small" id="dge-pick-trapdoors">📍 Aggiungi porte dalla mappa</button>
          ${(f.closeDoors||[]).length ? sel('dge-f-closemode', [['closed','🚪 Richiuse (si riaprono passandoci; quelle a chiave tornano a chiave)'],['barred','⛔ Sbarrate (solo una Leva o il Master le riaprono)']], f.closeMode||'closed') : ''}
        </div>
      </div>`;
    if(f.type==='loot') fields = `
      <div class="row" style="gap:6px;"><div class="field" style="flex:3;"><label>Oggetto</label>${inp('dge-f-name', f.name||'')}</div>
      <div class="field" style="flex:1;"><label>Q.tà</label>${inp('dge-f-qty', Number(f.qty)||1, 'type="number" class="dge-num" min="1"')}</div></div>
      <div class="row" style="gap:6px;"><div class="field" style="flex:1;"><label>Categoria</label>${sel('dge-f-cat', CATEGORIES, f.category||'altro')}</div>
      <div class="field" style="flex:2;"><label>Modalità</label>${sel('dge-f-mode', [['first','Tutto al primo che lo prende'],['each','Stessa quantità a ciascuno'],['pool','Quantità totale da spartire']], f.mode||'first')}</div></div>
      <div class="field"><label>Descrizione oggetto</label>${inp('dge-f-desc', f.desc||'')}</div>`;
    if(f.type==='encounter') fields = `
      <div class="field"><label>Incontro della Scena</label>${sel('dge-f-enc', [['','— nessuno (solo avviso) —']].concat(encounters.map(e=>[e.id, (e.name||'Incontro') + (e.isBoss?' 👑':'')])), f.encounterId||'')}</div>`;
    if(f.type==='lock'){
      const keysHere = [];
      (data.dungeons||[]).concat(dg ? [dg] : []).forEach(x=>Object.values(x.features||{}).forEach(k=>{ if(k.type==='key' && k.name && !keysHere.includes(k.name)) keysHere.push(k.name); }));
      const here = keysInDungeon();
      const linkedKey = f.key ? here.find(k=>normName(k.name)===normName(f.key)) : null;
      fields = `
      <div class="field"><label>🔗 Chiave che la apre</label>
        <div class="row" style="gap:6px;align-items:center;flex-wrap:wrap;">
          <select id="dge-f-keypick" style="flex:2;min-width:160px;">
            <option value="">— nessuna: la aprono solo il Master o una Leva —</option>
            ${keysHere.map(k=>`<option value="${esc(k)}" ${normName(k)===normName(f.key)?'selected':''}>🗝️ ${esc(k)}${here.some(h=>normName(h.name)===normName(k))?' (in questo dungeon)':''}</option>`).join('')}
            ${f.key && !keysHere.some(k=>normName(k)===normName(f.key)) ? `<option value="${esc(f.key)}" selected>✏️ ${esc(f.key)} (oggetto esterno)</option>` : ''}
            <option value="__other">✏️ Un altro oggetto (scrivi il nome)…</option>
          </select>
          <button type="button" class="btn ghost small" id="dge-pick-lockkey">📍 Scegli la chiave sulla mappa</button>
        </div>
        ${inp('dge-f-key', f.key||'', 'type="text" placeholder="nome esatto dell\'oggetto in Inventario" style="margin-top:4px;"')}
        <div class="muted" style="font-size:10px;margin-top:2px;">${linkedKey ? `Collegata alla 🗝️ di ${esc(cellLabel(linkedKey.idx))} (evidenziata in magenta).` : (f.key ? 'La chiave non è in questo dungeon: si apre se un giocatore ha in Inventario un oggetto con questo nome (anche preso altrove o dato da te).' : 'Metti una 🗝️ Chiave da trovare nel dungeon e collegala qui, oppure scrivi il nome di un oggetto che i giocatori hanno già.')}</div>
      </div>
      <label style="display:flex;gap:6px;align-items:center;font-size:11px;text-transform:none;"><input type="checkbox" id="dge-f-consume" data-dge-draft="dge-f-consume" ${f.consume?'checked':''} style="width:auto;" /> La chiave si consuma (sparisce dall'Inventario di chi apre)</label>`;
    }
    if(f.type==='key') fields = `
      <div class="field"><label>Nome della chiave</label>${inp('dge-f-kname', f.name||'', 'type="text" placeholder="es. Chiave d\'Ossidiana"')}</div>
      <div class="field"><label>🔗 Porte che apre</label>
        <div style="display:flex;flex-wrap:wrap;gap:4px;margin:2px 0;">${f.name ? (locksForKey(f.name).map(t=>`<span class="tag" style="font-size:10.5px;">🔒 ${esc(cellLabel(t))} <a href="#" data-dge-unlink-door="${t}" style="color:inherit;">✕</a></span>`).join('') || '<span class="muted" style="font-size:10.5px;">nessuna porta collegata</span>') : '<span class="muted" style="font-size:10.5px;">dai prima un nome alla chiave</span>'}</div>
        ${f.name ? `<button type="button" class="btn ghost small" id="dge-pick-keydoor">📍 Collega a una porta sulla mappa</button>` : ''}
      </div>
      <div class="field"><label>Descrizione oggetto</label>${inp('dge-f-kdesc', f.desc||'')}</div>
      <div class="muted" style="font-size:10px;">Quando il gruppo arriva qui, in chat esce la chiave come bottino (la prende il primo che clicca, categoria Chiave/Quest).</div>`;
    if(f.type==='teleport'){
      const others = (data.dungeons||[]).filter(x=>x.id!==dg.id);
      const other = f.targetDungeon ? (data.dungeons||[]).find(x=>x.id===f.targetDungeon) : null;
      fields = `
      <div class="field"><label>Porta a</label>${sel('dge-f-tdg', [['','questo dungeon']].concat(others.map(o=>[o.id, '🏰 ' + o.name])), f.targetDungeon||'')}</div>
      ${!f.targetDungeon ? `<div class="row" style="gap:6px;align-items:center;">
          <span style="font-size:11px;">Destinazione: <b>${f.targetIndex!=null ? esc(cellLabel(f.targetIndex)) : 'ingresso'}</b></span>
          <button type="button" class="btn ghost small" id="dge-pick-tp">📍 Scegli sulla mappa</button>
        </div>` : `<div class="row" style="gap:6px;align-items:center;font-size:11px;">Casella in "${esc(other?other.name:'')}": riga ${inp('dge-f-trow', f.targetIndex!=null&&other ? Math.floor(f.targetIndex/other.cols)+1 : '', 'type="number" class="dge-num" min="1" style="width:56px;"')} col. ${inp('dge-f-tcol', f.targetIndex!=null&&other ? f.targetIndex%other.cols+1 : '', 'type="number" class="dge-num" min="1" style="width:56px;"')} <span class="muted">(vuoto = ingresso)</span></div>`}`;
    }
    if(f.type==='rest') fields = `
      <label style="display:flex;gap:6px;align-items:center;font-size:11px;text-transform:none;"><input type="checkbox" id="dge-f-once" data-dge-draft="dge-f-once" ${f.once?'checked':''} style="width:auto;" /> Funziona una volta sola (altrimenti ogni volta che ci si passa)</label>
      <div class="muted" style="font-size:10px;">Ricarica i Punti Dungeon del gruppo e rimette a disposizione la Ricerca.</div>`;
    if(f.type==='lever') fields = `
      <div style="font-size:11px;">Quando il gruppo ci passa, apre queste caselle (porte chiuse 🔒 e porte segrete 🕳️):</div>
      <div style="display:flex;flex-wrap:wrap;gap:4px;margin:4px 0;">${(f.targets||[]).map(t=>`<span class="tag" style="font-size:10.5px;">${esc(cellLabel(t))} <a href="#" data-dge-lever-del="${t}" style="color:inherit;">✕</a></span>`).join('') || '<span class="muted" style="font-size:10.5px;">nessuna</span>'}</div>
      <button type="button" class="btn ghost small" id="dge-pick-lever">📍 Aggiungi dalla mappa</button>`;
    const textLabel = { key:'Testo di scoperta (facoltativo)', trap:'Descrizione della trappola (esce in chat quando scatta)', loot:'Testo di scoperta (facoltativo)', encounter:'Testo in chat (il nome dell\'Incontro resta nascosto)', lock:'Testo quando viene aperta', note:'Testo narrato quando il gruppo arriva qui', teleport:'Testo in chat (es. "Scendete la scala a chiocciola…")', rest:'Testo in chat', lever:'Testo in chat (es. "Un meccanismo scatta in lontananza")' }[f.type];
    return `<div class="hud-frame" style="padding:10px;margin-top:8px;border-left:3px solid #ffd35a;">
      <div style="font-size:12px;margin-bottom:6px;"><b>👆 Casella ${esc(cellLabel(selCell))}</b>${room?` · stanza <a href="#" data-dge-room-sel="${esc(room.id)}" style="color:${roomColor(room.id)};">${esc(room.name)}</a>`:''}${walk?'':' <span class="muted">(è un muro: disegnaci prima un pavimento)</span>'}</div>
      ${isDoor ? `<div class="field"><label>🚪 Porta — stato iniziale</label><select id="dge-door-state">
          <option value="open" ${doorSt==='open'?'selected':''}>🚪 Aperta</option>
          <option value="closed" ${doorSt==='closed'?'selected':''}>🚪 Chiusa (si apre passandoci)</option>
          <option value="locked" ${doorSt==='locked'?'selected':''}>🔒 Chiusa a chiave</option>
        </select><div class="muted" style="font-size:10px;margin-top:2px;">Durante il gioco: le trappole possono richiuderla o sbarrarla, le leve e le chiavi riaprirla, e tu puoi aprirla/chiuderla dal Tavolo (🚪 Apri / chiudi porta).</div></div>
        ${doorSt==='locked' ? iconPickerHTML() : ''}` : `<div class="field"><label>Contenuto</label>${sel('dge-f-type', FEATURE_TYPES, f.type||'')}</div>
      ${f.type ? iconPickerHTML() : ''}`}
      ${fields}
      ${f.type ? `<div class="field"><label>${f.type==='door' ? 'Testo quando viene aperta (facoltativo)' : textLabel}</label><textarea id="dge-f-text" data-dge-draft="dge-f-text" rows="2" style="width:100%;">${esc(f.text||'')}</textarea></div>` : ''}
      <button class="btn small" id="dge-f-apply">✔ Applica alla casella</button>
    </div>`;
  }

  function linkOptions(){
    const out = [['', '— nessuno (il Master fa entrare tutto il gruppo) —']];
    macroScenes.forEach(m=>{
      (m.sectors||[]).forEach(sct=>{
        out.push([`${m.id}|${sct.id}||`, `${m.name} → ${sct.name}`]);
        (sct.luoghi||[]).forEach(lg=> out.push([`${m.id}|${sct.id}||${lg.id}`, `${m.name} → ${sct.name} → 📍 ${lg.name}`]));
        (sct.subsections||[]).forEach(sub=>{
          out.push([`${m.id}|${sct.id}|${sub.id}|`, `${m.name} → ${sct.name} → ${sub.name}`]);
          (sub.luoghi||[]).forEach(lg=> out.push([`${m.id}|${sct.id}|${sub.id}|${lg.id}`, `${m.name} → ${sct.name} → ${sub.name} → 📍 ${lg.name}`]));
        });
      });
    });
    return out;
  }
  function linkFieldHTML(){
    const cur = dg.link && dg.link.sectorId ? `${dg.link.macroId||''}|${dg.link.sectorId}|${dg.link.subsectionId||''}|${dg.link.luogoId||''}` : '';
    const opts = linkOptions();
    if(cur && !opts.some(o=>o[0]===cur)) opts.push([cur, '⚠ luogo non più esistente in Mappa']);
    return `<div class="field"><label>📍 Collegato a (Settore, Sottosezione o Luogo)</label>
      <select id="dge-link">${opts.map(([v,l])=>`<option value="${esc(v)}" ${v===cur?'selected':''}>${esc(l)}</option>`).join('')}</select>
      <div class="muted" style="font-size:10px;margin-top:2px;">Se collegato: il Master invita i giocatori a entrare dal pannello 🏰 del Tavolo; il dungeon lo vede e lo esplora solo chi accetta e si trova lì, e sotto la mappa compare la chat di quel luogo.</div></div>`;
  }

  function editorHTML(){
    if(!dg) return '';
    return `
      <div class="field" style="margin-top:8px;"><label>Nome</label><input type="text" id="dge-name" value="${esc(dg.name)}" /></div>
      ${linkFieldHTML()}
      <div class="field"><label>Descrizione (mostrata all'ingresso)</label><textarea id="dge-desc" rows="2" style="width:100%;">${esc(dg.desc)}</textarea></div>
      <div class="row" style="gap:6px;align-items:center;">
        <input type="text" id="dge-image" value="${esc(dg.image)}" placeholder="URL immagine copertina (facoltativa)" style="flex:2;" />
        <input type="file" accept="image/*" data-dge-upload="cover" id="dge-up-cover" style="display:none;" />
        <button class="btn ghost small" data-dge-upload-btn="cover">📤 Carica</button>
      </div>
      <div class="row" style="gap:6px;align-items:center;margin-top:8px;">
        <span class="muted" style="font-size:11px;">📐 Caselle:</span>
        <input type="number" class="dge-num" id="dge-cols" min="3" max="40" value="${dg.cols}" style="width:56px;" title="Colonne" /> colonne ×
        <input type="number" class="dge-num" id="dge-rows" min="3" max="40" value="${dg.rows}" style="width:56px;" title="Righe" /> righe
        <button class="btn ghost small" id="dge-resize">Applica</button>
        <span class="muted" style="font-size:11px;margin-left:8px;" title="Fog of war: quante caselle vede il gruppo attorno alla pedina (muri e porte chiuse bloccano la vista). Dentro una stanza si vede sempre tutta la stanza.">👁️ Raggio di vista:</span>
        <select id="dge-vision">${[1,2,3,4,5,6,8].map(n=>`<option value="${n}" ${(Number(dg.vision)||2)===n?'selected':''}>${n}</option>`).join('')}</select>
      </div>
      ${toolsHTML()}
      ${gridHTML()}
      <div class="muted" style="font-size:10px;text-align:center;">🧱 muro · ⬜ pavimento · 🟫 porta aperta · 🚪 porta chiusa · 🔒 porta a chiave · 🟪 porta segreta · ▦ terreno difficile · ⛩️ ingresso · 🏁 uscita</div>
      ${featureHTML()}
      ${roomsHTML()}
      <div class="row" style="gap:6px;margin-top:10px;align-items:center;flex-wrap:wrap;">
        <button class="btn amber" id="dge-save">💾 Salva dungeon</button>
        <button class="btn small" id="dge-test" title="Gioca il dungeon come Capofila, senza toccare la partita vera">▶️ Prova il dungeon</button>
        <button class="btn ghost small" id="dge-del">🗑️ Elimina</button>
        <span id="dge-save-status" style="font-size:11px;">${saveStatusHTML()}</span>
      </div>`;
  }

  // ---------- AREA DI PROVA ----------
  const SKILL_LABEL = Object.fromEntries(SKILLS);
  const WHO_LABEL = { leader:'il Capofila', all:'tutti i presenti', random:'un presente a caso' };
  const T_ICON = { trap:'⚠️', loot:'🎁', key:'🗝️', encounter:'⚔️', lock:'🔒', note:'📜', teleport:'🪜', rest:'⛺', lever:'🕹️' };
  function testEventText(ev){
    const t = ev.text ? ` — ${ev.text}` : '';
    switch(ev.type){
      case 'room': return `🏛️ Entrate in «${ev.room.name}»${ev.room.desc ? ': ' + ev.room.desc : ''}${ev.room.image ? ' 🖼️' : ''}`;
      case 'trap': return `⚠️ Trappola!${t}` + (ev.roll!==false ? ` → richiesta di tiro: ${SKILL_LABEL[ev.skill]||ev.skill}${ev.attr?' (con '+ev.attr+')':''} TN ${ev.tn}, tira ${WHO_LABEL[ev.who||'leader']}` : ' (nessun tiro)') + ((ev.closedDoors||[]).length ? ` — ${ev.closeMode==='barred' ? '⛔ sbarra' : '🚪 richiude'} ${ev.closedDoors.length} port${ev.closedDoors.length===1?'a':'e'}` : '');
      case 'loot': return `🎁 Tesoro in chat: ${ev.name} ×${ev.qty}${t}`;
      case 'key': return `🗝️ Chiave in chat: «${ev.name}» (la prende il primo)${t}`;
      case 'encounter': { const e = encounters.find(x=>x.id===ev.encounterId); return `⚔️ Incontro${e ? ' ('+e.name+')' : ''}${t || ' — avviso al Master'}`; }
      case 'unlock': return `🔓 Porta aperta con «${ev.key}»${ev.consumed ? ' — la chiave si consuma' : ''}${t}`;
      case 'note': return `📜 ${ev.text||'(nota vuota)'}`;
      case 'teleport': return `🪜 Passaggio${t}${ev.toDungeon ? ' → ' + ev.toDungeon : ''}`;
      case 'rest': return `⛺ Punto di ristoro: Punti e Ricerca ricaricati${t}`;
      case 'lever': return `🕹️ Leva azionata (porte collegate aperte)${t}`;
      case 'dooropen': return `🚪 Porta aperta passandoci${t}`;
      case 'exit': return '🚪 Uscita del dungeon';
      case 'difficult': return '🪨 Terreno difficile: −2 Punti';
      default: return ev.type;
    }
  }
  function testLogPush(line, kind){ testLog.unshift({ line, kind: kind||'', at: new Date() }); if(testLog.length>60) testLog.length = 60; }
  async function testOp(body){
    const d = await post(Object.assign({ resource:'dungeon', code: session.code, username: session.username }, body));
    if(!d){ testErr = lastError || 'Errore'; testLogPush('✋ ' + testErr, 'err'); return null; }
    testErr = '';
    testView = d.testView; testParty = d.testParty;
    if(d.dungeon) data = d.dungeon;
    return d;
  }
  async function startTest(){
    syncTextFields();
    if(dirty || dg._new){ clearTimeout(autoTimer); const okSave = await doSave(false); if(!okSave) return; }
    testMode = true; testLog = []; msg = '';
    const d = await testOp({ op:'testStart', id: dg.id });
    if(d){ testLogPush(`▶️ Prova di «${dg.name}» iniziata: pedina all'ingresso, 5 Punti.`); (d.events||[]).forEach(ev=>testLogPush(testEventText(ev))); }
    render();
  }
  async function testMove(i){
    const d = await testOp({ op:'testMove', index: i, testKeys });
    if(d){ const evs = d.events||[]; if(!evs.length) testLogPush('👣 un passo'); evs.forEach(ev=>testLogPush(testEventText(ev))); }
    render();
  }
  // Fog of war nell'area di prova: stessa funzione di lib/dungeon.js / js/dungeon.js.
  function tNb8(v, idx){ const r = Math.floor(idx/v.cols), c = idx%v.cols, out = []; for(let dr=-1;dr<=1;dr++) for(let dc=-1;dc<=1;dc++){ if(!dr&&!dc) continue; const rr=r+dr, cc=c+dc; if(rr>=0&&rr<v.rows&&cc>=0&&cc<v.cols) out.push(rr*v.cols+cc); } return out; }
  function tIsDoor(v, i){ const f = v.features && v.features[i]; return v.grid[i]==='d' || !!(f && f.type==='lock' && v.grid[i]!=='.' && v.grid[i]!=='?'); }
  function tDoorState(v, i){
    if(!tIsDoor(v, i)) return null;
    const run = v.run||{}; const ov = run.doors && run.doors[i]; if(ov) return ov;
    const f = v.features && v.features[i];
    if(f && f.type==='lock') return (f.unlocked || (run.unlocked||[]).includes(i)) ? 'open' : 'locked';
    if(f && f.type==='door' && f.closed) return 'closed';
    return 'open';
  }
  function tOpaque(v, i){ const t = v.grid[i]; if(t==='.'||t==='?') return true; const run = v.run||{}; if(t==='s' && !(run.found||[]).includes(i)) return true; if(tIsDoor(v, i) && tDoorState(v, i)!=='open') return true; return false; }
  function tVisible(v, pos){
    const vis = new Set(); if(pos==null) return vis;
    const R = Math.max(1, Math.min(8, Math.floor(Number(v.vision)||2)));
    const pr = Math.floor(pos/v.cols), pc = pos%v.cols;
    vis.add(pos); tNb8(v,pos).forEach(j=>vis.add(j));
    for(let r=Math.max(0,pr-R); r<=Math.min(v.rows-1,pr+R); r++) for(let c=Math.max(0,pc-R); c<=Math.min(v.cols-1,pc+R); c++){
      if((r-pr)*(r-pr)+(c-pc)*(c-pc) > (R+0.5)*(R+0.5)) continue;
      let x=pc, y=pr; const dx=Math.abs(c-pc), sx=pc<c?1:-1, dy=-Math.abs(r-pr), sy=pr<r?1:-1; let err=dx+dy, ok=true;
      while(!(x===c && y===r)){ const e2=2*err; if(e2>=dy){ err+=dy; x+=sx; } if(e2<=dx){ err+=dx; y+=sy; } if(x===c && y===r) break; if(tOpaque(v, y*v.cols+x)){ ok=false; break; } }
      if(ok) vis.add(r*v.cols+c);
    }
    const rid = v.roomOf[pos]; if(rid) v.roomOf.forEach((x,i)=>{ if(x===rid){ vis.add(i); tNb8(v,i).forEach(j=>vis.add(j)); } });
    return vis;
  }
  function testGridHTML(){
    const v = testView;
    if(!v) return '<div class="muted">Prova non avviata.</div>';
    const w = root.clientWidth || 600;
    const size = Math.max(12, Math.min(30, Math.floor((w-16)/v.cols) - 1));
    const pos = v.run.pos, pts = testParty ? Number(testParty.points)||0 : 0;
    const walk = { f:1, d:1, e:1, x:1, h:1, s:1 };
    const reach = new Set();
    if(pos!=null){
      const r = Math.floor(pos/v.cols), c = pos%v.cols;
      [[r>0,pos-v.cols],[r<v.rows-1,pos+v.cols],[c>0,pos-1],[c<v.cols-1,pos+1]].forEach(([okk,i])=>{ if(okk && walk[v.grid[i]] && pts >= (v.grid[i]==='h'?2:1) && tDoorState(v, i)!=='barred') reach.add(i); });
    }
    const vis = tVisible(v, pos);
    const colors = { '?':'#020304', '.':'#1a2226', f:'#22343a', d:'#8a5a26', e:'#1f5a3a', x:'#5a1f4e', s:'#4d2d6b', h:'repeating-linear-gradient(135deg,#4a3d2b 0 3px,#382e22 3px 6px)' };
    let h = `<div style="display:grid;grid-template-columns:repeat(${v.cols},${size}px);grid-auto-rows:${size}px;gap:1px;background:#05080b;padding:1px;width:max-content;max-width:100%;margin:6px auto;font-size:${Math.max(8,Math.floor(size*0.55))}px;">`;
    for(let i=0;i<v.grid.length;i++){
      const t = v.grid[i];
      let bg = colors[t] || '#22343a';
      if(t==='f' && v.roomOf[i]) bg = '#2b4a4f';
      const f = v.features && v.features[i];
      let ico = t==='e' ? '⛩️' : (t==='x' ? '🚪' : '');
      const tds = tDoorState(v, i);
      if(tds){
        ico = tds==='barred' ? '⛔' : (tds==='locked' ? ((f && f.icon) || '🔒') : (tds==='closed' ? '🚪' : ''));
        bg = tds==='open' ? '#22343a' : (tds==='barred' ? '#5a2a1e' : '#8a5a26');
      } else if(f){
        const own = f.icon || T_ICON[f.type] || '';
        if(f.type==='lock') ico = f.unlocked ? '🔓' : own;
        else if(f.type==='loot' || f.type==='key') ico = f.taken ? '' : own;
        else if(f.type==='rest') ico = (f.once && f.fired) ? '' : own;
        else ico = own;
      }
      const icoHTML = ico ? (isImg(ico) ? `<img src="${esc(ico)}" style="width:85%;height:85%;object-fit:contain;" />` : esc(ico)) : '';
      const r = reach.has(i);
      const fog = t!=='?' && !vis.has(i);
      h += `<div ${r?`data-dgt-cell="${i}"`:''} ${fog?'data-dgt-fog="1"':''} style="background:${bg};display:flex;align-items:center;justify-content:center;position:relative;${r?'outline:2px solid #35e8c9;outline-offset:-2px;cursor:pointer;':''}">${icoHTML}${fog?'<div style="position:absolute;inset:0;background:rgba(2,4,6,0.62);pointer-events:none;"></div>':''}${i===pos?'<div style="position:absolute;inset:10%;border-radius:50%;background:radial-gradient(circle,#ffd35a,#ff8a3d);box-shadow:0 0 8px #ffb020;"></div>':''}</div>`;
    }
    return h + '</div>';
  }
  function testHTML(){
    const v = testView, p = testParty || {};
    const pos = v && v.run ? v.run.pos : null;
    const room = (v && pos!=null && v.roomOf[pos]) ? (v.rooms||[]).find(r=>r.id===v.roomOf[pos]) : null;
    const r = v && pos!=null ? Math.floor(pos/v.cols) : 0, c = v && pos!=null ? pos%v.cols : 0;
    const btn = (ok, i, lab)=> ok ? `<button class="btn small" data-dgt-cell="${i}">${lab}</button>` : `<button class="btn small" disabled>${lab}</button>`;
    const walk = { f:1, d:1, e:1, x:1, h:1, s:1 };
    const can = (okk, i)=> okk && v && walk[v.grid[i]] && (Number(p.points)||0) >= (v.grid[i]==='h'?2:1) && tDoorState(v, i)!=='barred';
    return `<div class="hud-frame" style="padding:10px;border-left:3px solid #35e8c9;">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;">
        <b>▶️ Area di prova — ${esc(dg ? dg.name : '')}</b>
        <button class="btn ghost small" id="dgt-exit">✖ Torna all'editor</button>
      </div>
      <div class="muted" style="font-size:10.5px;margin:4px 0;">Giochi come Capofila e vedi la mappa come la vedranno i giocatori (nebbia, trappole nascoste…). Niente chat, niente Inventari: la partita vera non viene toccata.</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;font-size:12px;margin:6px 0;">
        <span>⚡ Punti: <b>${Number(p.points)||0}/${Number(p.maxPoints)||5}</b></span>
        <span>🔍 Ricerca: <b>${p.searchUsed ? 'usata' : 'disponibile'}</b></span>
        <label style="display:flex;gap:4px;align-items:center;text-transform:none;font-size:11px;margin:0;"><input type="checkbox" id="dgt-keys" ${testKeys?'checked':''} style="width:auto;" /> 🗝️ Fingi di avere tutte le chiavi</label>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:4px;">
        <button class="btn small" id="dgt-restart">⟲ Ricomincia</button>
        <button class="btn small" id="dgt-refill">⚡ Ricarica Punti</button>
        <button class="btn small" id="dgt-search" ${p.searchUsed?'disabled':''}>🔍 Cerca passaggi segreti</button>
      </div>
      ${testGridHTML()}
      ${v && pos!=null ? `<div style="display:grid;grid-template-columns:repeat(3,38px);grid-template-rows:repeat(3,32px);gap:3px;justify-content:center;">
        <span></span>${btn(can(r>0,pos-v.cols), pos-v.cols, '⬆️')}<span></span>
        ${btn(can(c>0,pos-1), pos-1, '⬅️')}<span></span>${btn(can(c<v.cols-1,pos+1), pos+1, '➡️')}
        <span></span>${btn(can(r<v.rows-1,pos+v.cols), pos+v.cols, '⬇️')}<span></span></div>` : ''}
      ${room ? `<div style="display:flex;gap:8px;margin:8px 0;padding:6px;border:1px solid var(--line,#1c2a30);border-radius:4px;">${room.image?`<img src="${esc(room.image)}" style="width:110px;max-height:80px;object-fit:cover;border-radius:3px;" onerror="this.remove()" />`:''}<div><b>🏛️ ${esc(room.name)}</b><div style="font-size:11px;white-space:pre-wrap;">${esc(room.desc||'')}</div></div></div>` : ''}
      <div class="muted" style="font-size:10px;text-transform:uppercase;margin-top:8px;">Registro della prova (cosa succederebbe in chat)</div>
      <div style="max-height:220px;overflow-y:auto;font-size:11.5px;border:1px solid var(--line,#1c2a30);border-radius:4px;padding:6px;">${testLog.map(l=>`<div style="padding:2px 0;${l.kind==='err'?'color:#ff8a3d;':''}"><span class="muted">${String(l.at.getHours()).padStart(2,'0')}:${String(l.at.getMinutes()).padStart(2,'0')}:${String(l.at.getSeconds()).padStart(2,'0')}</span> ${esc(l.line)}</div>`).join('') || '<span class="muted">—</span>'}</div>
    </div>`;
  }

  function restoreBannerHTML(){
    const b = readBackup();
    if(!b || !b.dg || (dg && dg.id===b.dg.id && !dirty && JSON.stringify(stripRun(dg))===JSON.stringify(stripRun(b.dg)))) return '';
    const onServer = (data.dungeons||[]).find(x=>x.id===b.dg.id);
    if(onServer && JSON.stringify(stripRun(onServer))===JSON.stringify(stripRun(b.dg))) { clearBackup(); return ''; }
    if(dg && dg.id===b.dg.id && dirty) return '';
    const when = new Date(b.at);
    return `<div class="hud-frame" style="padding:8px 10px;margin:6px 0;border-left:3px solid #ff8a3d;font-size:12px;">
      ♻️ C'è una bozza non salvata di <b>${esc(b.dg.name||'dungeon')}</b> (${String(when.getDate()).padStart(2,'0')}/${String(when.getMonth()+1).padStart(2,'0')} ${String(when.getHours()).padStart(2,'0')}:${String(when.getMinutes()).padStart(2,'0')}).
      <button class="btn small" id="dge-restore">Ripristina e salva</button> <button class="btn ghost small" id="dge-restore-drop">Scarta</button></div>`;
  }
  function stripRun(x){ const c = clone(x); delete c.run; delete c.testRun; delete c._new; return c; }

  function render(){
    if(!root) return;
    root.innerHTML = `<style>.dge-num{background:var(--panel-2,#121a22);color:var(--text,#ddd);border:1px solid var(--line,#1c2a30);border-radius:3px;padding:4px;}</style><div class="hud-frame card" style="margin-top:12px;">
      <div class="section-title">🏰 Editor Dungeon</div>
      <div class="muted" style="font-size:11px;margin-bottom:6px;">Disegna qui il dungeon; per farci entrare il gruppo usa il pannello 🏰 Dungeon nella Scena del Tavolo.</div>
      ${restoreBannerHTML()}
      ${testMode ? '' : listHTML()}
      ${testMode ? testHTML() : editorHTML()}
      <div class="err" id="dge-msg" style="margin-top:6px;">${esc(msg)}</div>
    </div>`;
    bind();
  }
  function setMsg(t){ msg = t||''; const el = document.getElementById('dge-msg'); if(el) el.textContent = msg; }
  function saveStatusHTML(){
    if(saveState) return saveState;
    return dirty ? '<span class="muted">● modifiche in attesa di salvataggio…</span>' : '<span class="muted">✔ tutto salvato</span>';
  }
  function showSaveStatus(html){ saveState = html || ''; const el = document.getElementById('dge-save-status'); if(el) el.innerHTML = saveStatusHTML(); }
  function markDirty(){
    dirty = true; changeSeq++; saveState = '';
    backupLocal();
    const el = document.getElementById('dge-save-status'); if(el) el.innerHTML = saveStatusHTML();
    clearTimeout(autoTimer);
    autoTimer = setTimeout(()=>{ doSave(true); }, 2500);
  }
  function backupLocal(){
    try{ if(dg) localStorage.setItem(DRAFT_KEY(), JSON.stringify({ at: Date.now(), dg })); }catch(e){}
  }
  function clearBackup(){ try{ localStorage.removeItem(DRAFT_KEY()); }catch(e){} }
  function readBackup(){ try{ const v = localStorage.getItem(DRAFT_KEY()); return v ? JSON.parse(v) : null; }catch(e){ return null; } }

  // Salvataggio (manuale col bottone 💾, oppure automatico dopo ogni modifica).
  async function doSave(auto){
    if(!dg) return false;
    if(saving){ clearTimeout(autoTimer); autoTimer = setTimeout(()=>doSave(auto), 1200); return false; }
    if(auto && !dirty) return true;
    syncTextFields();
    if(!dg.grid.some(t=>t!=='.')){
      showSaveStatus('<span style="color:#ff8a3d;">⚠ Non ancora salvato: disegna almeno una stanza o una casella di pavimento.</span>');
      if(!auto) setMsg('Disegna almeno una stanza o una casella di pavimento, poi salva.');
      return false;
    }
    saving = true;
    const seq = changeSeq;
    showSaveStatus('<span class="muted">💾 Salvataggio…</span>');
    const def = clone(dg); delete def._new;
    const d = await post({ resource:'dungeon', code: session.code, username: session.username, op:'saveDef', def });
    saving = false;
    if(!d){
      showSaveStatus(`<span style="color:#ff5d5d;">⚠ NON salvato: ${esc(lastError || 'errore di rete')}. Riprovo tra poco (la bozza resta nel browser).</span>`);
      clearTimeout(autoTimer); autoTimer = setTimeout(()=>doSave(true), 8000);
      if(!auto) window.alert('Salvataggio non riuscito: ' + (lastError || 'errore di rete'));
      return false;
    }
    data = d.dungeon;
    dg._new = false;
    if(changeSeq===seq){ dirty = false; clearBackup(); }
    const t = new Date(); const hh = String(t.getHours()).padStart(2,'0'), mm = String(t.getMinutes()).padStart(2,'0');
    const noEntrance = !dg.grid.includes('e') ? ' <span class="muted">(manca un ⛩️ Ingresso: la pedina partirà dalla prima casella libera)</span>' : '';
    showSaveStatus(`<span style="color:#35e8c9;">✔ Salvato alle ${hh}:${mm}</span>${noEntrance}`);
    // Aggiorna l'elenco dei dungeon (nome/dimensioni) senza ridisegnare l'editor (niente perdita del focus).
    const pickSel = document.getElementById('dge-pick');
    if(pickSel && !pickSel.querySelector(`option[value="${CSS.escape(dg.id)}"]`)){
      const o = document.createElement('option'); o.value = dg.id; pickSel.appendChild(o); pickSel.value = dg.id;
    }
    const opt = pickSel && pickSel.querySelector(`option[value="${CSS.escape(dg.id)}"]`);
    if(opt) opt.textContent = `🏰 ${dg.name} (${dg.cols}×${dg.rows})${data.activeId===dg.id?' · gruppo dentro':''}`;
    return true;
  }

  function paint(i){
    if(i==null || isNaN(i)) return;
    if(tool==='room'){
      if(!selRoom) return;
      if(dg.grid[i]==='.') dg.grid[i] = 'f'; // allargare una stanza su un muro lo trasforma in pavimento
      dg.roomOf[i] = selRoom;
    } else if(tool==='unroom'){
      dg.roomOf[i] = null;
    } else if(tool==='C'){
      // Porta chiusa (senza chiave): si apre quando il gruppo ci passa.
      dg.grid[i] = 'd';
      const prevText = dg.features[i] && dg.features[i].text || '';
      dg.features[i] = { type:'door', closed:true, text: prevText };
    } else if(tool==='L'){
      // Porta chiusa = casella porta + serratura (chiave e consumo si scelgono nel pannello sotto).
      dg.grid[i] = 'd';
      if(!dg.features[i] || dg.features[i].type!=='lock') dg.features[i] = { type:'lock', key:'', consume:false, text:'' };
      selCell = i; draft = clone(dg.features[i]);
    } else if(TILE_TOOLS.some(t=>t.key===tool)){
      if(tool==='e'){ dg.grid = dg.grid.map(t=>t==='e'?'f':t); } // un solo ingresso
      dg.grid[i] = tool;
      if(tool==='.'){ dg.roomOf[i] = null; delete dg.features[i]; }
      if(tool==='d' && dg.features[i] && (dg.features[i].type==='lock' || dg.features[i].type==='door')) delete dg.features[i]; // porta aperta: via serratura/chiusura
    } else return;
    markDirty();
    const el = root.querySelector(`[data-dge-cell="${i}"]`);
    if(el){ el.style.cssText = cellStyle(i) + 'display:flex;align-items:center;justify-content:center;'; el.innerHTML = cellIcon(i); }
  }

  let lastPaint = null;
  function lineCells(a, b){
    const A = rc(a), Bp = rc(b), out = [];
    let x0 = A.c, y0 = A.r; const x1 = Bp.c, y1 = Bp.r;
    const dx = Math.abs(x1-x0), sx = x0<x1?1:-1, dy = -Math.abs(y1-y0), sy = y0<y1?1:-1;
    let err = dx+dy;
    for(let guard=0; guard<200; guard++){
      out.push(y0*dg.cols+x0);
      if(x0===x1 && y0===y1) break;
      const e2 = 2*err;
      if(e2>=dy){ err+=dy; x0+=sx; }
      if(e2<=dx){ err+=dx; y0+=sy; }
    }
    return out;
  }

  function createRoomFromRect(){
    const inR = rectRange();
    const a = rectStart, b = rectEnd;
    rectStart = rectEnd = null;
    if(!inR) return;
    const r = { id: uid('room'), name: 'Stanza ' + (dg.rooms.length+1), desc:'', image:'', showOnMap:true };
    dg.rooms.push(r);
    for(let i=0;i<dg.grid.length;i++) if(inR(i)){ if(dg.grid[i]==='.') dg.grid[i]='f'; dg.roomOf[i] = r.id; }
    selRoom = r.id; markDirty();
    msg = `Creata "${r.name}" (${a===b?'1 casella':'rettangolo'}): dalle un nome, una descrizione e un'immagine qui sotto.`;
    render();
    const open = document.getElementById('dge-room-open');
    if(open){ open.scrollIntoView({ behavior:'smooth', block:'center' }); const n = open.querySelector('[data-dge-room-name]'); if(n) n.select(); }
  }

  function resize(rows, cols){
    rows = Math.max(3, Math.min(40, rows|0)); cols = Math.max(3, Math.min(40, cols|0));
    if(rows===dg.rows && cols===dg.cols) return;
    const g = Array(rows*cols).fill('.'), ro = Array(rows*cols).fill(null), fe = {};
    const map = (o)=>{ const r = Math.floor(o/dg.cols), c = o%dg.cols; return (r<rows && c<cols) ? r*cols+c : null; };
    for(let o=0;o<dg.grid.length;o++){
      const n = map(o); if(n==null) continue;
      g[n] = dg.grid[o]; ro[n] = dg.roomOf[o];
      if(dg.features[o]){
        const f = clone(dg.features[o]);
        if(f.type==='teleport' && !f.targetDungeon && f.targetIndex!=null) f.targetIndex = map(f.targetIndex);
        if(f.type==='lever') f.targets = (f.targets||[]).map(map).filter(x=>x!=null);
        fe[n] = f;
      }
    }
    dg.rows = rows; dg.cols = cols; dg.grid = g; dg.roomOf = ro; dg.features = fe; selCell = null; draft = null; pick = null;
    markDirty();
  }

  async function uploadImage(file){
    if(file.size > 3.5*1024*1024){ setMsg('Immagine troppo grande (max ~3MB).'); return null; }
    setMsg('Caricamento in corso...');
    const dataUrl = await new Promise((res, rej)=>{ const fr = new FileReader(); fr.onload = ()=>res(fr.result); fr.onerror = rej; fr.readAsDataURL(file); });
    try{
      const r = await fetch('/api/upload', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ code: session.code, dataUrl }) });
      const d = await readJson(r);
      if(r.ok && d && d.url){ setMsg(''); return d.url; }
      setMsg('Caricamento fallito: ' + ((d && d.error) || r.status)); return null;
    }catch(e){ setMsg('Caricamento fallito.'); return null; }
  }

  // I campi di testo aggiornano la copia di lavoro senza ridisegnare (niente perdita del focus).
  function syncTextFields(){
    const v = id => { const el = document.getElementById(id); return el ? el.value : null; };
    if(v('dge-name')!=null) dg.name = v('dge-name');
    if(v('dge-desc')!=null) dg.desc = v('dge-desc');
    if(v('dge-image')!=null) dg.image = v('dge-image');
    syncDraft();
  }
  function syncDraft(){
    if(!draft) return;
    const v = id => { const el = document.getElementById(id); return el ? (el.type==='checkbox' ? el.checked : el.value) : undefined; };
    const set = (k, id, fn)=>{ const x = v(id); if(x!==undefined) draft[k] = fn ? fn(x) : x; };
    set('text','dge-f-text');
    if(draft.type==='trap'){ set('closeMode','dge-f-closemode');  set('roll','dge-f-roll', x=>!!x); set('skill','dge-f-skill'); set('attr','dge-f-attr'); set('tn','dge-f-tn', x=>Number(x)||12); set('who','dge-f-who'); }
    if(draft.type==='key'){
      const oldName = draft.name;
      set('name','dge-f-kname', x=>x.trim()); set('desc','dge-f-kdesc');
      // Rinominare una chiave mantiene il collegamento con le sue porte.
      if(oldName && draft.name && normName(oldName)!==normName(draft.name)){
        locksForKey(oldName).forEach(t=>{ dg.features[t].key = draft.name; });
      }
    }
    if(draft.type==='loot'){ set('name','dge-f-name', x=>x.trim()); set('qty','dge-f-qty', x=>Math.max(1,Number(x)||1)); set('category','dge-f-cat'); set('mode','dge-f-mode'); set('desc','dge-f-desc'); }
    if(draft.type==='encounter') set('encounterId','dge-f-enc');
    if(draft.type==='lock'){ set('key','dge-f-key', x=>x.trim()); set('consume','dge-f-consume', x=>!!x); }
    if(draft.type==='rest') set('once','dge-f-once', x=>!!x);
    if(draft.type==='teleport' && draft.targetDungeon){
      const other = (data.dungeons||[]).find(x=>x.id===draft.targetDungeon);
      const row = Number(v('dge-f-trow')), col = Number(v('dge-f-tcol'));
      draft.targetIndex = (other && row>=1 && col>=1 && row<=other.rows && col<=other.cols) ? (row-1)*other.cols + (col-1) : null;
    }
    commitDraft();
  }
  // Applica subito la bozza alla casella (se è valida), così nulla si perde dimenticando "Applica".
  function commitDraft(){
    if(!draft || selCell==null || !dg) return;
    const cur = dg.features[selCell];
    if(!draft.type){ if(cur){ delete dg.features[selCell]; markDirty(); } return; }
    if(draft.type==='loot' && !draft.name) return;
    if(draft.type==='key' && !draft.name) return;
    if(draft.type==='lever' && !(draft.targets||[]).length) return;
    if(JSON.stringify(cur||null)===JSON.stringify(draft)) return;
    dg.features[selCell] = clone(draft);
    markDirty();
    const el = root.querySelector(`[data-dge-cell="${selCell}"]`);
    if(el) el.innerHTML = cellIcon(selCell);
  }

  function selectCell(i){
    selCell = i;
    draft = dg.features[i] ? clone(dg.features[i]) : { type:'' };
    if(dg.roomOf[i]) selRoom = dg.roomOf[i];
    pick = null;
  }

  function bind(){
    const tBtn = document.getElementById('dge-test');
    if(tBtn) tBtn.onclick = ()=> startTest();
    if(testMode){
      const ex = document.getElementById('dgt-exit'); if(ex) ex.onclick = ()=>{ testMode = false; render(); };
      const rs = document.getElementById('dgt-restart'); if(rs) rs.onclick = ()=> startTest();
      const rf = document.getElementById('dgt-refill'); if(rf) rf.onclick = async ()=>{ const d = await testOp({ op:'testRefill' }); if(d) testLogPush('⚡ Punti ricaricati (anche la Ricerca).'); render(); };
      const sr = document.getElementById('dgt-search'); if(sr) sr.onclick = async ()=>{ const d = await testOp({ op:'testSearch' }); if(d) testLogPush(d.found ? `🔍 Trovat${d.found===1?'o un passaggio segreto':'i '+d.found+' passaggi segreti'}!` : `🔍 Nessun passaggio segreto ${d.where ? 'in «'+d.where+'»' : 'qui intorno'}.`); render(); };
      const kc = document.getElementById('dgt-keys'); if(kc) kc.onchange = ()=>{ testKeys = !!kc.checked; };
      root.querySelectorAll('[data-dgt-cell]').forEach(el=> el.onclick = ()=> testMove(Number(el.getAttribute('data-dgt-cell'))));
      return;
    }
    const rst = document.getElementById('dge-restore');
    if(rst) rst.onclick = async ()=>{
      const b = readBackup(); if(!b || !b.dg) return;
      dg = clone(b.dg); delete dg.run; selCell = null; draft = null; pick = null; selRoom = null; tool = 'select';
      render();
      dirty = true; await doSave(false); render();
    };
    const rstDrop = document.getElementById('dge-restore-drop');
    if(rstDrop) rstDrop.onclick = ()=>{ if(window.confirm('Scartare definitivamente la bozza non salvata?')){ clearBackup(); render(); } };
    const pickSel = document.getElementById('dge-pick');
    if(pickSel) pickSel.onchange = async ()=>{
      const target = pickSel.value;
      if(dirty){ clearTimeout(autoTimer); const okSave = await doSave(false); if(!okSave && !window.confirm('Il dungeon aperto non si è potuto salvare: passare comunque all\'altro? (la bozza resta nel browser)')){ pickSel.value = dg ? dg.id : ''; return; } }
      pickSel.value = target;
      const src = (data.dungeons||[]).find(d=>d.id===pickSel.value);
      dg = src ? clone(src) : null; if(dg){ delete dg.run; delete dg.testRun; }
      dirty = false; selCell = null; draft = null; pick = null; selRoom = null; msg = '';
      render();
    };
    const nw = document.getElementById('dge-new');
    if(nw) nw.onclick = async ()=>{
      if(dirty){ clearTimeout(autoTimer); const okSave = await doSave(false); if(!okSave && !window.confirm('Il dungeon aperto non si è potuto salvare: crearne uno nuovo comunque? (la bozza resta nel browser)')) return; }
      const cols = Math.max(3, Math.min(40, Number(document.getElementById('dge-new-cols').value)||15));
      const rows = Math.max(3, Math.min(40, Number(document.getElementById('dge-new-rows').value)||15));
      dg = blank(rows, cols); dirty = false; saveState = ''; selCell = null; draft = null; pick = null; selRoom = null; tool = 'rect';
      msg = 'Nuovo dungeon: trascina un rettangolo sulla griglia per creare la prima stanza, poi collega le stanze con ⬜ Pavimento e 🚪 Porte.';
      render();
    };
    if(!dg) return;
    const lk = document.getElementById('dge-link');
    if(lk) lk.onchange = ()=>{
      const [macroId, sectorId, subsectionId, luogoId] = lk.value.split('|');
      dg.link = sectorId ? { macroId: macroId||'', sectorId, subsectionId: subsectionId||'', luogoId: luogoId||'' } : null;
      markDirty();
    };
    ['dge-name','dge-desc','dge-image'].forEach(id=>{ const el = document.getElementById(id); if(el) el.oninput = ()=>{ syncTextFields(); markDirty(); }; });
    root.querySelectorAll('[data-dge-draft]').forEach(el=>{ el.oninput = el.onchange = ()=>syncDraft(); });
    const rollChk = document.getElementById('dge-f-roll');
    if(rollChk) rollChk.onchange = ()=>{ syncDraft(); render(); };
    const vsel = document.getElementById('dge-vision');
    if(vsel) vsel.onchange = ()=>{ dg.vision = Number(vsel.value)||2; markDirty(); };
    const rs = document.getElementById('dge-resize');
    if(rs) rs.onclick = ()=>{
      const rows = Number(document.getElementById('dge-rows').value), cols = Number(document.getElementById('dge-cols').value);
      if((rows<dg.rows || cols<dg.cols) && !window.confirm('Rimpicciolendo la griglia le caselle fuori dal nuovo bordo (in basso/a destra) vengono cancellate. Continuare?')) return;
      if(!dg._new && !window.confirm('Cambiare dimensioni azzera l\'esplorazione di questo dungeon (mappa di nuovo coperta, contenuti di nuovo attivi) al salvataggio. Continuare?')) return;
      syncTextFields(); resize(rows, cols); render();
    };
    root.querySelectorAll('[data-dge-tool]').forEach(b=> b.onclick = ()=>{
      syncTextFields();
      tool = b.getAttribute('data-dge-tool');
      pick = null;
      if(tool!=='select'){ selCell = null; draft = null; }
      if(tool==='room' && !selRoom && dg.rooms[0]) selRoom = dg.rooms[0].id;
      render();
    });
    const pd = document.getElementById('dge-pick-done');
    if(pd) pd.onclick = ()=>{ pick = null; render(); };

    const grid = document.getElementById('dge-grid');
    if(grid){
      const idxFromEvent = (e)=>{
        const t = document.elementFromPoint(e.clientX, e.clientY);
        const c = t && t.closest ? t.closest('[data-dge-cell]') : null;
        return c ? Number(c.getAttribute('data-dge-cell')) : null;
      };
      grid.onpointerdown = (e)=>{
        const i = idxFromEvent(e);
        if(i==null) return;
        e.preventDefault();
        syncTextFields();
        if(pick && draft){
          if(pick==='teleport'){ draft.targetIndex = i; pick = null; }
          else if(pick==='lever'){ draft.targets = draft.targets || []; if(!draft.targets.includes(i)) draft.targets.push(i); }
          else if(pick==='lockKey'){
            const fk = dg.features[i];
            if(fk && fk.type==='key' && fk.name){ draft.key = fk.name; pick = null; }
            else { setMsg('Lì non c\'è una 🗝️ chiave (con un nome): clicca una casella con la chiave.'); return; }
          }
          else if(pick==='trapDoors'){
            const isD = dg.grid[i]==='d' || (dg.features[i] && dg.features[i].type==='lock');
            if(!isD){ setMsg('Clicca una porta (🚪 o 🔒).'); return; }
            draft.closeDoors = draft.closeDoors || [];
            if(!draft.closeDoors.includes(i)) draft.closeDoors.push(i);
            setMsg('');
          }
          else if(pick==='keyDoor'){
            if(dg.grid[i]!=='d' && !(dg.features[i] && dg.features[i].type==='lock')){ setMsg('Clicca una porta (🚪 o 🔒).'); return; }
            dg.grid[i] = 'd';
            const prev = dg.features[i] && dg.features[i].type==='lock' ? dg.features[i] : { type:'lock', consume:false, text:'' };
            dg.features[i] = Object.assign({}, prev, { type:'lock', key: draft.name });
            markDirty(); setMsg('');
          }
          commitDraft(); render(); return;
        }
        if(tool==='select'){ selectCell(i); render(); return; }
        if(tool==='rect'){ rectStart = rectEnd = i; painting = true; render(); return; }
        painting = true; lastPaint = i; paint(i);
      };
      grid.onpointermove = (e)=>{
        if(!painting) return;
        const i = idxFromEvent(e);
        if(tool==='rect'){ if(i!=null && i!==rectEnd){ rectEnd = i; const inR = rectRange(); root.querySelectorAll('[data-dge-cell]').forEach(el=>{ const k = +el.getAttribute('data-dge-cell'); el.style.outline = inR(k) ? '2px dashed #35e8c9' : (k===selCell ? '2px solid #ffd35a' : ''); el.style.outlineOffset = '-2px'; }); } return; }
        // Trascinando veloce il puntatore "salta" caselle: riempiamo la linea tra l'ultima casella
        // dipinta e quella attuale, così non restano buchi.
        if(i==null) return;
        if(lastPaint!=null && i!==lastPaint) lineCells(lastPaint, i).forEach(paint); else paint(i);
        lastPaint = i;
      };
      const stop = ()=>{
        if(!painting) return;
        painting = false;
        if(tool==='rect'){ createRoomFromRect(); return; }
        render();
      };
      grid.onpointerup = stop; grid.onpointerleave = stop;
    }

    // --- pannello contenuto casella ---
    const ptd = document.getElementById('dge-pick-trapdoors');
    if(ptd) ptd.onclick = ()=>{ syncDraft(); pick = 'trapDoors'; render(); };
    root.querySelectorAll('[data-dge-trapdoor-del]').forEach(a=> a.onclick = (e)=>{ e.preventDefault(); syncDraft(); const t = +a.getAttribute('data-dge-trapdoor-del'); draft.closeDoors = (draft.closeDoors||[]).filter(x=>x!==t); commitDraft(); render(); });
    const dst = document.getElementById('dge-door-state');
    if(dst) dst.onchange = ()=>{
      syncDraft();
      const txt = draft && draft.text || '';
      if(dst.value==='open') draft = { type:'' };
      else if(dst.value==='closed') draft = { type:'door', closed:true, text: txt };
      else draft = (dg.features[selCell] && dg.features[selCell].type==='lock') ? clone(dg.features[selCell]) : { type:'lock', key:'', consume:false, text: txt };
      commitDraft(); render();
    };
    const ft = document.getElementById('dge-f-type');
    if(ft) ft.onchange = ()=>{
      syncDraft();
      const t = ft.value;
      draft = (dg.features[selCell] && dg.features[selCell].type===t) ? clone(dg.features[selCell]) : { type:t, text: draft ? draft.text : '' };
      if(t==='key' && !draft.name) draft.name = 'Chiave ' + (keysInDungeon().length + 1);
      pick = null;
      commitDraft();
      render();
    };
    root.querySelectorAll('[data-dge-icon]').forEach(b=> b.onclick = ()=>{ syncDraft(); draft.icon = b.getAttribute('data-dge-icon'); commitDraft(); render(); });
    const tdg = document.getElementById('dge-f-tdg');
    if(tdg) tdg.onchange = ()=>{ syncDraft(); draft.targetDungeon = tdg.value; draft.targetIndex = null; render(); };
    const ptp = document.getElementById('dge-pick-tp');
    if(ptp) ptp.onclick = ()=>{ syncDraft(); pick = 'teleport'; render(); };
    const plk = document.getElementById('dge-pick-lockkey');
    if(plk) plk.onclick = ()=>{ syncDraft(); pick = 'lockKey'; render(); };
    const pkd = document.getElementById('dge-pick-keydoor');
    if(pkd) pkd.onclick = ()=>{ syncDraft(); pick = 'keyDoor'; render(); };
    root.querySelectorAll('[data-dge-unlink-door]').forEach(a=> a.onclick = (e)=>{ e.preventDefault(); const t = +a.getAttribute('data-dge-unlink-door'); if(dg.features[t]) dg.features[t].key = ''; markDirty(); render(); });
    const kp = document.getElementById('dge-f-keypick');
    if(kp) kp.onchange = ()=>{
      syncDraft();
      if(kp.value==='__other'){ const ki = document.getElementById('dge-f-key'); if(ki){ ki.value=''; ki.focus(); } return; }
      draft.key = kp.value; commitDraft(); render();
    };
    const plv = document.getElementById('dge-pick-lever');
    if(plv) plv.onclick = ()=>{ syncDraft(); pick = 'lever'; render(); };
    root.querySelectorAll('[data-dge-lever-del]').forEach(a=> a.onclick = (e)=>{ e.preventDefault(); syncDraft(); const t = +a.getAttribute('data-dge-lever-del'); draft.targets = (draft.targets||[]).filter(x=>x!==t); commitDraft(); render(); });
    const fa = document.getElementById('dge-f-apply');
    if(fa) fa.onclick = ()=>{
      syncDraft();
      if(!draft || !draft.type){ delete dg.features[selCell]; markDirty(); msg = 'Contenuto tolto.'; render(); return; }
      if(draft.type==='loot' && !draft.name){ setMsg('Scrivi il nome dell\'oggetto.'); return; }
      if(draft.type==='lever' && !(draft.targets||[]).length){ setMsg('Scegli almeno una casella che la leva deve aprire.'); return; }
      dg.features[selCell] = clone(draft); pick = null; markDirty(); msg = 'Contenuto applicato.';
      render();
    };

    // --- stanze ---
    root.querySelectorAll('[data-dge-room-sel]').forEach(el=> el.onclick = (e)=>{ e.preventDefault(); syncTextFields(); selRoom = el.getAttribute('data-dge-room-sel'); if(tool!=='select') tool = 'room'; render(); });
    root.querySelectorAll('[data-dge-room-name]').forEach(el=> el.oninput = ()=>{ dg.rooms[+el.getAttribute('data-dge-room-name')].name = el.value; markDirty(); });
    root.querySelectorAll('[data-dge-room-desc]').forEach(el=> el.oninput = ()=>{ dg.rooms[+el.getAttribute('data-dge-room-desc')].desc = el.value; markDirty(); });
    root.querySelectorAll('[data-dge-room-img]').forEach(el=> el.onchange = ()=>{ dg.rooms[+el.getAttribute('data-dge-room-img')].image = el.value.trim(); markDirty(); syncTextFields(); setTimeout(render, 0); }); // ridisegno rimandato: 'change' scatta durante il blur
    root.querySelectorAll('[data-dge-room-onmap]').forEach(el=> el.onchange = ()=>{ dg.rooms[+el.getAttribute('data-dge-room-onmap')].showOnMap = !!el.checked; markDirty(); syncTextFields(); render(); });
    root.querySelectorAll('[data-dge-room-del]').forEach(b=> b.onclick = ()=>{
      const idx = +b.getAttribute('data-dge-room-del'); const r = dg.rooms[idx];
      if(!window.confirm(`Eliminare la stanza "${r.name}"? Le sue caselle restano pavimento, ma non faranno più parte di una stanza.`)) return;
      syncTextFields();
      dg.rooms.splice(idx,1); dg.roomOf = dg.roomOf.map(x=>x===r.id?null:x); if(selRoom===r.id) selRoom = null;
      markDirty(); render();
    });

    // --- caricamento immagini (copertina, stanze, icone personali) ---
    root.querySelectorAll('[data-dge-upload-btn]').forEach(b=> b.onclick = ()=>{
      const k = b.getAttribute('data-dge-upload-btn');
      const inp = document.getElementById(k==='cover' ? 'dge-up-cover' : (k==='icon' ? 'dge-up-icon' : 'dge-up-room-' + k.split(':')[1]));
      if(inp) inp.click();
    });
    root.querySelectorAll('[data-dge-upload]').forEach(inp=> inp.onchange = async ()=>{
      const file = inp.files && inp.files[0]; if(!file) return;
      syncTextFields();
      const url = await uploadImage(file);
      if(!url) return;
      const k = inp.getAttribute('data-dge-upload');
      if(k==='cover') dg.image = url;
      else if(k==='icon'){ if(draft){ draft.icon = url; commitDraft(); } }
      else dg.rooms[+k.split(':')[1]].image = url;
      markDirty(); msg = k==='icon' ? 'Icona caricata.' : 'Immagine caricata.'; render();
    });

    const save = document.getElementById('dge-save');
    if(save) save.onclick = async ()=>{
      clearTimeout(autoTimer);
      save.disabled = true;
      dirty = true; // il bottone salva sempre, anche se non risultano modifiche
      await doSave(false);
      save.disabled = false;
    };
    const del = document.getElementById('dge-del');
    if(del) del.onclick = async ()=>{
      if(dg._new){ clearTimeout(autoTimer); dg = null; dirty = false; clearBackup(); render(); return; }
      if(!window.confirm(`Eliminare definitivamente "${dg.name}"?`)) return;
      const d = await post({ resource:'dungeon', code: session.code, username: session.username, op:'deleteDef', id: dg.id });
      if(!d){ setMsg('⚠ ' + (lastError || 'Eliminazione non riuscita.')); return; }
      clearTimeout(autoTimer); clearBackup();
      data = d.dungeon; dg = null; dirty = false; msg = 'Dungeon eliminato.'; render();
    };
  }

  window.DungeonEditor = {
    async mount(el, sess){
      root = el; session = sess;
      if(!window.__dgeUnloadGuard){
        window.__dgeUnloadGuard = true;
        window.addEventListener('beforeunload', (e)=>{ if(dirty || saving){ backupLocal(); e.preventDefault(); e.returnValue = ''; } });
      }
      root.innerHTML = '<div class="muted">Caricamento dungeon…</div>';
      await load();
      render();
    },
    hasUnsavedChanges(){ return !!dirty; }
  };
})();
