const { supabase, cleanCode } = require('../lib/db');

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      const code = cleanCode(req.query.code);
      if (!code) return res.status(400).json({ error: 'missing code' });
      const { data, error } = await supabase
        .from('dex_entries')
        .select('*')
        .eq('campaign_code', code)
        .order('id', { ascending: true });
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ entries: data || [] });
    }

    if (req.method === 'POST') {
      const { code, name, stage, description, imageUrl, addedBy } = req.body || {};
      const campaignCode = cleanCode(code);
      if (!campaignCode || !name) return res.status(400).json({ error: 'missing code or name' });
      await supabase.from('campaigns').upsert({ code: campaignCode }, { onConflict: 'code' });
      const { data, error } = await supabase.from('dex_entries').insert({
        campaign_code: campaignCode,
        name: String(name).slice(0, 80),
        stage: stage || 'Rookie',
        description: String(description || '').slice(0, 1000),
        image_url: imageUrl || '',
        added_by: addedBy || ''
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
