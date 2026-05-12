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

See [GRANTS_SYSTEM.md](GRANTS_SYSTEM.md) for detailed grant scanning architecture.
