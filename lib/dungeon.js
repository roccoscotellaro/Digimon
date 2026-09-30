// lib/dungeon.js
// Dungeon a caselle (richiesta Rocco 2026-09-30). NON è una Serverless Function (vive in /lib,
// non in /api): viene richiamato da api/state.js con ?resource=dungeon, così il conteggio delle
// Functions del piano Vercel Hobby resta invariato.
//
// Tabella (una riga JSONB per campagna, stessa forma di gennai_state/game_clock) — migrazione da
// eseguire UNA VOLTA sul SQL Editor di Supabase:
//
//   create table if not exists dungeon_state (
//     campaign_code text primary key,
//     data jsonb not null default '{}'::jsonb,
//     updated_at timestamptz not null default now()
//   );
//
// Formato di `data`:
//   {
//     v: <contatore versione, per il compare-and-swap>,
//     activeId: <id del dungeon in cui si trova il gruppo, o null>,
//     party: {                       // UNA sola pedina per tutto il gruppo
//       leader: <username del Capofila o null>,
//       votes: { <username votante>: <username votato> },
//       points: <Punti Dungeon rimasti>, maxPoints: 5,
//       lastRefillAt: <ISO della prima spesa dopo una ricarica completa, o null>
//     },
//     dungeons: [{
//       id, name, desc, image, rows, cols,
//       grid:   [rows*cols] '.' vuoto/muro | 'f' pavimento | 'd' porta | 'e' ingresso | 'x' uscita
//       roomOf: [rows*cols] id stanza o null
//       rooms:  [{ id, name, desc, image }]
//       features: { <indice casella>: {
//         type:'trap', skill, tn, attr, text }        -> tiro richiesto al Capofila (::REQ::)
//         type:'loot', name, qty, category, desc, mode } -> messaggio Loot in chat
//         type:'encounter', encounterId, text }      -> avviso al Master
//         type:'lock', key, text }                   -> blocca il passaggio finché non sbloccata
//         type:'note', text }                        -> testo narrato all'ingresso
//       },
//       run: { pos, seen:[indici], revealedRooms:[id], fired:[indici], unlocked:[indici] }
//     }]
//   }
//
// Regole di movimento (confermate da Rocco):
//   - una sola pedina di gruppo; la muove solo il Capofila, eletto a maggioranza dai giocatori;
//   - una casella alla volta (4 direzioni); ogni passo costa 1 Punto Dungeon (e 1 minuto
//     dell'Orologio di Gioco, avanzato dal client che muove);
//   - 5 Punti di base; li ricarica il Master, oppure tornano pieni da soli 10 ore dopo la prima
//     spesa successiva all'ultima ricarica;
//   - niente movimento durante un combattimento attivo;
//   - entrare in una stanza la rivela tutta (resta scoperta); trappole, incontri e note restano
//     nascosti ai giocatori finché non scattano.
//
// Aggiunte 2026-09-30 (seconda richiesta di Rocco):
//   - caselle 'h' = terreno difficile (costa 2 Punti) e 's' = porta segreta (per i giocatori è
//     un muro finché non viene trovata: run.found);
//   - "🔍 Cerca": il Capofila può cercare UNA volta per ricarica (party.searchUsed), nella stanza in
//     cui si trova (tutto il suo contorno) oppure, in corridoio, attorno alla sua casella: le porte
//     segrete in quell'area vengono trovate. Non costa Punti (solo 1 minuto di Orologio);
//   - nuovi contenuti: 'teleport' (scale/teletrasporto verso un'altra casella, anche di un altro
//     dungeon), 'rest' (punto di ristoro: ricarica i Punti e la Ricerca; una volta sola o sempre),
//     'lever' (leva: sblocca porte chiuse e rivela porte segrete collegate);
//   - ogni contenuto può avere un'icona propria (emoji o URL di un'immagine: `icon`);
//   - le stanze possono mostrare la loro immagine direttamente sulla mappa (room.showOnMap).
//
// Collegamento a un luogo (quarta richiesta, 2026-09-30): un dungeon può essere collegato a un
// Settore (o a una Sottosezione) della Mappa — dg.link = { macroId, sectorId, subsectionId }.
// Il Master invita i giocatori a entrarci con il solito messaggio "Vuoi andare a…?" (::MOVEREQ::,
// stesse modalità ognuno/tutti/maggioranza/unanimità): il dungeon si attiva per chi accetta, perché
// da quel momento la sua posizione effettiva coincide con quella del dungeon. Per un dungeon
// collegato:
//   - lo vedono (GET) solo i giocatori che si trovano lì (il Master sempre);
//   - votano il Capofila, contano per la maggioranza e possono muovere/cercare SOLO i presenti;
//   - la risposta include `present` (gli username dei giocatori presenti).
// Un dungeon NON collegato si comporta come prima (tutto il party).
//
// Quinta richiesta (2026-09-30):
//   - dungeon collegabile anche a un LUOGO (dg.link.luogoId): serve trovarsi in quel Luogo;
//   - trappole: descrizione (text), tiro sì/no (roll), quale tiro (skill/attr/tn) e CHI tira (who:
//     'leader' Capofila | 'all' tutti i presenti | 'random' un presente a caso);
//   - porte chiuse ('lock' su una casella porta): chiave richiesta + consume (la chiave sparisce
//     dall'Inventario di chi la usa, consumeKeyFromInventory); nuovo contenuto 'key' (una chiave da
//     trovare nel dungeon, che esce in chat come bottino da prendere);
//   - AREA DI PROVA (op testStart/testMove/testSearch/testRefill, solo Master): la stessa logica di
//     move/search (performMove/performSearch) applicata a uno stato separato d.test + dg.testRun,
//     senza chat, senza Inventari veri (opzione testKeys = "fingi di avere tutte le chiavi").
//
// PORTE APERTE/CHIUSE (settima richiesta): ogni casella porta 'd' ha uno stato dinamico
// (doorState): 'open' | 'closed' (si apre passandoci: costa il passo, esce "apre la porta") |
// 'locked' (serve la chiave, contenuto 'lock') | 'barred' (sbarrata: solo una Leva o il Master).
// Stato iniziale dal disegno: nessun contenuto = aperta; contenuto 'door' {closed:true} = chiusa;
// 'lock' = chiusa a chiave. Durante il gioco run.doors[i] sovrascrive lo stato. Le trappole possono
// chiudere porte (trap.closeDoors = [indici], trap.closeMode 'closed' | 'barred'; con 'closed' una
// porta a chiave torna chiusa a chiave). Le leve aprono (anche le sbarrate). Il Master apre/chiude
// qualsiasi porta (op 'door'). Qualsiasi porta non aperta blocca la vista (fog of war).
// Tutte le scritture sono compare-and-swap su data->>v (stesso schema di loot/voto in api/log.js):
// il Capofila che muove e il Master che salva l'editor nello stesso istante non si cancellano a
// vicenda — chi perde la corsa rilegge e riapplica la propria operazione.

