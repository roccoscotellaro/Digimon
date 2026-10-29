// /api/ai.js
// Accorpa /api/ai-correct e /api/ai-suggest in un unico endpoint, instradato da `mode`:
//
//   mode: 'correzione'          -> ex /api/ai-correct   -> risponde { corrected }
//   mode: 'narrazione-attacco'  -> 1 frase narrativa    -> risponde { lines }
//   mode: 'narrazione-movimento'-> 1 frase narrativa    -> risponde { lines }
//   mode: 'voce-digimon'        -> 3 battute del Digimon partner (parere chiesto dal giocatore o
//                                  battuta spontanea dopo un silenzio) -> risponde { lines }
//   (default / assente)         -> 3 battute suggerite  -> risponde { lines }
//
// Le risposte mantengono la stessa forma di prima, quindi lato client cambia solo l'URL.
// Serve a restare sotto il limite di 12 Serverless Functions del piano Vercel Hobby.

const MODEL = 'gemini-flash-latest';

function geminiUrl() {
  return `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`;
}

function extractText(data) {
  return (data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts
    ? data.candidates[0].content.parts.map(p => p.text || '').join('\n')
    : '').trim();
}

// ---------------- CORREZIONE TESTO ----------------
async function handleCorrect(req, res) {
  const { text } = req.body || {};
  if (!text || !String(text).trim()) return res.status(400).json({ error: 'missing text' });

  const system = "Correggi solo grammatica, ortografia e punteggiatura italiana del testo che segue, senza cambiare tono, stile o significato. Rispondi SOLO con il testo corretto, nessun commento, nessuna virgoletta.";

  const r = await fetch(geminiUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: [{ parts: [{ text: String(text).slice(0, 4000) }] }]
    })
  });

  const data = await r.json();
  if (!r.ok) return res.status(502).json({ error: data.error ? data.error.message : 'errore Gemini API' });

  const corrected = extractText(data);
  return res.status(200).json({ corrected: corrected || String(text) });
}

// ---------------- BATTUTE / NARRAZIONE ----------------
// narrationType: 'attacco' | 'movimento' | null (null = 3 battute suggerite, il comportamento
// originale di questo endpoint prima che esistesse la narrazione di combattimento).
async function handleSuggest(req, res, narrationType) {
  const { digimonName, personality, context } = req.body || {};
  const wantedLines = narrationType ? 1 : 3;

  // Nonce di variazione: non viene mai citato nella risposta, serve solo a impedire
  // che, a parita' di attacco/contesto, il modello tenda a ripetere la stessa frase.
  const varietyNonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  const system = narrationType === 'attacco'
    ? "Sei il narratore di combattimento per un gioco di ruolo testuale ambientato nel mondo di Digimon. " +
      "Il messaggio dell'utente descrive un attacco (con nome, tag ed eventuale descrizione di riferimento) che un Digimon sta eseguendo ORA, anche quando l'attacco non ha una descrizione ufficiale predefinita. " +
      "Genera ESATTAMENTE 1 frase narrativa originale (massimo 25 parole), in italiano, che descriva l'attacco in azione in modo vivido e coerente col nome, i tag e lo stile della descrizione di riferimento se presente. " +
      "Ogni volta che ricevi questa richiesta, anche per lo stesso identico attacco, DEVI produrre una formulazione diversa dalle precedenti: cambia verbi, immagini, ritmo e dettagli sensoriali, senza mai riciclare la stessa frase o struttura di frase. " +
      "Non ripetere mai testualmente la descrizione di riferimento: usala solo come ispirazione di tono. " +
      "Rispondi SOLO con un array JSON contenente ESATTAMENTE 1 stringa in italiano, senza markdown, senza altro testo."
    : narrationType === 'movimento'
      ? "Sei il narratore di combattimento per un gioco di ruolo testuale ambientato nel mondo di Digimon. " +
        "Il messaggio dell'utente descrive uno spostamento che un Digimon sta compiendo ORA sulla linea delle distanze durante un combattimento (avvicinandosi o allontanandosi lungo la linea). " +
        "Genera ESATTAMENTE 1 frase narrativa originale (massimo 18 parole), in italiano, che descriva il movimento in azione in modo vivido, coerente con la direzione indicata e con lo stile/personalità del Digimon. " +
        "Ogni volta che ricevi questa richiesta, anche per lo stesso identico spostamento, DEVI produrre una formulazione diversa dalle precedenti: cambia verbi, immagini e ritmo, senza mai riciclare la stessa frase o struttura di frase. " +
        "Non è un attacco: non descrivere colpi, danni o effetti, solo il movimento. " +
        "Rispondi SOLO con un array JSON contenente ESATTAMENTE 1 stringa in italiano, senza markdown, senza altro testo."
      : "Sei un aiuto-regista per un gioco di ruolo testuale ambientato nel mondo di Digimon. Genera esattamente 3 possibili battute brevi (massimo 20 parole ciascuna) che il Digimon indicato potrebbe pronunciare ora, coerenti con la sua personalità e con il contesto recente. Rispondi SOLO con un array JSON di 3 stringhe in italiano, senza altro testo, senza markdown.";

  const userText = `Digimon: ${digimonName || 'Digimon'}\nPersonalità: ${personality || 'non specificata, usa un tono neutro da compagno leale'}\nContesto recente:\n${context || '(nessun contesto precedente)'}\n\n[variazione interna, non citare: ${varietyNonce}]`;

  const r = await fetch(geminiUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: [{ parts: [{ text: userText.slice(0, 4000) }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: narrationType ? 1.15 : 0.9,
        topP: 0.97,
        topK: 64
      }
    })
  });

  const data = await r.json();
  if (!r.ok) return res.status(502).json({ error: data.error ? data.error.message : 'errore Gemini API' });

  const raw = extractText(data);

  let lines;
  try {
    const clean = raw.replace(/```json|```/g, '').trim();
    lines = JSON.parse(clean);
    if (!Array.isArray(lines)) lines = [raw];
  } catch (e) {
    lines = [raw || '(nessuna risposta generata, riprova)'];
  }
  lines = lines.filter(l => typeof l === 'string' && l.trim().length > 0);
  if (lines.length === 0) lines = ['(nessuna risposta generata, riprova)'];
  return res.status(200).json({ lines: lines.slice(0, wantedLines) });
}

