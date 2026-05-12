---
name: grants_resource_mobilization
description: מערכת גיוס משאבים אוניברסלית — מאגר קולות קוראים, סורקים, וטקסונומיה
type: project
---

## מאגר נתונים מרכזי — grants_database.json (v2.0)

**מיקום:** `c:\Users\golan\OneDrive\Desktop\hopa\data\grants_database.json`
**סקריפט בנייה:** `c:\Users\golan\OneDrive\Desktop\hopa\data\build_grants_db.py`

### מקורות נתונים (INPUT)
- `data/atlas_full_export.json` — 409 פריטים מאטלס (סרוק 2026-05-04)
- `data/grant_sources.json` — 75 מקורות סריקה (5 שכבות: ממשלתי, פרטי ישראלי, בינלאומי, אגרגטורים, עדיפויות)

### מבנה ה-DB (OUTPUT)
כל פריט כולל:
- `id`, `title`, `type` (kok/fund/business/endowment)
- `description`, `deadline` (YYYY-MM-DD), `amount`
- `categories` — מיפוי ל-12 קטגוריות תוכן
- `target_populations` — מיפוי ל-25 אוכלוסיות יעד
- `tags`, `source`, `status` (open/ongoing)

### טקסונומיה — 3 ממדי סיווג

**12 קטגוריות תוכן:**
education, welfare, community, health, employment, culture, science, environment, periphery, equality, international, infrastructure

**25 אוכלוסיות יעד:**
women, ethiopian, haredi, arab, bedouin, druze, new_immigrants, minorities, lgbtq, holocaust_survivors, disabilities, youth_at_risk, youth, elderly, single_parents, ex_prisoners, lone_soldiers, discharged_soldiers, periphery_residents, south_residents, north_residents, refugees, addiction, young_parents, students

**4 סוגים:** kok (קול קורא), fund (קרן), business (עסק), endowment (הקדש)

### סטטיסטיקות נוכחיות
- 409 פריטים, 75 מקורות סריקה
- 47 עם דדליין, 87 עם אוכלוסייה מזוהה
- חינוך (123), רווחה (103), בריאות (73), תרבות (72), סביבה (71)

---

## סורקים

### Console Scraper (עובד!)
**קובץ:** `scanner/atlas_console_scraper.js`
**שימוש:** F12 > Console > הדבק > Enter
**תוצאה:** הורדת JSON עם כל הפריטים

### Playwright Scraper (לא בשימוש)
**קובץ:** `scanner/atlas_scraper.py`
**סיבה:** קונפליקט פרופיל Chrome

### מקורות לסריקה עתידית (75 URLs)
מוגדרים ב-`data/grant_sources.json` — כולל תדירות סריקה, תחומים, עדיפות

---

## grants.html — ממשק ניהול

**מיקום:** `c:\Users\golan\OneDrive\Desktop\hopa\grants.html`
- לוח בקרה, pipeline, דדליינים, סינון
- כניסת מנהל PIN `0502671012`
- כתיבה עם Claude, ייבוא Excel
- Supabase: `vhmwijzcrqjjquxomccq`

### סטטוסים
open → research → writing → submitted → pending → approved / rejected / closed

---

## סקילים רלוונטיים
- `/resource-mobilization` — ניתוח קולות קוראים + כתיבת בקשות מענק
- `/hopa-admin-site` — עריכה דרך hopa-lev-yotzer

---

## הערות חשובות
- "הסברה" (265 פריטים) הוסרה מהמיפוי — תגית גורפת לא אינפורמטיבית
- אוכלוסיות יעד מזוהות מטקסט (keywords) — הדאטה מאטלס דל באוכלוסיות, יעשיר ממקורות נוספים
- Atlas = מנוי בתשלום, לסרוק שוב לפני שפג
- הטקסונומיה מוכנה ואוניברסלית — לא רק להופה, עבור כל עמותה