const TABLE = 'dungeon_state';
const REFILL_MS = 10 * 60 * 60 * 1000;
const MAX_SIDE = 40;
const WALKABLE = { f: 1, d: 1, e: 1, x: 1, h: 1, s: 1 };

function uid(prefix) {
  return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function emptyData() {
  return { v: 0, activeId: null, party: { leader: null, votes: {}, points: 5, maxPoints: 5, lastRefillAt: null, searchUsed: false }, dungeons: [] };
}

function normalizeData(d) {
  const out = Object.assign(emptyData(), d || {});
  out.party = Object.assign(emptyData().party, out.party || {});
  if (!out.party.votes || typeof out.party.votes !== 'object') out.party.votes = {};
  if (!Array.isArray(out.dungeons)) out.dungeons = [];
  out.dungeons.forEach(normalizeDungeon);
  return out;
}

function emptyRun() {
  return { pos: null, seen: [], revealedRooms: [], fired: [], unlocked: [], found: [], doors: {} };
}

// Stato attuale di una porta (vedi nota in testa al file).
// Una casella con serratura ('lock') conta come porta anche se non è disegnata come 🚪 (dungeon
// fatti prima di questa versione).
function isDoorCell(dg, i) {
  return dg.grid[i] === 'd' || !!(dg.features && dg.features[i] && dg.features[i].type === 'lock' && WALKABLE[dg.grid[i]]);
}
function doorState(dg, i) {
  if (!isDoorCell(dg, i)) return null;
  const run = dg.run || {};
  const ov = run.doors && run.doors[i];
  if (ov) return ov;
  const f = dg.features && dg.features[i];
  if (f && f.type === 'lock') return (run.unlocked || []).includes(i) ? 'open' : 'locked';
  if (f && f.type === 'door' && f.closed) return 'closed';
  return 'open';
}
function setDoor(dg, i, state) {
  if (!isDoorCell(dg, i)) return;
  if (!dg.run.doors || typeof dg.run.doors !== 'object') dg.run.doors = {};
  dg.run.doors[i] = state;
  if (state === 'open' && !dg.run.unlocked.includes(i) && dg.features[i] && dg.features[i].type === 'lock') dg.run.unlocked.push(i);
  if (state === 'locked') dg.run.unlocked = dg.run.unlocked.filter(x => x !== i);
}

function normalizeDungeon(dg) {
  dg.rows = clampSide(dg.rows);
  dg.cols = clampSide(dg.cols);
  const n = dg.rows * dg.cols;
  if (!Array.isArray(dg.grid)) dg.grid = [];
  if (!Array.isArray(dg.roomOf)) dg.roomOf = [];
  for (let i = 0; i < n; i++) {
    dg.grid[i] = WALKABLE[dg.grid[i]] ? dg.grid[i] : '.';
    if (!dg.roomOf[i]) dg.roomOf[i] = null;
  }
  dg.grid.length = n;
  dg.roomOf.length = n;
  if (!Array.isArray(dg.rooms)) dg.rooms = [];
  if (!dg.features || typeof dg.features !== 'object') dg.features = {};
  dg.run = Object.assign(emptyRun(), dg.run || {});
  ['seen', 'revealedRooms', 'fired', 'unlocked', 'found'].forEach(k => { if (!Array.isArray(dg.run[k])) dg.run[k] = []; });
  if (!dg.run.doors || typeof dg.run.doors !== 'object' || Array.isArray(dg.run.doors)) dg.run.doors = {};
  return dg;
}

function clampSide(x) {
  const n = Math.floor(Number(x) || 0);
  if (n < 3) return 3;
  if (n > MAX_SIDE) return MAX_SIDE;
  return n;
}

// Ricarica automatica "pigra": nessun cron, si applica ogni volta che si legge o si scrive.
// La ricarica rimette anche a disposizione la Ricerca (party.searchUsed).
function applyAutoRefill(party, now) {
  if (party.points >= party.maxPoints && !party.searchUsed) { party.lastRefillAt = null; return false; }
  if (party.lastRefillAt && now - new Date(party.lastRefillAt).getTime() >= REFILL_MS) {
    refillParty(party);
    return true;
  }
  return false;
}
function refillParty(party) {
  party.points = party.maxPoints;
  party.searchUsed = false;
  party.lastRefillAt = null;
}
// Il conto alla rovescia delle 10 ore parte dalla prima "spesa" (Punti o Ricerca) dopo una ricarica.
function startRefillClock(party, now) {
  if (!party.lastRefillAt) party.lastRefillAt = new Date(now).toISOString();
}
function isWalkable(dg, i, isMaster) {
  const t = dg.grid[i];
  if (!WALKABLE[t]) return false;
  if (t === 's' && !isMaster && !dg.run.found.includes(i)) return false;
  return true;
}
// Area della Ricerca: la stanza intera (e il suo contorno) se la pedina è in una stanza,
// altrimenti le 8 caselle attorno alla pedina.
function searchArea(dg, pos) {
  const area = new Set([pos]);
  const roomId = dg.roomOf[pos];
  if (roomId) {
    dg.roomOf.forEach((rid, i) => { if (rid === roomId) { area.add(i); neighbors8(dg, i).forEach(j => area.add(j)); } });
  } else {
    neighbors8(dg, pos).forEach(j => area.add(j));
  }
  return area;
}

function neighbors4(dg, idx) {
  const r = Math.floor(idx / dg.cols), c = idx % dg.cols, out = [];
  if (r > 0) out.push(idx - dg.cols);
  if (r < dg.rows - 1) out.push(idx + dg.cols);
  if (c > 0) out.push(idx - 1);
  if (c < dg.cols - 1) out.push(idx + 1);
  return out;
}
function neighbors8(dg, idx) {
  const r = Math.floor(idx / dg.cols), c = idx % dg.cols, out = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    if (!dr && !dc) continue;
    const rr = r + dr, cc = c + dc;
    if (rr >= 0 && rr < dg.rows && cc >= 0 && cc < dg.cols) out.push(rr * dg.cols + cc);
  }
  return out;
}

