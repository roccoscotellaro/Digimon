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
      const { code, name, stage, description, imageUrl, addedBy, baseStats, evolutions, evolvesFrom, categories, qualities, dpTotal, discovered, attribute, family, originType } = req.body || {};
      const campaignCode = cleanCode(code);
      if (!campaignCode || !name) return res.status(400).json({ error: 'missing code or name' });
      await supabase.from('campaigns').upsert({ code: campaignCode }, { onConflict: 'code' });
      const { data, error } = await supabase.from('dex_entries').insert({
        campaign_code: campaignCode,
        name: String(name).slice(0, 80),
        stage: stage || 'Rookie',
        description: String(description || '').slice(0, 1000),
        image_url: imageUrl || '',
        added_by: addedBy || '',
        base_stats: baseStats || {},
        evolutions: Array.isArray(evolutions) ? evolutions : [],
        evolves_from: Array.isArray(evolvesFrom) ? evolvesFrom : [],
        categories: Array.isArray(categories) ? categories : [],
        qualities: Array.isArray(qualities) ? qualities : [],
        dp_total: Number(dpTotal)||0,
        discovered: !!discovered,
        attribute: attribute || '',
        family: family || '',
        origin_type: originType || ''
      }).select().single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ entry: data });
    }

    if (req.method === 'PUT') {
      const { code, id, name, stage, description, imageUrl, baseStats, evolutions, evolvesFrom, categories, qualities, dpTotal, discovered, attribute, family, originType } = req.body || {};
      const campaignCode = cleanCode(code);
      if (!campaignCode || !id) return res.status(400).json({ error: 'missing code or id' });
      const { error } = await supabase.from('dex_entries').update({
        name: String(name || '').slice(0, 80),
        stage: stage || 'Rookie',
        description: String(description || '').slice(0, 1000),
        image_url: imageUrl || '',
        base_stats: baseStats || {},
        evolutions: Array.isArray(evolutions) ? evolutions : [],
        evolves_from: Array.isArray(evolvesFrom) ? evolvesFrom : [],
        categories: Array.isArray(categories) ? categories : [],
        qualities: Array.isArray(qualities) ? qualities : [],
        dp_total: Number(dpTotal)||0,
        discovered: !!discovered,
        attribute: attribute || '',
        family: family || '',
        origin_type: originType || ''
      }).eq('campaign_code', campaignCode).eq('id', id);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const code = cleanCode(req.query.code);
      const id = req.query.id;
      if (!code || !id) return res.status(400).json({ error: 'missing code or id' });
      const { error } = await supabase
        .from('dex_entries')
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
