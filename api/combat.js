const { supabase, cleanCode } = require('../lib/db');

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      const code = cleanCode(req.query.code);
      if (!code) return res.status(400).json({ error: 'missing code' });
      const { data, error } = await supabase
        .from('combat_state')
        .select('*')
        .eq('campaign_code', code)
        .maybeSingle();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ combat: data ? data.data : null });
    }

    if (req.method === 'POST') {
      const { code, data } = req.body || {};
      const campaignCode = cleanCode(code);
      if (!campaignCode) return res.status(400).json({ error: 'missing code' });
      await supabase.from('campaigns').upsert({ code: campaignCode }, { onConflict: 'code' });
      const { error } = await supabase.from('combat_state').upsert({
        campaign_code: campaignCode,
        data: data || {},
        updated_at: new Date().toISOString()
      }, { onConflict: 'campaign_code' });
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
};
