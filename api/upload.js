// /api/upload.js
// Endpoint ACCORPATO per restare sotto il limite di Serverless Functions del piano Vercel:
//  1) comportamento ORIGINALE (upload immagini) — invariato, usato da map.html:
//       POST { code, filename, dataUrl, folder } -> carica su Storage, ritorna { ok, url }
//  2) comportamento NUOVO (Bio-Resonance Scan log) — attivo solo se req.body/query.resource === 'scan':
//       GET  ?resource=scan&code=..&username=..                       -> stato tentativi/log/nomi presi
//       POST { resource:'scan', code, username, digimonName, crestName, attemptNumber } -> registra un tentativo
//
// NOTA PER ROCCO: se in futuro liberi uno slot funzione (es. rimuovendo un endpoint non più
// usato), puoi sempre spostare il blocco "SCAN" in un file api/scan.js dedicato senza toccare
// la parte upload: sono scritti in modo indipendente, si toccano solo nel router in fondo al file.
//
// Richiede il bucket pubblico "chat-uploads"/"campaign-images" già esistenti in Supabase Storage
// E la tabella "scan_log" (vedi SQL_scan_log.sql) per la parte SCAN.
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const BUCKET = 'chat-uploads';
const SCAN_TABLE = 'scan_log';
const SCAN_MAX_ATTEMPTS = 2;

// ---------- BLOCCO ORIGINALE: upload immagine ----------
async function handleImageUpload(req, res) {
  const { code, filename, dataUrl, folder } = req.body || {};
  if (!code || !dataUrl) return res.status(400).json({ error: 'code e dataUrl sono obbligatori' });

  const match = /^data:(.+);base64,(.*)$/.exec(dataUrl);
  if (!match) return res.status(400).json({ error: 'dataUrl non valido' });
  const mimeType = match[1];
  const buffer = Buffer.from(match[2], 'base64');

  if (buffer.length > 6 * 1024 * 1024) {
    return res.status(400).json({ error: 'Immagine troppo grande (max 6MB)' });
  }

  const safeName = String(filename || 'immagine')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(-80);
  const path = `${folder || 'chat'}/${code}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safeName}`;

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: mimeType, upsert: false });
  if (upErr) return res.status(500).json({ error: upErr.message });

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);

  return res.status(200).json({ ok: true, url: pub.publicUrl });
}

// ---------- BLOCCO NUOVO: Bio-Resonance Scan (tentativi, log, anti-doppione) ----------
async function handleScanGet(req, res) {
  const { code, username } = req.query || {};
  if (!code || !username) return res.status(400).json({ error: 'code e username sono obbligatori' });

  const { data: rows, error } = await supabase
    .from(SCAN_TABLE)
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

async function handleScanPost(req, res) {
  const { code, username, digimonName, crestName, attemptNumber } = req.body || {};
  if (!code || !username || !digimonName) {
    return res.status(400).json({ error: 'code, username e digimonName sono obbligatori' });
  }

  const { data: mineRows, error: mineErr } = await supabase
    .from(SCAN_TABLE)
    .select('id')
    .eq('code', code)
    .eq('username', username);
  if (mineErr) return res.status(500).json({ error: mineErr.message });
  if ((mineRows || []).length >= SCAN_MAX_ATTEMPTS) {
    return res.status(403).json({ error: 'Hai già esaurito i ' + SCAN_MAX_ATTEMPTS + ' tentativi disponibili per questo scan.' });
  }

  const { data: dupRows, error: dupErr } = await supabase
    .from(SCAN_TABLE)
    .select('username')
    .eq('code', code)
    .eq('digimon_name', digimonName);
  if (dupErr) return res.status(500).json({ error: dupErr.message });
  if ((dupRows || []).length > 0) {
    return res.status(409).json({ error: 'Questo Digimon è già stato assegnato a un altro Tamer della campagna.' });
  }

  const { error: insErr } = await supabase.from(SCAN_TABLE).insert({
    code,
    username,
    digimon_name: digimonName,
    crest_name: crestName || null,
    attempt_number: attemptNumber || ((mineRows || []).length + 1)
  });
  if (insErr) {
    if (insErr.code === '23505') {
      return res.status(409).json({ error: 'Questo Digimon è appena stato assegnato a un altro Tamer — riprova lo scan.' });
    }
    return res.status(500).json({ error: insErr.message });
  }

  return res.status(200).json({ ok: true });
}

// ---------- ROUTER ----------
module.exports = async (req, res) => {
  try {
    const isScan = req.method === 'GET'
      ? (req.query && req.query.resource === 'scan')
      : ((req.body && req.body.resource === 'scan'));

    if (isScan) {
      if (req.method === 'GET') return await handleScanGet(req, res);
      if (req.method === 'POST') return await handleScanPost(req, res);
      res.setHeader('Allow', ['GET', 'POST']);
      return res.status(405).json({ error: 'Metodo non permesso' });
    }

    // Comportamento originale: solo POST (upload immagine).
    if (req.method !== 'POST') {
      res.setHeader('Allow', ['POST']);
      return res.status(405).json({ error: 'Metodo non permesso' });
    }
    return await handleImageUpload(req, res);
  } catch (e) {
    return res.status(500).json({ error: 'Errore interno: ' + e.message });
  }
};
