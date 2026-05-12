# Goldfish — Developer Day One Guide

> You just joined the project. Here's exactly what to do in order.

---

## Hour 1: Understand the Product

Read in this order:
1. [PRODUCT_BRIEF.md](PRODUCT_BRIEF.md) — what is this, who uses it, current state
2. [README.md](README.md) — quick start + full doc index
3. [01-architecture.md](01-architecture.md) — tech stack + file map

---

## Hour 2: Get the Code Running

```bash
# Clone
git clone https://github.com/golanliron/goldfish.git
cd goldfish

# Install
npm install

# Get .env.local from Liron (ask for it)
# It contains: Supabase keys, Anthropic API key, Gemini API key

# Run
npm run dev
# Opens on http://localhost:3002
```

Login with the credentials Liron gives you (or `golanliron1@gmail.com` with Google OAuth).

You should see:
- Landing page at localhost:3002
- After login: 4-tab dashboard (Chat, Org, Grants, Companies)
- Goldfish character in the chat tab

---

## Hour 3: Explore the App

Do each of these manually to understand the product:

1. **Chat tab** — Type "מה מענקים זמינים לעמותת נוער?" and read the response
2. **Org tab** — Look at the org profile and knowledge bar
3. **Grants tab** — Filter by match percentage, click a grant
4. **Companies tab** — Switch to "מותאמים", look at a company card

---

## Hour 4: Read the Code

Open these files in this order:

1. `src/lib/ai/fishgold.ts` — This is the brain. The entire personality, rules, and knowledge of the AI is here.
2. `src/app/api/chat/route.ts` — This is the most complex file. ~1400 lines. It composes the full AI prompt.
3. `src/lib/ai/org-dna.ts` — The DNA matching engine. How grants are scored against the org.
4. `src/components/chat/ChatPanel.tsx` — The chat UI. Streaming, tab-awareness, abort controller.

---

## The Most Important Thing to Know

**There is one hardcoded org ID everywhere:**

```typescript
const DEV_ORG_ID = 'd5f860e8-4958-408c-a00f-679a93f1d470'
```

This is Hopa's org. Every user currently sees Hopa's data. The #1 task before launch is replacing this with the authenticated user's org ID.

Search for `DEV_ORG_ID` in the codebase — it appears in multiple API routes. Each one needs to read from the session instead.

---

## What's Deployed Where

| Thing | URL |
|-------|-----|
| Live app | https://goldfish.co.il |
| Vercel dashboard | https://vercel.com (ask for access) |
| Supabase (main) | https://supabase.com/dashboard/project/touqczopfjxcpmbxzdjr |
| Supabase (grants) | https://supabase.com/dashboard/project/vhmwijzcrqjjquxomccq |
| GitHub repo | https://github.com/golanliron/goldfish |

Every push to `main` auto-deploys to goldfish.co.il via Vercel.

---

## Gotchas That Will Bite You

1. **Two Supabase projects.** Main app data = `touqczopfjxcpmbxzdjr`. Grant opportunities = `vhmwijzcrqjjquxomccq`. Don't mix them up.

2. **`sb_secret_` tokens don't work.** Use only the anon JWT. This is a known Supabase limitation in this setup.

3. **React `{0 && <el>}`** renders the number `0` on screen. Always use `{!!value && <el>}`.

4. **Hebrew apostrophe:** The character `׳` (geresh, U+05F3) is different from `'` (ASCII apostrophe). The DB stores ASCII. `normalizeApostrophes()` in the chat route handles this — don't bypass it.

5. **Vercel build:** TypeScript is strict. The build will fail on type errors. Run `npx tsc --noEmit` locally before pushing.

6. **Vercel timeout:** upload and learn-url routes have `maxDuration=60` because Gemini analysis takes 15-20 seconds. Don't remove this.

7. **UI name vs code name:** Everything in the UI says "Goldfish". All internal code, events, and file names say `fishgold`. Don't rename either — they serve different purposes.

---

## First Tasks (Suggested Order)

These are the highest-value things to build:

1. **Multi-tenant** — Replace `DEV_ORG_ID` with `session.user.org_id` everywhere (~2-3 days)
2. **Stripe** — Add billing so the product can charge customers (~2-3 days)
3. **ToS + Privacy** — Static pages + checkbox on signup (~half day)
4. **Email (Resend)** — Add `RESEND_API_KEY` to env + wire welcome + weekly digest emails (~1 day)
5. **Analytics (PostHog)** — Add tracking snippet + identify user on login (~half day)

See [ROADMAP.md](ROADMAP.md) for full list with priorities.

---

## Who to Ask

**Liron Golan** — Product owner, CEO of Hopa, built this with Claude Code.
- Knows everything about the product
- Can give you all API keys and credentials
- Has deep knowledge of the nonprofit sector context

Contact: golanliron1@gmail.com
