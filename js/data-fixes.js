// js/data-fixes.js
// Correzioni puntuali ai DATI della campagna, applicate dal browser del Master (che ha già accesso
// alle API) la prima volta che apre DigiVice dopo il deploy. Ogni correzione controlla da sola se
// serve ancora (idempotente): se i dati sono già a posto non fa nulla, quindi può restare qui senza
// danni e va tolta quando non serve più.
// Script classico autonomo: usa solo apiGet/apiPut/apiPost di js/api.js (caricato prima).

(function(){
  const FIXES = [
    {
      // Richiesta Rocco 2026-11-03: l'Aquilamon di Rie (Anna) aveva solo Grand Horn. Si aggiungono
      // un Attacco [RANGE] canon (Blast Rings — in giapponese "Blast Laser": gli anelli d'energia
      // sparati dal becco nell'anime Adventure 02) e un Attacco [MELEE] in stile canon (picchiata
      // con gli artigli: l'anime gli dà solo Grand Horn e Blast Rings). Aggiornati sia il Digidex
      // (così chiunque evolva in Aquilamon li ha) sia le schede dove Aquilamon è già la forma Champion.
      id: 'aquilamon-attacks-2026-11-03',
      dexName: 'Aquilamon',
      stage: 'Champion',
      attacks: [
        { move: 'Blast Rings — [RANGE][DAMAGE]', name: 'Blast Rings', shape: 'Range',
          desc: "Spalanca il becco e spara una raffica di anelli d'energia rossa che si allargano fino a investire il bersaglio." },
        { move: 'Talon Dive — [MELEE][DAMAGE]', name: 'Talon Dive', shape: 'Melee',
          desc: "Piomba dall'alto ad ali chiuse e ghermisce il bersaglio con gli artigli possenti, lacerandolo prima di risalire in volo." }
      ]
    }
  ];

  const lc = (s)=> String(s||'').trim().toLowerCase();
  const hasAttack = (list, name)=> (list||[]).some(a=> a && lc(a.name)===lc(name));
  const sheetAttack = (a)=>({ name:a.name, shape:a.shape, type:'Damage', effectKey:'', extraTags:'DAMAGE', desc:a.desc, signature:false, reach: a.shape==='Range' ? 1 : 0, areaAttack:false });

  async function applyFix(code, fix, dexEntries, members){
    const notes = [];
    const entry = dexEntries.find(e=> lc(e.name)===lc(fix.dexName));
    if(entry){
      const extra = Array.isArray(entry.extra_attacks) ? entry.extra_attacks.slice() : [];
      const missing = fix.attacks.filter(a=> !extra.some(x=> x && lc(String(x.move||'').split(/\s+—\s+/)[0])===lc(a.name)));
      if(missing.length){
        const r = await apiPut('/api/dex', {
          code, id: entry.id,
          name: entry.name, stage: entry.stage, description: entry.description, imageUrl: entry.image_url, gifUrl: entry.gif_url,
          baseStats: entry.base_stats, categories: entry.categories, qualities: entry.qualities,
          dpTotal: entry.dp_total, discovered: entry.discovered, evolutions: entry.evolutions, evolvesFrom: entry.evolves_from,
          attribute: entry.attribute, family: entry.family, signatureMove: entry.signature_move, originType: entry.origin_type,
          signatureMove2: entry.signature_move_2 || '', attackDesc2: entry.attack_desc_2 || '',
          attackDesc: entry.attack_desc || '', digimental: entry.digimental || '',
          extraAttacks: extra.concat(missing.map(a=>({ move:a.move, desc:a.desc }))),
          slideEvolution: !!entry.slide_evolution, slideTargets: entry.slide_targets || []
        });
        if(!r) throw new Error('Digidex: salvataggio rifiutato');
        notes.push('Digidex '+entry.name);
      }
    }
    for(const m of members){
      const d = m && m.digimon;
      const st = d && d.stageStats && d.stageStats[fix.stage];
      if(!st || lc(st.name)!==lc(fix.dexName)) continue;
      const missing = fix.attacks.filter(a=> !hasAttack(st.attacks, a.name));
      if(!missing.length) continue;
      const newAttacks = (st.attacks||[]).concat(missing.map(sheetAttack));
      const patch = { stageStats: Object.assign({}, d.stageStats, { [fix.stage]: Object.assign({}, st, { attacks: newAttacks }) }) };
      // Se è la forma attiva, anche gli Attacchi "vivi" della scheda (copia di quelli dello Stage).
      if(d.stage===fix.stage && lc(d.name)===lc(fix.dexName)){
        patch.attacks = (d.attacks||[]).concat(missing.filter(a=> !hasAttack(d.attacks, a.name)).map(sheetAttack));
      }
      const ok = await patchMember(code, m.username, patch);
      if(!ok) throw new Error('scheda di '+m.username+': salvataggio rifiutato');
      notes.push('scheda di '+m.username);
    }
    return notes;
  }

  async function run(){
    let session = null;
    try{ session = JSON.parse(localStorage.getItem('digivice_session_v1')||'null'); }catch(e){}
    if(!session || session.role!=='master' || !session.code) return;
    const dex = await apiGet('/api/dex?code='+encodeURIComponent(session.code), true);
    const roster = await apiGet('/api/roster?code='+encodeURIComponent(session.code), true);
    if(!dex || !Array.isArray(dex.entries) || !roster || !Array.isArray(roster.members)) return;
    for(const fix of FIXES){
      try{
        const notes = await applyFix(session.code, fix, dex.entries, roster.members);
        if(notes.length) console.info('[data-fixes] '+fix.id+' applicata: '+notes.join(', '));
      }catch(err){
        console.warn('[data-fixes] '+fix.id+' non applicata:', err && err.message);
      }
    }
  }

  // Dopo il caricamento iniziale della pagina, per non rallentare l'avvio.
  const start = ()=> setTimeout(()=>{ run().catch(e=>console.warn('[data-fixes]', e)); }, 4000);
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
