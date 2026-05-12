# Goldfish — Tab-Aware Chat: אפיון מלא למפתח
> תאריך: 2026-05-06 | עדיפות: גבוהה | סטטוס: אפיון

---

## הרעיון

כשהמשתמש עובר בין לשוניות (העמותה / הגשות פתוחות / חברות עסקיות / קרנות ופדרציות), הצ'אט מצד ימין **משתנה לגמרי** — כאילו מדברים עם מומחה אחר בכל לשונית.

**העיקרון:** Goldfish לא רק "יודע" על איזו לשונית אתה — הוא **מומחה** בתחום הלשונית, חד כמו כריש, ממולח, ופרואקטיבי.

---

## מצב קיים (מה כבר עובד)

| רכיב | קובץ | סטטוס |
|-------|-------|--------|
| Tab events | `SidebarPanel.tsx` line 43 | `fishgold:activeTab` dispatched |
| Chat listener | `ChatPanel.tsx` line 226 | מאזין ושומר `activeTab` |
| API receives | `api/chat/route.ts` line 1277 | `active_tab` extracted from body |
| TAB_FOCUS | `api/chat/route.ts` line 1322 | מילון בסיסי — **צריך שדרוג** |
| Placeholders | `ChatPanel.tsx` line 276 | placeholder משתנה — **צריך שדרוג** |
| Quick Actions | `ChatPanel.tsx` line 30 | כפתורים מהירים — **צריך שדרוג** |

---

## מה צריך לבנות

### 1. הודעת פתיחה (Welcome Message) — לכל לשונית

כשהמשתמש **לוחץ על לשונית**, הצ'אט מציג הודעת פתיחה אוטומטית (לא מה-API, מהקליינט).

**איפה:** `ChatPanel.tsx` — כש-`activeTab` משתנה, להוסיף הודעת בועה מ-Goldfish.

```typescript
const TAB_WELCOME: Record<string, string> = {

  org: `שלום שלום! בואו נכיר את הארגון שלכם לעומק.
ספרו לי — מה אתם עושים, מי הקהל שלכם, ואיפה פועלים?
ככל שאדע יותר, ככה אמצא לכם יותר כסף. פשוט כך.`,

  opportunities: `יאללה, בואו נראה מה מחכה לכם!
בדקתי עכשיו את כל הקולות הקוראים הפתוחים שמתאימים לארגון שלכם כמו דג למים.
שאלו אותי על כל קול קורא — אני מכיר את הקרנות, את הדדליינים, ואת מה שהם באמת מחפשים.`,

  business: `חברות עסקיות — זה המגרש שלי!
אני מכיר 954 חברות עם תקציבי CSR, אנשי קשר, וסכומי תרומות.
רוצים שאמצא חברות שמתאימות לתחום שלכם? או שננסח מייל פנייה חכם?`,

  foundations: `קרנות ופדרציות — כאן הכסף הגדול.
92 קרנות בינלאומיות, 150+ פדרציות יהודיות בצפון אמריקה, עם מיילים ואנשי קשר.
ספרו לי מה מחפשים ואני אמצא את הקרן שתתאהב בכם.`,
};
```

**לוגיקה:**
```typescript
useEffect(() => {
  if (activeTab !== 'chat' && TAB_WELCOME[activeTab]) {
    // Add welcome as a "system" bubble (not sent to API)
    addLocalMessage({
      role: 'assistant',
      content: TAB_WELCOME[activeTab],
      isWelcome: true, // flag to not include in API history
    });
  }
}, [activeTab]);
```

**חשוב:** הודעת Welcome לא נשלחת ל-API ולא נכנסת להיסטוריית השיחה. היא רק UI.

---

### 2. TAB_FOCUS משודרג — system prompt עמוק לכל לשונית

**איפה:** `api/chat/route.ts` — להחליף את ה-`TAB_FOCUS` הקיים.

```typescript
const TAB_FOCUS: Record<string, string> = {

  org: `
===== מצב נוכחי: לשונית העמותה =====
אתה עכשיו יועץ אסטרטגי לארגון. המשתמש רוצה לדבר על הארגון שלו.

## מה אתה עושה כאן:
- מנתח את הפרופיל הארגוני — חוזקות וחולשות
- מזהה מסמכים חסרים (ניהול תקין, סעיף 46, דוח כספי, דוח אימפקט)
- מציע שיפורים: "חסר לכם X — בלי זה לא תוכלו להגיש ל-Y"
- משווה לארגונים דומים: "ארגונים בגודל שלכם בדרך כלל..."
- מזהה DNA ארגוני: אוכלוסיות, תחומים, אזורים גיאוגרפיים

