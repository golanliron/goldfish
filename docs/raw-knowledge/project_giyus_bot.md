---
name: project_giyus_bot
description: גיוס-בוט - מוצר SaaS לגיוס משאבים לעמותות. Supabase ייעודי, ארכיטקטורה, סטטוס פיתוח
type: project
---

# גיוס-בוט - מוצר SaaS עצמאי

## מיקום
`c:/Users/golan/OneDrive/Desktop/giyus-bot` (לא בתוך תיקיית הופה)

## טכנולוגיות
- **Frontend:** Next.js 15 App Router, React, Heebo font, RTL
- **AI:** Claude Sonnet 4 (צ'אט), Claude Haiku 4.5 (חילוץ טקסט מ-PDF/Excel/PPT)
- **DB:** Supabase ייעודי `giyus-bot` (pwouumcvtcwtsxuskctf), eu-central-1
- **Storage:** IndexedDB (client cache) + Supabase (server of truth)

## Supabase project
- **ID:** pwouumcvtcwtsxuskctf
- **URL:** https://pwouumcvtcwtsxuskctf.supabase.co
- **5 טבלאות:** orgs, conversations, messages, documents, usage_log
- **RLS:** enabled, currently permissive (using true) - needs tightening for production

## API Routes (9 total)
- `GET /api/org?slug=xxx` - זיהוי/יצירת עמותה
- `GET/POST /api/conversations` - רשימה/יצירת שיחות
- `GET/PATCH/DELETE /api/conversations/[id]` - שיחה בודדת
- `POST /api/conversations/[id]/messages` - הוספת הודעות
- `POST /api/chat` - AI chat + Supabase save + usage logging
- `POST /api/upload` - קבצים (PDF/Word/Excel/PPT/TXT/CSV/HTML, עד 30MB)
- `POST /api/drive` - ייבוא מ-Google Drive
- `POST /api/scrape` - סריקת קולות קוראים מ-URL
- `POST /api/feedback` - דירוג הודעות

## מבנה קבצים
```
app/api/{chat,upload,drive,scrape,org,conversations,feedback}/
components/Chat.tsx     - UI ראשי (~600 שורות)
lib/prompt.ts           - system prompt (~280 שורות, אופי + ידע)
lib/supabase.ts         - Supabase client
next.config.js          - bodySizeLimit: 50mb
.env.local              - ANTHROPIC_API_KEY + Supabase keys
```

## הרצה
```bash
cd Desktop/giyus-bot && npm run dev -- -p 3001
```
http://localhost:3001 (או ?org=slug לעמותה ספציפית)

## מה עובד (2026-04-26)
- Chat עם Claude Sonnet 4 (max_tokens: 2048)
- העלאת קבצים: PDF, Word, Excel, PowerPoint, TXT, CSV, HTML - אין מגבלת 10MB
- Google Drive import (Docs/Sheets/Slides)
- סריקת URL לקולות קוראים
- כל הנתונים ב-Supabase (שיחות, הודעות, מסמכים, usage)
- Usage tracking (token counts)
- זיהוי עמותה ב-slug, auto-create on first visit
- IndexedDB כ-fallback מקומי

## מה צריך לפרודקשן
1. Auth (Supabase Auth, magic link)
2. RLS אמיתי (לא using true)
3. Landing page + signup
4. Rate limiting + plans (free/pro)
5. פיצול Chat.tsx ל-hooks
6. Deploy (Vercel)

## תוכנית עסקית
- **MD:** `business-plan.md` (בתיקיית giyus-bot)
- **HTML:** שולחן עבודה `תוכנית-עסקית-גיוס.html` + `giyus-bot/index.html`
- **GitHub:** `golanliron/giyus-business-plan`
- **לינק חי:** https://golanliron.github.io/giyus-business-plan/
- **סטטוס:** v2 מפורסמת, **ממתין לתיקונים מלירון**
- צוות: נאווה גייזנברג + לירון גולן + מיטל פלג
- מתחרה מרכזי: Atlas Grants
- 3 מסלולים: 99/249/499 שקל, Gross Margin 94%, Break-even ~130 לקוחות
