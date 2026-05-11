import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// Gemini 2.5 Pro — best quality for understanding, classification, extraction
const pro = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-preview-05-20' });

// Gemini Flash — fast for file parsing, OCR, multimodal
const flash = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-preview-05-20' });

/**
 * Classify a document into a category — uses Pro for accuracy
 */
export async function geminiClassify(text: string): Promise<string> {
  const result = await pro.generateContent({
    contents: [{
      role: 'user',
      parts: [{ text: `סווג את המסמך לקטגוריה אחת:
- identity: תקנון, תיאור ארגוני, אודות, חזון ומטרות, מצגת היכרות
- programs: תיאורי תוכניות, מודל הפעלה, שירותים, פעילויות הארגון
- budget: דוחות כספיים שנתיים, מאזנים, תקציב מאושר של הארגון כולו
- project_budget: תקציב פרויקט ספציפי, הצעת מחיר, עלויות תוכנית
- grant: קולות קוראים, הסכמי מענק, תנאי סף
- submission: הגשות לקרנות, בקשות מענק, מכתבי בקשה
- impact: דוחות אימפקט, מדידה, הערכה, סקרים, מדדי הצלחה
- linkedin: פרופיל לינקדאין, חברה, קשרים עסקיים
- other: כל דבר שלא מתאים לקטגוריות למעלה (כולל גיוס משאבים כללי, אסטרטגיה)

ענה רק עם שם הקטגוריה.

תוכן המסמך:
${text.slice(0, 8000)}` }],
    }],
    generationConfig: { maxOutputTokens: 20, temperature: 0 },
  });

  const category = result.response.text().trim().toLowerCase();
  const valid = ['identity', 'programs', 'budget', 'project_budget', 'project', 'grant', 'submission', 'impact', 'linkedin', 'other'];
  return valid.includes(category) ? category : 'other';
}

/**
 * Extract structured data from document text — uses Pro for deep understanding
 */
export async function geminiExtract(text: string, category?: string): Promise<Record<string, unknown>> {
  const result = await pro.generateContent({
    contents: [{
      role: 'user',
      parts: [{ text: `אתה מומחה לניתוח מסמכים של עמותות וארגונים חברתיים. חלץ את כל הנתונים המובנים מהתוכן.
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
- contact_name: שם איש קשר
- contact_email: אימייל
- contact_phone: טלפון
- website: אתר אינטרנט
- key_achievements[]: הישגים מרכזיים
- active_projects[{name, description, budget, beneficiaries}]: פרויקטים פעילים
- partners[]: שותפויות ושיתופי פעולה
- company_name: שם חברה (אם חברה עסקית)
- company_type: סוג חברה
- industry: ענף
- linkedin_url: קישור לינקדאין
- key_people[{name, role, contact}]: אנשי מפתח
- impact_metrics[{metric, value, year}]: מדדי אימפקט
${category ? `\nקטגוריית המסמך: ${category}` : ''}

חלץ כל מה שזמין. עברית מותרת בערכים. דייק במספרים ובשמות.

תוכן:
${text.slice(0, 30000)}` }],
    }],
    generationConfig: { maxOutputTokens: 4000, temperature: 0 },
  });

  try {
    const raw = result.response.text();
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, raw];
    return JSON.parse(jsonMatch[1]!.trim());
  } catch {
    return {};
  }
}

/**
 * Summarize document text in Hebrew — uses Pro for quality
 */
export async function geminiSummarize(text: string): Promise<string> {
  const result = await pro.generateContent({
    contents: [{
      role: 'user',
      parts: [{ text: `אתה מומחה לגיוס משאבים לעמותות. סכם את התוכן ב-4-6 משפטים בעברית.

ציין:
1. שם הארגון/חברה/גוף
2. תחום פעילות ואוכלוסיות יעד
3. נקודות מפתח — הישגים, מספרים, תקציבים
4. מידע רלוונטי לגיוס משאבים — קשרים, שותפויות, קרנות, CSR
5. חוזקות ייחודיות של הארגון

תוכן:
${text.slice(0, 30000)}` }],
    }],
    generationConfig: { maxOutputTokens: 500, temperature: 0.2 },
  });

  return result.response.text();
}

