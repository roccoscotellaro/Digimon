// /api/notice.js
// Gestisce gli Avvisi Pop-up: creazione (Master), conferma (Giocatore), disattivazione ed eliminazione.
//
// NOTA PER ROCCO: questo file assume lo stesso pattern di inizializzazione Supabase usato negli
// altri tuoi endpoint (es. api/log.js, api/roster.js). Se hai un modulo condiviso tipo
// "api/_supabase.js" che esporta già un client, sostituisci le righe qui sotto con quell'import
// per restare coerente col resto del backend.
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
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
          acked_by: rowsForThis.map(a => a.username),
          ack_details
        };
      });

      return res.status(200).json({ notices: enriched });
    }

    if (req.method === 'POST') {
      const { code, text, imageUrl, createdBy } = req.body || {};
      if (!code || !text) return res.status(400).json({ error: 'code e text sono obbligatori' });

      const { data, error } = await supabase
        .from('notices')
        .insert({
          code,
          text,
          image_url: imageUrl || null,
          created_by: createdBy || 'Master',
          active: true
        })
        .select()
        .single();
      if (error) return res.status(500).json({ error: error.message });

      return res.status(200).json({ ok: true, notice: data });
    }

    if (req.method === 'PUT') {
      const { code, id, ack, deactivate } = req.body || {};
      if (!code || !id) return res.status(400).json({ error: 'code e id sono obbligatori' });

      if (ack) {
        // Upsert per evitare doppie righe se il client invia due volte la conferma
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

    if (req.method === 'DELETE') {
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

    res.setHeader('Allow', ['GET', 'POST', 'PUT', 'DELETE']);
    return res.status(405).json({ error: 'Metodo non permesso' });
  } catch (e) {
    return res.status(500).json({ error: 'Errore interno: ' + e.message });
  }
};
