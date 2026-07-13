module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'method not allowed' });
    }
    const { digimonName, personality, context } = req.body || {};
    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: 'GEMINI_API_KEY non configurata su Vercel' });
    }

    const system = "Sei un aiuto-regista per un gioco di ruolo testuale ambientato nel mondo di Digimon. Genera esattamente 3 possibili battute brevi (massimo 20 parole ciascuna) che il Digimon indicato potrebbe pronunciare ora, coerenti con la sua personalità e con il contesto recente. Rispondi SOLO con un array JSON di 3 stringhe in italiano, senza altro testo, senza markdown.";

    const userText = `Digimon: ${digimonName || 'Digimon'}\nPersonalità: ${personality || 'non specificata, usa un tono neutro da compagno leale'}\nContesto recente:\n${context || '(nessun contesto precedente)'}`;

    const model = 'gemini-2.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;

    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: [{ parts: [{ text: userText.slice(0, 4000) }] }],
        generationConfig: { responseMimeType: 'application/json' }
      })
    });

    const data = await r.json();
    if (!r.ok) return res.status(502).json({ error: data.error ? data.error.message : 'errore Gemini API' });

    const raw = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts
      ? data.candidates[0].content.parts.map(p => p.text || '').join('\n')
      : '').trim();

    let lines;
    try {
      const clean = raw.replace(/```json|```/g, '').trim();
      lines = JSON.parse(clean);
      if (!Array.isArray(lines)) lines = [raw];
    } catch (e) {
      lines = [raw || '(nessuna risposta generata, riprova)'];
    }
    return res.status(200).json({ lines: lines.slice(0, 3) });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
};
