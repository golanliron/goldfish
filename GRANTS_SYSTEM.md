# מערכת קולות קוראים — Goldfish

## סקירה כללית

מערכת קולות קוראים אוטומטית שסורקת, מתייגת, ומתאימה הזדמנויות מימון לארגונים.
הכל רץ בתוך הקוד של Goldfish (Next.js על Vercel) — אין תלות בסקריפטים חיצוניים.

---

## ארכיטקטורה

```
[Vercel Cron 06:00]
       |
       v
/api/cron/scan-sources   ← סורק 11 מקורות, מחלץ grants עם AI (Haiku)
       |
       v
  Supabase: opportunities  ← 600+ קולות קוראים, 227 פעילים
       |
       v
/api/opportunities        ← API שמחזיר grants + DNA matching לפי ארגון
       |
       v
/api/chat (route.ts)      ← הצ'אט מציג grants עם funder, URL, contact_info
       |
       v
/api/cron/notify-matches  ← Vercel Cron 07:00, שולח WhatsApp על התאמות חדשות
```

---

## קבצים קריטיים

### סקנר יומי
**`src/app/api/cron/scan-sources/route.ts`**
- רץ כל יום ב-06:00 UTC (Vercel Cron, מוגדר ב-`vercel.json`)
- סורק 11 מקורות (שתיל, BTL, ג'וינט, רשות חדשנות, gov.il, מפעל הפיס, קק"ל, משרד חינוך, תקומה, עזריאלי)
- משתמש ב-Claude Haiku לחילוץ grants מ-HTML
- מחלץ contact_info (טלפון + מייל) מכל דף קול קורא
- auto-tagging עם regex patterns (אותם patterns כמו org-dna.ts)
- dedup לפי URL + title prefix
- מנקה grants שפג תוקפם (deadline עבר)

### DNA matching (התאמת grants לארגון)
**`src/lib/ai/org-dna.ts`**
- `extractOrgDNA()` — מחלץ DNA מפרופיל ארגון (populations, domains, regions)
- `scoreDNAMatch()` — מחשב ציון התאמה (0-100) בין DNA של ארגון ל-grant
- `HEBREW_TAG_TO_DOMAIN` / `HEBREW_TAG_TO_POPULATION` — מיפוי 46 תגיות עבריות
- `resolveInterestTags()` — ממיר תגיות עבריות למפתחות domain/population

### API קולות קוראים
**`src/app/api/opportunities/route.ts`**
- GET — מחזיר כל ה-grants הפעילים + taxonomy + DNA matches
- אם יש `org_id` — מחשב ציון התאמה לכל grant
- קודם בודק matches שמורים, אם אין → חישוב DNA חי

### הצ'אט
**`src/app/api/chat/route.ts`**
- שולף grants עם `contact_info` בכל הצגה
- 4 נקודות הצגת grants: חיפוש URL, matches שמורים, סריקה חיה, רשימה מלאה
- מציג: כותרת, ציון, דדליין, funder, סכום, URL, contact_info

### התראות
**`src/app/api/cron/notify-matches/route.ts`**
- רץ כל יום ב-07:00 (אחרי הסקנר)
- שולח WhatsApp על התאמות חדשות (ציון >= 70)

---

## טבלת opportunities (Supabase)

| עמודה | סוג | תיאור |
|-------|------|--------|
| id | uuid | מזהה ייחודי |
| title | text | כותרת הקול קורא |
| description | text | תיאור |
| funder | text | שם הגוף המממן |
| url | text | לינק ישיר להגשה |
| deadline | date | תאריך אחרון |
| amount_max | integer | סכום מקסימלי |
| categories | text[] | תחומים (education, welfare, health...) |
| target_populations | text[] | אוכלוסיות (youth, women, disabilities...) |
| contact_info | text | טלפון + מייל (פורמט: "tel: 03-123... \| email: x@y.z") |
| eligibility | text | תנאי זכאות |
| how_to_apply | text | הוראות הגשה |
| source | text | מקור הסריקה |
| type | text | סוג (grant) |
| active | boolean | פעיל/לא פעיל |
| tags | text[] | תגיות נוספות |
| scraped_at | timestamp | זמן סריקה |

### RLS Policies
- `anon_read_all` — קריאה לכולם
- `Allow insert opportunities` — הוספה
- `anon_update_opportunities` — עדכון

---

### סורק פדרציות
**`src/app/api/cron/scan-federations/route.ts`**
- רץ כל יום ב-07:00 + 19:00 UTC
- סורק 5 מקורות: JFNA, European Jewish Association, ECAJ, WJC, JFC-UIA
- משתמש ב-Claude Haiku לחילוץ פדרציות מ-HTML
- מכניס ל-companies כ-type: 'fund' עם interests מתאימים
- dedup לפי שם (ilike)

### העשרת חברות
**`src/app/api/cron/enrich-companies/route.ts`**
- רץ כל יום ב-05:00 UTC
- מעשיר 25 חברות ביום (15 עם אתר + 10 בלי)
- לחברות בלי אתר: מנסה לנחש דומיין מהשם
- שולף מיילים וטלפונים מהאתר (regex)
- Claude Haiku מנתח CSR ונותן ציון 1-10 + תיאור + תחומי עניין
- ממלא רק שדות חסרים — לא דורס מידע קיים

---

## Cron Schedule (vercel.json)

```json
{
  "crons": [
    { "path": "/api/cron/scan-sources", "schedule": "0 6 * * *" },
    { "path": "/api/cron/scan-sources", "schedule": "0 18 * * *" },
    { "path": "/api/cron/scan-federations", "schedule": "0 7 * * *" },
    { "path": "/api/cron/scan-federations", "schedule": "0 19 * * *" },
    { "path": "/api/cron/enrich-companies", "schedule": "0 5 * * *" },
    { "path": "/api/cron/notify-matches", "schedule": "0 8 * * *" }
  ]
}
```

---

## Environment Variables (Vercel)

| משתנה | שימוש |
|-------|--------|
| ANTHROPIC_API_KEY | Claude API לחילוץ grants (Haiku) ולצ'אט (Sonnet) |
| CRON_SECRET | אימות cron requests |
| SUPABASE_URL | https://touqczopfjxcpmbxzdjr.supabase.co |
| SUPABASE_SERVICE_ROLE_KEY | גישה admin ל-Supabase |
| SUPABASE_ANON_KEY | גישה אנונימית |

---

## זרימת נתונים

1. **06:00** — Vercel Cron מפעיל `/api/cron/scan-sources`
2. הסקנר סורק 11 אתרים, שולח HTML ל-Claude Haiku
3. Haiku מחזיר JSON עם grants, הסקנר מוסיף auto-tags ו-contact_info
4. grants חדשים נכנסים ל-Supabase, ישנים שפג תוקפם מושבתים
5. **07:00** — Vercel Cron מפעיל `/api/cron/notify-matches`
6. בודק DNA matching בין grants חדשים לכל הארגונים, שולח WhatsApp
7. **בצ'אט** — כשמשתמש שואל על הזדמנויות, Goldfish שולף grants, מסנן לפי DNA, מציג עם כל הפרטים

---

## הוספת מקור חדש

ב-`scan-sources/route.ts`, הוסף אובייקט למערך `SOURCES`:
```typescript
{
  name: 'שם המקור',
  url: 'https://example.com/grants',
  funder: 'שם הגוף המממן',
}
```
ה-AI (Haiku) ידע לחלץ grants מכל HTML — לא צריך parser ייעודי.

---

## סטטיסטיקות נוכחיות (מאי 2026)

- 602 קולות קוראים (227 פעילים)
- 11 מקורות סריקה
- 17 מקורות נתונים ייחודיים ב-DB
- 30 grants עם contact_info (טלפון/מייל)
- 1,451 חברות וארגונים (604 קרנות)
