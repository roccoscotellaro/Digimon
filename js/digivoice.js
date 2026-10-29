// js/digivoice.js
// "Voci dei Digimon" (richiesta Rocco 2026-10-29): rendere centrale la voce dei Digimon partner.
//
// GIOCATORE — bottone "💭 Chiedi parere a <Digimon>" sotto la chat. NON pubblica nulla: manda una
//   richiesta al Master (api/log.js, resource=digivoice; una sola richiesta aperta per giocatore) con
//   la chat da cui è partita. Se nel campo di scrittura c'è del testo, diventa la domanda.
//
// MASTER — scheda "💭 Voci dei Digimon" in cima alla Chat, visibile solo quando c'è qualcosa:
//   - le richieste dei giocatori;
//   - i promemoria a messaggi: se il Digimon di un giocatore non parla da N messaggi della Chat
//     Generale (nel luogo dove si trova il giocatore), il sistema propone una sua battuta spontanea —
//     così il Master si ricorda di far parlare TUTTI i Digimon (richiesta Rocco 2026-10-29: "dopo un
//     tot di messaggi, in modo tale da ricordarmi di far parlare tutti i digimon").
//   Per ognuna l'IA (api/ai.js, mode 'voce-digimon') prepara 3 battute coerenti con personalità e
//   Stage del Digimon e con gli ultimi messaggi della chat giusta. Il Master ne sceglie una, la può
//   ritoccare o scriverne una sua, sceglie la chat e pubblica: il messaggio esce a nome del Digimon
//   (stesso role 'digimon', colore e ritratto del "Parla come" già esistente).
//   La soglia si regola dalla scheda (mai / 10 / 15 / 20 / 30 / 50 messaggi) ed è salvata su questo
//   dispositivo. I promemoria vivono solo sul dispositivo del Master (non sul server).
//
// Script classico caricato prima del blocco principale di index.html. Usa i globali di js/store.js
// (session, cachedRoster, cachedLog, cachedSubgroups, cachedCombat), js/api.js (apiPost, lastApiError),
// js/util.js (escapeHTML, escapeAttr, displayName) e js/chat-log-engine.js (pushLog, pushPrivateLog,
// getPrivateLog, deleteLogEntry, memberLocationKey, subgroupLocationKey, normalizeLocationKey).

const DIGIVOICE_THREAD = '__digivoice'; // stesso valore di api/log.js
const DIGIVOICE_IDLE_KEY = 'dvos_digivoice_after_msgs';
const DIGIVOICE_IDLE_OPTIONS = [0,10,15,20,30,50];

// ---------- utilità comuni ----------
function digivoiceCanSpeak(member){
  return !!(member && member.role==='player' && member.digimon && member.digimon.name && member.digimon.approved!==false);
}
function digivoiceName(member){ return (member && member.digimon && member.digimon.name) || 'Digimon'; }
function __dvTs(entry){ const t = entry && entry.ts ? Date.parse(entry.ts) : NaN; return isNaN(t) ? 0 : t; }
function __dvCleanText(t){ const s = String(t||''); const i = s.indexOf('::'); return (i>=0 ? s.slice(0,i) : s).replace(/\s+/g,' ').trim(); }

// =====================================================================
// GIOCATORE
// =====================================================================
let __dvAskCooldownUntil = 0;
function digivoiceAskButtonHTML(me){
  if(!digivoiceCanSpeak(me)) return '';
  return `<button type="button" class="btn ghost small digivoice-ask-btn" id="btn-digivoice-ask" title="Il Master sceglierà cosa risponde ${escapeAttr(digivoiceName(me))}. Se hai scritto qualcosa nel campo, diventa la tua domanda.">💭 Chiedi parere a ${escapeHTML(digivoiceName(me))}</button>`;
}
// getChat: funzione che restituisce { chat:'general'|'private'|'subgroup', group } della chat aperta.
function bindDigivoiceAsk(code, getMe, getChat){
  const btn = document.getElementById('btn-digivoice-ask');
  if(!btn) return;
  btn.onclick = async ()=>{
    const me = getMe();
    if(!digivoiceCanSpeak(me)) return;
    const hint = document.getElementById('action-hint');
    if(Date.now() < __dvAskCooldownUntil){
      if(hint) hint.innerHTML = `💭 Hai già chiesto a ${escapeHTML(digivoiceName(me))}: aspetta la sua risposta in chat.`;
      return;
    }
    const ta = document.getElementById('action-text');
    const question = ta ? ta.value.trim() : '';
    const where = getChat() || { chat:'general', group:null };
    btn.disabled = true;
    const res = await apiPost('/api/log?resource=digivoice', {
      code, username: session.username, who: displayName(me), digimonName: digivoiceName(me),
      chat: where.chat, group: where.group || null, question
    });
    btn.disabled = false;
    if(!res || !res.ok){
      if(hint) hint.innerHTML = `<span style="color:var(--danger);">⚠ Richiesta non inviata: ${escapeHTML(lastApiError || 'riprova')}</span>`;
      return;
    }
    if(ta && question) ta.value = '';
    __dvAskCooldownUntil = Date.now() + 45000;
    if(hint) hint.innerHTML = res.already
      ? `💭 Domanda aggiornata: ${escapeHTML(digivoiceName(me))} risponderà a breve in chat.`
      : `💭 Hai chiesto il parere di ${escapeHTML(digivoiceName(me))}: risponderà a breve in chat.`;
  };
}

