# Goldfish — Architecture & Stack

## Tech Stack
- **Framework:** Next.js 16 (App Router)
- **Language:** TypeScript
- **Styling:** Tailwind CSS
- **Database:** Supabase (PostgreSQL)
- **AI:** Claude API (Anthropic)
- **Deploy:** Vercel (auto-deploy from GitHub push)
- **Domain:** goldfish.co.il
- **Repo:** golanliron/goldfish (branch: main)

## Supabase Project
- **Project ID:** touqczopfjxcpmbxzdjr
- **Region:** eu-central-1
- **Auth:** Supabase Auth (email/password)
- **Important:** `sb_secret_` tokens do NOT work! Use only `anon` JWT for API calls.

## Environment Variables (Vercel)
```
NEXT_PUBLIC_SUPABASE_URL=https://touqczopfjxcpmbxzdjr.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service role key>
ANTHROPIC_API_KEY=<claude api key>
```

## App Structure (actual file paths from repo)
```
src/
  app/
    page.tsx                          — Landing page
    (dashboard)/layout.tsx            — Dashboard layout, mobile tabs, sidebar toggle
    api/
      chat/route.ts                   — CORE: chat handler, prompt composition, all loaders
      opportunities/route.ts          — DNA-based matching API
      companies/route.ts              — Company scoring API
      conversations/[id]/route.ts     — Load conversation by ID
      upload/route.ts                 — Document upload + AI extraction
      org/route.ts                    — Org profile CRUD
      learn-url/route.ts              — URL scraping
      smart-reader/route.ts           — Unified reader: PDF/DOCX/XLSX/URL/LinkedIn + RAG
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
      BusinessTab.tsx                 — Companies list, relevance scoring
  types/index.ts                      — All TypeScript types
```

## 4 Main Tabs (History tab removed 2026-05-06)
1. **Chat** (ChatPanel.tsx) — Streaming AI conversation with Goldfish character
2. **Organization** (OrgTab.tsx) — Org profile, documents, 18-point knowledge bar, document alerts
3. **Grants** (OpportunitiesTab.tsx) — Browse/filter 572 opportunities with DNA-based matching
4. **Companies & Foundations** (BusinessTab.tsx) — 1,044 companies & funds with CSR data, separate foundations tab

## System Prompt Composition (order matters!)
```
FISHGOLD_SYSTEM_PROMPT          — Character + base rules
+ FISHGOLD_GRANT_EXPERTISE      — Grant writing knowledge
+ FISHGOLD_SECTOR_KNOWLEDGE     — Israeli social sector map
+ tabFocus                      — Which tab user is on
+ orgContext                    — Current org profile + DNA
+ docSummary                    — Uploaded documents summary
+ knowledge                    — RAG results from docs
+ rag                          — Additional RAG context
+ opportunityContext            — If asking about specific grant
+ companyContext                — If asking about specific company
+ companiesIndex               — All 1,044 companies (always loaded)
+ grantsIndex                  — All grants by status (always loaded)
+ fundersIndex                 — Aggregated funder intelligence (always loaded)
+ sectorContext                — Sector intelligence data
```

## Cross-Component Events (CustomEvent)
```javascript
// Send message to chat from any component
window.dispatchEvent(new CustomEvent('fishgold:send', { detail: { message } }))

// Notify chat which tab is active (changes placeholder + quick actions)
window.dispatchEvent(new CustomEvent('fishgold:activeTab', { detail: { tab } }))

// Load previous conversation into chat
window.dispatchEvent(new CustomEvent('fishgold:loadConversation', { detail: { id } }))

// Close sidebar (mobile)
window.dispatchEvent(new CustomEvent('fishgold:closeSidebar'))
```

## Key Gotchas
1. **React `{0 && ...}` renders "0"** — Always use `{!!value && ...}` or ternary
2. **sb_secret_ tokens fail** — Use only anon JWT with RLS policies. `createAdminClient()` uses `NEXT_PUBLIC_SUPABASE_ANON_KEY` (not service role!)
3. **API limit:** companies route loads up to 1100 records. Grant DB is separate Supabase project (vhmwijzcrqjjquxomccq)
4. **Naming:** UI says "Goldfish" (English). Internal code uses `fishgold` for events, variables, file names
5. **RTL:** Everything is right-to-left (Hebrew). Heebo font.
6. **Vercel cold starts:** First request after idle may be slow (5-10s)
7. **Hebrew apostrophe bug:** ׳ (U+05F3 geresh) != ' (U+0027). DB stores ASCII, users type Hebrew. `normalizeApostrophes()` handles this.
8. **Two Supabase projects:** Main app = touqczopfjxcpmbxzdjr. Grants DB = vhmwijzcrqjjquxomccq.
9. **TypeScript strict** — check types before push. DocumentCategory type in `types/index.ts` must match if adding categories.

## Local Development
```bash
git clone https://github.com/golanliron/goldfish.git
cd goldfish
npm install
# Copy .env.local with all env vars
npm run dev
# Runs on localhost:3002
```

## Deploy
Push to `main` branch → Vercel auto-deploys to goldfish.co.il