// Rivela la casella raggiunta + le 8 attorno; se è in una stanza mai vista, rivela TUTTA la stanza
// (e il suo contorno). Restituisce la stanza appena scoperta, se c'è.
// FOG OF WAR (sesta richiesta): cosa vede il gruppo dalla casella `pos`. Dentro una stanza si
// vede tutta la stanza (e il suo contorno); in ogni caso si vede fino a dg.vision caselle di
// distanza, ma solo in linea di vista: muri, porte chiuse a chiave e porte segrete non ancora
// trovate bloccano lo sguardo. La stessa funzione è copiata in js/dungeon.js e
// js/dungeon-editor.js (area di prova) per scurire le zone già esplorate ma fuori vista.
function isOpaque(dg, i) {
  const t = dg.grid[i];
  if (t === '.' || t === '?') return true;
  if (t === 's' && !(dg.run.found || []).includes(i)) return true;
  if (isDoorCell(dg, i) && doorState(dg, i) !== 'open') return true;
  return false;
}
function visibleFrom(dg, pos) {
  const vis = new Set();
  if (pos == null || pos < 0) return vis;
  const R = Math.max(1, Math.min(8, Math.floor(Number(dg.vision) || 2)));
  const pr = Math.floor(pos / dg.cols), pc = pos % dg.cols;
  vis.add(pos);
  neighbors8(dg, pos).forEach(j => vis.add(j));
  for (let r = Math.max(0, pr - R); r <= Math.min(dg.rows - 1, pr + R); r++) {
    for (let c = Math.max(0, pc - R); c <= Math.min(dg.cols - 1, pc + R); c++) {
      if ((r - pr) * (r - pr) + (c - pc) * (c - pc) > (R + 0.5) * (R + 0.5)) continue;
      // Bresenham dalla pedina alla casella: le caselle intermedie devono essere trasparenti.
      let x = pc, y = pr; const dx = Math.abs(c - pc), sx = pc < c ? 1 : -1, dy = -Math.abs(r - pr), sy = pr < r ? 1 : -1;
      let err = dx + dy, ok = true;
      while (!(x === c && y === r)) {
        const e2 = 2 * err;
        if (e2 >= dy) { err += dy; x += sx; }
        if (e2 <= dx) { err += dx; y += sy; }
        if (x === c && y === r) break;
        if (isOpaque(dg, y * dg.cols + x)) { ok = false; break; }
      }
      if (ok) vis.add(r * dg.cols + c);
    }
  }
  const roomId = dg.roomOf[pos];
  if (roomId) dg.roomOf.forEach((rid, i) => { if (rid === roomId) { vis.add(i); neighbors8(dg, i).forEach(j => vis.add(j)); } });
  return vis;
}

function revealAt(dg, idx) {
  const seen = new Set(dg.run.seen);
  const add = (i) => { seen.add(i); neighbors8(dg, i).forEach(j => seen.add(j)); };
  visibleFrom(dg, idx).forEach(i => seen.add(i));
  let newRoom = null;
  const roomId = dg.roomOf[idx];
  if (roomId && !dg.run.revealedRooms.includes(roomId)) {
    dg.run.revealedRooms.push(roomId);
    newRoom = dg.rooms.find(r => r.id === roomId) || null;
    dg.roomOf.forEach((rid, i) => { if (rid === roomId) add(i); });
  }
  dg.run.seen = Array.from(seen).sort((a, b) => a - b);
  return newRoom;
}

function entranceIndex(dg) {
  const i = dg.grid.indexOf('e');
  if (i >= 0) return i;
  return dg.grid.findIndex(t => WALKABLE[t]);
}

function computeLeader(party, playerNames) {
  const counts = {};
  Object.keys(party.votes).forEach(voter => {
    if (!playerNames.includes(voter)) return;
    const cand = party.votes[voter];
    if (!playerNames.includes(cand)) return;
    counts[cand] = (counts[cand] || 0) + 1;
  });
  const need = Math.floor(playerNames.length / 2) + 1;
  const winner = Object.keys(counts).find(c => counts[c] >= need);
  // Se nessuno ha la maggioranza il Capofila attuale resta in carica (salvo che non sia più un
  // giocatore della campagna).
  if (winner) party.leader = winner;
  else if (party.leader && !playerNames.includes(party.leader)) party.leader = null;
  return { counts, need };
}

