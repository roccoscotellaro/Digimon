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
// Tutte le scritture sono compare-and-swap su data->>v (stesso schema di loot/voto in api/log.js):
// il Capofila che muove e il Master che salva l'editor nello stesso istante non si cancellano a
// vicenda — chi perde la corsa rilegge e riapplica la propria operazione.

const TABLE = 'dungeon_state';
const REFILL_MS = 10 * 60 * 60 * 1000;
const MAX_SIDE = 40;
const WALKABLE = { f: 1, d: 1, e: 1, x: 1 };

function uid(prefix) {
  return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function emptyData() {
  return { v: 0, activeId: null, party: { leader: null, votes: {}, points: 5, maxPoints: 5, lastRefillAt: null }, dungeons: [] };
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
  return { pos: null, seen: [], revealedRooms: [], fired: [], unlocked: [] };
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
  ['seen', 'revealedRooms', 'fired', 'unlocked'].forEach(k => { if (!Array.isArray(dg.run[k])) dg.run[k] = []; });
  return dg;
}

function clampSide(x) {
  const n = Math.floor(Number(x) || 0);
  if (n < 3) return 3;
  if (n > MAX_SIDE) return MAX_SIDE;
  return n;
}

// Ricarica automatica "pigra": nessun cron, si applica ogni volta che si legge o si scrive.
function applyAutoRefill(party, now) {
  if (party.points >= party.maxPoints) { party.lastRefillAt = null; return false; }
  if (party.lastRefillAt && now - new Date(party.lastRefillAt).getTime() >= REFILL_MS) {
    party.points = party.maxPoints;
    party.lastRefillAt = null;
    return true;
  }
  return false;
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
    const grid = dg.grid.map((t, i) => seen.has(i) ? t : '?');
    const roomOf = dg.roomOf.map((r, i) => seen.has(i) ? r : null);
    const features = {};
    Object.keys(dg.features).forEach(k => {
      const i = Number(k), f = dg.features[k];
      if (!seen.has(i)) return;
      if (f.type === 'lock') features[k] = { type: 'lock', key: f.key || '', unlocked: dg.run.unlocked.includes(i) };
      else if (f.type === 'loot') features[k] = { type: 'loot', taken: fired.has(i) };
      else if (fired.has(i)) features[k] = { type: f.type, fired: true };
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
      image: String(r.image || '').slice(0, 500)
    })),
    features: {}
  };
  const n = dg.rows * dg.cols;
  const src = def.features && typeof def.features === 'object' ? def.features : {};
  Object.keys(src).forEach(k => {
    const i = Number(k);
    if (!Number.isInteger(i) || i < 0 || i >= n) return;
    const f = src[k] || {};
    const text = String(f.text || '').slice(0, 1000);
    if (f.type === 'trap') dg.features[i] = { type: 'trap', skill: String(f.skill || 'awareness').slice(0, 40), attr: String(f.attr || '').slice(0, 20), tn: Math.max(0, Math.min(40, Number(f.tn) || 12)), text };
    else if (f.type === 'loot') dg.features[i] = { type: 'loot', name: String(f.name || '').slice(0, 120), qty: Math.max(1, Math.floor(Number(f.qty) || 1)), category: String(f.category || 'altro').slice(0, 30), desc: String(f.desc || '').slice(0, 500), mode: ['each', 'pool', 'first'].includes(f.mode) ? f.mode : 'first', text };
    else if (f.type === 'encounter') dg.features[i] = { type: 'encounter', encounterId: String(f.encounterId || '').slice(0, 80), text };
    else if (f.type === 'lock') dg.features[i] = { type: 'lock', key: String(f.key || '').slice(0, 120), text };
    else if (f.type === 'note') dg.features[i] = { type: 'note', text };
  });
  return normalizeDungeon(dg);
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
      let role = 'player';
      if (q.username) {
        const { data: m } = await supabase.from('members').select('role').eq('campaign_code', code).eq('username', String(q.username)).maybeSingle();
        if (m && m.role) role = m.role;
      }
      return res.status(200).json({ dungeon: role === 'master' ? data : playerView(data) });
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
        d.party.points = d.party.maxPoints;
        d.party.lastRefillAt = null;
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
        const cand = String(body.candidate || '');
        if (!playerNames.includes(cand)) throw fail(400, 'Giocatore non valido.');
        const prevLeader = d.party.leader;
        d.party.votes[username] = cand;
        const tally = computeLeader(d.party, playerNames);
        return { tally, leaderChanged: d.party.leader !== prevLeader ? d.party.leader : null };
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
        if (!WALKABLE[dg.grid[target]]) throw fail(409, 'Lì non si può passare.');

        // Il Master può spostare la pedina ovunque, gratis e senza far scattare nulla.
        if (isMaster && body.free) {
          dg.run.pos = target;
          const room = revealAt(dg, target);
          return { free: true, enteredRoom: room };
        }
        if (!isMaster && d.party.leader !== username) throw fail(403, 'Solo il Capofila può muovere la pedina.');
        if (combatActive) throw fail(409, 'C\'è un combattimento in corso: niente movimento nel dungeon.');
        if (dg.run.pos == null) throw fail(409, 'La pedina non è ancora nel dungeon.');
        if (!neighbors4(dg, dg.run.pos).includes(target)) throw fail(409, 'Ci si muove di una casella alla volta.');
        if (!isMaster && d.party.points < 1) throw fail(409, 'Punti Dungeon esauriti: aspetta la ricarica.');

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
          if (d.party.points >= d.party.maxPoints) d.party.lastRefillAt = new Date(now).toISOString();
          d.party.points -= 1;
        }
        dg.run.pos = target;
        const room = revealAt(dg, target);
        if (room) events.push({ type: 'room', room });

        if (f && f.type !== 'lock' && !dg.run.fired.includes(target)) {
          dg.run.fired.push(target);
          events.push(Object.assign({ index: target }, f));
        }
        if (dg.grid[target] === 'x') events.push({ type: 'exit' });
        return { events, leader: d.party.leader, points: d.party.points };
      }
      throw fail(400, 'Operazione sconosciuta: ' + op);
    });

    const view = isMaster ? data : playerView(data);
    return res.status(200).json(Object.assign({ ok: true, dungeon: view }, result || {}));
  } catch (e) {
    if (isMissingTable(e)) return res.status(500).json({ error: MIGRATION_HINT });
    return res.status(e.status || 500).json({ error: e.message || String(e) });
  }
}

module.exports = { handleDungeon, _internals: { normalizeData, revealAt, computeLeader, playerView, applyAutoRefill, sanitizeDef, neighbors4 } };
