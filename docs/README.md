# Goldfish — Developer Documentation

> Complete knowledge base for the Goldfish fundraising SaaS platform.
> Last updated: 2026-05-12

## Start Here (New Developer)

| File | Read First If... |
|------|-----------------|
| [PRODUCT_BRIEF.md](PRODUCT_BRIEF.md) | You need to understand what this product is |
| [DAY_ONE.md](DAY_ONE.md) | You just joined and need to get running |
| [ENV_SETUP.md](ENV_SETUP.md) | You need API keys and environment setup |
| [ROADMAP.md](ROADMAP.md) | You need to know what to build next |

---

## Quick Start
- **Repo:** github.com/golanliron/goldfish (branch: main)
- **Live:** goldfish.co.il
- **Stack:** Next.js 16 + TypeScript + Tailwind + Supabase + Claude API
- **Deploy:** Vercel auto-deploy on push to main
- **Local:** `npm install && npm run dev` → localhost:3002

## Documentation Index

| # | File | What's Inside |
|---|------|---------------|
| 01 | [architecture.md](01-architecture.md) | Tech stack, app structure, 4 tabs (History removed), system prompt composition, env vars, deploy, gotchas |
| 02 | [knowledge-agents.md](02-knowledge-agents.md) | All 6 knowledge agents that power every chat: companies, grants, funders, opportunities, company scanner, sector intel |
| 03 | [database.md](03-database.md) | Full Supabase schema: 8 tables, data pipelines (daily scanner, sector scanner, Facebook scanner), data quality stats |
| 04 | [search-matching.md](04-search-matching.md) | DNA matching engine (16 populations, 20 domains, 8 regions), ilike search strategy, company search, grants filtering, RAG, document alerts |
| 05 | [grants-funders.md](05-grants-funders.md) | 572 grants database, 75 scan sources, 38+ funders with deep intel on 12 major ones, daily scanner architecture, grant writing agent (10-section proposals, LOI, templates) |
| 06 | [personality-behavior.md](06-personality-behavior.md) | Goldfish character DNA, writing rules (no markdown!), 13 iron behavior rules, response length guidelines, fish humor, signature phrases, secrecy rules |
| 07 | [nonprofits-sector.md](07-nonprofits-sector.md) | 185 Israeli nonprofits by sector, social sector map (42K registered, 70B NIS), government funding channels, 2026 trends |
| 08 | [federation-matching.md](08-federation-matching.md) | TOP 20 Jewish federations, P2G partnerships, $630M+ emergency fundraising, creative matching angles, entry strategies |
| 09 | [companies-csr.md](09-companies-csr.md) | 1,044 companies audit, CSR contacts (verified emails), email format patterns, Top 14 donors (Maala 2024), 182 foundations, enrichment priorities |

## Architecture Overview
```
User → goldfish.co.il → Vercel (Next.js)
  → 4 Tabs: Chat | Org | Grants | Companies+Foundations (History removed 2026-05-06)
  → Chat API → 6 Knowledge Agents (parallel) → System Prompt → Claude API
  → Supabase: companies (1,044) + grants (572) + sources (75) + orgs + docs + conversations + sector_intel
  → Daily Scanner: 79+ URLs → new grants → Supabase
```

## Key Numbers
- **1,044** companies & foundations in database
- **572** grant opportunities tracked
- **75** sources scanned daily for new grants
- **38+** identified funders with intelligence
- **185** nonprofits with deep knowledge
- **20** Jewish federations with full DNA maps
- **6** knowledge agents loaded per chat
- **13** iron behavior rules for the bot
- **7** Supabase Edge Functions (WhatsApp bot, Drive, Chatwoot, auto-reply, scheduler)

## Critical Rules
1. **UI = "Goldfish" (English).** Internal code uses `fishgold` for variables/events/files.
2. **No markdown in chat responses.** Plain text only (except formal submissions).
3. **sb_secret_ tokens don't work.** Use only anon JWT.
4. **React `{0 && ...}` renders "0".** Always use `{!!value && ...}`.
5. **Never reveal tech stack to users.** Goldfish is "an ancient fish", not AI.

## Supabase
- **Project ID:** touqczopfjxcpmbxzdjr
- **URL:** https://touqczopfjxcpmbxzdjr.supabase.co
- See [03-database.md](03-database.md) for full schema.

---

## Raw Knowledge Sources (`raw-knowledge/`)

Deep reference files — the complete source material behind the structured docs above.

