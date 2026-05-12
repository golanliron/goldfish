# Goldfish — Product History & Key Decisions

> Why things are the way they are. Read this before touching core architecture.

---

## The Big Picture

Goldfish started as a simple chatbot and evolved into a full SaaS platform.
Every major decision below was made for a specific reason — don't undo them without understanding why.

---

## Major Milestones

### Phase 1 — Basic Chatbot
- Claude API chat with a goldfish character
- Manual grant list, no matching
- Single org (Hopa — hardcoded)

### Phase 2 — DNA Matching Engine
- Built `org-dna.ts` — extracts populations, domains, regions from org profile
- Scores every grant against org DNA (0-100)
- **Key decision:** negative matching (blocks mismatched grants immediately)
- This replaced keyword search which was too noisy

### Phase 3 — Document Intelligence
- Smart Reader: PDF, DOCX, XLSX, URLs, LinkedIn, Google Drive
- **Key decision:** switched from Claude to Gemini for document analysis
  - Why: Gemini 2.5 Pro handles long documents better, multimodal for XLSX/OCR
  - Claude still used for chat and proposals (better writing quality)
- `maxDuration=60` added because Gemini classify+extract+summarize = 15-20s

### Phase 4 — Data Quality
- 957 companies cleaned: removed 76 duplicates, nulled ~949 fake info@ emails
- 411 grant opportunities, 63 scan sources
- Daily scanner runs at 07:00 (grants) + 07:15 (sector intel)
- `cleanup_expired()` runs automatically — kills opportunities past deadline

### Phase 5 — Onboarding & Auth
- Google OAuth login
- Onboarding flow: org name → chips (populations/domains) → docs → URLs
- Admin bypass: `golanliron1@gmail.com` skips all redirects
- `?preview=1` param skips auth for demos

### Phase 6 — Multi-Knowledge System
- 8 knowledge layers loaded per chat (see `docs/02-knowledge-agents.md`)
- Fast/heavy path split: simple chat = 2 DB queries, complex = full load
- `fishgold.ts` grew to 1,754 lines — the entire AI brain in one file

---

## Key Technical Decisions & Why

### Why two Supabase projects?
- Main app (`touqczopfjxcpmbxzdjr`): orgs, users, documents, conversations
- Grants DB (`vhmwijzcrqjjquxomccq`): grant opportunities scraped daily
- Reason: grants DB is written by a Python scanner running locally on Windows Task Scheduler. Keeping it separate means the scanner can't accidentally affect user data.

### Why `sb_secret_` tokens don't work?
- Discovered in production: supabase-js client rejects `sb_secret_` prefixed keys
- Only `eyJ...` JWT format works
- `createAdminClient()` in `admin.ts` falls back to anon key + RLS

### Why `normalizeApostrophes()`?
- Hebrew geresh character `׳` (U+05F3) is NOT the same as ASCII apostrophe `'` (U+0027)
- DB stores ASCII, users type Hebrew
- Searching "צ׳ק פוינט" failed to find "צ'ק פוינט" in DB
- Fixed with normalization in every search function

### Why is `DEV_ORG_ID` hardcoded?
- Started as a demo for one org (Hopa)
- Multi-tenant auth was added later but DEV_ORG_ID wasn't fully replaced everywhere
- **This is the #1 blocker for real production** — see `docs/ROADMAP.md`

### Why `{!!value && ...}` instead of `{value && ...}`?
- React renders the number `0` literally on screen when value=0
- `{0 && <Component>}` shows "0" in the UI
- Always use `{!!value && ...}` for boolean checks on numbers

### Why is the UI "Goldfish" but code is "fishgold"?
- Started as internal name "fishgold"
- Rebranded to "Goldfish" for the product
- Renaming all internal code was too risky mid-development
- Convention: UI-facing strings = "Goldfish", code variables/events/files = "fishgold"

### Why does the AI never say "I'm AI"?
- Character rule: Goldfish is "an ancient fish with 500 years of experience"
- Users find it more engaging than a generic AI assistant
- Hardcoded rule in `FISHGOLD_SYSTEM_PROMPT` in `fishgold.ts`

---

## What Was Tried and Removed

- **History tab** — removed 2026-05-06. Was confusing users, merged into chat flow.
- **Atlas Grants** — removed completely. All data is Goldfish-native now. Never mention "Atlas" anywhere.
- **`amuta-os` repo** — old repo name. Everything moved to `golanliron/goldfish`. The old repo may still exist but is outdated.
- **Direct service role key** — tried using `SUPABASE_SERVICE_ROLE_KEY` with supabase-js. Doesn't work. RLS + anon key is the pattern.

---

## The Scanner (Windows Task Scheduler)

Two Python scripts run locally on Liron's Windows machine:
- `scanner/daily_grants_scan.py` — 07:00 daily, scans 63 sources, saves to Grants DB
- `scanner/facebook_sector_scanner.py` — 07:15 daily, scans sector news

**Important:** These run on a specific Windows machine. If that machine is off, no new grants are added.
Moving these to Vercel cron jobs is on the roadmap.