/**
 * OCR a PDF buffer using Gemini multimodal — uses Flash for speed on large files
 */
export async function geminiOcrPdf(buffer: Buffer): Promise<string> {
  const base64 = buffer.toString('base64');

  const result = await flash.generateContent({
    contents: [{
      role: 'user',
      parts: [
        {
          inlineData: {
            mimeType: 'application/pdf',
            data: base64,
          },
        },
        { text: 'חלץ את כל הטקסט מהמסמך הזה. עברית ואנגלית. שמור על מבנה הפסקאות. החזר רק את הטקסט, בלי הסברים.' },
      ],
    }],
    generationConfig: { maxOutputTokens: 16000, temperature: 0 },
  });

  return result.response.text();
}

/**
 * Parse XLSX buffer using Gemini multimodal — uses Flash for speed
 */
export async function geminiParseXlsx(buffer: Buffer): Promise<string> {
  const base64 = buffer.toString('base64');

  const result = await flash.generateContent({
    contents: [{
      role: 'user',
      parts: [
        {
          inlineData: {
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            data: base64,
          },
        },
        { text: 'חלץ את כל הנתונים מהקובץ הזה. הצג כטבלה טקסטואלית מסודרת. שמור על שמות עמודות. עברית ואנגלית.' },
      ],
    }],
    generationConfig: { maxOutputTokens: 16000, temperature: 0 },
  });

  return result.response.text();
}

/**
 * Deep document analysis — uses Pro with full context window for thorough understanding
 * Sends up to 100K chars (roughly 50K tokens) for deep comprehension
 */
export async function geminiDeepAnalysis(text: string, orgContext?: string): Promise<{
  category: string;
  metadata: Record<string, unknown>;
  summary: string;
  insights: string;
  missing_info: string[];
}> {
  const contextSection = orgContext
    ? `\n\nהקשר ארגוני קיים:\n${orgContext.slice(0, 10000)}`
    : '';

  const result = await pro.generateContent({
    contents: [{
      role: 'user',
      parts: [{ text: `אתה מומחה בכיר לניתוח מסמכים של ארגונים חברתיים וגיוס משאבים.
נתח לעומק את המסמך הבא והחזר JSON תקין בלבד.
${contextSection}

המסמך לניתוח:
${text.slice(0, 100000)}

החזר JSON עם המבנה הבא:
{
  "category": "identity|budget|project|grant|submission|impact|linkedin|other",
  "metadata": {
    // כל שדה רלוונטי: name, registration_number, founded_year, mission, focus_areas[],
    // target_populations[], regions[], beneficiaries_count, employees_count, volunteers_count,
    // annual_budget, revenue_sources[], contact_name, contact_email, contact_phone, website,
    // key_achievements[], active_projects[], partners[], impact_metrics[], key_people[]
  },
  "summary": "סיכום מעמיק ב-4-6 משפטים בעברית",
  "insights": "תובנות לגיוס משאבים — מה חזק, מה חסר, מה אפשר לנצל",
  "missing_info": ["רשימת מידע חסר שחשוב להשלים לצורך הגשות לקרנות"]
}` }],
    }],
    generationConfig: { maxOutputTokens: 6000, temperature: 0 },
  });

  try {
    const raw = result.response.text();
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, raw];
    return JSON.parse(jsonMatch[1]!.trim());
  } catch {
    return {
      category: 'other',
      metadata: {},
      summary: '',
      insights: '',
      missing_info: [],
    };
  }
}

/**
 * Run classify + extract + summarize in parallel — all with Pro
 */
export async function geminiAnalyzeDocument(text: string): Promise<{
  category: string;
  metadata: Record<string, unknown>;
  summary: string;
}> {
  // For short documents, run 3 calls in parallel for speed
  if (text.length < 15000) {
    const [category, metadata, summary] = await Promise.all([
      geminiClassify(text),
      geminiExtract(text),
      geminiSummarize(text),
    ]);
    return { category, metadata, summary };
  }

  // For long documents, use single deep analysis call to leverage full context
  const result = await geminiDeepAnalysis(text);
  return {
    category: result.category,
    metadata: result.metadata,
    summary: result.summary,
  };
}
