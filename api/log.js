// /api/log.js
// Accorpa il vecchio /api/private-log: la discriminante e' il parametro `thread`.
//
//   GET  /api/log?code=XXX                  -> log pubblico della campagna (tabella logs)
//   GET  /api/log?code=XXX&thread=Mario     -> log privato di quel thread (tabella private_logs)
//   POST { code, who, text, ... }           -> scrive sul log pubblico
//   POST { code, thread, who, text, ... }   -> scrive sul log privato
//   PUT / DELETE                            -> solo log pubblico (come prima)
//
// Serve a restare sotto il limite di 12 Serverless Functions del piano Vercel Hobby.
const { supabase, cleanCode } = require('../lib/db');

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      const code = cleanCode(req.query.code);
      if (!code) return res.status(400).json({ error: 'missing code' });

      const threadUsername = req.query.thread;

      if (threadUsername) {
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
      const { code, thread, who, role, text, meta } = req.body || {};
      const campaignCode = cleanCode(code);

      if (thread) {
        if (!campaignCode || !who || !text) {
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

      if (!campaignCode || !who || !text) {
        return res.status(400).json({ error: 'missing code, who or text' });
      }
      await supabase.from('campaigns').upsert({ code: campaignCode }, { onConflict: 'code' });
      const { data, error } = await supabase.from('logs').insert({
        campaign_code: campaignCode,
        who: String(who).slice(0, 60),
        role: role || 'player',
        text: String(text).slice(0, 2000),
        meta: meta || null
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
      const clearAll = req.query.clearAll === '1' || req.query.clearAll === 'true';
      if (!code) return res.status(400).json({ error: 'missing code' });
      if (clearAll) {
        const { error } = await supabase
          .from('logs')
          .delete()
          .eq('campaign_code', code);
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ ok: true, clearedAll: true });
      }
      if (!id) return res.status(400).json({ error: 'missing id (or pass clearAll=1)' });
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
