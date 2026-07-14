const { supabase, cleanCode } = require('../lib/db');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'method not allowed' });
    }
    const { code, username } = req.body || {};
    const campaignCode = cleanCode(code);
    if (!campaignCode || !username) return res.status(400).json({ error: 'missing code or username' });

    const { error } = await supabase
      .from('members')
      .update({ last_seen: new Date().toISOString() })
      .eq('campaign_code', campaignCode)
      .eq('username', String(username).slice(0, 60));

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
};
