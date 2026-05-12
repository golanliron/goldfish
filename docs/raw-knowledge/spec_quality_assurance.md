# Goldfish — אסטרטגיית איכות ושיפור מתמיד
> תאריך: 2026-05-06 | עדיפות: קריטית

---

## הבעיה

Goldfish נותן ייעוץ לעמותות על כסף אמיתי — קולות קוראים, קרנות, חברות, הגשות.
**אם הוא ממציא מידע, זה הרסני.** עמותה שתגיש לקרן שלא קיימת, או תכתוב מייל לאיש קשר שגוי — תאבד אמינות.

**כלל ברזל מספר 1: מה ש-Goldfish לא יודע — הוא אומר "לא יודע".**

---

## 5 שכבות הגנה מפני שטויות

### שכבה 1: System Prompt — "אל תמציא" (כבר קיים)

ב-`fishgold.ts` כבר כתוב:
```
- אם אין לך מידע — אמור "לא מכיר, בוא נבדוק"
- לעולם אל תמציא שם קרן, סכום, דדליין, או איש קשר
- אם לא בטוח — ציין "לפי מה שאני יודע, אבל כדאי לוודא"
```

**שיפור מומלץ:** להוסיף ל-system prompt:
```
כשאתה מציג נתון ספציפי (סכום, תאריך, מייל, שם), ציין תמיד את המקור:
- "לפי המאגר שלי" = מ-DB (opportunities/companies)
- "לפי מידע כללי" = ידע כללי שלך, לא מאומת
- "לפי מסמך שהעלית" = מ-RAG/uploaded docs
אם אתה לא בטוח מאיפה המידע — אמור את זה.
```

---

### שכבה 2: Source Tagging — תיוג מקור בתשובות

**הרעיון:** כל מידע שGoldfish מציג יקבל תג מקור.

**מימוש ב-system prompt:**
```
כשאתה מציג קול קורא, חברה, או קרן — השתמש בפורמט:
"קרן רש"י — דדליין 15/06 [מאגר Goldfish]"
"שטראוס תורמת 33.5M [מאגר חברות]"
"הקרן נוסדה ב-1984 [מידע כללי — כדאי לוודא]"
```

**בצד הקליינט:** אפשר לעשות render מיוחד ל-`[מאגר Goldfish]` — כמו badge קטן.

---

### שכבה 3: Fact-Check Guardrails — בדיקות אוטומטיות

**הרעיון:** אחרי שClaude מחזיר תשובה, לפני שהיא מוצגת למשתמש, בדיקה מהירה.

**מימוש ב-`api/chat/route.ts`** — post-processing על התשובה:

```typescript
function factCheck(response: string, knownData: {
  opportunities: string[],  // titles of known grants
  companies: string[],      // names of known companies
  foundations: string[],     // names of known foundations
}): { text: string; warnings: string[] } {
  const warnings: string[] = [];

  // 1. Check for invented email addresses
  const emails = response.match(/[\w.-]+@[\w.-]+\.\w+/g) || [];
  for (const email of emails) {
    const isKnown = /* check against companies.contact_email */;
    if (!isKnown) {
      warnings.push(`מייל ${email} לא נמצא במאגר — לוודא לפני שליחה`);
    }
  }

  // 2. Check for invented deadlines (dates in the future)
  const dates = response.match(/\d{1,2}[./]\d{1,2}[./]\d{2,4}/g) || [];
  // Cross-reference with known deadlines

  // 3. Check for specific amounts (₪/$/€ followed by numbers)
  const amounts = response.match(/[₪$€]\s?[\d,]+/g) || [];
  // Cross-reference with known amounts

  // 4. If company/foundation name mentioned — verify it exists in DB
  // This prevents hallucinated organizations

  return { text: response, warnings };
}
```

**אם יש warnings:** מוסיפים בסוף ההודעה:
```
⚠️ שימו לב: חלק מהפרטים לא אומתו מול המאגר. כדאי לבדוק לפני פנייה.
```

---

### שכבה 4: Feedback Loop — המשתמש מלמד את Goldfish

**UI Component: כפתורי משוב בכל הודעה**

```
[👍 מדויק] [👎 לא מדויק] [🔧 תקן]
```

**כש-user לוחץ "לא מדויק":**
1. שואל: "מה לא היה נכון?" (שדה טקסט קצר)
2. שומר ב-Supabase:

