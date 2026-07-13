-- Digimon: Digital Adventures 2E — Tavolo Testuale
-- Schema del database. Incolla questo script nell'editor SQL di Supabase
-- (Dashboard del progetto -> SQL Editor -> New query) ed eseguilo una volta sola.

create table if not exists campaigns (
  code text primary key,
  created_at timestamptz default now()
);

create table if not exists members (
  campaign_code text references campaigns(code) on delete cascade,
  username text not null,
  role text not null default 'player',
  tamer jsonb not null default '{}'::jsonb,
  digimon jsonb not null default '{}'::jsonb,
  last_seen timestamptz default now(),
  primary key (campaign_code, username)
);

create table if not exists scenes (
  campaign_code text primary key references campaigns(code) on delete cascade,
  title text default '',
  background text default '',
  music text default ''
);

create table if not exists logs (
  id bigserial primary key,
  campaign_code text references campaigns(code) on delete cascade,
  who text not null,
  role text not null,
  text text not null,
  ts timestamptz default now()
);

create index if not exists logs_campaign_idx on logs(campaign_code, id);

-- Nota di sicurezza: questo schema non ha Row Level Security (RLS) attiva.
-- Le funzioni serverless in /api usano la Service Role Key di Supabase, che
-- bypassa RLS by design e resta SOLO lato server (mai esposta al browser).
-- Se in futuro vuoi permettere al frontend di parlare direttamente con
-- Supabase (senza passare dalle funzioni /api), allora andrà abilitata RLS
-- con policy dedicate — per ora non serve.
