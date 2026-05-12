# Goldfish — Knowledge Agents (6 Agents)

Every chat session loads 6 knowledge agents in parallel. They inject context into the system prompt so Goldfish "knows" everything about companies, grants, funders, the org, sector trends, and uploaded documents.

## Agent Architecture
```
Chat Request arrives
  ├── loadCompaniesIndex()     → companiesIndex
  ├── loadGrantsIndex()        → grantsIndex
  ├── loadFundersIndex()       → fundersIndex
  ├── scanOpportunities()      → opportunityContext
  ├── scanCompanies()          → companyContext
  └── loadSectorIntelligence() → sectorContext

All 6 run in parallel (Promise.all)
Results injected into system prompt
Claude receives full context for every message
```

## Agent 1: Companies Index
**Function:** `loadCompaniesIndex()`
**Source:** `companies` table (Supabase)
**What it loads:** ALL 1,044 companies — name, type, interests, donation_amount, csr_rank
**Format:** Compact text list injected into system prompt
**Always loaded:** Yes, every chat message

### Company Types
| Type | Count | Description |
|------|-------|-------------|
| business | 524 | Private businesses |
| public | 224 | Publicly traded companies |
| private | 114 | Private companies |
| fund | 182 | Foundations, funds, federations |

### Search Strategy (findSpecificCompany)
Three-direction search + ilike fallback:
1. User message contains company name
2. Company name contains words from user message
3. `ilike` search on name + description + interests
4. Supports Hebrew↔English (e.g., "איי סי אל" = "ICL")

## Agent 2: Grants Index
**Function:** `loadGrantsIndex()`
**Source:** `grants` table (Supabase, project: touqczopfjxcpmbxzdjr)
**What it loads:** ALL 572 grants grouped by status:
- Open (with deadline) — sorted by nearest deadline
- Open (no deadline) — ongoing opportunities
- Closed — for reference (they reopen)
**Format:** Title, funder, deadline, amount, domains, populations, URL
**Always loaded:** Yes

### Grant Fields
```
id, title, funder, deadline, amount, domains[], populations[],
url, description, eligibility, submission_method, contact,
status (open/closed), created_at, source
```

## Agent 3: Funders Index
**Function:** `loadFundersIndex()`
**Source:** Aggregated from `grants` table + hardcoded deep intel
**What it loads:** 38+ identified funders with:
- Number of grants per funder
- Domains they fund
- Populations they serve
- Typical amounts
**Deep intel (hardcoded) on 12 major funders:**
1. Ministry of Education (משרד החינוך)
2. National Insurance (ביטוח לאומי)
3. Mifal HaPais (מפעל הפיס)
4. Estate Committee (ועדת עיזבונות)
5. Azrieli Foundation (עזריאלי)
6. Yad Hanadiv (יד הנדיב)
7. Rashi Foundation (רשי)
8. KKL-JNF (קק"ל)
9. JDC-Israel (ג'וינט)
10. Schusterman Foundation (שוסטרמן)
11. Weinberg Foundation (ויינברג)
12. Jewish Agency (הסוכנות היהודית)

**75 scan sources** organized by layer:
- Government (משרדי ממשלה)
- Private (קרנות פרטיות)
- International (קרנות בינלאומיות)
- Aggregators (אגרגטורים כמו גיידסטאר, מילגה)

## Agent 4: Opportunity Scanner
**Function:** `scanOpportunities()`
**Triggered by:** User asking about a specific grant or funder
**What it does:** Deep-loads full grant details (description, eligibility, submission method, contact)
**Injection:** `opportunityContext` in system prompt

## Agent 5: Company Scanner
**Function:** `scanCompanies()`
**Triggered by:** User asking about a specific company
**What it does:** Deep-loads full company details (description, CSR data, contacts, donation amounts)
**Injection:** `companyContext` in system prompt

## Agent 6: Sector Intelligence
**Function:** `loadSectorIntelligence()`
**Source:** `sector_intelligence` + `sector_knowledge` tables
**What it loads:** Current trends, news, policy changes in Israeli social sector
**Populated by:**
- Daily news scanner (`scanner/sector_scanner.py`) — 10 news sources
- Weekly Facebook scanner (`/facebook-scanner` skill) — 9 pages monitored
**Quality rule:** Only high/medium reliability. Low reliability items deleted if relevance < 60.

## How It All Connects
```
User types: "Tell me about Bank Hapoalim CSR"
  → companiesIndex already has Hapoalim in context
  → scanCompanies() detects "Bank Hapoalim" → loads full company record
  → companyContext injected with: description, donation_amount (119M),
    contact (שרונה תרשיש), CSR email, interests
  → Claude responds with deep knowledge about Hapoalim's CSR
```

```
User types: "Find grants for youth at risk in the Negev"
  → grantsIndex already has all 572 grants
  → fundersIndex has funder intelligence
  → org DNA has populations/domains/regions
  → Claude cross-references and recommends matching grants
```

## Key Files
```
lib/knowledge-agents.ts   — All 6 agent loader functions
api/chat/route.ts         — System prompt composition + injection
api/companies/route.ts    — Company search API
api/grants/route.ts       — Grants search API
lib/prompts.ts            — FISHGOLD_SYSTEM_PROMPT constants
```
