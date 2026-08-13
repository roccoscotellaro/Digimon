const { supabase, cleanCode } = require('../lib/db');

const MAX_BYTES = 3 * 1024 * 1024; // 3MB decoded (~4MB come base64) — resta sotto i limiti tipici del body delle funzioni serverless

const TARGETS = {
  sector: { bucket: 'campaign-images', defaultFolder: null },   // comportamento originale: nessuna sottocartella, path = {code}/{file}
  chat:   { bucket: 'chat-uploads',    defaultFolder: 'chat' }, // messaggi di chat e avvisi del Master
};

// ---------- BLOCCO NUOVO: Bio-Resonance Scan (tentativi, log, anti-doppione) ----------
// Accorpato qui (invece di un file api/scan.js dedicato) per restare sotto il limite di
// Serverless Functions del piano Vercel. Attivo solo se req.query/body.resource === 'scan';
// altrimenti il file si comporta ESATTAMENTE come prima (upload immagini sector/chat).
// Usa lo stesso client `supabase` già inizializzato in ../lib/db — nessuna variabile d'ambiente
// letta qui direttamente.
const SCAN_TABLE = 'scan_log';
const SCAN_MAX_ATTEMPTS = 2;
const CREST_IMG_TABLE = 'crest_images';

async function handleCrestImagesGet(req, res) {
  const code = cleanCode((req.query || {}).code);
  if (!code) return res.status(400).json({ error: 'code è obbligatorio' });
  const { data: rows, error } = await supabase
    .from(CREST_IMG_TABLE)
    .select('crest_name, image_url')
    .eq('code', code);
  if (error) return res.status(500).json({ error: error.message });
  const images = {};
  (rows || []).forEach(r => { images[r.crest_name] = r.image_url; });
  return res.status(200).json({ images });
}

async function handleCrestImagesPost(req, res) {
  const body = req.body || {};
  const code = cleanCode(body.code);
  const { crestName, imageUrl } = body;
  if (!code || !crestName) return res.status(400).json({ error: 'code e crestName sono obbligatori' });
  // imageUrl vuota = "rimuovi l'immagine impostata" (torna al placeholder), non un errore.
  const { error } = await supabase
    .from(CREST_IMG_TABLE)
    .upsert({ code, crest_name: crestName, image_url: imageUrl || '', updated_at: new Date().toISOString() }, { onConflict: 'code,crest_name' });
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ ok: true });
}

async function handleScanGet(req, res) {
  const code = cleanCode((req.query || {}).code);
  const username = (req.query || {}).username;
  if (!code) return res.status(400).json({ error: 'code è obbligatorio' });

  const { data: rows, error } = await supabase
    .from(SCAN_TABLE)
    .select('id, username, digimon_name, crest_name, digimental_name, attempt_number, created_at')
    .eq('code', code)
    .order('created_at', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });

  const allLog = rows || [];
  // username è opzionale: se assente (vista Master) ritorna solo il log completo della
  // campagna; se presente (vista giocatore in digivice-scan.html) calcola anche il suo
  // sottoinsieme e il conteggio tentativi.
  const myLog = username ? allLog.filter(r => r.username === username) : [];
  const takenNames = allLog.map(r => r.digimon_name);
  const takenCrests = allLog.filter(r => r.crest_name).map(r => r.crest_name);

  return res.status(200).json({
    attemptsUsed: myLog.length,
    myLog,
    takenNames,
    takenCrests,
    allLog
  });
}

async function handleScanDelete(req, res) {
  const code = cleanCode((req.query || {}).code);
  const id = (req.query || {}).id;
  if (!code || !id) return res.status(400).json({ error: 'code e id sono obbligatori' });
  const { error } = await supabase.from(SCAN_TABLE).delete().eq('code', code).eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ ok: true });
}

async function handleScanPost(req, res) {
  const body = req.body || {};
  const code = cleanCode(body.code);
  const { username, digimonName, crestName, digimentalName, attemptNumber } = body;
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

  // Stesso controllo anti-doppione, ma sul Crest (incluso Miracoli/Destino): non dovrebbe mai
  // scattare, perché il client sceglie già solo tra i Crest disponibili — è una rete di sicurezza
  // contro race condition tra due scan quasi simultanei.
  if (crestName) {
    const { data: dupCrestRows, error: dupCrestErr } = await supabase
      .from(SCAN_TABLE)
      .select('username')
      .eq('code', code)
      .eq('crest_name', crestName);
    if (dupCrestErr) return res.status(500).json({ error: dupCrestErr.message });
    if ((dupCrestRows || []).length > 0) {
      return res.status(409).json({ error: 'Questo Crest è già stato assegnato a un altro Tamer della campagna.' });
    }
  }

  const { error: insErr } = await supabase.from(SCAN_TABLE).insert({
    code,
    username,
    digimon_name: digimonName,
    crest_name: crestName || null,
    digimental_name: digimentalName || null,
    attempt_number: attemptNumber || ((mineRows || []).length + 1)
  });
  if (insErr) {
    if (insErr.code === '23505') {
      return res.status(409).json({ error: 'Questo Digimon o questo Crest sono appena stati assegnati a un altro Tamer — riprova lo scan.' });
    }
    return res.status(500).json({ error: insErr.message });
  }

  return res.status(200).json({ ok: true });
}

