// /api/log.js
// Accorpa il vecchio /api/private-log: la discriminante e' il parametro `thread`.
//
//   GET    /api/log?code=XXX                        -> log pubblico della campagna (tabella logs)
//   GET    /api/log?code=XXX&thread=Mario           -> log privato di quel thread (tabella private_logs)
//   POST   { code, username, who, text, ... }        -> scrive sul log pubblico
//   POST   { code, thread, username, who, text, ... } -> scrive sul log privato
//   PUT    { code, id, text, meta, who, role }        -> modifica un messaggio del log pubblico
//   PUT    { code, thread, id, text, meta, who, role } -> modifica un messaggio del log privato di quel thread
//   DELETE ?code=XXX&id=YYY                           -> elimina un messaggio dal log pubblico
//   DELETE ?code=XXX&clearAll=1                       -> svuota TUTTO il log pubblico della campagna
//   DELETE ?code=XXX&thread=Mario&id=YYY              -> elimina un messaggio dal log privato di quel thread
//
//   POST   /api/log?resource=push   { code, username, subscription } -> salva una sottoscrizione Web Push
//   DELETE /api/log?resource=push&endpoint=...                       -> rimuove una sottoscrizione Web Push
//
//   POST   /api/log?resource=turn-ping   { code, username, title, body } -> Web Push mirata a UN
//     solo giocatore (es. "è il tuo turno" in combattimento), SENZA scrivere nulla in nessun log
//     (pubblico, privato o sottogruppo). Aggiunta per la richiesta "notifica solo a chi tocca il
//     turno, mai in chat pubblica" (vedi advanceCombatTurn/jumpToCombatTurn/notifyTurnPush in
//     index.html) — riusa la stessa infrastruttura di sendPushToSubscriptions/subsForUsername già
//     usata per i messaggi privati, ma senza toccare "logs"/"private_logs". Se il giocatore non ha
//     Web Push attive (nessuna riga in push_subscriptions), non fa nulla: resta il solo banner
//     visibile in pagina, gestito lato client.
//     AGGIORNAMENTO (2026-09-21, "Centro Notifiche Combattimento"): accetta anche `usernames`
//     (array) al posto di `username` singolo — usato per i nuovi trigger automatici che devono
//     raggiungere PIÙ giocatori in un colpo solo (tiro richiesto dal Master a più persone, un
//     Digimon qualsiasi sconfitto -> avviso a TUTTI i PC in combattimento). `username` singolo
//     resta supportato per compatibilità con le chiamate esistenti (avviso di turno).
//
//   POST   /api/log?resource=loot-claim { code, thread?, id, username, qty? } -> un giocatore prende
//     il bottino di un messaggio 'loot' (meta.loot) e se lo ritrova in Inventario — vedi
//     handleLootClaim. Aggiunta 2026-09-25, stesso file per restare sotto le 12 Functions.
//
// `username` nel body di POST identifica CHI sta scrivendo (a differenza di `who`, che e' il nome
// mostrato in UI — puo' essere il characterName). Serve solo per sapere chi ESCLUDERE quando si
// spedisce la Web Push del nuovo messaggio (non ha senso notificare a se stessi il proprio messaggio):
// non viene salvato nella riga del log, e se manca semplicemente non si esclude nessuno.
//
// Serve a restare sotto il limite di 12 Serverless Functions del piano Vercel Hobby.
const { supabase, cleanCode } = require('../lib/db');
const webpush = require('web-push');

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:noreply@example.com';
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

// Spedisce una Web Push a un elenco di sottoscrizioni (righe di push_subscriptions) e ripulisce
// da sole quelle scadute/revocate (404/410 = il browser non le riconosce piu'). Non lancia mai
// eccezioni verso il chiamante: un fallimento di invio non deve mai far fallire la scrittura del
// messaggio nel log, che e' l'azione principale. Se le chiavi VAPID non sono configurate su
// Vercel, non fa nulla silenziosamente (permette di deployare senza Web Push attive).
async function sendPushToSubscriptions(subs, payload) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.warn('[push] VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY non configurate su Vercel: invio push saltato.');
    return;
  }
  if (!subs || !subs.length) {
    console.log('[push] nessuna sottoscrizione da notificare per questo messaggio.');
    return;
  }
  const body = JSON.stringify(payload);
  const staleIds = [];
  await Promise.allSettled(subs.map(async (s) => {
    try {
      await webpush.sendNotification({
        endpoint: s.endpoint,
        keys: { p256dh: s.p256dh, auth: s.auth }
      }, body, {
        // urgency:'high' e TTL bassa dicono al servizio push (FCM per Chrome/Edge, APNs per
        // Safari, ecc.) di consegnare la notifica il prima possibile invece di raggrupparla
        // con altro traffico a bassa priorità — è l'unica leva che abbiamo sui tempi di
        // consegna: da qui in poi decide il servizio push del browser, non il nostro server.
        urgency: 'high',
        TTL: 60
      });
      console.log('[push] inviata con successo a', s.username, s.endpoint.slice(0, 60) + '...');
    } catch (err) {
      console.error('[push] invio FALLITO a', s.username, '- statusCode:', err && err.statusCode, '- messaggio:', err && err.message);
      if (err && (err.statusCode === 404 || err.statusCode === 410)) staleIds.push(s.id);
    }
  }));
  if (staleIds.length) {
    await supabase.from('push_subscriptions').delete().in('id', staleIds);
  }
}

