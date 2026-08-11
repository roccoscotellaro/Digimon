// /api/notice.js
// Gestisce due funzionalità distinte, instradate tramite il parametro `resource`
// (stesso pattern già usato in api/upload.js con resource=scan/crestImages, per non superare
// il limite di 12 funzioni serverless del piano Vercel Hobby — siamo già al tetto):
//
//   (default, nessun resource)     -> Avvisi Pop-up del Master, con targeting granulare:
//                                      tutti i giocatori / solo alcuni / un solo giocatore.
//   resource: 'bugreport'          -> Segnalazioni bug inviate dai giocatori.
//
// IMPORTANTE: si usa lo stesso client condiviso di ../lib/db, come tutti gli altri endpoint.
// Prima questo file creava un client suo con createClient(process.env.SUPABASE_URL,
// process.env.SUPABASE_SERVICE_ROLE_KEY): se anche solo una di quelle due variabili non esiste
// con QUEL nome esatto su Vercel, createClient lancia un errore a livello di modulo, cioe' fuori
// dal try/catch dell'handler. Vercel in quel caso non risponde JSON ma il testo
// "A server error has occurred", e il client va in errore con
// "Unexpected token 'A' ... is not valid JSON". Con lib/db il problema non si pone.
const { supabase } = require('../lib/db');

// ---------------- AVVISI (comportamento originale + targeting) ----------------
async function handleNoticeGet(req, res) {
  const { code } = req.query;
  if (!code) return res.status(400).json({ error: 'code mancante' });

  const { data: notices, error: nErr } = await supabase
    .from('notices')
    .select('*')
    .eq('code', code)
    .order('created_at', { ascending: true });
  if (nErr) return res.status(500).json({ error: nErr.message });

  const ids = (notices || []).map(n => n.id);
  let acks = [];
  if (ids.length > 0) {
    const { data: ackRows, error: aErr } = await supabase
      .from('notice_acks')
      .select('*')
      .in('notice_id', ids);
    if (aErr) return res.status(500).json({ error: aErr.message });
    acks = ackRows || [];
  }

  const enriched = (notices || []).map(n => {
    const rowsForThis = acks.filter(a => a.notice_id === n.id);
    const ack_details = {};
    rowsForThis.forEach(a => { ack_details[a.username] = a.acked_at; });
    return {
      id: n.id,
      code: n.code,
      text: n.text,
      image_url: n.image_url,
      created_by: n.created_by,
      created_at: n.created_at,
      active: n.active,
      // Targeting: 'all' (default, compatibile con gli avvisi creati prima di questa modifica),
      // 'some' (solo alcuni) o 'single' (un solo giocatore).
      target_type: n.target_type || 'all',
      target_usernames: Array.isArray(n.target_usernames) ? n.target_usernames : [],
      acked_by: rowsForThis.map(a => a.username),
      ack_details
    };
  });

  return res.status(200).json({ notices: enriched });
}

async function handleNoticePost(req, res) {
  const { code, text, imageUrl, createdBy, targetType, targetUsernames } = req.body || {};
  if (!code || !text) return res.status(400).json({ error: 'code e text sono obbligatori' });

  const tType = ['all', 'some', 'single'].includes(targetType) ? targetType : 'all';

  const { data, error } = await supabase
    .from('notices')
    .insert({
      code,
      text,
      image_url: imageUrl || null,
      created_by: createdBy || 'Master',
      active: true,
      target_type: tType,
      target_usernames: tType === 'all' ? [] : (Array.isArray(targetUsernames) ? targetUsernames : [])
    })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json({ ok: true, notice: data });
}

async function handleNoticePut(req, res) {
  const { code, id, ack, deactivate } = req.body || {};
  if (!code || !id) return res.status(400).json({ error: 'code e id sono obbligatori' });

  if (ack) {
    const { error } = await supabase
      .from('notice_acks')
      .upsert(
        { notice_id: id, username: ack, acked_at: new Date().toISOString() },
        { onConflict: 'notice_id,username' }
      );
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  if (deactivate) {
    const { error } = await supabase
      .from('notices')
      .update({ active: false })
      .eq('id', id)
      .eq('code', code);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: 'specificare ack o deactivate' });
}

async function handleNoticeDelete(req, res) {
  const { code, id } = req.query;
  if (!code || !id) return res.status(400).json({ error: 'code e id sono obbligatori' });

  await supabase.from('notice_acks').delete().eq('notice_id', id);
  const { error } = await supabase
    .from('notices')
    .delete()
    .eq('id', id)
    .eq('code', code);
  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json({ ok: true });
}

// ---------------- SEGNALAZIONI BUG ----------------
async function handleBugReportGet(req, res) {
  const { code } = req.query;
  if (!code) return res.status(400).json({ error: 'code mancante' });
  const { data, error } = await supabase
    .from('bug_reports')
    .select('*')
    .eq('code', code)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ reports: data || [] });
}

async function handleBugReportPost(req, res) {
  const { code, username, text } = req.body || {};
  if (!code || !text || !String(text).trim()) return res.status(400).json({ error: 'code e text sono obbligatori' });
  const { data, error } = await supabase
    .from('bug_reports')
    .insert({ code, username: username || 'anonimo', text: String(text).trim(), resolved: false })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ ok: true, report: data });
}

async function handleBugReportPut(req, res) {
  const { code, id, resolved } = req.body || {};
  if (!code || !id) return res.status(400).json({ error: 'code e id sono obbligatori' });
  const { error } = await supabase
    .from('bug_reports')
    .update({ resolved: resolved !== false })
    .eq('id', id)
    .eq('code', code);
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ ok: true });
}

// ---------------- ROUTER ----------------
module.exports = async (req, res) => {
  try {
    const resource = req.method === 'GET' || req.method === 'DELETE'
      ? req.query.resource
      : (req.body && req.body.resource);

    if (resource === 'bugreport') {
      if (req.method === 'GET') return await handleBugReportGet(req, res);
      if (req.method === 'POST') return await handleBugReportPost(req, res);
      if (req.method === 'PUT') return await handleBugReportPut(req, res);
      res.setHeader('Allow', ['GET', 'POST', 'PUT']);
      return res.status(405).json({ error: 'Metodo non permesso' });
    }

    if (req.method === 'GET') return await handleNoticeGet(req, res);
    if (req.method === 'POST') return await handleNoticePost(req, res);
    if (req.method === 'PUT') return await handleNoticePut(req, res);
    if (req.method === 'DELETE') return await handleNoticeDelete(req, res);

    res.setHeader('Allow', ['GET', 'POST', 'PUT', 'DELETE']);
    return res.status(405).json({ error: 'Metodo non permesso' });
  } catch (e) {
    return res.status(500).json({ error: 'Errore interno: ' + e.message });
  }
};