// Vista filtrata per un giocatore: niente mappa non ancora vista, niente trappole/incontri/note
// finché non scattano (anche aprendo gli Strumenti per sviluppatori del browser).
function playerView(data) {
  const out = JSON.parse(JSON.stringify(data));
  out.dungeons = out.dungeons.filter(dg => dg.id === out.activeId).map(dg => {
    const seen = new Set(dg.run.seen);
    const fired = new Set(dg.run.fired);
    const found = new Set(dg.run.found);
    const grid = dg.grid.map((t, i) => !seen.has(i) ? '?' : (t === 's' && !found.has(i) ? '.' : t));
    const roomOf = dg.roomOf.map((r, i) => seen.has(i) ? r : null);
    const features = {};
    Object.keys(dg.features).forEach(k => {
      const i = Number(k), f = dg.features[k];
      if (!seen.has(i)) return;
      if (dg.grid[i] === 's' && !found.has(i)) return; // niente indizi su una porta segreta non trovata
      const icon = f.icon || '';
      if (f.type === 'lock') features[k] = { type: 'lock', key: f.key || '', unlocked: dg.run.unlocked.includes(i), icon };
      else if (f.type === 'door') features[k] = { type: 'door', closed: !!f.closed, icon };
      else if (f.type === 'loot' || f.type === 'key') features[k] = { type: f.type, taken: fired.has(i), icon };
      else if (f.type === 'teleport') features[k] = { type: 'teleport', icon };
      else if (f.type === 'rest') features[k] = { type: 'rest', once: !!f.once, fired: fired.has(i), icon };
      else if (f.type === 'lever') features[k] = { type: 'lever', fired: fired.has(i), icon };
      else if (fired.has(i)) features[k] = { type: f.type, fired: true, icon };
    });
    const rooms = dg.rooms.filter(r => dg.run.revealedRooms.includes(r.id));
    return Object.assign({}, dg, { grid, roomOf, features, rooms });
  });
  return out;
}

async function loadRow(supabase, code) {
  const { data, error } = await supabase.from(TABLE).select('data').eq('campaign_code', code).maybeSingle();
  if (error) throw new Error(error.message);
  return { exists: !!data, data: normalizeData(data ? data.data : null) };
}

// Applica `mutate(data)` con compare-and-swap. mutate può lanciare { status, message } per
// rifiutare l'operazione, e restituire un valore che finisce nella risposta.
async function casUpdate(supabase, code, mutate) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { exists, data } = await loadRow(supabase, code);
    const v = Number(data.v) || 0;
    const result = await mutate(data);
    data.v = v + 1;
    const row = { data, updated_at: new Date().toISOString() };
    if (!exists) {
      await supabase.from('campaigns').upsert({ code }, { onConflict: 'code' });
      const { error } = await supabase.from(TABLE).insert(Object.assign({ campaign_code: code }, row));
      if (!error) return { data, result };
      if (String(error.code) === '23505') continue; // inserita da qualcun altro nel frattempo
      throw new Error(error.message);
    }
    const { data: upd, error } = await supabase.from(TABLE).update(row).eq('campaign_code', code).eq('data->>v', String(v)).select('campaign_code');
    if (error) throw new Error(error.message);
    if (upd && upd.length) return { data, result };
  }
  const e = new Error('Troppe modifiche nello stesso istante: riprova.');
  e.status = 409;
  throw e;
}

