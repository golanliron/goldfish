// Direct Gemini REST API calls — bypasses SDK v1beta issues

const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const MODEL = 'gemini-2.0-flash';
const BASE = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}`;

export async function geminiCall(prompt: string, maxTokens: number = 500, temp: number = 0): Promise<string> {
  if (!GEMINI_KEY) {
    console.error('[gemini] GEMINI_API_KEY is not set!');
    throw new Error('GEMINI_API_KEY missing');
  }

  const delays = [3000, 8000, 15000]; // retry after 3s, 8s, 15s on 429
  let lastError = '';

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    const res = await fetch(`${BASE}:generateContent?key=${GEMINI_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: maxTokens, temperature: temp },
      }),
    });

    if (res.status === 429 && attempt < delays.length) {
      console.warn(`[gemini] 429 rate limit, retrying in ${delays[attempt]}ms (attempt ${attempt + 1})`);
      await new Promise(r => setTimeout(r, delays[attempt]));
      continue;
    }

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      console.error(`[gemini] API error ${res.status}:`, err.slice(0, 500));
      lastError = `Gemini ${res.status}: ${err.slice(0, 200)}`;
      break;
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!text) console.error('[gemini] empty response:', JSON.stringify(data).slice(0, 300));
    return text;
  }

  throw new Error(lastError || 'Gemini failed after retries');
}

