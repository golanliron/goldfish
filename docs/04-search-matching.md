# Goldfish — Search & Matching Logic

## DNA Matching Engine

### File: `lib/org-dna.ts`

The DNA engine matches an organization's profile against grants, companies, and funders. It uses multi-dimensional tagging.

### DNA Dimensions

**16 Populations:**
youth, young_adults, children, women, elderly, immigrants, ethiopian, arab, haredi, druze, bedouin, disabilities, lgbtq, soldiers, prisoners, homeless

**20 Domains:**
education, welfare, health, mental_health, employment, technology, entrepreneurship, legal, housing, food_security, environment, culture, sports, coexistence, religion, emergency, research, advocacy, media, agriculture

**8 Regions:**
national, negev, galilee, jerusalem, center, haifa, judea_samaria, periphery

**6 Age Groups:**
0-6, 6-14, 14-18, 18-26, 26-40, 40+

### Matching Algorithm
```
For each grant/company:
  score = 0

  // Population match (highest weight)
  for each org.population in grant.populations:
    score += 15

  // Domain match
  for each org.domain in grant.domains:
    score += 10

  // Region match
  for each org.region in grant.regions:
    score += 5

  // Age group match
  for each org.ageGroup in grant.ageGroups:
    score += 5

  // Negative matching (penalty)
  if grant.excludes contains org.population:
    score -= 50

  // Normalize to 0-100
  matchScore = normalize(score)
```

### Negative Matching
Some grants explicitly exclude certain populations or domains. The DNA engine checks for these and applies heavy penalties:
- Grant for "Arab sector only" → non-Arab org gets -50
- Grant for "higher education" → youth org with no higher ed gets -30

### Creative Matching (Iron Rule #11)
Before rejecting a match, Goldfish tries creative angles:
- Youth org with 52% girls → matches "women" grants
- Periphery org → matches "Negev" or "Galilee" grants
- Tech-integrated org → matches "innovation" grants
- Mentoring org → matches "employment" + "entrepreneurship" grants

## Company Search (ilike)

### Strategy: 3-direction + fallback
```sql
-- Direction 1: Exact name match
SELECT * FROM companies WHERE name ILIKE '%user_query%'

-- Direction 2: Words from query in name
SELECT * FROM companies WHERE name ILIKE ANY(query_words)

-- Direction 3: Search in description + interests
SELECT * FROM companies
WHERE description ILIKE '%query%'
   OR interests::text ILIKE '%query%'

-- Hebrew↔English support
-- "איי סי אל" → also searches "ICL"
-- "Bank Hapoalim" → also searches "בנק הפועלים"
```

### Companies Tab Filtering
- Filter by type: business / public / private / fund
- Filter by fund subtype: foundations / federations
- Filter by match score: 70+ / 40+ / 20+
- Search by name (free text)

## Grants Filtering

### GrantsTab filters:
- **Status:** Open / Closed / All
- **Deadline:** Has deadline / No deadline / Approaching (7 days)
- **Domain:** Select from 12 categories
- **Population:** Select from 25 categories
- **Funder:** Free text search
- **Match score:** Based on org DNA

### Grant Analysis (8 sections — Iron Rule #8)
When Goldfish analyzes a grant for a user, it always provides:
1. Funding body (name, type, what they like)
2. What they're asking for (eligibility, criteria)
3. Budget (amount, co-funding requirements)
4. Deadline
5. Match score 1-10 + reasoning
6. What's missing from the org
7. Submission tip
8. URL link

## Document-Based RAG

### Smart Reader Pipeline
```
Upload (PDF/DOCX/URL/LinkedIn)
  → Text extraction
  → AI classification (category assignment)
  → Chunking (split into searchable pieces)
  → Store in documents table
  → Available for RAG in future chats
```

### RAG Process
```
User message arrives
  → Extract key terms
  → Search document chunks (vector similarity or keyword)
  → Top-K relevant chunks injected into system prompt
  → Claude uses them to answer with org-specific context
```

## Document Alerts System

### 8 Required Documents
Each org is checked for these documents (regex pattern matching on uploaded doc names):
1. ניהול תקין (Proper Management Certificate)
2. אישור 46א (Tax Deduction Certificate)
3. דוח כספי (Financial Report)
4. פרוטוקול (Board Protocol)
5. תקנון (Articles of Association)
6. אישור ניכוי מס (Tax Withholding)
7. תעודת רישום (Registration Certificate)
8. דוח מילולי (Narrative Report)

### Alert Levels
- Red: Missing critical document
- Orange: Document expired or expiring soon
- Gray: Document exists but unverified

### Expiration Checking
Some documents have dates extracted. If expired or expiring within 30 days → alert.

## Matching Score Display

### In Grants Tab
Each grant shows a match percentage badge:
- 70%+ = Green (strong match)
- 40-69% = Yellow (partial match)
- 20-39% = Orange (weak match)
- Below 20% = Hidden by default

### In Companies Tab
Similar scoring for CSR alignment:
- Compares org domains ↔ company CSR interests
- Factors in company type, donation history, geographic focus
