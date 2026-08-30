// js/dex-admin.js
// Pannello Dex admin: elenco filtrare per Categoria (dexFilterBarHTML/dexListHTML), form di
// modifica di una voce esistente (renderDexEditForm/bindDexEditButtons), form di aggiunta di una
// nuova voce (bindDexForm), il vecchio pannello autonomo "Digidex" del Master (renderDexPanel),
// e il delegate di click globale per i chip filtro Categoria.
//
// NOTA (fase 13): questo intero cluster risulta CODICE MORTO nell'app attuale — il pannello
// Master mostra solo una mini-card di collegamento a dex.html ("Per la gestione completa usa la
// pagina dedicata"): nessun elemento del vecchio form (dex-live, btn-dex-add, dex-panel-card,
// dex-name, ecc.) esiste più nel template reale di renderMaster, `renderDexPanel` non viene mai
// chiamato, e le chiamate rimaste (`bindDexForm(code, session.username); bindDexEditButtons(code);`
// dentro renderMaster) sono no-op silenziosi (il loro `document.getElementById` non trova nulla).
// Spostato comunque per coerenza con lo split incrementale — comportamento identico (morto)
// preservato — invece di essere eliminato, su richiesta esplicita dell'utente: se in futuro quella
// UI embedded viene riattivata, il codice è già isolato qui pronto all'uso.
//
// Dipende da (già globali, caricati prima nella catena degli script): escapeHTML/escapeAttr
// (js/util.js), portraitHTML (js/ui-helpers.js), attributeBadgeHTML/splitCategoriesAttribute/
// computeDpSpent/evolutionsReadonlyHTML/evolutionsEditableHTML/qualitiesEditableHTML/
// DEX_ATTRIBUTES (js/digimon-card.js), addDexEntry/updateDexEntry (js/scene-encounters.js).
//
// Nessuna dipendenza da refreshLiveParts()/maybeNotifyNew(): questo cluster non li tocca mai (era
// già così nel sorgente originale), quindi nessun pattern onChanged/notify necessario qui — le
// funzioni mantengono le firme originali, esattamente come nella fase 10 (js/notices.js).
//
// window.__dvosRefreshDexPanel (introdotto in fase 12 come hook temporaneo, perché
// dexListHTML/bindDexEditButtons erano ancora IIFE-local a quel punto) è stato rimosso: ora che
// vivono qui come funzioni globali, js/scene-encounters.js le richiama direttamente.