function fail(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function isMissingTable(err) {
  const m = String((err && err.message) || '').toLowerCase();
  return m.includes('dungeon_state') && (m.includes('does not exist') || m.includes('could not find') || m.includes('schema cache'));
}
const MIGRATION_HINT = 'Manca la tabella dungeon_state su Supabase: esegui la migrazione SQL indicata in lib/dungeon.js.';

// Pulisce la definizione mandata dall'editor (map.html) — solo campi noti, dimensioni limitate.
function sanitizeDef(def) {
  const dg = {
    id: String(def.id || uid('dg')).slice(0, 60),
    name: String(def.name || 'Dungeon').slice(0, 80),
    desc: String(def.desc || '').slice(0, 2000),
    image: String(def.image || '').slice(0, 500),
    rows: clampSide(def.rows),
    cols: clampSide(def.cols),
    vision: Math.max(1, Math.min(8, Math.floor(Number(def.vision) || 2))),
    grid: Array.isArray(def.grid) ? def.grid.map(t => (WALKABLE[t] ? t : '.')) : [],
    roomOf: Array.isArray(def.roomOf) ? def.roomOf.map(r => (r ? String(r).slice(0, 60) : null)) : [],
    rooms: (Array.isArray(def.rooms) ? def.rooms : []).slice(0, 200).map(r => ({
      id: String(r.id || uid('room')).slice(0, 60),
      name: String(r.name || 'Stanza').slice(0, 80),
      desc: String(r.desc || '').slice(0, 2000),
      image: String(r.image || '').slice(0, 500),
      showOnMap: r.showOnMap !== false
    })),
    features: {}
  };
  const lk = def.link && typeof def.link === 'object' ? def.link : null;
  if (lk && lk.sectorId) dg.link = { macroId: String(lk.macroId || '').slice(0, 80), sectorId: String(lk.sectorId).slice(0, 80), subsectionId: String(lk.subsectionId || '').slice(0, 80), luogoId: String(lk.luogoId || '').slice(0, 80) };
  const n = dg.rows * dg.cols;
  const src = def.features && typeof def.features === 'object' ? def.features : {};
  Object.keys(src).forEach(k => {
    const i = Number(k);
    if (!Number.isInteger(i) || i < 0 || i >= n) return;
    const f = src[k] || {};
    const text = String(f.text || '').slice(0, 1000);
    const icon = String(f.icon || '').slice(0, 500);
    const cell = (x) => { const j = Math.floor(Number(x)); return Number.isInteger(j) && j >= 0 ? j : null; };
    if (f.type === 'trap') dg.features[i] = { type: 'trap', skill: String(f.skill || 'awareness').slice(0, 40), attr: String(f.attr || '').slice(0, 20), tn: Math.max(0, Math.min(40, Number(f.tn) || 12)), roll: f.roll !== false, who: ['leader', 'all', 'random'].includes(f.who) ? f.who : 'leader', closeDoors: (Array.isArray(f.closeDoors) ? f.closeDoors : []).map(cell).filter(x => x != null && x < n).slice(0, 20), closeMode: f.closeMode === 'barred' ? 'barred' : 'closed', text };
    else if (f.type === 'door') dg.features[i] = { type: 'door', closed: !!f.closed, text };
    else if (f.type === 'loot') dg.features[i] = { type: 'loot', name: String(f.name || '').slice(0, 120), qty: Math.max(1, Math.floor(Number(f.qty) || 1)), category: String(f.category || 'altro').slice(0, 30), desc: String(f.desc || '').slice(0, 500), mode: ['each', 'pool', 'first'].includes(f.mode) ? f.mode : 'first', text };
    else if (f.type === 'encounter') dg.features[i] = { type: 'encounter', encounterId: String(f.encounterId || '').slice(0, 80), text };
    else if (f.type === 'lock') dg.features[i] = { type: 'lock', key: String(f.key || '').slice(0, 120), consume: !!f.consume, text };
    else if (f.type === 'key') dg.features[i] = { type: 'key', name: String(f.name || 'Chiave').slice(0, 120), desc: String(f.desc || '').slice(0, 500), text };
    else if (f.type === 'note') dg.features[i] = { type: 'note', text };
    else if (f.type === 'teleport') dg.features[i] = { type: 'teleport', targetDungeon: String(f.targetDungeon || '').slice(0, 60), targetIndex: cell(f.targetIndex), text };
    else if (f.type === 'rest') dg.features[i] = { type: 'rest', once: !!f.once, text };
    else if (f.type === 'lever') dg.features[i] = { type: 'lever', targets: (Array.isArray(f.targets) ? f.targets : []).map(cell).filter(x => x != null && x < n).slice(0, 20), text };
    if (dg.features[i] && icon) dg.features[i].icon = icon;
  });
  return normalizeDungeon(dg);
}

// Posizione effettiva di un giocatore: stessa regola di memberEffectiveSectorId/
// memberEffectiveSubsectionId in js/chat-log-engine.js (override individuale su tamer, altrimenti
// la posizione condivisa del gruppo salvata sulla Scena).
function memberLoc(member, scene) {
  const t = (member && member.tamer) || {};
  const sc = scene || {};
  const sectorId = t.currentSectorId || sc.currentSectorId || null;
  const subsectionId = t.currentSubsectionId || (t.currentSectorId ? null : (sc.currentSubsectionId || null));
  const luogoId = t.currentLuogoId || (t.currentSectorId ? null : (sc.currentLuogoId || null));
  return { sectorId, subsectionId, luogoId };
}
function isLinked(dg) { return !!(dg && dg.link && dg.link.sectorId); }
function memberAtDungeon(dg, member, scene) {
  if (!isLinked(dg)) return true;
  const loc = memberLoc(member, scene);
  if (loc.sectorId !== dg.link.sectorId) return false;
  if (dg.link.subsectionId && loc.subsectionId !== dg.link.subsectionId) return false;
  // Dungeon dentro un Luogo (quinta richiesta): serve essere proprio in quel Luogo.
  return !dg.link.luogoId || loc.luogoId === dg.link.luogoId;
}
function presentPlayers(dg, players, scene) {
  return players.filter(p => memberAtDungeon(dg, p, scene)).map(p => p.username);
}
async function loadScene(supabase, code) {
  const { data } = await supabase.from('scenes').select('*').eq('campaign_code', code).maybeSingle();
  return data || {};
}

// ---- Logica di movimento/ricerca, condivisa tra partita vera e AREA DI PROVA ----
// `d` è lo stato ({ activeId, party, dungeons[] con .run }); per la prova è una copia in cui
// .run è sostituito da .testRun (vedi testState/saveTest).
function performSearch(d, o) {
  const dg = d.dungeons.find(x => x.id === d.activeId);
  if (!dg) throw fail(409, 'Il gruppo non è in un dungeon.');
  if (dg.run.pos == null) throw fail(409, 'La pedina non è ancora nel dungeon.');
  if (!o.actorIsMaster && d.party.searchUsed) throw fail(409, 'Avete già cercato: la Ricerca torna disponibile alla prossima ricarica.');
  if (!o.actorIsMaster) { d.party.searchUsed = true; startRefillClock(d.party, o.now); }
  const area = searchArea(dg, dg.run.pos);
  const newly = [];
  area.forEach(i => {
    if (dg.grid[i] === 's' && !dg.run.found.includes(i)) { dg.run.found.push(i); newly.push(i); }
  });
  const seen = new Set(dg.run.seen);
  newly.forEach(i => { seen.add(i); neighbors8(dg, i).forEach(j => seen.add(j)); });
  dg.run.seen = Array.from(seen).sort((a, b) => a - b);
  const roomId = dg.roomOf[dg.run.pos];
  const room = roomId ? dg.rooms.find(r => r.id === roomId) : null;
  return { found: newly.length, where: room ? room.name : null };
}

function performMove(d, target, o) {
  const findDg = (id) => d.dungeons.find(x => x.id === id);
  const dg = findDg(d.activeId);
  if (!dg) throw fail(409, 'Il gruppo non è in un dungeon.');
  if (!Number.isInteger(target) || target < 0 || target >= dg.grid.length) throw fail(400, 'Casella non valida.');
  if (!isWalkable(dg, target, o.actorIsMaster)) throw fail(409, 'Lì non si può passare.');

  // Il Master può spostare la pedina ovunque, gratis e senza far scattare nulla.
  if (o.free) {
    dg.run.pos = target;
    const room = revealAt(dg, target);
    return { free: true, enteredRoom: room };
  }
  if (dg.run.pos == null) throw fail(409, 'La pedina non è ancora nel dungeon.');
  if (!neighbors4(dg, dg.run.pos).includes(target)) throw fail(409, 'Ci si muove di una casella alla volta.');
  const cost = dg.grid[target] === 'h' ? 2 : 1;
  if (!o.actorIsMaster && d.party.points < cost) throw fail(409, cost > 1 ? 'Terreno difficile: servono 2 Punti Dungeon.' : 'Punti Dungeon esauriti: aspetta la ricarica.');

  const events = [];
  let consumeKey = null;
  const f = dg.features[target];
  const ds = doorState(dg, target);
  if (ds === 'barred') throw fail(409, '⛔ Porta sbarrata: si riapre solo con una leva (o dal Master).');
  if (ds === 'locked') {
    const lk = (f && f.type === 'lock') ? f : { key: '' };
    const keyName = normName(lk.key);
    const holder = keyName ? (o.holders || []).find(p => ((p.tamer && p.tamer.inventory) || []).some(it => normName(it.name) === keyName && (Number(it.qty) || 0) > 0)) : null;
    if (!holder) throw fail(409, lk.key ? `🔒 Porta chiusa a chiave. Serve: ${lk.key}.` : '🔒 Porta chiusa a chiave. Si apre solo con una leva o dal Master.');
    setDoor(dg, target, 'open');
    if (lk.consume) consumeKey = { username: holder.username, key: lk.key };
    events.push({ type: 'unlock', key: lk.key, by: holder.username, consumed: !!lk.consume, text: lk.text || '' });
  } else if (ds === 'closed') {
    setDoor(dg, target, 'open');
    events.push({ type: 'dooropen', text: (f && f.type === 'door' && f.text) || '' });
  }

  if (!o.actorIsMaster) {
    startRefillClock(d.party, o.now);
    d.party.points -= cost;
  }
  if (cost > 1) events.push({ type: 'difficult' });
  dg.run.pos = target;
  const room = revealAt(dg, target);
  if (room) events.push({ type: 'room', room });

  let current = dg;
  if (f && f.type === 'teleport') {
    // Scale/teletrasporto: scatta ogni volta. Destinazione nello stesso dungeon o in un altro
    // (che diventa quello attivo); senza casella indicata si arriva all'ingresso.
    const destDg = (f.targetDungeon && findDg(f.targetDungeon)) || dg;
    let to = f.targetIndex;
    if (to == null || !isWalkable(destDg, to, true)) to = entranceIndex(destDg);
    if (to != null && to >= 0) {
      d.activeId = destDg.id;
      destDg.run.pos = to;
      const room2 = revealAt(destDg, to);
      events.push({ type: 'teleport', text: f.text || '', toDungeon: destDg.id !== dg.id ? destDg.name : null });
      if (room2) events.push({ type: 'room', room: room2 });
      current = destDg;
    }
  } else if (f && f.type === 'rest') {
    if (!(f.once && dg.run.fired.includes(target))) {
      if (f.once) dg.run.fired.push(target);
      refillParty(d.party);
      events.push({ type: 'rest', text: f.text || '' });
    }
  } else if (f && f.type === 'lever') {
    if (!dg.run.fired.includes(target)) {
      dg.run.fired.push(target);
      (f.targets || []).forEach(t => {
        if (dg.grid[t] === 's' && !dg.run.found.includes(t)) { dg.run.found.push(t); if (!dg.run.seen.includes(t)) dg.run.seen.push(t); }
        if (isDoorCell(dg, t) && doorState(dg, t) !== 'open') setDoor(dg, t, 'open');
      });
      events.push({ type: 'lever', text: f.text || '' });
    }
  } else if (f && f.type !== 'lock' && f.type !== 'door' && !dg.run.fired.includes(target)) {
    dg.run.fired.push(target);
    // Trappola che chiude porte: scattano tutte insieme (mai quella su cui si trova la pedina).
    if (f.type === 'trap' && (f.closeDoors || []).length) {
      const closed = [];
      f.closeDoors.forEach(t => {
        if (!isDoorCell(dg, t) || t === dg.run.pos) return;
        const isLock = dg.features[t] && dg.features[t].type === 'lock';
        setDoor(dg, t, f.closeMode === 'barred' ? 'barred' : (isLock ? 'locked' : 'closed'));
        closed.push(t);
      });
      events.push(Object.assign({ index: target }, f, { closedDoors: closed }));
    } else {
      events.push(Object.assign({ index: target }, f));
    }
  }
  if (current === dg && dg.grid[target] === 'x') events.push({ type: 'exit' });
  return { events, leader: d.party.leader, points: d.party.points, consumeKey };
}

function testState(d) {
  if (!d.test || typeof d.test !== 'object') d.test = { activeId: null, party: emptyData().party };
  return {
    activeId: d.test.activeId,
    party: Object.assign(emptyData().party, d.test.party || {}),
    dungeons: d.dungeons.map(x => Object.assign({}, x, { run: normalizeRun(x.testRun) }))
  };
}
function saveTest(d, T) {
  d.test = { activeId: T.activeId, party: T.party };
  T.dungeons.forEach((x, i) => { d.dungeons[i].testRun = x.run; });
}
function normalizeRun(r) {
  const run = Object.assign(emptyRun(), r || {});
  ['seen', 'revealedRooms', 'fired', 'unlocked', 'found'].forEach(k => { if (!Array.isArray(run[k])) run[k] = []; });
  if (!run.doors || typeof run.doors !== 'object' || Array.isArray(run.doors)) run.doors = {};
  return run;
}

// Chiave consumata aprendo una porta (dopo il salvataggio del dungeon): -1 dall'Inventario di chi
// la possiede (riga tolta a 0). Stesso schema SELECT + UPDATE del solo tamer.inventory di loot/roster.
async function consumeKeyFromInventory(supabase, code, ck) {
  if (!ck || !ck.username) return;
  const { data: row } = await supabase.from('members').select('tamer').eq('campaign_code', code).eq('username', ck.username).maybeSingle();
  if (!row || !row.tamer) return;
  const inv = Array.isArray(row.tamer.inventory) ? row.tamer.inventory.map(it => Object.assign({}, it)) : [];
  const i = inv.findIndex(it => normName(it.name) === normName(ck.key) && (Number(it.qty) || 0) > 0);
  if (i < 0) return;
  inv[i].qty = (Number(inv[i].qty) || 0) - 1;
  if (inv[i].qty <= 0) inv.splice(i, 1);
  await supabase.from('members').update({ tamer: Object.assign({}, row.tamer, { inventory: inv }) }).eq('campaign_code', code).eq('username', ck.username);
}

function normName(s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); }

