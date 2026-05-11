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
 * Search for information about a specific company or foundation
 */
export async function searchCompany(name: string): Promise<SearchResult[]> {
  return webSearch(`"${name}" CSR תרומות אחריות חברתית ישראל`, {
    maxResults: 3,
    searchDepth: 'advanced',
  });
}
