# Goldfish — Roadmap to Production

> What needs to happen before this becomes a real SaaS product.
> Priority order: P0 = blocker, P1 = critical, P2 = important, P3 = nice to have.

---

## P0 — Must Have Before Any Paying Customer

### 1. Multi-Tenant Architecture
**Problem:** Currently hardcoded to one org ID (`DEV_ORG_ID = d5f860e8-4958-408c-a00f-679a93f1d470`).
Every user sees the same org's data.

**What to build:**
- Replace hardcoded `DEV_ORG_ID` with `req.user.org_id` everywhere in the codebase
- `src/app/api/chat/route.ts` — main culprit (look for `DEV_ORG_ID`)
- All other API routes: org, upload, learn-url, opportunities, companies
- RLS policies already exist in Supabase — just need to pass real user context

**Files to touch:** All `src/app/api/*/route.ts`

---

### 2. Stripe Billing
**Problem:** No payment system. No way to charge customers.

**What to build:**
- Stripe Checkout (subscription, monthly)
- Webhook handler for `customer.subscription.created/deleted`
- `organizations` table: add `stripe_customer_id`, `subscription_status`, `trial_ends_at`
- Middleware: block dashboard if subscription expired
- Pricing page on landing

**Suggested stack:** Stripe + `stripe` npm package + Supabase for subscription state

---

### 3. Terms of Service + Privacy Policy
**Problem:** No legal documents. Can't collect data from paying customers without them.

**What to build:**
- Static pages: `/terms` and `/privacy`
- Checkbox on signup: "I agree to Terms of Service"
- Store `tos_accepted_at` timestamp on user

---

## P1 — Critical for Real Users

### 4. Proper Onboarding
**Current state:** Onboarding exists but is rough.
- Steps: org name → upload docs → website URL → social links
- Google OAuth works
- Profile enrichment from docs works

**What to improve:**
- Progress bar
- Better error messages
- Email confirmation after signup
- Welcome email (use Resend or similar)

---

### 5. Email Notifications
**Problem:** RESEND_API_KEY is needed but not yet active.

**What to build:**
- Welcome email on signup
- Weekly digest: new matching grants this week
- Alert: grant deadline in 7 days
- Document alert: your compliance doc expires soon

**Edge Function:** `notify-inquiry` already exists, needs RESEND_API_KEY in Supabase secrets.

---

### 6. Dashboard Analytics (Internal)
**Problem:** We don't know how users use the product.

**What to build:**
- Track: logins, messages sent, grants viewed, proposals generated
- Simple admin dashboard at `/admin` (password protected)
- Use PostHog or Mixpanel (free tier is enough to start)

---

## P2 — Important Features

### 7. Submission Tracking
**Current state:** `submissions` table exists with outcome/feedback fields.
**What to build:**
- UI to log a submission: which grant, date, amount requested
- Track outcome: approved / rejected / pending
- Show win rate per org

### 8. Grant Writing UI
**Current state:** Goldfish writes proposals in chat (works well).
**What to build:**
- Dedicated "Write Proposal" screen
- Select a grant → Goldfish generates → user edits inline
- Export as DOCX
- Save versions

### 9. More Scanning Sources
**Current state:** 63 sources, scanned daily.
**What to add:**
- All government ministries (currently missing: Agriculture, Environmental Protection, Economy)
- ISF (Israel Science Foundation)
- BSF (Binational Science Foundation)
- Sports/culture/religious foundations
- Playwright-based scraping for JS-rendered gov.il pages (current scanner uses requests)

---

## P3 — Future / Nice to Have

### 10. WhatsApp Bot
WhatsApp integration already partially built (Edge Functions exist).
Allow nonprofits to chat with Goldfish via WhatsApp.

### 11. Multi-Language
English interface for diaspora organizations or international funders.

### 12. Team Access
Allow multiple users per organization (e.g., CEO + program manager).

### 13. Grant Pipeline (CRM-style)
Kanban board: Discovered → Drafting → Submitted → Won/Lost

---

## Technical Debt to Address

| Issue | Where | Priority |
|-------|--------|----------|
| Hardcoded DEV_ORG_ID | All API routes | P0 |
| No payment/billing | — | P0 |
| No ToS/Privacy | — | P0 |
| RESEND_API_KEY missing | Supabase secrets | P1 |
| Console.error debugging left in | route.ts | Low |
| Gemini API costs uncapped | upload, learn-url | Medium |
| Two Supabase projects (main + grants) | DB layer | Medium — consider merging |

---

## Quick Wins (1-2 days each)

1. Add `RESEND_API_KEY` to Supabase → email notifications work
2. Add PostHog analytics → know how users use the product
3. Add `/terms` and `/privacy` static pages → legal coverage
4. Wire Stripe Checkout → first paying customer possible
5. Remove `DEV_ORG_ID` + use session org_id → multi-tenant works

---

## What's Already Production-Ready

- AI chat with streaming (stable)
- Grant matching + DNA engine (stable)
- Document ingestion pipeline (stable)
- Daily grant scanner (running, fixed 2026-05-10)
- Google OAuth login (stable)
- Vercel auto-deploy (stable)
- goldfish.co.il domain (live)