// =====================================================================
// MASTER
// =====================================================================
const __dvItems = new Map();      // key -> proposta (vedi __dvNewItem)
// username -> id dell'ultimo messaggio di Chat Generale al momento in cui il Master ha fatto parlare
// quel Digimon da qui (anche in Privata/Gruppo) o ha scartato il promemoria: il conteggio riparte da lì.
const __dvMark = {};
let __dvCode = null;
let __dvOnChanged = null;      // refreshLiveParts di index.html (passata da digivoiceTick)

function digivoiceIdleMessages(){
  let v = 15;
  try{ const s = localStorage.getItem(DIGIVOICE_IDLE_KEY); if(s!==null) v = Number(s); }catch(e){}
  return DIGIVOICE_IDLE_OPTIONS.includes(v) ? v : 15;
}
function __dvSetIdleMessages(v){
  try{ localStorage.setItem(DIGIVOICE_IDLE_KEY, String(v)); }catch(e){}
}
function __dvLastGeneralId(){
  const log = cachedLog || [];
  return log.length ? Number(log[log.length-1].id) || 0 : 0;
}

function __dvNewItem(fields){
  return Object.assign({ lines:null, loading:false, error:'', selected:-1, draft:'', dest:null, createdAt:Date.now() }, fields);
}

// Ultimi messaggi della chat di destinazione, per dare all'IA il contesto giusto.
async function __dvContext(member, dest){
  let list = [];
  try{
    if(dest.chat==='private') list = await getPrivateLog(__dvCode, member.username);
    else if(dest.chat==='subgroup' && dest.group) list = await getPrivateLog(__dvCode, 'subgroup:'+dest.group);
    else {
      list = cachedLog || [];
      // In Chat Generale contano i messaggi del luogo dove si trova il giocatore.
      const key = normalizeLocationKey(memberLocationKey(member));
      const here = list.filter(l=>!l.meta || !l.meta.location || normalizeLocationKey(l.meta.location)===key);
      if(here.length) list = here;
    }
  }catch(e){ list = cachedLog || []; }
  return list.filter(l=>l.role!=='moverequest' && l.role!=='loot')
    .slice(-14)
    .map(l=>`${l.who}: ${__dvCleanText(l.text).slice(0,240)}`)
    .filter(s=>!/:\s*$/.test(s))
    .join('\n');
}

