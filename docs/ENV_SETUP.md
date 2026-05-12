# Goldfish — Environment Variables & Setup

> Every secret the app needs to run. Where to get each one.

---

## Required for Local Development

Create a file called `.env.local` in the root of the `goldfish` repo:

```env
# ---- Supabase (Main App DB) ----
NEXT_PUBLIC_SUPABASE_URL=https://touqczopfjxcpmbxzdjr.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<get from Liron>
SUPABASE_SERVICE_ROLE_KEY=<get from Liron>

# ---- AI: Anthropic (Claude) ----
ANTHROPIC_API_KEY=<get from Liron>
# Model used: claude-sonnet-4-6 (chat), claude-haiku-4-5-20251001 (scoring)

# ---- AI: Google (Gemini) ----
GEMINI_API_KEY=<get from Liron>
# Model used: gemini-2.5-pro-preview-06-05 (doc analysis), gemini-2.5-flash (OCR/XLSX)

# ---- Google Drive (optional — for Drive folder reading) ----
GOOGLE_API_KEY=<get from Liron>
# Google Cloud project: goldfush, restricted to Drive API only

# ---- Grants DB (separate Supabase project) ----
GRANTS_DB_URL=https://vhmwijzcrqjjquxomccq.supabase.co
GRANTS_DB_ANON_KEY=<get from Liron>
```

---

## Notes on Each Variable

### Supabase
- **Two separate projects.** Main app = `touqczopfjxcpmbxzdjr`. Grants DB = `vhmwijzcrqjjquxomccq`.
- **CRITICAL:** `SUPABASE_SERVICE_ROLE_KEY` is set in Vercel but `supabase-js` cannot use it directly. The `createAdminClient()` function in `src/lib/supabase/admin.ts` falls back to `NEXT_PUBLIC_SUPABASE_ANON_KEY` by default. RLS policies handle security.
- **Never** use `sb_secret_` prefixed keys — they don't work with supabase-js.

### Anthropic
- Get from: https://console.anthropic.com → API Keys
- Used for: main chat streaming, proposal generation, org scoring
- Cost estimate: ~$0.03 per chat session (Sonnet 4.6)

### Google / Gemini
- `GEMINI_API_KEY`: Get from https://aistudio.google.com → API Keys
- `GOOGLE_API_KEY`: Get from Google Cloud Console → project "goldfush" → APIs & Services → Credentials
- Gemini is used for: document analysis, OCR, XLSX parsing, URL classification
- Cost estimate: very low (Gemini has generous free tier)

### Grants DB
- Separate Supabase project that stores the grant opportunities (scraped daily)
- The daily scanner script (`scanner/daily_grants_scan.py`) writes to this DB
- The main app reads from it via `src/lib/supabase/grants-db.ts`

---

## Vercel Environment Variables

All of the above must also be set in Vercel:
1. Go to https://vercel.com → goldfish project → Settings → Environment Variables
2. Add each variable for: Production, Preview, Development

**Already set in Vercel (as of 2026-05-12):**
- ANTHROPIC_API_KEY
- GEMINI_API_KEY
- GOOGLE_API_KEY
- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_ANON_KEY
- SUPABASE_SERVICE_ROLE_KEY
- GRANTS_DB_URL
- GRANTS_DB_ANON_KEY

---

## Supabase Edge Functions Secrets

These are separate from Vercel — stored in Supabase Vault:

| Secret | Used By |
|--------|---------|
| ANTHROPIC_API_KEY | goldfish-whatsapp edge function |
| WHATSAPP_TOKEN | WhatsApp webhook |
| CHATWOOT_API_KEY | chatwoot-to-whatsapp bridge |

To set: Supabase Dashboard → Edge Functions → Secrets

---

## Missing Secrets (to add when ready)

| Secret | Where | Why |
|--------|-------|-----|
| RESEND_API_KEY | Vercel + Supabase | Email notifications (welcome, alerts, digest) |
| STRIPE_SECRET_KEY | Vercel | Billing |
| STRIPE_WEBHOOK_SECRET | Vercel | Stripe webhook verification |

---

## Local Development Flow

```bash
# 1. Clone repo
git clone https://github.com/golanliron/goldfish.git
cd goldfish

# 2. Install dependencies
npm install

# 3. Create .env.local (copy from above, fill in values from Liron)
cp .env.local.example .env.local  # or create manually

# 4. Run dev server
npm run dev
# Runs on http://localhost:3002

# 5. Login with: golanliron1@gmail.com (admin account, skips all redirects)
```

---

## Admin Account

The admin email (`golanliron1@gmail.com`) bypasses all onboarding checks and can access the dashboard directly. This is hardcoded in `src/middleware.ts`:

```typescript
const ADMIN_EMAILS = ['golanliron1@gmail.com']
```

For testing, use this account. For production, add additional admin emails or remove this bypass.
