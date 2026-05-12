# Goldfish — Email Outreach: ניסוח מיילי פנייה חכמים
> תאריך: 2026-05-06

---

## הרעיון

Goldfish לא רק מוצא חברות וקרנות — הוא **כותב את המייל** בשביל העמותה.
מייל מותאם אישית, מקצועי, עם כל הנתונים הנכונים.

---

## 4 סוגי מיילים

### 1. פנייה לחברה (CSR)
```
נושא: הזמנה לשותפות — [שם הארגון] + [שם החברה]

שלום [שם איש קשר / צוות CSR],

אני פונה אליכם מ[שם הארגון], עמותה שפועלת בתחום [תחום] עם [אוכלוסייה] ב[אזור].

[2-3 משפטים על הארגון — נתונים, הישגים, ייחודיות]

ראינו ש[שם החברה] פעילה בתחום [תחום CSR רלוונטי], ואנחנו מאמינים שיש כאן
פוטנציאל לשותפות שתיצור ערך לשני הצדדים:
- [ערך 1 לחברה: חשיפה / עובדי התנדבות / ESG]
- [ערך 2 לחברה: אימפקט מדיד / סיפור]

נשמח לפגישה קצרה של 20 דקות.

בברכה,
[שם]
[תפקיד]
[טלפון]
```

**Personalization — Goldfish יודע:**
- שם החברה ותחומי CSR (מ-companies DB)
- סכום תרומות שנתי
- דירוג מעלה
- אם יש איש קשר CSR ספציפי

### 2. LOI לקרן בינלאומית (אנגלית)
```
Subject: Letter of Intent — [Org Name] | [Program Name]

Dear [Foundation Name] Grants Committee,

[Org Name] respectfully submits this Letter of Intent for [program/grant name].

Organization Overview:
[Org Name] is an Israeli nonprofit serving [population] in [region] since [year].
We currently reach [X] beneficiaries annually with a budget of [amount].

Program Summary:
[2-3 paragraphs: problem, solution, expected outcomes]

Alignment with [Foundation] Priorities:
- [Priority 1]: Our work directly addresses...
- [Priority 2]: We measure impact through...

Budget: [Amount] requested for [duration]

We would welcome the opportunity to submit a full proposal.

Respectfully,
[Name, Title]
[Organization]
[Contact]
```

**Goldfish יודע:**
- מידע על 92 קרנות + 150+ פדרציות
- SDG alignment (4, 10, 1)
- Theory of Change, Logic Model
- מה הקרן הספציפית אוהבת (מ-funder intelligence)

### 3. Follow-up אחרי הגשה
```
נושא: מעקב — הגשה ל[שם קול קורא] | [שם הארגון]

שלום [שם],

פונה אליכם בהמשך להגשה שלנו ל[שם קול קורא] מתאריך [תאריך].
[שם הארגון] הגיש בקשה בסך [סכום] עבור [תיאור קצר].

אשמח לדעת אם נדרש מידע נוסף מצדנו, ומתי צפויה תשובה.

תודה רבה,
[שם]
```

### 4. הודעת תודה אחרי תרומה
```
נושא: תודה מעומק הלב — [שם הארגון]

[שם] שלום,

תודה ענקית על התרומה של [סכום] ל[שם הארגון].
בזכותכם, [משפט אימפקט ספציפי: "42 צעירים יקבלו ליווי מקצועי השנה"].

[קישור לדוח אימפקט / סרטון תודה]

נשמח לעדכן אתכם על ההתקדמות.

בהערכה רבה,
[שם]
```

---

## איך Goldfish מנסח — הזרימה

```
משתמש: "תנסח מייל לשטראוס"
    ↓
[1] Goldfish מחפש שטראוס ב-companies DB
    → מוצא: donation_amount=33.5M, interests=["חינוך","נוער","מזון"], CSR contact, website
    ↓
[2] טוען DNA של הארגון
    → categories, target_populations, achievements, impact metrics
    ↓
[3] מחליט סוג מייל (CSR פנייה)
    ↓
[4] בונה מייל מותאם:
    - שם איש קשר (אם יש)
    - תחום CSR ספציפי של שטראוס
    - נתוני הארגון
    - ערך לחברה
    ↓
[5] מציג למשתמש → המשתמש עורך → שולח
```

---

## כללי כתיבה

### עברית:
- ישיר, מקצועי, לא מתרפס
- לא "הנכבד/ה" — כן "שלום [שם]"
- מספרים קונקרטיים תמיד: "1,200 מוטבים", לא "מאות"
- CTA ברור: "נשמח לפגישה של 20 דקות"
- קצר: מקסימום 150 מילים

### אנגלית:
- Professional grant-writing English
- Active voice, specific numbers
- Theory of Change language
- SDG references where relevant
- Match foundation's own language (from their website/RFP)

### מה לא לעשות:
- לא להמציא נתונים
- לא לכתוב סכום תרומה אם לא ידוע
- לא לכתוב שם איש קשר שגוי
- לא "Dear Sir/Madam" — לחפש שם אמיתי

---

## Email Templates ב-DB (עתידי)

```sql
CREATE TABLE email_templates (
  id UUID PRIMARY KEY,
  template_type TEXT, -- 'csr_outreach', 'loi', 'follow_up', 'thank_you'
  language TEXT,      -- 'he', 'en'
  subject_template TEXT,
  body_template TEXT, -- with {{placeholders}}
  created_at TIMESTAMPTZ DEFAULT now()
);
```

**Placeholders:**
- `{{org_name}}`, `{{org_description}}`, `{{org_impact}}`
- `{{company_name}}`, `{{company_csr_focus}}`, `{{contact_name}}`
- `{{foundation_name}}`, `{{grant_name}}`, `{{deadline}}`
- `{{amount}}`, `{{duration}}`

---

## אינטגרציה עם Tab Activity

כש-Goldfish מנסח מייל:
```sql
INSERT INTO tab_activity (org_id, tab, action_type, action_summary, metadata)
VALUES (
  'org-uuid',
  'business',
  'email_drafted',
  'נוסח מייל פנייה לשטראוס — CSR חינוך',
  '{"company_id": "...", "template": "csr_outreach", "language": "he"}'
);
```

→ בפעם הבאה: "שלחתם מייל לשטראוס לפני שבוע — רוצים follow-up?"

---

## Copy to Clipboard

כשהמייל מוכן, כפתור **"העתק למייל"** שמעתיק:
- Subject (נפרד)
- Body (מפורמט)
- To email (אם ידוע)

עתידי: שילוב עם Gmail API לשליחה ישירה.
