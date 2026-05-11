// Direct Gemini REST API calls — bypasses SDK v1beta issues

const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const MODEL = 'gemini-2.5-flash-preview-05-20';
const BASE = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}`;

async function geminiCall(prompt: string, maxTokens: number = 500, temp: number = 0): Promise<string> {
  const res = await fetch(`${BASE}:generateContent?key=${GEMINI_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: maxTokens, temperature: temp },
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Gemini ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

async function geminiCallMultimodal(parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }>, maxTokens: number = 16000): Promise<string> {
  const res = await fetch(`${BASE}:generateContent?key=${GEMINI_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { maxOutputTokens: maxTokens, temperature: 0 },
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Gemini ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

/**
 * Classify a document into a category
 */
export async function geminiClassify(text: string): Promise<string> {
  const raw = await geminiCall(`סווג את המסמך לקטגוריה אחת:
- identity: תקנון, תיאור ארגוני, אודות, חזון ומטרות, מצגת היכרות
- programs: תיאורי תוכניות, מודל הפעלה, שירותים, פעילויות הארגון
- budget: דוחות כספיים שנתיים, מאזנים, תקציב מאושר של הארגון כולו
- project_budget: תקציב פרויקט ספציפי, הצעת מחיר, עלויות תוכנית
- grant: קולות קוראים, הסכמי מענק, תנאי סף
- submission: הגשות לקרנות, בקשות מענק, מכתבי בקשה
- impact: דוחות אימפקט, מדידה, הערכה, סקרים, מדדי הצלחה
- linkedin: פרופיל לינקדאין, חברה, קשרים עסקיים
- other: כל דבר שלא מתאים לקטגוריות למעלה

ענה רק עם שם הקטגוריה.

תוכן המסמך:
${text.slice(0, 8000)}`, 20);

  const category = raw.trim().toLowerCase();
  const valid = ['identity', 'programs', 'budget', 'project_budget', 'project', 'grant', 'submission', 'impact', 'linkedin', 'other'];
  return valid.includes(category) ? category : 'other';
}

/**
 * Extract structured data from document text
 */
export async function geminiExtract(text: string, category?: string): Promise<Record<string, unknown>> {
  const raw = await geminiCall(`אתה מומחה לניתוח מסמכים של עמותות וארגונים חברתיים. חלץ את כל הנתונים המובנים מהתוכן.
החזר JSON תקין בלבד.

שדות אפשריים:
- name: שם הארגון/חברה
- registration_number: מספר עמותה/חברה
- founded_year: שנת ייסוד
- mission: ייעוד ומטרות (עד 3 משפטים)
- focus_areas[]: תחומי פעילות עיקריים
- target_populations[]: אוכלוסיות יעד
- regions[]: אזורי פעילות גיאוגרפיים
- beneficiaries_count: מספר מוטבים
- employees_count: מספר עובדים
- volunteers_count: מספר מתנדבים
- annual_budget: תקציב שנתי
- revenue_sources[]: מקורות הכנסה
- contact_name, contact_email, contact_phone, website
- key_achievements[], partners[], key_people[], impact_metrics[]
${category ? `\nקטגוריית המסמך: ${category}` : ''}

חלץ כל מה שזמין. עברית מותרת בערכים. דייק במספרים ובשמות.

תוכן:
${text.slice(0, 30000)}`, 4000);

  try {
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, raw];
    return JSON.parse(jsonMatch[1]!.trim());
  } catch {
    return {};
  }
}

/**
 * Summarize document text in Hebrew
 */
export async function geminiSummarize(text: string): Promise<string> {
  return geminiCall(`אתה מומחה לגיוס משאבים לעמותות. סכם את התוכן ב-4-6 משפטים בעברית.

ציין:
1. שם הארגון/חברה/גוף
2. תחום פעילות ואוכלוסיות יעד
3. נקודות מפתח — הישגים, מספרים, תקציבים
4. מידע רלוונטי לגיוס משאבים
5. חוזקות ייחודיות של הארגון

תוכן:
${text.slice(0, 30000)}`, 500, 0.2);
}

/**
 * OCR a PDF buffer using Gemini multimodal
 */
export async function geminiOcrPdf(buffer: Buffer): Promise<string> {
  return geminiCallMultimodal([
    { inlineData: { mimeType: 'application/pdf', data: buffer.toString('base64') } },
    { text: 'חלץ את כל הטקסט מהמסמך הזה. עברית ואנגלית. שמור על מבנה הפסקאות. החזר רק את הטקסט, בלי הסברים.' },
  ]);
}

/**
 * Parse XLSX buffer using Gemini multimodal
 */
export async function geminiParseXlsx(buffer: Buffer): Promise<string> {
  return geminiCallMultimodal([
    { inlineData: { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', data: buffer.toString('base64') } },
    { text: 'חלץ את כל הנתונים מהקובץ הזה. הצג כטבלה טקסטואלית מסודרת. שמור על שמות עמודות. עברית ואנגלית.' },
  ]);
}

/**
 * Deep document analysis — single call for long documents
 */
export async function geminiDeepAnalysis(text: string, orgContext?: string): Promise<{
  category: string;
  metadata: Record<string, unknown>;
  summary: string;
  insights: string;
  missing_info: string[];
}> {
  const contextSection = orgContext ? `\n\nהקשר ארגוני קיים:\n${orgContext.slice(0, 10000)}` : '';

  const raw = await geminiCall(`אתה מומחה בכיר לניתוח מסמכים של ארגונים חברתיים וגיוס משאבים.
נתח לעומק את המסמך הבא והחזר JSON תקין בלבד.
${contextSection}

המסמך לניתוח:
${text.slice(0, 100000)}

החזר JSON עם המבנה הבא:
{
  "category": "identity|budget|project|grant|submission|impact|linkedin|other",
  "metadata": {},
  "summary": "סיכום מעמיק ב-4-6 משפטים בעברית",
  "insights": "תובנות לגיוס משאבים",
  "missing_info": ["רשימת מידע חסר"]
}`, 6000);

  try {
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, raw];
    return JSON.parse(jsonMatch[1]!.trim());
  } catch {
    return { category: 'other', metadata: {}, summary: '', insights: '', missing_info: [] };
  }
}

/**
 * Run classify + extract + summarize in parallel
 */
export async function geminiAnalyzeDocument(text: string): Promise<{
  category: string;
  metadata: Record<string, unknown>;
  summary: string;
}> {
  if (text.length < 15000) {
    const [category, metadata, summary] = await Promise.all([
      geminiClassify(text),
      geminiExtract(text),
      geminiSummarize(text),
    ]);
    return { category, metadata, summary };
  }

  const result = await geminiDeepAnalysis(text);
  return { category: result.category, metadata: result.metadata, summary: result.summary };
}
