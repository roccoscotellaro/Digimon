const { supabase, cleanCode } = require('../lib/db');

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      const code = cleanCode(req.query.code);
      const threadUsername = req.query.thread;
      if (!code || !threadUsername) return res.status(400).json({ error: 'missing code or thread' });
      const { data, error } = await supabase
        .from('private_logs')
        .select('*')
        .eq('campaign_code', code)
        .eq('thread_username', threadUsername)
        .order('id', { ascending: true })
        .limit(200);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ log: data || [] });
    }

    if (req.method === 'POST') {
      const { code, thread, who, role, text, meta } = req.body || {};
      const campaignCode = cleanCode(code);
      if (!campaignCode || !thread || !who || !text) {
        return res.status(400).json({ error: 'missing code, thread, who or text' });
      }
      const { data, error } = await supabase.from('private_logs').insert({
        campaign_code: campaignCode,
        thread_username: String(thread).slice(0, 60),
        who: String(who).slice(0, 60),
        role: role || 'player',
        text: String(text).slice(0, 2000),
        meta: meta || null
      }).select().single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ entry: data });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
};