```sql
CREATE TABLE chat_feedback (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id UUID,
  conversation_id UUID,
  message_index INT,
  rating TEXT CHECK (rating IN ('positive', 'negative', 'correction')),
  user_comment TEXT,
  ai_response_snippet TEXT, -- first 500 chars of the AI response
  active_tab TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

**מה עושים עם זה:**
- דוח שבועי: כמה 👎, באיזו לשונית, על איזה נושא
- אם אותה טעות חוזרת → מעדכנים system prompt
- אם קרן/חברה שגויה → מעדכנים DB

---

### שכבה 5: דשבורד איכות — Admin View

**דף ב-Admin שמציג:**

| מדד | מה מודדים | יעד |
|------|----------|------|
| דיוק | % הודעות עם 👍 | > 90% |
| שטויות | % הודעות עם 👎 | < 5% |
| "לא יודע" | כמה פעמים Goldfish אמר "לא מכיר" | 10-20% (בריא!) |
| מקורות | % תשובות עם תג מקור | > 80% |
| הזיות | מיילים/שמות שלא ב-DB | 0 (יעד!) |

**שאילתות:**
```sql
-- אחוז משובים חיוביים
SELECT
  COUNT(*) FILTER (WHERE rating = 'positive') * 100.0 / COUNT(*) as positive_pct,
  COUNT(*) FILTER (WHERE rating = 'negative') * 100.0 / COUNT(*) as negative_pct
FROM chat_feedback
WHERE created_at > now() - interval '7 days';

-- לשוניות בעייתיות
SELECT active_tab, COUNT(*) as negatives
FROM chat_feedback WHERE rating = 'negative'
GROUP BY active_tab ORDER BY negatives DESC;

-- טעויות חוזרות
SELECT user_comment, COUNT(*) as times
FROM chat_feedback WHERE rating = 'negative'
GROUP BY user_comment ORDER BY times DESC LIMIT 10;
```

---

## שיפור מתמיד — 4 מעגלים

### מעגל יומי: סריקה ועדכון DB
```
07:00 — סורק קולות קוראים (daily_grants_scan.py)
07:15 — סורק פייסבוק (facebook_sector_scanner.py)
→ DB מתעדכן → Goldfish מדבר על מידע עדכני
```

### מעגל שבועי: ניתוח משובים
```
כל יום ראשון:
1. בדוק chat_feedback מהשבוע
2. זהה דפוסים: אילו שאלות מקבלות 👎?
3. עדכן system prompt / TAB_FOCUS בהתאם
4. עדכן DB אם צריך (מייל שגוי, קרן שנסגרה)
```

### מעגל חודשי: ביקורת מאגר
```
כל תחילת חודש:
1. בדוק דדליינים שעברו → active=false
2. בדוק מיילים שחוזרים (bounce) → עדכן companies
3. בדוק קרנות חדשות שנוספו
4. עדכן סטטיסטיקות: כמה פריטים ב-DB, כמה פעילים
```

### מעגל רבעוני: בדיקת עומק
```
כל 3 חודשים:
1. דגום 50 שיחות אקראיות ובדוק ידנית
2. בדוק: האם Goldfish נתן עצה טובה?
3. בדוק: האם היו הזיות שלא נתפסו?
4. עדכן behavior rules אם צריך
```

---

## Red Flags — מה שצריך לתפוס מיד

| Red Flag | איך תופסים | תגובה |
|----------|------------|--------|
| Goldfish המציא קרן שלא קיימת | Post-processing: שם לא ב-DB | הוסף אזהרה |
| מייל שגוי | Post-processing: מייל לא ב-companies | הוסף "⚠️ לא אומת" |
| דדליין שעבר | Cross-check: deadline < today | "⚠️ הדדליין עבר" |
| סכום מומצא | Cross-check: amount לא ב-DB | ציין "מידע כללי" |
| "אני בטוח ש-" + מידע שגוי | Pattern detection | הכי מסוכן! |

---

## סיכום — מה לבנות קודם

### Phase 1 (מיידי — שינוי system prompt):
- [ ] הוסף "ציין מקור" ל-system prompt
- [ ] הוסף "אל תמציא מיילים/סכומים"
- [ ] הוסף pattern: `[מאגר Goldfish]` / `[מידע כללי]`

### Phase 2 (שבוע — feedback UI):
- [ ] כפתורי 👍/👎 בכל הודעת AI
- [ ] טבלת chat_feedback ב-Supabase
- [ ] שמירת משובים

### Phase 3 (חודש — guardrails):
- [ ] Post-processing: בדיקת מיילים מול DB
- [ ] Post-processing: בדיקת שמות ארגונים מול DB
- [ ] אזהרות אוטומטיות

### Phase 4 (רבעון — דשבורד):
- [ ] דף Admin עם מדדי איכות
- [ ] דוח שבועי אוטומטי
- [ ] ניתוח דפוסי טעויות
