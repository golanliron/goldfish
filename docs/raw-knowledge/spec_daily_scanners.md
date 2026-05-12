# Goldfish — Daily Scanners: ארכיטקטורת סורקים
> תאריך: 2026-05-06

---

## סקירה כללית

Goldfish מריץ 2 סורקים אוטומטיים כל יום:

| סורק | שעה | תדירות | קובץ | מה סורק |
|-------|------|---------|-------|----------|
| **Grants Scanner** | 07:00 | יומי | `scanner/daily_grants_scan.py` | קולות קוראים מ-79+ מקורות |
| **Facebook Scanner** | 07:15 | יומי | `scanner/facebook_sector_scanner.py` | פיד, קבוצות, דפים |

שניהם רשומים כ-Windows Task Scheduler tasks עם `StartWhenAvailable`.

---

## סורק 1: קולות קוראים (Grants Scanner)

### Task Scheduler
- **שם:** `HopaDailyGrantsScan`
- **שעה:** 07:00 יומי
- **סקריפט:** `scanner/daily_grants_scan.py`
- **תזמון:** `scanner/schedule_scan.ps1`

### מקורות (79+)

| מקור | שיטה | סטטוס |
|------|-------|--------|
| Atlas (app.atlas-grants.com) | Console scraper | פעיל, 409 פריטים |
| שתיל (shatil.org.il) | WebFetch + HTML parse | פעיל, 19+ פריטים |
| ביטוח לאומי (btl.gov.il) | WebFetch | פעיל, 1+ פריט |
| tmichot.mof.gov.il | **צריך Playwright** | SPA, לא עובד עם fetch |
| pob.education.gov.il | **צריך Playwright** | SPA |
| gov.il | **403** | חסום |

### מקורות שחסרים (עדיפות 1!)
- רשות התחרות (קולות למחקר)
- ISF — הקרן הלאומית למדע
- BSF — US-Israel Binational Science Foundation
- משרד החקלאות
- המשרד להגנת הסביבה
- ועד אולימפי + מנהלת הספורט
- קרנות רוחניות: קרן האני, Mandel, Jim Joseph, Avi Chai, Schusterman
- משרד המשפטים

### כלל ברזל: סריקה רחבה!
**"אם עמותה ישראלית יכולה להגיש לזה — זה צריך להיות במאגר"**
- לא מסננים לפי תחום בסריקה
- הסינון = DNA matching לכל ארגון, לא בשלב הסריקה
- כל התחומים: מחקר, משפט, דת, סביבה, חקלאות, טכנולוגיה, ספורט, תרבות

### Output Format

כל פריט שנסרק נשמר ב-Supabase `opportunities`:

```json
{
  "title": "קול קורא לתמיכה בפרויקטי נוער",
  "funder": "קרן רש\"י",
  "deadline": "2026-06-15",
  "amount_max": 500000,
  "url": "https://...",
  "description": "...",
  "categories": ["education", "youth"],
  "target_populations": ["youth_at_risk"],
  "active": true,
  "source": "shatil",
  "scanned_at": "2026-05-06T07:00:00Z"
}
```

### Error Handling

- **Crash logging:** `scanner/outputs/scanner.log`
- **StartWhenAvailable:** אם המחשב כבוי ב-07:00, ירוץ כשנדלק
- **Funder guard:** regex דוחה ערכים עם `{` או `@` (מונע JSON-LD)
- **Clean HTML:** מסיר `<script>` ו-`<style>` tags לפני parsing
- **Dedup:** בודק title+funder לפני INSERT (לא מכפיל)

### תחזוקה
- **יומי:** בודק דדליינים שעברו → `active=false`
- **שבועי:** בודק מקורות שנכשלו
- **חודשי:** מוסיף מקורות חדשים

---

## סורק 2: פייסבוק (Facebook Scanner)

### Task Scheduler
- **שם:** `HopaFacebookScanner`
- **שעה:** 07:15 יומי
- **סקריפט:** `scanner/facebook_sector_scanner.py`
- **תזמון:** `scanner/schedule_facebook_scan.ps1`

### מקורות

| מקור | שיטה | מה סורק |
|------|-------|----------|
| **פיד אישי** | Graph API `/me/feed` | 7 ימים, ~45 מילות מפתח |
| **קבוצות מנוטרות** | Graph API `/group/feed` | "ערך לדרך" (1149531235180634) — **ללא סינון!** כל פוסט מעל 30 תווים |
| **9 דפים** | Graph API `/page/feed` | מגזר 3, שתיל, GuideStar, SFI, כל זכות, ג'וינט, מידות, מעבורת |
| **דף הופה** | Graph API `/hopa_page/feed` | תגובות = לידים פוטנציאליים |

### טוקנים נדרשים
- `FB_USER_TOKEN` — Long-Lived User Token (פג כל 60 יום!)
- `FB_PAGE_TOKEN` — Page Access Token (קבוע)
- הרשאות: `user_posts`, `groups_access_member_info`, `pages_read_engagement`

### סיווג תוכן

כל פוסט עובר AI classification:
```json
{
  "category": "grant_announcement",  // או: donation, partnership, news, regulation, startup, event
  "entities": ["קרן רש\"י", "משרד החינוך"],
  "tags": ["נוער", "חינוך", "מענק"],
  "relevance_score": 85,
  "reliability": "high",  // high/medium/low
  "summary": "קרן רש\"י פתחה קול קורא חדש..."
}
```

### כלל אמינות
- **high** (ממשלה, קרן, עמותה מוכרת) → תמיד נשמר
- **medium** (מקור מוכר) → נשמר אם relevance >= 40
- **low** (פוסט אישי) → נשמר רק אם relevance >= 60
- **spam/MLM** → skip

### שמירה ב-Supabase

**sector_intelligence** — פוסטים בודדים:
```sql
INSERT INTO sector_intelligence (source, title, summary, category, entities, tags, relevance_score, reliability)
VALUES ('facebook_group:ערך לדרך', '...', '...', 'grant_announcement', ...);
```

**sector_knowledge** — סיכום יומי:
```sql
INSERT INTO sector_knowledge (topic, content, source)
VALUES ('facebook_digest_2026_05_06', '...summary...', 'facebook_scanner');
```

### Error Handling
- **Token expired:** לוג שגיאה, לא crash
- **Rate limit:** המתנה + retry (Facebook API: 200 calls/hour)
- **Fallback:** שמירה מקומית ב-`scanner/facebook_scan_results.json` אם Supabase לא זמין

---

## איך הנתונים זורמים ל-Goldfish Chat

```
Scanners → Supabase tables
                ↓
    api/chat/route.ts loads:
    - loadGrantsIndex()         → opportunities table
    - loadSectorIntelligence()  → sector_intelligence table
    - scanOpportunities()       → DNA matching
                ↓
    System prompt includes latest data
                ↓
    Goldfish gives fresh, accurate answers
```

---

## הוספת מקור חדש — Checklist

1. [ ] כתוב פונקציית fetch/parse למקור
2. [ ] הגדר output format (title, funder, deadline, url, categories)
3. [ ] הוסף לרשימת מקורות ב-`daily_grants_scan.py`
4. [ ] בדוק dedup (לא להכפיל פריטים קיימים)
5. [ ] הרץ ידנית ובדוק output
6. [ ] הוסף ל-`grant_sources` ב-Supabase
7. [ ] עדכן `agent_grants_scanner.md`
