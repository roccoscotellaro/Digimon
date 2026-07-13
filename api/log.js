const { supabase, cleanCode } = require('../lib/db');

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      const code = cleanCode(req.query.code);
      if (!code) return res.status(400).json({ error: 'missing code' });
      const { data, error } = await supabase
        .from('logs')
        .select('*')
        .eq('campaign_code', code)
        .order('id', { ascending: true })
        .limit(200);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ log: data || [] });
    }

    if (req.method === 'POST') {
      const { code, who, role, text } = req.body || {};
      const campaignCode = cleanCode(code);
      if (!campaignCode || !who || !text) {
        return res.status(400).json({ error: 'missing code, who or text' });
      }
      await supabase.from('campaigns').upsert({ code: campaignCode }, { onConflict: 'code' });
      const { data, error } = await supabase.from('logs').insert({
        campaign_code: campaignCode,
        who: String(who).slice(0, 60),
        role: role || 'player',
        text: String(text).slice(0, 2000)
      }).select().single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ entry: data });
    }

    if (req.method === 'PUT') {
      const { code, id, text } = req.body || {};
      const campaignCode = cleanCode(code);
      if (!campaignCode || !id || !text) return res.status(400).json({ error: 'missing code, id or text' });
      const { error } = await supabase
        .from('logs')
        .update({ text: String(text).slice(0, 2000) })
        .eq('campaign_code', campaignCode)
        .eq('id', id);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const code = cleanCode(req.query.code);
      const id = req.query.id;
      if (!code || !id) return res.status(400).json({ error: 'missing code or id' });
      const { error } = await supabase
        .from('logs')
        .delete()
        .eq('campaign_code', code)
        .eq('id', id);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST, PUT, DELETE');
    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
};