| # | File | Contents |
|---|------|----------|
| 1 | [project_fishgold.md](raw-knowledge/project_fishgold.md) | **Master project map:** tech stack, 4 tabs (History removed), DNA engine, all pipelines, DB schema, API endpoints, key files, events, system prompt composition, Smart Reader |
| 2 | [fishgold_developer_handoff.md](raw-knowledge/fishgold_developer_handoff.md) | **Original dev handoff:** stack, credentials, architecture, API, file map, env vars, how to run locally, known gotchas |
| 3 | [fishgold_personality.md](raw-knowledge/fishgold_personality.md) | **Character DNA:** microcopy, fish humor, signature phrases, response lengths, writing rules, greeting templates |
| 4 | [fishgold_behavior_rules.md](raw-knowledge/fishgold_behavior_rules.md) | **13 iron rules:** self-research, secrecy, no markdown, match before suggest, creative matching, confidence levels |
| 5 | [fishgold_knowledge_agents.md](raw-knowledge/fishgold_knowledge_agents.md) | **6 knowledge agents architecture:** companiesIndex, grantsIndex, fundersIndex, orgContext, sectorContext, RAG — all loaded in parallel |
| 6 | [fishgold_funder_intelligence.md](raw-knowledge/fishgold_funder_intelligence.md) | **38+ funders with deep intel on 12:** government ministries, family foundations, international orgs, corporate CSR, 75 sources |
| 7 | [fishgold_grants_knowledge.md](raw-knowledge/fishgold_grants_knowledge.md) | **572 grants database:** taxonomy (12 categories + 25 populations), TOP 30 public companies, 92 funds, submission rules, red flags, 75 scanning sources |
| 8 | [fishgold_grant_writing_agent.md](raw-knowledge/fishgold_grant_writing_agent.md) | **Grant writing agent:** 10-section proposal structure, executive summary templates, SMART goals, budget templates, fund-type adaptation, pre-submission checklist |
| 9 | [fishgold_social_sector_knowledge.md](raw-knowledge/fishgold_social_sector_knowledge.md) | **Israeli social sector map:** 10 government ministries, Knesset committees, major nonprofits, funding channels, timelines, trends 2025-2026 |
| 10 | [fishgold_nonprofits_db_part1.md](raw-knowledge/fishgold_nonprofits_db_part1.md) | **90 nonprofits (Part 1):** education, youth at risk, youth movements, tutoring, tech education, pre-army, bilingual, food, health, disabilities, mental health, elderly, women |
| 11 | [fishgold_nonprofits_db_part2.md](raw-knowledge/fishgold_nonprofits_db_part2.md) | **95 nonprofits (Part 2):** employment, Arab sector, Haredi, Ethiopian integration, social entrepreneurship, immigration, environment, culture, coexistence, human rights, LGBTQ, emergency |
| 12 | [fishgold_document_alerts.md](raw-knowledge/fishgold_document_alerts.md) | **8 required documents:** regex patterns, alert triggers, what Goldfish asks for when docs are missing |
| 13 | [fishgold_companies_audit.md](raw-knowledge/fishgold_companies_audit.md) | **1,044 companies CSR audit:** verified contacts, email format patterns, Top 14 donors (Maala 2024), 182 foundations, enrichment priorities |
| 14 | [fishgold_jewish_federations.md](raw-knowledge/fishgold_jewish_federations.md) | **150+ Jewish federations index:** JFNA overview ($2B+), TOP 20 by budget, 11+ with Israel grants, Women's Funds, Innovation Funds, 60+ contacts |
| 15 | [fishgold_jewish_federations_part2.md](raw-knowledge/fishgold_jewish_federations_part2.md) | **Northeast US:** 46 federations — NY(11), NJ(6), PA(8), CT(6), MA(4), RI, ME, VT, NH, DE, MD, DC |
| 16 | [fishgold_jewish_federations_part3.md](raw-knowledge/fishgold_jewish_federations_part3.md) | **Southeast US:** 42 federations — FL(13), GA(4), NC(5), SC(3), VA(5), TN(4), AL(2), LA(3), KY(2), AR |
| 17 | [fishgold_jewish_federations_part4.md](raw-knowledge/fishgold_jewish_federations_part4.md) | **Midwest US:** 35 federations — IL(7), OH(8), MI(4), MN(3), WI(2), IN(4), MO(2), IA(2), NE(2), KS |
| 18 | [fishgold_jewish_federations_part5.md](raw-knowledge/fishgold_jewish_federations_part5.md) | **West/Southwest US + Canada:** 26 US + 12 Canadian federations |
| 19 | [fishgold_federation_dna_matching.md](raw-knowledge/fishgold_federation_dna_matching.md) | **DNA matching for TOP 20 federations:** creative angles, trigger keywords, funded org examples, matching algorithm pseudocode |
| 20 | [fishgold_federation_deep_research.md](raw-knowledge/fishgold_federation_deep_research.md) | **Deep research:** funded orgs, amounts, contacts, P2G partnerships, $630M+ emergency totals |
| 21 | [goldfish-developer-knowledge-base.md](raw-knowledge/goldfish-developer-knowledge-base.md) | **Unified knowledge base:** single mega-doc combining architecture, agents, DB, matching, personality — full reference |
| 22 | [agent_grants_scanner.md](raw-knowledge/agent_grants_scanner.md) | **Daily grants scanner agent:** 79+ sources, queries, matching logic, 13 currently open grants, Task Scheduler setup |
| 23 | [agent_facebook_scanner.md](raw-knowledge/agent_facebook_scanner.md) | **Facebook scanner agent:** daily feed scanning, 9 monitored pages, groups (incl. "ערך לדרך"), sector intelligence |
| 24 | [project_grant_engine.md](raw-knowledge/project_grant_engine.md) | **Grant submission engine:** screens, tables, AI logic, draft→review→submit→track workflow |
| 25 | [project_grants_system.md](raw-knowledge/project_grants_system.md) | **Grants system overview:** 428+ opportunities, 75 sources, taxonomy, Supabase schema |
| 26 | [project_smart_agent.md](raw-knowledge/project_smart_agent.md) | **Smart Input agent:** "paste content → AI extracts → fills form" template |
| 27 | [project_security.md](raw-knowledge/project_security.md) | **Security architecture:** RLS policies, Supabase Auth, Edge Functions, Vault secrets, anti-scraping |
| 28 | [project_taxonomy_sync.md](raw-knowledge/project_taxonomy_sync.md) | **Taxonomy sync:** 6 categories, 34 sub-categories, 5 regions, 20 audiences — synced across site, admin, bot |
| 29 | [spec_tab_aware_chat.md](raw-knowledge/spec_tab_aware_chat.md) | **Spec: Tab-Aware Chat** — how chat adapts behavior based on active tab |
| 30 | [spec_quality_assurance.md](raw-knowledge/spec_quality_assurance.md) | **Spec: Quality Assurance** — continuous improvement strategy, testing approach |
| 31 | [spec_onboarding_flow.md](raw-knowledge/spec_onboarding_flow.md) | **Spec: Onboarding** — what happens when a new nonprofit registers |
| 32 | [spec_smart_reader.md](raw-knowledge/spec_smart_reader.md) | **Spec: Smart Reader** — PDF/DOCX/URL → AI classification → chunks → RAG pipeline |
| 33 | [spec_daily_scanners.md](raw-knowledge/spec_daily_scanners.md) | **Spec: Daily Scanners** — architecture for grants + sector + Facebook scanning |
| 34 | [spec_email_outreach.md](raw-knowledge/spec_email_outreach.md) | **Spec: Email Outreach** — smart outreach email composition for funders |
| 35 | [spec_research_agents.md](raw-knowledge/spec_research_agents.md) | **Spec: Research Agents** — 20 social research domains, academic sources only |
| 36 | [spec_companies_federations_separation.md](raw-knowledge/spec_companies_federations_separation.md) | **Spec: Companies/Federations Separation** — separating companies tab from foundations/federations |
| 37 | [project_alomot_documents.md](raw-knowledge/project_alomot_documents.md) | **Alomot Association docs:** legal entity (580560407), required filings, submission documents |
| 38 | [project_giyus_bot.md](raw-knowledge/project_giyus_bot.md) | **Giyus-Bot:** parallel SaaS product, separate Supabase (pwouumcvtcwtsxuskctf), architecture |

