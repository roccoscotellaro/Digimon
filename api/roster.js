// /api/roster.js
// Accorpa il vecchio /api/heartbeat: POST con { resource:'heartbeat', code, username }
// aggiorna solo last_seen del membro, senza toccare tamer/digimon.
// Serve a restare sotto il limite di 12 Serverless Functions del piano Vercel Hobby.
const { supabase, cleanCode } = require('../lib/db');

// ===== Inventario: operazioni atomiche lato server (richiesta Rocco 2026-09-26) =====
// "Quando aggiungo un oggetto dalla scheda di un giocatore, a volte devo aggiungerlo due volte":
// ogni pagina teneva una copia della Scheda aggiornata solo ogni ~15s, e l'Inventario veniva
// salvato insieme a TUTTA la Scheda (SALVATAGGIO MEMBRO qui sotto, upsert che sostituisce l'intera
// colonna tamer). Un salvataggio qualsiasi fatto poco dopo da un'altra pagina con la copia vecchia
// (il giocatore che tira un dado, il Master che applica un danno, il polling di player.html che
// ricarica il roster a metà salvataggio...) riscriveva l'Inventario di prima, cancellando in
// silenzio l'oggetto appena aggiunto. Ora:
//   1) ogni modifica all'Inventario passa da qui (resource:'inventory'): SELECT + modifica del solo
//      tamer.inventory + UPDATE, partendo SEMPRE dalla versione salvata sul server;
//   2) il SALVATAGGIO MEMBRO completo NON tocca più l'Inventario di un membro già esistente (tiene
//      quello del server), a meno che il client non lo chieda esplicitamente con
//      replaceInventory:true (solo "Azzera Scheda Tamer", che deve svuotarlo davvero).
// Stessa regola "niente doppioni" del Loot (api/log.js): aggiungere un oggetto con stesso nome
// (maiuscole/spazi ignorati) e stessa Categoria di uno già presente somma la quantità.
function invKey(name, category) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ') + '|' + (category || 'altro');
}

