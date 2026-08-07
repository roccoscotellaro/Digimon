// /api/scan.js
// Gestisce i tentativi del Bio-Resonance Scan (digivice-scan.html):
//  - GET  ?code=..&username=..   -> stato del Tamer: tentativi usati, log dei suoi risultati,
//                                    e nomi dei Digimon già assegnati a QUALSIASI Tamer della
//                                    campagna (per il filtro anti-doppione lato client).
//  - POST { code, username, digimonName, crestName, attemptNumber }
//                                 -> registra un tentativo. Rifiuta se il Tamer ha già usato
//                                    MAX_ATTEMPTS tentativi, o se quel Digimon è già stato
//                                    assegnato a un altro Tamer della stessa campagna.
//
// Richiede una tabella "scan_log" su Supabase (vedi SQL_scan_log.sql per la definizione).
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const TABLE = 'scan_log';
const MAX_ATTEMPTS = 2;

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      const { code, username } = req.query || {};
      if (!code || !username) return res.status(400).json({ error: 'code e username sono obbligatori' });

      const { data: rows, error } = await supabase
        .from(TABLE)
        .select('username, digimon_name, crest_name, attempt_number, created_at')
        .eq('code', code)
        .order('attempt_number', { ascending: true });
      if (error) return res.status(500).json({ error: error.message });

      const myLog = (rows || []).filter(r => r.username === username);
      const takenNames = (rows || []).map(r => r.digimon_name);

      return res.status(200).json({
        attemptsUsed: myLog.length,
        myLog,
        takenNames
      });
    }

    if (req.method === 'POST') {
      const { code, username, digimonName, crestName, attemptNumber } = req.body || {};
      if (!code || !username || !digimonName) {
        return res.status(400).json({ error: 'code, username e digimonName sono obbligatori' });
      }

      // Controllo tentativi residui per questo Tamer.
      const { data: mineRows, error: mineErr } = await supabase
        .from(TABLE)
        .select('id')
        .eq('code', code)
        .eq('username', username);
      if (mineErr) return res.status(500).json({ error: mineErr.message });
      if ((mineRows || []).length >= MAX_ATTEMPTS) {
        return res.status(403).json({ error: 'Hai già esaurito i ' + MAX_ATTEMPTS + ' tentativi disponibili per questo scan.' });
      }

      // Controllo anti-doppione: quel Digimon non deve essere già stato assegnato ad alcun
      // Tamer (nemmeno a se stessi in un tentativo precedente) in questa campagna.
      const { data: dupRows, error: dupErr } = await supabase
        .from(TABLE)
        .select('username')
        .eq('code', code)
        .eq('digimon_name', digimonName);
      if (dupErr) return res.status(500).json({ error: dupErr.message });
      if ((dupRows || []).length > 0) {
        return res.status(409).json({ error: 'Questo Digimon è già stato assegnato a un altro Tamer della campagna.' });
      }

      const { error: insErr } = await supabase.from(TABLE).insert({
        code,
        username,
        digimon_name: digimonName,
        crest_name: crestName || null,
        attempt_number: attemptNumber || ((mineRows || []).length + 1)
      });
      // Se la tabella ha il vincolo UNIQUE(code, digimon_name) consigliato nello schema, un
      // codice 23505 qui indica una race condition (due invii quasi simultanei): trattalo come
      // doppione già preso, non come errore generico.
      if (insErr) {
        if (insErr.code === '23505') {
          return res.status(409).json({ error: 'Questo Digimon è appena stato assegnato a un altro Tamer — riprova lo scan.' });
        }
        return res.status(500).json({ error: insErr.message });
      }

      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: 'Metodo non permesso' });
  } catch (e) {
    return res.status(500).json({ error: 'Errore interno: ' + e.message });
  }
};
