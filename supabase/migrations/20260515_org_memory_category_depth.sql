-- Add category and depth fields to org_memory
-- category: which knowledge layer this fact belongs to
-- depth: quality of the fact (1=shallow, 2=specific, 3=deep+evidence)

ALTER TABLE public.org_memory
  ADD COLUMN IF NOT EXISTS category text
    CHECK (category IN ('identity', 'dna', 'impact', 'operations', 'submissions'));

ALTER TABLE public.org_memory
  ADD COLUMN IF NOT EXISTS depth integer DEFAULT 1
    CHECK (depth IN (1, 2, 3));
