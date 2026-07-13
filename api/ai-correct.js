module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'method not allowed' });
    }
    const { text } = req.body || {};
    if (!text || !String(text).trim()) return res.status(400).json({ error: 'missing text' });
    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: 'GEMINI_API_KEY non configurata su Vercel' });
    }

    const system = "Correggi solo grammatica, ortografia e punteggiatura italiana del testo che segue, senza cambiare tono, stile o significato. Rispondi SOLO con il testo corretto, nessun commento, nessuna virgoletta.";

    const model = 'gemini-2.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;

    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: [{ parts: [{ text: String(text).slice(0, 4000) }] }]
      })
    });

    const data = await r.json();
    if (!r.ok) return res.status(502).json({ error: data.error ? data.error.message : 'errore Gemini API' });

    const corrected = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts
      ? data.candidates[0].content.parts.map(p => p.text || '').join('\n')
      : '').trim();

    return res.status(200).json({ corrected: corrected || String(text) });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
};
