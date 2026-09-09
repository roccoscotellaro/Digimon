// js/ui-nav.js
// Due piccoli helper UI generici, indipendenti fra loro e senza alcuna dipendenza esterna oltre
// alle API standard del browser (window/document): la barra di navigazione fissa in basso su
// mobile (isMobile/initMobileNav/switchMobileTab/playerMobileNavHTML/masterMobileNavHTML) e le
// schede pieghevoli su mobile (tocca il titolo di una .hud-frame.card per aprirla/chiuderla).
//
// MOBILE BOTTOM NAV: su schermi <=760px, mostra una barra fissa in basso con un tab per sezione
// (le card sono già wrappate in div.mobile-section con data-mobile-tab dal markup di index.html);
// su desktop il sistema non fa nulla, le sezioni restano tutte visibili nel grid2 a due colonne.
// playerMobileNavHTML/masterMobileNavHTML restituiscono il markup della barra (contenuto diverso
// per i due ruoli); initMobileNav aggancia i click sui bottoni della barra e attiva il primo tab
// (o l'ultimo tab attivo, se initMobileNav viene richiamata di nuovo dopo un ri-render — es. ad
// ogni render completo della pagina).
//
// SCHEDE PIEGHEVOLI: un click sul titolo (.section-title) di una .hud-frame.card la apre/chiude.
// Lo stato "chiusa" è tenuto in __collapsedCardKeys, un Set separato dal DOM (chiave = id della
// card o testo del titolo), perché il polling periodico rigenera l'HTML delle card e perderebbe
// lo stato altrimenti. Un MutationObserver leggero (con debounce) riapplica lo stato pieghevole
// ogni volta che il contenuto della pagina cambia, così una card rimane chiusa anche attraverso i
// re-render del polling.
//
// Script classico (non un modulo ES). Nessuna dipendenza da altri file js/ — può stare ovunque
// nella catena degli script, prima del blocco <script> principale di index.html, che chiama
// initMobileNav()/playerMobileNavHTML()/masterMobileNavHTML() (nessuna di queste tocca
// refreshLiveParts()/maybeNotifyNew(), quindi nessun pattern onChanged necessario qui). Il
// delegate di click e il MutationObserver delle schede pieghevoli si auto-installano al
// caricamento dello script, come il delegate di click globale di js/scene-encounters.js.

  // ---------- MOBILE BOTTOM NAV ----------
  // Su mobile, mostra una barra di navigazione fissa in basso. Ogni tab attiva una sezione
  // diversa (le card vengono wrappate in div.mobile-section con data-mobile-tab).
  // Su desktop (>760px) il sistema non fa nulla — le sezioni restano tutte visibili nel grid2.
  let __currentMobileTab = null;

  function isMobile(){ return window.innerWidth <= 760; }

  function initMobileNav(){
    if(!isMobile()) return;
    const nav = document.querySelector('.mobile-nav');
    if(!nav) return;
    const btns = nav.querySelectorAll('.mobile-nav-btn');
    btns.forEach(btn=>{
      btn.onclick = ()=>{
        const tab = btn.dataset.tab;
        if(!tab) return;
        switchMobileTab(tab);
      };
    });
    // Attiva il primo tab se non c'è nessuno attivo
    if(!__currentMobileTab){
      const first = nav.querySelector('.mobile-nav-btn');
      if(first && first.dataset.tab) switchMobileTab(first.dataset.tab);
    } else {
      switchMobileTab(__currentMobileTab);
    }
  }

  function switchMobileTab(tab){
    __currentMobileTab = tab;
    // Aggiorna bottoni
    document.querySelectorAll('.mobile-nav-btn').forEach(b=>{
      b.classList.toggle('active', b.dataset.tab===tab);
    });
    // Mostra/nascondi sezioni
    document.querySelectorAll('.mobile-section').forEach(sec=>{
      sec.classList.toggle('mobile-active', sec.dataset.mobileTab===tab);
    });
    // Scroll to top quando si cambia tab
    window.scrollTo({ top: 0 });
  }

  // Crea la barra bottom nav per il Player
  function playerMobileNavHTML(){
    return `<nav class="mobile-nav">
      <button class="mobile-nav-btn active" data-tab="scena"><span class="nav-icon">🌐</span>Scena</button>
      <button class="mobile-nav-btn" data-tab="chat"><span class="nav-icon">💬</span>Chat</button>
      <button class="mobile-nav-btn" data-tab="scheda"><span class="nav-icon">📋</span>Scheda</button>
      <button class="mobile-nav-btn" data-tab="combattimento"><span class="nav-icon">⚔️</span>Battle</button>
    </nav>`;
  }

  // Crea la barra bottom nav per il Master
  function masterMobileNavHTML(){
    return `<nav class="mobile-nav">
      <button class="mobile-nav-btn active" data-tab="scena"><span class="nav-icon">🌐</span>Scena</button>
      <button class="mobile-nav-btn" data-tab="chat"><span class="nav-icon">💬</span>Chat</button>
      <button class="mobile-nav-btn" data-tab="combattimento"><span class="nav-icon">⚔️</span>Battle</button>
      <button class="mobile-nav-btn" data-tab="roster"><span class="nav-icon">👥</span>Roster</button>
      <button class="mobile-nav-btn" data-tab="strumenti"><span class="nav-icon">🔧</span>Tools</button>
    </nav>`;
  }
  // ---------- fine MOBILE BOTTOM NAV ----------

  // ---------- schede pieghevoli su mobile ----------
  // Tocca il titolo (.section-title) di una .hud-frame.card per aprirla/chiuderla.
  // Lo stato "chiusa" è tenuto in un Set separato dal DOM (chiave = testo del titolo),
  // perché il polling ogni 4s rigenera l'HTML delle card e perderebbe lo stato altrimenti.
  const __collapsedCardKeys = new Set();

  function __cardTitleKey(card){
    if(card.id) return 'id:' + card.id;
    const t = card.querySelector('.section-title');
    if(!t) return null;
    return 'txt:' + t.textContent.replace('▾','').replace('▸','').trim();
  }

  function __applyCollapseToCard(card){
    const titleEl = card.querySelector('.section-title');
    if(!titleEl) return;
    const key = __cardTitleKey(card);
    const shouldCollapse = key && __collapsedCardKeys.has(key);
    let headerChild = titleEl;
    while(headerChild.parentElement && headerChild.parentElement !== card) headerChild = headerChild.parentElement;
    Array.from(card.children).forEach(child=>{
      if(child === headerChild) return;
      if(shouldCollapse){
        // Ricordiamo il display che il child aveva PRIMA di essere piegato (spesso non è la
        // stringa vuota: es. #mchat-private-slot/#mchat-subgroup-slot partono da "display:none"
        // finché non è la loro scheda ad essere attiva, o #player-subgroup-select-wrap fuori
        // dalla modalità Sottogruppi) — solo così possiamo ripristinarlo esattamente quando la
        // card si riapre, invece di forzare tutto a visibile.
        if(child.dataset.prevDisplay===undefined) child.dataset.prevDisplay = child.style.display || '';
        child.style.display = 'none';
      } else if(child.dataset.prevDisplay!==undefined){
        // La card era stata chiusa da questa stessa funzione: la riapriamo ripristinando
        // esattamente il display precedente (che potrebbe essere "none", se quel child era
        // già nascosto per altri motivi, es. la chat privata quando non è la scheda attiva).
        child.style.display = child.dataset.prevDisplay;
        delete child.dataset.prevDisplay;
      }
      // Se la card non è mai stata chiusa da questa funzione (caso normale, la stragrande
      // maggioranza dei render), NON tocchiamo affatto lo style dei figli: prima invece questa
      // funzione girava ad ogni ri-render (il MutationObserver più sotto la richiama continuamente
      // durante il polling) e resettava incondizionatamente OGNI figlio a "display: ''" — il che
      // cancellava il display:none con cui updateMasterChatModeUI()/updateChatModeButtons()
      // tenevano nascoste Chat Privata e Sottogruppi quando non erano la scheda attiva. Risultato:
      // su mobile (dove questa funzione è attiva) le tre chat restavano sempre tutte aperte insieme.
    });
    card.classList.toggle('collapsed', !!shouldCollapse);
    if(!titleEl.querySelector('.fold-icon')){
      const icon = document.createElement('span');
      icon.className = 'fold-icon';
      icon.style.float = 'right';
      icon.style.opacity = '0.6';
      titleEl.appendChild(icon);
    }
    titleEl.querySelector('.fold-icon').textContent = shouldCollapse ? '▸' : '▾';
  }

  function __refreshAllCollapsibleCards(){
    if(window.innerWidth > 760) return;
    document.querySelectorAll('.hud-frame.card').forEach(__applyCollapseToCard);
  }

  document.addEventListener('click', function(e){
    if(window.innerWidth > 760) return;
    if(e.target.closest('button, a, input, select, textarea, label')) return;
    const titleEl = e.target.closest('.section-title');
    if(!titleEl) return;
    const card = titleEl.closest('.hud-frame.card');
    if(!card) return;
    // Solo il titolo "principale" (il primo .section-title della card) apre/chiude l'intera scheda,
    // per non interferire con eventuali sotto-titoli interni.
    if(card.querySelector('.section-title') !== titleEl) return;
    const key = __cardTitleKey(card);
    if(!key) return;
    if(__collapsedCardKeys.has(key)) __collapsedCardKeys.delete(key);
    else __collapsedCardKeys.add(key);
    __applyCollapseToCard(card);
  });

  // Le card vengono rigenerate di continuo (polling, cambi tab, ecc.): un MutationObserver
  // leggero riapplica lo stato pieghevole ogni volta che il contenuto cambia, con un piccolo
  // debounce per non lavorare ad ogni singola modifica del DOM.
  let __collapseRefreshTimer = null;
  const __collapseObserver = new MutationObserver(()=>{
    if(__collapseRefreshTimer) return;
    __collapseRefreshTimer = setTimeout(()=>{
      __collapseRefreshTimer = null;
      __refreshAllCollapsibleCards();
    }, 150);
  });
  __collapseObserver.observe(document.body, { childList:true, subtree:true });
  window.addEventListener('resize', __refreshAllCollapsibleCards);