// ---------------- VOCE DEL DIGIMON PARTNER ----------------
// Richiesta Rocco 2026-10-29 (vedi js/digivoice.js): 3 battute fra cui il Master sceglie.
//   kind 'ask'   -> il giocatore ha chiesto il parere del suo Digimon (question = cosa ha chiesto,
//                   può essere vuota: allora è un "che ne pensi?" sulla situazione attuale);
//   kind 'idle'  -> il Digimon non parla da un po': una battuta spontanea su quanto sta succedendo.
async function handleDigimonVoice(req, res) {
  const b = req.body || {};
  const str = (v, n) => String(v || '').trim().slice(0, n);
  const digimonName = str(b.digimonName, 60) || 'Digimon';
  const kind = b.kind === 'idle' ? 'idle' : 'ask';
  const varietyNonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const system =
    "Sei la voce di un Digimon partner in un gioco di ruolo testuale ambientato nel mondo di Digimon (stile anime Digimon Adventure: avventura, amicizia, un pizzico di umorismo). " +
    "Il Digimon parla in prima persona al proprio Tamer e al gruppo. Rispetta RIGOROSAMENTE la personalità indicata, il suo modo di parlare e il suo livello (Stage): un Digimon Baby o In-Training è infantile e semplice, un Rookie è vivace, uno Champion o superiore è più maturo. " +
    "Se la personalità non è indicata, usa un tono da compagno leale e curioso. " +
    (kind === 'ask'
      ? "Il Tamer ha appena chiesto il suo parere: rispondi alla domanda (se c'è) o dai la tua opinione su cosa fare adesso, usando SOLO le informazioni del contesto recente. Dai un consiglio o un punto di vista utile, non risolvere la scena al posto dei giocatori e non inventare fatti, luoghi o personaggi che non compaiono nel contesto. "
      : "Il Digimon non parla da un po': genera una battuta spontanea e naturale su quanto sta accadendo ora nel contesto recente (una reazione, un'osservazione, una preoccupazione, una battuta, un'emozione). Non inventare fatti, luoghi o personaggi che non compaiono nel contesto e non far avanzare la trama. ") +
    "Genera ESATTAMENTE 3 alternative diverse tra loro per tono (es. una più seria, una più emotiva, una più leggera), ognuna di massimo 30 parole, in italiano, SENZA il nome del Digimon davanti e senza virgolette. " +
    "Puoi includere un brevissimo gesto fra asterischi (es. *agita la coda*) solo se aggiunge carattere. " +
    "Rispondi SOLO con un array JSON di 3 stringhe, senza markdown, senza altro testo.";
  const userText =
    `Digimon: ${digimonName}` +
    (b.species && str(b.species, 60) !== digimonName ? ` (specie: ${str(b.species, 60)})` : '') +
    `\nStage: ${str(b.stage, 30) || 'non indicato'}` +
    `\nPersonalità: ${str(b.personality, 800) || 'non specificata'}` +
    `\nTamer: ${str(b.tamerName, 60) || 'il suo Tamer'}` +
    (kind === 'ask' ? `\nDomanda del Tamer: ${str(b.question, 500) || '(nessuna domanda precisa: "che ne pensi?")'}` : '') +
    `\nContesto recente (dal più vecchio al più nuovo):\n${str(b.context, 3500) || '(nessun messaggio recente)'}` +
    `\n\n[variazione interna, non citare: ${varietyNonce}]`;
  const r = await fetch(geminiUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: [{ parts: [{ text: userText }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 1.0, topP: 0.95, topK: 64 }
    })
  });
  const data = await r.json();
  if (!r.ok) return res.status(502).json({ error: data.error ? data.error.message : 'errore Gemini API' });
  const raw = extractText(data);
  let lines;
  try {
    lines = JSON.parse(raw.replace(/```json|```/g, '').trim());
    if (!Array.isArray(lines)) lines = [raw];
  } catch (e) {
    lines = raw ? [raw] : [];
  }
  lines = lines.filter(l => typeof l === 'string' && l.trim()).map(l => l.trim().replace(/^["«“]|["»”]$/g, '')).slice(0, 3);
  if (!lines.length) return res.status(502).json({ error: 'nessuna battuta generata, riprova' });
  return res.status(200).json({ lines });
}

// ---------------- ROUTER ----------------
module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'method not allowed' });
    }
    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: 'GEMINI_API_KEY non configurata su Vercel' });
    }

    const mode = (req.body || {}).mode;

    if (mode === 'correzione' || mode === 'correct') return await handleCorrect(req, res);
    if (mode === 'narrazione-attacco') return await handleSuggest(req, res, 'attacco');
    if (mode === 'narrazione-movimento') return await handleSuggest(req, res, 'movimento');
    if (mode === 'voce-digimon') return await handleDigimonVoice(req, res);
    return await handleSuggest(req, res, null);
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
};
