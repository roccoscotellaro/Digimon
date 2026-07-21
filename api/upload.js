const { supabase, cleanCode } = require('../lib/db');

const BUCKET = 'campaign-images';
const MAX_BYTES = 3 * 1024 * 1024; // 3MB decoded (~4MB as base64) — stays under typical serverless body limits

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'method not allowed' });
    }

    const { code, dataUrl } = req.body || {};
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

    const ext = (mime.split('/')[1] || 'png').split('+')[0].toLowerCase();
    const path = `${campaignCode}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;

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
