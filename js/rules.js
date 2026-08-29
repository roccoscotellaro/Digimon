// js/rules.js
// Primitive pure del regolamento (nessuna dipendenza da session/roster/scena/DOM): le Stage e i
// loro indici, le Size, i modificatori di Stance, il cap della Battery, e la lettura delle
// Qualities in bonus meccanici. Sono il pezzo a rischio piu' basso della logica di combattimento
// da estrarre, e il prerequisito per combat-engine.js (che li usa).
//
// Script classico (non un modulo ES), caricato PRIMA del blocco <script> principale in index.html
// -- restano funzioni/costanti globali esattamente come quando vivevano nella stessa IIFE del
// file grande, nessun cambiamento di comportamento.

  const STAGES = ['Fresh','Baby','Rookie','Champion','Ultimate','Mega'];

  const SIZES = ['Small','Medium','Large','Huge','Gigantic','Colossal'];

  function stageIndex(s){ const i = STAGES.indexOf(s); return i<0?0:i; }

  function stanceModifiers(d){
    const sv = stageIndex(d.stage);
    if(d.stance==='Offensive') return { accuracy: sv, dodge: -sv, damage:0, armor:0 };
    if(d.stance==='Defensive') return { accuracy: -sv, dodge: sv, damage:0, armor:0 };
    if(d.stance==='Fierce') return { accuracy:0, dodge:0, damage: sv, armor:0 };
    if(d.stance==='Brave') return { accuracy:0, dodge:0, damage:0, armor: sv };
    return { accuracy:0, dodge:0, damage:0, armor:0 };
  }

  function batteryCap(stage){ return stageIndex(stage)+1; }

  function computeQualityMechanics(qualities){
    const m = { certainStrike:0, weapon:0, ammoRank:0, combatMonster:0, monsterStrength:false, wrestlemania:false, resistance:0,
      instinctDodge:0, wardenArmor:0, brawlerClash:0, supremeCode:0, absoluteEvasion:0, naturewalk:{ accuracy:0, damage:0, dodge:0, armor:0, health:0 } };
    (qualities||[]).forEach(q=>{
      if(q.mechanic==='certainStrike') m.certainStrike += Number(q.rank||1);
      if(q.mechanic==='weapon') m.weapon += Number(q.rank||1);
      if(q.mechanic==='ammo') m.ammoRank = Math.max(m.ammoRank, Number(q.rank||1));
      if(q.mechanic==='combatMonster') m.combatMonster = Math.max(m.combatMonster, Number(q.rank||1));
      if(q.mechanic==='monsterStrength') m.monsterStrength = true;
      if(q.mechanic==='wrestlemania') m.wrestlemania = true;
      if(q.mechanic==='resistance') m.resistance += Number(q.rank||1);
      if(q.mechanic==='instinct') m.instinctDodge += Number(q.rank||1);
      if(q.mechanic==='dataOptWarden') m.wardenArmor += Number(q.rank||1);
      if(q.mechanic==='dataOptBrawler') m.brawlerClash += Number(q.rank||1);
      if(q.mechanic==='supremeCode') m.supremeCode += Number(q.rank||1);
      if(q.mechanic==='absoluteEvasion') m.absoluteEvasion += Number(q.rank||1);
      if(q.mechanic==='naturewalk'){
        const target = q.statTarget || 'accuracy';
        m.naturewalk[target] = (m.naturewalk[target]||0) + Number(q.rank||1);
      }
    });
    return m;
  }

