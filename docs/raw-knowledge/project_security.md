---
name: אבטחת אתר הופה
description: מצב אבטחה מלא — RLS policies, Supabase Auth, Edge Functions (claude-proxy, monday-proxy), Vault secrets, anti-scraping
type: project
---

# אבטחת אתר הופה — עודכן 2026-03-20

## שכבה 1: Row Level Security (Supabase - vhmwijzcrqjjquxomccq)

### מדיניות anon (גישה אנונימית):
| טבלה | הרשאה |
|-------|--------|
| programs (507), scholarships (92), articles (31) | **SELECT בלבד** |
| grants, meetings, banners, partners, resource_contacts | **SELECT בלבד** |
| hopa_budget, hopa_documents, hopa_research, hopa_knowledge, hopa_projects, hopa_impact | **SELECT בלבד** |
| social_post_schedule, whatsapp_pending, google_ads_stats | **SELECT בלבד** (+ INSERT ל-ads) |
| inquiries | **INSERT בלבד** (טופס פנייה) |
| visitor_sessions | INSERT + UPDATE (tracking) |
| **כל הטבלאות** | **אין DELETE לאנונימי** |

### מדיניות authenticated (מייל+סיסמה):
- גישה מלאה (SELECT, INSERT, UPDATE, DELETE) לכל הטבלאות

### טבלאות עם RLS מופעל (כולן):
- programs, scholarships, articles, partners, banners, inquiries, submissions
- grants, resource_contacts, meetings, grant_analyses, hopa_impact, hopa_projects
- social_post_schedule, google_ads_stats, scanner_calls, visitor_sessions, user_profiles
- whatsapp_pending, hopa_documents, hopa_research, hopa_knowledge, hopa_budget

## שכבה 2: אימות כניסה (Supabase Auth)

### משתמשים:
- golanliron1@gmail.com — סיסמה: 0502671012
- talmeir01@gmail.com — סיסמה: 0502671012

### קבצים מוגנים:
- **admin.html** — מסך כניסה מייל+סיסמה (PIN הוסר, הרשמה עצמית הוסרה)
- **grants.html** — מסך כניסה מייל+סיסמה (PIN הוסר)

### פונקציות auth בקוד:
- admin.html: `boot()` → `sb.auth.getSession()` → `startApp(user)` / `startLogin()`
- grants.html: `checkSession()` → `sb.auth.getSession()` → `startApp()` / login screen
- logout: `doSignOut()` → `sb.auth.signOut()`

## שכבה 3: Edge Functions (API proxies)

### claude-proxy
- **URL:** `https://vhmwijzcrqjjquxomccq.supabase.co/functions/v1/claude-proxy`
- **JWT:** נדרש (verify_jwt: true)
- **מודלים מאושרים:** claude-haiku-4-5, claude-sonnet-4-6, claude-opus-4-6
- **max_tokens:** עד 4096
- **מפתח:** נקרא מ-Vault (`anthropic_api_key`) או env var `ANTHROPIC_API_KEY`
- **משמש ב:** admin.html (4 קריאות), grants.html (4 קריאות)
- **פונקציית עזר בלקוח:** `callClaude({ model, max_tokens, messages, system, tools })`

### monday-proxy
- **URL:** `https://vhmwijzcrqjjquxomccq.supabase.co/functions/v1/monday-proxy`
- **JWT:** נדרש (verify_jwt: true, anon key מספיק)
- **הגבלה:** queries בלבד — mutations חסומות
- **מפתח:** נקרא מ-Vault (`monday_api_token`) או env var `MONDAY_TOKEN`
- **משמש ב:** bogrim-maanim.html, motzkin.html, bogrim.html

### Supabase Vault secrets:
- `anthropic_api_key` — מפתח Claude API
- `monday_api_token` — טוקן Monday.com

## שכבה 4: Anti-scraping

### Meta tags (noindex):
- admin.html, grants.html, motzkin.html, bogrim-maanim.html, ads-dashboard.html

### robots.txt:
- חוסם דפי ניהול, CSV, PDF, XLSX
- חוסם בוטים: GPTBot, CCBot, Google-Extended, ClaudeBot, Bytespider

### Headers:
- admin.html, grants.html: `<meta name="referrer" content="no-referrer">`

## מפתחות שהוסרו מהקוד:
- ~~Claude API key~~ → Edge Function + Vault
- ~~Monday.com JWT token~~ → Edge Function + Vault
- ~~WhatsApp webhook Anthropic key~~ → env var `ANTHROPIC_API_KEY`
- ~~Admin PIN (0502671012)~~ → Supabase Auth

## מה עדיין חשוף (מוּכר ומקובל):
- Supabase anon key — גלוי ב-HTML אבל מאפשר SELECT בלבד
- GitHub tokens — בסקריפטים מקומיים (.ps1/.py), לא מוגשים מהאתר
