-- RAG: add organization_id to knowledge_chunks for multi-tenant isolation
-- And update match_knowledge() to accept an optional org filter

-- 1. Add organization_id column (nullable = shared knowledge; set = private to org)
ALTER TABLE knowledge_chunks
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE;

-- Index for fast per-org lookups
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_org_id
  ON knowledge_chunks (organization_id);

-- 2. Add scan_cache table for 24-hour result caching
CREATE TABLE IF NOT EXISTS scan_cache (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  cache_type   text NOT NULL,  -- 'opportunities' | 'companies'
  cache_key    text NOT NULL,  -- e.g. sha256 of request params
  payload      jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL DEFAULT (now() + interval '24 hours')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_scan_cache_org_type_key
  ON scan_cache (org_id, cache_type, cache_key);

CREATE INDEX IF NOT EXISTS idx_scan_cache_expires
  ON scan_cache (expires_at);

-- 3. Drop old match_knowledge function and recreate with org filter
DROP FUNCTION IF EXISTS match_knowledge(vector, int, text, float);

CREATE OR REPLACE FUNCTION match_knowledge(
  query_embedding   vector(768),
  match_count       int            DEFAULT 10,
  filter_category   text           DEFAULT NULL,
  similarity_threshold float       DEFAULT 0.5,
  filter_org_id     uuid           DEFAULT NULL
)
RETURNS TABLE (
  id          uuid,
  title       text,
  content     text,
  category    text,
  subcategory text,
  similarity  float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    kc.id,
    kc.title,
    kc.content,
    kc.category,
    kc.subcategory,
    1 - (kc.embedding <=> query_embedding) AS similarity
  FROM knowledge_chunks kc
  WHERE
    (1 - (kc.embedding <=> query_embedding)) >= similarity_threshold
    AND (filter_category IS NULL OR kc.category = filter_category)
    -- Multi-tenant isolation:
    -- Return shared chunks (org_id IS NULL) PLUS org's own private chunks
    AND (kc.organization_id IS NULL OR kc.organization_id = filter_org_id)
  ORDER BY kc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
