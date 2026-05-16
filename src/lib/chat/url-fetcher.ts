import Anthropic from '@anthropic-ai/sdk';
import { createAdminClient } from '@/lib/supabase/admin';
import { geminiSearchGrounding } from '@/lib/ai/gemini';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi;

export interface FetchedUrl {
  url: string;
  content: string;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

async function lookupGrantByUrl(url: string): Promise<string | null> {
  try {
    const oppDb = createAdminClient();
    const { data: grant } = await oppDb
      .from('opportunities')
      .select('title, description, funder, deadline, amount_max, categories, target_populations, regions, eligibility, url, contact_info')
      .eq('url', url)
      .single();

    if (grant) {
      return [
        `[מידע על קול קורא מהמאגר]`,
        `כותרת: ${grant.title}`,
        grant.funder ? `גוף מממן: ${grant.funder}` : '',
        grant.deadline ? `דדליין: ${grant.deadline}` : '',
        grant.amount_max ? `סכום: עד ${(grant.amount_max / 1000).toFixed(0)}K ש"ח` : '',
        grant.categories?.length ? `קטגוריות: ${grant.categories.join(', ')}` : '',
        grant.target_populations?.length ? `אוכלוסיות: ${grant.target_populations.join(', ')}` : '',
        grant.regions?.length ? `אזורים: ${grant.regions.join(', ')}` : '',
        grant.eligibility ? `תנאי זכאות: ${grant.eligibility}` : '',
        grant.contact_info ? `פרטי קשר: ${grant.contact_info}` : '',
        grant.description ? `תיאור מלא: ${grant.description}` : '',
      ].filter(Boolean).join('\n');
    }

    const baseUrl = url.split('?')[0];
    const { data: partialMatch } = await oppDb
      .from('opportunities')
      .select('title, description, funder, deadline, amount_max, categories, target_populations, regions, eligibility, url, contact_info')
      .ilike('url', `%${baseUrl.slice(-60)}%`)
      .limit(1)
      .single();

    if (partialMatch) {
      return [
        `[מידע על קול קורא מהמאגר]`,
        `כותרת: ${partialMatch.title}`,
        partialMatch.funder ? `גוף מממן: ${partialMatch.funder}` : '',
        partialMatch.deadline ? `דדליין: ${partialMatch.deadline}` : '',
        partialMatch.amount_max ? `סכום: עד ${(partialMatch.amount_max / 1000).toFixed(0)}K ש"ח` : '',
        partialMatch.categories?.length ? `קטגוריות: ${partialMatch.categories.join(', ')}` : '',
        partialMatch.target_populations?.length ? `אוכלוסיות: ${partialMatch.target_populations.join(', ')}` : '',
        partialMatch.regions?.length ? `אזורים: ${partialMatch.regions.join(', ')}` : '',
        partialMatch.eligibility ? `תנאי זכאות: ${partialMatch.eligibility}` : '',
        partialMatch.contact_info ? `פרטי קשר: ${partialMatch.contact_info}` : '',
        partialMatch.description ? `תיאור מלא: ${partialMatch.description}` : '',
      ].filter(Boolean).join('\n');
    }

    return null;
  } catch {
    return null;
  }
}

async function fetchWithJinaReader(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    const res = await fetch(`https://r.jina.ai/${url}`, {
      signal: controller.signal,
      headers: {
        Accept: 'text/plain',
        'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });

    clearTimeout(timeout);

    if (!res.ok) return null;

    const text = await res.text();
    if (text.length > 200) return text.slice(0, 15000);
    return null;
  } catch {
    return null;
  }
}

export async function parsePdfBuffer(buffer: Buffer): Promise<string> {
  try {
    const pdfParse = (await import('pdf-parse')).default;
    const result = await pdfParse(buffer);
    if (result.text && result.text.trim().length > 20) {
      return result.text;
    }
  } catch (e) {
    console.error('PDF parse error in chat, trying Claude fallback:', e);
  }

  try {
    const base64 = buffer.toString('base64');
    const res = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
          { type: 'text', text: 'חלץ את כל הטקסט מהמסמך הזה. עברית ואנגלית. החזר רק את הטקסט.' },
        ],
      }],
      max_tokens: 8000,
    });
    const text = res.content[0].type === 'text' ? res.content[0].text : '';
    if (text.length > 20) return text;
  } catch (e) {
    console.error('Claude PDF OCR fallback error:', e);
  }

  return '';
}

export async function parseDocxBuffer(buffer: Buffer): Promise<string> {
  try {
    const mammoth = await import('mammoth');
    const extract = mammoth.default?.extractRawText || mammoth.extractRawText;
    const result = await extract({ buffer });
    return result.value || '';
  } catch (e) {
    console.error('DOCX parse error:', e);
    return '';
  }
}

function isLinkedInUrl(url: string): boolean {
  return /linkedin\.com\/(company|in|posts|pulse|feed)/i.test(url);
}

function isGovUrl(url: string): boolean {
  return /\.gov\.il|\.mof\.gov|\.mohe\.gov|\.molsa\.gov|\.education\.gov|\.health\.gov/i.test(url);
}

async function fetchWithGemini(url: string): Promise<string | null> {
  try {
    const text = await geminiSearchGrounding(url);
    if (text && text.length > 200) return text.slice(0, 15000);
    return null;
  } catch {
    return null;
  }
}

