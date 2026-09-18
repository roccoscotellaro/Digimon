// /api/roster.js
// Accorpa il vecchio /api/heartbeat: POST con { resource:'heartbeat', code, username }
// aggiorna solo last_seen del membro, senza toccare tamer/digimon.
// Serve a restare sotto il limite di 12 Serverless Functions del piano Vercel Hobby.
const { supabase, cleanCode } = require('../lib/db');

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

      const { error } = await supabase.from('members').upsert({
        campaign_code: campaignCode,
        username: String(member.username).slice(0, 60),
        role: member.role === 'master' ? 'master' : 'player',
        tamer: member.tamer || {},
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
