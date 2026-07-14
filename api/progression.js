const { supabase, cleanCode } = require('../lib/db');

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      const code = cleanCode(req.query.code);
      if (!code) return res.status(400).json({ error: 'missing code' });
      const { data, error } = await supabase
        .from('progression')
        .select('*')
        .eq('campaign_code', code)
        .maybeSingle();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ progression: data || { milestone: 0, xp: 0, inspiration: 0 } });
    }

    if (req.method === 'POST') {
      const { code, milestone, xp, inspiration } = req.body || {};
      const campaignCode = cleanCode(code);
      if (!campaignCode) return res.status(400).json({ error: 'missing code' });
      await supabase.from('campaigns').upsert({ code: campaignCode }, { onConflict: 'code' });
      const { error } = await supabase.from('progression').upsert({
        campaign_code: campaignCode,
        milestone: Number(milestone)||0,
        xp: Number(xp)||0,
        inspiration: Number(inspiration)||0,
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
