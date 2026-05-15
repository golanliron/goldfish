@AGENTS.md

# Goldfish — System Instructions for Claude Code

> These rules are MANDATORY. They apply to every session, every change, every file.
> When in doubt: read first, ask second, write last.

---

## 1. Project Identity

**Product:** Goldfish — AI-powered grant-matching SaaS for Israeli nonprofits.
**Stack:** Next.js App Router · TypeScript (strict) · Supabase (PostgreSQL + pgvector) · Vercel
**AI engines:** Claude (Haiku/Sonnet) + Gemini 2.5 Pro (documents) + Gemini Flash (OCR/XLSX)
**Internal name in code/events/vars:** `fishgold`. UI brand name: `Goldfish`.

---

## 2. Architecture Rules — No Exceptions

### Database
- All DB access goes through the **Supabase client** (`createAdminClient()` server-side, `createClient()` client-side).
- **No Prisma. No raw SQL strings outside of Supabase `.rpc()` calls.**
- Never infer a table schema from context. If unsure — read the migration SQL or use `list_tables` first.
- Admin-only operations (insert/update from server) → `src/lib/supabase/admin.ts`.
- Client-side reads → `src/lib/supabase/client.ts`.

### API Routes
- All routes live in `src/app/api/`. App Router only — no `pages/api/`.
- Auth wrapper: `withAuth()` from `src/lib/api-auth.ts`. Every protected route must use it.
- Vercel timeout budget: most routes `maxDuration = 60`. Heavy AI routes: up to `maxDuration = 120`. Cron routes: up to `maxDuration = 300`.

### Types & Validation
- Source of truth for types: **`src/types/index.ts`**.
- Source of truth for Zod schemas: **`src/lib/validation/schemas.ts`**.
- **Never guess an object structure.** If a type is missing, add it to `src/types/index.ts` before writing the implementation.
- All external inputs (API request bodies, AI JSON responses) must be validated through a Zod schema before use.

---

## 3. AI & LLM Rules — Zero Hallucination Policy

### withRetry is mandatory
Every call to an external LLM API **must** be wrapped in `withRetry()` from `src/lib/ai/retry.ts`:

```ts
// CORRECT
const res = await withRetry(
  () => anthropic.messages.create({ ... }),
  4, 2000, 'descriptive-label',
);

// WRONG — naked LLM call, will crash on 429/503
const res = await anthropic.messages.create({ ... });
```

`withRetry` handles: `429` (rate limit), `503`/`504` (timeout), Anthropic `overloaded_error`, Gemini `RESOURCE_EXHAUSTED`. Backoff: 2s → 4s → 8s.

### URL hallucination is forbidden
- **Never generate, guess, or construct a URL** unless it was explicitly extracted from page content or a known constant.
- AI prompts that ask for URLs must instruct the model: `"אם אין URL ספציפי בטקסט — שים null"`.
- After any AI call that returns URLs, validate each with `isValidUrl()` (available in `src/lib/ai/agent-pipeline.ts`) before persisting to DB.

### Prompts
- All reusable model IDs live in `src/lib/ai/prompts/index.ts` as `MODELS.*`. Never hardcode a model string outside of that file.
- Hebrew prompts: no markdown (no `**bold**`, no `-` lists) — WhatsApp and the chat UI render plain text.

---

## 4. Core Business Logic — Protected Zones

These files contain domain logic built over months. **Do not refactor, restructure, or "clean up" without an explicit approved plan:**

| File | Why it's sensitive |
|------|--------------------|
| `src/lib/ai/org-dna.ts` | DNA taxonomy: 16 populations, 18 domains, 8 regions, negative matching. Changes break scoring for all orgs. |
| `src/lib/ai/scoring-service.ts` | Dual scoring engine (AI batch + deterministic DNA). Thresholds and weights are calibrated. |
| `src/lib/ai/fishgold.ts` | Main chat system prompt + `buildOrgContext()`. Memory injection order matters. |
| `src/lib/ai/submission-engine.ts` | Grant draft assembly pipeline. Block types and length tiers are contractual. |
| `src/lib/ai/agent-pipeline.ts` | URL validation gate — every opportunity entering DB passes through here. |
| `src/lib/queue/index.ts` | Job queue with optimistic locking. Do not change the `status` state machine. |

**When reading these files:** pay attention to inline comments that start with `// ← reason:` or `// NOTE:` — they explain *why* a specific logic exists, not just *what* it does.

---

## 5. Change Protocol for `src/lib/ai/`

Before modifying any file in `src/lib/ai/`:

1. **Read** the file fully.
2. **State** exactly which lines change and why.
3. **Wait for approval** before writing.
4. **Test against fixture data** in `src/test/fixtures/` after the change.

For new AI features: write a plan (inputs → processing → outputs → DB writes) as a comment block at the top of the new function before implementing it.

---

## 6. Concurrency & Rate Limits

- **Cron worker** (`src/app/api/cron/worker/route.ts`): max **3 concurrent jobs** via `Promise.allSettled`. Do not raise this without load testing.
- **`scan-sources`**: AI calls per source are sequential (by design — avoids burst). Do not parallelize the outer `for (source of SOURCES)` loop.
- **`backfill-grants`**: sequential with `withRetry`. Batch size controlled by `?batch=N` query param (max 50).
- **`rate-limiter.ts`** (`src/lib/integrations/providers/rate-limiter.ts`): token-bucket implementation. Wire it to any new external provider added in `src/lib/integrations/providers/`.

---

## 7. Multi-Tenant Safety

- **Every DB query that touches org data must filter by `org_id`.**
- The active org is resolved from the session via `withAuth()` → `auth.orgId`.
- Never use a hardcoded `org_id` in production code paths (dev fixtures only).
- `DEV_ORG_ID` in `.env.local` is for local development only — never deploy with it active.

---

## 8. Test Fixtures

Real-data tests live in `src/test/fixtures/`. Before marking an AI text-generation or parsing feature "done":

1. Drop a sample grant PDF or JSON in `src/test/fixtures/grants/`.
2. Drop a sample org profile JSON in `src/test/fixtures/orgs/`.
3. Run the feature against the fixture and confirm the output is sane.

See `src/test/fixtures/README.md` for conventions.

---

## 9. Git & Deploy

- **Do not push directly** without confirming with the user. The repo auto-deploys to Vercel on push to `main`.
- Prefer small, focused commits. One logical change per commit.
- Commit message format: `[area] short description` — e.g. `[scoring] wrap Haiku calls in withRetry`.

---

## 10. What Never to Do

| Never | Instead |
|-------|---------|
| Hardcode a model ID string | Use `MODELS.*` from `src/lib/ai/prompts/index.ts` |
| Call an LLM without `withRetry` | Wrap every LLM call in `withRetry()` |
| Infer a DB schema from context | Read the migration SQL or run `list_tables` |
| Guess or construct a URL | Extract from text, validate with `isValidUrl()`, or use `null` |
| Modify `org-dna.ts` without a plan | Write the plan first, get approval |
| Use Prisma or raw pg client | Use Supabase client only |
| Skip `withAuth()` on a protected route | Always wrap with `withAuth()` |
| Add a new LLM provider without rate limiting | Wire to `rate-limiter.ts` first |