async function fetchUrlContent(url: string): Promise<string | null> {
  const grantData = await lookupGrantByUrl(url);
  if (grantData) return grantData;

  if (isLinkedInUrl(url)) {
    const jinaContent = await fetchWithJinaReader(url);
    if (jinaContent) return `[תוכן לינקדאין מ-${url}]\n${jinaContent}`;
    return `[לא הצלחתי לקרוא את דף הלינקדאין. לינקדאין חוסם קריאה ישירה — בקש מהמשתמש להעתיק את הטקסט מהדף.]`;
  }

  // gov.il and other heavily blocked government sites — go straight to Gemini Grounding
  if (isGovUrl(url)) {
    const geminiContent = await fetchWithGemini(url);
    if (geminiContent) return `[תוכן ממשלתי מ-${url} (אוחזר דרך Gemini Search)]\n${geminiContent}`;
    // Fallback to Jina
    const jinaContent = await fetchWithJinaReader(url);
    if (jinaContent) return jinaContent;
    return `[אתר ממשלתי חסום: ${url}. קריאה ישירה נכשלה ו-Gemini Grounding לא החזיר תוכן. הערה לגולדפיש: חפש את שם הקול הקורא ב-web search כדי למצוא מידע עדכני — אל תבקש מהמשתמש לחפש.]`;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/pdf,*/*;q=0.8',
        'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const jinaContent = await fetchWithJinaReader(url);
      if (jinaContent) return jinaContent;
      const geminiContent = await fetchWithGemini(url);
      if (geminiContent) return geminiContent;
      return `[שגיאה: ${res.status} ${res.statusText}]`;
    }

    const contentType = res.headers.get('content-type') || '';

    if (contentType.includes('pdf') || /\.pdf(\?|$|#)/i.test(url)) {
      const buffer = Buffer.from(await res.arrayBuffer());
      const pdfText = await parsePdfBuffer(buffer);
      if (pdfText.length > 30) {
        return `[תוכן PDF מ-${url}]\n${pdfText.slice(0, 15000)}`;
      }
      return `[PDF שלא הצלחתי לחלץ ממנו טקסט. ייתכן ומדובר ב-PDF סרוק. בקש מהמשתמש להעתיק את הטקסט ידנית.]`;
    }

    if (contentType.includes('wordprocessingml') || contentType.includes('msword') || /\.docx?(\?|$|#)/i.test(url)) {
      const buffer = Buffer.from(await res.arrayBuffer());
      const docxText = await parseDocxBuffer(buffer);
      if (docxText.length > 30) {
        return `[תוכן Word מ-${url}]\n${docxText.slice(0, 15000)}`;
      }
      return `[לא הצלחתי לחלץ טקסט מקובץ Word.]`;
    }

    if (contentType.match(/image|video|audio|octet-stream|zip/)) {
      return `[קובץ בינארי: ${contentType}. לא ניתן לקריאה.]`;
    }

    const text = await res.text();

    if (contentType.includes('json')) {
      return text.slice(0, 12000);
    }

    if (contentType.includes('html')) {
      const cleaned = stripHtml(text);
      if (cleaned.length < 500) {
        const jinaContent = await fetchWithJinaReader(url);
        if (jinaContent) return jinaContent;
      }
      if (cleaned.length < 100) {
        return `[הלינק ${url} הוא אתר דינמי (SPA) שלא ניתן לקריאה ישירה. הערה לגולדפיש: חפש את שם הקול הקורא / הגוף המממן מה-URL ב-web search כדי למצוא מידע עדכני — אל תבקש מהמשתמש לחפש.]`;
      }
      return cleaned.slice(0, 12000);
    }

    return text.slice(0, 12000);
  } catch (e) {
    const jinaContent = await fetchWithJinaReader(url);
    if (jinaContent) return jinaContent;
    const geminiContent = await fetchWithGemini(url);
    if (geminiContent) return geminiContent;
    return `[לא הצלחתי לקרוא את הלינק: ${e instanceof Error ? e.message : 'שגיאה'}]`;
  }
}

export async function fetchUrls(message: string): Promise<FetchedUrl[]> {
  const urls = message.match(URL_REGEX);
  if (!urls || urls.length === 0) return [];

  const unique = [...new Set(urls)].slice(0, 3);
  const results: FetchedUrl[] = [];

  await Promise.all(
    unique.map(async (url) => {
      const content = await fetchUrlContent(url);
      if (content && content.length > 50) {
        results.push({ url, content });
      } else if (content) {
        results.push({
          url,
          content: `[הלינק ${url} החזיר תוכן חלקי בלבד — כנראה אתר דינמי (SPA). תוכן שנקרא: "${content.slice(0, 300)}". הערה לגולדפיש: השתמש ב-web search כדי למצוא מידע נוסף על הקול הקורא / הגוף המממן מה-URL — אל תבקש מהמשתמש לחפש בעצמו.]`,
        });
      }
    })
  );

  return results;
}

export function formatUrlsForMessage(fetched: FetchedUrl[]): string {
  if (fetched.length === 0) return '';
  const parts = fetched.map((f) => `\n[תוכן מהלינק ${f.url}]:\n${f.content}`);
  return '\n\nתוכן שנקרא מלינקים בהודעה:' + parts.join('\n');
}
