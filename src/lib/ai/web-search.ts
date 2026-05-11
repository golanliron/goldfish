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
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match?.[1]) return match[1].trim();
  }

  return null;
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
