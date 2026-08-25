// /api/log.js
// Accorpa il vecchio /api/private-log: la discriminante e' il parametro `thread`.
//
//   GET    /api/log?code=XXX                        -> log pubblico della campagna (tabella logs)
//   GET    /api/log?code=XXX&thread=Mario           -> log privato di quel thread (tabella private_logs)
//   POST   { code, username, who, text, ... }        -> scrive sul log pubblico
//   POST   { code, thread, username, who, text, ... } -> scrive sul log privato
//   PUT    { code, id, text }                        -> modifica un messaggio del log pubblico
//   PUT    { code, thread, id, text }                 -> modifica un messaggio del log privato di quel thread
//   DELETE ?code=XXX&id=YYY                           -> elimina un messaggio dal log pubblico
//   DELETE ?code=XXX&clearAll=1                       -> svuota TUTTO il log pubblico della campagna
//   DELETE ?code=XXX&thread=Mario&id=YYY              -> elimina un messaggio dal log privato di quel thread
//
//   POST   /api/log?resource=push   { code, username, subscription } -> salva una sottoscrizione Web Push
//   DELETE /api/log?resource=push&endpoint=...                       -> rimuove una sottoscrizione Web Push
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
// privato di un giocatore (il destinatario e' quel giocatore).
async function subsForUsername(campaignCode, username) {
  const { data } = await supabase.from('push_subscriptions').select('*').eq('campaign_code', campaignCode).eq('username', username);
  return data || [];
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

    if (req.method === 'GET') {
      const code = cleanCode(req.query.code);
      if (!code) return res.status(400).json({ error: 'missing code' });

      const threadUsername = req.query.thread;

      if (threadUsername) {
        const { data, error } = await supabase
          .from('private_logs')
          .select('*')
          .eq('campaign_code', code)
          .eq('thread_username', threadUsername)
          .order('id', { ascending: true })
          .limit(200);
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ log: data || [] });
      }

      const { data, error } = await supabase
        .from('logs')
        .select('*')
        .eq('campaign_code', code)
        .order('id', { ascending: true })
        .limit(200);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ log: data || [] });
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
        // Il destinatario del push e' l'ALTRA parte del thread: se a scrivere e' il giocatore
        // (username === thread) il push va al Master, altrimenti (scrive il Master) va al giocatore.
        // Aspettiamo l'invio prima di rispondere (invece di "spara e dimentica") perche' Vercel puo'
        // congelare la funzione non appena la risposta parte, interrompendo un invio ancora in corso.
        const recipientSubs = (username && username === thread)
          ? await subsForMasters(campaignCode)
          : await subsForUsername(campaignCode, thread);
        await sendPushToSubscriptions(recipientSubs, {
          title: `✉️ ${String(who).slice(0, 60)} (privato)`,
          body: String(text).slice(0, 140),
          url: '/index.html',
          tag: 'dvos-push'
        }).catch(() => {});
        return res.status(200).json({ entry: data });
      }

      if (!campaignCode || !who || !text) {
        return res.status(400).json({ error: 'missing code, who or text' });
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
        body: String(text).slice(0, 140),
        url: '/index.html',
        tag: 'dvos-push'
      }).catch(() => {});
      return res.status(200).json({ entry: data });
    }

    if (req.method === 'PUT') {
      const { code, thread, id, text } = req.body || {};
      const campaignCode = cleanCode(code);
      if (!campaignCode || !id || !text) return res.status(400).json({ error: 'missing code, id or text' });

      if (thread) {
        const { error } = await supabase
          .from('private_logs')
          .update({ text: String(text).slice(0, 8000) })
          .eq('campaign_code', campaignCode)
          .eq('thread_username', thread)
          .eq('id', id);
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ ok: true });
      }

      const { error } = await supabase
        .from('logs')
        .update({ text: String(text).slice(0, 8000) })
        .eq('campaign_code', campaignCode)
        .eq('id', id);
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
