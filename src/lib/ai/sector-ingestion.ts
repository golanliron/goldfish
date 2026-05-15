// Goldfish — Sector Knowledge Ingestion Pipeline
// Scrapes sector URLs, extracts summaries + insights via Gemini, stores in knowledge_chunks (RAG)
// Multi-tenant: knowledge is shared across all orgs (sector-level, not org-specific)

import { upsertChunk } from './rag';
import { geminiCall } from './gemini';
import { createAdminClient } from '@/lib/supabase/admin';

// ===== Source Registry =====

export interface SectorSource {
  name: string;
  url: string;
  category: 'sector_knowledge' | 'grants_intel' | 'funder_intel' | 'research' | 'news';
  subcategory?: string;
  lang?: 'he' | 'en';
}

// Core sources — Israeli nonprofit sector knowledge
export const SECTOR_SOURCES: SectorSource[] = [
  // Knowledge centers
  { name: 'שתיל — מרכז ידע', url: 'https://shatil.org.il/knowledge/', category: 'sector_knowledge', subcategory: 'nonprofit_management', lang: 'he' },
  { name: 'גיידסטאר ישראל — מגמות', url: 'https://www.guidestar.org.il/home', category: 'sector_knowledge', subcategory: 'sector_data', lang: 'he' },
  { name: 'מאלה — אחריות תאגידית', url: 'https://www.maala.org.il/', category: 'funder_intel', subcategory: 'csr', lang: 'he' },
  { name: 'מרכז טאוב — מחקרי רווחה', url: 'https://www.taubcenter.org.il/', category: 'research', subcategory: 'social_policy', lang: 'he' },
  { name: 'המרכז לחינוך אזרחי', url: 'https://www.civiced.org.il/', category: 'sector_knowledge', subcategory: 'education', lang: 'he' },
  // Grant sources
  { name: 'מנהל הסיוע לאזרחים — קרן רווחה', url: 'https://www.btl.gov.il/', category: 'grants_intel', subcategory: 'government', lang: 'he' },
  { name: 'קרנות ומענקים — ארנה', url: 'https://arna.org.il/', category: 'grants_intel', subcategory: 'foundations', lang: 'he' },
  // English sources
  { name: 'Israel Philantropy Association', url: 'https://www.philanthropy.org.il/en/', category: 'sector_knowledge', subcategory: 'philanthropy', lang: 'en' },
  { name: 'Stanford Social Innovation Review', url: 'https://ssir.org/articles/category/nonprofits_and_ngos', category: 'research', subcategory: 'international', lang: 'en' },
  { name: 'Alliance Magazine — Israel', url: 'https://www.alliancemagazine.org/region/middle-east/', category: 'sector_knowledge', subcategory: 'philanthropy', lang: 'en' },
];

// ===== Fetch & Extract =====

async function fetchUrl(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; GoldfishBot/1.0; +https://goldfish.co.il)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'he,en;q=0.9',
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (e) {
    console.warn(`[sector-ingestion] fetch failed for ${url}:`, e);
    return '';
  }
}

function stripHtmlBasic(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s{3,}/g, '\n\n')
    .trim()
    .slice(0, 12000); // cap at 12K chars for Gemini
}

interface ExtractedKnowledge {
  title: string;
  executiveSummary: string;
  keyInsights: string[];
  dataPoints: string[];         // statistics, numbers, percentages
  relevantForGrants: boolean;   // is this useful for grant writing?
  yearContext: string | null;   // e.g. "2024", "2023-2024"
}

async function extractKnowledge(
  rawText: string,
  sourceName: string,
  lang: 'he' | 'en' = 'he'
): Promise<ExtractedKnowledge | null> {
  if (rawText.length < 200) return null;

  const langNote = lang === 'he' ? 'הטקסט בעברית. ענה בעברית.' : 'Text is in English. Answer in English.';

  const prompt = `אתה מומחה ניתוח תוכן למגזר השלישי. ${langNote}

מקור: "${sourceName}"
תוכן:
---
${rawText.slice(0, 8000)}
---

חלץ ידע שיעזור לכתיבת הגשות מענקים ולניתוח מגזר שלישי.
ענה ONLY ב-JSON:
{
  "title": "כותרת תמציתית (עד 80 תווים)",
  "executive_summary": "תקציר מנהלים של 3-4 משפטים — מה חשוב כאן",
  "key_insights": ["תובנה 1", "תובנה 2", "תובנה 3"],
  "data_points": ["נתון/סטטיסטיקה 1 עם מקור", "נתון 2"],
  "relevant_for_grants": true,
  "year_context": "2024"
}

אם התוכן לא רלוונטי למגזר שלישי/עמותות/גיוס משאבים — החזר null.
אל תמציא נתונים.`;

  try {
    const raw = await geminiCall(prompt, 500, 0.1);
    if (raw.trim() === 'null' || raw.trim() === '') return null;
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);

    return {
      title: parsed.title || sourceName,
      executiveSummary: parsed.executive_summary || '',
      keyInsights: parsed.key_insights?.filter(Boolean) || [],
      dataPoints: parsed.data_points?.filter(Boolean) || [],
      relevantForGrants: parsed.relevant_for_grants !== false,
      yearContext: parsed.year_context || null,
    };
  } catch {
    return null;
  }
}

