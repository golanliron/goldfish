# Goldfish — AI-Powered Resource Mobilization Platform

SaaS platform that helps nonprofits find grants, match funders, and manage submissions using AI.

## Quick Start

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Environment Variables

Create `.env.local` with:

```
ANTHROPIC_API_KEY=         # Claude API (Sonnet for chat, Haiku for scanning)
GOOGLE_AI_API_KEY=         # Gemini 2.5 Pro (document analysis)
SUPABASE_URL=              # Supabase project URL
SUPABASE_ANON_KEY=         # Supabase anon key
SUPABASE_SERVICE_ROLE_KEY= # Supabase admin key
CRON_SECRET=               # Auth for Vercel cron jobs
GREEN_API_URL=             # WhatsApp API (Green API)
GREEN_API_TOKEN=           # WhatsApp API token
```

## Architecture

```
src/
  app/
    (auth)/           # Login, signup
    (dashboard)/      # Main dashboard (tabs: chat, org, grants, companies)
    onboarding/       # New org signup + AI profile building
    api/
      chat/           # AI chat (Claude Sonnet) — main interface
      opportunities/  # Grants API + DNA matching
      org/            # Organization profile & memory
      submissions/    # Grant submission management
      smart-reader/   # PDF/DOCX/URL/social → AI extraction
      upload/         # File upload to Supabase storage
      cron/
        scan-sources/       # Daily grant scanner (22+ sources)
        scan-federations/   # Jewish federation scanner (5 sources)
        enrich-companies/   # Company CSR enrichment via AI
        notify-matches/     # WhatsApp alerts for new matches
  lib/
    ai/
      org-dna.ts      # DNA matching algorithm (populations, domains, regions)
      gemini.ts       # Gemini integration (document analysis)
    supabase/
      admin.ts        # Supabase admin client
```

## Cron Jobs (Vercel)

| Job | Schedule | What it does |
|-----|----------|-------------|
| scan-sources | 06:00 + 18:00 UTC | Scans 22+ grant sources, extracts with AI |
| scan-federations | 07:00 + 19:00 UTC | Scans Jewish federation directories |
| enrich-companies | 05:00 UTC | Enriches business companies (website, CSR, contacts) |
| notify-matches | 08:00 UTC | Sends WhatsApp alerts for high-scoring matches |

## Key Database Tables (Supabase)

- `organizations` — tenant orgs (multi-tenant)
- `opportunities` — grants/calls for proposals (600+)
- `companies` — businesses, funds, federations (950+)
- `submissions` — grant submission tracking
- `org_memory` — AI-extracted org facts (key/value)
- `documents` — uploaded docs + AI summaries
- `scan_logs` — cron job history
- `sources` — grant source registry (63)

## Tech Stack

- **Framework:** Next.js 15 (App Router)
- **AI:** Claude Sonnet (chat) + Claude Haiku (scanning) + Gemini 2.5 Pro (docs)
- **Database:** Supabase (PostgreSQL + RLS)
- **Deploy:** Vercel (auto-deploy from main)
- **WhatsApp:** Green API
- **Styling:** Tailwind CSS

## Developer Docs

See [`docs/`](docs/) for the full knowledge base:

| File | What's Inside |
|------|---------------|
| [docs/README.md](docs/README.md) | Index of all documentation |
| [docs/PRODUCT_BRIEF.md](docs/PRODUCT_BRIEF.md) | What is Goldfish, who uses it, current state |
| [docs/DAY_ONE.md](docs/DAY_ONE.md) | Getting started — hour by hour |
| [docs/ENV_SETUP.md](docs/ENV_SETUP.md) | All env vars + where to get them |
| [docs/ROADMAP.md](docs/ROADMAP.md) | What to build next (P0→P3) |
| [docs/01-architecture.md](docs/01-architecture.md) | Tech stack, file map, system prompt |
| [docs/03-database.md](docs/03-database.md) | Full Supabase schema |
| [docs/04-search-matching.md](docs/04-search-matching.md) | DNA matching engine |
| [docs/raw-knowledge/](docs/raw-knowledge/) | Deep reference files — all knowledge |
