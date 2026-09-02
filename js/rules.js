// js/rules.js
// Primitive pure del regolamento (nessuna dipendenza da session/roster/scena/DOM): le Stage e i
// loro indici, le Size, i modificatori di Stance, il cap della Battery, e la lettura delle
// Qualities in bonus meccanici. Sono il pezzo a rischio piu' basso della logica di combattimento
// da estrarre, e il prerequisito per combat-engine.js (che li usa).
//
// Estesa in fase 8 (parte chat) con la configurazione di campagna e le Skill dei Tamer
// (CAMPAIGN_LEVELS/campaignConfig/evaluateVsTN/SKILL_DEFS/prodigiousSkillBonus/ATTR_ABBR): la
// loro unica dipendenza esterna, cachedProgression, e' un global di js/store.js caricato prima
// di questo file, quindi non c'e' piu' bisogno che restino nella IIFE di index.html -- servono
// a js/chat-log-engine.js (attachLogModeration, per valutare i tiri richiesti in chat).
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
      instinctDodge:0, wardenArmor:0, brawlerClash:0, supremeCode:0, absoluteEvasion:0, heavyRecoil:false, naturewalk:{ accuracy:0, damage:0, dodge:0, armor:0, health:0 } };
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
      // Heavy Recoil (9.03/Qualities catalog): "un Attacco [RANGE] ignora la penalità di
      // Melee-adiacenza" -- ora che quella penalità è un vero -3 Accuracy meccanico (vedi
      // performAttackRoll in index.html), questo flag gli dà finalmente un effetto reale.
      if(q.mechanic==='heavyRecoil') m.heavyRecoil = true;
      if(q.mechanic==='naturewalk'){
        const target = q.statTarget || 'accuracy';
        m.naturewalk[target] = (m.naturewalk[target]||0) + Number(q.rank||1);
      }
    });
    return m;
  }

  const CAMPAIGN_LEVELS = {
    Standard: { ap:10, sp:25, cap:5, thresholds:[3,5,6,7], tnShift:0, startTorment:8 },
    Classic:  { ap:5,  sp:20, cap:3, thresholds:[2,3,4,5], tnShift:-2, startTorment:5 },
    Extreme:  { ap:15, sp:30, cap:7, thresholds:[4,6,8,10], tnShift:2, startTorment:10 }
  };

  function campaignConfig(){
    const level = (cachedProgression && cachedProgression.campaignLevel) || 'Standard';
    return CAMPAIGN_LEVELS[level] || CAMPAIGN_LEVELS.Standard;
  }

  function evaluateVsTN(total, tn, dice){
    if(tn===null || tn===undefined || tn==='') return null;
    if(cachedProgression && cachedProgression.naturalCriticalResults && Array.isArray(dice) && dice.length===3){
      if(dice.every(d=>d===6)) return { label:'Successo Critico', cls:'crit-success' };
      if(dice.every(d=>d===1)) return { label:'Fallimento Critico', cls:'crit-fail' };
    }
    const shift = campaignConfig().tnShift;
    const diff = total - (Number(tn) - shift);
    if(diff>=5) return { label:'Successo Critico', cls:'crit-success' };
    if(diff>=0) return { label:'Successo', cls:'success' };
    if(diff<=-5) return { label:'Fallimento Critico', cls:'crit-fail' };
    return { label:'Fallimento', cls:'fail' };
  }

  const SKILL_DEFS = [
    { key:'evade', label:'Evade', attrs:['agility','willpower'] },
    { key:'precision', label:'Precision', attrs:['agility','intelligence'] },
    { key:'stealth', label:'Stealth', attrs:['agility','body'] },
    { key:'athletics', label:'Athletics', attrs:['body','agility'] },
    { key:'endurance', label:'Endurance', attrs:['body','willpower'] },
    { key:'featsOfStrength', label:'Feats of Strength', attrs:['body','charisma'] },
    { key:'manipulate', label:'Manipulate', attrs:['charisma','body'] },
    { key:'perform', label:'Perform', attrs:['charisma','agility'] },
    { key:'persuasion', label:'Persuasion', attrs:['charisma','intelligence'] },
    { key:'decipherIntent', label:'Decipher Intent', attrs:['intelligence','charisma'] },
    { key:'survival', label:'Survival', attrs:['intelligence','willpower'] },
    { key:'knowledge', label:'Knowledge', attrs:['intelligence'] },
    { key:'fortitude', label:'Fortitude', attrs:['willpower','intelligence'] },
    { key:'bravery', label:'Bravery', attrs:['willpower','body'] },
    { key:'awareness', label:'Awareness', attrs:['willpower','agility'] }
  ];

  function prodigiousSkillBonus(me, def){
    const qualities = (me && me.digimon && Array.isArray(me.digimon.qualities)) ? me.digimon.qualities : [];
    let bonus = 0;
    qualities.forEach(q=>{
      if(!q) return;
      if(q.mechanic==='prodigiousSkill' && q.skillTarget===def.label) bonus += 3;
      if(q.mechanic==='mindOverMatter' && (q.skillTarget===def.label || q.skillTarget2===def.label)) bonus += 3;
    });
    return bonus;
  }

  const ATTR_ABBR = { agility:'AGI', body:'BODY', charisma:'CAR', intelligence:'INT', willpower:'WILL' };