// Le proposte si generano UNA alla volta (coda): con molti Digimon in attesa, chiamate tutte insieme
// rischiavano di rallentarsi a vicenda o di superare i limiti dell'IA. Ogni richiesta ha un tempo
// massimo: se l'IA non risponde, compare l'avviso e si può riprovare con 🔄 o scrivere a mano.
const DV_AI_TIMEOUT_MS = 35000;
const __dvQueue = [];
let __dvBusy = false;
function __dvGenerate(item){
  if(!__dvQueue.includes(item)) __dvQueue.push(item);
  item.loading = true; item.error = '';
  __dvRender(true);
  __dvPump();
}
async function __dvPump(){
  if(__dvBusy) return;
  __dvBusy = true;
  try{
    while(__dvQueue.length){
      const item = __dvQueue.shift();
      if(!__dvItems.has(item.key)) continue; // scartata nel frattempo
      try{ await __dvGenerateNow(item); }
      catch(e){ item.loading = false; item.error = 'Errore: ' + (e && e.message || e) + ' — scrivi la battuta a mano o riprova con 🔄.'; }
      __dvRender(true);
    }
  } finally { __dvBusy = false; }
}
async function __dvGenerateNow(item){
  const member = (cachedRoster||[]).find(m=>m.username===item.username);
  if(!member){ item.loading = false; item.error = 'Giocatore non trovato.'; return; }
  const context = await __dvContext(member, item.dest);
  const timeout = new Promise(resolve=>setTimeout(()=>resolve('__timeout'), DV_AI_TIMEOUT_MS));
  const d = await Promise.race([apiPost('/api/ai', {
    mode:'voce-digimon', kind:item.kind,
    digimonName: digivoiceName(member), species: member.digimon.species || '', stage: member.digimon.stage || '',
    personality: member.digimon.personality || '', tamerName: displayName(member),
    question: item.question || '', context
  }), timeout]);
  item.loading = false;
  if(d && d!=='__timeout' && Array.isArray(d.lines) && d.lines.length){
    item.lines = d.lines;
    if(item.selected<0 && !item.draft){ item.selected = 0; item.draft = d.lines[0]; }
  } else if(d==='__timeout'){
    item.error = 'L\'IA ci sta mettendo troppo: riprova con 🔄 o scrivi la battuta a mano.';
  } else {
    item.error = 'IA non disponibile (' + (lastApiError || 'nessuna risposta') + '): riprova con 🔄 o scrivi la battuta a mano.';
  }
}

// Quanti messaggi della Chat Generale sono passati dall'ultima volta che il Digimon di questo
// giocatore ha parlato. Contano solo i messaggi del luogo in cui si trova il giocatore (chi è
// altrove non li vive), esclusi gli avvisi di Sistema, la Cronaca del Combattimento, gli inviti di
// spostamento, il bottino e le battute degli altri Digimon.
function __dvMessagesSince(member){
  const log = cachedLog || [];
  const name = digivoiceName(member);
  const key = normalizeLocationKey(memberLocationKey(member));
  const fromId = __dvMark[member.username] || 0;
  let count = 0;
  for(let i=log.length-1; i>=0; i--){
    const l = log[i];
    if(Number(l.id) <= fromId) break;
    if(l.role==='digimon' && ((l.meta && l.meta.digimonOf===member.username) || l.who===name)) break;
    if(l.role==='digimon' || l.who==='Sistema' || l.role==='moverequest' || l.role==='loot') continue;
    if(typeof isCombatLogEntry==='function' && isCombatLogEntry(l)) continue;
    if(l.meta && l.meta.location && normalizeLocationKey(l.meta.location)!==key) continue;
    count++;
  }
  return count;
}

// Promemoria: propone una battuta per il Digimon rimasto zitto per più messaggi (oltre la soglia).
// Fuori dai combattimenti. Compaiono TUTTI i Digimon oltre la soglia (richiesta Rocco 2026-10-29).
function __dvIdleCheck(){
  const threshold = digivoiceIdleMessages();
  if(!threshold) return;
  if(cachedCombat && cachedCombat.active) return;
  const due = [];
  (cachedRoster||[]).filter(digivoiceCanSpeak).forEach(m=>{
    if(Array.from(__dvItems.values()).some(i=>i.kind==='ask' && i.username===m.username)) return;
    const n = __dvMessagesSince(m);
    const existing = __dvItems.get('idle:'+m.username);
    if(existing){ existing.silentMessages = n; return; } // aggiorna il contatore mostrato
    if(n >= threshold) due.push({ m, n });
  });
  // Chi tace da più messaggi va per primo (anche nella coda dell'IA).
  due.sort((a,b)=>b.n-a.n).forEach(({ m, n })=>{
    const item = __dvNewItem({ key:'idle:'+m.username, kind:'idle', username:m.username, silentMessages: n, dest:{ chat:'general', group:null } });
    __dvItems.set(item.key, item);
    __dvGenerate(item);
  });
}

