-- Add 4-pillar scoring columns to matches table
-- pillars: JSON breakdown per pillar (eligibility, mission_alignment, geography, capacity)
-- matched_at: timestamp when the match was scored by the engine

alter table public.matches
  add column if not exists pillars jsonb,
  add column if not exists matched_at timestamptz;
