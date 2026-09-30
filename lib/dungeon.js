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
  return { pos: null, seen: [], revealedRooms: [], fired: [], unlocked: [], found: [] };
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
function revealAt(dg, idx) {
  const seen = new Set(dg.run.seen);
  const add = (i) => { seen.add(i); neighbors8(dg, i).forEach(j => seen.add(j)); };
  add(idx);
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
      else if (f.type === 'loot') features[k] = { type: 'loot', taken: fired.has(i), icon };
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
  if (lk && lk.sectorId) dg.link = { macroId: String(lk.macroId || '').slice(0, 80), sectorId: String(lk.sectorId).slice(0, 80), subsectionId: String(lk.subsectionId || '').slice(0, 80) };
  const n = dg.rows * dg.cols;
  const src = def.features && typeof def.features === 'object' ? def.features : {};
  Object.keys(src).forEach(k => {
    const i = Number(k);
    if (!Number.isInteger(i) || i < 0 || i >= n) return;
    const f = src[k] || {};
    const text = String(f.text || '').slice(0, 1000);
    const icon = String(f.icon || '').slice(0, 500);
    const cell = (x) => { const j = Math.floor(Number(x)); return Number.isInteger(j) && j >= 0 ? j : null; };
    if (f.type === 'trap') dg.features[i] = { type: 'trap', skill: String(f.skill || 'awareness').slice(0, 40), attr: String(f.attr || '').slice(0, 20), tn: Math.max(0, Math.min(40, Number(f.tn) || 12)), text };
    else if (f.type === 'loot') dg.features[i] = { type: 'loot', name: String(f.name || '').slice(0, 120), qty: Math.max(1, Math.floor(Number(f.qty) || 1)), category: String(f.category || 'altro').slice(0, 30), desc: String(f.desc || '').slice(0, 500), mode: ['each', 'pool', 'first'].includes(f.mode) ? f.mode : 'first', text };
    else if (f.type === 'encounter') dg.features[i] = { type: 'encounter', encounterId: String(f.encounterId || '').slice(0, 80), text };
    else if (f.type === 'lock') dg.features[i] = { type: 'lock', key: String(f.key || '').slice(0, 120), text };
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
  return { sectorId, subsectionId };
}
function isLinked(dg) { return !!(dg && dg.link && dg.link.sectorId); }
function memberAtDungeon(dg, member, scene) {
  if (!isLinked(dg)) return true;
  const loc = memberLoc(member, scene);
  if (loc.sectorId !== dg.link.sectorId) return false;
  return !dg.link.subsectionId || loc.subsectionId === dg.link.subsectionId;
}
function presentPlayers(dg, players, scene) {
  return players.filter(p => memberAtDungeon(dg, p, scene)).map(p => p.username);
}
async function loadScene(supabase, code) {
  const { data } = await supabase.from('scenes').select('*').eq('campaign_code', code).maybeSingle();
  return data || {};
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
        if (dg.run.pos == null) throw fail(409, 'La pedina non è ancora nel dungeon.');
        if (!isMaster && d.party.searchUsed) throw fail(409, 'Avete già cercato: la Ricerca torna disponibile alla prossima ricarica.');
        if (!isMaster) { d.party.searchUsed = true; startRefillClock(d.party, now); }
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
      if (op === 'unlock') {
        masterOnly();
        const dg = findDg(body.id || d.activeId);
        const i = Number(body.index);
        if (!dg || !Number.isInteger(i)) throw fail(400, 'Casella non valida.');
        if (!dg.run.unlocked.includes(i)) dg.run.unlocked.push(i);
        return {};
      }
      if (op === 'move') {
        const dg = findDg(d.activeId);
        if (!dg) throw fail(409, 'Il gruppo non è in un dungeon.');
        const target = Number(body.index);
        if (!Number.isInteger(target) || target < 0 || target >= dg.grid.length) throw fail(400, 'Casella non valida.');
        if (!isWalkable(dg, target, isMaster)) throw fail(409, 'Lì non si può passare.');

        // Il Master può spostare la pedina ovunque, gratis e senza far scattare nulla.
        if (isMaster && body.free) {
          dg.run.pos = target;
          const room = revealAt(dg, target);
          return { free: true, enteredRoom: room };
        }
        if (!isMaster && d.party.leader !== username) throw fail(403, 'Solo il Capofila può muovere la pedina.');
        if (!isMaster && !memberAtDungeon(dg, me, scene)) throw fail(403, 'Non sei nel dungeon: il Capofila deve trovarsi lì.');
        if (combatActive) throw fail(409, 'C\'è un combattimento in corso: niente movimento nel dungeon.');
        if (dg.run.pos == null) throw fail(409, 'La pedina non è ancora nel dungeon.');
        if (!neighbors4(dg, dg.run.pos).includes(target)) throw fail(409, 'Ci si muove di una casella alla volta.');
        const cost = dg.grid[target] === 'h' ? 2 : 1;
        if (!isMaster && d.party.points < cost) throw fail(409, cost > 1 ? 'Terreno difficile: servono 2 Punti Dungeon.' : 'Punti Dungeon esauriti: aspetta la ricarica.');

        const events = [];
        const f = dg.features[target];
        if (f && f.type === 'lock' && !dg.run.unlocked.includes(target)) {
          const keyName = normName(f.key);
          const holder = keyName ? players.find(p => ((p.tamer && p.tamer.inventory) || []).some(it => normName(it.name) === keyName && (Number(it.qty) || 0) > 0)) : null;
          if (!holder) throw fail(409, f.key ? `🔒 Chiuso. Serve: ${f.key}.` : '🔒 Chiuso. Solo il Master può aprire questo passaggio.');
          dg.run.unlocked.push(target);
          events.push({ type: 'unlock', key: f.key, by: holder.username, text: f.text || '' });
        }

        if (!isMaster) {
          startRefillClock(d.party, now);
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
              if (dg.features[t] && dg.features[t].type === 'lock' && !dg.run.unlocked.includes(t)) dg.run.unlocked.push(t);
            });
            events.push({ type: 'lever', text: f.text || '' });
          }
        } else if (f && f.type !== 'lock' && !dg.run.fired.includes(target)) {
          dg.run.fired.push(target);
          events.push(Object.assign({ index: target }, f));
        }
        if (current === dg && dg.grid[target] === 'x') events.push({ type: 'exit' });
        return { events, leader: d.party.leader, points: d.party.points };
      }
      throw fail(400, 'Operazione sconosciuta: ' + op);
    });

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