// ---------- BLOCCO ORIGINALE: upload immagine (invariato) ----------
async function handleImageUpload(req, res) {
  const { code, dataUrl, folder, target } = req.body || {};
  const campaignCode = cleanCode(code);
  if (!campaignCode) return res.status(400).json({ error: 'missing code' });

  if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
    return res.status(400).json({ error: 'missing or invalid image data' });
  }
  const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
  if (!match) return res.status(400).json({ error: 'unsupported image encoding' });

  const mime = match[1];
  if (!mime.startsWith('image/')) return res.status(400).json({ error: 'only image files are allowed' });

  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length > MAX_BYTES) {
    return res.status(400).json({ error: 'immagine troppo grande (limite 3MB), comprimila e riprova' });
  }

  // target seleziona il bucket. Se non specificato o non riconosciuto, ricade su 'sector'
  // per non rompere le chiamate esistenti da map.html (che non mandano alcun target).
  const cfg = TARGETS[target] || TARGETS.sector;
  const BUCKET = cfg.bucket;

  const ext = (mime.split('/')[1] || 'png').split('+')[0].toLowerCase();
  const fileName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;

  let path;
  if (cfg.defaultFolder) {
    // 'folder' è opzionale e sanificato: distingue es. 'chat' da 'avviso' dentro chat-uploads.
    const safeFolder = String(folder || cfg.defaultFolder).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) || cfg.defaultFolder;
    path = `${campaignCode}/${safeFolder}/${fileName}`;
  } else {
    // comportamento originale invariato per i settori mappa
    path = `${campaignCode}/${fileName}`;
  }

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: mime, upsert: false });
  if (uploadError) return res.status(500).json({ error: uploadError.message });

  const { data: publicUrlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return res.status(200).json({ ok: true, url: publicUrlData.publicUrl });
}

// ---------- BLOCCO NUOVO: upload tracce audio Scena (bucket dedicato campaign-audio) ----------
// Stesso schema del blocco immagini sopra, ma con mime/limite dedicati all'audio e bucket
// separato. Attivo solo con resource === 'audio'; il resto del file resta invariato.
const AUDIO_BUCKET = 'campaign-audio';
const MAX_AUDIO_BYTES = 3 * 1024 * 1024; // stesso tetto delle immagini, per restare sotto al body limit ~4.5MB di Vercel dopo l'inflazione base64

async function handleAudioUpload(req, res) {
  const { code, dataUrl } = req.body || {};
  const campaignCode = cleanCode(code);
  if (!campaignCode) return res.status(400).json({ error: 'missing code' });

  if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
    return res.status(400).json({ error: 'missing or invalid audio data' });
  }
  const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
  if (!match) return res.status(400).json({ error: 'unsupported audio encoding' });

  const mime = match[1];
  if (!mime.startsWith('audio/')) return res.status(400).json({ error: 'only audio files are allowed' });

  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length > MAX_AUDIO_BYTES) {
    return res.status(400).json({ error: 'traccia troppo grande (limite ~3MB): comprimi il file o abbassa il bitrate e riprova' });
  }

  const ext = (mime.split('/')[1] || 'mp3').split('+')[0].toLowerCase();
  const fileName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const path = `${campaignCode}/${fileName}`;

  const { error: uploadError } = await supabase.storage
    .from(AUDIO_BUCKET)
    .upload(path, buffer, { contentType: mime, upsert: false });
  if (uploadError) return res.status(500).json({ error: uploadError.message });

  const { data: publicUrlData } = supabase.storage.from(AUDIO_BUCKET).getPublicUrl(path);
  return res.status(200).json({ ok: true, url: publicUrlData.publicUrl });
}

// ---------- ROUTER ----------
module.exports = async (req, res) => {
  try {
    const resourceGet = req.method === 'POST' ? (req.body && req.body.resource) : (req.query && req.query.resource);

    if (resourceGet === 'scan') {
      if (req.method === 'GET') return await handleScanGet(req, res);
      if (req.method === 'POST') return await handleScanPost(req, res);
      if (req.method === 'DELETE') return await handleScanDelete(req, res);
      res.setHeader('Allow', 'GET, POST, DELETE');
      return res.status(405).json({ error: 'method not allowed' });
    }

    if (resourceGet === 'crestImages') {
      if (req.method === 'GET') return await handleCrestImagesGet(req, res);
      if (req.method === 'POST') return await handleCrestImagesPost(req, res);
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ error: 'method not allowed' });
    }

    if (resourceGet === 'audio') {
      if (req.method === 'POST') return await handleAudioUpload(req, res);
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'method not allowed' });
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'method not allowed' });
    }
    return await handleImageUpload(req, res);
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
};