// Chiamata dal polling del Master (refreshLiveParts in index.html) e all'apertura della pagina.
async function digivoiceTick(code, onChanged){
  if(!session || session.role!=='master') return;
  __dvCode = code;
  if(onChanged) __dvOnChanged = onChanged;
  let rows = null;
  try{ rows = await getPrivateLog(code, DIGIVOICE_THREAD); }catch(e){ rows = null; }
  if(Array.isArray(rows)){
    const seen = new Set();
    rows.forEach(r=>{
      if(!r.meta || !r.meta.username) return;
      const key = 'ask:'+r.id;
      seen.add(key);
      const existing = __dvItems.get(key);
      if(existing){
        // Il giocatore ha aggiornato la domanda: rigeneriamo le proposte.
        if((r.meta.question||'') !== (existing.question||'')){ existing.question = r.meta.question||''; existing.lines = null; existing.selected = -1; existing.draft = ''; __dvGenerate(existing); }
        return;
      }
      // Una richiesta del giocatore sostituisce un'eventuale proposta del timer per lo stesso Digimon.
      __dvItems.delete('idle:'+r.meta.username);
      const item = __dvNewItem({ key, kind:'ask', rowId:r.id, username:r.meta.username, question:r.meta.question||'', dest:{ chat:r.meta.chat||'general', group:r.meta.group||null }, createdAt: __dvTs(r) || Date.now() });
      __dvItems.set(key, item);
      __dvGenerate(item);
    });
    // Richieste chiuse da un altro dispositivo del Master: spariscono anche qui.
    Array.from(__dvItems.keys()).forEach(k=>{ if(k.startsWith('ask:') && !seen.has(k)) __dvItems.delete(k); });
  }
  __dvIdleCheck();
  __dvRender(true);
}

function __dvDestOptions(member, dest){
  const groups = (cachedSubgroups||[]).filter(g=>(g.members||[]).includes(member.username));
  const opts = [
    { v:'general', label:'📣 Chat Generale' },
    { v:'private', label:`✉️ Privata di ${displayName(member)}` }
  ].concat(groups.map(g=>({ v:'subgroup:'+g.id, label:`👥 ${g.name}` })));
  const cur = dest.chat==='subgroup' ? 'subgroup:'+dest.group : dest.chat;
  if(dest.chat==='subgroup' && !groups.some(g=>g.id===dest.group)) opts.push({ v:cur, label:'👥 Sottogruppo' });
  return opts.map(o=>`<option value="${escapeAttr(o.v)}" ${o.v===cur?'selected':''}>${escapeHTML(o.label)}</option>`).join('');
}

