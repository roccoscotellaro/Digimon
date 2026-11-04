// js/evo-animation.js
// Animazione di Digievoluzione "anime" (richiesta Rocco 2026-11-04, prova approvata: "PERFETTA!
// Usando le gif magari"). Sequenza di ~6 s, saltabile con un tocco:
//   1. il Digivice si accende, piove codice digitale;
//   2. il Digimon attuale appare e si scompone in particelle di dati;
//   3. bozzolo di luce con anelli rotanti; dentro, la silhouette della nuova forma cresce a scatti;
//   4. lampo bianco;
//   5. rivelazione (nome, Stage, variazione delle Stat).
// Varianti: 'normal' (colore ciano), 'forced' (rosso, schermo che trema, WARNING), 'regress'
// (grigia: Regressione/Sconfitta). Usa le GIF del Digidex quando ci sono (bestDigimonImage).
//
// Si vede su TUTTI gli schermi: evoWatchRoster() confronta a ogni aggiornamento del Roster lo
// Stage/nome dei Digimon con l'ultimo visto e, se cambia, fa partire l'animazione (anche quando
// l'evoluzione l'ha fatta un altro giocatore o il Master). Chi evolve dal proprio dispositivo la
// vede subito (evoPlayLocal) e il suo Roster viene segnato come "già visto", così non riparte.
//
// Script classico: dipende da bestDigimonImage (js/chat-log-engine.js), stageIndex (js/rules.js),
// __playEvolutionSfx (js/digimon-card.js) — tutti globali, caricati prima.