async function geminiCallMultimodal(parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }>, maxTokens: number = 16000): Promise<string> {
  const delays = [5000, 12000, 20000];
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    const res = await fetch(`${BASE}:generateContent?key=${GEMINI_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { maxOutputTokens: maxTokens, temperature: 0 },
      }),
    });

    if (res.status === 429 && attempt < delays.length) {
      console.warn(`[gemini multimodal] 429, retrying in ${delays[attempt]}ms`);
      await new Promise(r => setTimeout(r, delays[attempt]));
      continue;
    }

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`Gemini ${res.status}: ${err.slice(0, 200)}`);
    }

    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }
  throw new Error('Gemini multimodal failed after retries');
}

/**
 * Classify a document into a category
 */
export async function geminiClassify(text: string): Promise<string> {
  const raw = await geminiCall(`סווג את המסמך לקטגוריה אחת בלבד. ענה רק עם שם הקטגוריה באנגלית.

קטגוריות — קרא בקפידה, הסדר חשוב:
- official: מסמכים רשמיים/משפטיים של עמותה — אישור ניהול תקין, אישור ניהול ספרים, אישור סעיף 46, אישור ניכוי מס, תעודת רישום/מלכ"ר, אישור חברי ועד מנהל, אישור בעלות חשבון בנקאי, פרוטוקול ועד, תקנון עמותה, אישור עוסק מורשה. אם המסמך הוא אישור רשמי ממשרד ממשלתי/בנק/רשם העמותות — זו הקטגוריה.
- identity: מצגת היכרות, תיאור ארגוני, נרטיב, אודות, חזון, מודל פעולה, דף מידע על הארגון
- programs: תיאורי תוכניות ספציפיות, מודל הפעלה של תוכנית, שירותים, פעילויות, קהלי יעד
- budget: דוחות כספיים שנתיים, מאזנים, תקציב מאושר של הארגון, דוח רואה חשבון
- project_budget: תקציב פרויקט ספציפי, הצעת מחיר, עלויות תוכנית
- grant: קולות קוראים, הסכמי מענק, תנאי סף, רשימות קרנות, מיפוי קרנות, מעקב בקשות
- submission: הגשות לקרנות שכבר נכתבו, בקשות מענק, מכתבי בקשה, טפסי הגשה ממולאים
- impact: דוחות אימפקט, מחקרי הערכה, נתוני תוצאות, סקרים, עדויות משתתפים
- other: כל דבר שלא מתאים לשום קטגוריה לעיל

תוכן המסמך:
${text.slice(0, 8000)}`, 20);

  const category = raw.trim().toLowerCase();
  const valid = ['official', 'identity', 'programs', 'budget', 'project_budget', 'project', 'grant', 'submission', 'impact', 'linkedin', 'other'];
  return valid.includes(category) ? category : 'other';
}

/**
 * Extract structured data from document text
 */
export async function geminiExtract(text: string, category?: string, orgName?: string): Promise<Record<string, unknown>> {
  const orgFilter = orgName
    ? `\nחשוב מאוד: המסמך שייך לארגון "${orgName}". חלץ רק נתונים שמתייחסים לארגון הזה. אם המסמך מזכיר ארגונים אחרים (למשל דוח שמשווה, רשימת עמותות, דוח גיידסטאר), התעלם מנתונים שלהם וחלץ רק מה שרלוונטי ל-"${orgName}".`
    : '';
  const raw = await geminiCall(`אתה מומחה לניתוח מסמכים של עמותות וארגונים חברתיים. חלץ נתונים מובנים מהתוכן.
החזר JSON תקין בלבד.${orgFilter}

שדות אפשריים:
- name: שם הארגון/חברה
- registration_number: מספר עמותה/חברה
- founded_year: שנת ייסוד (שנת הקמה מקורית, לא שנת חידוש אישור)
- mission: ייעוד ומטרות (עד 3 משפטים)
- focus_areas[]: תחומי פעילות עיקריים
- target_populations[]: אוכלוסיות יעד
- sub_populations[]: תתי-אוכלוסיות (נשים, ערבים, עולים, חד-הוריים, אתיופים, חרדים, בדואים, דרוזים, LGBTQ)
- regions[]: אזורי פעילות גיאוגרפיים
- beneficiaries_count: מספר מוטבים
- employees_count: מספר עובדים
- volunteers_count: מספר מתנדבים
- annual_budget: תקציב שנתי (סה"כ מחזור, לא סעיף בודד)
- revenue_sources[]: מקורות הכנסה
- contact_name, contact_email, contact_phone, website
- key_achievements[], partners[], key_people[], impact_metrics[]
- theory_of_change: תיאוריית השינוי (Logic Model: מה הבעיה → מה עושים → מה התוצאה)
- unique_model: מה ייחודי במודל הפעולה (מה שמבדיל מארגונים אחרים)
- strengths[]: חוזקות מרכזיות (מחקר מלווה, מודל ייחודי, ניסיון, רשת שותפים)
- challenges[]: אתגרים וחוסרים (מה חסר, מה קשה, מה צריך לשפר)
- age_range: טווח גילאי אוכלוסיית היעד (למשל 14-18, 18-26, 0-6)
- certifications[]: אישורים בתוקף (ניהול תקין, סעיף 46, ניכוי מס, ניהול ספרים)
${category ? `\nקטגוריית המסמך: ${category}` : ''}

חלץ כל מה שזמין. עברית מותרת בערכים. דייק במספרים ובשמות. אם לא בטוח לגבי ערך, עדיף לא לכלול אותו.

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
export async function geminiDeepAnalysis(text: string, orgContext?: string, orgName?: string): Promise<{
  category: string;
  metadata: Record<string, unknown>;
  summary: string;
  insights: string;
  missing_info: string[];
}> {
  const contextSection = orgContext ? `\n\nהקשר ארגוני קיים:\n${orgContext.slice(0, 10000)}` : '';
  const orgFilter = orgName
    ? `\n\nחשוב מאוד: המסמך שייך לארגון "${orgName}". חלץ רק נתונים שמתייחסים לארגון הזה בלבד. התעלם מנתונים של ארגונים אחרים המוזכרים במסמך.`
    : '';

  const raw = await geminiCall(`אתה מומחה בכיר לניתוח מסמכים של ארגונים חברתיים וגיוס משאבים.
נתח לעומק את המסמך הבא והחזר JSON תקין בלבד.
${contextSection}${orgFilter}

המסמך לניתוח:
${text.slice(0, 100000)}

החזר JSON עם המבנה הבא:
{
  "category": "identity|budget|project|grant|submission|impact|linkedin|other",
  "metadata": {
    "name": "שם הארגון",
    "theory_of_change": "תיאוריית השינוי: בעיה → פעולה → תוצאה",
    "unique_model": "מה ייחודי במודל הפעולה",
    "strengths": ["חוזקות מרכזיות"],
    "challenges": ["אתגרים"],
    "sub_populations": ["תתי-אוכלוסיות"],
    "age_range": "טווח גילאים",
    "certifications": ["אישורים בתוקף"],
    "...": "כל שדה רלוונטי נוסף"
  },
  "summary": "סיכום מעמיק ב-4-6 משפטים בעברית",
  "insights": "תובנות לגיוס משאבים — זוויות הגשה, קרנות מתאימות, חוזקות לשיווק",
  "missing_info": ["רשימת מידע חסר שנדרש להגשות"]
}`, 8000);

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
export async function geminiAnalyzeDocument(text: string, orgName?: string): Promise<{
  category: string;
  metadata: Record<string, unknown>;
  summary: string;
}> {
  if (text.length < 15000) {
    const [category, metadata, summary] = await Promise.all([
      geminiClassify(text),
      geminiExtract(text, undefined, orgName),
      geminiSummarize(text),
    ]);
    return { category, metadata, summary };
  }

  const result = await geminiDeepAnalysis(text, undefined, orgName);
  return { category: result.category, metadata: result.metadata, summary: result.summary };
}
