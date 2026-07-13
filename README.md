# Digimon: Digital Adventures 2E — Tavolo Testuale (sito multi-utente)

Versione "vera" del tavolo testuale, pensata per essere pubblicata online e
raggiunta da più giocatori insieme, con dati salvati su un database reale e
assistenza IA (correzione italiano, suggerimenti di battute per i Digimon)
tramite l'**API gratuita di Google Gemini**.

A differenza del prototipo che gira dentro Claude.ai, questo NON usa
`window.storage` né chiama direttamente `api.anthropic.com` dal browser:
parla con delle funzioni serverless proprie (cartella `/api`), che a loro
volta parlano con Supabase (database) e con l'API di Google Gemini tenendo
la chiave al sicuro sul server.

**Nota sulla scelta di Gemini**: a differenza di Claude, l'API di Gemini ha
ancora (a metà 2026) un piano gratuito senza carta di credito, con limiti di
richieste giornaliere ampiamente sufficienti per un gruppo di gioco. Il
compromesso: sul piano gratuito Google può usare le richieste per migliorare
i propri modelli (dettagli nei loro termini di servizio) — se in futuro
preferisci più privacy o vuoi tornare a Claude, basta sostituire il contenuto
di `api/ai-correct.js` e `api/ai-suggest.js` con una chiamata a
`api.anthropic.com` usando una tua chiave Anthropic (a pagamento).

## Cosa serve (tutto gratuito per iniziare)

1. Un account [Supabase](https://supabase.com) — database
2. Un account [Vercel](https://vercel.com) — hosting + funzioni serverless
3. Una chiave API gratuita da [Google AI Studio](https://aistudio.google.com)
   (nessuna carta di credito richiesta per il piano gratuito)
4. Un account GitHub (per collegare il repo a Vercel)

## Passo 1 — Crea il database su Supabase

1. Vai su supabase.com, crea un account gratuito e un nuovo progetto (scegli
   una regione vicina a te, la password del database non serve per questo setup).
2. Nel progetto, apri **SQL Editor** → **New query**.
3. Incolla tutto il contenuto del file [`schema.sql`](./schema.sql) di questo
   repository ed esegui (RUN). Questo crea le tabelle `campaigns`, `members`,
   `scenes`, `logs`.
4. Vai su **Project Settings → API**. Ti servono due valori per dopo:
   - **Project URL** (es. `https://xxxxxxxx.supabase.co`)
   - **service_role key** (NON la `anon` key — quella "service_role" è segreta,
     va tenuta solo lato server)

## Passo 2 — Carica questo progetto su GitHub

```bash
git init
git add .
git commit -m "Sito multi-utente: DDA 2E tavolo testuale"
git branch -M main
git remote add origin https://github.com/TUO-USERNAME/NOME-REPO.git
git push -u origin main
```

## Passo 3 — Collega il repo a Vercel

1. Vai su vercel.com, accedi con GitHub, **Add New → Project**.
2. Seleziona il repository appena creato.
3. Framework Preset: lascialo su **Other** (il progetto non usa React/Next.js,
   solo HTML statico + funzioni serverless in `/api`, che Vercel riconosce da solo).
4. Prima di premere Deploy, apri **Environment Variables** e aggiungi:

   | Nome | Valore |
   |---|---|
   | `SUPABASE_URL` | il Project URL del Passo 1 |
   | `SUPABASE_SERVICE_KEY` | la service_role key del Passo 1 |
   | `GEMINI_API_KEY` | la tua chiave gratuita da aistudio.google.com |

5. Premi **Deploy**. Dopo un minuto avrai un URL tipo
   `https://nome-progetto.vercel.app` — quello è il sito da condividere con
   i giocatori.

Ad ogni `git push` su `main`, Vercel ripubblica automaticamente il sito.

## Come si gioca

- Ogni persona apre l'URL, sceglie un **codice campagna** condiviso (es.
  `FRONTIER01`), un nome utente, e il ruolo (Giocatore o Master).
- Chi entra con lo stesso codice campagna vede lo stesso registro, la stessa
  scena, e lo stesso roster.
- Il Master compone la scena (titolo, immagine di sfondo, musica) e vede il
  roster di tutti i giocatori con indicatore online/offline.
- Il Master può generare suggerimenti di battute per ogni Digimon in base alla
  personalità dichiarata dal giocatore, e sceglie quale pubblicare nel registro.

## Limiti attuali

- **Nessuna autenticazione reale.** Chiunque conosca il codice campagna può
  entrare con qualunque ruolo. Per un gruppo di amici va bene; per un uso più
  pubblico servirebbe aggiungere una password per campagna o un vero sistema
  di login (es. Supabase Auth).
- **Motore regole non implementato**: Check, Iniziativa, Danno, Clash,
  Evoluzione ecc. non sono automatizzati — il sito gestisce scena, schede e
  narrazione, non ancora i calcoli meccanici completi del regolamento.
- **Aggiornamento a polling** (ogni 4 secondi), non realtime via websocket:
  per un gruppo di gioco è più che sufficiente, ma non è istantaneo al 100%.
- **Niente upload di immagini/audio**: la scena richiede URL diretti a file
  già ospitati altrove.

## Struttura del progetto

```
.
├── index.html          # frontend (HTML/CSS/JS vanilla, nessuna build)
├── api/
│   ├── roster.js        # GET/POST scheda Tamer+Digimon dei giocatori
│   ├── scene.js          # GET/POST scena corrente (titolo, sfondo, musica)
│   ├── log.js             # GET/POST registro narrativo condiviso
│   ├── heartbeat.js       # POST presenza online (last_seen)
│   ├── ai-correct.js      # POST correzione italiano via Gemini
│   └── ai-suggest.js      # POST suggerimenti battute Digimon via Gemini
├── lib/
│   └── db.js              # client Supabase condiviso dalle funzioni /api
├── schema.sql              # script da eseguire una volta su Supabase
├── package.json
├── .env.example             # documenta le variabili richieste (non committare .env veri)
└── .gitignore
```

## Prossimi passi possibili

- Password per campagna (semplice hash lato server, senza account veri)
- Motore regole: Check Attributo+Skill, Iniziativa, Danno, Evoluzione
- Portrait dei personaggi visibili nella scena
- Passaggio a realtime vero (Supabase Realtime) invece del polling
