-- Migration: funder_intelligence approach strategy & contact data cleansing
-- Adds structured approach fields + sanitizes junk contact data

-- 1. Add new columns
ALTER TABLE funder_intelligence
  ADD COLUMN IF NOT EXISTS approach_strategy TEXT NOT NULL DEFAULT 'UNKNOWN'
    CHECK (approach_strategy IN ('RFP_ONLY', 'DIRECT_APPROACH', 'UNKNOWN')),
  ADD COLUMN IF NOT EXISTS contact_name TEXT,
  ADD COLUMN IF NOT EXISTS submission_url TEXT,
  ADD COLUMN IF NOT EXISTS submission_instructions TEXT,
  ADD COLUMN IF NOT EXISTS approach_validated BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS approach_validated_at TIMESTAMPTZ;

-- 2. Sanitize existing contact_email: null out generic addresses
UPDATE funder_intelligence
SET contact_email = NULL
WHERE contact_email IS NOT NULL
  AND (
    contact_email ILIKE 'info@%'
    OR contact_email ILIKE 'office@%'
    OR contact_email ILIKE 'contact@%'
    OR contact_email ILIKE 'mail@%'
    OR contact_email ILIKE 'admin@%'
    OR contact_email ILIKE 'support@%'
    OR contact_email ILIKE 'webmaster@%'
    OR contact_email ILIKE 'noreply@%'
    OR contact_email ILIKE 'postmaster@%'
    OR contact_email NOT LIKE '%@%'
  );

-- 3. Auto-classify known government / portal funders as RFP_ONLY
UPDATE funder_intelligence
SET approach_strategy = 'RFP_ONLY'
WHERE approach_strategy = 'UNKNOWN'
  AND (
    funder_name ILIKE '%משרד%'
    OR funder_name ILIKE '%ממשל%'
    OR funder_name ILIKE '%רשות%'
    OR funder_name ILIKE '%ביטוח לאומי%'
    OR funder_name ILIKE '%מינהל%'
    OR funder_name ILIKE '%מפעל הפיס%'
    OR funder_name ILIKE '%עיזבונות%'
    OR funder_name ILIKE '%ועדת%'
    OR submission_method = 'Portal'
  );

-- 4. Auto-classify email/LOI funders as DIRECT_APPROACH (only if not already set)
UPDATE funder_intelligence
SET approach_strategy = 'DIRECT_APPROACH'
WHERE approach_strategy = 'UNKNOWN'
  AND submission_method IN ('Email', 'LOI')
  AND contact_email IS NOT NULL;

-- 5. Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_funder_intelligence_approach
  ON funder_intelligence (approach_strategy);

-- 6. Helpful view for the chat engine: only valid direct-approach funders
CREATE OR REPLACE VIEW funder_direct_contacts AS
SELECT
  funder_name,
  contact_name,
  contact_email,
  contact_phone,
  submission_url,
  submission_instructions,
  preferred_domains,
  preferred_populations,
  typical_amount_min,
  typical_amount_max,
  approach_validated,
  approach_validated_at
FROM funder_intelligence
WHERE approach_strategy = 'DIRECT_APPROACH'
  AND (contact_email IS NOT NULL OR submission_url IS NOT NULL);
