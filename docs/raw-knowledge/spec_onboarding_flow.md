# Goldfish — Onboarding Flow: מה קורה כשעמותה חדשה נרשמת
> תאריך: 2026-05-06

---

## הזרימה המלאה

```
נרשם → שאלון ראשוני → DNA scan → חיפוש ב-DB → הודעת פתיחה מותאמת
```

---

## שלב 1: רישום

המשתמש נרשם עם:
- שם ארגון
- מייל
- סיסמה

**אחרי רישום:** מועבר ל-Chat עם Goldfish שפותח בשאלון.

---

## שלב 2: שאלון ראשוני — Goldfish שואל (לא טופס!)

Goldfish לא מציג טופס יבש. הוא **מנהל שיחה** ושואל בזה אחר זה:

### סדר השאלות:

```
1. "שלום! אני Goldfish. ספרו לי — מה שם הארגון שלכם?"
   → שומר: org_name

2. "יופי! ומה אתם עושים? תארו בכמה מילים"
   → AI מחלץ: categories[], target_populations[]

3. "למי אתם פונים? איזו אוכלוסייה?"
   → AI מדייק: target_populations[]

4. "איפה אתם פועלים? עיר/אזור/ארצי?"
   → שומר: regions[]

5. "מה המחזור הכספי השנתי? (בערך)"
   → שומר: annual_budget

6. "כמה עובדים ומתנדבים?"
   → שומר: staff_count, volunteers_count

7. "יש לכם ניהול תקין בתוקף?"
   → שומר: nihul_takin (boolean)

8. "יש סעיף 46 לתרומות?"
   → שומר: section_46 (boolean)

9. "מאיפה מגיע הכסף היום? ממשלה? קרנות? תרומות?"
   → שומר: funding_sources[]

10. "הגשתם פעם לקולות קוראים?"
    → שומר: grant_experience (none/some/experienced)
```

**כל תשובה → AI מחלץ מידע מובנה ושומר ב-organizations table.**

### אם המשתמש מדביק טקסט חופשי:

Smart Input pattern — הוא מדביק "אנחנו עמותה שעובדת עם נוער בסיכון בבאר שבע, 15 עובדים, מחזור של 2 מיליון" → AI מחלץ **הכל** בבת אחת ומדלג על שאלות שכבר נענו.

---

## שלב 3: DNA Scan — סיווג אוטומטי

**קובץ:** `lib/ai/org-dna.ts`

אחרי שיש מספיק מידע, Goldfish בונה DNA ארגוני:

```typescript
interface OrgDNA {
  // 18 תחומים (categories)
  categories: string[];        // ['education', 'welfare', 'youth']

  // 16 אוכלוסיות (target_populations)
  target_populations: string[]; // ['youth_at_risk', 'periphery']

  // 8 אזורים
  regions: string[];            // ['south', 'national']

  // מאפיינים נוספים
  annual_budget: number;
  staff_count: number;
  nihul_takin: boolean;
  section_46: boolean;
  grant_experience: string;
  funding_sources: string[];
}
```

**ה-DNA משמש ל:**
- matching קולות קוראים (opportunities)
- matching חברות CSR (companies)
- matching קרנות (foundations)
- negative matching: "לא מתאים כי דורש 5 שנות פעילות"

---

## שלב 4: חיפוש ב-DB — "מה אני כבר יודע?"

Goldfish בודק:

### 4.1 האם הארגון ב-companies table?
```sql
SELECT * FROM companies
WHERE name ILIKE '%שם_הארגון%'
   OR description ILIKE '%שם_הארגון%';
```
אם כן → "אני מכיר אתכם! הנה מה שיש לי..."

### 4.2 ארגונים דומים
```sql
SELECT name, description FROM companies
WHERE categories && ARRAY['education','welfare']
  AND target_populations && ARRAY['youth_at_risk']
LIMIT 5;
```
→ "יש כמה ארגונים דומים לכם: X, Y, Z. מכירים?"

### 4.3 קולות קוראים מתאימים — מיידי!
```sql
SELECT title, funder, deadline FROM opportunities
WHERE active = true AND deadline >= CURRENT_DATE
  AND (categories && org_dna.categories
    OR target_populations && org_dna.target_populations)
ORDER BY deadline LIMIT 10;
```
→ "כבר מצאתי 7 קולות קוראים שמתאימים לכם!"

---

## שלב 5: הודעת פתיחה מותאמת

אחרי שהשאלון נגמר, Goldfish מסכם:

```
"מעולה! הנה מה שאני יודע עליכם:

📋 הארגון: [שם] — [תיאור קצר]
👥 אוכלוסייה: נוער בסיכון בפריפריה
📍 אזור: דרום
💰 מחזור: 2M ש"ח
✅ ניהול תקין: כן | סעיף 46: כן

🎯 כבר מצאתי:
- 7 קולות קוראים פתוחים שמתאימים
- 12 חברות CSR בתחום שלכם
- 3 קרנות בינלאומיות רלוונטיות

🔴 מה חסר:
- דוח אימפקט (בלעדיו לא תוכלו להגיש ל-60% מהקרנות)
- אתר אינטרנט (קרנות בינלאומיות דורשות)

מאיפה מתחילים?"
```

---

## שלב 6: העשרה מתמשכת

### Smart Reader — העלאת מסמכים
בכל שלב המשתמש יכול להעלות:
- דוח כספי → AI מחלץ תקציב, מקורות הכנסה
- דוח אימפקט → AI מחלץ מדדים, תוצאות
- מצגת ארגון → AI מחלץ חזון, מטרות, נתונים
- לינק לאתר → AI סורק ומחלץ מידע

כל מסמך → chunks → RAG → זמין בכל שיחה עתידית.

### לימוד מתמשך
כל שיחה עם Goldfish מלמדת אותו יותר על הארגון:
- אם המשתמש מזכיר פרויקט → שומר
- אם מדבר על שותפויות → שומר
- אם מספר על בעיה → שומר

---

## טבלת organizations — שדות

```sql
CREATE TABLE organizations (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  amuta_number TEXT,           -- מספר עמותה
  categories TEXT[],            -- תחומי פעילות
  target_populations TEXT[],    -- אוכלוסיות יעד
  regions TEXT[],               -- אזורים גיאוגרפיים
  annual_budget NUMERIC,
  staff_count INT,
  volunteers_count INT,
  nihul_takin BOOLEAN DEFAULT false,
  section_46 BOOLEAN DEFAULT false,
  grant_experience TEXT,        -- none/some/experienced
  funding_sources TEXT[],       -- government/foundations/donations/self
  website TEXT,
  phone TEXT,
  onboarding_completed BOOLEAN DEFAULT false,
  dna_score JSONB,              -- computed DNA matching scores
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

---

## מה Goldfish עושה אחרי Onboarding — פרואקטיבי!

1. **יומי:** בודק קולות קוראים חדשים מול DNA → שולח notification
2. **שבועי:** מציע חברות CSR חדשות שהתאימו
3. **לפני דדליין:** "יש לכם 7 ימים להגשה לקרן X — רוצים שנתחיל?"
4. **אחרי הגשה:** "הגשתם לפני חודש — כדאי לשלוח follow-up"
