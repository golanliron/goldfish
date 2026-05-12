# Goldfish — Developer Handoff Document

> **Last updated:** 2026-05-06 | **Status:** Production, live at goldfish.co.il (+ amuta-os.vercel.app fallback)

---

## What is Goldfish?

AI-powered fundraising SaaS for Israeli nonprofits. A "golden fish" character (Goldfish, internal code name: fishgold) with 50+ years of fundraising experience helps organizations find grants, write proposals, and connect with donors.

**Branding:** UI/UX uses "Goldfish" (English). Internal code (variables, events, file names) still uses "fishgold".

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript (strict) |
| Styling | Tailwind CSS |
| Database | Supabase (PostgreSQL) |
| AI | Claude API (Anthropic) |
| Hosting | Vercel (auto-deploy from main) |
| Repo | github.com/golanliron/amuta-os (main branch) |

## Key Credentials & IDs

| Key | Value |
|-----|-------|
| Supabase Project ID | `touqczopfjxcpmbxzdjr` |
| Supabase URL | https://touqczopfjxcpmbxzdjr.supabase.co |
| Vercel URL | https://amuta-os.vercel.app |
| Dev port | 3002 |
| Dev org ID | d5f860e8-4958-408c-a00f-679a93f1d470 |
| Chat model | claude-sonnet-4-20250514 |
| Scoring model | claude-haiku-4-5-20251001 |

**CRITICAL:** `sb_secret_` keys don't work with supabase-js! Use anon JWT only. See `src/lib/supabase/admin.ts`.

---

## Architecture Overview

### 5 Tabs (UI):
1. **Chat** (ChatPanel.tsx) — Streaming AI chat with Goldfish character
2. **Organization** (OrgTab.tsx) — Org profile, documents, knowledge bar (18-point scoring)
3. **Opportunities** (OpportunitiesTab.tsx) — 428 grants, DNA-based matching
4. **History** (HistoryTab.tsx) — Conversations + submissions
5. **Companies** (BusinessTab.tsx) — 954 companies/funds, relevance scoring

### System Prompt Architecture (the brain):

```
fishgold.ts exports:
  FISHGOLD_SYSTEM_PROMPT    (~302 lines) — personality, iron rules, writing style
  FISHGOLD_GRANT_EXPERTISE  (~55 lines)  — proposal structure, budgets, funder types
  FISHGOLD_SECTOR_KNOWLEDGE (~55 lines)  — Israeli social sector map, top donors
  buildOrgContext()                       — org profile card builder
  buildContext()                          — RAG chunks formatter
```

```
route.ts line ~1086 composes the full prompt:
  systemPrompt = FISHGOLD_SYSTEM_PROMPT
    + FISHGOLD_GRANT_EXPERTISE      // static: grant writing expertise
    + FISHGOLD_SECTOR_KNOWLEDGE     // static: sector knowledge
    + tabFocus                      // dynamic: which tab is active
    + orgContext                    // dynamic: org profile card
    + docSummary + knowledge + rag  // dynamic: uploaded documents
    + opportunityContext            // dynamic: matched grants (DNA scoring)
    + companyContext                // dynamic: specific company if asked
    + companiesIndex               // dynamic: all 954 companies index
    + grantsIndex                   // dynamic: all grants with details
    + sectorContext                 // dynamic: sector intelligence news
```

### DNA Matching Engine (`src/lib/ai/org-dna.ts`):
- `extractOrgDNA(profile)` — extracts: 16 populations, 18 domains, 8 regions, 6 age groups, 11 core themes, negative lists
- `scoreDNAMatch(orgDna, categories, populations, title)` — scores 0-100 with negative matching (blocks mismatched grants)

---

## Database Schema (Supabase)

### Core Tables:
| Table | Records | Purpose |
|-------|---------|---------|
| `opportunities` | 428 | Grants/calls for proposals (22 fields incl. categories[], target_populations[], deadline) |
| `companies` | 954 | Donors/funds/businesses (16 fields incl. interests[], donation_amount) |
| `grant_sources` | 75 | Scanning sources (4 layers: government, ngo, international, aggregator) |
| `grant_taxonomy` | ~60 | Categories + populations taxonomy |
| `matches` | 211+ | AI-scored org-to-opportunity matches |
| `documents` | 28+ | Uploaded org documents (RAG chunks) |
| `conversations` | N | Chat history |
| `organizations` | 1+ | Registered orgs |
| `org_profiles` | 1+ | Org profile data (JSONB) |
| `submissions` | N | Grant submissions (draft/review/submitted/approved/rejected) |
| `sector_knowledge` | N | Sector intelligence articles |
| `sector_intelligence` | N | Scanned sector news |

