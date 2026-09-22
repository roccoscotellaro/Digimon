// /api/state.js
// Accorpa tre endpoint che avevano la stessa identica forma (una riga per campagna,
// GET con maybeSingle + POST con upsert su campaign_code):
//
//   ?resource=combat        -> ex /api/combat        (tabella combat_state)
//   ?resource=progression   -> ex /api/progression   (tabella progression)
//   ?resource=scene         -> ex /api/scene         (tabella scenes)
//   ?resource=gameclock     -> Orologio di gioco     (tabella game_clock)
//   ?resource=automsg       -> Messaggi Automatici di Combattimento (tabella auto_message_settings)
//     Aggiunta 2026-09-22 ("posso decidere quali messaggi automatici mandare in chat e con che
//     testo?"): stessa identica forma di combat/gameclock (una riga JSONB per campagna), usata da
//     AUTO_MSG_DEFS/autoMsgText in index.html per sapere, per ogni messaggio automatico di
//     Sistema in combattimento (turno passato, digievoluzione, sconfitta, bonus manuali, ecc.),
//     se è abilitato e con quale testo (custom o default) va mandato. Nessuna riga = tutti i
//     messaggi abilitati con il testo di default (comportamento identico a prima di questa
//     feature). Migrazione SQL da eseguire UNA VOLTA sul SQL Editor di Supabase:
//
//   create table if not exists auto_message_settings (
//     campaign_code text primary key,
//     data jsonb not null default '{}'::jsonb,
//     updated_at timestamptz not null default now()
//   );
//
// Le risposte hanno la stessa forma di prima ({combat}, {progression}, {scene}, {gameclock},
// {automsg}), quindi lato client cambia solo l'URL.
// Serve a restare sotto il limite di 12 Serverless Functions del piano Vercel Hobby.
const { supabase, cleanCode } = require('../lib/db');

const TABLES = {
  combat: 'combat_state',
  progression: 'progression',
  scene: 'scenes',
  gameclock: 'game_clock',
  automsg: 'auto_message_settings'
};

// Il client manda i flag in camelCase (campaignLevel, blastEvolutionEnabled, ...) ma li rilegge
// in snake_case (campaign_level, blast_evolution_enabled, ...), quindi sul DB si salvano in
// snake_case. Prima di questa modifica il POST scartava tutti questi campi: le Variant Rule e il
// Campaign Level tornavano ai default a ogni ricarica, e player.html/digimon.html non vedevano
// mai il Campaign Level impostato dal Master.
function progressionExtras(body) {
  const b = body || {};
  const bool = (a, c) => !!(a === undefined ? c : a);
  return {
    campaign_level: b.campaignLevel || b.campaign_level || 'Standard',
    attribute_advantage: b.attributeAdvantage || b.attribute_advantage || '',
    natural_critical_results: bool(b.naturalCriticalResults, b.natural_critical_results),
    blast_evolution_enabled: bool(b.blastEvolutionEnabled, b.blast_evolution_enabled),
    slide_evolution_enabled: bool(b.slideEvolutionEnabled, b.slide_evolution_enabled),
    dark_evolution_enabled: bool(b.darkEvolutionEnabled, b.dark_evolution_enabled)
  };
}

// Se le colonne aggiuntive non esistono ancora sulla tabella `progression`, PostgREST risponde
// PGRST204 ("Could not find the '...' column") oppure Postgres 42703 (undefined_column).
// In quel caso si risalva solo milestone/xp/inspiration invece di far fallire tutto il salvataggio,
// e si segnala che serve la migrazione SQL.
function isMissingColumn(error) {
  if (!error) return false;
  if (error.code === 'PGRST204' || error.code === '42703') return true;
  const msg = String(error.message || '').toLowerCase();
  return msg.indexOf('column') !== -1 && (msg.indexOf('not find') !== -1 || msg.indexOf('does not exist') !== -1);
}

const MIGRATION_HINT = "Progressi base salvati, ma le impostazioni di campagna (Campaign Level e Variant Rule) non sono state memorizzate: mancano le colonne sulla tabella `progression`. Esegui la migrazione SQL indicata in api/state.js.";

// Migrazione da eseguire una volta sul SQL Editor di Supabase:
//
//   alter table progression add column if not exists campaign_level text default 'Standard';
//   alter table progression add column if not exists attribute_advantage text default '';
//   alter table progression add column if not exists natural_critical_results boolean default false;
//   alter table progression add column if not exists blast_evolution_enabled boolean default false;
//   alter table progression add column if not exists slide_evolution_enabled boolean default false;
//   alter table progression add column if not exists dark_evolution_enabled boolean default false;

// Migrazione da eseguire una volta sul SQL Editor di Supabase per il nuovo livello Sottosezione
// (vedi SCENE_DEFAULT.currentSubsectionId qui sotto e il POST di resource=scene più in basso).
// Il nome colonna è tra virgolette perché in questa tabella le colonne sono in camelCase
// (comportamento insolito ma coerente con currentSectorId/currentLuogoId già esistenti):
//
//   alter table scenes add column if not exists "currentSubsectionId" text;
//
// Senza questa migrazione il salvataggio della Scena continua comunque a funzionare (vedi il
// retry più sotto), semplicemente la Sottosezione "attuale" del gruppo non viene ricordata tra
// un salvataggio e l'altro.

