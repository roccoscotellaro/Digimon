// js/dice.js
// Meccanica dei tiri di dado (3d6 + attributo/skill, pool di successi) e il loro rendering HTML.
// Funzioni pure: stesso input, stesso output, zero dipendenze dallo stato della campagna (roster,
// scena, progressione...) -- per questo sono il primo pezzo "vero" di logica di gioco estratto dal
// monolite index.html, il candidato a rischio piu' basso.
//
// NOTA: campaignConfig/evaluateVsTN/rollTormentCheck (che leggono il Campaign Level impostato dal
// Master) restano invece dentro index.html: dipendono da cachedProgression, una variabile che vive
// nella closure dello script principale. Spostarle qui avrebbe richiesto inventare un ponte solo
// per quelle tre funzioni -- rimandato a quando l'app avra' un modulo di stato condiviso vero e
// proprio (vedi la discussione sullo split completo).
//
// Script classico (non un modulo ES), caricato PRIMA del blocco <script> principale in index.html:
// le funzioni qui sotto restano quindi disponibili come funzioni globali, esattamente come quando
// vivevano dentro la stessa IIFE del file grande -- nessun cambiamento di comportamento.

const DIE_FACES = ['','⚀','⚁','⚂','⚃','⚄','⚅'];

function rollD6(){ return 1 + Math.floor(Math.random()*6); }

function rollSkillCheck(attrVal, skillVal, extraDice){
  const n = 3 + Math.max(0, Number(extraDice)||0);
  const allDice = [];
  for(let i=0;i<n;i++) allDice.push(rollD6());
  const dice = allDice.slice().sort((a,b)=>b-a).slice(0,3);
  const sum = dice.reduce((a,b)=>a+b,0);
  const total = sum + Number(attrVal||0) + Number(skillVal||0);
  return { dice, total, allDice };
}

function rollAttributeOnly(attrVal){
  const dice = [rollD6(), rollD6(), rollD6()];
  const sum = dice.reduce((a,b)=>a+b,0);
  const total = sum + Number(attrVal||0) - 1;
  return { dice, total };
}

function rollPool(n, countFours){
  const count = Math.max(0, Number(n)||0);
  const dice = [];
  for(let i=0;i<count;i++) dice.push(rollD6());
  const successes = dice.filter(d=>d>= (countFours?4:5)).length;
  return { dice, successes };
}

function tormentBoxesHTML(boxes){
  boxes = Math.max(0, Math.min(10, Number(boxes)||0));
  let out = '<span style="display:inline-flex;gap:2px;vertical-align:middle;">';
  for(let i=1;i<=10;i++){
    out += `<span style="width:11px;height:11px;border:1px solid var(--cyan-dim);${i<=boxes?'background:var(--cyan);':'background:transparent;'}display:inline-block;border-radius:1px;"></span>`;
  }
  out += '</span>';
  return out;
}

function diceRowHTML(dice){
  return `<span class="dice-perspective">${dice.map((d,i)=>`<span class="die3d" style="animation-delay:${(i*0.08).toFixed(2)}s;">${DIE_FACES[d]||d}</span>`).join('')}</span>`;
}