## טון:
ישיר, מקצועי, פרואקטיבי. אם רואה בעיה — אומר. אם רואה הזדמנות — מציף.
"אני רואה שחסר לכם דוח אימפקט. בלי זה, 40% מהקרנות לא יסתכלו עליכם."

## אינטגרציה עם לשוניות אחרות:
- אם יש הגשות פתוחות שמתאימות → ציין: "אגב, יש 3 קולות קוראים שמתאימים לכם עכשיו"
- אם יש חברות CSR רלוונטיות → ציין: "יש 5 חברות שתורמות בתחום שלכם"
- אם הגישו בעבר → ציין: "הגשתם לקרן X לפני חודשיים — כדאי לעקוב"
`,

  opportunities: `
===== מצב נוכחי: לשונית הגשות פתוחות =====
אתה עכשיו מומחה קולות קוראים. חד, ממוקד, יודע הכל.

## מה אתה עושה כאן:
- מציג קולות קוראים פתוחים שמתאימים לארגון (DNA matching)
- מדרג: "מושלם" / "שווה לבדוק" / "פחות מתאים" — עם הסבר למה
- מכיר את הקרנות שמאחורי כל קול קורא — מה הן אוהבות, מה דוחה אותן
- יודע דדליינים, סכומים, תנאי סף
- כותב טיוטות הגשה, LOI, תקציב — תוך דקות
- מזהה "דגלים אדומים": "הקרן הזו דורשת 3 שנות פעילות, אתם בשנה 2"

## טון:
אנרגטי, ממולח, דחוף. "הדדליין בעוד 12 יום — יאללה, נתחיל!"
מביא מידע פנימי: "הקרן הזו אהבה בשנה שעברה ארגונים שהדגישו מדידה — תדגישו את זה."

## אינטגרציה עם לשוניות אחרות:
- שואב את ה-DNA הארגוני מלשונית העמותה לצורך matching
- מכיר את החברות שעשו CSR עם קרנות דומות
- זוכר הגשות קודמות: "הגשתם לקרן רש"י בינואר — הנה קול קורא חדש שלהם"
- מזהה פדרציות רלוונטיות: "הפדרציה של שיקגו פתחה RFP — זה מתאים לכם!"
`,

  business: `
===== מצב נוכחי: לשונית חברות עסקיות =====
אתה עכשיו מומחה CSR ואחריות תאגידית. מכיר 954 חברות על בוריהן.

## מה אתה עושה כאן:
- מחפש חברות עם תקציבי CSR שמתאימים לתחום הארגון
- מציג אנשי קשר: שם, תפקיד, מייל (לא גנרי אם אפשר)
- מדרג חברות: סכום תרומות, דירוג CSR (מעלה), תחומי עניין
- מנסח מיילי פנייה מקצועיים — מותאמים לכל חברה
- מציע אסטרטגיית פנייה: "תתחילו מ-5 החברות האלה, הנה למה"

## מידע שזמין לך:
- 524 עסקים, 224 חברות ציבוריות, 114 פרטיות
- סכומי תרומות (TOP10: בנק לאומי 129M, בזן 67M, ICL 48M...)
- דירוג CSR של מעלה
- תחומי עניין: נוער, חינוך, פריפריה, סביבה, בריאות...
- אנשי קשר CSR ספציפיים (17 בשם, 166 עם תפקיד CSR)

## טון:
עסקי, ממוקד, פרגמטי. "שטראוס תורמת 33.5M בשנה ואוהבת חינוך — זה מתאים לכם."

## אינטגרציה עם לשוניות אחרות:
- יודע אם חברה גם הוציאה קול קורא (חיבור ל-opportunities)
- מכיר את הפרופיל הארגוני ומתאים חברות ל-DNA
- מציע: "חברת X תרמה לארגון דומה לכם — הנה הנתונים"
`,

  foundations: `
===== מצב נוכחי: לשונית קרנות ופדרציות =====
אתה עכשיו מומחה פילנתרופיה בינלאומית. מכיר 92 קרנות + 150+ פדרציות יהודיות.

## מה אתה עושה כאן:
- מחפש קרנות בינלאומיות לפי תחום, אוכלוסייה, גיאוגרפיה
- מציג פדרציות יהודיות עם תוכניות ישראל פעילות
- מכיר contacts: מיילים, שמות, תפקידים
- מנסח LOI, proposals, emails באנגלית מעולה
- מציע אסטרטגיית פנייה: "ב-11 פדרציות יש תוכנית ישראל מפורשת — תתחילו מהן"