// Recupera le sottoscrizioni di TUTTI i membri della campagna tranne (facoltativamente) chi ha
// appena scritto — usata per il log pubblico, che tutti vedono.
async function subsForCampaign(campaignCode, excludeUsername) {
  let q = supabase.from('push_subscriptions').select('*').eq('campaign_code', campaignCode);
  if (excludeUsername) q = q.neq('username', excludeUsername);
  const { data } = await q;
  return data || [];
}

// Recupera le sottoscrizioni del/dei Master di una campagna — usata quando un GIOCATORE scrive
// nel proprio thread privato (il destinatario e' il Master, non tutta la campagna).
async function subsForMasters(campaignCode) {
  const { data: masters } = await supabase.from('members').select('username').eq('campaign_code', campaignCode).eq('role', 'master');
  const usernames = (masters || []).map(m => m.username);
  if (!usernames.length) return [];
  const { data } = await supabase.from('push_subscriptions').select('*').eq('campaign_code', campaignCode).in('username', usernames);
  return data || [];
}

// Recupera le sottoscrizioni di un singolo username — usata quando il Master scrive nel thread
// privato di un giocatore (il destinatario e' quel giocatore), e ora anche dal nuovo resource
// "turn-ping" (avviso di turno mirato a un solo giocatore, senza scrivere in nessun log).
async function subsForUsername(campaignCode, username) {
  const { data } = await supabase.from('push_subscriptions').select('*').eq('campaign_code', campaignCode).eq('username', username);
  return data || [];
}

// Come subsForUsername ma per PIÙ username in un colpo solo (Centro Notifiche Combattimento:
// tiro richiesto a più giocatori, Digimon sconfitto -> avviso a tutti i PC in combattimento).
async function subsForUsernames(campaignCode, usernames) {
  const list = Array.from(new Set((usernames || []).filter(Boolean)));
  if (!list.length) return [];
  const { data } = await supabase.from('push_subscriptions').select('*').eq('campaign_code', campaignCode).in('username', list);
  return data || [];
}

// Recupera le sottoscrizioni dei destinatari di un SOTTOGRUPPO di chat (thread nel formato
// "subgroup:<id>"): i membri del gruppo (tabella `subgroups`, gestita da api/notice.js) più
// tutti i Master della campagna, esclusa la persona che ha appena scritto — altrimenti nessuno
// veniva mai avvisato di un nuovo messaggio nel gruppo (il vecchio codice cercava per errore un
// "username" letterale uguale al thread, che non esiste mai).
async function subsForSubgroup(campaignCode, threadValue, excludeUsername) {
  const groupId = String(threadValue).slice('subgroup:'.length);
  const { data: group } = await supabase.from('subgroups').select('members').eq('code', campaignCode).eq('id', groupId).maybeSingle();
  const memberUsernames = Array.isArray(group && group.members) ? group.members : [];
  const { data: masters } = await supabase.from('members').select('username').eq('campaign_code', campaignCode).eq('role', 'master');
  const masterUsernames = (masters || []).map(m => m.username);
  const usernames = Array.from(new Set([...memberUsernames, ...masterUsernames])).filter(u => u !== excludeUsername);
  if (!usernames.length) return [];
  const { data } = await supabase.from('push_subscriptions').select('*').eq('campaign_code', campaignCode).in('username', usernames);
  return data || [];
}

