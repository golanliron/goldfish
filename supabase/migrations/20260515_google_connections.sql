-- Google Drive OAuth connections per org
create table if not exists google_connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  access_token text not null,
  refresh_token text,
  token_expiry timestamptz,
  scope text,
  google_email text,
  connected_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (org_id)
);

alter table google_connections enable row level security;

-- Only service role (admin) can read/write — tokens never exposed to client
create policy "service role only" on google_connections
  using (false)
  with check (false);
