// Tavily Web Search — gives Goldfish live internet access
import { tavily, type TavilyClient } from '@tavily/core';

let _client: TavilyClient | null = null;
function getClient(): TavilyClient | null {
  if (!process.env.TAVILY_API_KEY) return null;
  if (!_client) _client = tavily({ apiKey: process.env.TAVILY_API_KEY });
  return _client;
}

export interface SearchResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

/**
 * Search the web for real-time information
 * Used when Goldfish needs current data about funders, grants, companies, or sector trends
 */
export async function webSearch(
  query: string,
  options?: {
    maxResults?: number;
    searchDepth?: 'basic' | 'advanced';
    includeDomains?: string[];
    topic?: 'general' | 'news';
  }
): Promise<SearchResult[]> {
  const client = getClient();
  if (!client) {
    console.warn('[web-search] TAVILY_API_KEY not set');
    return [];
  }

  try {
    const response = await client.search(query, {
      maxResults: options?.maxResults || 5,
      searchDepth: options?.searchDepth || 'basic',
      includeDomains: options?.includeDomains,
      topic: options?.topic || 'general',
    });

    return (response.results || []).map(r => ({
      title: r.title || '',
      url: r.url || '',
      content: r.content || '',
      score: r.score || 0,
    }));
  } catch (e) {
    console.error('[web-search] Error:', e);
    return [];
  }
}

/**
 * Detect if a user message needs a web search
 * Returns the search query if yes, null if no
 */
export function detectSearchIntent(message: string): string | null {
  const patterns = [
    // Direct search requests
    /(?:תחפש|חפש|חפשי|תמצא|מצא|תבדוק|בדוק)\s+(?:לי\s+)?(?:ב(?:אינטרנט|רשת|גוגל))?\s*(.+)/i,
    // Questions about current state
    /(?:מה (?:קורה|המצב|חדש|נשתנה) (?:עם|ב|אצל))\s+(.+)/i,
    // "What is" questions about external entities
    /(?:מי (?:זה|זאת|הם|הן)|מהי|מהו)\s+(.+?)(?:\?|$)/i,
    // Looking for info about specific orgs/companies/funds
    /(?:תביא|הבא|תן)\s+(?:לי\s+)?(?:מידע|פרטים|נתונים)\s+(?:על|לגבי|בנושא)\s+(.+)/i,
    // News and trends
    /(?:חדשות|עדכונים|מגמות|טרנדים)\s+(?:על|ב|בנושא|בתחום)\s+(.+)/i,
    // Questions about specific funders/foundations — "ספר לי על קרן X", "מה עושה קרן X"
    /(?:ספר|תספר)\s+(?:לי\s+)?(?:על|לגבי)\s+(.+)/i,
    /(?:מה|מי)\s+(?:עושה|עושים|היא|הם|זה)\s+(?:קרן|הקרן|ג'וינט|מכון|קק"ל|הפיס|מפעל)\s*(.+?)(?:\?|$)/i,
    // Asking about deadlines / when a grant opens
    /(?:מתי|אימתי)\s+(?:פותחים|יפתחו|יפרסמו|מפרסמים|דדליין)\s+(.+)/i,
    // Questions about amount / terms of a specific funder
    /(?:כמה|מה הסכום|מה התנאים|מה הדרישות)\s+(?:של|אצל|ב)\s+(.+)/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match?.[1]) return match[1].trim();
  }

  return null;
}

/**
 * Detect if message is asking about a specific funder — for targeted research
 * Returns the funder name if yes, null if no
 */
export function detectFunderQuery(message: string): string | null {
  // Known funder keywords — if mentioned + question words = research needed
  const funderIndicators = [
    'קרן', 'קק"ל', 'ג\'וינט', 'jdc', 'ג׳וינט', 'מפעל הפיס', 'עזריאלי', 'רוטשילד', 'יד הנדיב',
    'שוסטרמן', 'schusterman', 'רשי', 'rashi', 'מנדל', 'mandel', 'ברלוביץ', 'berelovitz',
    'מייברג', 'גוטסמן', 'סאקטה', 'אבי חי', 'avi chai', 'jim joseph', 'federation',
    'פדרציה', 'ujf', 'uja', 'jfna', 'joint', 'foundation', 'fund',
  ];

  const lowerMsg = message.toLowerCase();
  const hasFunderKeyword = funderIndicators.some(kw => lowerMsg.includes(kw.toLowerCase()));
  if (!hasFunderKeyword) return null;

  // Check for question context — not just mentioning a funder but asking about them
  const questionIndicators = ['מה', 'מי', 'ספר', 'בדוק', 'חפש', 'תחפש', 'אנחנו מתאימים', 'כמה נותנים', 'מתי', 'איך לפנות', 'דדליין', 'תנאים', 'דרישות', 'קול קורא', 'עדכני', 'חדש', 'פתוח'];
  const hasQuestion = questionIndicators.some(kw => lowerMsg.includes(kw.toLowerCase()));
  if (!hasQuestion) return null;

  // Extract the funder name from the message
  const extracted = detectSearchIntent(message);
  if (extracted) return extracted;

  // Fallback: return the full message trimmed as query
  return message.slice(0, 100);
}