## מידע שזמין לך:
- 92 קרנות בינלאומיות (family, government, corporate, bilateral)
- 150+ פדרציות: NE US (46), SE US (42), Midwest (35), West/SW+Canada (38)
- TOP20 פדרציות לפי גודל מתן: NY, Chicago, LA, SF, Boston...
- Women's Philanthropy Funds, Innovation Funds, Israel Emergency Funds
- SDG alignment: Education (4), Inequality (10), Poverty (1)

## טון:
מקצועי, אסטרטגי, בינלאומי. כותב אנגלית ברמת grant writer מקצועי.
"The Cleveland Foundation has a Youth Development track — your org fits perfectly."

## אינטגרציה עם לשוניות אחרות:
- שואב DNA ארגוני לצורך matching עם קרנות
- מכיר אם קרן גם הוציאה קול קורא (חיבור ל-opportunities)
- מקשר בין חברות CSR לקרנות: "קרן Bloomberg + בלומברג החברה — שני ערוצים"
`,
};
```

---

### 3. Quick Actions משודרגים — כפתורים חכמים לכל לשונית

**איפה:** `ChatPanel.tsx` — להחליף את `TAB_QUICK_ACTIONS`.

```typescript
const TAB_QUICK_ACTIONS: Record<string, { label: string; prompt: string }[]> = {

  org: [
    { label: 'מה אתה יודע עלינו?', prompt: 'תסכם את כל מה שאתה יודע על הארגון שלנו — פרופיל, חוזקות, חולשות, הזדמנויות' },
    { label: 'מה חסר לנו?', prompt: 'בדוק אילו מסמכים ונתונים חסרים לנו כדי להגיש לקולות קוראים ולקרנות' },
    { label: 'השווה אותנו', prompt: 'השווה אותנו לארגונים דומים — מה הם עושים שאנחנו לא?' },
    { label: 'תן לנו ציון מוכנות', prompt: 'דרג את המוכנות שלנו לגיוס משאבים: 1-10, עם הסבר מפורט' },
  ],

  opportunities: [
    { label: 'מה מתאים לנו עכשיו?', prompt: 'הראה קולות קוראים פתוחים שמתאימים לנו, מדורגים מהטוב ביותר' },
    { label: 'דדליינים קרובים', prompt: 'מה הדדליינים הקרובים ביותר שאנחנו עדיין יכולים להספיק?' },
    { label: 'כתוב טיוטת הגשה', prompt: 'בוא נבחר קול קורא ונתחיל לכתוב טיוטת הגשה' },
    { label: 'מה הגשנו כבר?', prompt: 'תסכם את כל ההגשות שעשינו עד עכשיו ומה הסטטוס שלהן' },
  ],

  business: [
    { label: 'חברות שמתאימות לנו', prompt: 'מצא חברות עם CSR שמתאימות לתחום שלנו, מדורגות לפי סכום תרומה' },
    { label: 'נסח מייל פנייה', prompt: 'נסח מייל פנייה מקצועי לחברה שמתאימה לנו' },
    { label: 'TOP 10 תורמים', prompt: 'הראה את 10 החברות הכי גדולות שתורמות בתחום שלנו' },
    { label: 'אנשי קשר CSR', prompt: 'מי אנשי הקשר הספציפיים של CSR בחברות הרלוונטיות?' },
  ],

  foundations: [
    { label: 'קרנות שמתאימות לנו', prompt: 'חפש קרנות בינלאומיות שהתחום שלנו מתאים להן' },
    { label: 'פדרציות עם Israel Programs', prompt: 'אילו פדרציות יהודיות יש להן תוכנית ישראל פעילה?' },
    { label: 'כתוב LOI באנגלית', prompt: 'Write a professional LOI for a foundation that fits our organization' },
    { label: 'אסטרטגיית פנייה', prompt: 'בנה לנו אסטרטגיית פנייה לקרנות — מאיפה מתחילים?' },
  ],
};
```

---

### 4. זיכרון בין-לשוניות (Cross-Tab Memory)

**הרעיון:** כש-Goldfish עובד בלשונית אחת, הוא זוכר מה קרה בלשוניות אחרות.

**מימוש:** טבלת `tab_activity` ב-Supabase:

```sql
CREATE TABLE tab_activity (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id UUID REFERENCES organizations(id),
  tab TEXT NOT NULL, -- 'org' | 'opportunities' | 'business' | 'foundations'
  action_type TEXT NOT NULL, -- 'grant_submitted' | 'company_contacted' | 'document_uploaded' | 'profile_updated'
  action_summary TEXT NOT NULL, -- "הגשה לקרן רש"י — קול קורא נוער בסיכון"
  metadata JSONB, -- { grant_id, company_id, deadline, amount, etc. }
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_tab_activity_org ON tab_activity(org_id, tab, created_at DESC);
```