### Company Types Distribution:
- business: 524, public: 224, private: 114, fund: 92

---

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/chat` | Main chat (streaming SSE, tab-aware) |
| POST | `/api/scan` | Standalone opportunity scan |
| POST | `/api/upload` | Document upload + AI extraction |
| GET | `/api/conversations` | Last conversation for org |
| GET | `/api/conversations/[id]` | Load specific conversation |
| GET | `/api/opportunities` | Opportunities + DNA matching |
| GET | `/api/companies` | Companies + keyword scoring |
| POST | `/api/org` | Save org profile |
| GET | `/api/org` | Load org profile + documents |
| POST | `/api/learn-url` | Scrape URL, save as document |
| POST | `/api/smart-reader` | Unified reader: PDF/DOCX/XLSX/URL/LinkedIn + RAG |

---

## Key Files Map

```
src/
  app/
    page.tsx                          — Landing page
    (dashboard)/layout.tsx            — Dashboard layout, mobile tabs
    api/
      chat/route.ts                   — CORE: chat handler, prompt composition, all loaders
      opportunities/route.ts          — DNA-based matching API
      companies/route.ts              — Company scoring API
      conversations/[id]/route.ts     — Load conversation by ID
      upload/route.ts                 — Document upload + AI extraction
      org/route.ts                    — Org profile CRUD
      learn-url/route.ts              — URL scraping
  lib/
    ai/
      fishgold.ts                     — System prompts (personality + expertise + sector)
      org-dna.ts                      — DNA extraction + scoring engine
    supabase/
      admin.ts                        — Supabase admin client (USES ANON KEY!)
      grants-db.ts                    — Grants DB client
  components/
    chat/ChatPanel.tsx                — Chat UI, streaming, tab-aware
    sidebar/
      SidebarPanel.tsx                — 4 tabs container
      OrgTab.tsx                      — Profile card, knowledge bar, documents
      OpportunitiesTab.tsx            — Grants list, match filters, calendar
      HistoryTab.tsx                  — Conversations + submissions
      BusinessTab.tsx                 — Companies list, relevance scoring
  types/index.ts                      — All TypeScript types
```

---

## Cross-Component Events (CustomEvents)

| Event | Purpose |
|-------|---------|
| `fishgold:send` | Send message to chat from any component |
| `fishgold:activeTab` | Notify chat of active tab (changes placeholder + quick actions) |
| `fishgold:loadConversation` | Load previous conversation into chat |
| `fishgold:closeSidebar` | Close sidebar (mobile) |

---

## Known Issues & Gotchas

1. **`sb_secret_` incompatible** — supabase-js can't use service role keys in this setup. Use anon JWT
2. **React `{0 && <el>}`** — renders "0" on screen. Always use `!!value && ...`
3. **SPA links** (btl.gov.il, pob.education.gov.il) — tries Jina Reader fallback. PDF links now auto-download and parse!
7. **Smart Reader** — `/api/smart-reader` unified endpoint reads PDF/DOCX/XLSX from URLs, LinkedIn via Jina, saves to RAG
4. **Vercel auto-deploy** — every push to main = live deploy. Test locally first!
5. **TypeScript strict** — check types before push
6. **DocumentCategory** type in `types/index.ts` — update when adding categories

---

## What to Build Next (Roadmap Ideas)

1. **More grants scanning** — Playwright for SPA government portals
2. **Submission workflow** — draft → review → submit → track status
3. **Multi-org support** — Currently optimized for 1 org (Hopa)
4. **Email integration** — Send proposal emails directly from the platform
5. **Dashboard analytics** — Track success rates, response times, funding raised
6. **WhatsApp bot** — Goldfish via WhatsApp for quick queries
7. **Hebrew NLP improvements** — Better entity extraction for org profiles

---

## Environment Variables (Vercel)

```
ANTHROPIC_API_KEY=sk-ant-...
NEXT_PUBLIC_SUPABASE_URL=https://touqczopfjxcpmbxzdjr.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ... (NOT USED by supabase-js, kept for edge functions)
```

---

## How to Run Locally

```bash
cd amuta-os
npm install
npm run dev -- -p 3002
# Open http://localhost:3002
```