// ===== Lettura ristretta per Settore (Chat Generale) =====
// Richiesta di Rocco: "rendere non leggibili le chat a chi non è in quel settore" — i messaggi
// della Chat Generale marcati con un Settore (meta.location, vedi pushLog/currentLocationKey in
// index.html) non devono essere leggibili da un giocatore che non si trova ATTUALMENTE in quel
// Settore, anche se conosce/indovina il codice campagna. Prima questo endpoint restituiva SEMPRE
// l'intero log pubblico a chiunque lo chiedesse: il filtro "Storico per Settore" lato client
// (filterByLocation in js/chat-log-engine.js) era solo un comodo modo per RIVEDERE lo storico, non
// una vera restrizione — i dati di ogni Settore arrivavano comunque al browser di tutti.
//
// L'app non ha vere password (login = codice campagna + username + ruolo autodichiarati, senza
// verifica — vedi roster.js/index.html): questo filtro si affida quindi allo `username` che il
// client dichiara di essere (stesso modello di fiducia già usato ovunque nel resto del sito), non
// a un'autenticazione vera. Chiude l'accesso "normale" tramite l'app; non è pensato per resistere
// a chi manomette deliberatamente le chiamate API.
//
// findSectorAnywhere/computeMemberLocationKey rispecchiano ESATTAMENTE findSectorAnywhere/
// memberLocationKey di js/chat-log-engine.js (stessa identica chiave, ora a 4 parti dopo
// l'introduzione delle Sottosezioni: "macroId|settoreId|sottosezioneId|luogoId"), così un
// messaggio marcato lato client risulta visibile/non visibile in modo coerente qui.
//
// AGGIORNAMENTO ("chat del luogo duplicate" + "non perdere la chat di dove sei già stato",
// richiesta Rocco): due modifiche.
//
// 1) normalizeLocationKey (mirror di js/chat-log-engine.js): i messaggi marcati PRIMA
//    dell'introduzione delle Sottosezioni hanno una chiave a 3 parti (macroId|settoreId|luogoId,
//    senza Sottosezione), quelli marcati dopo ne hanno 4. Confrontare le chiavi grezze faceva sì
//    che un vecchio e un nuovo messaggio dello STESSO luogo fisico non facessero mai match tra
//    loro — lato client questo si vedeva come lo stesso luogo duplicato due volte nel filtro
//    "Storico per Settore"; qui sotto significava anche che filterLogForRequester poteva negare
//    l'accesso a messaggi che in realtà riguardavano il luogo giusto. Normalizzando entrambi i
//    lati del confronto al formato a 4 parti prima di paragonarli, il problema sparisce senza
//    bisogno di toccare i dati già salvati (la normalizzazione avviene solo in lettura).
//
// 2) unlockedLocationKeys: prima, un giocatore vedeva SOLO i messaggi del suo luogo ATTUALE (al
//    momento della richiesta) — appena si spostava, perdeva l'accesso anche allo storico passato
//    del luogo che aveva appena lasciato (anche ai messaggi letti mentre era ancora lì). Rocco ha
//    chiesto di non perdere la chat di un luogo già visitato: ora ogni membro tiene, dentro
//    member.tamer.unlockedLocationKeys, l'elenco di TUTTE le chiavi di posizione in cui è stato
//    presente almeno una volta (aggiornato pigramente qui sotto, alla prima GET fatta da quella
//    posizione); filterLogForRequester lascia passare un messaggio se la sua chiave di posizione è
//    tra quelle "sbloccate" per il richiedente, non solo se coincide con quella attuale. Lo
//    sblocco resta permanente (non si "ri-blocca" quando il giocatore se ne va) e continua a
//    valere anche per i messaggi scritti in quel luogo DOPO che il giocatore se n'è andato — è un
//    "hai diritto di seguire quel luogo" una volta che ci sei stato, non un'istantanea congelata
//    al momento della partenza. Nessuna migrazione SQL: il campo vive nella colonna JSONB
//    `tamer` già esistente su `members`.
function findSectorAnywhere(macroScenes, sectorId) {
  if (!sectorId) return null;
  for (const m of (macroScenes || [])) {
    const s = (m.sectors || []).find(x => x.id === sectorId);
    if (s) return { sector: s, macro: m };
  }
  return null;
}

function computeMemberLocationKey(scene, member) {
  const tamer = (member && member.tamer) || {};
  const sectorOverride = tamer.currentSectorId || null;
  const sectorId = sectorOverride || (scene && scene.currentSectorId) || null;
  let luogoId;
  if (tamer.currentLuogoId) luogoId = tamer.currentLuogoId;
  else if (sectorOverride) luogoId = null; // Settore proprio senza Luogo: non eredita quello di gruppo
  else luogoId = (scene && scene.currentLuogoId) || null;
  // Stesso pattern di luogoId qui sopra, un livello più in alto (vedi memberEffectiveSubsectionId
  // in js/chat-log-engine.js): un override esplicito di Sottosezione vince, altrimenti chi si è
  // separato a livello di Settore non eredita la Sottosezione del gruppo, altrimenti la segue.
  let subsectionId;
  if (tamer.currentSubsectionId) subsectionId = tamer.currentSubsectionId;
  else if (sectorOverride) subsectionId = null;
  else subsectionId = (scene && scene.currentSubsectionId) || null;
  const found = sectorId ? findSectorAnywhere(scene && scene.macroScenes, sectorId) : null;
  const macroId = found ? found.macro.id : ((scene && scene.currentMacroSceneId) || null);
  return `${macroId || '_'}|${sectorId || '_'}|${subsectionId || '_'}|${luogoId || '_'}`;
}