async function handleDungeon(req, res, supabase, cleanCode) {
  try {
    if (req.method === 'GET') {
      const q = req.query || {};
      const code = cleanCode(q.code);
      if (!code) return res.status(400).json({ error: 'missing code' });
      let loaded;
      try { loaded = await loadRow(supabase, code); } catch (e) {
        if (isMissingTable(e)) return res.status(200).json({ dungeon: emptyData(), warning: MIGRATION_HINT });
        throw e;
      }
      const data = loaded.data;
      applyAutoRefill(data.party, Date.now());
      const { data: members } = await supabase.from('members').select('username, role, tamer').eq('campaign_code', code);
      const requester = (members || []).find(m => m.username === String(q.username || '')) || null;
      const role = requester ? requester.role : 'player';
      const active = data.dungeons.find(x => x.id === data.activeId) || null;
      const scene = isLinked(active) ? await loadScene(supabase, code) : null;
      const present = active ? presentPlayers(active, (members || []).filter(m => m.role === 'player'), scene) : [];
      let view;
      if (role === 'master') view = data;
      else {
        view = playerView(data);
        // Dungeon collegato a un luogo: lo vede solo chi si trova lì.
        if (isLinked(active) && !(requester && present.includes(requester.username))) view.dungeons = [];
      }
      return res.status(200).json({ dungeon: Object.assign({}, view, { present }) });
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ error: 'method not allowed' });
    }

    const body = req.body || {};
    const code = cleanCode(body.code);
    const username = String(body.username || '');
    const op = String(body.op || '');
    if (!code || !username || !op) return res.status(400).json({ error: 'missing code, username or op' });

    const { data: members, error: mErr } = await supabase.from('members').select('username, role, tamer').eq('campaign_code', code);
    if (mErr) return res.status(500).json({ error: mErr.message });
    const me = (members || []).find(m => m.username === username);
    if (!me) return res.status(404).json({ error: 'Utente non trovato nella campagna.' });
    const isMaster = me.role === 'master';
    const players = (members || []).filter(m => m.role === 'player');
    const playerNames = players.map(m => m.username);
    const masterOnly = () => { if (!isMaster) throw fail(403, 'Solo il Master può farlo.'); };

    // Presenza (solo per i dungeon collegati a un luogo): serve la Scena per la posizione condivisa.
    let scene = null;
    if (['vote', 'move', 'search'].includes(op)) scene = await loadScene(supabase, code);
    let combatActive = false;
    if (op === 'move') {
      const { data: c } = await supabase.from('combat_state').select('data').eq('campaign_code', code).maybeSingle();
      combatActive = !!(c && c.data && c.data.active);
    }

    const { data, result } = await casUpdate(supabase, code, async (d) => {
      const now = Date.now();
      applyAutoRefill(d.party, now);
      const findDg = (id) => d.dungeons.find(x => x.id === id);

      if (op === 'saveDef') {
        masterOnly();
        const def = sanitizeDef(body.def || {});
        const prev = findDg(def.id);
        if (prev) {
          const sameSize = prev.rows === def.rows && prev.cols === def.cols;
          def.run = sameSize ? prev.run : emptyRun();
          if (sameSize && prev.testRun) def.testRun = prev.testRun;
          normalizeDungeon(def);
          d.dungeons[d.dungeons.indexOf(prev)] = def;
        } else {
          d.dungeons.push(def);
        }
        return { id: def.id };
      }
      if (op === 'deleteDef') {
        masterOnly();
        d.dungeons = d.dungeons.filter(x => x.id !== body.id);
        if (d.activeId === body.id) d.activeId = null;
        return {};
      }
      if (op === 'setActive') {
        masterOnly();
        const id = body.id || null;
        if (id && !findDg(id)) throw fail(404, 'Dungeon non trovato.');
        d.activeId = id;
        if (id) {
          const dg = findDg(id);
          if (dg.run.pos == null) {
            const e = entranceIndex(dg);
            if (e < 0) throw fail(400, 'Il dungeon non ha caselle calpestabili: disegnalo prima in Mappa.');
            dg.run.pos = e;
            const room = revealAt(dg, e);
            return { enteredRoom: room };
          }
        }
        return {};
      }
      if (op === 'resetRun') {
        masterOnly();
        const dg = findDg(body.id || d.activeId);
        if (!dg) throw fail(404, 'Dungeon non trovato.');
        dg.run = emptyRun();
        if (d.activeId === dg.id) {
          const e = entranceIndex(dg);
          if (e >= 0) { dg.run.pos = e; revealAt(dg, e); }
        }
        return {};
      }
      if (op === 'refill') {
        masterOnly();
        if (body.maxPoints != null) d.party.maxPoints = Math.max(1, Math.min(99, Math.floor(Number(body.maxPoints) || 5)));
        refillParty(d.party);
        return {};
      }
      if (op === 'setLeader') {
        masterOnly();
        const who = body.leader || null;
        if (who && !playerNames.includes(who)) throw fail(400, 'Giocatore non valido.');
        d.party.leader = who;
        d.party.votes = {};
        return {};
      }
      if (op === 'vote') {
        if (isMaster) throw fail(403, 'Il Capofila lo scelgono i giocatori.');
        const act = findDg(d.activeId);
        const voters = act ? presentPlayers(act, players, scene) : playerNames;
        if (!voters.includes(username)) throw fail(403, 'Votano solo i giocatori che si trovano nel dungeon.');
        const cand = String(body.candidate || '');
        if (!voters.includes(cand)) throw fail(400, 'Si può votare solo chi è nel dungeon.');
        const prevLeader = d.party.leader;
        d.party.votes[username] = cand;
        const tally = computeLeader(d.party, voters);
        return { tally, leaderChanged: d.party.leader !== prevLeader ? d.party.leader : null };
      }
      if (op === 'reveal') {
        masterOnly();
        const dg = findDg(body.id || d.activeId);
        const i = Number(body.index);
        if (!dg || !Number.isInteger(i) || dg.grid[i] !== 's') throw fail(400, 'Lì non c\'è una porta segreta.');
        if (!dg.run.found.includes(i)) dg.run.found.push(i);
        if (!dg.run.seen.includes(i)) dg.run.seen.push(i);
        return {};
      }
      if (op === 'search') {
        const dg = findDg(d.activeId);
        if (!dg) throw fail(409, 'Il gruppo non è in un dungeon.');
        if (!isMaster && d.party.leader !== username) throw fail(403, 'Solo il Capofila può cercare.');
        if (!isMaster && !memberAtDungeon(dg, me, scene)) throw fail(403, 'Non sei nel dungeon.');
        return performSearch(d, { actorIsMaster: isMaster, now });
      }
      if (op === 'unlock') {
        masterOnly();
        const dg = findDg(body.id || d.activeId);
        const i = Number(body.index);
        if (!dg || !Number.isInteger(i)) throw fail(400, 'Casella non valida.');
        if (!dg.run.unlocked.includes(i)) dg.run.unlocked.push(i);
        if (isDoorCell(dg, i)) setDoor(dg, i, 'open');
        return {};
      }
      if (op === 'door') {
        masterOnly();
        const dg = findDg(body.id || d.activeId);
        const i = Number(body.index);
        if (!dg || !Number.isInteger(i) || !isDoorCell(dg, i)) throw fail(400, 'Lì non c\'è una porta.');
        const want = ['open', 'closed', 'locked', 'barred'].includes(body.state) ? body.state : (doorState(dg, i) === 'open' ? 'closed' : 'open');
        if (want === 'closed' && dg.run.pos === i) throw fail(409, 'La pedina è sulla porta: spostala prima di chiuderla.');
        setDoor(dg, i, want);
        return { door: want };
      }
      if (op === 'move') {
        const dg = findDg(d.activeId);
        if (!dg) throw fail(409, 'Il gruppo non è in un dungeon.');
        if (!(isMaster && body.free)) {
          if (!isMaster && d.party.leader !== username) throw fail(403, 'Solo il Capofila può muovere la pedina.');
          if (!isMaster && !memberAtDungeon(dg, me, scene)) throw fail(403, 'Non sei nel dungeon: il Capofila deve trovarsi lì.');
          if (combatActive) throw fail(409, 'C\'è un combattimento in corso: niente movimento nel dungeon.');
        }
        // Le chiavi valgono solo se le ha in Inventario qualcuno che si trova nel dungeon.
        const holders = players.filter(p => presentPlayers(dg, players, scene).includes(p.username));
        return performMove(d, Number(body.index), { actorIsMaster: isMaster, free: !!(isMaster && body.free), holders, now });
      }
      // ---- AREA DI PROVA (solo Master, dall'editor in Mappa) ----
      // Stessa identica logica di move/search, ma su uno stato separato (d.test + dg.testRun):
      // non tocca la partita vera, non scrive in chat, non usa gli Inventari veri.
      if (op === 'testStart' || op === 'testMove' || op === 'testSearch' || op === 'testRefill') {
        masterOnly();
        const T = testState(d);
        let out = {};
        if (op === 'testStart') {
          const dg = T.dungeons.find(x => x.id === body.id);
          if (!dg) throw fail(404, 'Dungeon non trovato: salvalo prima di provarlo.');
          T.dungeons.forEach(x => { x.run = emptyRun(); });
          T.activeId = dg.id;
          T.party = Object.assign(emptyData().party, { leader: '(prova)' });
          const e = entranceIndex(dg);
          if (e < 0) throw fail(400, 'Il dungeon non ha caselle calpestabili.');
          dg.run.pos = e;
          const room = revealAt(dg, e);
          out = { events: room ? [{ type: 'room', room }] : [] };
        } else if (op === 'testRefill') {
          refillParty(T.party);
        } else if (op === 'testSearch') {
          out = performSearch(T, { actorIsMaster: false, now });
        } else {
          const keyNames = [];
          T.dungeons.forEach(x => Object.values(x.features || {}).forEach(f => { if (f.type === 'lock' && f.key) keyNames.push(f.key); }));
          const holders = body.testKeys ? [{ username: '(prova)', tamer: { inventory: keyNames.map(n => ({ name: n, qty: 1 })) } }] : [];
          out = performMove(T, Number(body.index), { actorIsMaster: false, free: false, holders, now, test: true });
        }
        saveTest(d, T);
        const act = T.dungeons.find(x => x.id === T.activeId) || null;
        return Object.assign({ testView: act ? playerView({ activeId: T.activeId, party: T.party, dungeons: [act] }).dungeons[0] : null, testParty: T.party, testActiveId: T.activeId }, out);
      }
      throw fail(400, 'Operazione sconosciuta: ' + op);
    });

    if (result && result.consumeKey) await consumeKeyFromInventory(supabase, code, result.consumeKey);
    const active = data.dungeons.find(x => x.id === data.activeId) || null;
    if (isLinked(active) && !scene) scene = await loadScene(supabase, code);
    const present = active ? presentPlayers(active, players, scene) : [];
    let view = isMaster ? data : playerView(data);
    if (!isMaster && isLinked(active) && !present.includes(username)) view = Object.assign({}, view, { dungeons: [] });
    return res.status(200).json(Object.assign({ ok: true, dungeon: Object.assign({}, view, { present }) }, result || {}));
  } catch (e) {
    if (isMissingTable(e)) return res.status(500).json({ error: MIGRATION_HINT });
    return res.status(e.status || 500).json({ error: e.message || String(e) });
  }
}

module.exports = { handleDungeon, _internals: { normalizeData, revealAt, computeLeader, playerView, applyAutoRefill, sanitizeDef, neighbors4 } };
