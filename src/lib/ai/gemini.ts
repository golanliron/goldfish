import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// Gemini Flash 2.0 — fast, cheap, great for document analysis
const flash = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

/**
 * Classify a document into a category
 */
export async function geminiClassify(text: string): Promise<string> {
  const result = await flash.generateContent({
    contents: [{
      role: 'user',
      parts: [{ text: `סווג את המסמך לקטגוריה אחת:
- identity: תקנון, תיאור ארגוני, אודות, חזון ומטרות
- budget: דוחות כספיים, מאזנים, תקציבים
- project: תיאורי פרויקטים, תוכניות עבודה
- grant: קולות קוראים, הסכמי מענק
- submission: הגשות לקרנות
- impact: דוחות אימפקט, מדידה, הערכה
- linkedin: פרופיל לינקדאין, חברה, קשרים עסקיים
- other: כל דבר אחר

ענה רק עם שם הקטגוריה.

תוכן המסמך:
${text.slice(0, 4000)}` }],
    }],
    generationConfig: { maxOutputTokens: 20, temperature: 0 },
  });

  const category = result.response.text().trim().toLowerCase();
  const valid = ['identity', 'budget', 'project', 'grant', 'submission', 'impact', 'linkedin', 'other'];
  return valid.includes(category) ? category : 'other';
}

/**
 * Extract structured data from document text
 */
export async function geminiExtract(text: string, category?: string): Promise<Record<string, unknown>> {
  const result = await flash.generateContent({
    contents: [{
      role: 'user',
      parts: [{ text: `חלץ נתונים מובנים מהתוכן. החזר JSON תקין בלבד.
שדות אפשריים: name, registration_number, founded_year, mission, focus_areas[], regions[],
beneficiaries_count, employees_count, annual_budget, contact_name, contact_email, contact_phone,
website, key_achievements[], active_projects[{name,description}],
company_name, company_type, industry, linkedin_url, key_people[{name,role}].
${category ? `קטגוריה: ${category}` : ''}
חלץ מה שזמין. עברית מותרת.

תוכן:
${text.slice(0, 6000)}` }],
    }],
    generationConfig: { maxOutputTokens: 1500, temperature: 0 },
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
 * Summarize document text in Hebrew
 */
export async function geminiSummarize(text: string): Promise<string> {
  const result = await flash.generateContent({
    contents: [{
      role: 'user',
      parts: [{ text: `סכם את התוכן ב-3-4 משפטים בעברית. ציין: שם (ארגון/חברה/אדם), תחום, נקודות מפתח, מידע רלוונטי לגיוס משאבים.

תוכן:
${text.slice(0, 6000)}` }],
    }],
    generationConfig: { maxOutputTokens: 300, temperature: 0.3 },
  });

  return result.response.text();
}

/**
 * OCR a PDF buffer using Gemini's multimodal capabilities
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
        { text: 'חלץ את כל הטקסט מהמסמך הזה. עברית ואנגלית. החזר רק את הטקסט, בלי הסברים.' },
      ],
    }],
    generationConfig: { maxOutputTokens: 8000, temperature: 0 },
  });

  return result.response.text();
}

/**
 * Parse XLSX buffer using Gemini
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
        { text: 'חלץ את כל הנתונים מהקובץ הזה. הצג כטבלה טקסטואלית. עברית ואנגלית.' },
      ],
    }],
    generationConfig: { maxOutputTokens: 8000, temperature: 0 },
  });

  return result.response.text();
}

/**
 * Run classify + extract + summarize in parallel
 */
export async function geminiAnalyzeDocument(text: string): Promise<{
  category: string;
  metadata: Record<string, unknown>;
  summary: string;
}> {
  const [category, metadata, summary] = await Promise.all([
    geminiClassify(text),
    geminiExtract(text),
    geminiSummarize(text),
  ]);

  return { category, metadata, summary };
}
