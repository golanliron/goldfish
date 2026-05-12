# Goldfish — Product Brief

> For developers, investors, and partners who need to understand what this is before touching code.

---

## What is Goldfish?

Goldfish is an AI-powered fundraising SaaS platform for Israeli nonprofits.

The product presents itself as "Goldfish" — an ancient, wise goldfish with 50+ years of fundraising experience. Users chat with Goldfish to find grants, get matched with corporate donors, and write full grant proposals. The AI handles the heavy lifting: matching, writing, researching, and advising.

**The core promise:** A small nonprofit with no fundraising staff can use Goldfish to do what a senior grant writer with deep sector knowledge would do — in minutes, not months.

---

## The Problem

Israeli nonprofits (42,000+ registered) collectively raise billions of shekels per year, but most organizations:
- Don't know which grants exist or where to find them
- Can't afford professional grant writers (3,000-8,000 NIS per proposal)
- Miss deadlines because they're not tracking opportunities
- Write generic proposals that get rejected
- Don't know which companies donate or how to approach them

The sector has hundreds of funding sources (government ministries, foundations, corporate CSR, Jewish diaspora federations) but no single place that aggregates, matches, and helps write.

---

## The Solution

Goldfish gives every nonprofit a senior fundraising advisor that:
- Knows every active grant opportunity in Israel (411+ tracked, updated daily)
- Knows 957 Israeli companies and their CSR giving history
- Knows 150+ Jewish federations in the US with their Israel programs
- Matches the organization's specific profile (DNA) to the right opportunities
- Writes full grant proposals in professional Hebrew (not AI-sounding)
- Remembers everything across sessions (org memory)
- Reads and understands the organization's own documents

---

## Who Uses It

**Primary:** Israeli nonprofit executives and program managers who need to raise money.

**Secondary:** Grant consultants who manage multiple organizations.

**Not for:** Individual donors, government agencies, commercial businesses.

---

## Business Model (Planned)

- SaaS subscription per organization
- Pricing TBD (target: ~300-500 NIS/month per org)
- Payment: Stripe (not yet implemented)
- Multi-tenant: each org sees only their own data (not yet implemented — currently hardcoded to one org)

---

## Current State (as of 2026-05-12)

**What works:**
- Full AI chat with Goldfish character (Claude Sonnet)
- DNA-based grant matching (411 opportunities)
- 957 companies + funds database with relevance scoring
- Document upload (PDF, DOCX, XLSX, URLs, LinkedIn, Google Drive)
- Grant proposal writing in professional Hebrew
- Daily automated scanning for new grants
- Org memory (persists across sessions)
- Onboarding flow
- Google OAuth login

**What's missing for real production:**
- Multi-tenant (currently hardcoded to one org ID)
- Stripe / payment system
- Terms of Service + Privacy Policy
- Customer analytics
- Support system

---

## Key Numbers

| Metric | Value |
|--------|-------|
| Grant opportunities | 411 active |
| Companies & funds | 957 |
| Scanning sources | 63 URLs |
| Major funders tracked | 38+ |
| Israeli nonprofits in KB | 224 |
| US Jewish federations | 150+ |
| Documents supported | PDF, DOCX, XLSX, URL, LinkedIn, Drive |

---

## What Makes It Different

1. **DNA matching** — not keyword search. The system understands the org's populations, domains, geography, and age groups, then scores every grant against that profile.

2. **Human-quality proposals** — proposals read like a real grant writer wrote them. No bullet points, no markdown, no "אנו שמחים לציין". Full narrative paragraphs.

3. **Sector depth** — built on deep knowledge of Israeli nonprofit sector: which ministries fund what, how to write for each funder type, what Jewish federations care about.

4. **Daily scanning** — new grants added automatically every morning from 63 sources.

5. **Full document ingestion** — the org uploads their budget, annual report, strategy — Goldfish reads it all and uses it when writing proposals.

---

## Domain & Branding

- **Domain:** goldfish.co.il (live)
- **Brand name:** Goldfish (English, always)
- **Internal code name:** fishgold (for variables, events, file names — do not change)
- **Character:** The goldfish speaks in first person, never reveals it's AI, refers to its "50 years of experience"