const SCENE_DEFAULT = {
  title: '',
  background: '',
  music: '',
  encounters: [],
  macroScenes: [],
  currentMacroSceneId: null,
  currentSectorId: null,
  // Richiesta utente ("Macroarea - Settore - Sottosezioni del settore ... e Luoghi"): nuovo
  // livello opzionale tra Settore e Luogo, con la stessa griglia/collegamenti/spostamento
  // libero dei Settori. currentSubsectionId segue lo stesso pattern di currentSectorId/
  // currentLuogoId: puntatore scalare alla Sottosezione "attuale" per l'intero gruppo, dentro
  // il Settore attuale. Le Sottosezioni stesse vivono dentro ogni oggetto Settore, in
  // macroScenes[].sectors[].subsections (array JSONB, nessuna migrazione SQL richiesta).
  currentSubsectionId: null,
  currentLuogoId: null
};

module.exports = async (req, res) => {
  try {
    const body = req.body || {};
    const query = req.query || {};
    // `resource` accettato sia in query string sia nel body, cosi' il client puo'
    // usare indifferentemente /api/state?resource=scene o { resource:'scene', ... }.
    const resource = query.resource || body.resource;

    if (!resource || !TABLES[resource]) {
      return res.status(400).json({ error: 'resource mancante o non valida (usa combat, progression, scene, gameclock o automsg)' });
    }
    const table = TABLES[resource];

    if (req.method === 'GET') {
      const code = cleanCode(query.code);
      if (!code) return res.status(400).json({ error: 'missing code' });

      const { data, error } = await supabase
        .from(table)
        .select('*')
        .eq('campaign_code', code)
        .maybeSingle();
      if (error) return res.status(500).json({ error: error.message });

      if (resource === 'combat') {
        return res.status(200).json({ combat: data ? data.data : null });
      }
      if (resource === 'gameclock') {
        return res.status(200).json({ gameclock: data ? data.data : null });
      }
      if (resource === 'automsg') {
        return res.status(200).json({ automsg: data ? data.data : null });
      }
      if (resource === 'progression') {
        return res.status(200).json({ progression: data || { milestone: 0, xp: 0, inspiration: 0 } });
      }
      return res.status(200).json({ scene: data || SCENE_DEFAULT });
    }

    if (req.method === 'POST') {
      const campaignCode = cleanCode(body.code);
      if (!campaignCode) return res.status(400).json({ error: 'missing code' });

      // Assicura che la campagna esista
      await supabase.from('campaigns').upsert({ code: campaignCode }, { onConflict: 'code' });

      let row;
      if (resource === 'combat' || resource === 'gameclock' || resource === 'automsg') {
        row = {
          campaign_code: campaignCode,
          data: body.data || {},
          updated_at: new Date().toISOString()
        };
      } else if (resource === 'progression') {
        const base = {
          campaign_code: campaignCode,
          milestone: Number(body.milestone) || 0,
          xp: Number(body.xp) || 0,
          inspiration: Number(body.inspiration) || 0,
          updated_at: new Date().toISOString()
        };
        const full = Object.assign({}, base, progressionExtras(body));

        const { error } = await supabase.from(table).upsert(full, { onConflict: 'campaign_code' });
        if (!error) return res.status(200).json({ ok: true });

        if (!isMissingColumn(error)) return res.status(500).json({ error: error.message });

        const retry = await supabase.from(table).upsert(base, { onConflict: 'campaign_code' });
        if (retry.error) return res.status(500).json({ error: retry.error.message });
        return res.status(200).json({ ok: true, warning: MIGRATION_HINT });
      } else {
        row = {
          campaign_code: campaignCode,
          title: body.title || '',
          background: body.background || '',
          music: body.music || '',
          encounters: Array.isArray(body.encounters) ? body.encounters : [],
          macroScenes: Array.isArray(body.macroScenes) ? body.macroScenes : [],
          currentMacroSceneId: body.currentMacroSceneId || null,
          currentSectorId: body.currentSectorId || null,
          // Vedi commento su SCENE_DEFAULT.currentSubsectionId qui sopra. A differenza di
          // macroScenes (JSONB, dove le Sottosezioni vivono già senza bisogno di migrazione),
          // currentSubsectionId è una colonna scalare nuova sulla tabella `scenes`, come lo
          // erano a suo tempo currentSectorId/currentLuogoId. Se la colonna non esiste ancora,
          // l'upsert sotto fallisce con un errore "colonna mancante": stesso identico problema
          // già visto per `progression`, quindi stesso rimedio (retry senza il campo nuovo,
          // così il resto della Scena si salva comunque invece di rompersi del tutto).
          currentSubsectionId: body.currentSubsectionId || null,
          currentLuogoId: body.currentLuogoId || null
        };
      }

      const { error } = await supabase.from(table).upsert(row, { onConflict: 'campaign_code' });
      if (!error) return res.status(200).json({ ok: true });

      if (resource === 'scene' && isMissingColumn(error)) {
        const { currentSubsectionId, ...rowWithoutSubsection } = row;
        const retry = await supabase.from(table).upsert(rowWithoutSubsection, { onConflict: 'campaign_code' });
        if (retry.error) return res.status(500).json({ error: retry.error.message });
        return res.status(200).json({
          ok: true,
          warning: "Scena salvata, ma manca la colonna \"currentSubsectionId\" sulla tabella `scenes`: la posizione attuale a livello di Sottosezione non viene ricordata finché non esegui la migrazione SQL indicata in api/state.js. Le Sottosezioni stesse (dentro ogni Settore) restano salvate normalmente, perché vivono nella colonna JSONB macroScenes."
        });
      }

      return res.status(500).json({ error: error.message });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
};