let __dvRenderedSig = '';
// Quale Digimon è aperto nella fila di icone (richiesta Rocco 2026-10-29: "c'è lo scorrimento e
// non si vedono subito: metti i Digimon in icona e cliccandoci si apre"). null = tutti chiusi.
let __dvOpenKey = null;
function __dvRender(fromPoll){
  const card = document.getElementById('digivoice-card');
  if(!card) return;
  // Se un aggiornamento è stato rimandato perché il Master stava scrivendo, lo facciamo appena esce.
  if(!card.dataset.dvFocusBound){
    card.dataset.dvFocusBound = '1';
    card.addEventListener('focusout', ()=> setTimeout(()=>{ if(!card.contains(document.activeElement)) __dvRender(true); }, 0));
  }
  const items = Array.from(__dvItems.values()).sort((a,b)=> a.kind!==b.kind ? (a.kind==='ask' ? -1 : 1) : (a.kind==='idle' ? (b.silentMessages||0)-(a.silentMessages||0) : a.createdAt-b.createdAt));
  // Dal polling: non ridisegnare mentre il Master sta scrivendo/scegliendo dentro la scheda.
  if(__dvOpenKey && !__dvItems.has(__dvOpenKey)) __dvOpenKey = null;
  const sig = items.map(i=>i.key+(i.loading?'L':'')+(i.lines?i.lines.length:0)+i.error+(i.question||'')+'/'+(i.silentMessages||0)).join('|') + '#' + digivoiceIdleMessages() + '@' + (__dvOpenKey||'');
  if(fromPoll){
    const ae = document.activeElement;
    if(sig===__dvRenderedSig || (ae && card.contains(ae) && /^(TEXTAREA|SELECT|INPUT)$/.test(ae.tagName))) return;
  }
  __dvRenderedSig = sig;
  const threshold = digivoiceIdleMessages();
  const hasPlayers = (cachedRoster||[]).some(digivoiceCanSpeak);
  card.style.display = hasPlayers ? '' : 'none';
  card.classList.toggle('has-items', items.length>0);
  const header = `<div class="flex-between" style="align-items:center;gap:8px;flex-wrap:wrap;">
      <div class="section-title" style="margin:0;border:none;padding:0;">💭 Voci dei Digimon${items.length?` <span class="digivoice-count">${items.length}</span>`:''}</div>
      <label class="muted digivoice-timer" title="Promemoria: se il Digimon di un giocatore non parla per questo numero di messaggi in Chat Generale, qui compare una sua battuta da proporre">🔔 ricordami dopo
        <select id="digivoice-idle">${DIGIVOICE_IDLE_OPTIONS.map(v=>`<option value="${v}" ${v===threshold?'selected':''}>${v?v+' messaggi':'mai (spento)'}</option>`).join('')}</select></label>
    </div>`;
  if(!items.length){
    // Niente in attesa: resta una riga sola, per non togliere spazio alla Chat.
    card.innerHTML = header;
  } else {
    // Fila di icone: un ritratto per ogni Digimon in attesa (💭 = richiesta del giocatore, numero =
    // messaggi di silenzio). Un tocco apre sotto il suo pannello, un altro tocco lo richiude.
    const icons = items.map(item=>{
      const m = (cachedRoster||[]).find(x=>x.username===item.username);
      if(!m) return '';
      const dn = digivoiceName(m);
      const tip = item.kind==='ask' ? `${displayName(m)} chiede il parere di ${dn}` : `${dn} non parla da ${item.silentMessages||0} messaggi`;
      const pic = m.digimon.imageUrl ? `<img src="${escapeAttr(m.digimon.imageUrl)}" alt="" onerror="this.replaceWith(document.createTextNode('👾'))" />` : '👾';
      const badge = item.kind==='ask' ? '💭' : (item.silentMessages>99 ? '99+' : String(item.silentMessages||0));
      return `<button type="button" class="digivoice-icon ${item.kind}${item.key===__dvOpenKey?' open':''}${item.lines&&!item.loading?' ready':''}" data-dv-open="${escapeAttr(item.key)}" title="${escapeAttr(tip)}" aria-label="${escapeAttr(tip)}">
        <span class="digivoice-icon-pic">${pic}</span><span class="digivoice-icon-badge">${escapeHTML(badge)}</span><span class="digivoice-icon-name">${escapeHTML(dn)}</span>
      </button>`;
    }).join('');
    const openItem = __dvOpenKey ? __dvItems.get(__dvOpenKey) : null;
    const om = openItem ? (cachedRoster||[]).find(x=>x.username===openItem.username) : null;
    let panel = '';
    if(openItem && om){
      const item = openItem, m = om, dn = digivoiceName(m);
      const title = item.kind==='ask'
        ? `<b>${escapeHTML(displayName(m))}</b> chiede il parere di <b>${escapeHTML(dn)}</b>`
        : `<b>${escapeHTML(dn)}</b> non parla da ${item.silentMessages||digivoiceIdleMessages()} messaggi`;
      panel = `<div class="digivoice-item ${item.kind}" data-dv-key="${escapeAttr(item.key)}">
        <div class="digivoice-head"><div style="flex:1;min-width:0;">${title}${item.question?`<div class="digivoice-q">“${escapeHTML(item.question)}”</div>`:''}</div></div>
        ${item.loading ? `<div class="muted" style="font-size:11px;margin:6px 0;">✨ ${escapeHTML(dn)} ci sta pensando...${__dvQueue.indexOf(item)>0 ? ' (in coda)' : ''}</div>` : ''}
        ${item.error ? `<div class="muted" style="font-size:11px;margin:6px 0;color:var(--amber);">${escapeHTML(item.error)}</div>` : ''}
        ${item.lines ? `<div class="digivoice-lines">${item.lines.map((l,i)=>`<button type="button" class="digivoice-line${i===item.selected?' on':''}" data-dv-line="${i}">${escapeHTML(l)}</button>`).join('')}</div>` : ''}
        <textarea class="digivoice-draft" rows="2" placeholder="Scegli una proposta o scrivi tu cosa dice ${escapeAttr(dn)}...">${escapeHTML(item.draft||'')}</textarea>
        <div class="digivoice-actions">
          <select class="digivoice-dest" title="Dove pubblicare">${__dvDestOptions(m, item.dest)}</select>
          <button type="button" class="btn amber small" data-dv-publish>📣 Pubblica</button>
          <button type="button" class="btn ghost small" data-dv-regen ${item.loading?'disabled':''} title="Altre 3 proposte">🔄</button>
          <button type="button" class="btn ghost small" data-dv-dismiss title="${item.kind==='ask'?'Chiudi la richiesta senza rispondere':'Salta: il conteggio dei messaggi riparte da zero'}">✕</button>
        </div>
      </div>`;
    }
    card.innerHTML = header + `<div class="digivoice-icons">${icons}</div>` + panel;
    card.querySelectorAll('[data-dv-open]').forEach(b=>{
      b.onclick = ()=>{ const k = b.getAttribute('data-dv-open'); __dvOpenKey = (__dvOpenKey===k) ? null : k; __dvRender(); };
    });
  }
  const idleSel = document.getElementById('digivoice-idle');
  if(idleSel) idleSel.onchange = ()=>{ __dvSetIdleMessages(Number(idleSel.value)); idleSel.blur(); __dvIdleCheck(); __dvRender(); };
  card.querySelectorAll('.digivoice-item').forEach(row=>{
    const item = __dvItems.get(row.getAttribute('data-dv-key'));
    if(!item) return;
    const draft = row.querySelector('.digivoice-draft');
    draft.oninput = ()=>{ item.draft = draft.value; item.selected = -1; row.querySelectorAll('.digivoice-line').forEach(b=>b.classList.remove('on')); };
    row.querySelectorAll('[data-dv-line]').forEach(b=>{
      b.onclick = ()=>{
        item.selected = Number(b.getAttribute('data-dv-line'));
        item.draft = item.lines[item.selected];
        draft.value = item.draft;
        row.querySelectorAll('.digivoice-line').forEach(x=>x.classList.toggle('on', x===b));
      };
    });
    const destSel = row.querySelector('.digivoice-dest');
    destSel.onchange = ()=>{
      const v = destSel.value;
      item.dest = v.startsWith('subgroup:') ? { chat:'subgroup', group:v.slice(9) } : { chat:v, group:null };
    };
    row.querySelector('[data-dv-regen]').onclick = ()=>{ item.lines = null; item.selected = -1; __dvGenerate(item); };
    row.querySelector('[data-dv-dismiss]').onclick = async ()=>{
      __dvItems.delete(item.key);
      if(item.kind==='ask') await deleteLogEntry(__dvCode, item.rowId, DIGIVOICE_THREAD);
      else __dvMark[item.username] = __dvLastGeneralId(); // il conteggio riparte da qui
      __dvRender();
    };
    row.querySelector('[data-dv-publish]').onclick = async (ev)=>{
      const text = (draft.value||'').trim();
      if(!text){ draft.focus(); return; }
      const btn = ev.currentTarget;
      btn.disabled = true;
      const ok = await digivoicePublish(item, text);
      if(!ok){ btn.disabled = false; return; }
      __dvItems.delete(item.key);
      __dvRender();
      if(__dvOnChanged) __dvOnChanged();
    };
  });
}