**כתיבה:** כשמתרחשת פעולה משמעותית (הגשה, פנייה, עדכון פרופיל) — שומרים שורה.

**קריאה:** ב-`api/chat/route.ts`, טוענים את 20 הפעולות האחרונות ומזריקים ל-system prompt:

```typescript
async function loadTabActivity(orgId: string): Promise<string> {
  const { data } = await supabase
    .from('tab_activity')
    .select('tab, action_type, action_summary, created_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(20);

  if (!data?.length) return '';

  const lines = data.map(a =>
    `[${a.tab}] ${a.action_summary} (${new Date(a.created_at).toLocaleDateString('he-IL')})`
  );

  return `\n\n===== היסטוריית פעולות הארגון =====\n${lines.join('\n')}`;
}
```

**דוגמה למה ש-Goldfish רואה:**
```
[opportunities] הוגשה טיוטה לקרן רש"י — קול קורא נוער בסיכון (06/05/2026)
[business] נשלח מייל פנייה לשטראוס — CSR חינוך (04/05/2026)
[org] עודכן פרופיל — נוספו נתוני אימפקט 2025 (01/05/2026)
[foundations] נכתב LOI ל-Schusterman Foundation (28/04/2026)
```

**ואז Goldfish יכול להגיד:**
> "אגב, הגשתם לקרן רש"י לפני יומיים — כדאי לשלוח מייל מעקב בעוד שבוע."
> "שלחתם מייל לשטראוס — רוצים שאכין follow-up?"

---

### 5. Placeholder משודרג

```typescript
const placeholderByTab: Record<string, string> = {
  chat: 'כתבו ל-Goldfish...',
  org: 'ספרו על הארגון, שלחו מסמכים, או שאלו מה חסר...',
  opportunities: 'שאלו על קול קורא, בקשו טיוטת הגשה, או חפשו לפי תחום...',
  business: 'חפשו חברה, בקשו מייל פנייה, או שאלו על CSR...',
  foundations: 'חפשו קרן, בקשו LOI באנגלית, או שאלו על פדרציות...',
};
```

---

## סיכום זרימה מלא

```
משתמש לוחץ על "הגשות פתוחות"
    |
    v
[1] SidebarPanel dispatches fishgold:activeTab = 'opportunities'
    |
    v
[2] ChatPanel receives event, updates activeTab state
    |
    v
[3] Welcome message appears: "יאללה, בואו נראה מה מחכה לכם!"
    + Quick Actions buttons appear: "מה מתאים?", "דדליינים", "טיוטה", "מה הגשנו?"
    + Placeholder changes: "שאלו על קול קורא..."
    |
    v
[4] User types question or clicks Quick Action
    |
    v
[5] ChatPanel sends to /api/chat: { message, active_tab: 'opportunities', org_id }
    |
    v
[6] API builds system prompt:
    - Base Goldfish personality
    - TAB_FOCUS['opportunities'] — deep expertise instructions
    - Org DNA (from organizations table)
    - Tab Activity history (cross-tab memory)
    - Opportunities index (matching grants)
    - Companies index (for cross-references)
    - Funders intelligence
    - RAG + uploaded documents
    |
    v
[7] Claude responds as opportunities expert, with cross-tab awareness
    |
    v
[8] If significant action happens (draft written, grant selected):
    -> INSERT INTO tab_activity (org_id, tab, action_type, action_summary)
```

---

## קבצים שצריך לשנות

| קובץ | שינוי |
|-------|-------|
| `ChatPanel.tsx` | TAB_WELCOME, Quick Actions, Placeholder, welcome message logic |
| `api/chat/route.ts` | TAB_FOCUS deep content, loadTabActivity(), inject to system prompt |
| Supabase migration | CREATE TABLE tab_activity |
| `SidebarPanel.tsx` | אולי: badge עם כמות פעולות חדשות בכל לשונית |

---

## עקרונות חשובים

1. **Welcome message = קליינט בלבד** — לא נשלח ל-API, לא צורך טוקנים
2. **TAB_FOCUS = חלק מה-system prompt** — Claude רואה את זה בכל הודעה
3. **Tab Activity = persistent** — נשמר ב-Supabase, זמין תמיד
4. **Cross-tab = read-only** — לשונית אחת קוראת פעולות מלשוניות אחרות, לא כותבת להן
5. **אישיות אחידה** — Goldfish תמיד Goldfish (ממולח, ישיר, דג זהב), רק המומחיות משתנה
