// js/poster.js
// Locandina della campagna (richiesta Rocco 2026-10-29: "mi piacerebbe fosse visibile più spesso").
//   - Schermata d'apertura: la locandina a tutto schermo per un paio di secondi quando si apre
//     DigiVice, al massimo una volta al giorno per dispositivo; si chiude toccandola.
//   - Testata: una striscia in cima a Vista Master e Vista Giocatore (logo + personaggi, ritagliati
//     dalla locandina) che, toccata, apre la locandina intera.
// Le immagini stanno in img/ (locandina.jpg intera, locandina-logo.jpg, locandina-gruppo.jpg e
// locandina-cielo.jpg per la testata). Per cambiare locandina basta sostituire quei file.
// Script classico autonomo: nessuna dipendenza dagli altri file js/.

const POSTER_FULL = 'img/locandina.jpg';
const POSTER_SPLASH_KEY = 'dvos_poster_splash_day';

function posterBannerHTML(){
  return `<button type="button" class="poster-banner" data-poster-open title="Apri la locandina" aria-label="Apri la locandina della campagna">
    <img class="poster-banner-logo" src="img/locandina-logo.jpg" alt="Digimon — The Incredible Adventure" />
    <img class="poster-banner-group" src="img/locandina-gruppo.jpg" alt="" />
  </button>`;
}

function openPosterViewer(opts){
  opts = opts || {};
  if(document.getElementById('poster-viewer')) return;
  const el = document.createElement('div');
  el.id = 'poster-viewer';
  el.className = 'poster-viewer' + (opts.splash ? ' splash' : '');
  el.innerHTML = `<img src="${POSTER_FULL}" alt="Locandina della campagna" fetchpriority="high" /><div class="poster-viewer-hint">${opts.splash ? 'Tocca per entrare' : 'Tocca per chiudere'}</div>`;
  const close = ()=>{
    if(!el.isConnected) return;
    el.classList.add('closing');
    setTimeout(()=> el.remove(), 350);
  };
  el.addEventListener('click', close);
  document.addEventListener('keydown', function onKey(e){ if(e.key==='Escape'){ close(); document.removeEventListener('keydown', onKey); } });
  document.body.appendChild(el);
  const img = el.querySelector('img');
  const ready = ()=> el.classList.add('ready');
  if(img.complete && img.naturalWidth) ready(); else img.addEventListener('load', ready, { once:true });
  if(opts.splash){
    // La schermata d'apertura resta ~2,8 s da quando l'immagine è visibile; se la rete è lenta e
    // l'immagine non arriva entro 4 s, si chiude comunque per non bloccare l'ingresso.
    const giveUp = setTimeout(close, 4000);
    const startTimer = ()=>{ clearTimeout(giveUp); setTimeout(close, opts.duration || 2800); };
    if(img.complete && img.naturalWidth) startTimer(); else img.addEventListener('load', startTimer, { once:true });
  }
}

(function(){
  // Schermata d'apertura: una volta al giorno per dispositivo. Se il browser non permette di
  // ricordarlo (navigazione privata), la mostriamo comunque: è breve e si chiude da sola.
  let today = '';
  try{ const d = new Date(); today = d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate(); }catch(e){}
  let shown = '';
  try{ shown = localStorage.getItem(POSTER_SPLASH_KEY) || ''; }catch(e){}
  if(today && shown !== today){
    try{ localStorage.setItem(POSTER_SPLASH_KEY, today); }catch(e){}
    const start = ()=> openPosterViewer({ splash:true });
    if(document.body) start(); else document.addEventListener('DOMContentLoaded', start);
  }
  document.addEventListener('click', (e)=>{
    const b = e.target.closest && e.target.closest('[data-poster-open]');
    if(b) openPosterViewer();
  });
})();
