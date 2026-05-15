-- WhatsApp push notification deduplication table
-- Prevents sending the same org the same opportunity twice

create table if not exists whatsapp_notifications (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  opportunity_id uuid not null,
  phone        text not null,
  score        integer not null,
  sent_at      timestamptz not null default now()
);

create unique index if not exists whatsapp_notifications_org_opp_unique
  on whatsapp_notifications (org_id, opportunity_id);

create index if not exists whatsapp_notifications_org_id_idx
  on whatsapp_notifications (org_id);
