-- Add application_url column to opportunities table
-- Stores the direct link to the application form (more specific than the general url field)
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS application_url TEXT DEFAULT NULL;

-- Create index for quick lookup of rows that still need application URL enrichment
CREATE INDEX IF NOT EXISTS idx_opportunities_app_url_null ON opportunities(id) WHERE application_url IS NULL AND active = TRUE;

-- Add application_url to funder_intelligence for cross-org reuse
ALTER TABLE funder_intelligence ADD COLUMN IF NOT EXISTS application_url TEXT DEFAULT NULL;
ALTER TABLE funder_intelligence ADD COLUMN IF NOT EXISTS url_verified_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE funder_intelligence ADD COLUMN IF NOT EXISTS url_source TEXT DEFAULT NULL; -- 'gov', 'foundation', 'corporate', etc.
