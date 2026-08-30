// js/notices.js
// Cluster "Avvisi / Segnalazioni Bug / Log Bio-Resonance Scan": tre funzionalità indipendenti che
// condividono lo stesso pattern (endpoint /api/notice o /api/upload, un pannello Master che lista+
// gestisce, in un caso anche una coda di modali bloccanti lato giocatore) ma non si chiamano mai
// a vicenda — raggruppate in un solo file perché nessuna delle tre da sola vale un file a parte.
//
// - Avvisi: getNotices/createNotice/confirmNotice/closeNotice/deleteNotice, renderNoticeManager
//   (pannello Master), e la coda di modali bloccanti lato giocatore (noticeQueue/noticeModalOpen/
//   isNoticeForMe/isNoticeConfirmedByMe/checkNoticesForMe/showNextNotice/showNoticeContent, più il
//   suono di notifica __startNoticeSfx/__stopNoticeSfx/NOTICE_SFX_URL/__noticeAudioEl).
// - Segnalazioni Bug: getBugReports/createBugReport/resolveBugReport, renderBugReportsMaster
//   (pannello Master). Il form di invio lato giocatore, renderBugReportCard, resta in index.html
//   (sezione Scheda Tamer) — chiama semplicemente createBugReport, ora globale, nessun cambiamento.
// - Log Bio-Resonance Scan: getScanLog/deleteScanEntry, renderScanLogMaster (pannello Master).
//
// Nessuna di queste funzioni tocca refreshLiveParts()/maybeNotifyNew() (a differenza della Chat
// Privata in fase 9): non serve quindi il parametro onChanged/notify — restano firme identiche a
// prima, spostate cosi' come sono.
//
// Script classico (non un modulo ES), caricato PRIMA del blocco <script> principale in index.html,
// dopo js/store.js/js/api.js/js/util.js (di cui usa session/cachedRoster, apiGet/apiPost/apiPut/
// apiDelete/lastApiError, escapeHTML/escapeAttr/displayName/displayNameFor) e dopo
// js/chat-composer.js (chatAttachHTML/bindChatAttach, usate da renderNoticeManager per l'allegato
// immagine di un Avviso).

  // ---------- Avvisi (notice) ----------
  async function getNotices(code){ const d = await apiGet('/api/notice?code=' + encodeURIComponent(code), true); return d ? (d.notices||[]) : []; }
  async function createNotice(code, { text, imageUrl, targetType, targetUsernames, createdBy }){
    return apiPost('/api/notice', { code, text, imageUrl, targetType, targetUsernames, createdBy });
  }
  async function confirmNotice(code, id, username){ return apiPut('/api/notice', { code, id, ack: username }); }
  async function closeNotice(code, id){ return apiPut('/api/notice', { code, id, deactivate: true }); }
  async function deleteNotice(code, id){ return apiDelete('/api/notice?code=' + encodeURIComponent(code) + '&id=' + encodeURIComponent(id)); }

  // ---------- Segnalazioni Bug ----------
  async function getBugReports(code){ const d = await apiGet('/api/notice?resource=bugreport&code=' + encodeURIComponent(code)); return d ? (d.reports||[]) : []; }
  async function createBugReport(code, username, text){ return apiPost('/api/notice', { resource:'bugreport', code, username, text }); }
  async function resolveBugReport(code, id, resolved){ return apiPut('/api/notice', { resource:'bugreport', code, id, resolved }); }

  // ---------- Log Bio-Resonance Scan ----------
  async function getScanLog(code){ const d = await apiGet('/api/upload?resource=scan&code=' + encodeURIComponent(code)); return d ? (d.allLog||[]) : []; }
  async function deleteScanEntry(code, id){ return apiDelete('/api/upload?resource=scan&code=' + encodeURIComponent(code) + '&id=' + encodeURIComponent(id)); }

  async function renderNoticeManager(code, players){
    const cardEl = document.getElementById('notice-mgr-card');
    if(!cardEl) return;
    const notices = await getNotices(code);
    const active = notices.filter(n=>n.active);
    const closedAll = notices.filter(n=>!n.active);
    const closed = closedAll.slice(0, 5);

    function targetDescHTML(n){
      if(n.target_type==='all') return 'Tutti i giocatori';
      const list = Array.isArray(n.target_usernames) ? n.target_usernames : [];
      return (n.target_type==='single' ? 'Solo: ' : 'Alcuni: ') + (list.length ? list.map(displayNameFor).join(', ') : '—');
    }
    function confirmProgressHTML(n){
      const targetUsers = n.target_type==='all' ? players.map(p=>p.username) : (n.target_usernames||[]);
      const confirmed = Array.isArray(n.acked_by) ? n.acked_by : [];
      const pending = targetUsers.filter(u=>!confirmed.includes(u));
      return `
        <div class="muted" style="margin-top:6px;font-size:11px;">
          ✔ Confermato: ${confirmed.length ? confirmed.map(displayNameFor).join(', ') : '—'}<br/>
          ⏳ In attesa: ${pending.length ? pending.map(displayNameFor).join(', ') : 'nessuno'}
        </div>`;
    }

    cardEl.innerHTML = `
      <div class="section-title">📢 Gestione Avvisi</div>
      <div class="muted" style="margin-bottom:10px;">Un Avviso blocca l'interfaccia (con un popup che va confermato per proseguire) solo per i destinatari scelti — gli altri giocatori continuano a giocare normalmente.</div>
      <textarea id="notice-text" rows="3" placeholder="Testo dell'avviso..."></textarea>
      ${chatAttachHTML('notice')}
      <div class="field" style="margin-top:10px;"><label>Destinatari</label>
        <select id="notice-target-type">
          <option value="all">Tutti i giocatori</option>
          <option value="some">Solo alcuni</option>
          <option value="single">Un solo giocatore</option>
        </select>
      </div>
      <div id="notice-target-players" style="display:none;margin-bottom:10px;"></div>
      <button class="btn solid" id="btn-send-notice" style="width:100%;">Invia Avviso</button>
      <div class="muted" id="notice-status" style="margin-top:6px;"></div>
      <div class="divider"></div>
      <div class="muted" style="font-size:10px;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px;">Avvisi attivi</div>
      ${active.length===0 ? '<div class="muted">Nessun avviso attivo.</div>' : active.map(n=>`
        <div class="roster-item" style="padding:8px;margin-bottom:6px;">
          <div class="flex-between"><b style="font-size:12px;">${targetDescHTML(n)}</b><button class="btn ghost small" data-notice-close="${n.id}">Chiudi</button></div>
          <div style="margin-top:4px;font-size:12px;white-space:pre-wrap;">${escapeHTML(n.text)}</div>
          ${confirmProgressHTML(n)}
        </div>
      `).join('')}
      ${closed.length ? `
      <div class="flex-between" style="margin:10px 0 6px;">
        <span class="muted" style="font-size:10px;text-transform:uppercase;letter-spacing:0.06em;">Storico recente (chiusi)</span>
        <button class="btn ghost small" id="btn-clear-notice-history" style="color:var(--danger);border-color:rgba(255,93,93,0.4);font-size:10px;padding:3px 8px;">🗑 Cancella storico</button>
      </div>
      ${closed.map(n=>`<div class="flex-between muted" style="font-size:11px;margin-bottom:4px;gap:6px;"><span>• ${escapeHTML((n.text||'').slice(0,60))}${(n.text||'').length>60?'…':''} — ${targetDescHTML(n)}</span><button class="btn ghost small" data-notice-delete="${n.id}" style="padding:1px 6px;flex-shrink:0;" title="Cancella questo avviso dallo storico">✕</button></div>`).join('')}
      ` : ''}
    `;

    let pendingNoticeImageUrl = null;
    bindChatAttach('notice', code, 'avvisi', ()=>pendingNoticeImageUrl, (url)=>{ pendingNoticeImageUrl = url; });

    // "Un solo giocatore" ora usa veri <input type="radio"> (stesso `name`, quindi il browser
    // stesso garantisce che al massimo uno sia selezionato) invece di checkbox con un click
    // handler in JS che provava a de-selezionare gli altri manualmente: su touchscreen quel
    // pattern è fragile (un tap può non registrarsi come "click" in tempo, o due tap ravvicinati
    // possono lasciare più caselle spuntate), ed era la causa più probabile del bug per cui un
    // Avviso "a un solo giocatore" finiva selezionato per più persone di quelle volute. Con un
    // vero radio group la cosa è semplicemente impossibile, indipendentemente dal dispositivo.
    function noticeTargetPlayersHTML(mode){
      const inputType = mode==='single' ? 'radio' : 'checkbox';
      const nameAttr = mode==='single' ? ' name="notice-target-radio"' : '';
      return players.map(p=>`<label style="display:flex;align-items:center;gap:6px;font-size:12px;margin-bottom:4px;"><input type="${inputType}"${nameAttr} class="notice-target-player" value="${escapeAttr(p.username)}" /> ${escapeHTML(displayName(p))}</label>`).join('') || '<div class="muted">Nessun giocatore in roster.</div>';
    }

    const targetSel = document.getElementById('notice-target-type');
    targetSel.onchange = ()=>{
      const wrap = document.getElementById('notice-target-players');
      wrap.style.display = targetSel.value==='all' ? 'none' : 'block';
      if(targetSel.value!=='all') wrap.innerHTML = noticeTargetPlayersHTML(targetSel.value);
    };

    document.getElementById('btn-send-notice').onclick = async ()=>{
      const text = document.getElementById('notice-text').value.trim();
      const statusEl = document.getElementById('notice-status');
      if(!text){ statusEl.textContent = 'Scrivi un testo per l\'avviso.'; statusEl.style.color='var(--danger)'; return; }
      const targetType = targetSel.value;
      const targetUsernames = targetType==='all' ? [] : Array.from(cardEl.querySelectorAll('.notice-target-player:checked')).map(cb=>cb.value);
      if(targetType!=='all' && targetUsernames.length===0){ statusEl.textContent = 'Seleziona almeno un destinatario.'; statusEl.style.color='var(--danger)'; return; }
      if(targetType==='single' && targetUsernames.length>1){ statusEl.textContent = 'Per "Un solo giocatore" seleziona un solo nome.'; statusEl.style.color='var(--danger)'; return; }
      statusEl.style.color='var(--text-mute)'; statusEl.textContent = 'Invio...';
      const res = await createNotice(code, { text, imageUrl: pendingNoticeImageUrl, targetType, targetUsernames, createdBy: session.username });
      if(res && res.ok){
        statusEl.style.color='var(--cyan)'; statusEl.textContent = 'Avviso inviato.';
        pendingNoticeImageUrl = null;
        renderNoticeManager(code, players);
      } else {
        statusEl.style.color='var(--danger)'; statusEl.textContent = 'Errore: ' + (lastApiError||'sconosciuto');
      }
    };

    cardEl.querySelectorAll('[data-notice-close]').forEach(btn=>{
      btn.onclick = async ()=>{
        if(!window.confirm('Chiudere questo avviso? Chi non ha ancora confermato non lo vedrà più.')) return;
        await closeNotice(code, btn.getAttribute('data-notice-close'));
        renderNoticeManager(code, players);
      };
    });
    cardEl.querySelectorAll('[data-notice-delete]').forEach(btn=>{
      btn.onclick = async ()=>{
        if(!window.confirm('Cancellare definitivamente questo avviso dallo storico? Non si può annullare.')) return;
        await deleteNotice(code, btn.getAttribute('data-notice-delete'));
        renderNoticeManager(code, players);
      };
    });
    const clearHistBtn = document.getElementById('btn-clear-notice-history');
    if(clearHistBtn){
      clearHistBtn.onclick = async ()=>{
        if(!window.confirm(`Cancellare tutto lo storico avvisi chiusi (${closedAll.length} voci)? Non si può annullare.`)) return;
        await Promise.all(closedAll.map(n=>deleteNotice(code, n.id)));
        renderNoticeManager(code, players);
      };
    }
  }

  async function renderBugReportsMaster(code){
    const cardEl = document.getElementById('bugreports-card');
    if(!cardEl) return;
    const reports = await getBugReports(code);
    const open = reports.filter(r=>!r.resolved);
    const resolved = reports.filter(r=>r.resolved);
    cardEl.innerHTML = `
      <div class="flex-between" style="margin-bottom:6px;">
        <div class="section-title" style="margin:0;border:none;padding:0;">🐞 Bug Segnalati</div>
        ${open.length ? `<span class="tag" style="background:var(--danger);color:#fff;padding:2px 8px;border-radius:10px;font-size:10px;">${open.length} aperte</span>` : ''}
      </div>
      ${open.length===0 ? '<div class="muted">Nessuna segnalazione aperta.</div>' : open.map(r=>`
        <div class="roster-item" style="padding:8px;margin-bottom:6px;">
          <div class="flex-between"><b style="font-size:12px;">${escapeHTML(displayNameFor(r.username)||'anonimo')}</b><button class="btn ghost small" data-bug-resolve="${r.id}">Segna risolto</button></div>
          <div style="margin-top:4px;font-size:12px;white-space:pre-wrap;">${escapeHTML(r.text)}</div>
          <div class="muted" style="font-size:10px;margin-top:4px;">${new Date(r.created_at).toLocaleString('it-IT')}</div>
        </div>
      `).join('')}
      ${resolved.length ? `
      <div class="muted" style="font-size:10px;text-transform:uppercase;letter-spacing:0.06em;margin:10px 0 6px;">Risolte (${resolved.length})</div>
      ${resolved.slice(0,8).map(r=>`<div class="muted" style="font-size:11px;margin-bottom:4px;">✔ ${escapeHTML((r.text||'').slice(0,70))}${(r.text||'').length>70?'…':''}</div>`).join('')}
      ` : ''}
    `;
    cardEl.querySelectorAll('[data-bug-resolve]').forEach(btn=>{
      btn.onclick = async ()=>{
        await resolveBugReport(code, btn.getAttribute('data-bug-resolve'), true);
        renderBugReportsMaster(code);
      };
    });
  }

  // ---------- LOG BIO-RESONANCE SCAN (vista Master) ----------
  // Mostra a chi è stato assegnato ogni Digimon (e Crest, se il Tamer aveva il Digimedaglione),
  // con data/ora e numero del tentativo. Il Master può cancellare una riga per correggere un
  // errore, liberare un nome "preso" per errore, o restituire un tentativo a un giocatore.
  async function renderScanLogMaster(code){
    const cardEl = document.getElementById('scan-log-card');
    if(!cardEl) return;
    const log = await getScanLog(code);
    const rowsHTML = log.length === 0
      ? '<div class="muted">Nessuna scansione registrata finora per questa campagna.</div>'
      : log.slice().reverse().map(l => {
          // Il bottone "Applica" resta nascosto SOLO se quel Tamer ha già un nome DIVERSO impostato
          // (per non rischiare di sovrascrivere una creazione in corso non collegata a questo scan).
          // Se il nome è lo stesso di questa riga (o manca del tutto), il bottone c'è sempre: la
          // Wizard/applyDexMatchIfNeeded riempiono solo i campi ancora vuoti/di default, senza
          // toccare quelli che il giocatore ha già personalizzato — quindi è sicuro anche per
          // "completare" una scheda a metà, non solo per crearne una da zero.
          const member = cachedRoster.find(m=>m.username===l.username);
          const currentName = member && member.digimon && member.digimon.name ? member.digimon.name.trim() : '';
          const sameName = currentName && currentName.toLowerCase() === (l.digimon_name||'').trim().toLowerCase();
          const blockedByDifferentSheet = currentName && !sameName;
          const btnLabel = currentName ? '🔧 Completa Scheda (riempie i vuoti)' : '📤 Applica alla Scheda';
          return `
          <div class="row" style="align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--line);font-size:12px;">
            <div>
              <b>${escapeHTML(member ? displayName(member) : l.username)}</b> <span class="muted">— tentativo ${l.attempt_number}/2</span><br/>
              <span class="mono">${escapeHTML(l.digimon_name)}</span>${l.crest_name ? ` <span class="muted">· Crest: ${escapeHTML(l.crest_name)}</span>` : ''}${l.digimental_name ? ` <span class="muted">· ${escapeHTML(l.digimental_name)}</span>` : ''}
              <div class="muted" style="font-size:10px;">${new Date(l.created_at).toLocaleString('it-IT')}</div>
            </div>
            <div style="display:flex;gap:4px;">
              ${blockedByDifferentSheet ? `<span class="tag" style="font-size:10px;" title="Questo Tamer ha già un Digimon diverso (${escapeAttr(currentName)}) sulla scheda: per non sovrascriverlo per sbaglio, il bottone Applica resta nascosto.">Scheda diversa già creata</span>` : `<button class="btn small" data-scan-push="${escapeAttr(l.username)}" data-scan-push-name="${escapeAttr(l.digimon_name)}" title="Apre la Creazione Guidata per questo Tamer, pre-compilata con questo Digimon — riempie solo Stat/Attributo/Qualities ancora vuoti, non tocca quello che il giocatore ha già personalizzato.">${btnLabel}</button>`}
              <button class="btn ghost small" data-scan-del="${escapeAttr(l.id)}" title="Cancella questa riga (libera il nome e restituisce il tentativo)">✕</button>
            </div>
          </div>
        `;}).join('');
    cardEl.innerHTML = `
      <div class="section-title">Log Bio-Resonance Scan</div>
      <div class="muted" style="margin-bottom:8px;">Ogni Digimon può uscire ad un solo Tamer per campagna; ogni Tamer ha 2 tentativi. Cancella una riga per correggere un errore, liberare un nome o restituire un tentativo. "📤 Applica alla Scheda" apre la Creazione Guidata già pre-compilata per quel Tamer, se non l'ha ancora fatto lui stesso.</div>
      <div id="scan-log-rows">${rowsHTML}</div>
    `;
    cardEl.querySelectorAll('[data-scan-push]').forEach(btn=>{
      btn.onclick = ()=>{
        const username = btn.getAttribute('data-scan-push');
        const name = btn.getAttribute('data-scan-push-name');
        const params = new URLSearchParams({ prefillName: name, prefillTargetUsername: username });
        window.open('digimon.html?' + params.toString(), '_blank');
      };
    });
    cardEl.querySelectorAll('[data-scan-del]').forEach(btn=>{
      btn.onclick = async ()=>{
        if(!confirm('Cancellare questa riga del log? Il nome tornerà disponibile e il Tamer riavrà il tentativo.')) return;
        await deleteScanEntry(code, btn.getAttribute('data-scan-del'));
        renderScanLogMaster(code);
      };
    });
  }

  // ---------- Coda Avvisi bloccanti (vista giocatore) ----------
  let noticeQueue = [];
  let noticeModalOpen = false;
  let __noticeAudioEl = null;
  // Suono di notifica: parte quando compare il primo Avviso non ancora confermato e continua in
  // loop finché il giocatore non li accetta tutti (o rimuto). Non riparte da capo tra un Avviso e
  // l'altro nella stessa coda — un solo elemento riutilizzato, non un nuovo Audio() ogni volta.
  const NOTICE_SFX_URL = 'https://gsquzfhxgyqrnkrqdivc.supabase.co/storage/v1/object/public/campaign-audio/FRONTIER1/1787662152805_maxffk.mpeg';
  function __startNoticeSfx(){
    if(window.__dvosAudioPrefs && (window.__dvosAudioPrefs.clickMuted || window.__dvosAudioPrefs.musicMuted)) return;
    if(__noticeAudioEl && !__noticeAudioEl.paused) return;
    try{
      if(!__noticeAudioEl){ __noticeAudioEl = new Audio(NOTICE_SFX_URL); __noticeAudioEl.loop = true; __noticeAudioEl.volume = 0.5; }
      __noticeAudioEl.play().catch(()=>{});
    }catch(e){}
  }
  function __stopNoticeSfx(){
    if(__noticeAudioEl){ try{ __noticeAudioEl.pause(); __noticeAudioEl.currentTime = 0; }catch(e){} }
  }

  function isNoticeForMe(n){
    if(!session) return false;
    if(n.target_type==='all') return true;
    const list = Array.isArray(n.target_usernames) ? n.target_usernames : [];
    return list.includes(session.username);
  }
  function isNoticeConfirmedByMe(n){
    const acked = Array.isArray(n.acked_by) ? n.acked_by : [];
    return acked.includes(session.username);
  }

  async function checkNoticesForMe(){
    if(!session) return;
    const all = await getNotices(session.code);
    const mine = all.filter(n=>n.active && isNoticeForMe(n) && !isNoticeConfirmedByMe(n));
    mine.sort((a,b)=> new Date(a.created_at) - new Date(b.created_at));
    noticeQueue = mine;
    if(!noticeModalOpen && noticeQueue.length>0) showNextNotice();
    if(noticeQueue.length===0 && noticeModalOpen){
      noticeModalOpen = false;
      const old = document.getElementById('notice-modal');
      if(old) old.remove();
      __stopNoticeSfx();
    }
  }

  function showNextNotice(){
    if(noticeQueue.length===0){
      noticeModalOpen = false;
      const old = document.getElementById('notice-modal');
      if(old) old.remove();
      __stopNoticeSfx();
      return;
    }
    noticeModalOpen = true;
    const n = noticeQueue[0];
    const old = document.getElementById('notice-modal');
    if(old) old.remove();
    const modal = document.createElement('div');
    modal.id = 'notice-modal';
    modal.className = 'enc-modal-backdrop';
    modal.style.zIndex = '9999';
    // Passo 1 — solo un annuncio, niente suono ancora: i browser bloccano l'avvio automatico
    // dell'audio se non parte da un click diretto dell'utente (la notifica compare da sola via
    // polling, quindi far partire il suono qui verrebbe silenziosamente bloccato). Il click su
    // "Leggi ora" è un gesto reale e sblocca l'audio per il passo 2.
    modal.innerHTML = `
      <div class="hud-frame" style="max-width:420px;width:92vw;padding:26px;position:relative;text-align:center;">
        <div style="font-size:32px;margin-bottom:10px;">📢</div>
        <div class="section-title" style="margin-bottom:6px;justify-content:center;">Hai una nuova notifica${noticeQueue.length>1?` (${noticeQueue.length} in attesa)`:''}</div>
        <button class="btn solid" id="notice-open-btn" style="width:100%;padding:12px;margin-top:14px;">Leggi ora</button>
      </div>
    `;
    document.body.appendChild(modal);
    document.getElementById('notice-open-btn').onclick = ()=>{
      __startNoticeSfx();
      showNoticeContent(n);
    };
  }
  function showNoticeContent(n){
    const old = document.getElementById('notice-modal');
    if(old) old.remove();
    const modal = document.createElement('div');
    modal.id = 'notice-modal';
    modal.className = 'enc-modal-backdrop';
    modal.style.zIndex = '9999';
    modal.innerHTML = `
      <div class="hud-frame" style="max-width:480px;width:92vw;padding:22px;position:relative;">
        <div class="section-title" style="margin-bottom:14px;">📢 Avviso dal Master${noticeQueue.length>1?` (${noticeQueue.length} in attesa)`:''}</div>
        ${n.image_url ? `<img src="${escapeAttr(n.image_url)}" style="max-width:100%;max-height:40vh;object-fit:contain;margin-bottom:14px;border:1px solid var(--line);display:block;" />` : ''}
        <div style="white-space:pre-wrap;margin-bottom:18px;line-height:1.5;">${escapeHTML(n.text)}</div>
        <button class="btn solid" id="notice-confirm-btn" style="width:100%;padding:12px;">Ho capito</button>
      </div>
    `;
    // Nessuna chiusura cliccando fuori né tasto ✕: è bloccante di proposito, come richiesto.
    document.body.appendChild(modal);
    document.getElementById('notice-confirm-btn').onclick = async ()=>{
      await confirmNotice(session.code, n.id, session.username);
      noticeQueue.shift();
      if(noticeQueue.length===0) __stopNoticeSfx();
      showNextNotice();
    };
  }