// Vedi punto 1) della nota di testa qui sopra.
function normalizeLocationKey(key) {
  if (!key) return key;
  const parts = String(key).split('|');
  if (parts.length === 3) return `${parts[0]}|${parts[1]}|_|${parts[2]}`;
  return key;
}

// Filtra un elenco di righe del log pubblico per i luoghi SBLOCCATI da `requesterUsername` (il
// luogo attuale più ogni altro luogo in cui è già stato presente almeno una volta — vedi punto 2
// della nota di testa). Nessun filtro (log invariato) se: manca requesterUsername (chiamante non
// ancora aggiornato a mandarlo, o pagina diversa dal Tavolo), il membro non esiste ancora sul
// roster, o è il Master (vede sempre tutto, come nel pannello Master di sempre). I messaggi senza
// meta.location (scritti prima di questa funzione, o di sistema) restano SEMPRE visibili,
// esattamente come già fa il filtro client-side storico.
async function filterLogForRequester(campaignCode, rows, requesterUsername) {
  if (!requesterUsername) return rows;
  const { data: member } = await supabase.from('members').select('id, role, tamer').eq('campaign_code', campaignCode).eq('username', requesterUsername).maybeSingle();
  if (!member || member.role === 'master') return rows;
  // Richiesta utente (Rocco): blocco manuale TOTALE della Chat Generale (generalChatLocked, vedi
  // js/tamer-card.js defaultTamer) — in aggiunta all'automatismo per presenza qui sotto, non in
  // sostituzione. Un giocatore bloccato non vede NESSUN messaggio di Generale, nemmeno quelli
  // senza meta.location (di norma sempre visibili) — enforcement qui lato server così non basta
  // modificare il client per aggirarlo.
  if (member.tamer && member.tamer.generalChatLocked) return [];
  // currentSubsectionId può non esistere ancora come colonna (vedi api/state.js, fallback
  // "colonna mancante"): select('*') invece di elencare le colonne esplicitamente evita che questa
  // query fallisca del tutto su installazioni senza la migrazione SQL ancora eseguita.
  const { data: scene } = await supabase.from('scenes').select('*').eq('campaign_code', campaignCode).maybeSingle();
  const myKey = normalizeLocationKey(computeMemberLocationKey(scene, member));

  const tamer = member.tamer || {};
  const visited = Array.isArray(tamer.unlockedLocationKeys) ? tamer.unlockedLocationKeys.map(normalizeLocationKey) : [];
  if (!visited.includes(myKey)) {
    // Prima visita a questo luogo (rilevata pigramente, alla prima lettura del log fatta da lì):
    // lo aggiungiamo alla lista permanente e la salviamo. SELECT + merge + UPDATE sul solo campo
    // unlockedLocationKeys (stesso pattern di rischio, minore, già accettato altrove in questo
    // codebase per i salvataggi "di contorno" — un eventuale aggiornamento perso qui non cancella
    // dati del giocatore, si ripresenta identico al prossimo polling, quindi non richiede il
    // meccanismo più cauto di roster.js/resource=patch).
    const newVisited = visited.concat([myKey]).slice(-300);
    const newTamer = Object.assign({}, tamer, { unlockedLocationKeys: newVisited });
    const { error: updateError } = await supabase.from('members').update({ tamer: newTamer }).eq('id', member.id);
    if (!updateError) visited.push(myKey);
  }

  return rows.filter(l => !(l.meta && l.meta.location) || visited.includes(normalizeLocationKey(l.meta.location)));
}

// Testo della Web Push a partire dal testo del messaggio: toglie i marcatori tecnici (::TECH::,
// ::REQ::, ::RATIONREQ::, ::MOVEREQ::, ...) e tutto ciò che li segue — il loro payload
// (username|id...) è pensato solo per il client che disegna i bottoni, non per essere letto in
// una notifica sul telefono (prima arrivava es. "...consumi questo Rest?::RATIONREQ::mario|1790...").
function pushBodyFromText(text) {
  const raw = String(text || '');
  const idx = raw.indexOf('::');
  const shown = (idx >= 0 ? raw.slice(0, idx) : raw).trim();
  return (shown || raw).slice(0, 140);
}