/**
 * Format search results for inclusion in chat context
 */
export function formatSearchResults(results: SearchResult[]): string {
  if (!results.length) return '';

  const lines = results.map((r, i) =>
    `(${i + 1}) ${r.title}\n${r.content.slice(0, 300)}\nמקור: ${r.url}`
  );

  return `\n\n===== תוצאות חיפוש מהאינטרנט =====\n${lines.join('\n\n')}`;
}

/**
 * Search specifically for Israeli grants, foundations, and nonprofit sector
 */
export async function searchGrants(query: string): Promise<SearchResult[]> {
  return webSearch(`${query} קול קורא מענק עמותה ישראל`, {
    maxResults: 5,
    includeDomains: [
      'shatil.org.il',
      'guidestar.org.il',
      'molsa.gov.il',
      'education.gov.il',
      'mof.gov.il',
      'lottery.co.il',
      'jdc.org.il',
      'maala.org.il',
    ],
  });
}

/**
 * Build a smart search query from a failed/broken URL.
 * Extracts meaningful terms from the URL path and builds a targeted query.
 * For gov.il URLs, adds site:gov.il constraint and current year.
 */
export function buildQueryFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const isGov = /\.gov\.il/i.test(parsed.hostname);
    const isTmichot = /tmichot\.mof\.gov\.il/i.test(parsed.hostname);

    // Extract readable tokens from path + query params
    const pathTokens = parsed.pathname
      .split(/[\/\-_?=&%+]+/)
      .map(t => decodeURIComponent(t).replace(/\d{4,}/, '').trim()) // strip long IDs
      .filter(t => t.length > 2 && !/^(page|id|view|index|html|php|asp|aspx|default)$/i.test(t) && !/\.(aspx|php|html|asp)$/i.test(t));

    const paramTokens: string[] = [];
    parsed.searchParams.forEach((v) => {
      const decoded = decodeURIComponent(v).trim();
      if (decoded.length > 2 && decoded.length < 60 && !/^\d+$/.test(decoded)) {
        paramTokens.push(decoded);
      }
    });

    const allTokens = [...new Set([...pathTokens, ...paramTokens])].slice(0, 6);
    const currentYear = new Date().getFullYear();

    if (isTmichot) {
      return `site:mof.gov.il תמיכות ${allTokens.join(' ')} ${currentYear}`.trim();
    }
    if (isGov) {
      return `site:gov.il ${allTokens.join(' ')} קול קורא ${currentYear}`.trim();
    }

    return `${allTokens.join(' ')} קול קורא מענק ישראל ${currentYear}`.trim();
  } catch {
    return '';
  }
}

/**
 * Fallback search when a URL fetch failed.
 * Builds a focused query from the URL, runs Tavily, returns results + best URL found.
 */
export async function searchFallbackForUrl(url: string): Promise<{ results: SearchResult[]; bestUrl: string | null }> {
  const query = buildQueryFromUrl(url);
  if (!query) return { results: [], bestUrl: null };

  const isGov = /\.gov\.il/i.test(url);
  const results = await webSearch(query, {
    maxResults: 5,
    searchDepth: 'advanced',
    includeDomains: isGov
      ? ['gov.il', 'mof.gov.il', 'education.gov.il', 'molsa.gov.il', 'tmichot.mof.gov.il', 'shatil.org.il']
      : undefined,
  });

  // Pick the highest-scoring result URL that looks official
  const bestUrl = results.find(r => r.score > 0.5)?.url || results[0]?.url || null;

  return { results, bestUrl };
}

/**
 * Search for information about a specific company or foundation
 */
export async function searchCompany(name: string): Promise<SearchResult[]> {
  return webSearch(`"${name}" CSR תרומות אחריות חברתית ישראל`, {
    maxResults: 3,
    searchDepth: 'advanced',
  });
}
