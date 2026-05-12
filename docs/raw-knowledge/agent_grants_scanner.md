---
name: agent_grants_scanner
description: סוכן איתור קולות קוראים + עדכון אנשי קשר — מעודכן 2026-05-05
type: agent
---

## תפקיד

אני שולט במאגר קולות קוראים אוניברסלי ויודע להתאים קול קורא לעמותה לפי:
- תחום פעילות (12 קטגוריות)
- אוכלוסיית יעד (25 אוכלוסיות)
- דדליין (מה פתוח עכשיו)
- גוף מממן

## מיקום הדאטה

### Supabase Goldfish (מקור אמת למערכת החיה)
- **Project:** `touqczopfjxcpmbxzdjr`
- **טבלה:** `opportunities` — 428 קולות קוראים (active, deadline, title, funder, categories[], target_populations[])
- **טבלה:** `companies` — 954 חברות/קרנות (contact_email, contact_phone, contact_name, contact_role, company_type)
- **טבלה:** `grant_sources` — 75 מקורות סריקה
- **טבלה:** `grant_taxonomy` — קטגוריות ואוכלוסיות
- **טבלה:** `matches` — 211 התאמות עם ציון AI

### Supabase Admin (מקור אמת ישן — grants טבלה)
- **Project:** `vhmwijzcrqjjquxomccq`
- **טבלה:** `grants` — קולות קוראים ישנים
- **טבלה:** `grant_taxonomy` — 12 קטגוריות + 25 אוכלוסיות

### קבצים מקומיים (מקור אמת לסריקה ובנייה)
- `data/grants_database.json` — 428 פריטים מלאים
- `data/atlas_full_export.json` — 409 פריטים גולמיים מאטלס
- `data/grant_sources.json` — 75 מקורות סריקה ב-4 שכבות
- `data/grants_urls_enrichment.json` — לינקים מאומתים
- `data/build_grants_db.py` — סקריפט בנייה + טקסונומיה + סיווג אוכלוסיות
- `data/shatil_btl_scrape_20260504.json` — סריקה משתיל + ביטוח לאומי

## שאילתות מפתח

```sql
-- קולות קוראים פתוחים (Goldfish Supabase)
SELECT title, funder, deadline, url, categories, target_populations
FROM opportunities WHERE active = true AND deadline >= CURRENT_DATE ORDER BY deadline;

-- חברות לפי סוג
SELECT company_type, COUNT(*) FROM companies GROUP BY company_type;

-- חברות עם CSR contacts
SELECT name, contact_name, contact_email, contact_role FROM companies
WHERE contact_role LIKE '%CSR%' OR contact_role LIKE '%אחריות%' OR contact_role LIKE '%תרומות%';

-- קרנות בינלאומיות
SELECT name, contact_email, contact_phone FROM companies WHERE company_type = 'fund' ORDER BY name;
```

## לוח סריקות — כלל ברזל!

### יומי: סריקת קולות קוראים
- סקיל `/resource-mobilization` או סריקה ידנית
- מקורות: Atlas, Shatil, BTL, gov.il
- לבדוק דדליינים שעברו -> active=false

### שבועי: עדכון אנשי קשר companies
- לבדוק שינויי טלפון/מייל/CSR contacts לחברות מרכזיות
- עדיפות: 92 קרנות -> 224 ציבוריות (תורמים) -> 524 עסקים
- לחפש CSR-specific contacts (לא שירות לקוחות!)
- מקורות: אתרי חברות, Maala ESG, GuideStar, LinkedIn

## סטטוס נוכחי (2026-05-06)

- 572 קולות קוראים ב-DB (גדל מ-428!)
- 954 חברות/קרנות (100% כיסוי אנשי קשר!)
  - 92 קרנות בינלאומיות
  - 224 חברות ציבוריות (עם נתוני תרומות)
  - 114 פרטיות
  - 524 עסקים
- 75 מקורות סריקה
- 211 התאמות AI

### סורק יומי — תיקונים 2026-05-06
- **באג שתיל תוקן:** clean_html לא הסיר `<script>` blocks → JSON-LD נכנס לשדה funder. תוקן עם strip script+style tags
- **הגנת funder:** regex עכשיו דוחה ערכים עם `{` או `@` (מונע JSON-LD)
- **לוגים:** נוסף logging לקובץ `scanner/outputs/scanner.log` — כולל crash logging
- **Task Scheduler:** `HopaDailyGrantsScan` רשום (07:00 יומי, StartWhenAvailable)
- **Facebook scanner:** `HopaFacebookScanner` — קובץ BAT ליצירת task (צריך להריץ כאדמין)

## מקורות שנסרקו בהצלחה
- Atlas (app.atlas-grants.com) — Console scraper, 409 פריטים
- Shatil (shatil.org.il) — WebFetch, 19 פריטים עם URLs
- BTL (btl.gov.il) — WebFetch, 1 פריט

## מקורות שדורשים JavaScript (צריך Playwright/Console)
- tmichot.mof.gov.il — SPA, לא עובד עם fetch
- pob.education.gov.il — SPA
- gov.il — מחזיר 403

## כלל ברזל: סריקה רחבה — כל התחומים! (2026-05-06)
- Goldfish הוא SaaS לכל עמותה, **לא רק נוער/חינוך/רווחה**
- המאגר חייב לכסות קולות קוראים מכל תחום: מחקר, משפט, דת, סביבה, חקלאות, טכנולוגיה, ספורט, תרבות, בינלאומי
- **עיקרון:** "אם עמותה ישראלית יכולה להגיש לזה — זה צריך להיות במאגר"
- הסינון = DNA matching לכל ארגון, לא סינון בסריקה

## מקורות חסרים — להוסיף!
- רשות התחרות (קולות למחקר)
- ISF — הקרן הלאומית למדע
- BSF — US-Israel Binational Science Foundation
- משרד החקלאות — מענקים חקלאיים
- המשרד להגנת הסביבה — מענקים סביבתיים
- ועד אולימפי + מנהלת הספורט
- קרנות רוחניות/יהודיות: קרן האני, Mandel, Jim Joseph, Avi Chai, Schusterman
- gov.il כולו — כל המשרדים, לא רק חינוך/רווחה
- משרד המשפטים — קרנות ייעודיות

## מה צריך לשפר
- **הרחבת מקורות סריקה** — ראה רשימה למעלה (עדיפות 1!)
- תאריך פתיחה (open_date) — חסר ברוב הפריטים
- URLs — רק 23/428 עם לינק (5%) — אבל הסורק היומי מוסיף URLs חדשים
- סריקה שוטפת: **פעילה!** Task Scheduler יומי 07:00, 161 פריטים לסריקה, 79+ מקורות
