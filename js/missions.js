// js/missions.js
// Funzionalita' "Report Missioni" completa: stato del modal, le 5 funzioni di trasporto verso
// /api/notice?resource=mission (usate SOLO da questo modulo -- verificato: nessun altro punto di
// index.html le chiama), il rendering del modal/lista/form e il binding degli eventi.
//
// A differenza di rules.js/combat-engine.js (pura logica), questo e' un modulo di FEATURE intero:
// stato + chiamate API + DOM. E' sicuro da isolare per lo stesso motivo delle fasi precedenti --
// script classico caricato PRIMA del blocco <script> principale in index.html -- MA con una
// direzione di dipendenza da rispettare: le funzioni qui dentro possono leggere solo cio' che e'
// GIA' globale a quel punto (session/cachedMissions/cachedRoster da js/store.js, apiGet/Post/Put/
// Delete + lastApiError da js/api.js, escapeHTML/escapeAttr/displayName/displayNameFor da
// js/util.js) -- MAI qualcosa ancora dichiarato dentro la IIFE principale di index.html, perche'
// quella IIFE gira DOPO questo file e le sue dichiarazioni locali non sono ancora visibili qui.
// index.html invece PUO' chiamare le funzioni qui sotto (es. openMissionsModal all'apertura del
// pulsante, refreshMissionsModal nel polling) risalendo la catena di scope come nelle fasi
// precedenti -- quella direzione resta invariata.

  let missionsModalOpen = false;
  let missionDraftObjectives = ['']; // righe obiettivo nel form "Nuova Missione"

  async function getMissions(code){ const d = await apiGet('/api/notice?resource=mission&code=' + encodeURIComponent(code), true); return d ? (d.missions||[]) : []; }
  async function createMission(code, { title, description, objectives, rewards, assignedTo, createdBy }){
    return apiPost('/api/notice', { resource:'mission', code, title, description, objectives, rewards, assignedTo, createdBy });
  }
  async function updateMission(code, id, patch){ return apiPut('/api/notice', { resource:'mission', code, id, ...patch }); }
  async function toggleMissionObjective(code, id, index){ return apiPut('/api/notice', { resource:'mission', code, id, toggleObjectiveIndex: index }); }
  async function deleteMission(code, id){ return apiDelete('/api/notice?resource=mission&code=' + encodeURIComponent(code) + '&id=' + encodeURIComponent(id)); }

  // ---------- MISSIONI: report obiettivi/ricompense/PG assegnati/stato ----------
  const MISSION_STATUS_LABEL = { non_iniziata:'Non Iniziata', in_corso:'In Corso', completata:'Completata', fallita:'Fallita' };
  const MISSION_STATUS_COLOR = { non_iniziata:'var(--text-mute)', in_corso:'var(--cyan)', completata:'#5cff8a', fallita:'var(--danger)' };

  async function openMissionsModal(){
    if(!session) return;
    missionsModalOpen = true;
    cachedMissions = await getMissions(session.code);
    missionDraftObjectives = [''];
    const old = document.getElementById('missions-modal');
    if(old) old.remove();
    const modal = document.createElement('div');
    modal.id = 'missions-modal';
    modal.className = 'enc-modal-backdrop';
    modal.innerHTML = `
      <div class="enc-modal-card hud-frame" style="max-width:640px;">
        <button class="btn ghost small" id="missions-modal-close" style="position:absolute;top:8px;right:8px;">✕</button>
        <div class="section-title">📋 Report Missioni</div>
        <div id="missions-list">${missionsListHTML()}</div>
        ${session.role==='master' ? `<div class="divider" style="margin:16px 0;"></div><div id="mission-create-form">${missionCreateFormHTML()}</div>` : ''}
      </div>
    `;
    document.body.appendChild(modal);
    document.getElementById('missions-modal-close').onclick = closeMissionsModal;
    modal.onclick = (ev)=>{ if(ev.target===modal) closeMissionsModal(); };
    bindMissionsListEvents();
    if(session.role==='master') bindMissionCreateForm();
  }

  function closeMissionsModal(){
    missionsModalOpen = false;
    const modal = document.getElementById('missions-modal');
    if(modal) modal.remove();
  }

  async function refreshMissionsModal(){
    if(!missionsModalOpen || !session) return;
    cachedMissions = await getMissions(session.code);
    const listEl = document.getElementById('missions-list');
    if(!listEl) return; // il modal è stato chiuso nel frattempo
    listEl.innerHTML = missionsListHTML();
    bindMissionsListEvents();
  }

  function missionsListHTML(){
    if(cachedMissions.length===0) return `<div class="muted">Nessuna missione ancora registrata.</div>`;
    const isMaster = session && session.role==='master';
    // Per i giocatori mostra prima le missioni assegnate a loro (ma tutte restano visibili, come richiesto).
    const sorted = isMaster ? cachedMissions : cachedMissions.slice().sort((a,b)=>{
      const aMine = (a.assigned_to||[]).includes(session.username) ? 0 : 1;
      const bMine = (b.assigned_to||[]).includes(session.username) ? 0 : 1;
      return aMine - bMine;
    });
    return sorted.map(m=>missionCardHTML(m, isMaster)).join('');
  }

  function missionCardHTML(m, isMaster){
    const objs = Array.isArray(m.objectives) ? m.objectives : [];
    const doneCount = objs.filter(o=>o.done).length;
    const assigned = Array.isArray(m.assigned_to) ? m.assigned_to : [];
    return `
      <div class="hud-frame card" style="padding:12px;margin-bottom:10px;" data-mission-id="${m.id}">
        <div class="flex-between" style="align-items:flex-start;">
          <div>
            <div style="font-weight:700;color:var(--cyan);">${escapeHTML(m.title)}</div>
            ${m.description ? `<div class="sub" style="margin-top:2px;">${escapeHTML(m.description)}</div>` : ''}
          </div>
          <span class="tag mono" style="color:${MISSION_STATUS_COLOR[m.status]||'var(--text-mute)'};border-color:${MISSION_STATUS_COLOR[m.status]||'var(--line)'};">${MISSION_STATUS_LABEL[m.status]||m.status}</span>
        </div>
        ${objs.length>0 ? `
          <div class="muted" style="font-size:10px;text-transform:uppercase;letter-spacing:0.06em;margin-top:10px;">Obiettivi (${doneCount}/${objs.length})</div>
          <div style="margin-top:4px;">
            ${objs.map((o,i)=>`
              <label style="display:flex;align-items:center;gap:6px;font-size:13px;margin-top:4px;cursor:pointer;${o.done?'opacity:0.6;text-decoration:line-through;':''}">
                <input type="checkbox" data-mission-obj="${m.id}:${i}" ${o.done?'checked':''} style="width:auto;" />
                ${escapeHTML(o.text)}
              </label>
            `).join('')}
          </div>
        ` : ''}
        ${m.rewards ? `<div class="muted" style="font-size:10px;text-transform:uppercase;letter-spacing:0.06em;margin-top:10px;">Ricompense</div><div style="font-size:13px;margin-top:2px;">${escapeHTML(m.rewards)}</div>` : ''}
        ${assigned.length>0 ? `<div class="muted" style="font-size:11px;margin-top:8px;">👥 Assegnata a: ${assigned.map(u=>escapeHTML(displayNameFor(u))).join(', ')}</div>` : `<div class="muted" style="font-size:11px;margin-top:8px;">Nessun Tamer assegnato</div>`}
        <div class="row" style="margin-top:10px;gap:8px;align-items:center;">
          <select data-mission-status="${m.id}" style="flex:1;">
            ${Object.keys(MISSION_STATUS_LABEL).map(s=>`<option value="${s}" ${m.status===s?'selected':''}>${MISSION_STATUS_LABEL[s]}</option>`).join('')}
          </select>
          ${isMaster ? `<button class="btn ghost small" data-mission-delete="${m.id}">🗑️</button>` : ''}
        </div>
      </div>
    `;
  }

  function bindMissionsListEvents(){
    const code = session.code;
    document.querySelectorAll('[data-mission-obj]').forEach(cb=>{
      cb.onchange = async ()=>{
        const [id, idx] = cb.getAttribute('data-mission-obj').split(':');
        cb.disabled = true;
        await toggleMissionObjective(code, id, Number(idx));
        await refreshMissionsModal();
      };
    });
    document.querySelectorAll('[data-mission-status]').forEach(sel=>{
      sel.onchange = async ()=>{
        const id = sel.getAttribute('data-mission-status');
        sel.disabled = true;
        await updateMission(code, id, { status: sel.value });
        await refreshMissionsModal();
      };
    });
    document.querySelectorAll('[data-mission-delete]').forEach(btn=>{
      btn.onclick = async ()=>{
        const id = btn.getAttribute('data-mission-delete');
        if(!window.confirm('Eliminare definitivamente questa missione?')) return;
        await deleteMission(code, id);
        await refreshMissionsModal();
      };
    });
  }

  function missionCreateFormHTML(){
    const players = (cachedRoster||[]).filter(m=>m.role==='player');
    return `
      <div class="section-title" style="border:none;padding:0;margin-bottom:10px;">➕ Nuova Missione</div>
      <div class="field"><label>Titolo</label><input type="text" id="mission-title" placeholder="es. Il Segreto della Torre di Infinity" /></div>
      <div class="field"><label>Descrizione</label><textarea id="mission-desc" rows="2" placeholder="Contesto narrativo..."></textarea></div>
      <label style="font-size:10px;text-transform:uppercase;color:var(--text-mute);letter-spacing:0.06em;">Obiettivi</label>
      <div id="mission-objectives-rows" style="margin-top:4px;">${missionDraftObjectives.map((v,i)=>`
        <div class="row" style="margin-top:6px;gap:6px;">
          <input type="text" class="mission-obj-input" data-obj-idx="${i}" value="${escapeAttr(v)}" placeholder="es. Trova la chiave nel Settore Foresta" style="flex:1;" />
          ${missionDraftObjectives.length>1 ? `<button type="button" class="btn ghost small" data-remove-obj="${i}">✕</button>` : ''}
        </div>
      `).join('')}</div>
      <button type="button" class="btn ghost small" id="mission-add-obj" style="margin-top:8px;">+ Aggiungi Obiettivo</button>
      <div class="field" style="margin-top:12px;"><label>Ricompense</label><input type="text" id="mission-rewards" placeholder="es. 200 Bit, Digicore Raro" /></div>
      ${players.length>0 ? `
        <label style="font-size:10px;text-transform:uppercase;color:var(--text-mute);letter-spacing:0.06em;">Assegna a</label>
        <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:6px;">
          ${players.map(p=>`<label style="display:flex;align-items:center;gap:4px;font-size:13px;"><input type="checkbox" class="mission-assign-cb" value="${escapeAttr(p.username)}" style="width:auto;" />${escapeHTML(displayName(p))}</label>`).join('')}
        </div>
      ` : '<div class="muted" style="font-size:11px;">Nessun giocatore ancora presente nel roster.</div>'}
      <button class="btn solid" id="mission-create-btn" style="width:100%;padding:10px;margin-top:14px;">Crea Missione</button>
      <div class="muted" id="mission-create-status" style="margin-top:6px;"></div>
    `;
  }

  function bindMissionCreateForm(){
    const rerenderForm = ()=>{
      const wrap = document.getElementById('mission-create-form');
      if(wrap) wrap.innerHTML = missionCreateFormHTML();
      bindMissionCreateForm();
    };
    document.getElementById('mission-add-obj').onclick = ()=>{
      // Salva i valori digitati finora prima di rigenerare la riga in più.
      document.querySelectorAll('.mission-obj-input').forEach(inp=>{ missionDraftObjectives[Number(inp.getAttribute('data-obj-idx'))] = inp.value; });
      missionDraftObjectives.push('');
      rerenderForm();
    };
    document.querySelectorAll('[data-remove-obj]').forEach(btn=>{
      btn.onclick = ()=>{
        document.querySelectorAll('.mission-obj-input').forEach(inp=>{ missionDraftObjectives[Number(inp.getAttribute('data-obj-idx'))] = inp.value; });
        missionDraftObjectives.splice(Number(btn.getAttribute('data-remove-obj')), 1);
        rerenderForm();
      };
    });
    document.getElementById('mission-create-btn').onclick = async ()=>{
      document.querySelectorAll('.mission-obj-input').forEach(inp=>{ missionDraftObjectives[Number(inp.getAttribute('data-obj-idx'))] = inp.value; });
      const title = document.getElementById('mission-title').value.trim();
      const statusEl = document.getElementById('mission-create-status');
      if(!title){ statusEl.textContent = 'Il titolo è obbligatorio.'; return; }
      const objectives = missionDraftObjectives.filter(t=>t.trim()).map(t=>({ text:t.trim(), done:false }));
      const assignedTo = Array.from(document.querySelectorAll('.mission-assign-cb:checked')).map(cb=>cb.value);
      const description = document.getElementById('mission-desc').value.trim();
      const rewards = document.getElementById('mission-rewards').value.trim();
      statusEl.textContent = 'Creazione in corso...';
      const res = await createMission(session.code, { title, description, objectives, rewards, assignedTo, createdBy: session.username });
      if(res && res.ok){
        missionDraftObjectives = [''];
        cachedMissions = await getMissions(session.code);
        document.getElementById('missions-list').innerHTML = missionsListHTML();
        bindMissionsListEvents();
        rerenderForm();
      } else {
        statusEl.textContent = '⚠ Creazione fallita: ' + (lastApiError || 'errore sconosciuto');
      }
    };
  }
