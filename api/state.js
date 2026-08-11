// /api/state.js
// Accorpa tre endpoint che avevano la stessa identica forma (una riga per campagna,
// GET con maybeSingle + POST con upsert su campaign_code):
//
//   ?resource=combat        -> ex /api/combat        (tabella combat_state)
//   ?resource=progression   -> ex /api/progression   (tabella progression)
//   ?resource=scene         -> ex /api/scene         (tabella scenes)
//
// Le risposte hanno la stessa forma di prima ({combat}, {progression}, {scene}),
// quindi lato client cambia solo l'URL.
// Serve a restare sotto il limite di 12 Serverless Functions del piano Vercel Hobby.
const { supabase, cleanCode } = require('../lib/db');

const TABLES = {
  combat: 'combat_state',
  progression: 'progression',
  scene: 'scenes'
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

const SCENE_DEFAULT = {
  title: '',
  background: '',
  music: '',
  encounters: [],
  macroScenes: [],
  currentMacroSceneId: null,
  currentSectorId: null,
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
      return res.status(400).json({ error: 'resource mancante o non valida (usa combat, progression o scene)' });
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
      if (resource === 'combat') {
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
          currentLuogoId: body.currentLuogoId || null
        };
      }

      const { error } = await supabase.from(table).upsert(row, { onConflict: 'campaign_code' });
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
};
