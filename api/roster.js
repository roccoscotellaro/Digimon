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
