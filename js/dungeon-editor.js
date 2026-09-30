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
//   - caselle: Vuoto/Muro, Pavimento, Porta, Ingresso (⛩️, la pedina parte da qui), Uscita (🚪);
//   - Stanze: gruppi di caselle con nome, descrizione e immagine, mostrati ai giocatori (e
//     pubblicati in chat) quando la pedina ci entra per la prima volta;
//   - Contenuti su singole caselle: Trappola, Tesoro, Incontro, Porta chiusa (con chiave), Nota.
// Cambiare le dimensioni di un dungeon già esplorato azzera l'esplorazione (lo fa il server,
// perché le posizioni salvate non corrisponderebbero più alle caselle).

(function(){
  const TILE_TOOLS = [
    { key:'.', label:'🧱 Muro / vuoto' },
    { key:'f', label:'⬜ Pavimento' },
    { key:'d', label:'🚪 Porta' },
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
  const FEATURE_TYPES = [['','— nessuno —'],['trap','⚠️ Trappola'],['loot','🎁 Tesoro'],['encounter','⚔️ Incontro'],['lock','🔒 Porta chiusa'],['note','📜 Nota']];
  const ROOM_COLORS = ['#2f7f86','#7a5a2a','#5d3f86','#2f7a4a','#86303f','#3a5a8a','#7a7a2a','#2a7a7a'];

  let session = null, root = null;
  let data = null;          // stato completo (vista Master)
  let encounters = [];      // Incontri della Scena, per collegarli a una casella
  let dg = null;            // copia di lavoro del dungeon in modifica
  let tool = 'f';           // chiave casella | 'room' | 'unroom' | 'feature'
  let roomBrush = null;
  let selCell = null;
  let dirty = false;
  let painting = false;
  let msg = '';

  const esc = s => String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const uid = p => p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2,6);
  let lastError = null;
  async function readJson(r){ const t = await r.text(); try{ return JSON.parse(t); }catch(e){ return { error:'Risposta non valida dal server (HTTP '+r.status+')' }; } }
  async function get(url){ try{ const r = await fetch(url); const d = await readJson(r); if(!r.ok){ lastError = d.error; return null; } return d; }catch(e){ lastError = 'Impossibile contattare il server.'; return null; } }
  async function post(body){ try{ const r = await fetch('/api/state', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) }); const d = await readJson(r); if(!r.ok){ lastError = d.error; return null; } return d; }catch(e){ lastError = 'Impossibile contattare il server.'; return null; } }

  function blank(rows, cols){
    const n = rows*cols;
    return { id: uid('dg'), name:'Nuovo Dungeon', desc:'', image:'', rows, cols, grid: Array(n).fill('.'), roomOf: Array(n).fill(null), rooms: [], features: {}, _new:true };
  }
  function clone(o){ return JSON.parse(JSON.stringify(o)); }

  async function load(){
    const d = await get('/api/state?resource=dungeon&code=' + encodeURIComponent(session.code) + '&username=' + encodeURIComponent(session.username));
    data = d && d.dungeon ? d.dungeon : { dungeons: [] };
    if(d && d.warning) msg = d.warning;
    const sc = await get('/api/state?resource=scene&code=' + encodeURIComponent(session.code));
    encounters = (sc && sc.scene && Array.isArray(sc.scene.encounters)) ? sc.scene.encounters : [];
  }

  function roomColor(id){
    const i = dg.rooms.findIndex(r=>r.id===id);
    return ROOM_COLORS[(i<0?0:i) % ROOM_COLORS.length];
  }

  function cellStyle(i){
    const t = dg.grid[i];
    let bg = '#141b1f';
    if(t==='f') bg = '#3a4c52';
    if(t==='d') bg = '#8a5a26';
    if(t==='e') bg = '#2a8a55';
    if(t==='x') bg = '#8a2a73';
    if(t!=='.' && dg.roomOf[i]) bg = roomColor(dg.roomOf[i]);
    const door = t==='d' && dg.roomOf[i] ? 'box-shadow:inset 0 0 0 3px #8a5a26;' : '';
    return `background:${bg};${door}`;
  }
  function cellIcon(i){
    const f = dg.features[i];
    if(f) return { trap:'⚠️', loot:'🎁', encounter:'⚔️', lock:'🔒', note:'📜' }[f.type] || '';
    if(dg.grid[i]==='e') return '⛩️';
    if(dg.grid[i]==='x') return '🏁';
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
    const size = Math.max(12, Math.min(28, Math.floor((w-16)/dg.cols) - 1));
    let h = `<div id="dge-grid" style="display:grid;grid-template-columns:repeat(${dg.cols},${size}px);grid-auto-rows:${size}px;gap:1px;background:#05080b;padding:1px;width:max-content;max-width:100%;overflow:auto;margin:6px auto;user-select:none;touch-action:none;font-size:${Math.max(8,Math.floor(size*0.55))}px;">`;
    for(let i=0;i<dg.grid.length;i++){
      h += `<div data-dge-cell="${i}" style="${cellStyle(i)}display:flex;align-items:center;justify-content:center;cursor:crosshair;${selCell===i?'outline:2px solid #ffd35a;outline-offset:-2px;':''}">${cellIcon(i)}</div>`;
    }
    return h + '</div>';
  }

  function toolsHTML(){
    const btn = (key, label)=>`<button class="btn ${tool===key?'':'ghost'} small" data-dge-tool="${key}">${label}</button>`;
    return `<div style="display:flex;flex-wrap:wrap;gap:4px;margin:6px 0;">
      ${TILE_TOOLS.map(t=>btn(t.key, t.label)).join('')}
      ${btn('room','🏛️ Dipingi stanza')}
      ${btn('unroom','🧽 Togli stanza')}
      ${btn('feature','✨ Contenuto casella')}
    </div>
    ${tool==='room' ? `<div class="row" style="gap:6px;align-items:center;"><span class="muted" style="font-size:11px;">Stanza da dipingere:</span>
      <select id="dge-room-brush" style="max-width:200px;">${dg.rooms.map(r=>`<option value="${esc(r.id)}" ${roomBrush===r.id?'selected':''}>${esc(r.name)}</option>`).join('') || '<option value="">(crea prima una stanza qui sotto)</option>'}</select></div>` : ''}
    <div class="muted" style="font-size:10.5px;">Clic o trascina per disegnare. Con "✨ Contenuto casella" fai clic su una casella per metterci una trappola, un tesoro, un incontro, una porta chiusa o una nota.</div>`;
  }

  function roomsHTML(){
    return `<div style="margin-top:10px;"><div class="muted" style="font-size:10px;text-transform:uppercase;letter-spacing:0.06em;">🏛️ Stanze (${dg.rooms.length})</div>
      ${dg.rooms.map((r,idx)=>`<div class="hud-frame" style="padding:8px;margin:6px 0;border-left:4px solid ${roomColor(r.id)};">
        <div class="row" style="gap:6px;"><input type="text" data-dge-room-name="${idx}" value="${esc(r.name)}" placeholder="Nome stanza" style="flex:2;" />
          <button class="btn ghost small" data-dge-room-del="${idx}">🗑️</button></div>
        <textarea data-dge-room-desc="${idx}" rows="2" placeholder="Descrizione mostrata quando il gruppo entra" style="width:100%;margin-top:4px;">${esc(r.desc)}</textarea>
        <div class="row" style="gap:6px;margin-top:4px;align-items:center;">
          <input type="text" id="dge-room-img-${idx}" data-dge-room-img="${idx}" value="${esc(r.image)}" placeholder="URL immagine (facoltativa)" style="flex:2;" />
          <input type="file" accept="image/*" data-dge-upload="room:${idx}" id="dge-up-room-${idx}" style="display:none;" />
          <button class="btn ghost small" data-dge-upload-btn="room:${idx}">📤 Carica</button>
          ${r.image ? `<img src="${esc(r.image)}" style="height:34px;border-radius:3px;" onerror="this.remove()" />` : ''}
        </div>
      </div>`).join('')}
      <button class="btn ghost small" id="dge-room-add">+ Nuova stanza</button>
    </div>`;
  }

  function featureHTML(){
    if(tool!=='feature' || selCell==null) return '';
    const f = dg.features[selCell] || { type:'' };
    const r = Math.floor(selCell/dg.cols)+1, c = selCell%dg.cols+1;
    const walk = dg.grid[selCell]!=='.';
    const sel = (id, opts, val)=>`<select id="${id}">${opts.map(([v,l])=>`<option value="${esc(v)}" ${String(val)===String(v)?'selected':''}>${esc(l)}</option>`).join('')}</select>`;
    let fields = '';
    if(f.type==='trap') fields = `
      <div class="row" style="gap:6px;"><div class="field" style="flex:2;"><label>Skill</label>${sel('dge-f-skill', SKILLS, f.skill||'awareness')}</div>
      <div class="field" style="flex:2;"><label>Caratteristica</label>${sel('dge-f-attr', ATTRS, f.attr||'')}</div>
      <div class="field" style="flex:1;"><label>TN</label><input type="number" class="dge-num" id="dge-f-tn" value="${Number(f.tn)||12}" min="1" max="40" /></div></div>`;
    if(f.type==='loot') fields = `
      <div class="row" style="gap:6px;"><div class="field" style="flex:3;"><label>Oggetto</label><input type="text" id="dge-f-name" value="${esc(f.name||'')}" /></div>
      <div class="field" style="flex:1;"><label>Q.tà</label><input type="number" class="dge-num" id="dge-f-qty" min="1" value="${Number(f.qty)||1}" /></div></div>
      <div class="row" style="gap:6px;"><div class="field" style="flex:1;"><label>Categoria</label>${sel('dge-f-cat', CATEGORIES, f.category||'altro')}</div>
      <div class="field" style="flex:2;"><label>Modalità</label>${sel('dge-f-mode', [['first','Tutto al primo che lo prende'],['each','Stessa quantità a ciascuno'],['pool','Quantità totale da spartire']], f.mode||'first')}</div></div>
      <div class="field"><label>Descrizione oggetto</label><input type="text" id="dge-f-desc" value="${esc(f.desc||'')}" /></div>`;
    if(f.type==='encounter') fields = `
      <div class="field"><label>Incontro della Scena</label>${sel('dge-f-enc', [['','— nessuno (solo avviso) —']].concat(encounters.map(e=>[e.id, (e.name||'Incontro') + (e.isBoss?' 👑':'')])), f.encounterId||'')}</div>`;
    if(f.type==='lock') fields = `
      <div class="field"><label>Oggetto chiave (nome esatto in Inventario — vuoto = apre solo il Master)</label><input type="text" id="dge-f-key" value="${esc(f.key||'')}" placeholder="es. Chiave d'Ossidiana" /></div>`;
    const textLabel = { trap:'Testo della trappola (in chat)', loot:'Testo di scoperta (facoltativo)', encounter:'Testo in chat (il nome dell\'Incontro resta nascosto)', lock:'Testo quando viene aperta', note:'Testo narrato quando il gruppo arriva qui' }[f.type];
    return `<div class="hud-frame" style="padding:10px;margin-top:8px;border-left:3px solid #ffd35a;">
      <div style="font-size:12px;margin-bottom:6px;"><b>✨ Casella riga ${r}, colonna ${c}</b>${walk?'':' <span class="muted">(è un muro: disegnaci prima un pavimento)</span>'}</div>
      <div class="field"><label>Contenuto</label>${sel('dge-f-type', FEATURE_TYPES, f.type||'')}</div>
      ${fields}
      ${f.type ? `<div class="field"><label>${textLabel}</label><textarea id="dge-f-text" rows="2" style="width:100%;">${esc(f.text||'')}</textarea></div>` : ''}
      ${f.type ? `<button class="btn small" id="dge-f-apply">✔ Applica alla casella</button>` : ''}
    </div>`;
  }

  function editorHTML(){
    if(!dg) return '';
    return `
      <div class="row" style="gap:6px;margin-top:8px;">
        <div class="field" style="flex:2;margin:0;"><label>Nome</label><input type="text" id="dge-name" value="${esc(dg.name)}" /></div>
      </div>
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
      </div>
      ${toolsHTML()}
      ${gridHTML()}
      ${featureHTML()}
      ${roomsHTML()}
      <div class="row" style="gap:6px;margin-top:10px;align-items:center;flex-wrap:wrap;">
        <button class="btn amber" id="dge-save">💾 Salva dungeon</button>
        <button class="btn ghost small" id="dge-del">🗑️ Elimina</button>
        <span class="muted" style="font-size:11px;">${dirty?'● modifiche non salvate':''}</span>
      </div>`;
  }

  function render(){
    if(!root) return;
    root.innerHTML = `<style>.dge-num{background:var(--panel-2,#121a22);color:var(--text,#ddd);border:1px solid var(--line,#1c2a30);border-radius:3px;padding:4px;}</style><div class="hud-frame card" style="margin-top:12px;">
      <div class="section-title">🏰 Editor Dungeon</div>
      <div class="muted" style="font-size:11px;margin-bottom:6px;">Disegna qui il dungeon; per farci entrare il gruppo usa il pannello 🏰 Dungeon nella Scena del Tavolo.</div>
      ${listHTML()}
      ${editorHTML()}
      <div class="err" id="dge-msg" style="margin-top:6px;">${esc(msg)}</div>
    </div>`;
    bind();
  }
  function setMsg(t){ msg = t||''; const el = document.getElementById('dge-msg'); if(el) el.textContent = msg; }
  function markDirty(){ dirty = true; }

  function paint(i){
    if(i==null || isNaN(i)) return;
    if(tool==='room'){
      if(!roomBrush || dg.grid[i]==='.') return;
      dg.roomOf[i] = roomBrush;
    } else if(tool==='unroom'){
      dg.roomOf[i] = null;
    } else if(tool==='feature'){
      return;
    } else {
      if(tool==='e'){ dg.grid = dg.grid.map(t=>t==='e'?'f':t); } // un solo ingresso
      dg.grid[i] = tool;
      if(tool==='.'){ dg.roomOf[i] = null; delete dg.features[i]; }
    }
    markDirty();
    const el = root.querySelector(`[data-dge-cell="${i}"]`);
    if(el){ el.setAttribute('style', el.getAttribute('style').replace(/background:[^;]*;(box-shadow:[^;]*;)?/, cellStyle(i))); el.textContent = cellIcon(i); }
    if(tool==='e') render();
  }

  function resize(rows, cols){
    rows = Math.max(3, Math.min(40, rows|0)); cols = Math.max(3, Math.min(40, cols|0));
    if(rows===dg.rows && cols===dg.cols) return;
    const g = Array(rows*cols).fill('.'), ro = Array(rows*cols).fill(null), fe = {};
    for(let r=0;r<Math.min(rows,dg.rows);r++) for(let c=0;c<Math.min(cols,dg.cols);c++){
      const o = r*dg.cols+c, n = r*cols+c;
      g[n] = dg.grid[o]; ro[n] = dg.roomOf[o];
      if(dg.features[o]) fe[n] = dg.features[o];
    }
    dg.rows = rows; dg.cols = cols; dg.grid = g; dg.roomOf = ro; dg.features = fe; selCell = null;
    markDirty();
  }

  async function uploadImage(file){
    const dataUrl = await new Promise((res, rej)=>{ const fr = new FileReader(); fr.onload = ()=>res(fr.result); fr.onerror = rej; fr.readAsDataURL(file); });
    try{
      const r = await fetch('/api/upload', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ code: session.code, dataUrl }) });
      const d = await readJson(r);
      return (r.ok && d && d.url) ? d.url : (setMsg('Caricamento fallito: ' + ((d && d.error) || r.status)), null);
    }catch(e){ setMsg('Caricamento fallito.'); return null; }
  }

  // I campi di testo aggiornano la copia di lavoro senza ridisegnare (niente perdita del focus).
  function syncTextFields(){
    const v = id => { const el = document.getElementById(id); return el ? el.value : null; };
    if(v('dge-name')!=null) dg.name = v('dge-name');
    if(v('dge-desc')!=null) dg.desc = v('dge-desc');
    if(v('dge-image')!=null) dg.image = v('dge-image');
  }

  function bind(){
    const pick = document.getElementById('dge-pick');
    if(pick) pick.onchange = ()=>{
      if(dirty && !window.confirm('Ci sono modifiche non salvate: scartarle?')){ pick.value = dg ? dg.id : ''; return; }
      const src = (data.dungeons||[]).find(d=>d.id===pick.value);
      dg = src ? clone(src) : null; if(dg) delete dg.run;
      dirty = false; selCell = null; roomBrush = dg && dg.rooms[0] ? dg.rooms[0].id : null; msg = '';
      render();
    };
    const nw = document.getElementById('dge-new');
    if(nw) nw.onclick = ()=>{
      if(dirty && !window.confirm('Ci sono modifiche non salvate: scartarle?')) return;
      const cols = Math.max(3, Math.min(40, Number(document.getElementById('dge-new-cols').value)||15));
      const rows = Math.max(3, Math.min(40, Number(document.getElementById('dge-new-rows').value)||15));
      dg = blank(rows, cols); dirty = true; selCell = null; roomBrush = null; tool = 'f'; msg = '';
      render();
    };
    if(!dg) return;
    ['dge-name','dge-desc','dge-image'].forEach(id=>{ const el = document.getElementById(id); if(el) el.oninput = ()=>{ syncTextFields(); markDirty(); }; });
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
      if(tool==='room' && !roomBrush && dg.rooms[0]) roomBrush = dg.rooms[0].id;
      if(tool!=='feature') selCell = null;
      render();
    });
    const brush = document.getElementById('dge-room-brush');
    if(brush) brush.onchange = ()=>{ roomBrush = brush.value || null; };

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
        if(tool==='feature'){ syncTextFields(); selCell = i; render(); return; }
        painting = true; syncTextFields(); paint(i);
        e.preventDefault();
      };
      grid.onpointermove = (e)=>{ if(painting) paint(idxFromEvent(e)); };
      const stop = ()=>{ if(painting){ painting = false; render(); } };
      grid.onpointerup = stop; grid.onpointerleave = stop;
    }

    const ft = document.getElementById('dge-f-type');
    if(ft) ft.onchange = ()=>{
      const t = ft.value;
      if(!t){ delete dg.features[selCell]; markDirty(); }
      else dg.features[selCell] = Object.assign({ type:t }, (dg.features[selCell] && dg.features[selCell].type===t) ? dg.features[selCell] : {}, { type:t });
      if(t) markDirty();
      render();
    };
    const fa = document.getElementById('dge-f-apply');
    if(fa) fa.onclick = ()=>{
      const v = id => { const el = document.getElementById(id); return el ? el.value : ''; };
      const t = v('dge-f-type');
      const f = { type:t, text: v('dge-f-text') };
      if(t==='trap'){ f.skill = v('dge-f-skill'); f.attr = v('dge-f-attr'); f.tn = Number(v('dge-f-tn'))||12; }
      if(t==='loot'){ f.name = v('dge-f-name').trim(); f.qty = Math.max(1, Number(v('dge-f-qty'))||1); f.category = v('dge-f-cat'); f.mode = v('dge-f-mode'); f.desc = v('dge-f-desc'); if(!f.name){ setMsg('Scrivi il nome dell\'oggetto.'); return; } }
      if(t==='encounter'){ f.encounterId = v('dge-f-enc'); }
      if(t==='lock'){ f.key = v('dge-f-key').trim(); }
      dg.features[selCell] = f; markDirty(); msg = 'Contenuto applicato (ricordati di salvare).';
      render();
    };

    const addRoom = document.getElementById('dge-room-add');
    if(addRoom) addRoom.onclick = ()=>{
      syncTextFields();
      const r = { id: uid('room'), name: 'Stanza ' + (dg.rooms.length+1), desc:'', image:'' };
      dg.rooms.push(r); roomBrush = r.id; tool = 'room'; markDirty(); render();
    };
    root.querySelectorAll('[data-dge-room-name]').forEach(el=> el.oninput = ()=>{ dg.rooms[+el.getAttribute('data-dge-room-name')].name = el.value; markDirty(); });
    root.querySelectorAll('[data-dge-room-desc]').forEach(el=> el.oninput = ()=>{ dg.rooms[+el.getAttribute('data-dge-room-desc')].desc = el.value; markDirty(); });
    root.querySelectorAll('[data-dge-room-img]').forEach(el=> el.onchange = ()=>{ dg.rooms[+el.getAttribute('data-dge-room-img')].image = el.value.trim(); markDirty(); syncTextFields(); setTimeout(render, 0); }); // ridisegno rimandato: 'change' scatta durante il blur
    root.querySelectorAll('[data-dge-room-del]').forEach(b=> b.onclick = ()=>{
      const idx = +b.getAttribute('data-dge-room-del'); const r = dg.rooms[idx];
      if(!window.confirm(`Eliminare la stanza "${r.name}"? Le sue caselle restano, ma non faranno più parte di una stanza.`)) return;
      syncTextFields();
      dg.rooms.splice(idx,1); dg.roomOf = dg.roomOf.map(x=>x===r.id?null:x); if(roomBrush===r.id) roomBrush = dg.rooms[0] ? dg.rooms[0].id : null;
      markDirty(); render();
    });
    root.querySelectorAll('[data-dge-upload-btn]').forEach(b=> b.onclick = ()=>{
      const k = b.getAttribute('data-dge-upload-btn');
      const inp = document.getElementById(k==='cover' ? 'dge-up-cover' : 'dge-up-room-' + k.split(':')[1]);
      if(inp) inp.click();
    });
    root.querySelectorAll('[data-dge-upload]').forEach(inp=> inp.onchange = async ()=>{
      const file = inp.files && inp.files[0]; if(!file) return;
      if(file.size > 3.5*1024*1024){ setMsg('Immagine troppo grande (max ~3MB).'); return; }
      setMsg('Caricamento in corso...');
      const url = await uploadImage(file);
      if(!url) return;
      syncTextFields();
      const k = inp.getAttribute('data-dge-upload');
      if(k==='cover') dg.image = url; else dg.rooms[+k.split(':')[1]].image = url;
      markDirty(); msg = 'Immagine caricata (ricordati di salvare).'; render();
    });

    const save = document.getElementById('dge-save');
    if(save) save.onclick = async ()=>{
      syncTextFields();
      if(!dg.grid.some(t=>t!=='.')){ setMsg('Disegna almeno una casella di pavimento.'); return; }
      if(!dg.grid.includes('e')) { if(!window.confirm('Non c\'è nessun ⛩️ Ingresso: la pedina partirà dalla prima casella calpestabile. Salvare comunque?')) return; }
      save.disabled = true;
      const def = clone(dg); delete def._new;
      const d = await post({ resource:'dungeon', code: session.code, username: session.username, op:'saveDef', def });
      save.disabled = false;
      if(!d){ setMsg('⚠ ' + (lastError || 'Salvataggio non riuscito.')); return; }
      data = d.dungeon; dirty = false;
      const fresh = (data.dungeons||[]).find(x=>x.id===d.id);
      dg = fresh ? clone(fresh) : dg; if(dg) delete dg.run;
      msg = '✅ Dungeon salvato.'; render();
    };
    const del = document.getElementById('dge-del');
    if(del) del.onclick = async ()=>{
      if(dg._new){ dg = null; dirty = false; render(); return; }
      if(!window.confirm(`Eliminare definitivamente "${dg.name}"?`)) return;
      const d = await post({ resource:'dungeon', code: session.code, username: session.username, op:'deleteDef', id: dg.id });
      if(!d){ setMsg('⚠ ' + (lastError || 'Eliminazione non riuscita.')); return; }
      data = d.dungeon; dg = null; dirty = false; msg = 'Dungeon eliminato.'; render();
    };
  }

  window.DungeonEditor = {
    async mount(el, sess){
      root = el; session = sess;
      root.innerHTML = '<div class="muted">Caricamento dungeon…</div>';
      await load();
      render();
    },
    hasUnsavedChanges(){ return !!dirty; }
  };
})();