// ---------- stato di modulo (spostato da index.html, usato solo qui) ----------
  let dexActiveFilters = [];
  let dexAddEvolutions = [];
  let dexCanEditGlobal = false;
  let dexEditOpenId = null;

  function dexFilterBarHTML(entries){
    const allCats = new Set();
    (entries||[]).forEach(e=>(e.categories||[]).forEach(c=>allCats.add(c)));
    if(allCats.size===0) return '';
    return `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;">
      ${Array.from(allCats).sort().map(c=>`
        <span class="tag" data-filter-cat="${escapeAttr(c)}" style="cursor:pointer;${dexActiveFilters.includes(c)?'background:rgba(53,232,201,0.15);border-color:var(--cyan);color:var(--cyan);':''}">${escapeHTML(c)}</span>
      `).join('')}
      ${dexActiveFilters.length>0 ? `<span class="tag" data-filter-cat="__clear__" style="cursor:pointer;color:var(--danger);border-color:var(--danger);">× azzera filtri</span>` : ''}
    </div>`;
  }

  function dexListHTML(entries, canEdit){
    dexCanEditGlobal = canEdit;
    if(!entries || entries.length===0) return '<div class="muted">Nessun Digimon ancora registrato nel Dex.</div>';
    const filterBar = dexFilterBarHTML(entries);
    const filtered = dexActiveFilters.length===0 ? entries : entries.filter(e=>(e.categories||[]).some(c=>dexActiveFilters.includes(c)));
    if(filtered.length===0) return filterBar + '<div class="muted">Nessun Digimon corrisponde ai filtri selezionati.</div>';
    return filterBar + filtered.slice().reverse().map(e=>{
      const bs = e.base_stats || {};
      const hasStats = bs.baseAccuracy || bs.baseDamage || bs.baseDodge || bs.baseArmor || bs.baseHealth;
      if(!canEdit && !e.discovered){
        return `
        <div class="roster-item" id="dex-item-${e.id}">
          <div style="display:flex;gap:10px;align-items:center;">
            <div class="portrait-sm" style="display:flex;align-items:center;justify-content:center;color:var(--text-mute);font-family:'Share Tech Mono',monospace;">?</div>
            <div><span class="name" style="color:var(--text-mute);">???</span><div class="muted" style="font-size:10px;">Non ancora incontrato</div></div>
          </div>
        </div>`;
      }
      return `
      <div class="roster-item" id="dex-item-${e.id}">
        <div style="display:flex;gap:10px;align-items:flex-start;">
          ${portraitHTML(e.image_url, e.name, 'sm')}
          <div style="flex:1;">
            <div class="flex-between">
              <div><span class="name">${escapeHTML(e.name)}</span><span class="tag" style="margin-left:6px;">${escapeHTML(e.stage)}</span>${canEdit ? `<span class="tag" style="margin-left:4px;color:${e.discovered?'var(--cyan)':'var(--text-mute)'};border-color:${e.discovered?'var(--cyan-dim)':'var(--line)'};">${e.discovered?'scoperto':'nascosto'}</span>` : ''}</div>
              ${canEdit ? `<button class="btn ghost small" data-dex-edit="${e.id}">Modifica</button>` : ''}
            </div>
            ${e.description ? `<div class="sub" style="margin-top:3px;">${escapeHTML(e.description)}</div>` : ''}
            ${hasStats ? `<div class="muted" style="margin-top:4px;font-size:10px;">ACC ${bs.baseAccuracy||0} · DMG ${bs.baseDamage||0} · DODGE ${bs.baseDodge||0} · ARM ${bs.baseArmor||0} · HP ${bs.baseHealth||0}</div>` : ''}
            ${e.categories && e.categories.length ? `<div style="margin-top:4px;display:flex;flex-wrap:wrap;gap:4px;">${attributeBadgeHTML(splitCategoriesAttribute(e.categories).attribute)}${splitCategoriesAttribute(e.categories).family.map(c=>`<span class="tag" style="font-size:9px;">${escapeHTML(c)}</span>`).join('')}</div>` : ''}
            ${e.evolutions && e.evolutions.length ? evolutionsReadonlyHTML(e.evolutions) : ''}
            ${e.qualities && e.qualities.length ? `<div class="muted" style="margin-top:4px;">Qualities: ${computeDpSpent(e.qualities)}/${e.dp_total||0} DP (${e.qualities.length})</div>` : ''}
            ${e.added_by ? `<div class="muted" style="margin-top:2px;">aggiunto da ${escapeHTML(e.added_by)}</div>` : ''}
          </div>
        </div>
        <div id="dex-edit-form-${e.id}"></div>
      </div>
    `;
    }).join('');
  }

  function renderDexEditForm(code, entry){
    const el = document.getElementById('dex-edit-form-'+entry.id);
    if(!el) return;
    const bs = entry.base_stats || {};
    let localEvo = (entry.evolutions || []).slice();
    let localQual = (entry.qualities || []).slice();
    el.innerHTML = `
      <div class="divider"></div>
      <div class="field"><label>Nome</label><input type="text" id="dex-e-name-${entry.id}" value="${escapeAttr(entry.name)}" /></div>
      <div class="row">
        <div class="field"><label>Stage</label>
          <select id="dex-e-stage-${entry.id}">${['Baby','Rookie','Champion','Ultimate','Mega'].map(s=>`<option ${entry.stage===s?'selected':''}>${s}</option>`).join('')}</select>
        </div>
        <div class="field"><label>URL Immagine</label><input type="text" id="dex-e-img-${entry.id}" value="${escapeAttr(entry.image_url)}" /></div>
      </div>
      <div class="field"><label>Descrizione</label><textarea id="dex-e-desc-${entry.id}" rows="2">${escapeHTML(entry.description)}</textarea></div>
      <div class="row">
        <div class="field" style="flex:1;"><label>Attributo</label>
          <select id="dex-e-attribute-${entry.id}">
            <option value="">— nessuno —</option>
            ${DEX_ATTRIBUTES.map(a=>`<option value="${a}" ${splitCategoriesAttribute(entry.categories).attribute===a?'selected':''}>${a}</option>`).join('')}
          </select>
        </div>
        <div class="field" style="flex:2;"><label>Famiglia (separate da virgola)</label><input type="text" id="dex-e-family-${entry.id}" value="${escapeAttr(splitCategoriesAttribute(entry.categories).family.join(', '))}" placeholder="es. Deva, Angelo" /></div>
      </div>
      <div class="muted" style="margin:8px 0 4px;">Stat Base (Combattimento)</div>
      <div class="row">
        <div class="field"><label>Accuracy</label><input type="number" id="dex-e-acc-${entry.id}" value="${bs.baseAccuracy||0}" min="0" /></div>
        <div class="field"><label>Damage</label><input type="number" id="dex-e-dmg-${entry.id}" value="${bs.baseDamage||0}" min="0" /></div>
      </div>
      <div class="row">
        <div class="field"><label>Dodge</label><input type="number" id="dex-e-dodge-${entry.id}" value="${bs.baseDodge||0}" min="0" /></div>
        <div class="field"><label>Armor</label><input type="number" id="dex-e-arm-${entry.id}" value="${bs.baseArmor||0}" min="0" /></div>
      </div>
      <div class="field"><label>Health</label><input type="number" id="dex-e-hp-${entry.id}" value="${bs.baseHealth||0}" min="0" /></div>
      <div class="muted" style="margin:8px 0 4px;">Possibili Evoluzioni</div>
      <div id="dex-e-evolist-${entry.id}">${evolutionsEditableHTML(localEvo)}</div>
      <div class="row">
        <input type="text" id="dex-e-evoname-${entry.id}" placeholder="Nome evoluzione" style="flex:2;" />
        <input type="text" id="dex-e-evoimg-${entry.id}" placeholder="URL immagine (opz.)" style="flex:2;" />
        <button class="btn small" id="dex-e-evoadd-${entry.id}" style="flex:1;">Aggiungi</button>
      </div>
      <div class="field" style="margin-top:8px;"><label>DP Totali</label><input type="number" id="dex-e-dptotal-${entry.id}" value="${entry.dp_total||0}" min="0" /></div>
      <label style="font-size:11px;display:flex;align-items:center;gap:6px;margin:6px 0;"><input type="checkbox" id="dex-e-discovered-${entry.id}" ${entry.discovered?'checked':''} /> Scoperto dai giocatori</label>
      <div class="muted" style="margin:8px 0 4px;">Qualities</div>
      <div id="dex-e-quallist-${entry.id}">${qualitiesEditableHTML(localQual)}</div>
      <div class="row">
        <input type="text" id="dex-e-qualname-${entry.id}" placeholder="Nome Quality" style="flex:2;" />
        <input type="number" id="dex-e-qualcost-${entry.id}" placeholder="DP" value="1" style="flex:1;" />
      </div>
      <div class="row" style="margin-top:6px;">
        <input type="text" id="dex-e-qualcat-${entry.id}" placeholder="Categoria (opz.)" style="flex:1;" />
        <input type="text" id="dex-e-qualdesc-${entry.id}" placeholder="Descrizione (opz.)" style="flex:2;" />
        <button class="btn small" id="dex-e-qualadd-${entry.id}" style="flex:1;">Aggiungi</button>
      </div>
      <div class="row" style="margin-top:10px;">
        <button class="btn ghost" id="dex-e-cancel-${entry.id}">Annulla</button>
        <button class="btn solid" id="dex-e-save-${entry.id}">Salva</button>
      </div>
      <div class="muted" id="dex-e-status-${entry.id}" style="margin-top:6px;"></div>
    `;
    const bindEvo = ()=>{
      document.querySelectorAll(`#dex-e-evolist-${entry.id} [data-rmevo]`).forEach(btn=>{
        btn.onclick = ()=>{
          localEvo.splice(Number(btn.getAttribute('data-rmevo')),1);
          document.getElementById('dex-e-evolist-'+entry.id).innerHTML = evolutionsEditableHTML(localEvo);
          bindEvo();
        };
      });
    };
    bindEvo();
    document.getElementById('dex-e-evoadd-'+entry.id).onclick = ()=>{
      const n = document.getElementById('dex-e-evoname-'+entry.id).value.trim();
      if(!n) return;
      localEvo.push({ name:n, imageUrl: document.getElementById('dex-e-evoimg-'+entry.id).value.trim() });
      document.getElementById('dex-e-evoname-'+entry.id).value='';
      document.getElementById('dex-e-evoimg-'+entry.id).value='';
      document.getElementById('dex-e-evolist-'+entry.id).innerHTML = evolutionsEditableHTML(localEvo);
      bindEvo();
    };
    const bindQual = ()=>{
      document.querySelectorAll(`#dex-e-quallist-${entry.id} [data-rmquality]`).forEach(btn=>{
        btn.onclick = ()=>{
          localQual.splice(Number(btn.getAttribute('data-rmquality')),1);
          document.getElementById('dex-e-quallist-'+entry.id).innerHTML = qualitiesEditableHTML(localQual);
          bindQual();
        };
      });
    };
    bindQual();
    document.getElementById('dex-e-qualadd-'+entry.id).onclick = ()=>{
      const name = document.getElementById('dex-e-qualname-'+entry.id).value.trim();
      if(!name) return;
      const cost = Number(document.getElementById('dex-e-qualcost-'+entry.id).value)||0;
      const category = document.getElementById('dex-e-qualcat-'+entry.id).value.trim();
      const description = document.getElementById('dex-e-qualdesc-'+entry.id).value.trim();
      localQual.push({ name, cost, category, description });
      document.getElementById('dex-e-qualname-'+entry.id).value='';
      document.getElementById('dex-e-qualcost-'+entry.id).value='1';
      document.getElementById('dex-e-qualcat-'+entry.id).value='';
      document.getElementById('dex-e-qualdesc-'+entry.id).value='';
      document.getElementById('dex-e-quallist-'+entry.id).innerHTML = qualitiesEditableHTML(localQual);
      bindQual();
    };
    document.getElementById('dex-e-cancel-'+entry.id).onclick = ()=>{ el.innerHTML=''; dexEditOpenId = null; };
    document.getElementById('dex-e-save-'+entry.id).onclick = async ()=>{
      const fields = {
        name: document.getElementById('dex-e-name-'+entry.id).value.trim(),
        stage: document.getElementById('dex-e-stage-'+entry.id).value,
        description: document.getElementById('dex-e-desc-'+entry.id).value.trim(),
        imageUrl: document.getElementById('dex-e-img-'+entry.id).value.trim(),
        categories: [document.getElementById('dex-e-attribute-'+entry.id).value, ...document.getElementById('dex-e-family-'+entry.id).value.split(',').map(s=>s.trim()).filter(Boolean)].filter(Boolean),
        baseStats: {
          baseAccuracy: Number(document.getElementById('dex-e-acc-'+entry.id).value)||0,
          baseDamage: Number(document.getElementById('dex-e-dmg-'+entry.id).value)||0,
          baseDodge: Number(document.getElementById('dex-e-dodge-'+entry.id).value)||0,
          baseArmor: Number(document.getElementById('dex-e-arm-'+entry.id).value)||0,
          baseHealth: Number(document.getElementById('dex-e-hp-'+entry.id).value)||0
        },
        evolutions: localEvo,
        qualities: localQual,
        dpTotal: Number(document.getElementById('dex-e-dptotal-'+entry.id).value)||0,
        discovered: document.getElementById('dex-e-discovered-'+entry.id).checked
      };
      const ok = await updateDexEntry(code, entry.id, fields);
      const st = document.getElementById('dex-e-status-'+entry.id);
      if(ok){
        Object.assign(entry, { name:fields.name, stage:fields.stage, description:fields.description, image_url:fields.imageUrl, base_stats:fields.baseStats, evolutions:fields.evolutions, categories:fields.categories, qualities:fields.qualities, dp_total:fields.dpTotal, discovered:fields.discovered });
        el.innerHTML='';
        dexEditOpenId = null;
        const dexLive = document.getElementById('dex-live');
        if(dexLive){ dexLive.innerHTML = dexListHTML(cachedDex, true); bindDexEditButtons(code); }
      } else {
        st.style.color='var(--danger)'; st.textContent = 'Errore: ' + (lastApiError||'');
      }
    };
  }

  function bindDexEditButtons(code){
    document.querySelectorAll('[data-dex-edit]').forEach(btn=>{
      btn.onclick = ()=>{
        const id = btn.getAttribute('data-dex-edit');
        const entry = cachedDex.find(e=>String(e.id)===String(id));
        if(entry){ dexEditOpenId = id; renderDexEditForm(code, entry); }
      };
    });
  }

  function bindDexForm(code, username){
    const btn = document.getElementById('btn-dex-add');
    if(!btn) return;

    const bindAddEvoRemove = ()=>{
      const listEl = document.getElementById('dex-add-evolist');
      if(!listEl) return;
      listEl.querySelectorAll('[data-rmevo]').forEach(b=>{
        b.onclick = ()=>{
          dexAddEvolutions.splice(Number(b.getAttribute('data-rmevo')),1);
          listEl.innerHTML = evolutionsEditableHTML(dexAddEvolutions);
          bindAddEvoRemove();
        };
      });
    };
    bindAddEvoRemove();
    const evoAddBtn = document.getElementById('btn-dex-evo-add');
    if(evoAddBtn){
      evoAddBtn.onclick = ()=>{
        const n = document.getElementById('dex-evo-name').value.trim();
        if(!n) return;
        dexAddEvolutions.push({ name:n, imageUrl: document.getElementById('dex-evo-img').value.trim() });
        document.getElementById('dex-evo-name').value='';
        document.getElementById('dex-evo-img').value='';
        document.getElementById('dex-add-evolist').innerHTML = evolutionsEditableHTML(dexAddEvolutions);
        bindAddEvoRemove();
      };
    }

    btn.onclick = async ()=>{
      const name = document.getElementById('dex-name').value.trim();
      const stage = document.getElementById('dex-stage').value;
      const description = document.getElementById('dex-desc').value.trim();
      const imageUrl = document.getElementById('dex-img').value.trim();
      const attributeSel = document.getElementById('dex-attribute');
      const attribute = attributeSel ? attributeSel.value : '';
      const familyInput = document.getElementById('dex-family');
      const family = familyInput ? familyInput.value.split(',').map(s=>s.trim()).filter(Boolean) : [];
      const categories = [attribute, ...family].filter(Boolean);
      const statusEl = document.getElementById('dex-status');
      if(!name){ statusEl.style.color='var(--danger)'; statusEl.textContent = 'Serve almeno un nome.'; return; }
      const baseStats = {
        baseAccuracy: Number((document.getElementById('dex-acc')||{}).value)||0,
        baseDamage: Number((document.getElementById('dex-dmg')||{}).value)||0,
        baseDodge: Number((document.getElementById('dex-dodge')||{}).value)||0,
        baseArmor: Number((document.getElementById('dex-arm')||{}).value)||0,
        baseHealth: Number((document.getElementById('dex-hp')||{}).value)||0
      };
      const discoveredCheckbox = document.getElementById('dex-discovered');
      const discovered = discoveredCheckbox ? discoveredCheckbox.checked : false;
      const d = await addDexEntry(code, { name, stage, description, imageUrl, addedBy: username, categories, baseStats, evolutions: dexAddEvolutions, discovered });
      if(d && d.entry){
        statusEl.style.color = 'var(--text-mute)';
        statusEl.textContent = 'Aggiunto al Dex.';
        document.getElementById('dex-name').value='';
        document.getElementById('dex-desc').value='';
        document.getElementById('dex-img').value='';
        if(attributeSel) attributeSel.value='';
        if(familyInput) familyInput.value='';
        ['dex-acc','dex-dmg','dex-dodge','dex-arm','dex-hp'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value='0'; });
        dexAddEvolutions = [];
        if(discoveredCheckbox) discoveredCheckbox.checked = false;
        const evoListEl = document.getElementById('dex-add-evolist');
        if(evoListEl){ evoListEl.innerHTML = evolutionsEditableHTML(dexAddEvolutions); bindAddEvoRemove(); }
        cachedDex.push(d.entry);
        const dexLive = document.getElementById('dex-live');
        if(dexLive){ dexLive.innerHTML = dexListHTML(cachedDex, true); bindDexEditButtons(code); }
      } else {
        statusEl.style.color = 'var(--danger)';
        statusEl.textContent = 'Errore: ' + (lastApiError || 'sconosciuto');
      }
    };
  }

  function renderDexPanel(canEdit){
    const cardEl = document.getElementById('dex-panel-card');
    if(!cardEl) return;
    cardEl.innerHTML = `
      <div class="section-title">Digidex — Digimon Incontrati</div>
      <div id="dex-live">${dexListHTML(cachedDex, canEdit)}</div>
      ${canEdit ? `
        <div class="divider"></div>
        <div class="field"><label>Nome</label><input type="text" id="dex-name" placeholder="es. Gabumon" /></div>
        <div class="row">
          <div class="field"><label>Stage</label>
            <select id="dex-stage">${['Baby','Rookie','Champion','Ultimate','Mega'].map(s=>`<option>${s}</option>`).join('')}</select>
          </div>
          <div class="field"><label>URL Immagine (opz.)</label><input type="text" id="dex-img" placeholder="https://..." /></div>
        </div>
        <div class="row">
          <div class="field" style="flex:1;"><label>Attributo</label>
            <select id="dex-attribute">
              <option value="">— nessuno —</option>
              ${DEX_ATTRIBUTES.map(a=>`<option value="${a}">${a}</option>`).join('')}
            </select>
          </div>
          <div class="field" style="flex:2;"><label>Famiglia (separate da virgola, es. Deva, Angelo)</label><input type="text" id="dex-family" placeholder="es. Deva, Angelo" /></div>
        </div>
        <div class="field"><label>Descrizione</label><textarea id="dex-desc" rows="2" placeholder="Cosa avete scoperto su questo Digimon..."></textarea></div>
        <div class="muted" style="margin:8px 0 4px;">Stat Base (Combattimento) — opzionale, puoi completarle anche dopo con "Modifica"</div>
        <div class="row">
          <div class="field"><label>Accuracy</label><input type="number" id="dex-acc" value="0" min="0" /></div>
          <div class="field"><label>Damage</label><input type="number" id="dex-dmg" value="0" min="0" /></div>
        </div>
        <div class="row">
          <div class="field"><label>Dodge</label><input type="number" id="dex-dodge" value="0" min="0" /></div>
          <div class="field"><label>Armor</label><input type="number" id="dex-arm" value="0" min="0" /></div>
        </div>
        <div class="field"><label>Health</label><input type="number" id="dex-hp" value="0" min="0" /></div>
        <div class="muted" style="margin:8px 0 4px;">Possibili Evoluzioni</div>
        <div id="dex-add-evolist">${evolutionsEditableHTML(dexAddEvolutions)}</div>
        <div class="row">
          <input type="text" id="dex-evo-name" placeholder="Nome evoluzione" style="flex:2;" />
          <input type="text" id="dex-evo-img" placeholder="URL immagine (opz.)" style="flex:2;" />
          <button class="btn small" id="btn-dex-evo-add" style="flex:1;">Aggiungi</button>
        </div>
        <label style="font-size:11px;display:flex;align-items:center;gap:6px;margin:6px 0;"><input type="checkbox" id="dex-discovered" /> Già scoperto dai giocatori</label>
        <button class="btn solid" id="btn-dex-add" style="width:100%;margin-top:4px;">Aggiungi al Dex</button>
        <div class="muted" id="dex-status" style="margin-top:6px;"></div>
      ` : `<div class="muted" style="margin-top:8px;">Solo il Master può aggiungere nuove voci al Dex.</div>`}
    `;
    if(canEdit){ bindDexForm(session.code, session.username); bindDexEditButtons(session.code); }
  }

  // ---------- global dex filter delegation ----------
  document.addEventListener('click', function(e){
    const chip = e.target.closest('[data-filter-cat]');
    if(!chip) return;
    const cat = chip.getAttribute('data-filter-cat');
    if(cat === '__clear__'){
      dexActiveFilters = [];
    } else {
      const idx = dexActiveFilters.indexOf(cat);
      if(idx>=0) dexActiveFilters.splice(idx,1); else dexActiveFilters.push(cat);
    }
    const dexLive = document.getElementById('dex-live');
    if(dexLive){
      dexLive.innerHTML = dexListHTML(cachedDex, dexCanEditGlobal);
      if(dexCanEditGlobal && session) bindDexEditButtons(session.code);
    }
  });