### Edge Functions (`raw-knowledge/edge-functions/`)

Live Supabase Edge Functions — the actual deployed code:

| # | File | What It Does |
|---|------|--------------|
| 1 | [goldfish-whatsapp.ts](raw-knowledge/edge-functions/goldfish-whatsapp.ts) | **Goldfish WhatsApp Bot** (332 lines) — Claude API chat, grants+companies search, conversation history, org detection |
| 2 | [drive-list.ts](raw-knowledge/edge-functions/drive-list.ts) | **Google Drive integration** (180 lines) — Service Account JWT auth, folder listing, file metadata |
| 3 | [whatsapp-webhook.ts](raw-knowledge/edge-functions/whatsapp-webhook.ts) | **WhatsApp Webhook** (363 lines) — Meta webhook handler, message routing |
| 4 | [lead-auto-reply.ts](raw-knowledge/edge-functions/lead-auto-reply.ts) | **Lead Auto-Reply** (179 lines) — automatic response to new leads |
| 5 | [chatwoot-to-whatsapp.ts](raw-knowledge/edge-functions/chatwoot-to-whatsapp.ts) | **Chatwoot→WhatsApp bridge** (174 lines) — bidirectional messaging |
| 6 | [group-monitor.ts](raw-knowledge/edge-functions/group-monitor.ts) | **WhatsApp Group Monitor** (315 lines) — monitors WA groups, feeds to Chatwoot |
| 7 | [send-scheduled.ts](raw-knowledge/edge-functions/send-scheduled.ts) | **Scheduled Messages** (157 lines) — sends queued WA messages |
