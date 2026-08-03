const { supabase, cleanCode } = require('../lib/db');

const MAX_BYTES = 3 * 1024 * 1024; // 3MB decoded (~4MB come base64) — resta sotto i limiti tipici del body delle funzioni serverless

const TARGETS = {
  sector: { bucket: 'campaign-images', defaultFolder: null },   // comportamento originale: nessuna sottocartella, path = {code}/{file}
  chat:   { bucket: 'chat-uploads',    defaultFolder: 'chat' }, // messaggi di chat e avvisi del Master
};

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'method not allowed' });
    }

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
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
};