// ===== Loot in chat (resource=loot-claim) =====
// Richiesta Rocco 2026-09-25: il Master pubblica in chat un messaggio di bottino (role 'loot',
// dati in meta.loot = { v, name, qty, category, desc, mode, allowed, claims }) e chi ci clicca si
// aggiunge l'oggetto all'Inventario. Modalità:
//   'each'  -> stessa quantità (qty) a ciascun giocatore ammesso, una volta sola a testa;
//   'pool'  -> qty è il TOTALE da spartire: ognuno prende quanto chiede finché ne resta, una
//              volta sola a testa;
//   'first' -> il primo che clicca prende tutto (qty), poi il bottino è esaurito.
// "Evitare doppioni", su due livelli:
//   1) mai due prese dallo stesso giocatore sullo stesso messaggio (claims[username]);
//   2) nell'Inventario un oggetto con stesso nome (senza distinzione maiuscole/spazi) e stessa
//      Categoria già presente viene SOMMATO (qty +=) invece di creare una seconda riga uguale.
// Tutto avviene QUI, lato server, e non sul client: due giocatori che cliccano nello stesso
// istante su un bottino 'first'/'pool' non devono poterlo prendere entrambi. La presa è una
// compare-and-swap sul contatore meta.loot.v (UPDATE ... WHERE meta->loot->>v = <letto>): se
// nel frattempo qualcun altro ha già scritto, l'UPDATE non tocca nessuna riga e si rilegge e
// ricalcola (max 4 tentativi). L'Inventario viene poi aggiornato con SELECT + merge + UPDATE sul
// solo campo tamer.inventory (stesso pattern di roster.js resource=patch), senza passare dal
// client — così non dipende da una copia della Scheda magari vecchia di 15 secondi.
function lootItemKey(name, category) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ') + '|' + (category || 'altro');
}

function mergeIntoInventory(inventory, item, qty) {
  const inv = Array.isArray(inventory) ? inventory.map(it => Object.assign({}, it)) : [];
  const key = lootItemKey(item.name, item.category);
  const existing = inv.find(it => lootItemKey(it.name, it.category) === key);
  if (existing) {
    existing.qty = (Number(existing.qty) || 0) + qty;
    if (!existing.desc && item.desc) existing.desc = item.desc;
  } else {
    inv.push({ name: item.name, qty, desc: item.desc || '', category: item.category || 'altro' });
  }
  return inv;
}

async function handleLootClaim(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method not allowed' });
  }
  const { code, thread, id, username, qty } = req.body || {};
  const campaignCode = cleanCode(code);
  if (!campaignCode || !id || !username) return res.status(400).json({ error: 'missing code, id or username' });
  const table = thread ? 'private_logs' : 'logs';

  const { data: member, error: memberError } = await supabase.from('members').select('id, role, tamer').eq('campaign_code', campaignCode).eq('username', username).maybeSingle();
  if (memberError) return res.status(500).json({ error: memberError.message });
  if (!member) return res.status(404).json({ error: 'Giocatore non trovato nella campagna.' });
  if (member.role === 'master') return res.status(403).json({ error: 'Il Master non può prendere il bottino.' });

  let granted = 0;
  let loot = null;
  let claimed = false;
  for (let attempt = 0; attempt < 4 && !claimed; attempt++) {
    let q = supabase.from(table).select('id, role, meta').eq('campaign_code', campaignCode).eq('id', id);
    if (thread) q = q.eq('thread_username', thread);
    const { data: row, error: rowError } = await q.maybeSingle();
    if (rowError) return res.status(500).json({ error: rowError.message });
    if (!row || !row.meta || !row.meta.loot) return res.status(404).json({ error: 'Bottino non trovato (forse cancellato dal Master).' });
    loot = row.meta.loot;
    const claims = loot.claims || {};
    const allowed = Array.isArray(loot.allowed) ? loot.allowed : [];
    if (allowed.length && !allowed.includes(username)) return res.status(403).json({ error: 'Questo bottino non è destinato a te.' });
    if (claims[username] != null) return res.status(409).json({ error: 'Hai già preso questo bottino.' });
    const total = Math.max(1, Number(loot.qty) || 1);
    const takenSoFar = Object.values(claims).reduce((a, b) => a + (Number(b) || 0), 0);
    if (loot.mode === 'first') {
      if (Object.keys(claims).length) return res.status(409).json({ error: 'Qualcuno ha già preso questo bottino.' });
      granted = total;
    } else if (loot.mode === 'pool') {
      const remaining = total - takenSoFar;
      if (remaining <= 0) return res.status(409).json({ error: 'Il bottino è esaurito.' });
      granted = Math.max(1, Math.min(remaining, Math.floor(Number(qty) || 1)));
    } else {
      granted = total;
    }
    const v = Number(loot.v) || 0;
    const newLoot = Object.assign({}, loot, { v: v + 1, claims: Object.assign({}, claims, { [username]: granted }) });
    const newMeta = Object.assign({}, row.meta, { loot: newLoot });
    let u = supabase.from(table).update({ meta: newMeta }).eq('campaign_code', campaignCode).eq('id', id).eq('meta->loot->>v', String(v));
    if (thread) u = u.eq('thread_username', thread);
    const { data: updated, error: updError } = await u.select('id');
    if (updError) return res.status(500).json({ error: updError.message });
    if (updated && updated.length) { claimed = true; loot = newLoot; }
  }
  if (!claimed) return res.status(409).json({ error: 'Troppi click nello stesso istante: riprova.' });

  // Inventario: rilettura fresca (la Scheda può essere cambiata dopo la prima SELECT sopra).
  const { data: fresh, error: freshError } = await supabase.from('members').select('tamer').eq('id', member.id).maybeSingle();
  const tamer = (fresh && fresh.tamer) || member.tamer || {};
  const item = { name: loot.name, category: loot.category || 'altro', desc: loot.desc || '' };
  const newInventory = mergeIntoInventory(tamer.inventory, item, granted);
  const { error: invError } = freshError ? { error: freshError } : await supabase.from('members').update({ tamer: Object.assign({}, tamer, { inventory: newInventory }) }).eq('id', member.id);
  if (invError) {
    // Presa registrata ma Inventario non aggiornato: la annulliamo (best effort, senza CAS — nel
    // peggiore dei casi il bottino resta segnato come preso e il Master lo può riassegnare a mano).
    let q = supabase.from(table).select('meta').eq('campaign_code', campaignCode).eq('id', id);
    if (thread) q = q.eq('thread_username', thread);
    const { data: row } = await q.maybeSingle();
    if (row && row.meta && row.meta.loot) {
      const claims = Object.assign({}, row.meta.loot.claims || {});
      delete claims[username];
      const meta = Object.assign({}, row.meta, { loot: Object.assign({}, row.meta.loot, { v: (Number(row.meta.loot.v) || 0) + 1, claims }) });
      let u = supabase.from(table).update({ meta }).eq('campaign_code', campaignCode).eq('id', id);
      if (thread) u = u.eq('thread_username', thread);
      await u;
    }
    return res.status(500).json({ error: 'Inventario non aggiornato: ' + invError.message });
  }
  return res.status(200).json({ ok: true, granted, item, inventory: newInventory, loot });
}

