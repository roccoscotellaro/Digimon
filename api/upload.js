// /api/upload.js
// Riceve un'immagine come Data URL base64 e la carica su Supabase Storage,
// restituendo l'URL pubblico da salvare nel messaggio di chat (meta.image) o nell'avviso.
//
// NOTA PER ROCCO: se hai già un api/upload.js esistente (usato in futuro dal Digidex), confronta
// il nome del bucket e la firma della richiesta con quanto scritto qui e allinea uno dei due.
// Questo endpoint si aspetta: { code, filename, dataUrl, folder } nel body.
//
// Richiede che esista un bucket pubblico in Supabase Storage, es. "chat-uploads".
// SQL / dashboard: crea il bucket "chat-uploads" con accesso pubblico in lettura.
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const BUCKET = 'chat-uploads';

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', ['POST']);
      return res.status(405).json({ error: 'Metodo non permesso' });
    }

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
  } catch (e) {
    return res.status(500).json({ error: 'Errore interno: ' + e.message });
  }
};