function applyInventoryOp(inventory, body) {
  const inv = Array.isArray(inventory) ? inventory.map(it => Object.assign({}, it)) : [];
  const op = body.op;
  if (op === 'add') {
    const item = body.item || {};
    const name = String(item.name || '').trim().slice(0, 120);
    if (!name) return { error: 'Nome oggetto mancante.' };
    const qty = Math.max(1, Math.floor(Number(item.qty) || 1));
    const category = item.category || 'altro';
    const desc = String(item.desc || '').slice(0, 500);
    const existing = inv.find(it => invKey(it.name, it.category) === invKey(name, category));
    if (existing) {
      existing.qty = (Number(existing.qty) || 0) + qty;
      if (!existing.desc && desc) existing.desc = desc;
    } else {
      inv.push({ name, qty, desc, category });
    }
    return { inventory: inv };
  }
  // remove / setCategory: l'indice arriva da una copia magari vecchia di qualche secondo — si
  // verifica che a quell'indice ci sia ancora un oggetto con lo stesso nome, altrimenti lo si
  // cerca per nome (così non si tocca mai l'oggetto sbagliato se la lista è cambiata nel frattempo).
  const findIdx = () => {
    const i = Number(body.index);
    const nm = String(body.name || '');
    if (Number.isInteger(i) && inv[i] && (!nm || inv[i].name === nm)) return i;
    return nm ? inv.findIndex(it => it.name === nm) : -1;
  };
  if (op === 'remove') {
    const i = findIdx();
    if (i < 0) return { inventory: inv }; // già rimosso altrove: niente da fare, non è un errore
    inv.splice(i, 1);
    return { inventory: inv };
  }
  if (op === 'setCategory') {
    const i = findIdx();
    if (i < 0) return { error: 'Oggetto non trovato (forse già rimosso).' };
    inv[i].category = body.category || 'altro';
    return { inventory: inv };
  }
  if (op === 'consumeFood') {
    // Razioni del Rest (::RATIONREQ:: in js/chat-log-engine.js): scala qty "pasti" dagli oggetti
    // con Categoria Cibo, dal primo in poi; gli stack svuotati spariscono.
    let remaining = Math.max(0, Math.floor(Number(body.qty) || 0));
    let consumed = 0;
    inv.forEach(it => {
      if (remaining <= 0 || it.category !== 'cibo') return;
      const take = Math.min(remaining, Number(it.qty) || 0);
      it.qty = (Number(it.qty) || 0) - take;
      remaining -= take;
      consumed += take;
    });
    return { inventory: inv.filter(it => !(it.category === 'cibo' && Number(it.qty) <= 0)), consumed };
  }
  return { error: 'Operazione inventario sconosciuta.' };
}

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      const code = cleanCode(req.query.code);
      if (!code) return res.status(400).json({ error: 'missing code' });
      const { data, error } = await supabase
        .from('members')
        .select('*')
        .eq('campaign_code', code);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ members: data || [] });
    }

    if (req.method === 'POST') {
      const body = req.body || {};

      // ---- HEARTBEAT (ex /api/heartbeat) ----
      if (body.resource === 'heartbeat') {
        const campaignCode = cleanCode(body.code);
        if (!campaignCode || !body.username) return res.status(400).json({ error: 'missing code or username' });
        const { error } = await supabase
          .from('members')
          .update({ last_seen: new Date().toISOString() })
          .eq('campaign_code', campaignCode)
          .eq('username', String(body.username).slice(0, 60));
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ ok: true });
      }

      // ---- INVENTARIO (operazione atomica, vedi applyInventoryOp più sopra) ----
      if (body.resource === 'inventory') {
        const campaignCode = cleanCode(body.code);
        const username = body.username ? String(body.username).slice(0, 60) : null;
        if (!campaignCode || !username) return res.status(400).json({ error: 'missing code or username' });
        const { data: existing, error: fetchError } = await supabase
          .from('members').select('tamer')
          .eq('campaign_code', campaignCode).eq('username', username).maybeSingle();
        if (fetchError) return res.status(500).json({ error: fetchError.message });
        if (!existing) return res.status(404).json({ error: 'member not found' });
        const tamer = existing.tamer || {};
        const result = applyInventoryOp(tamer.inventory, body);
        if (result.error) return res.status(400).json({ error: result.error });
        const { error: updateError } = await supabase
          .from('members').update({ tamer: Object.assign({}, tamer, { inventory: result.inventory }) })
          .eq('campaign_code', campaignCode).eq('username', username);
        if (updateError) return res.status(500).json({ error: updateError.message });
        return res.status(200).json({ ok: true, inventory: result.inventory, consumed: result.consumed });
      }

      // ---- PATCH PARZIALE (nuovo — vedi patchMember in chat-log-engine.js) ----
      // BUGFIX (mai implementato finora, nonostante fosse già usato dal client — es. il bottone
      // "👁️ Visibile al gruppo"/"❔ Nascosto al gruppo" in index.html, e ora anche il nuovo blocco
      // manuale di Chat Generale): senza questo `if`, un POST con resource:'patch' cadeva nel
      // ramo "SALVATAGGIO MEMBRO" qui sotto, che richiede un `member.username` mai presente in
      // questo payload (qui c'è `username` in cima al body, non dentro un oggetto `member`) — la
      // richiesta falliva sempre con 400 "missing code or member.username", silenziosamente (i
      // chiamanti mostrano un window.alert solo se controllano `ok`, non tutti lo fanno).
      // SELECT + merge superficiale + UPDATE solo sulle chiavi passate, esattamente come descritto
      // nel commento di patchMember: non tocca il resto di tamer/digimon anche se modificato nel
      // frattempo da un salvataggio concorrente (altra scheda aperta, altro giocatore).
      if (body.resource === 'patch') {
        const campaignCode = cleanCode(body.code);
        const username = body.username ? String(body.username).slice(0, 60) : null;
        if (!campaignCode || !username) return res.status(400).json({ error: 'missing code or username' });
        if (!body.digimonPatch && !body.tamerPatch) return res.status(400).json({ error: 'missing digimonPatch or tamerPatch: nothing to patch' });
        const { data: existing, error: fetchError } = await supabase
          .from('members')
          .select('tamer, digimon')
          .eq('campaign_code', campaignCode)
          .eq('username', username)
          .maybeSingle();
        if (fetchError) return res.status(500).json({ error: fetchError.message });
        if (!existing) return res.status(404).json({ error: 'member not found' });
        const patch = {};
        if (body.tamerPatch) patch.tamer = Object.assign({}, existing.tamer || {}, body.tamerPatch);
        if (body.digimonPatch) patch.digimon = Object.assign({}, existing.digimon || {}, body.digimonPatch);
        const { error: updateError } = await supabase
          .from('members')
          .update(patch)
          .eq('campaign_code', campaignCode)
          .eq('username', username);
        if (updateError) return res.status(500).json({ error: updateError.message });
        return res.status(200).json({ ok: true });
      }

      // ---- SALVATAGGIO MEMBRO (comportamento originale) ----
      const { code, member } = body;
      const campaignCode = cleanCode(code);
      if (!campaignCode || !member || !member.username) {
        return res.status(400).json({ error: 'missing code or member.username' });
      }
      // Assicura che la campagna esista
      await supabase.from('campaigns').upsert({ code: campaignCode }, { onConflict: 'code' });

      // Vedi "Inventario: operazioni atomiche" in cima al file: per un membro GIÀ esistente
      // l'Inventario salvato sul server vince sempre su quello (magari vecchio) mandato dal client,
      // salvo replaceInventory:true (Azzera Scheda Tamer). Un membro nuovo prende quello del client.
      const tamerToSave = Object.assign({}, member.tamer || {});
      if (!body.replaceInventory) {
        const { data: current, error: curError } = await supabase
          .from('members').select('tamer')
          .eq('campaign_code', campaignCode).eq('username', String(member.username).slice(0, 60)).maybeSingle();
        if (curError) return res.status(500).json({ error: curError.message });
        if (current && current.tamer && Array.isArray(current.tamer.inventory)) tamerToSave.inventory = current.tamer.inventory;
      }

      const { error } = await supabase.from('members').upsert({
        campaign_code: campaignCode,
        username: String(member.username).slice(0, 60),
        role: member.role === 'master' ? 'master' : 'player',
        tamer: tamerToSave,
        digimon: member.digimon || {},
        last_seen: new Date().toISOString()
      }, { onConflict: 'campaign_code,username' });

      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const code = cleanCode(req.query.code);
      const username = req.query.username;
      if (!code || !username) return res.status(400).json({ error: 'missing code or username' });
      const { error } = await supabase
        .from('members')
        .delete()
        .eq('campaign_code', code)
        .eq('username', username);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
};
