-- Integration Hub — Supabase migration
-- Run once: Supabase SQL editor

create table if not exists integrations (
  id                uuid primary key default gen_random_uuid(),
  org_id            text not null,
  integration_id    text not null,
  status            text not null default 'disconnected'
                      check (status in ('connected','disconnected','error','pending')),
  config_encrypted  text not null default '',
  last_sync_at      timestamptz,
  last_error        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  unique (org_id, integration_id)
);

-- RLS: each org sees only its own integrations
alter table integrations enable row level security;

create policy "org_own_integrations" on integrations
  for all
  using (org_id = current_setting('app.current_org_id', true))
  with check (org_id = current_setting('app.current_org_id', true));

-- Index for fast lookup
create index if not exists integrations_org_idx on integrations (org_id);
