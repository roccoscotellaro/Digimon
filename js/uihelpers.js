// js/ui-helpers.js
// Helper HTML generici per barre/ritratti, riusati da più schede (Digimon, Tamer, Scena/Combattimento):
// barHTML/batteryCellsHTML/batteryBarHTML (barre generiche e la Battery a "celle"), miniHpBarHTML
// (HP compatto usato dalle card di Scena/Combat Manager), portraitHTML/tamerAvatarHTML/
// digimonPortraitHTML (ritratti con fallback iniziale/Digitama), e siblingCardId (calcola l'id di
// una card "sorella" nello stesso pannello, es. la Scheda Tamer accanto alla Scheda Digimon).
//
// Dipende da: escapeHTML/escapeAttr (js/util.js), bestDigimonImage (js/chat-log-engine.js),
// EGG_IMAGE_URL (dichiarata qui sotto: usata sia da digimonPortraitHTML in questo file sia da
// renderDigimonCard in js/digimon-card.js, quindi vive nel file che carica per primo dei due).
//
// Script classico (non un modulo ES), caricato PRIMA del blocco <script> principale in index.html,
// dopo js/chat-log-engine.js (di cui usa bestDigimonImage) e prima di js/digimon-card.js (che
// dipende da barHTML/batteryBarHTML/portraitHTML/digimonPortraitHTML/siblingCardId).
//
// Nessuna di queste funzioni tocca refreshLiveParts()/maybeNotifyNew() o altro stato dell'IIFE di
// index.html: sono generatori HTML puri, spostate con firme identiche a prima.

  // Immagine dell'Uovo mostrata al posto del Digimon finché il Master non approva la scheda.
  // Rocco: sostituisci con l'URL della tua immagine (es. su Supabase Storage), altrimenti resta l'emoji di fallback.
  const EGG_IMAGE_URL = 'https://i.imgur.com/68Yh5vE.gif';

  function barHTML(label, current, max, kind, onMinusId, onPlusId){
    const pct = max>0 ? Math.max(0, Math.min(100, (current/max)*100)) : 0;
    const low = pct <= 25;
    return `
      <div class="bar-row">
        <div class="bar-label"><span>${label}</span><span class="val">${current} / ${max}</span></div>
        <div class="bar-track"><div class="bar-fill ${low?'low':kind}" style="width:${pct}%;"></div></div>
        <div class="bar-controls">
          <button id="${onMinusId}">−</button>
          <button id="${onPlusId}">+</button>
        </div>
      </div>
    `;
  }

  // ---------- battery cells (visual redesign: segmented cells instead of a plain bar) ----------
  const BATTERY_ABSOLUTE_MAX = 6; // pari al cap a Stage Mega — le celle oltre il cap dello Stage attuale sono mostrate "bloccate"
  function batteryCellsHTML(current, max, mini){
    const m = Math.max(0, Number(max)||0);
    const c = Math.max(0, Number(current)||0);
    if(m<=0) return `<div class="muted" style="font-size:10px;">—</div>`;
    let cells = '';
    for(let i=0;i<BATTERY_ABSOLUTE_MAX;i++){
      if(i<m) cells += `<div class="batt-cell ${i<c?'filled':''}"></div>`;
      else cells += `<div class="batt-cell locked" title="Si sblocca a uno Stage superiore"></div>`;
    }
    return `<div class="batt-cells${mini?' mini':''}">${cells}</div>`;
  }

  function batteryBarHTML(label, current, max, onMinusId, onPlusId){
    return `
      <div class="bar-row">
        <div class="bar-label"><span>⚡ ${label}</span><span class="val">${current||0} / ${max}</span></div>
        ${batteryCellsHTML(current, max)}
        <div class="bar-controls">
          <button id="${onMinusId}">−</button>
          <button id="${onPlusId}">+</button>
        </div>
      </div>
    `;
  }

  // ---------- compact HP readout, used in Scene encounter cards and the Combat tracker ----------
  function miniHpBarHTML(current, max, temp, label){
    const maxN = Math.max(1, Number(max)||1);
    const curN = Math.max(0, Number(current)||0);
    const pct = Math.max(0, Math.min(100, (curN/maxN)*100));
    const ratio = curN/maxN;
    const cls = curN<=0 ? 'ko' : (ratio<=0.25 ? 'crit' : (ratio<=0.5 ? 'warn' : 'ok'));
    const tempN = Number(temp)||0;
    return `
      <div class="hp-mini">
        ${label?`<span class="hp-mini-label">${escapeHTML(label)}</span>`:''}
        <div class="hp-mini-track"><div class="hp-mini-fill ${cls}" style="width:${pct}%;"></div></div>
        <span class="hp-mini-val">${curN}/${maxN}${tempN>0?` <span style="color:var(--cyan);">+${tempN}🛡</span>`:''}</span>
      </div>
    `;
  }

  function portraitHTML(imageUrl, name, size){
    const cls = size==='sm' ? 'portrait-sm' : 'portrait';
    if(imageUrl){
      return `<img class="${cls}" src="${escapeAttr(imageUrl)}" onerror="this.style.visibility='hidden'" />`;
    }
    const initial = (name||'?').trim().charAt(0).toUpperCase() || '?';
    return `<div class="${cls}" style="display:flex;align-items:center;justify-content:center;color:var(--cyan);font-family:'Share Tech Mono',monospace;font-size:${size==='sm'?'14px':'20px'};">${initial}</div>`;
  }

  // Come portraitHTML, ma per il ritratto del TAMER: applica il ritaglio/zoom sul volto
  // impostato in player.html (portraitPosX/Y/portraitZoom), invece di mostrare l'immagine
  // intera. Se il tamer non ha ancora impostato una posizione, i default (50/50/100) equivalgono
  // a un semplice centraggio, quindi è sicuro usarla anche su schede vecchie senza quei campi.
  // Mostra la MINIATURA del Tamer (t.imageThumbUrl, impostata in player.html) se presente;
  // altrimenti l'immagine principale a corpo intero, semplicemente centrata.
  function tamerAvatarHTML(t, name, size){
    const cls = size==='sm' ? 'portrait-sm' : 'portrait';
    const src = t && (t.imageThumbUrl || t.imageUrl);
    if(src){
      return `<span class="${cls}" style="display:inline-block;overflow:hidden;position:relative;padding:0;">`
        + `<img src="${escapeAttr(src)}" onerror="this.parentElement.style.visibility='hidden'" style="width:100%;height:100%;object-fit:cover;display:block;" />`
        + `</span>`;
    }
    return portraitHTML('', name, size);
  }

  // Finché il Master non approva la scheda (dopo la Creazione Guidata), mostriamo un Digitama
  // al posto dell'immagine — anche se il giocatore ha già impostato un'immagine.
  function digimonPortraitHTML(d, size){
    if(!d.approved){
      const cls = size==='sm' ? 'portrait-sm' : 'portrait';
      if(EGG_IMAGE_URL) return `<img class="${cls}" src="${escapeAttr(EGG_IMAGE_URL)}" />`;
      return `<div class="${cls}" style="display:flex;align-items:center;justify-content:center;font-size:${size==='sm'?'20px':'32px'};background:radial-gradient(circle at 35% 30%, #fff8e6, #f0d9a0 60%, #d9b976);border-radius:50%;">🥚</div>`;
    }
    const cls = size==='sm' ? 'portrait-sm' : 'portrait';
    const imgUrl = bestDigimonImage(null, d.name, d.imageUrl);
    if(imgUrl){
      return `<img class="${cls}" style="object-fit:contain;" src="${escapeAttr(imgUrl)}" onerror="this.style.visibility='hidden'" />`;
    }
    return portraitHTML('', d.name, size);
  }

  // Calcola l'id di una card "sorella" nello stesso pannello (es. dalla Scheda Digimon risalire
  // all'id della Scheda Tamer accanto, per ri-renderizzarla dopo un cambio che le riguarda
  // entrambe). containerId segue la convenzione "m-<tipo>-<indice>" lato Master, "<tipo>-card"
  // lato giocatore (singola scheda, nessun indice).
  function siblingCardId(containerId, targetCard){
    if(containerId && containerId.indexOf('m-')===0){
      const idx = containerId.split('-').pop();
      return 'm-'+targetCard+'-'+idx;
    }
    return targetCard+'-card';
  }
