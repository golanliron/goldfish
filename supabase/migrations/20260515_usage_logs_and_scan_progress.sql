-- Usage logs: multi-tenant API/token consumption tracking
-- Used for future pricing packages and quota enforcement

create table if not exists public.usage_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  event_type text not null, -- 'chat_message', 'initial_scan', 'document_upload', 'smart_reader', 'draft_generated', 'match_score', 'rag_search'
  tokens_used integer,
  model text, -- 'claude-sonnet-4-6', 'gemini-2.5-pro', etc.
  details jsonb,
  created_at timestamptz not null default now()
);

-- Index for per-org queries and time-range aggregations
create index if not exists usage_logs_org_id_idx on public.usage_logs(org_id);
create index if not exists usage_logs_created_at_idx on public.usage_logs(created_at);
create index if not exists usage_logs_org_event_idx on public.usage_logs(org_id, event_type);

-- RLS: only the org itself can read its own usage logs
alter table public.usage_logs enable row level security;

create policy "orgs can read own usage" on public.usage_logs
  for select using (auth.uid() in (
    select user_id from public.org_members where org_id = usage_logs.org_id
  ));

-- Scan progress column on org_profiles (stores ScanProgress JSON blob)
alter table public.org_profiles
  add column if not exists scan_progress jsonb;

-- Index for fast lookup of orgs with active scans
create index if not exists org_profiles_scan_status_idx
  on public.org_profiles ((scan_progress->>'status'));