module.exports = async (req, res) => {
  try {
    // ===== Sottoscrizioni Web Push (risorsa separata, stesso file per restare sotto il limite
    // di Serverless Functions) =====
    if (req.query && req.query.resource === 'push') {
      if (req.method === 'POST') {
        const { code, username, subscription } = req.body || {};
        const campaignCode = cleanCode(code);
        if (!campaignCode || !username || !subscription || !subscription.endpoint || !subscription.keys) {
          return res.status(400).json({ error: 'missing code, username or subscription' });
        }
        const { error } = await supabase.from('push_subscriptions').upsert({
          campaign_code: campaignCode,
          username: String(username).slice(0, 60),
          endpoint: subscription.endpoint,
          p256dh: subscription.keys.p256dh,
          auth: subscription.keys.auth
        }, { onConflict: 'endpoint' });
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ ok: true });
      }
      if (req.method === 'DELETE') {
        const endpoint = req.query.endpoint;
        if (!endpoint) return res.status(400).json({ error: 'missing endpoint' });
        const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ ok: true });
      }
      res.setHeader('Allow', 'POST, DELETE');
      return res.status(405).json({ error: 'method not allowed' });
    }

    // ===== Avviso mirato a uno o più giocatori (nessuna scrittura in nessun log) =====
    // Vedi commento in cima al file. Richiede solo VAPID configurate + il/i giocatore/i già
    // sottoscritti alle Web Push: altrimenti sendPushToSubscriptions non fa nulla, silenziosamente
    // (stesso comportamento "safe no-op" degli altri invii push di questo file).
    // Loot in chat — vedi handleLootClaim più sopra.
    if (req.query && req.query.resource === 'loot-claim') {
      return await handleLootClaim(req, res);
    }

    if (req.query && req.query.resource === 'turn-ping') {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ error: 'method not allowed' });
      }
      const { code, username, usernames, title, body } = req.body || {};
      const campaignCode = cleanCode(code);
      // Compatibilità: `username` singolo (chiamata storica, avviso di turno) oppure `usernames`
      // (array, nuovo — Centro Notifiche Combattimento: tiro richiesto a più giocatori, Digimon
      // sconfitto -> avviso a tutti i PC in combattimento). Se entrambi mancano, errore come prima.
      const targets = Array.isArray(usernames) && usernames.length
        ? usernames.filter(Boolean)
        : (username ? [username] : []);
      if (!campaignCode || !targets.length || !title) {
        return res.status(400).json({ error: 'missing code, username(s) or title' });
      }
      const recipientSubs = targets.length === 1
        ? await subsForUsername(campaignCode, targets[0])
        : await subsForUsernames(campaignCode, targets);
      await sendPushToSubscriptions(recipientSubs, {
        title: String(title).slice(0, 60),
        body: String(body || '').slice(0, 140),
        url: '/index.html',
        tag: 'dvos-push'
      }).catch(() => {});
      return res.status(200).json({ ok: true, sent: recipientSubs.length });
    }

    if (req.method === 'GET') {
      const code = cleanCode(req.query.code);
      if (!code) return res.status(400).json({ error: 'missing code' });

      const threadUsername = req.query.thread;

      // NOTA: qui sotto ordiniamo per id DESCENDING (dal più recente) prima di applicare il
      // limit, e poi ri-ordiniamo in ascending prima di rispondere. Con l'ordinamento inverso
      // (ascending + limit) la query restituiva sempre e solo i primi N messaggi in assoluto:
      // superata quella soglia, tutto ciò che veniva scritto dopo spariva per sempre dalla
      // risposta (la chat sembrava "bloccata"). Così facendo si ottengono sempre gli ultimi N
      // messaggi esistenti, quindi il limite si "auto-ripristina" da solo se vecchi messaggi
      // vengono cancellati (clearLog/deleteLogEntry): la finestra segue il conteggio reale delle
      // righe rimaste, non un cursore fisso sui primi N mai scritti.
      const LOG_FETCH_LIMIT = 2000; // 10x il precedente limite di 200

      if (threadUsername) {
        const { data, error } = await supabase
          .from('private_logs')
          .select('*')
          .eq('campaign_code', code)
          .eq('thread_username', threadUsername)
          .order('id', { ascending: false })
          .limit(LOG_FETCH_LIMIT);
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ log: (data || []).reverse() });
      }

      const { data, error } = await supabase
        .from('logs')
        .select('*')
        .eq('campaign_code', code)
        .order('id', { ascending: false })
        .limit(LOG_FETCH_LIMIT);
      if (error) return res.status(500).json({ error: error.message });
      // Vedi "Lettura ristretta per Settore" in cima al file: `username` (facoltativo, mandato
      // ora da getLog in index.html) identifica chi sta chiedendo il log pubblico — un giocatore
      // vede solo i messaggi dei luoghi che ha sbloccato (quello attuale + quelli già visitati in
      // passato, vedi filterLogForRequester), il Master vede sempre tutto come prima.
      const visibleLog = await filterLogForRequester(code, (data || []).reverse(), req.query.username);
      return res.status(200).json({ log: visibleLog });
    }

    if (req.method === 'POST') {
      const { code, thread, username, who, role, text, meta } = req.body || {};
      const campaignCode = cleanCode(code);

      if (thread) {
        if (!campaignCode || !who || !text) {
          return res.status(400).json({ error: 'missing code, thread, who or text' });
        }
        const { data, error } = await supabase.from('private_logs').insert({
          campaign_code: campaignCode,
          thread_username: String(thread).slice(0, 60),
          who: String(who).slice(0, 60),
          role: role || 'player',
          text: String(text).slice(0, 8000),
          meta: meta || null
        }).select().single();
        if (error) return res.status(500).json({ error: error.message });
        // Il destinatario del push dipende dal tipo di thread:
        //  - "subgroup:<id>"  -> tutti i membri del gruppo + i Master, tranne chi ha scritto
        //  - altrimenti (1:1) -> l'ALTRA parte del thread: se a scrivere e' il giocatore
        //    (username === thread) il push va al Master, altrimenti (scrive il Master) va al giocatore.
        // Aspettiamo l'invio prima di rispondere (invece di "spara e dimentica") perche' Vercel puo'
        // congelare la funzione non appena la risposta parte, interrompendo un invio ancora in corso.
        const isSubgroupThread = String(thread).startsWith('subgroup:');
        const recipientSubs = isSubgroupThread
          ? await subsForSubgroup(campaignCode, thread, username)
          : (username && username === thread)
            ? await subsForMasters(campaignCode)
            : await subsForUsername(campaignCode, thread);
        await sendPushToSubscriptions(recipientSubs, {
          title: isSubgroupThread ? `👥 ${String(who).slice(0, 60)} (gruppo)` : `✉️ ${String(who).slice(0, 60)} (privato)`,
          body: pushBodyFromText(text),
          url: '/index.html',
          tag: 'dvos-push'
        }).catch(() => {});
        return res.status(200).json({ entry: data });
      }

      if (!campaignCode || !who || !text) {
        return res.status(400).json({ error: 'missing code, who or text' });
      }
      // Richiesta utente (Rocco): blocco manuale TOTALE della Chat Generale (generalChatLocked) —
      // rifiuta anche il POST lato server, non solo il filtro in lettura qui sopra, così il
      // controllo lato client (index.html) resta solo un feedback immediato e non l'unica difesa.
      // `username` qui è sempre chi ha effettivamente premuto Invia (session.username, vedi
      // pushLog in js/chat-log-engine.js) — un Master che parla per conto di un NPC/Nemico posta
      // comunque come se stesso, quindi questo controllo non lo tocca mai per errore.
      if (username) {
        const { data: sender } = await supabase.from('members').select('role, tamer').eq('campaign_code', campaignCode).eq('username', username).maybeSingle();
        if (sender && sender.role !== 'master' && sender.tamer && sender.tamer.generalChatLocked) {
          return res.status(403).json({ error: 'Chat Generale bloccata dal Master per questo giocatore.' });
        }
      }
      await supabase.from('campaigns').upsert({ code: campaignCode }, { onConflict: 'code' });
      const { data, error } = await supabase.from('logs').insert({
        campaign_code: campaignCode,
        who: String(who).slice(0, 60),
        role: role || 'player',
        text: String(text).slice(0, 8000),
        meta: meta || null
      }).select().single();
      if (error) return res.status(500).json({ error: error.message });
      const recipientSubs = await subsForCampaign(campaignCode, username);
      await sendPushToSubscriptions(recipientSubs, {
        title: `💬 ${String(who).slice(0, 60)}`,
        body: pushBodyFromText(text),
        url: '/index.html',
        tag: 'dvos-push'
      }).catch(() => {});
      return res.status(200).json({ entry: data });
    }

    if (req.method === 'PUT') {
      // Aggiornamento di un messaggio già inviato: `text` sostituisce il testo come sempre, ma
      // ora accetta anche `who`/`role`/`meta` (opzionali) — servivano già dal client (vedi
      // editLogEntry/openEditLogModal in js/chat-log-engine.js, whoUpdate) per "Cambia chi ha
      // parlato" e per il voto di spostamento dei Sottogruppi (meta.moveVotes/moveResolved), ma
      // finora venivano ignorati silenziosamente qui: la richiesta tornava "ok" senza che nulla
      // (a parte il testo) fosse davvero salvato. `meta` viene FUSO con quello già presente sulla
      // riga (non sovrascritto), così un update parziale (es. solo moveVotes) non cancella altre
      // chiavi già in meta (image, digimoji, location, replyTo, ecc.) — richiede una lettura in
      // più prima dell'update, accettabile per il volume di traffico di questa app.
      const { code, thread, id, text, meta, who, role } = req.body || {};
      const campaignCode = cleanCode(code);
      if (!campaignCode || !id) return res.status(400).json({ error: 'missing code or id' });
      if (text === undefined && meta === undefined && who === undefined) {
        return res.status(400).json({ error: 'missing text, meta or who: nothing to update' });
      }

      const table = thread ? 'private_logs' : 'logs';
      let selectQuery = supabase.from(table).select('meta').eq('campaign_code', campaignCode).eq('id', id);
      if (thread) selectQuery = selectQuery.eq('thread_username', thread);
      const { data: existing, error: fetchError } = await selectQuery.maybeSingle();
      if (fetchError) return res.status(500).json({ error: fetchError.message });

      const patch = {};
      if (text !== undefined) patch.text = String(text).slice(0, 8000);
      if (who !== undefined) patch.who = String(who).slice(0, 60);
      if (role !== undefined) patch.role = role;
      if (meta !== undefined) patch.meta = Object.assign({}, (existing && existing.meta) || {}, meta);

      let updateQuery = supabase.from(table).update(patch).eq('campaign_code', campaignCode).eq('id', id);
      if (thread) updateQuery = updateQuery.eq('thread_username', thread);
      const { error } = await updateQuery;
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const code = cleanCode(req.query.code);
      const id = req.query.id;
      const thread = req.query.thread;
      const clearAll = req.query.clearAll === '1' || req.query.clearAll === 'true';
      if (!code) return res.status(400).json({ error: 'missing code' });

      if (thread) {
        if (!id) return res.status(400).json({ error: 'missing id' });
        const { error } = await supabase
          .from('private_logs')
          .delete()
          .eq('campaign_code', code)
          .eq('thread_username', thread)
          .eq('id', id);
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ ok: true });
      }

      if (clearAll) {
        const { error } = await supabase
          .from('logs')
          .delete()
          .eq('campaign_code', code);
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ ok: true, clearedAll: true });
      }

      if (!id) return res.status(400).json({ error: 'missing id (or pass clearAll=1)' });
      const { error } = await supabase
        .from('logs')
        .delete()
        .eq('campaign_code', code)
        .eq('id', id);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST, PUT, DELETE');
    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
};