// Pubblica la battuta a nome del Digimon nella chat scelta (stesso formato del "Parla come").
async function digivoicePublish(item, text){
  const m = (cachedRoster||[]).find(x=>x.username===item.username);
  if(!m) return false;
  const meta = { digimonOf: m.username };
  if(m.digimon.imageUrl) meta.avatar = m.digimon.imageUrl;
  if(m.digimon.chatColor) meta.color = m.digimon.chatColor;
  if(item.kind==='ask' && item.question) meta.replyTo = { who: displayName(m), text: item.question.slice(0,140) };
  const entry = { who: digivoiceName(m), role:'digimon', text };
  let res;
  if(item.dest.chat==='private'){
    meta.location = memberLocationKey(m);
    res = await pushPrivateLog(__dvCode, m.username, Object.assign(entry, { meta }));
  } else if(item.dest.chat==='subgroup' && item.dest.group){
    const g = (cachedSubgroups||[]).find(x=>x.id===item.dest.group) || null;
    meta.location = subgroupLocationKey(g);
    res = await pushPrivateLog(__dvCode, 'subgroup:'+item.dest.group, Object.assign(entry, { meta }));
  } else {
    meta.location = memberLocationKey(m);
    res = await pushLog(__dvCode, Object.assign(entry, { meta }));
  }
  if(!res) return false;
  __dvMark[m.username] = __dvLastGeneralId(); // il conteggio dei messaggi riparte da qui
  if(item.kind==='ask') await deleteLogEntry(__dvCode, item.rowId, DIGIVOICE_THREAD);
  return true;
}
