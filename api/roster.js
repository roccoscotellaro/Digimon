// /api/roster.js
// Accorpa il vecchio /api/heartbeat: POST con { resource:'heartbeat', code, username }
// aggiorna solo last_seen del membro, senza toccare tamer/digimon.
// Serve a restare sotto il limite di 12 Serverless Functions del piano Vercel Hobby.
const { supabase, cleanCode } = require('../lib/db');

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      const code = cleanCode(req.query.code);
      if (!code) return res.status(400).json({ error: 'missing code' });
      const { data, error } = await supabase
        .from('members')
        .select('*')
        .eq('campaign_code', code);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ members: data || [] });
    }

    if (req.method === 'POST') {
      const body = req.body || {};

      // ---- HEARTBEAT (ex /api/heartbeat) ----
      if (body.resource === 'heartbeat') {
        const campaignCode = cleanCode(body.code);
        if (!campaignCode || !body.username) return res.status(400).json({ error: 'missing code or username' });
        const { error } = await supabase
          .from('members')
          .update({ last_seen: new Date().toISOString() })
          .eq('campaign_code', campaignCode)
          .eq('username', String(body.username).slice(0, 60));
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ ok: true });
      }

      // ---- PATCH (nuovo): aggiorna SOLO le chiavi passate in digimonPatch/tamerPatch,
      // lasciando intatto tutto il resto della colonna JSONB tamer/digimon.
      //
      // Perché serve: il salvataggio "normale" qui sotto (SALVATAGGIO MEMBRO) fa un upsert che
      // SOSTITUISCE per intero tamer/digimon con l'oggetto ricevuto. index.html tiene una copia
      // in memoria (cachedRoster) aggiornata solo ogni ~15s: se nel frattempo il Master fa un
      // salvataggio automatico "di contorno" durante il combattimento (reset Stance dopo un
      // Clash, Battery consumata, danno applicato...) partendo da quella copia leggermente
      // vecchia, e nel frattempo il giocatore ha cambiato un campo NON correlato da un'altra
      // scheda (Default Stage, Attributo, URL immagine/GIF...), il salvataggio "di contorno"
      // riscrive l'intero oggetto e cancella silenziosamente quella modifica — anche se i due
      // salvataggi non toccavano affatto lo stesso campo. Il merge superficiale qui sotto
      // (SELECT + Object.assign solo sulle chiavi passate + UPDATE) evita il problema per i punti
      // di index.html convertiti a patchMember: qualunque campo NON esplicitamente passato in
      // digimonPatch/tamerPatch resta quello che c'è già sul server in quel momento, anche se
      // diverso da quello nella cachedRoster di chi ha fatto la patch.
      //
      // A differenza del salvataggio normale, il patch NON crea la riga se non esiste già
      // (niente upsert): richiede che il membro sia già stato salvato almeno una volta.
      if (body.resource === 'patch') {
        const campaignCode = cleanCode(body.code);
        const username = body.username;
        if (!campaignCode || !username) {
          return res.status(400).json({ error: 'missing code or username' });
        }
        const digimonPatch = (body.digimonPatch && typeof body.digimonPatch === 'object') ? body.digimonPatch : null;
        const tamerPatch = (body.tamerPatch && typeof body.tamerPatch === 'object') ? body.tamerPatch : null;
        if (!digimonPatch && !tamerPatch) {
          return res.status(400).json({ error: 'missing digimonPatch or tamerPatch' });
        }

        const { data: current, error: selError } = await supabase
          .from('members')
          .select('digimon, tamer')
          .eq('campaign_code', campaignCode)
          .eq('username', String(username).slice(0, 60))
          .maybeSingle();
        if (selError) return res.status(500).json({ error: selError.message });
        if (!current) return res.status(404).json({ error: 'member not found' });

        const updatePayload = { last_seen: new Date().toISOString() };
        if (digimonPatch) updatePayload.digimon = Object.assign({}, current.digimon || {}, digimonPatch);
        if (tamerPatch) updatePayload.tamer = Object.assign({}, current.tamer || {}, tamerPatch);

        const { error: updError } = await supabase
          .from('members')
          .update(updatePayload)
          .eq('campaign_code', campaignCode)
          .eq('username', String(username).slice(0, 60));
        if (updError) return res.status(500).json({ error: updError.message });
        return res.status(200).json({ ok: true });
      }

      // ---- SALVATAGGIO MEMBRO (comportamento originale) ----
      const { code, member } = body;
      const campaignCode = cleanCode(code);
      if (!campaignCode || !member || !member.username) {
        return res.status(400).json({ error: 'missing code or member.username' });
      }
      // Assicura che la campagna esista
      await supabase.from('campaigns').upsert({ code: campaignCode }, { onConflict: 'code' });

      const { error } = await supabase.from('members').upsert({
        campaign_code: campaignCode,
        username: String(member.username).slice(0, 60),
        role: member.role === 'master' ? 'master' : 'player',
        tamer: member.tamer || {},
        digimon: member.digimon || {},
        last_seen: new Date().toISOString()
      }, { onConflict: 'campaign_code,username' });

      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const code = cleanCode(req.query.code);
      const username = req.query.username;
      if (!code || !username) return res.status(400).json({ error: 'missing code or username' });
      const { error } = await supabase
        .from('members')
        .delete()
        .eq('campaign_code', code)
        .eq('username', username);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
};