// ===== Ingestion =====

export interface IngestionResult {
  source: string;
  status: 'success' | 'skipped' | 'error';
  chunksAdded: number;
  reason?: string;
}

async function isSourceFresh(sourceName: string, maxAgeDays = 25): Promise<boolean> {
  const supabase = createAdminClient();
  const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000).toISOString();

  const { data } = await supabase
    .from('knowledge_chunks')
    .select('updated_at')
    .eq('category', 'sector_knowledge')
    .ilike('title', `%${sourceName.slice(0, 30)}%`)
    .gt('updated_at', cutoff)
    .limit(1);

  return !!(data?.length);
}

/**
 * Ingest a single URL source into the knowledge_chunks RAG table.
 */
export async function ingestSource(source: SectorSource, force = false): Promise<IngestionResult> {
  // Skip if ingested recently (unless forced)
  if (!force) {
    const fresh = await isSourceFresh(source.name);
    if (fresh) {
      return { source: source.name, status: 'skipped', chunksAdded: 0, reason: 'fresh (<25 days)' };
    }
  }

  // Fetch URL
  const html = await fetchUrl(source.url);
  if (!html) {
    return { source: source.name, status: 'error', chunksAdded: 0, reason: 'fetch failed' };
  }

  const text = stripHtmlBasic(html);
  if (text.length < 200) {
    return { source: source.name, status: 'skipped', chunksAdded: 0, reason: 'content too short' };
  }

  // Extract knowledge via Gemini
  const knowledge = await extractKnowledge(text, source.name, source.lang);
  if (!knowledge || !knowledge.relevantForGrants) {
    return { source: source.name, status: 'skipped', chunksAdded: 0, reason: 'not relevant' };
  }

  // Build content block
  const contentLines: string[] = [knowledge.executiveSummary];
  if (knowledge.keyInsights.length) {
    contentLines.push('\nתובנות מפתח:');
    knowledge.keyInsights.forEach((ins, i) => contentLines.push(`${i + 1}. ${ins}`));
  }
  if (knowledge.dataPoints.length) {
    contentLines.push('\nנתונים וסטטיסטיקות:');
    knowledge.dataPoints.forEach(dp => contentLines.push(`- ${dp}`));
  }
  if (knowledge.yearContext) {
    contentLines.push(`\nהקשר זמני: ${knowledge.yearContext}`);
  }
  contentLines.push(`\nמקור: ${source.name} (${source.url})`);

  const chunkTitle = knowledge.yearContext
    ? `${knowledge.title} [${knowledge.yearContext}]`
    : knowledge.title;

  // Save to RAG
  await upsertChunk({
    category: source.category,
    subcategory: source.subcategory,
    title: chunkTitle,
    content: contentLines.join('\n'),
    metadata: {
      source_url: source.url,
      source_name: source.name,
      lang: source.lang || 'he',
      year_context: knowledge.yearContext,
      ingested_at: new Date().toISOString(),
    },
  });

  return { source: source.name, status: 'success', chunksAdded: 1 };
}

/**
 * Ingest all sources. Skips recently-ingested ones unless force=true.
 * Returns a summary of results.
 */
export async function ingestAllSources(
  sources: SectorSource[] = SECTOR_SOURCES,
  force = false
): Promise<{ total: number; success: number; skipped: number; errors: number; details: IngestionResult[] }> {
  const results: IngestionResult[] = [];

  // Process sequentially to avoid Gemini rate limits
  for (const source of sources) {
    try {
      const result = await ingestSource(source, force);
      results.push(result);
      console.log(`[sector-ingestion] ${source.name}: ${result.status} (${result.chunksAdded} chunks)`);
    } catch (e) {
      results.push({ source: source.name, status: 'error', chunksAdded: 0, reason: String(e) });
    }
    // Small delay between requests
    await new Promise(r => setTimeout(r, 800));
  }

  return {
    total: results.length,
    success: results.filter(r => r.status === 'success').length,
    skipped: results.filter(r => r.status === 'skipped').length,
    errors: results.filter(r => r.status === 'error').length,
    details: results,
  };
}

/**
 * Add a custom URL to the ingestion pipeline on-demand.
 * Used when admin wants to add a new source mid-month.
 */
export async function ingestCustomUrl(
  url: string,
  name: string,
  category: SectorSource['category'] = 'sector_knowledge',
  subcategory?: string
): Promise<IngestionResult> {
  return ingestSource({ name, url, category, subcategory, lang: 'he' }, true);
}