(function(){
  const EVO_SFX = 'https://gsquzfhxgyqrnkrqdivc.supabase.co/storage/v1/object/public/campaign-audio/FRONTIER1/1787073018875_mziu9s.mpeg';
  const MODES = {
    normal:  { accent:'#35e8c9', verb:'DIGIVOLVE A…' },
    forced:  { accent:'#ff5d5d', verb:'EVOLUZIONE FORZATA…' },
    regress: { accent:'#8fa3ad', verb:'REGREDISCE A…' }
  };
  const esc = (s)=> String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const isGif = (u)=> /\.gif(\?|#|$)/i.test(String(u||''));

  function injectCss(){
    if(document.getElementById('evoanim-style')) return;
    const st = document.createElement('style');
    st.id = 'evoanim-style';
    st.textContent = `
      .evoanim{position:fixed;inset:0;z-index:100000;background:rgba(5,7,10,.96);overflow:hidden;cursor:pointer;--accent:#35e8c9;font-family:ui-monospace,"Share Tech Mono",Menlo,Consolas,monospace;color:#d8f3ee;}
      .evoanim canvas{position:absolute;inset:0;width:100%;height:100%;}
      .evoanim .ea-stage{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;}
      .evoanim .ea-center{position:relative;width:min(62vw,260px);height:min(62vw,260px);margin-top:-60px;}
      .evoanim .ea-portrait{position:absolute;inset:0;border-radius:18px;overflow:hidden;opacity:0;}
      .evoanim .ea-portrait.solid{background:#fff;}
      .evoanim .ea-portrait img{width:100%;height:100%;object-fit:contain;display:block;}
      .evoanim .ea-portrait.fallback{background:radial-gradient(circle at 50% 40%,#2a3a44,#0c1117);}
      .evoanim .ea-portrait.fallback::after{content:attr(data-name);position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:14px;color:var(--accent);text-align:center;padding:10px;}
      .evoanim .ea-cocoon{position:absolute;inset:-18%;border-radius:50%;opacity:0;filter:blur(1px);
        background:radial-gradient(circle,#fff 0%,color-mix(in srgb,var(--accent) 85%,#fff) 30%,color-mix(in srgb,var(--accent) 45%,transparent) 55%,transparent 70%);}
      .evoanim .ea-ring{position:absolute;inset:-26%;border-radius:50%;border:2px dashed color-mix(in srgb,var(--accent) 80%,transparent);opacity:0;}
      .evoanim .ea-ring.r2{inset:-38%;border-style:dotted;border-width:3px;}
      .evoanim .ea-ring.r3{inset:-12%;border-width:1px;border-style:solid;}
      .evoanim .ea-sil{position:absolute;inset:6%;opacity:0;}
      .evoanim .ea-sil img{width:100%;height:100%;object-fit:contain;}
      .evoanim .ea-sil.gif img{filter:brightness(0);}
      .evoanim .ea-sil.jpg{mix-blend-mode:multiply;}
      .evoanim .ea-sil.jpg img{filter:grayscale(1) contrast(6) brightness(.55);}
      .evoanim .ea-flash{position:absolute;inset:0;background:#fff;opacity:0;pointer-events:none;}
      .evoanim .ea-title{position:absolute;left:0;right:0;top:calc(50% + min(31vw,130px) - 34px);text-align:center;padding:0 16px;}
      .evoanim .ea-small{font-size:12px;letter-spacing:.3em;color:#7b9a96;opacity:0;}
      .evoanim .ea-big{font-size:clamp(22px,6.5vw,40px);font-weight:700;letter-spacing:.06em;color:#fff;text-shadow:0 0 12px var(--accent),0 0 28px var(--accent);opacity:0;margin-top:2px;}
      .evoanim .ea-stagelbl{display:inline-block;margin-top:8px;font-size:11px;letter-spacing:.2em;padding:3px 10px;border:1px solid var(--accent);color:var(--accent);border-radius:20px;opacity:0;}
      .evoanim .ea-stats{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin-top:12px;opacity:0;}
      .evoanim .ea-stat{font-size:11px;padding:4px 8px;border-radius:6px;background:rgba(255,255,255,.05);border:1px solid #1d2a33;}
      .evoanim .ea-stat b{color:var(--accent);}
      .evoanim .ea-stat .down{color:#ff5d5d;}
      .evoanim .ea-who{position:absolute;top:14px;left:0;right:0;text-align:center;font-size:11px;letter-spacing:.12em;color:#7b9a96;}
      .evoanim .ea-skip{position:absolute;bottom:calc(14px + env(safe-area-inset-bottom));left:0;right:0;text-align:center;font-size:10px;color:#4f6662;letter-spacing:.08em;}
      .evoanim .ea-dv{position:absolute;left:50%;top:50%;width:120px;height:120px;margin:-120px 0 0 -60px;border-radius:24px;opacity:0;
        border:3px solid var(--accent);box-shadow:0 0 30px var(--accent),inset 0 0 20px var(--accent);background:radial-gradient(circle,color-mix(in srgb,var(--accent) 40%,#000),#000 70%);}
      .evoanim .ea-dv::after{content:"";position:absolute;inset:28px;border-radius:10px;background:var(--accent);opacity:.85;filter:blur(2px);animation:eaPulse .25s steps(2) infinite;}
      @keyframes eaPulse{50%{opacity:.35;}}
      .evoanim .ea-warn{position:absolute;left:0;right:0;top:9%;text-align:center;font-size:clamp(18px,6vw,34px);font-weight:700;letter-spacing:.3em;color:#ff5d5d;text-shadow:0 0 12px #ff5d5d;opacity:0;}
      .evoanim .ea-shake{animation:eaShake .12s linear infinite;}
      @keyframes eaShake{0%{transform:translate(0,0);}25%{transform:translate(3px,-2px);}50%{transform:translate(-3px,2px);}75%{transform:translate(2px,3px);}100%{transform:translate(0,0);}}
      .evoanim .ea-glitch img{animation:eaGlitch .35s steps(3) infinite;}
      @keyframes eaGlitch{0%{transform:translate(0);filter:none;}33%{transform:translate(-4px,1px);filter:hue-rotate(90deg) saturate(3);}66%{transform:translate(3px,-2px);filter:invert(.2);}}
      @media (prefers-reduced-motion: reduce){ .evoanim .ea-shake,.evoanim .ea-glitch img{animation:none;} }
    `;
    document.head.appendChild(st);
  }

  // Istantanea di un Digimon per l'animazione e per il confronto del Roster.
  function evoSnapshot(d){
    if(!d) return null;
    const img = (typeof bestDigimonImage==='function') ? bestDigimonImage(null, d.name, d.imageUrl) : (d.imageUrl||'');
    return {
      name: d.name || '', stage: d.stage || '', img: img || '',
      forced: Number(d.forcedEvoRoundsLeft||0) > 0,
      stats: { ACC:Number(d.baseAccuracy||0), DMG:Number(d.baseDamage||0), DOD:Number(d.baseDodge||0), ARM:Number(d.baseArmor||0), HP:Number(d.baseHealth||0) }
    };
  }
  function stageIdx(s){ return (typeof stageIndex==='function') ? stageIndex(s) : 0; }
  function modeFor(from, to){
    if(stageIdx(to.stage) < stageIdx(from.stage)) return 'regress';
    if(to.forced && !from.forced) return 'forced';
    return 'normal';
  }

  let running = null;
  const queue = [];

  // opts: { from:snapshot, to:snapshot, mode?, who? }
  function playEvolutionAnimation(opts){
    if(!opts || !opts.from || !opts.to) return;
    if(running){ queue.push(opts); return; }
    injectCss();
    const mode = opts.mode || modeFor(opts.from, opts.to);
    const M = MODES[mode] || MODES.normal;
    const A = opts.from, B = opts.to;
    const forced = mode==='forced';
    const root = document.createElement('div');
    root.className = 'evoanim';
    root.style.setProperty('--accent', M.accent);
    const statsHTML = Object.keys(B.stats||{}).map(k=>{
      const a = Number((A.stats||{})[k]||0), b = Number(B.stats[k]||0), d = b-a;
      return `<span class="ea-stat">${k} ${a} → <b>${b}</b> ${d>0?`<span>+${d}</span>`:d<0?`<span class="down">${d}</span>`:''}</span>`;
    }).join('');
    const portrait = (cls, snap)=> `<div class="ea-portrait ${cls} ${isGif(snap.img)?'':'solid'}" data-name="${esc(snap.name)}">${snap.img?`<img src="${esc(snap.img)}" alt="">`:''}</div>`;
    root.innerHTML = `
      <canvas></canvas>
      ${opts.who ? `<div class="ea-who">${esc(opts.who)}</div>` : ''}
      <div class="ea-stage">
        <div class="ea-center">
          <div class="ea-ring r2"></div><div class="ea-ring r1"></div>
          <div class="ea-cocoon"></div><div class="ea-ring r3"></div>
          ${portrait('ea-old', A)}
          <div class="ea-sil ${isGif(B.img)?'gif':'jpg'}">${B.img?`<img src="${esc(B.img)}" alt="">`:''}</div>
          ${portrait('ea-new', B)}
        </div>
      </div>
      <div class="ea-dv"></div>
      <div class="ea-warn">⚠ WARNING ⚠</div>
      <div class="ea-flash"></div>
      <div class="ea-title">
        <div class="ea-small ea-from">${esc((A.name||'').toUpperCase())}</div>
        <div class="ea-small ea-verb" style="margin-top:4px;">${esc(M.verb)}</div>
        <div class="ea-big">${esc((B.name||B.stage||'?').toUpperCase())}${mode==='regress'?'':'!'}</div>
        ${B.stage ? `<div class="ea-stagelbl">${esc(String(B.stage).toUpperCase())}</div>` : ''}
        <div class="ea-stats">${statsHTML}</div>
      </div>
      <div class="ea-skip">tocca per saltare</div>`;
    document.body.appendChild(root);
    const q = (s)=> root.querySelector(s);
    root.querySelectorAll('.ea-portrait img').forEach(img=>{
      img.onerror = ()=>{ img.style.display='none'; img.parentNode.classList.add('fallback'); img.parentNode.classList.remove('solid'); };
    });
    if(!A.img) q('.ea-old').classList.add('fallback');
    if(!B.img) q('.ea-new').classList.add('fallback');

    // ----- canvas: pioggia di codice + particelle -----
    const cv = q('canvas'), ctx = cv.getContext('2d');
    let W=0,H=0; const DPR = Math.min(2, window.devicePixelRatio||1);
    const resize = ()=>{ W=root.clientWidth; H=root.clientHeight; cv.width=W*DPR; cv.height=H*DPR; ctx.setTransform(DPR,0,0,DPR,0,0); };
    resize(); window.addEventListener('resize', resize);
    const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('');
    const cols = []; for(let i=0;i<Math.ceil(W/18);i++) cols.push({x:i*18+4,y:Math.random()*-H,v:4+Math.random()*7});
    let parts = [], phase='code', raf=0; const t0 = performance.now(); const timers=[];
    const centerXY = ()=>{ const r=q('.ea-center').getBoundingClientRect(); return {cx:r.left+r.width/2, cy:r.top+r.height/2, rw:r.width}; };
    const emit = (n, kind)=>{ const {cx,cy,rw}=centerXY(); for(let i=0;i<n;i++){ const a=Math.random()*Math.PI*2, d=Math.random()*rw*0.5; parts.push({x:cx+Math.cos(a)*d,y:cy+Math.sin(a)*d,a,d,life:1,size:1+Math.random()*2.5,kind,sp:0.01+Math.random()*0.03,vx:(Math.random()-.5)*14,vy:(Math.random()-.5)*14}); } };
    const draw = ()=>{
      const now = performance.now(), t = now-t0;
      ctx.clearRect(0,0,W,H);
      if(t<2600){
        ctx.font='14px monospace'; ctx.fillStyle=M.accent; ctx.globalAlpha=Math.max(0,Math.min(.55,(2600-t)/1200));
        cols.forEach(c=>{ c.y+=c.v; if(c.y>H) c.y=-20; ctx.fillText(GLYPHS[(Math.random()*GLYPHS.length)|0], c.x, c.y); });
        ctx.globalAlpha=1;
      }
      const {cx,cy} = centerXY();
      parts.forEach(p=>{
        if(p.kind==='spiral'){ p.a+=0.06; p.d=Math.max(0,p.d-1.2); p.x=cx+Math.cos(p.a)*p.d; p.y=cy+Math.sin(p.a)*p.d-(1-p.life)*40; p.life-=p.sp*0.6; }
        else if(p.kind==='rise'){ p.y-=1.5+p.size; p.x+=Math.sin(now/200+p.a)*1.2; p.life-=p.sp; }
        else { p.x+=p.vx; p.y+=p.vy; p.vx*=0.96; p.vy*=0.96; p.life-=p.sp*0.7; }
        if(p.life<=0) return;
        ctx.globalAlpha=Math.max(0,p.life); ctx.fillStyle=Math.random()<.15?'#fff':M.accent; ctx.fillRect(p.x,p.y,p.size,p.size);
      });
      if(phase==='cocoon' && Math.random()<0.18){
        ctx.globalAlpha=0.9; ctx.strokeStyle='#fff'; ctx.lineWidth=1.5; ctx.beginPath();
        let x=cx,y=cy; ctx.moveTo(x,y); const a=Math.random()*Math.PI*2;
        for(let i=0;i<6;i++){ x+=Math.cos(a)*18+(Math.random()-.5)*22; y+=Math.sin(a)*18+(Math.random()-.5)*22; ctx.lineTo(x,y); }
        ctx.stroke();
      }
      ctx.globalAlpha=1;
      parts = parts.filter(p=>p.life>0);
      raf = requestAnimationFrame(draw);
    };
    draw();
    const anim = (el, frames, ms, easing)=> el ? el.animate(frames, { duration:ms, easing:easing||'ease', fill:'forwards' }) : null;
    const at = (ms, fn)=> timers.push(setTimeout(fn, ms));

    try{ if(typeof __playEvolutionSfx==='function') __playEvolutionSfx(EVO_SFX); }catch(e){}

    anim(q('.ea-dv'), [{opacity:0,transform:'scale(.6)'},{opacity:1,transform:'scale(1)',offset:.3},{opacity:1,transform:'scale(1.05)',offset:.8},{opacity:0,transform:'scale(2.4)'}], 1100, 'ease-out');
    if(forced) at(200, ()=>{ q('.ea-stage').classList.add('ea-shake'); anim(q('.ea-warn'), [{opacity:0},{opacity:1,offset:.1},{opacity:.2,offset:.3},{opacity:1,offset:.5},{opacity:.2,offset:.7},{opacity:1,offset:.85},{opacity:0}], 2600); });
    at(900, ()=>{
      phase='dissolve';
      anim(q('.ea-old'), [{opacity:0,transform:'scale(.9)'},{opacity:1,transform:'scale(1)'}], 350, 'ease-out');
      if(forced) q('.ea-old').classList.add('ea-glitch');
      anim(q('.ea-from'), [{opacity:0},{opacity:1}], 400);
    });
    at(1500, ()=>{
      anim(q('.ea-old'), [{opacity:1,filter:'blur(0) brightness(1)',transform:'scale(1)'},{opacity:0,filter:'blur(6px) brightness(3)',transform:'scale(1.08) translateY(-10px)'}], 1100, 'ease-in');
      for(let i=0;i<10;i++) at(i*90, ()=>emit(28,'rise'));
      anim(q('.ea-verb'), [{opacity:0},{opacity:1}], 400);
    });
    at(2500, ()=>{
      phase='cocoon';
      anim(q('.ea-cocoon'), [{opacity:0,transform:'scale(.3)'},{opacity:1,transform:'scale(1)',offset:.25},{opacity:1,transform:'scale(1.06)',offset:.6},{opacity:1,transform:'scale(.95)'}], 2100, 'ease-in-out');
      anim(q('.ea-ring.r1'), [{opacity:0,transform:'rotate(0) scale(.6)'},{opacity:1,transform:'rotate(240deg) scale(1)',offset:.3},{opacity:1,transform:'rotate(720deg) scale(1)'}], 2100, 'linear');
      anim(q('.ea-ring.r2'), [{opacity:0,transform:'rotate(0) scale(.5)'},{opacity:.8,transform:'rotate(-200deg) scale(1)',offset:.3},{opacity:.8,transform:'rotate(-540deg) scale(.9)'}], 2100, 'linear');
      anim(q('.ea-ring.r3'), [{opacity:0},{opacity:.9,offset:.3},{opacity:.9}], 2100);
      anim(q('.ea-sil'), [{opacity:0,transform:'scale(.35)'},{opacity:.85,transform:'scale(.5)',offset:.2},{opacity:.85,transform:'scale(.5)',offset:.35},{opacity:.9,transform:'scale(.72)',offset:.45},{opacity:.9,transform:'scale(.72)',offset:.6},{opacity:.95,transform:'scale(.95)',offset:.7},{opacity:.95,transform:'scale(1)'}], 2100, 'steps(1,end)');
      emit(160,'spiral');
      q('.ea-old').classList.remove('ea-glitch');
    });
    const reveal = (instant)=>{
      phase='reveal';
      ['.ea-cocoon','.ea-ring.r1','.ea-ring.r2','.ea-ring.r3','.ea-sil','.ea-old','.ea-dv','.ea-warn'].forEach(s=>{ const el=q(s); if(el){ el.getAnimations().forEach(a=>a.cancel()); el.style.opacity='0'; } });
      q('.ea-stage').classList.remove('ea-shake');
      const d = instant ? 1 : 1;
      anim(q('.ea-new'), [{opacity:0,transform:'scale(1.25)',filter:'brightness(3)'},{opacity:1,transform:'scale(1)',filter:'brightness(1)'}], instant?d:700, 'cubic-bezier(.2,.9,.3,1.2)');
      q('.ea-new').style.boxShadow = `0 0 40px ${M.accent}`;
      anim(q('.ea-from'), [{opacity:1}], 1); anim(q('.ea-verb'), [{opacity:1}], 1);
      anim(q('.ea-big'), [{opacity:0,transform:'scale(1.4)',letterSpacing:'.4em'},{opacity:1,transform:'scale(1)',letterSpacing:'.06em'}], instant?d:600, 'ease-out');
      const sl = q('.ea-stagelbl'); if(sl) (instant ? anim(sl,[{opacity:1}],1) : at(600, ()=>anim(sl, [{opacity:0,transform:'translateY(6px)'},{opacity:1,transform:'none'}], 400)));
      instant ? anim(q('.ea-stats'),[{opacity:1}],1) : at(1000, ()=>anim(q('.ea-stats'), [{opacity:0,transform:'translateY(8px)'},{opacity:1,transform:'none'}], 500));
      q('.ea-skip').textContent = 'tocca per chiudere';
    };
    at(4500, ()=>{ phase='flash'; anim(q('.ea-flash'), [{opacity:0},{opacity:1,offset:.25},{opacity:0}], 700, 'ease-out'); emit(220,'burst'); });
    at(4700, ()=> reveal(false));
    const close = ()=>{
      timers.forEach(clearTimeout); cancelAnimationFrame(raf); window.removeEventListener('resize', resize);
      root.animate([{opacity:1},{opacity:0}], { duration:300, fill:'forwards' }).onfinish = ()=>{ root.remove(); running=null; if(queue.length) playEvolutionAnimation(queue.shift()); };
    };
    at(9500, close);
    root.addEventListener('click', ()=>{
      if(phase==='reveal'){ close(); return; }
      timers.forEach(clearTimeout); timers.length=0;
      reveal(true);
      at(3500, close);
    });
    running = root;
  }

  // ----- Rilevamento delle evoluzioni dal Roster (per mostrarle a tutti) -----
  const seen = {};      // username -> snapshot
  let seeded = false;
  function evoMarkSeen(username, d){ if(username && d) seen[username] = evoSnapshot(d); }
  function evoWatchRoster(members, opts){
    opts = opts || {};
    const list = Array.isArray(members) ? members : [];
    list.forEach(m=>{
      const d = m && m.digimon;
      if(!m || !d || !d.name || !d.stage) return;
      const snap = evoSnapshot(d);
      const prev = seen[m.username];
      seen[m.username] = snap;
      if(!seeded || !prev) return;
      if(prev.stage===snap.stage && prev.name===snap.name) return;
      // Stesso Stage ma nome diverso: è un'evoluzione solo se è un cambio di forma (entrambi i nomi
      // nel Digidex), non una semplice rinomina del Digimon dalla scheda.
      if(prev.stage===snap.stage){
        const dex = (typeof cachedDex!=='undefined' && Array.isArray(cachedDex)) ? cachedDex : [];
        const inDex = (n)=> dex.some(e=>String(e.name||'').trim().toLowerCase()===String(n||'').trim().toLowerCase());
        if(!inDex(prev.name) || !inDex(snap.name)) return;
      }
      // Digimon nascosto al gruppo: lo vedono solo il suo giocatore e il Master.
      if(d.hiddenFromParty && !opts.isMaster && m.username!==opts.me) return;
      const who = (typeof displayName==='function') ? `Partner di ${displayName(m)}` : '';
      playEvolutionAnimation({ from: prev, to: snap, who });
    });
    seeded = true;
  }
  // Per chi evolve dal proprio dispositivo: animazione subito + Roster segnato come già visto.
  function evoPlayLocal(username, fromSnap, d, mode){
    const to = evoSnapshot(d);
    evoMarkSeen(username, d);
    playEvolutionAnimation({ from: fromSnap, to, mode });
  }

  window.playEvolutionAnimation = playEvolutionAnimation;
  window.evoSnapshot = evoSnapshot;
  window.evoWatchRoster = evoWatchRoster;
  window.evoMarkSeen = evoMarkSeen;
  window.evoPlayLocal = evoPlayLocal;
})();
