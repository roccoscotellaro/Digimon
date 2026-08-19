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
      const { code, name, stage, description, imageUrl, gifUrl, addedBy, baseStats, evolutions, evolvesFrom, categories, qualities, dpTotal, discovered, attribute, family, originType, signatureMove, signatureMove2, slideEvolution, digimental, attackDesc, attackDesc2, extraAttacks, slideTargets } = req.body || {};
      const campaignCode = cleanCode(code);
      if (!campaignCode || !name) return res.status(400).json({ error: 'missing code or name' });
      await supabase.from('campaigns').upsert({ code: campaignCode }, { onConflict: 'code' });
      const { data, error } = await supabase.from('dex_entries').insert({
        campaign_code: campaignCode,
        name: String(name).slice(0, 80),
        stage: stage || 'Rookie',
        description: String(description || '').slice(0, 1000),
        image_url: imageUrl || '',
        // URL di una GIF animata (opzionale): se presente, l'app la mostra al posto dell'immagine
        // statica ovunque tranne che nel ritratto grande della scheda dettaglio del Digidex.
        gif_url: gifUrl || '',
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
        origin_type: originType || '',
        signature_move: String(signatureMove || '').slice(0, 300),
        // Seconda Signature Move: solo per Jogress/Fusioni con due Digimon di origine, ciascuno con
        // la propria Signature Move che consuma Battery in modo indipendente.
        signature_move_2: String(signatureMove2 || '').slice(0, 300),
        slide_evolution: !!slideEvolution,
        slide_targets: Array.isArray(slideTargets) ? slideTargets.slice(0, 20).map(s => String(s).slice(0, 80)) : [],
        digimental: String(digimental || '').slice(0, 80),
        attack_desc: String(attackDesc || '').slice(0, 500),
        attack_desc_2: String(attackDesc2 || '').slice(0, 500),
        extra_attacks: Array.isArray(extraAttacks)
          ? extraAttacks.slice(0, 10).map(a => ({
              move: String((a && a.move) || '').slice(0, 300),
              desc: String((a && a.desc) || '').slice(0, 500)
            }))
          : []
      }).select().single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ entry: data });
    }

    if (req.method === 'PUT') {
      const { code, id, name, stage, description, imageUrl, gifUrl, baseStats, evolutions, evolvesFrom, categories, qualities, dpTotal, discovered, attribute, family, originType, signatureMove, signatureMove2, slideEvolution, digimental, attackDesc, attackDesc2, extraAttacks, slideTargets } = req.body || {};
      const campaignCode = cleanCode(code);
      if (!campaignCode || !id) return res.status(400).json({ error: 'missing code or id' });
      const { error } = await supabase.from('dex_entries').update({
        name: String(name || '').slice(0, 80),
        stage: stage || 'Rookie',
        description: String(description || '').slice(0, 1000),
        image_url: imageUrl || '',
        gif_url: gifUrl || '',
        base_stats: baseStats || {},
        evolutions: Array.isArray(evolutions) ? evolutions : [],
        evolves_from: Array.isArray(evolvesFrom) ? evolvesFrom : [],
        categories: Array.isArray(categories) ? categories : [],
        qualities: Array.isArray(qualities) ? qualities : [],
        dp_total: Number(dpTotal)||0,
        discovered: !!discovered,
        attribute: attribute || '',
        family: family || '',
        origin_type: originType || '',
        signature_move: String(signatureMove || '').slice(0, 300),
        signature_move_2: String(signatureMove2 || '').slice(0, 300),
        slide_evolution: !!slideEvolution,
        slide_targets: Array.isArray(slideTargets) ? slideTargets.slice(0, 20).map(s => String(s).slice(0, 80)) : [],
        digimental: String(digimental || '').slice(0, 80),
        attack_desc: String(attackDesc || '').slice(0, 500),
        attack_desc_2: String(attackDesc2 || '').slice(0, 500),
        extra_attacks: Array.isArray(extraAttacks)
          ? extraAttacks.slice(0, 10).map(a => ({
              move: String((a && a.move) || '').slice(0, 300),
              desc: String((a && a.desc) || '').slice(0, 500)
            }))
          : []
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
