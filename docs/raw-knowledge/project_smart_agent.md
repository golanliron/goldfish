---
name: סוכן חכם — AI Smart Input Pattern
description: תבנית "הדבק תוכן → AI מחלץ → ממלא טופס" שנבנתה במערכת הניהול hopa-lev-yotzer
type: project
---

## מהו הסוכן החכם

תבנית אחידה שנבנתה ב-3 דפים במערכת הניהול (React/TypeScript, `hopa-lev-yotzer`):
המשתמש מדביק טקסט חופשי (או URL) → Claude API מחלץ מידע מובנה → הטופס מתמלא אוטומטית → המשתמש בודק ושומר.

## מפתח Claude API
- נשמר פעם אחת ב-`localStorage` תחת `hopa_claude_api_key`
- כל הדפים קוראים: `localStorage.getItem("hopa_claude_api_key")`
- מוגדר בדף הגדרות: `src/pages/SettingsPage.tsx`

---

## יישומים קיימים

### 1. פרויקטים — `src/pages/Projects.tsx`
- מופעל בדיאלוג "פרויקט חדש" בלבד (לא בעריכה)
- toggle: "הדבק תוכן" (smart) / "ידני" (manual)
- פונקציה: `aiExtractProject(text, apiKey)`
- מודל: `claude-sonnet-4-6`, max_tokens: 700
- מחלץ: `{ name, category, audience, description, highlights, budget_note }`
- קטגוריות קבועות: נשירה/בוגרים/תעסוקה/מלגות/לינה/שירות/חינוך/קהילה/אחר

### 2. קולות קוראים — `src/pages/Calls.tsx`
- מופעל בדיאלוג הוספת קול קורא
- תמיכה גם ב-URL: קורא Edge Function `fetch-url` (ללא JWT) → מחלץ טקסט מ-HTML
- פונקציות:
  - `fetchUrlText(url)`: POST ל-`${SUPABASE_URL}/functions/v1/fetch-url`
  - `aiExtractCall(text, apiKey)`: מחלץ `{ foundation_name, title, deadline, amount_max, url, description }`
- אם יש URL ואין טקסט — קורא fetchUrlText קודם

### 3. אימפקט — `src/pages/Impact.tsx`
- כפתור "הדבק תוכן — AI יסדר" → dialog נפרד
- פונקציה: `aiExtractMetrics(text, apiKey)`
- מחזיר מערך: `[{ category, metric_name, value, unit, description }]`
- המשתמש רואה רשימת מדדים שהוחלצו, בוחר ומאשר → שמירה מרובה לסאפה
- קטגוריות: כללי/נשירה/בוגרים

---

## תבנית קוד סטנדרטית

```typescript
const CLAUDE_KEY = "hopa_claude_api_key";

async function aiExtract(text: string, apiKey: string): Promise<Partial<T>> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 700,
      messages: [{ role: "user", content: `...פרומפט בעברית...\n\n${text.slice(0, 4000)}` }],
    }),
  });
  const data = await res.json();
  const raw = data.content[0]?.text ?? "{}";
  const cleaned = raw.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
  return JSON.parse(cleaned);
}

// בקומפוננטה:
const apiKey = localStorage.getItem(CLAUDE_KEY) ?? "";
if (!apiKey) { setError("נדרש מפתח Claude API — הכנס בהגדרות"); return; }
```

---

## הרחבה עתידית
כאשר מוסיפים דף חדש עם טופס — ניתן להוסיף את אותה תבנית:
1. `const apiKey = localStorage.getItem(CLAUDE_KEY) ?? ""`
2. פונקציית `aiExtract*()` עם פרומפט מותאם
3. toggle "הדבק תוכן" / "ידני" בדיאלוג
4. state: `inputMode`, `smartText`, `extracting`, `extracted`, `error`
