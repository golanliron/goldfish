-- ============================================
-- ORG MEMORY — cross-session persistent memory
-- ============================================

create table public.org_memory (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  key text not null,
  value text not null,
  source text not null default 'chat',
  confidence text not null default 'medium' check (confidence in ('low', 'medium', 'high')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_org_memory_org on public.org_memory(org_id);
create unique index idx_org_memory_unique_key on public.org_memory(org_id, key);

alter table public.org_memory enable row level security;

create policy "org_memory_all" on public.org_memory
  for all using (org_id = public.get_user_org_id());

-- ============================================
-- SUBMISSION OUTCOMES — learn from results
-- ============================================

alter table public.submissions
  add column if not exists outcome text check (outcome in ('approved', 'rejected', 'partial', 'pending', 'no_response')),
  add column if not exists approved_amount numeric,
  add column if not exists requested_amount numeric,
  add column if not exists funder_feedback text,
  add column if not exists lessons_learned text,
  add column if not exists outcome_at timestamptz;
