import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const maxDuration = 120;
import { createAdminClient } from '@/lib/supabase/admin';
import { createGrantsClient } from '@/lib/supabase/grants-db';
import { FISHGOLD_SYSTEM_PROMPT, FISHGOLD_GRANT_EXPERTISE, FISHGOLD_FUNDER_WRITING_DNA, FISHGOLD_FUNDER_QUESTIONS, FISHGOLD_NONPROFITS_REFERENCE, FISHGOLD_NONPROFITS_PART2, FISHGOLD_GRANTS_INTELLIGENCE, FISHGOLD_ENGLISH_GRANTS, FISHGOLD_GRANT_MASTERY, FISHGOLD_BUDGET_INTELLIGENCE, FISHGOLD_SECTOR_KNOWLEDGE, FISHGOLD_BEHAVIOR_RULES, FISHGOLD_FUNDER_INTEL, FISHGOLD_PROPOSAL_GUIDE, FISHGOLD_SUBMISSION_ENGINE, FISHGOLD_COMPETITIVE_INTEL, FISHGOLD_FUNDRAISING_INTEL, buildContext, buildOrgContext } from '@/lib/ai/fishgold';
import { FEDERATION_INTELLIGENCE } from '@/lib/ai/federation-intelligence';
import { ISRAELI_FUNDERS_INTELLIGENCE } from '@/lib/ai/israeli-funders';
import { detectSearchIntent, detectFunderQuery, webSearch, searchCompany, searchGrants, formatSearchResults } from '@/lib/ai/web-search';
import { parseRfp, checkReadiness, assembleSubmission, generateOrgBlocks, formatReadinessReport } from '@/lib/ai/submission-engine';
import { fetchByRegistrationNumber, formatForContext, formatForProfile } from '@/lib/ai/guidestar';
import type { OrgBlock, OrgBlockType, RfpStructure } from '@/types';
// pdf-parse imported dynamically where needed to avoid serverless init failures

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ===== URL Detection & Fetching =====

const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi;

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
    const grantsDb = createGrantsClient();
    const { data: grant } = await grantsDb
      .from('grants')
      .select('title, description, funder, deadline, amount, categories, target_populations, regions, eligibility, url')
      .eq('url', url)
      .single();

    if (grant) {
      return [
        `[מידע על קול קורא מהמאגר]`,
        `כותרת: ${grant.title}`,
        grant.funder ? `גוף מממן: ${grant.funder}` : '',
        grant.deadline ? `דדליין: ${grant.deadline}` : '',
        grant.amount ? `סכום: עד ${(grant.amount / 1000).toFixed(0)}K ש"ח` : '',
        grant.categories?.length ? `קטגוריות: ${grant.categories.join(', ')}` : '',
        grant.target_populations?.length ? `אוכלוסיות: ${grant.target_populations.join(', ')}` : '',
        grant.regions?.length ? `אזורים: ${grant.regions.join(', ')}` : '',
        grant.eligibility ? `תנאי זכאות: ${grant.eligibility}` : '',
        grant.description ? `תיאור מלא: ${grant.description}` : '',
      ].filter(Boolean).join('\n');
    }

    // Try partial URL match (some URLs have tracking params)
    const baseUrl = url.split('?')[0];
    const { data: partialMatch } = await grantsDb
      .from('grants')
      .select('title, description, funder, deadline, amount, categories, target_populations, regions, eligibility, url')
      .ilike('url', `%${baseUrl.slice(-60)}%`)
      .limit(1)
      .single();

    if (partialMatch) {
      return [
        `[מידע על קול קורא מהמאגר]`,
        `כותרת: ${partialMatch.title}`,
        partialMatch.funder ? `גוף מממן: ${partialMatch.funder}` : '',
        partialMatch.deadline ? `דדליין: ${partialMatch.deadline}` : '',
        partialMatch.amount ? `סכום: עד ${(partialMatch.amount / 1000).toFixed(0)}K ש"ח` : '',
        partialMatch.categories?.length ? `קטגוריות: ${partialMatch.categories.join(', ')}` : '',
        partialMatch.target_populations?.length ? `אוכלוסיות: ${partialMatch.target_populations.join(', ')}` : '',
        partialMatch.regions?.length ? `אזורים: ${partialMatch.regions.join(', ')}` : '',
        partialMatch.eligibility ? `תנאי זכאות: ${partialMatch.eligibility}` : '',
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
    // Jina returns markdown-like text; if it's substantial, use it
    if (text.length > 200) return text.slice(0, 15000);
    return null;
  } catch {
    return null;
  }
}

// Parse PDF buffer with pdf-parse + Claude OCR fallback
async function parsePdfBuffer(buffer: Buffer): Promise<string> {
  try {
    const pdfParse = (await import('pdf-parse')).default;
    const result = await pdfParse(buffer);
    if (result.text && result.text.trim().length > 20) {
      return result.text;
    }
  } catch (e) {
    console.error('PDF parse error in chat, trying Claude fallback:', e);
  }

  // Fallback: Claude vision OCR
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

// Parse DOCX buffer with mammoth
async function parseDocxBuffer(buffer: Buffer): Promise<string> {
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

async function fetchUrlContent(url: string): Promise<string | null> {
  // Step 1: Always check grants DB first — fastest path
  const grantData = await lookupGrantByUrl(url);
  if (grantData) return grantData;

  // Step 2: LinkedIn — always use Jina Reader
  if (isLinkedInUrl(url)) {
    const jinaContent = await fetchWithJinaReader(url);
    if (jinaContent) return `[תוכן לינקדאין מ-${url}]\n${jinaContent}`;
    return `[לא הצלחתי לקרוא את דף הלינקדאין. לינקדאין חוסם קריאה ישירה — בקש מהמשתמש להעתיק את הטקסט מהדף.]`;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/pdf,*/*;q=0.8',
        'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const jinaContent = await fetchWithJinaReader(url);
      if (jinaContent) return jinaContent;
      return `[שגיאה: ${res.status} ${res.statusText}]`;
    }

    const contentType = res.headers.get('content-type') || '';

    // PDF — download and parse with pdf-parse + Claude OCR
    if (contentType.includes('pdf') || /\.pdf(\?|$|#)/i.test(url)) {
      const buffer = Buffer.from(await res.arrayBuffer());
      const pdfText = await parsePdfBuffer(buffer);
      if (pdfText.length > 30) {
        return `[תוכן PDF מ-${url}]\n${pdfText.slice(0, 15000)}`;
      }
      return `[PDF שלא הצלחתי לחלץ ממנו טקסט. ייתכן ומדובר ב-PDF סרוק. בקש מהמשתמש להעתיק את הטקסט ידנית.]`;
    }

    // DOCX — download and parse with mammoth
    if (contentType.includes('wordprocessingml') || contentType.includes('msword') || /\.docx?(\?|$|#)/i.test(url)) {
      const buffer = Buffer.from(await res.arrayBuffer());
      const docxText = await parseDocxBuffer(buffer);
      if (docxText.length > 30) {
        return `[תוכן Word מ-${url}]\n${docxText.slice(0, 15000)}`;
      }
      return `[לא הצלחתי לחלץ טקסט מקובץ Word.]`;
    }

    // Other binary — skip
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
        return `[הלינק ${url} הוא אתר דינמי (SPA) שלא ניתן לקריאה ישירה. בקש מהמשתמש להעתיק את הטקסט המלא מהדף ולשלוח בצ'אט, או להוריד כ-PDF ולהעלות.]`;
      }
      return cleaned.slice(0, 12000);
    }

    return text.slice(0, 12000);
  } catch (e) {
    const jinaContent = await fetchWithJinaReader(url);
    if (jinaContent) return jinaContent;
    return `[לא הצלחתי לקרוא את הלינק: ${e instanceof Error ? e.message : 'שגיאה'}]`;
  }
}

interface FetchedUrl {
  url: string;
  content: string;
}

async function fetchUrls(message: string): Promise<FetchedUrl[]> {
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
        // SPA or minimal content — still return with note
        results.push({
          url,
          content: `[הלינק ${url} לא נפתח כמו שצריך — כנראה אתר דינמי (SPA) או דף שדורש ניווט ידני. התוכן שנקרא: "${content.slice(0, 300)}". בקש מהמשתמש להוריד את המסמך כ-PDF ולהעלות, או להעתיק את הטקסט המלא ולשלוח בצ'אט. אל תנסה לכתוב הגשה בלי המידע המלא.]`,
        });
      }
    })
  );

  return results;
}

function formatUrlsForMessage(fetched: FetchedUrl[]): string {
  if (fetched.length === 0) return '';
  const parts = fetched.map((f) => `\n[תוכן מהלינק ${f.url}]:\n${f.content}`);
  return '\n\nתוכן שנקרא מלינקים בהודעה:' + parts.join('\n');
}

// ===== Auto-learn from URLs: extract org data and save =====

async function learnFromUrls(
  supabase: ReturnType<typeof createAdminClient>,
  orgId: string,
  fetched: FetchedUrl[]
) {
  if (fetched.length === 0) return;

  for (const { url, content } of fetched) {
    // Skip error messages
    if (content.startsWith('[')) continue;
    if (content.length < 100) continue;

    // 1. Extract structured org data with AI
    try {
      const res = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        system: `אתה מנתח תוכן מאתרי אינטרנט של ארגונים ועמותות.
חלץ מהטקסט הבא כמה שיותר מידע מובנה על הארגון.
החזר JSON תקין בלבד עם השדות הרלוונטיים:
- name: שם הארגון
- registration_number: מספר עמותה (אם יש)
- mission: מטרת הארגון (משפט-שניים)
- focus_areas: מערך תחומי פעילות
- regions: מערך אזורי פעילות
- beneficiaries_count: מספר מוטבים (אם מצוין)
- annual_budget: תקציב שנתי (אם מצוין)
- employees_count: מספר עובדים (אם מצוין)
- active_projects: מערך של {name, description}
- key_achievements: מערך הישגים
- content_type: "org_website" | "call_for_proposals" | "article" | "other"
- summary: סיכום קצר של מה שנמצא בלינק

אם זה לא אתר של ארגון (למשל קול קורא או כתבה), עדיין מלא content_type ו-summary.
החזר רק JSON תקין, בלי טקסט נוסף.`,
        messages: [{ role: 'user', content: content.slice(0, 6000) }],
        max_tokens: 1000,
      });

      const raw = res.content[0].type === 'text' ? res.content[0].text : '{}';
      const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, raw];
      const extracted = JSON.parse(jsonMatch[1]!.trim()) as Record<string, unknown>;

      // 2. Save as document for RAG
      const { data: doc } = await supabase
        .from('documents')
        .insert({
          org_id: orgId,
          filename: `url_${new URL(url).hostname}`,
          file_type: 'url',
          storage_path: url,
          category: extracted.content_type === 'org_website' ? 'identity' : 'other',
          parsed_text: content.slice(0, 50000),
          metadata: { url, ...extracted },
          status: 'ready',
        })
        .select('id')
        .single();

      if (doc) {
        // Save chunks for RAG
        const chunks = chunkText(content);
        for (const chunk of chunks) {
          await supabase.from('document_chunks').insert({
            document_id: doc.id,
            org_id: orgId,
            content: chunk,
            metadata: { url, source: 'url_scan', content_type: extracted.content_type },
          });
        }
      }

      // 3. If it's an org website, update org_profile
      if (extracted.content_type === 'org_website') {
        const { data: existing } = await supabase
          .from('org_profiles')
          .select('data')
          .eq('org_id', orgId)
          .single();

        const current = (existing?.data as Record<string, unknown>) || {};
        const merged = { ...current };

        // Merge new data — only overwrite if currently empty
        for (const key of [
          'name',
          'registration_number',
          'mission',
          'focus_areas',
          'regions',
          'beneficiaries_count',
          'annual_budget',
          'employees_count',
          'key_achievements',
        ]) {
          if (extracted[key] && !merged[key]) {
            merged[key] = extracted[key];
          }
        }

        // Append projects
        if (Array.isArray(extracted.active_projects)) {
          const existingProjects = (merged.active_projects as unknown[]) || [];
          merged.active_projects = [...existingProjects, ...(extracted.active_projects as unknown[])];
        }

        await supabase.from('org_profiles').upsert(
          {
            org_id: orgId,
            data: merged,
            last_updated: new Date().toISOString(),
          },
          { onConflict: 'org_id' }
        );
      }
    } catch (err) {
      console.error('learnFromUrls error for', url, ':', err instanceof Error ? err.message : err);
    }
  }
}

function chunkText(text: string, maxChars: number = 2000): string[] {
  const paragraphs = text.split(/\n\n+/);
  const chunks: string[] = [];
  let current = '';

  for (const para of paragraphs) {
    if ((current + para).length > maxChars && current.length > 0) {
      chunks.push(current.trim());
      current = para;
    } else {
      current += (current ? '\n\n' : '') + para;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.length > 0 ? chunks : [text.slice(0, maxChars)];
}

// ===== Knowledge & RAG Loading =====

async function loadAllChunks(
  supabase: ReturnType<typeof createAdminClient>,
  orgId: string,
  message: string,
  activeTab?: string
): Promise<{ knowledge: string; rag: string; docSummary: string }> {
  const isOrgTab = activeTab === 'org';
  try {
    // Load ALL documents list (for completeness awareness)
    const { data: allDocs } = await supabase
      .from('documents')
      .select('id, filename, category, file_type, parsed_text, created_at, metadata')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false });

    let docSummary = '';
    if (allDocs?.length) {
      // Build a rich summary of ALL documents Goldfish has access to
      const docLines = allDocs.map(d => {
        const meta = (d.metadata || {}) as Record<string, unknown>;
        const summary = (meta.summary as string) || '';
        const insights = (meta.insights as string) || '';
        const missingInfo = Array.isArray(meta.missing_info) ? (meta.missing_info as string[]).join(', ') : '';
        // Use AI summary + insights first (more valuable than raw text), then raw preview
        const aiContext = [summary, insights, missingInfo ? `חסר: ${missingInfo}` : ''].filter(Boolean).join('\n');
        // For org tab: short preview. For other tabs: use AI summary only (saves space for all docs to fit)
        const preview = aiContext || (d.parsed_text ? d.parsed_text.slice(0, 400) : '');
        return `[${d.category || 'other'}] ${d.filename} (id: ${d.id})${preview ? `:\n${preview}` : ''}`;
      });
      docSummary = `\n\n===== כל המסמכים שקראת (${allDocs.length} מסמכים) =====
כשמישהו מבקש מסמך — תן לינק הורדה בפורמט: [שם הקובץ](/api/documents/ID/download)
דוגמה: [דוח כספי 2025.pdf](/api/documents/abc-123/download)
\n${docLines.join('\n\n')}`;

      // Truncate if too long, but keep as much as possible
      if (docSummary.length > 60000) {
        docSummary = docSummary.slice(0, 60000) + '\n[... עוד מסמכים]';
      }

      // ===== Document Alerts: expired, expiring, missing =====
      const now = new Date();
      const alertLines: string[] = [];

      // Check expiry dates
      allDocs.forEach(d => {
        const meta = (d.metadata || {}) as Record<string, unknown>;
        const validUntil = meta.valid_until as string | undefined;
        if (validUntil) {
          const expDate = new Date(validUntil);
          const daysLeft = Math.floor((expDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
          const docType = (meta.doc_type as string) || d.filename;
          if (daysLeft < 0) {
            alertLines.push(`🔴 פג תוקף: ${docType} (פג ב-${validUntil})`);
          } else if (daysLeft < 90) {
            alertLines.push(`🟡 עומד לפוג: ${docType} (בעוד ${daysLeft} ימים, ${validUntil})`);
          }
        }
      });

      // Check required documents
      const REQUIRED_DOCS = [
        { pattern: /ניהול תקין/i, label: 'אישור ניהול תקין' },
        { pattern: /סעיף 46|saif.?46/i, label: 'אישור סעיף 46' },
        { pattern: /ניכוי מס/i, label: 'אישור ניכוי מס' },
        { pattern: /רישום עמותה|תעודת רישום/i, label: 'תעודת רישום עמותה' },
        { pattern: /דוח כספי|כספי.*מבוקר/i, label: 'דוח כספי מבוקר' },
        { pattern: /תקציב.*מאושר|מאושר.*תקציב/i, label: 'תקציב מאושר' },
        { pattern: /מילולי|דוח פעילות/i, label: 'דוח מילולי / דוח פעילות' },
        { pattern: /ניהול ספרים/i, label: 'אישור ניהול ספרים' },
      ];

      const docTexts = allDocs.map(d => {
        const meta = (d.metadata || {}) as Record<string, unknown>;
        return `${d.filename} ${(meta.doc_type as string) || ''} ${(meta.summary as string) || ''}`;
      });

      REQUIRED_DOCS.forEach(req => {
        const found = docTexts.some(t => req.pattern.test(t));
        if (!found) {
          alertLines.push(`⚪ חסר: ${req.label}`);
        }
      });

      if (alertLines.length > 0) {
        docSummary += `\n\n===== התראות מסמכים =====
${alertLines.join('\n')}

**חובה:** כשהמשתמש שואל על הגשות, מסמכים, או מוכנות — ציין את ההתראות הללו.
אם יש מסמכים שפג תוקפם או עומדים לפוג — הזהר את המשתמש באופן יזום.
אם חסרים מסמכים בסיסיים — ציין אילו חסרים ומדוע הם נדרשים.`;
      }
    }

    // Load knowledge base chunks (always)
    const { data: kbChunks } = await supabase
      .from('document_chunks')
      .select('content, metadata')
      .eq('org_id', orgId)
      .eq('metadata->>source', 'knowledge_base')
      .order('created_at');

    let knowledge = '';
    if (kbChunks?.length) {
      const parts = kbChunks.map(
        (c) => `### ${(c.metadata as Record<string, string>)?.title || 'מידע'}\n${c.content}`
      );
      knowledge = '\n\n===== בסיס ידע ארגוני =====\n' + parts.join('\n\n');
    }

    // RAG: search relevant non-knowledge chunks
    let rag = '';

    // If message references specific document_ids (from file upload), load those chunks first
    const docIdMatch = message.match(/\[document_ids:\s*([^\]]+)\]/);
    if (docIdMatch) {
      const docIds = docIdMatch[1].split(',').map(id => id.trim()).filter(Boolean);
      if (docIds.length > 0) {
        const { data: docChunks } = await supabase
          .from('document_chunks')
          .select('content, metadata')
          .eq('org_id', orgId)
          .in('document_id', docIds)
          .limit(30);

        if (docChunks?.length) {
          rag = buildContext(docChunks);
        }
      }
    }

    // Also search by keywords
    const STOP_WORDS = new Set(['של', 'את', 'על', 'עם', 'אני', 'הוא', 'היא', 'זה', 'מה', 'איך', 'אם', 'כי', 'לא', 'כן', 'גם', 'אבל', 'או', 'יש', 'אין', 'רוצה', 'צריך', 'יכול', 'בבקשה', 'תודה', 'שלום']);
    const cleanMessage = message.replace(/\[document_ids:[^\]]+\]/g, '');
    const keywords = cleanMessage
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
      .slice(0, 8)
      .join(' & ');

    if (keywords) {
      const { data: chunks } = await supabase
        .from('document_chunks')
        .select('content, metadata')
        .eq('org_id', orgId)
        .neq('metadata->>source', 'knowledge_base')
        .textSearch('content', keywords, { type: 'plain' })
        .limit(12);

      if (chunks?.length) {
        rag = rag ? rag + '\n\n' + buildContext(chunks) : buildContext(chunks);
      }
    }

    // Fallback: recent document chunks (load more)
    if (!rag) {
      const { data: recent } = await supabase
        .from('document_chunks')
        .select('content, metadata')
        .eq('org_id', orgId)
        .neq('metadata->>source', 'knowledge_base')
        .order('created_at', { ascending: false })
        .limit(15);

      if (recent?.length) {
        rag = buildContext(recent);
      }
    }

    // Always load ALL document chunks so Goldfish knows the org in every tab
    const chunkLimit = isOrgTab ? 80 : 50;
    const { data: allChunks } = await supabase
      .from('document_chunks')
      .select('content, metadata')
      .eq('org_id', orgId)
      .neq('metadata->>source', 'knowledge_base')
      .order('created_at', { ascending: false })
      .limit(chunkLimit);
    if (allChunks?.length) {
      const allContext = buildContext(allChunks);
      rag = rag
        ? rag + '\n\n===== כל המסמכים של הארגון =====\n' + allContext
        : '\n\n===== כל המסמכים של הארגון =====\n' + allContext;
    }

    return { knowledge, rag, docSummary };
  } catch {
    return { knowledge: '', rag: '', docSummary: '' };
  }
}

// ===== Submission Engine Integration =====

const RFP_PARSE_KEYWORDS = ['נתח קול קורא', 'נתח את הקול קורא', 'תנתח קול קורא', 'תנתח את זה', 'בדוק מוכנות', 'בדיקת מוכנות', 'בדוק התאמה', 'האם אנחנו מתאימים', 'תבדוק אם מתאים', 'parse rfp', 'analyze rfp'];

function userAsksForRfpParse(message: string): boolean {
  return RFP_PARSE_KEYWORDS.some((kw) => message.toLowerCase().includes(kw.toLowerCase()));
}

async function loadOrgBlocks(
  supabase: ReturnType<typeof createAdminClient>,
  orgId: string,
  projectId?: string
): Promise<OrgBlock[]> {
  const { data } = await supabase
    .from('org_blocks')
    .select('*')
    .eq('org_id', orgId)
    .order('block_type');

  if (!data?.length) return [];

  return data.map((row: Record<string, unknown>) => ({
    id: row.id as string,
    org_id: row.org_id as string,
    block_type: row.block_type as OrgBlockType,
    project_id: row.project_id as string | undefined,
    content: {
      mini: (row.content_mini as string) || '',
      standard: (row.content_standard as string) || '',
      extended: (row.content_extended as string) || '',
    },
    metadata: (row.metadata as Record<string, unknown>) || {},
    last_updated: (row.last_updated as string) || new Date().toISOString(),
    auto_generated: (row.auto_generated as boolean) ?? true,
  }));
}

async function saveOrgBlocks(
  supabase: ReturnType<typeof createAdminClient>,
  orgId: string,
  blocks: Partial<Record<OrgBlockType, OrgBlock>>
): Promise<void> {
  for (const [blockType, block] of Object.entries(blocks)) {
    if (!block) continue;
    await supabase
      .from('org_blocks')
      .upsert({
        org_id: orgId,
        block_type: blockType,
        content_mini: block.content.mini,
        content_standard: block.content.standard,
        content_extended: block.content.extended,
        metadata: block.metadata || {},
        auto_generated: block.auto_generated ?? true,
        last_updated: new Date().toISOString(),
      }, { onConflict: 'org_id,block_type,COALESCE(project_id, \'__org__\')' })
      .then(undefined, (err: unknown) => {
        // Fallback: try without onConflict — delete + insert
        console.error('Upsert failed, trying delete+insert:', err);
        return supabase
          .from('org_blocks')
          .delete()
          .eq('org_id', orgId)
          .eq('block_type', blockType)
          .is('project_id', null)
          .then(() =>
            supabase.from('org_blocks').insert({
              org_id: orgId,
              block_type: blockType,
              content_mini: block.content.mini,
              content_standard: block.content.standard,
              content_extended: block.content.extended,
              metadata: block.metadata || {},
              auto_generated: block.auto_generated ?? true,
              last_updated: new Date().toISOString(),
            })
          );
      });
  }
}

async function saveRfpParsed(
  supabase: ReturnType<typeof createAdminClient>,
  orgId: string,
  rfp: RfpStructure
): Promise<string | null> {
  const { data } = await supabase
    .from('rfp_parsed')
    .insert({
      org_id: orgId,
      funder_name: rfp.funder_name,
      funder_type: rfp.funder_type,
      rfp_title: rfp.rfp_title,
      deadline: rfp.deadline || null,
      max_amount: rfp.max_amount || null,
      questions: rfp.questions,
      required_documents: rfp.required_documents,
      eligibility: rfp.eligibility,
      evaluation_criteria: rfp.evaluation_criteria || [],
      raw_text: rfp.raw_text?.slice(0, 50000) || null,
    })
    .select('id')
    .single();

  return (data as { id: string } | null)?.id || null;
}

// ===== Grant Writing Detection & Full Document Loading =====

const GRANT_WRITING_KEYWORDS = ['תכתוב הגשה', 'כתוב הגשה', 'טיוטת הגשה', 'תכין הצעה', 'כתוב הצעה', 'תכתוב הצעה', 'תתחיל לכתוב', 'כן תכתוב', 'כתוב טיוטה', 'תכין טיוטה', 'כתוב proposal', 'write proposal', 'write grant', 'כתוב LOI', 'תכתוב LOI', 'מכתב פנייה', 'letter of inquiry'];

function userAsksForGrantWriting(message: string): boolean {
  return GRANT_WRITING_KEYWORDS.some((kw) => message.toLowerCase().includes(kw.toLowerCase()));
}

async function loadFullDocumentsForGrantWriting(
  supabase: ReturnType<typeof createAdminClient>,
  orgId: string
): Promise<string> {
  try {
    // Load ALL document full texts — grant writing needs complete data
    const { data: docs } = await supabase
      .from('documents')
      .select('filename, category, parsed_text, metadata')
      .eq('org_id', orgId)
      .in('category', ['identity', 'budget', 'project', 'impact', 'submission'])
      .order('created_at', { ascending: false })
      .limit(10);

    if (!docs?.length) return '';

    const parts = docs.map(d => {
      const meta = (d.metadata || {}) as Record<string, unknown>;
      const text = d.parsed_text || '';
      const insights = (meta.insights as string) || '';
      return `\n--- ${d.filename} [${d.category}] ---\n${text.slice(0, 15000)}${insights ? `\n\nתובנות AI: ${insights}` : ''}`;
    });

    let fullContext = `\n\n===== מסמכים מלאים לכתיבת הגשה =====\nלהלן כל המסמכים הרלוונטיים של הארגון בשלמותם. השתמש בכל הנתונים, המספרים, והפרטים מהמסמכים האלה כשאתה כותב את ההגשה:\n${parts.join('\n')}`;

    // Cap at 80K chars — leave room for other context
    if (fullContext.length > 80000) {
      fullContext = fullContext.slice(0, 80000) + '\n[... חלק מהמסמכים נחתכו]';
    }

    return fullContext;
  } catch {
    return '';
  }
}

// ===== Opportunity Scanning =====

const SCAN_KEYWORDS = ['קול קורא', 'קולות קוראים', 'הזדמנויות', 'מענק', 'מענקים', 'מימון', 'תמצא לי', 'יש משהו בשבילי', 'סרוק', 'חפש לי'];

function userAsksForOpportunities(message: string): boolean {
  return SCAN_KEYWORDS.some((kw) => message.includes(kw));
}

async function scanOpportunities(
  supabase: ReturnType<typeof createAdminClient>,
  orgId: string,
  profileData: Record<string, unknown> | null,
  orgName: string | null,
  userMessage?: string
): Promise<string> {
  if (!profileData || Object.keys(profileData).length < 3) {
    return '';
  }

  const forceRescan = userMessage ? userAsksForOpportunities(userMessage) : false;

  // Check if we already have recent matches (last 24h) — unless user explicitly asks
  if (!forceRescan) {
    const { data: recentMatches } = await supabase
      .from('matches')
      .select('id')
      .eq('org_id', orgId)
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .limit(1);

    if (recentMatches && recentMatches.length > 0) {
      // Load existing matches and enrich from grants DB
      const { data: matches } = await supabase
        .from('matches')
        .select('score, reasoning, opportunity_id')
        .eq('org_id', orgId)
        .gte('score', 70)
        .order('score', { ascending: false })
        .limit(5);

      if (matches && matches.length > 0) {
        // Fetch grant details from the shared grants DB
        const grantsDb = createGrantsClient();
        const oppIds = matches.map(m => m.opportunity_id);
        const { data: grants } = await grantsDb
          .from('grants')
          .select('id, title, deadline, funder, url, description, amount')
          .in('id', oppIds);

        const grantsMap = new Map((grants || []).map(g => [g.id, g]));

        const lines = matches.map((m) => {
          const opp = grantsMap.get(m.opportunity_id);
          if (!opp) return null;
          return `- **${opp.title}** (ציון: ${m.score}/100)${opp.deadline ? ` | דדליין: ${opp.deadline}` : ''}${opp.funder ? ` | ${opp.funder}` : ''}${opp.amount ? ` | עד ${(opp.amount / 1000).toFixed(0)}K ש"ח` : ''}${opp.url ? ` | לינק: ${opp.url}` : ''}\n  ${m.reasoning}${opp.description ? `\n  תיאור: ${opp.description.slice(0, 200)}` : ''}`;
        }).filter(Boolean);

        if (lines.length > 0) {
          return `\n\n===== הזדמנויות מתאימות =====\nמצאתי ${lines.length} קולות קוראים שמתאימים:\n${lines.join('\n')}`;
        }
      }
      return '';
    }
  }

  // Run a fresh scan — query the shared grants database (updated daily by scanner)
  try {
    const today = new Date().toISOString().split('T')[0];
    const grantsDb = createGrantsClient();
    const { data: opportunities, error: oppError } = await grantsDb
      .from('grants')
      .select('id, title, description, deadline, categories, target_populations, funder, url')
      .eq('is_database', true)
      .or(`deadline.is.null,deadline.gte.${today}`)
      .order('deadline', { ascending: true, nullsFirst: false })
      .limit(60);

    if (oppError) {
      console.error('Opportunities query error:', oppError);
      return '';
    }
    if (!opportunities || opportunities.length === 0) {
      console.log('No opportunities found');
      return '';
    }
    console.log(`Scan: found ${opportunities.length} active opportunities`);

    // Pre-filter by category/population overlap
    const focusAreas = (profileData.focus_areas as string[]) || [];
    const mission = (profileData.mission as string) || '';
    const orgText = [...focusAreas, mission].join(' ');

    const catKeywords: Record<string, string> = {
      education: 'חינוך|לימוד|נשירה|מלגות|הכשרה',
      welfare: 'רווחה|סיכון|ליווי|נוער|צעירים',
      community: 'קהילה|חברה|התנדבות',
      employment: 'תעסוקה|עבודה|הכוונה',
      health: 'בריאות|נפשי|רפואה',
    };

    const orgCats = Object.entries(catKeywords)
      .filter(([, pattern]) => new RegExp(pattern).test(orgText))
      .map(([cat]) => cat);

    const filtered = opportunities.filter((opp) => {
      if (!opp.categories?.length) return true;
      return opp.categories.some((c: string) => orgCats.includes(c));
    }).slice(0, 15);

    if (filtered.length === 0) return '';

    // AI scoring — enrich with org memory for better matching
    const { data: memories } = await supabase
      .from('org_memory')
      .select('key, value')
      .eq('org_id', orgId)
      .limit(30);
    const orgContext = buildOrgContext(profileData, orgName, memories || undefined);
    const oppList = filtered.map((o, i) =>
      `${i + 1}. "${o.title}" | קטגוריות: ${o.categories?.join(', ') || '-'} | אוכלוסיות: ${o.target_populations?.join(', ') || '-'} | דדליין: ${o.deadline || '-'} | גוף: ${o.funder || '-'}${o.description ? ` | תיאור: ${o.description.slice(0, 150)}` : ''}`
    ).join('\n');

    const res = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      system: `אתה מומחה גיוס משאבים ישראלי. דרג כל קול קורא 1-10 לפי התאמה ספציפית לארגון.
קרא בעיון את נתוני הליבה של הארגון וודא שאתה מבין מה הם באמת עושים לפני שאתה נותן ציון.
קריטריונים: תחום פעילות (30%), אוכלוסיית יעד (30%), גיאוגרפיה (25%), גודל ארגון (15%).

כללים קריטיים:
- קרנות וגופים שפועלים מחוץ לישראל ולא מממנים פעילות בישראל = ציון 1-2 מקסימום.
- אם הקול קורא מיועד לאוכלוסייה אחרת לגמרי (למשל קשישים כשהארגון עובד עם צעירים, או פנימיות כשהארגון עובד בקהילה) = ציון 1-3.
- "education" או "welfare" כקטגוריה רחבה לא מספיקה. חייב חפיפה ממשית בתחום הספציפי.
- קול קורא בתחום שונה מהותית (חקלאות, מים, סביבה, מדע, תשתיות, בנייה, ארכיטקטורה) לעומת הארגון = ציון 1-3 גם אם יש מילה משותפת.
- קול קורא למוסדות חינוך פיזיים (בנייה, שיפוץ, תכנון) כשהארגון מספק ליווי ושירותים = ציון 1-3.
- ציון 8+ רק כשיש התאמה ממשית בתחום + אוכלוסייה + גיאוגרפיה + סוג פעילות.
- שאל את עצמך: האם הארגון הזה באמת יכול להגיש ולנצח? אם לא — ציון נמוך.
החזר JSON בלבד: [{"index": 1, "score": 8, "reasoning": "נימוק קצר"}]
רק ציון 7 ומעלה. אם אין — מערך ריק [].`,
      messages: [{ role: 'user', content: `${orgContext}\n\nקולות קוראים:\n${oppList}` }],
      max_tokens: 1500,
    });

    const raw = res.content[0].type === 'text' ? res.content[0].text : '[]';
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, raw];
    let scored: { index: number; score: number; reasoning: string }[] = [];
    try {
      scored = JSON.parse(jsonMatch[1]!.trim());
    } catch {
      return '';
    }

    // Save matches and build context
    const goodMatches = scored.filter((s) => s.score >= 7);
    if (goodMatches.length === 0) return '';

    const lines: string[] = [];
    for (const item of goodMatches.slice(0, 5)) {
      const opp = filtered[item.index - 1];
      if (!opp) continue;

      lines.push(`- **${opp.title}** (ציון: ${item.score}/10)${opp.deadline ? ` | דדליין: ${opp.deadline}` : ''}${opp.funder ? ` | ${opp.funder}` : ''}${opp.url ? ` | לינק: ${opp.url}` : ''}\n  ${item.reasoning}${opp.description ? `\n  תיאור: ${opp.description.slice(0, 200)}` : ''}`);

      // Save to DB
      const { error: matchErr } = await supabase.from('matches').upsert(
        { org_id: orgId, opportunity_id: opp.id, score: item.score * 10, reasoning: item.reasoning, status: 'new' },
        { onConflict: 'org_id,opportunity_id', ignoreDuplicates: false }
      );
      if (matchErr) console.error('Match save error:', matchErr.message);
    }

    return `\n\n===== הזדמנויות מתאימות =====\nסרקתי ${filtered.length} קולות קוראים פתוחים. מצאתי ${lines.length} שמתאימים:\n${lines.join('\n')}`;
  } catch (e) {
    console.error('Scan error:', e);
    return '';
  }
}

// ===== Company Scanning =====

const COMPANY_KEYWORDS = ['חברות', 'חברה', 'תורמים', 'תורם', 'עסקים', 'קרנות', 'CSR', 'שותפות', 'שותפויות', 'מי תורם', 'למי לפנות', 'פנייה', 'מייל לחברה', 'נסח מייל', 'כתוב מייל', 'תרומות', 'גיוס מעסקים'];

function userAsksAboutCompanies(message: string): boolean {
  return COMPANY_KEYWORDS.some((kw) => message.includes(kw));
}

// Normalize Hebrew geresh/quotes to ASCII apostrophe for consistent search
function normalizeApostrophes(text: string): string {
  return text
    .replace(/[\u05F3\u2018\u2019\u201A\u0060\u00B4]/g, "'")  // ׳ ' ' ‚ ` ´ → '
    .replace(/[\u05F4\u201C\u201D\u201E]/g, '"');  // ״ " " „ → "
}

async function findSpecificCompany(
  supabase: ReturnType<typeof createAdminClient>,
  userMessage: string
): Promise<string | null> {
  if (userMessage.length < 3) return null;

  // Normalize apostrophes/geresh for consistent matching
  const normalizedMessage = normalizeApostrophes(userMessage);

  // Extract meaningful words (skip common Hebrew words)
  const stopWords = new Set(['של', 'את', 'על', 'עם', 'אני', 'הוא', 'היא', 'יש', 'אין', 'מה', 'איך', 'למה', 'כמה', 'איפה', 'חברה', 'חברת', 'קרן', 'ארגון', 'עמותה', 'תורם', 'תורמים', 'מידע', 'פרטים', 'לגבי', 'בנוגע', 'תספר', 'ספר', 'מכיר', 'מכירה', 'יודע', 'תגיד', 'בבקשה', 'לי', 'אם', 'גם', 'כל', 'אז', 'רק', 'עוד', 'כן', 'לא', 'או', 'הם', 'זה', 'זאת', 'היה', 'אבל', 'כמו', 'בין', 'אחרי', 'לפני', 'כדי', 'שלי', 'שלך', 'שלו', 'שלה', 'שלנו', 'שלהם']);
  const msgWords = normalizedMessage.split(/\s+/).filter(w => w.length >= 2 && !stopWords.has(w));
  if (msgWords.length === 0) return null;

  const selectFields = 'name, company_type, description, interests, donation_amount, contact_name, contact_email, contact_phone, contact_role, website';
  const matches: { name: string; company_type: string; description: string | null; interests: string[] | null; donation_amount: number | null; contact_name: string | null; contact_email: string | null; contact_phone: string | null; contact_role: string | null; website: string | null }[] = [];

  // Helper: search company name with apostrophe variations
  // DB may have ' (U+0027) while user types ׳ (U+05F3) or vice versa
  async function searchName(phrase: string, limit = 5) {
    const { data } = await supabase
      .from('companies')
      .select(selectFields)
      .eq('active', true)
      .ilike('name', `%${phrase}%`)
      .limit(limit);
    if (data?.length) return data;
    // Try without any apostrophe (e.g. "צק פוינט" matches "צ'ק פוינט")
    const stripped = phrase.replace(/['\u05F3\u2018\u2019`\u00B4]/g, '');
    if (stripped !== phrase) {
      const { data: d2 } = await supabase
        .from('companies')
        .select(selectFields)
        .eq('active', true)
        .ilike('name', `%${stripped}%`)
        .limit(limit);
      if (d2?.length) return d2;
    }
    return null;
  }

  // Strategy 0: Search with ALL words (including stopwords like "קרן") as full phrase
  // This catches "קרן צ'ק פוינט", "חברת מגה אור", "עמותת עלם" etc.
  const allWords = normalizedMessage.split(/\s+/).filter(w => w.length >= 2);
  for (let len = Math.min(allWords.length, 4); len >= 2 && matches.length === 0; len--) {
    for (let i = 0; i <= allWords.length - len && matches.length === 0; i++) {
      const phrase = allWords.slice(i, i + len).join(' ');
      if (phrase.length < 4) continue;
      const found = await searchName(phrase);
      if (found) matches.push(...found);
    }
  }

  // Strategy 1: Search with word pairs (after stopword removal)
  for (let i = 0; i < msgWords.length - 1 && matches.length === 0; i++) {
    const phrase = `${msgWords[i]} ${msgWords[i + 1]}`;
    const found = await searchName(phrase);
    if (found) matches.push(...found);
  }

  // Strategy 2: Search each individual word in name
  if (matches.length === 0) {
    for (const word of msgWords) {
      if (word.length < 2) continue;
      const found = await searchName(word, 8);
      if (found?.length) {
        matches.push(...found);
        // If too many results, narrow with another word
        if (found.length > 3 && msgWords.length > 1) {
          const otherWords = msgWords.filter(w => w !== word && w.length >= 2);
          for (const other of otherWords) {
            const normalOther = normalizeApostrophes(other);
            const strippedOther = normalOther.replace(/'/g, '');
            const narrowed = found.filter(c => {
              const normName = normalizeApostrophes(c.name);
              const normDesc = normalizeApostrophes(c.description || '');
              return normName.includes(normalOther) || normName.includes(strippedOther) ||
                normDesc.includes(normalOther) || normDesc.includes(strippedOther);
            });
            if (narrowed.length > 0) {
              matches.length = 0;
              matches.push(...narrowed);
              break;
            }
          }
        }
        break;
      }
    }
  }

  // Strategy 3: Search in description too (for words 3+ chars)
  if (matches.length === 0) {
    for (const word of msgWords) {
      if (word.length < 3) continue;
      const stripped = word.replace(/['\u05F3\u2018\u2019`\u00B4]/g, '');
      const { data } = await supabase
        .from('companies')
        .select(selectFields)
        .eq('active', true)
        .or(`name.ilike.%${word}%,description.ilike.%${word}%${stripped !== word ? `,name.ilike.%${stripped}%,description.ilike.%${stripped}%` : ''}`)
        .limit(5);
      if (data?.length) {
        matches.push(...data);
        break;
      }
    }
  }

  if (matches.length === 0) return null;

  // Deduplicate by name
  const seen = new Set<string>();
  const unique = matches.filter(c => {
    if (seen.has(c.name)) return false;
    seen.add(c.name);
    return true;
  });

  // Build context for the matched companies
  const lines = unique.slice(0, 5).map(c => {
    const parts = [`[חברה מהמאגר שלך] "${c.name}" | סוג: ${c.company_type}`];
    if (c.description) parts.push(`תיאור: ${c.description.slice(0, 300)}`);
    if (c.interests?.length) parts.push(`תחומי עניין: ${c.interests.join(', ')}`);
    if (c.donation_amount) parts.push(`תרומות: ${(c.donation_amount / 1000).toFixed(0)}K ש"ח`);
    if (c.contact_name) parts.push(`איש קשר: ${c.contact_name}${c.contact_role ? ` (${c.contact_role})` : ''}`);
    if (c.contact_email) parts.push(`מייל: ${c.contact_email}`);
    if (c.contact_phone) parts.push(`טלפון: ${c.contact_phone}`);
    if (c.website) parts.push(`אתר: ${c.website}`);
    return parts.join(' | ');
  });

  return `\n\n===== חברות שנמצאו בהודעה =====\n${lines.join('\n')}`;
}

async function scanCompanies(
  supabase: ReturnType<typeof createAdminClient>,
  profileData: Record<string, unknown> | null,
  orgName: string | null,
  userMessage: string
): Promise<string> {
  // Check if user mentions a specific company name (even without generic keywords)
  const specificCompanyMatch = await findSpecificCompany(supabase, userMessage);
  if (specificCompanyMatch) return specificCompanyMatch;

  if (!userAsksAboutCompanies(userMessage)) return '';

  try {
    // Get companies from DB
    const { data: companies, error } = await supabase
      .from('companies')
      .select('id, name, company_type, description, interests, donation_amount, csr_rank, contact_name, contact_email, contact_phone, contact_role, website')
      .eq('active', true)
      .limit(1100);

    if (error || !companies?.length) return '';

    // If org has a profile, find matching companies using AI
    if (profileData && Object.keys(profileData).length >= 3) {
      const focusAreas = (profileData.focus_areas as string[]) || [];
      const mission = (profileData.mission as string) || '';
      const regions = (profileData.regions as string[]) || [];
      const orgText = [...focusAreas, mission, ...regions].join(' ').toLowerCase();

      // Pre-filter: companies with overlapping interests or CSR
      const candidates = companies.filter((c) => {
        if (!c.interests?.length && !c.description) return false;
        const companyText = [...(c.interests || []), c.description || ''].join(' ').toLowerCase();
        // Check for keyword overlap
        const orgWords = orgText.split(/\s+/).filter(w => w.length > 2);
        return orgWords.some(w => companyText.includes(w)) || c.csr_rank;
      });

      // Take top candidates (prioritize funds and high CSR rank)
      const sorted = candidates.sort((a, b) => {
        if (a.company_type === 'fund' && b.company_type !== 'fund') return -1;
        if (b.company_type === 'fund' && a.company_type !== 'fund') return 1;
        return (a.csr_rank || 999) - (b.csr_rank || 999);
      }).slice(0, 20);

      if (sorted.length === 0) {
        return `\n\n===== חברות וארגונים =====\nיש לי ${companies.length} חברות וארגונים במאגר, אבל לא מצאתי התאמות ברורות לפרופיל שלכם. תשאלו על סוג ספציפי (קרנות, עסקים, חברות ציבוריות) ואמצא.`;
      }

      // AI scoring for top candidates
      const orgContext = buildOrgContext(profileData, orgName);
      const compList = sorted.map((c, i) =>
        `${i + 1}. "${c.name}" | סוג: ${c.company_type} | תחומי עניין: ${c.interests?.join(', ') || '-'} | תרומות: ${c.donation_amount ? `${(c.donation_amount / 1000).toFixed(0)}K` : 'לא ידוע'} | CSR: ${c.csr_rank || 'לא ידוע'}${c.description ? ` | תיאור: ${c.description.slice(0, 150)}` : ''}`
      ).join('\n');

      const res = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        system: `אתה מומחה גיוס משאבים ישראלי. דרג כל חברה 1-10 לפי התאמה לארגון.
קריטריונים: חפיפת תחומי עניין (35%), פעילות בישראל (25%), גודל תרומות (20%), דירוג CSR (20%).

כללים קריטיים:
- חברות/קרנות שפועלות רק מחוץ לישראל ולא תורמות לארגונים ישראליים = ציון 1-2.
- חפיפה כללית בקטגוריה (education, welfare) לא מספיקה. חייב חפיפה ספציפית.
- ציון 8+ רק כשיש התאמה ברורה בתחום + גיאוגרפיה + היסטוריית תרומות רלוונטית.
החזר JSON בלבד: [{"index": 1, "score": 8, "reasoning": "נימוק קצר", "approach_tip": "טיפ קצר איך לפנות"}]
רק ציון 5 ומעלה. אם אין — מערך ריק [].`,
        messages: [{ role: 'user', content: `${orgContext}\n\nחברות:\n${compList}` }],
        max_tokens: 2000,
      });

      const raw = res.content[0].type === 'text' ? res.content[0].text : '[]';
      const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, raw];
      let scored: { index: number; score: number; reasoning: string; approach_tip?: string }[] = [];
      try {
        scored = JSON.parse(jsonMatch[1]!.trim());
      } catch {
        return '';
      }

      const goodMatches = scored.filter((s) => s.score >= 5).slice(0, 8);
      if (goodMatches.length === 0) return '';

      const lines = goodMatches.map((item) => {
        const c = sorted[item.index - 1];
        if (!c) return null;
        return `- ${c.name} (${c.company_type === 'fund' ? 'קרן' : c.company_type === 'public' ? 'ציבורית' : c.company_type === 'private' ? 'פרטית' : 'עסק'}, ציון: ${item.score}/10)${c.donation_amount ? ` | תרומות: ${(c.donation_amount / 1000).toFixed(0)}K ש"ח` : ''}${c.contact_name ? ` | איש קשר: ${c.contact_name}` : ''}${c.contact_email ? ` | ${c.contact_email}` : ''}\n  ${item.reasoning}${item.approach_tip ? `\n  טיפ לפנייה: ${item.approach_tip}` : ''}`;
      }).filter(Boolean);

      return `\n\n===== חברות מתאימות =====\nמצאתי ${lines.length} חברות/קרנות שכדאי לפנות אליהן (מתוך ${companies.length} במאגר):\n${lines.join('\n')}`;
    }

    // No profile — just provide stats
    const typeCounts: Record<string, number> = {};
    for (const c of companies) {
      typeCounts[c.company_type] = (typeCounts[c.company_type] || 0) + 1;
    }
    const statsLine = Object.entries(typeCounts).map(([t, c]) => `${c} ${t === 'fund' ? 'קרנות' : t === 'public' ? 'ציבוריות' : t === 'private' ? 'פרטיות' : 'עסקים'}`).join(', ');

    return `\n\n===== מאגר חברות =====\nיש לי ${companies.length} חברות וארגונים: ${statsLine}. כולם עם פרטי קשר מלאים. תעלו מסמכים על הארגון ואתאים לכם את החברות הכי רלוונטיות.`;
  } catch (e) {
    console.error('Company scan error:', e);
    return '';
  }
}

// ===== Companies Index (always loaded) =====

async function loadCompaniesIndex(
  supabase: ReturnType<typeof createAdminClient>
): Promise<string> {
  try {
    const { data: companies } = await supabase
      .from('companies')
      .select('name, company_type, description, interests, donation_amount, csr_rank')
      .eq('active', true)
      .order('name');

    if (!companies?.length) return '';

    // Group by type
    const byType: Record<string, typeof companies> = {};
    for (const c of companies) {
      const t = c.company_type || 'other';
      if (!byType[t]) byType[t] = [];
      byType[t].push(c);
    }

    const typeLabels: Record<string, string> = {
      fund: 'קרנות',
      public: 'חברות ציבוריות',
      private: 'חברות פרטיות',
      business: 'עסקים',
    };

    // Build compact index with key details
    const sections = Object.entries(byType).map(([type, comps]) => {
      const label = typeLabels[type] || type;
      const lines = comps.map(c => {
        const parts = [c.name];
        if (c.interests?.length) parts.push(`(${c.interests.slice(0, 3).join(', ')})`);
        if (c.donation_amount) parts.push(`${(c.donation_amount / 1000).toFixed(0)}K₪`);
        if (c.csr_rank) parts.push(`CSR#${c.csr_rank}`);
        return parts.join(' ');
      });
      return `## ${label} (${comps.length})\n${lines.join(' | ')}`;
    });

    let result = `\n\n===== מאגר חברות וארגונים — ${companies.length} במאגר =====\nאתה מכיר את כל החברות האלה. כשמשתמש שואל על חברה — חפש במאגר הזה קודם!\n${sections.join('\n\n')}`;
    if (result.length > 30000) {
      result = result.slice(0, 30000) + '\n[... עוד חברות]';
    }
    return result;
  } catch {
    return '';
  }
}

// ===== Grants Index (always loaded) =====

async function loadGrantsIndex(): Promise<string> {
  try {
    const grantsDb = createGrantsClient();
    const today = new Date().toISOString().split('T')[0];

    const { data: grants } = await grantsDb
      .from('grants')
      .select('id, title, funder, deadline, description, categories, target_populations, url, amount, type, eligibility, how_to_apply, contact_info, tags')
      .eq('is_database', true)
      .order('deadline', { ascending: true, nullsFirst: false });

    if (!grants?.length) return '';

    // Split into open/closed/no-deadline
    const open: typeof grants = [];
    const noDeadline: typeof grants = [];
    const closed: typeof grants = [];

    for (const g of grants) {
      if (!g.deadline) {
        noDeadline.push(g);
      } else if (g.deadline >= today) {
        open.push(g);
      } else {
        closed.push(g);
      }
    }

    // Build compact but rich index per grant
    const formatGrant = (g: typeof grants[0]) => {
      const parts = [`"${g.title}"`];
      if (g.funder) parts.push(`גוף: ${g.funder}`);
      if (g.deadline) parts.push(`דדליין: ${g.deadline}`);
      if (g.amount) parts.push(`עד ${(g.amount / 1000).toFixed(0)}K₪`);
      if (g.categories?.length) parts.push(`תחומים: ${g.categories.slice(0, 3).join(', ')}`);
      if (g.target_populations?.length) parts.push(`אוכלוסיות: ${g.target_populations.slice(0, 3).join(', ')}`);
      if (g.type) parts.push(`סוג: ${g.type}`);
      if (g.url) parts.push(`לינק: ${g.url}`);
      if (g.description) parts.push(`תיאור: ${g.description.slice(0, 200)}`);
      if (g.eligibility) parts.push(`תנאי סף: ${g.eligibility.slice(0, 150)}`);
      if (g.how_to_apply) parts.push(`הגשה: ${g.how_to_apply.slice(0, 100)}`);
      if (g.contact_info) parts.push(`קשר: ${g.contact_info.slice(0, 80)}`);
      return parts.join(' | ');
    };

    let result = `\n\n===== מאגר קולות קוראים — ${grants.length} במאגר =====`;
    result += `\nאתה מכיר את כל הקולות הקוראים האלה על בוריהם. כשמשתמש שואל על קול קורא — חפש במאגר הזה קודם!`;
    result += `\nסה"כ: ${open.length} פתוחים, ${noDeadline.length} ללא דדליין, ${closed.length} סגורים.`;

    if (open.length > 0) {
      result += `\n\n## פתוחים עכשיו (${open.length})`;
      result += `\n${open.map(formatGrant).join('\n')}`;
    }

    if (noDeadline.length > 0) {
      result += `\n\n## ללא דדליין — תמיד פתוחים (${noDeadline.length})`;
      result += `\n${noDeadline.map(formatGrant).join('\n')}`;
    }

    if (closed.length > 0) {
      result += `\n\n## סגורים (${closed.length}) — לדעת שקיימים, לעקוב אחרי סבבים עתידיים`;
      // For closed, shorter format to save tokens
      result += `\n${closed.map(g => {
        const parts = [`"${g.title}"`];
        if (g.funder) parts.push(g.funder);
        if (g.deadline) parts.push(`סגור ${g.deadline}`);
        if (g.categories?.length) parts.push(g.categories.slice(0, 2).join(', '));
        if (g.url) parts.push(g.url);
        return parts.join(' | ');
      }).join('\n')}`;
    }

    // Truncate if too long (grants can be verbose)
    if (result.length > 25000) {
      result = result.slice(0, 25000) + '\n[... עוד קולות קוראים]';
    }

    return result;
  } catch (e) {
    console.error('Grants index load error:', e);
    return '';
  }
}

// ===== Funders Intelligence (always loaded) =====

async function loadFundersIndex(
  supabase: ReturnType<typeof createAdminClient>
): Promise<string> {
  try {
    const grantsDb = createGrantsClient();

    // Aggregate funder data from grants
    const { data: grants } = await grantsDb
      .from('grants')
      .select('funder, categories, target_populations, amount, deadline, title, url')
      .eq('is_database', true)
      .not('funder', 'is', null);

    if (!grants?.length) return '';

    const today = new Date().toISOString().split('T')[0];

    // Build funder profiles
    const funderMap = new Map<string, {
      grantCount: number;
      categories: Set<string>;
      populations: Set<string>;
      minAmount: number | null;
      maxAmount: number | null;
      openGrants: number;
      sampleTitles: string[];
      urls: Set<string>;
    }>();

    for (const g of grants) {
      const name = g.funder?.trim();
      if (!name || name.length < 2 || name.includes('{')) continue;

      if (!funderMap.has(name)) {
        funderMap.set(name, {
          grantCount: 0, categories: new Set(), populations: new Set(),
          minAmount: null, maxAmount: null, openGrants: 0, sampleTitles: [], urls: new Set(),
        });
      }
      const f = funderMap.get(name)!;
      f.grantCount++;
      if (g.categories) for (const c of g.categories) f.categories.add(c);
      if (g.target_populations) for (const p of g.target_populations) f.populations.add(p);
      if (g.amount) {
        if (!f.minAmount || g.amount < f.minAmount) f.minAmount = g.amount;
        if (!f.maxAmount || g.amount > f.maxAmount) f.maxAmount = g.amount;
      }
      if (g.deadline && g.deadline >= today) f.openGrants++;
      if (f.sampleTitles.length < 3) f.sampleTitles.push(g.title);
      if (g.url) f.urls.add(g.url);
    }

    // Also load scan sources for URL directory
    const { data: sources } = await supabase
      .from('grant_sources')
      .select('name, url, layer, fields, populations, notes')
      .eq('is_active', true);

    // Build the index
    const funderLines = Array.from(funderMap.entries())
      .sort((a, b) => b[1].grantCount - a[1].grantCount)
      .map(([name, f]) => {
        const parts = [`${name} (${f.grantCount} קולות קוראים`];
        if (f.openGrants > 0) parts[0] += `, ${f.openGrants} פתוחים`;
        parts[0] += ')';
        if (f.categories.size) parts.push(`תחומים: ${Array.from(f.categories).slice(0, 4).join(', ')}`);
        if (f.populations.size) parts.push(`אוכלוסיות: ${Array.from(f.populations).slice(0, 4).join(', ')}`);
        if (f.maxAmount) parts.push(`עד ${(f.maxAmount / 1000).toFixed(0)}K₪`);
        if (f.sampleTitles.length) parts.push(`דוגמאות: ${f.sampleTitles.slice(0, 2).join('; ')}`);
        return parts.join(' | ');
      });

    let result = `\n\n===== מודיעין גופים מממנים — ${funderMap.size} גופים =====`;
    result += `\nאתה מכיר כל גוף מממן. כשמישהו שואל על קרן או גוף — תענה מהידע שלך.`;
    result += `\n${funderLines.join('\n')}`;

    // Add scan sources directory
    if (sources?.length) {
      const byLayer: Record<string, string[]> = {};
      for (const s of sources) {
        const layer = s.layer || 'other';
        if (!byLayer[layer]) byLayer[layer] = [];
        byLayer[layer].push(s.url);
      }
      const layerLabels: Record<string, string> = {
        government: 'ממשלתי', private_il: 'קרנות ישראליות',
        international: 'בינלאומי', aggregator: 'אגרגטורים',
      };
      result += `\n\n## מקורות סריקה (${sources.length} אתרים)`;
      for (const [layer, urls] of Object.entries(byLayer)) {
        result += `\n${layerLabels[layer] || layer}: ${urls.join(' | ')}`;
      }
    }

    // Expert knowledge about major funders
    result += `\n\n## מודיעין עומק — גופים מרכזיים:`;
    result += `
משרד החינוך: מדדים כמותיים, שפה פורמלית, יעדים SMART, שיתוף רשויות מקומיות. דדליינים: אוגוסט-ספטמבר.
ביטוח לאומי: קרנות ייעודיות (מוגבלות, קשישים, ילדים). בירוקרטי, דורשים ניהול תקין + 46א. 50K-500K.
ג'וינט/JDC: חדשנות, שיתופי פעולה, evidence-based, מדידה + למידה. מעדיפים תוכניות חדשות.
מפעל הפיס: פריפריה, נגישות, קהילה, תרבות. 20K-300K. תהליך פשוט.
קרן עזריאלי: חינוך, מדע, מנהיגות, ספורט. 100K-1M. תחרותי, דורשים מצוינות.
שוסטרמן: חינוך יהודי, מנהיגות צעירה, ישראל-תפוצות. סגנון אמריקאי, ROI ברור.
קרן ויינברג: רווחה, בריאות, קהילה. דרך שותפים מקומיים. מעדיפים ארגונים מבוססים.
יד הנדיב (רוטשילד): חינוך, סביבה, אזרחות. סכומים גדולים, תהליך ארוך, מצוינות מחקרית.
קרן רשי: פריפריה, חינוך, תעסוקה. מועדפים: דרום ונגב. leverage ממשלתי.
ועדת העיזבונות: 100K-2M, רווחה + חינוך, תהליך ארוך, דורש מסמכים רבים.
קק"ל: סביבה, פריפריה, חינוך. שותפויות עם רשויות. impact מדיד.
הסוכנות היהודית: עלייה, קליטה, זהות יהודית. חיבור ישראל-תפוצות.`;

    if (result.length > 15000) {
      result = result.slice(0, 15000) + '\n[... עוד גופים מממנים]';
    }

    return result;
  } catch (e) {
    console.error('Funders index load error:', e);
    return '';
  }
}

// ===== Org Memory — cross-session persistent memory =====

async function loadOrgMemory(
  supabase: ReturnType<typeof createAdminClient>,
  orgId: string
): Promise<string> {
  try {
    const { data: memories } = await supabase
      .from('org_memory')
      .select('key, value, confidence, updated_at')
      .eq('org_id', orgId)
      .order('updated_at', { ascending: false })
      .limit(50);

    if (!memories?.length) return '';

    const lines = memories.map(m => `${m.key}: ${m.value}`);
    return `\n\n===== כרטיס ארגון (${memories.length} עובדות מאומתות) =====
אלה נתונים אמיתיים שנשלפו מהמסמכים הרשמיים של הארגון. השתמש בהם תמיד. אל תשאל שאלות שהתשובות כאן.
${lines.join('\n')}`;
  } catch (e) {
    console.error('Org memory load error:', e);
    return '';
  }
}

async function loadSubmissionHistory(
  supabase: ReturnType<typeof createAdminClient>,
  orgId: string
): Promise<string> {
  try {
    const { data: subs } = await supabase
      .from('submissions')
      .select('status, outcome, approved_amount, requested_amount, funder_feedback, lessons_learned, created_at, opportunity:opportunities(title, funder)')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(20);

    if (!subs?.length) return '';

    const lines = subs.map(s => {
      const opp = s.opportunity as unknown as { title: string; funder: string } | null;
      const parts = [
        opp?.title || 'ללא שם',
        opp?.funder ? `(${opp.funder})` : '',
        `סטטוס: ${s.status}`,
      ];
      if (s.outcome) parts.push(`תוצאה: ${s.outcome}`);
      if (s.approved_amount) parts.push(`אושר: ${Number(s.approved_amount).toLocaleString('he-IL')} ש"ח`);
      if (s.requested_amount) parts.push(`בוקש: ${Number(s.requested_amount).toLocaleString('he-IL')} ש"ח`);
      if (s.funder_feedback) parts.push(`משוב: ${s.funder_feedback}`);
      if (s.lessons_learned) parts.push(`לקחים: ${s.lessons_learned}`);
      return parts.join(' | ');
    });

    return `\n\n===== היסטוריית הגשות (${subs.length}) =====
הגשות קודמות של הארגון — השתמש בלקחים כדי לשפר הגשות חדשות:
${lines.join('\n')}`;
  } catch (e) {
    console.error('Submission history load error:', e);
    return '';
  }
}

async function extractAndSaveMemory(
  supabase: ReturnType<typeof createAdminClient>,
  orgId: string,
  userMessage: string,
  assistantResponse: string
): Promise<void> {
  try {
    const combined = userMessage + ' ' + assistantResponse;
    if (combined.length < 80) return;

    // Use Claude Haiku to extract structured memory from the conversation
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const extractionPrompt = `אתה מחלץ עובדות חשובות משיחה עם עמותה לצורך שמירה בזיכרון ארגוני.

הודעת משתמש:
"${userMessage.slice(0, 1500)}"

תשובת הסוכן:
"${assistantResponse.slice(0, 1500)}"

חלץ עד 10 עובדות חשובות. התמקד במה שיעזור לסוכן בשיחות עתידיות:
- תוצאות הגשות (אושר/נדחה, סכום, משוב מהגוף המממן)
- העדפות כתיבה של הארגון
- מידע ייחודי שלא במסמכים (שותפויות, מספרים, יעדים)
- יחסים עם גופים מממנים (חיובי/שלילי/היסטוריה)
- לקחים מהגשות קודמות
- דדליינים וצירי זמן חשובים
- תתי-אוכלוסיות שהארגון מלווה (נשים, ערבים, עולים, אתיופים, חרדים, בדואים, LGBTQ, חד-הוריים)
- תיאוריית שינוי / מודל פעולה ייחודי (Theory of Change)
- חוזקות ייחודיות (מחקר מלווה, טכנולוגיה, רשת שותפים, ניסיון)
- מספרי מוטבים, בתי ספר, ערים, עובדים חדשים שנזכרו
- שמות אנשי מפתח (מנכ"ל/ית, יו"ר, רכזים) ופרטי קשר

החזר JSON בלבד, ללא טקסט נוסף:
{"items":[{"key":"מזהה_קצר_באנגלית","value":"הערך בעברית","confidence":"high|medium|low"}]}

דוגמאות ל-key טובים: theory_of_change, unique_model, sub_populations, ceo_name, total_beneficiaries, partner_orgs, funder_relation_joint, strength_research, age_range, cities_active

אם אין עובדות חשובות לשמור, החזר: {"items":[]}`;

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1000,
      messages: [{ role: 'user', content: extractionPrompt }],
    });

    const rawText = response.content[0].type === 'text' ? response.content[0].text.trim() : '';
    if (!rawText) return;

    const jsonText = rawText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    let parsed: { items: { key: string; value: string; confidence: string }[] };
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      console.error('[memory] Failed to parse JSON:', jsonText.slice(0, 200));
      return;
    }

    const memoryItems = (parsed.items || []).filter(
      (item) => item.key && item.value && item.value.length > 3
    );

    if (memoryItems.length === 0) return;

    // Also detect submission outcomes and save them
    await maybeUpdateSubmissionOutcome(supabase, orgId, userMessage);

    for (const item of memoryItems) {
      await supabase
        .from('org_memory')
        .upsert(
          {
            org_id: orgId,
            key: item.key,
            value: item.value,
            source: 'chat_ai',
            confidence: item.confidence || 'medium',
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'org_id,key' }
        );
    }

    console.log(`[memory] Saved ${memoryItems.length} AI-extracted items for org ${orgId}`);
  } catch (e) {
    console.error('Memory extraction error:', e);
  }
}

// Detects submission outcomes mentioned in chat and saves to org_memory
async function maybeUpdateSubmissionOutcome(
  supabase: ReturnType<typeof createAdminClient>,
  orgId: string,
  userMessage: string
): Promise<void> {
  const approvedMatch = userMessage.match(
    /(?:קרן|גוף)\s+([^,\n]{3,40})\s+(?:אישרה?|אישרו|קיבלנו|זכינו)[^.]{0,80}?(\d[\d,]+)?\s*(?:ש"ח|שקל)?/
  );
  if (approvedMatch) {
    const funder = approvedMatch[1]?.trim();
    const amount = approvedMatch[2]?.replace(/,/g, '');
    if (funder) {
      const key = `approved_${funder.replace(/\s+/g, '_').slice(0, 30)}`;
      const value = amount
        ? `אושר ${Number(amount).toLocaleString('he-IL')} ש"ח מ-${funder}`
        : `אושר מענק מ-${funder}`;
      await supabase.from('org_memory').upsert(
        { org_id: orgId, key, value, source: 'chat_outcome', confidence: 'high', updated_at: new Date().toISOString() },
        { onConflict: 'org_id,key' }
      );
    }
  }

  const rejectedMatch = userMessage.match(
    /(?:קרן|גוף)\s+([^,\n]{3,40})\s+(?:דחתה?|דחו|לא אישרו?|נדחינו)[^.]{0,120}/
  );
  if (rejectedMatch) {
    const funder = rejectedMatch[1]?.trim();
    if (funder) {
      const key = `rejected_${funder.replace(/\s+/g, '_').slice(0, 30)}`;
      await supabase.from('org_memory').upsert(
        { org_id: orgId, key, value: rejectedMatch[0].trim().slice(0, 200), source: 'chat_outcome', confidence: 'high', updated_at: new Date().toISOString() },
        { onConflict: 'org_id,key' }
      );
    }
  }
}

// ===== Sector Intelligence =====

const SECTOR_KEYWORDS = ['מגזר שלישי', 'עמותות', 'מתחרים', 'מגמות', 'טרנדים', 'חדשות', 'סטארטאפ חברתי', 'אימפקט', 'CSR', 'פילנתרופיה', 'תרומות בישראל', 'קרנות בישראל', 'שוק', 'מגזר', 'תחרות', 'benchmarking', 'דוח מגזרי', 'נתוני שוק'];

function userAsksAboutSector(message: string): boolean {
  return SECTOR_KEYWORDS.some((kw) => message.includes(kw));
}

async function loadSectorIntelligence(
  supabase: ReturnType<typeof createAdminClient>,
  userMessage: string
): Promise<string> {
  try {
    // Always load core knowledge topics
    const { data: knowledge } = await supabase
      .from('sector_knowledge')
      .select('topic, content')
      .not('topic', 'like', 'daily_digest_%')
      .order('last_updated', { ascending: false })
      .limit(10);

    let sectorContext = '';
    if (knowledge?.length) {
      const topics = knowledge.map(k => `[${k.topic}]\n${k.content}`);
      sectorContext = `\n\n===== ידע מגזרי — מגזר שלישי ישראלי =====\n${topics.join('\n\n')}`;

      // Truncate if too long
      if (sectorContext.length > 15000) {
        sectorContext = sectorContext.slice(0, 15000) + '\n[... עוד ידע מגזרי]';
      }
    }

    // Load today's digest if available
    const today = new Date().toISOString().split('T')[0];
    const { data: digest } = await supabase
      .from('sector_knowledge')
      .select('content')
      .eq('topic', `daily_digest_${today}`)
      .single();

    if (digest?.content) {
      sectorContext += `\n\n===== סיכום יומי — ${today} =====\n${digest.content}`;
    }

    // If user asks about sector topics, load recent intelligence
    if (userAsksAboutSector(userMessage)) {
      const keywords = userMessage.split(/\s+/).filter(w => w.length > 2).slice(0, 5).join(' & ');
      let intelligenceQuery = supabase
        .from('sector_intelligence')
        .select('title, summary, category, source, source_url, relevance_score, scan_date')
        .gte('relevance_score', 40)
        .order('relevance_score', { ascending: false })
        .limit(10);

      if (keywords) {
        intelligenceQuery = intelligenceQuery.textSearch('fts', keywords, { type: 'plain' });
      }

      const { data: intel } = await intelligenceQuery;
      if (intel?.length) {
        const items = intel.map(i =>
          `- [${i.category}] ${i.title} (${i.source}, ${i.scan_date})${i.summary ? `: ${i.summary}` : ''}${i.source_url ? ` | ${i.source_url}` : ''}`
        );
        sectorContext += `\n\n===== חדשות אחרונות מהמגזר =====\n${items.join('\n')}`;
      }
    }

    return sectorContext;
  } catch {
    return '';
  }
}

// ===== Main Handler =====

export async function POST(request: NextRequest) {
  try {
    const { message, conversation_id, org_id, user_id, active_tab } = await request.json();

    if (!message || !org_id || !user_id) {
      console.error('Missing required fields:', { message: !!message, org_id, user_id });
      return Response.json({ error: 'Missing required fields', debug: { hasMessage: !!message, org_id, user_id } }, { status: 400 });
    }

    const supabase = createAdminClient();

    // Step 1: Fetch URLs + org info in parallel
    const [fetchedUrls, { data: org }, { data: profileBefore }] = await Promise.all([
      fetchUrls(message),
      supabase.from('organizations').select('name, domain').eq('id', org_id).single(),
      supabase.from('org_profiles').select('data').eq('org_id', org_id).single(),
    ]);

    // Step 2: Learn from URLs BEFORE building context (so this response already knows the org)
    if (fetchedUrls.length > 0) {
      await learnFromUrls(supabase, org_id, fetchedUrls);
    }

    // Step 3: Re-fetch profile (may have been updated by learnFromUrls) + load knowledge in parallel
    const [{ data: profile }, { knowledge, rag, docSummary }] = await Promise.all([
      fetchedUrls.length > 0
        ? supabase.from('org_profiles').select('data').eq('org_id', org_id).single()
        : Promise.resolve({ data: profileBefore }),
      loadAllChunks(supabase, org_id, message, active_tab),
    ]);

    const urlContent = formatUrlsForMessage(fetchedUrls);

    // Load knowledge layers — only what's needed for this tab
    const isCompanyTab = active_tab === 'business' || active_tab === 'foundations';
    const isOpportunityTab = active_tab === 'opportunities';
    const isOrgTab = active_tab === 'org';

    const [opportunityContext, companyContext, sectorContext, companiesIndex, grantsIndex, fundersIndex, orgMemory, submissionHistory, rawMemories] = await Promise.all([
      isOpportunityTab
        ? scanOpportunities(supabase, org_id, profile?.data as Record<string, unknown> | null, org?.name ?? null, message)
        : Promise.resolve(''),
      isCompanyTab
        ? scanCompanies(supabase, profile?.data as Record<string, unknown> | null, org?.name ?? null, message)
        : Promise.resolve(''),
      isOrgTab ? Promise.resolve('') : loadSectorIntelligence(supabase, message),
      isCompanyTab ? loadCompaniesIndex(supabase) : Promise.resolve(''),
      isOpportunityTab || active_tab === 'chat' ? loadGrantsIndex() : Promise.resolve(''),
      isCompanyTab ? loadFundersIndex(supabase) : Promise.resolve(''),
      loadOrgMemory(supabase, org_id),
      isOrgTab ? Promise.resolve('') : loadSubmissionHistory(supabase, org_id),
      supabase.from('org_memory').select('key, value').eq('org_id', org_id).limit(50).then(r => r.data as { key: string; value: string }[] || []),
    ]);

    // GuideStar auto-enrichment: if org has registration number, fetch public data
    let guidestarContext = '';
    const profileData = (profile?.data ?? null) as Record<string, unknown> | null;
    const regNum = profileData?.registration_number as string | undefined;
    if (regNum && !profileData?._guidestar_fetched) {
      try {
        const gsOrg = await fetchByRegistrationNumber(regNum);
        if (gsOrg) {
          guidestarContext = formatForContext(gsOrg);
          const gsProfile = formatForProfile(gsOrg);
          const merged = { ...profileData };
          for (const [k, v] of Object.entries(gsProfile)) {
            if (!merged[k] && v) merged[k] = v;
          }
          merged._guidestar_fetched = true;
          supabase.from('org_profiles').upsert({
            org_id,
            data: merged,
            last_updated: new Date().toISOString(),
          }, { onConflict: 'org_id' });
          console.log('[guidestar] Profile enriched for org', org_id);
        }
      } catch (e) {
        console.error('[guidestar] Error:', e);
      }
    }

    // Build org context with memory overrides (memory has verified data that's more accurate than profile)
    const orgContext = buildOrgContext(profile?.data ?? null, org?.name ?? null, rawMemories);

    // Tab-specific focus instructions
    const TAB_FOCUS: Record<string, string> = {
      chat: `\n\n===== צ׳אט ראשי =====
יש לך כרטיס ארגון מאומת ואת כל המסמכים. כשעונה על שאלות, השתמש בנתונים אמיתיים. כשמבקשים לכתוב הגשה, שלוף מספרים מכרטיס הארגון ומהמחקר. כשמציע קולות קוראים, ודא שהם באמת מתאימים לתחום הארגון.
כלל סגנון: תכתוב כמו בן אדם. בלי כוכביות, בלי מקפים, בלי כותרות. פסקאות חופשיות.`,
      opportunities: `\n\n===== הקשר נוכחי: קולות קוראים =====
המשתמש בלשונית קולות קוראים. יש לך את כל המסמכים של הארגון. השתמש בהם.

כלל סגנון: תכתוב כמו בן אדם. בלי כוכביות, בלי מקפים, בלי כותרות, בלי רשימות. פסקאות חופשיות.

אתה מכיר את הארגון לעומק מכל המסמכים שקראת. כשמישהו שואל על קול קורא, תנתח אותו ביחס לארגון הספציפי הזה. אם קול קורא לא מתאים, תגיד בפירוש למה ותציע חלופות.
כשכותב הגשה, תשלוף נתונים אמיתיים מהמסמכים: מספרי מוטבים, אחוזים מהמחקר, סכומי תקציב, שמות פרויקטים.
אל תמציא קולות קוראים שלא קיימים. אם לא מצאת התאמה טובה, אמור את זה.`,
      business: `\n\n===== הקשר נוכחי: חברות וקרנות =====
המשתמש בלשונית חברות וקרנות. יש לך את כל המסמכים של הארגון. השתמש בהם.

כלל סגנון: תכתוב כמו בן אדם. בלי כוכביות, בלי מקפים, בלי כותרות, בלי רשימות. פסקאות חופשיות.

כשמציע חברות או כותב מיילי פנייה, השתמש בנתונים אמיתיים מהמסמכים. לא סיסמאות גנריות אלא מספרים, שמות פרויקטים, תוצאות.`,
      org: `\n\n===== הקשר נוכחי: פרופיל הארגון =====
המשתמש בלשונית פרופיל הארגון. אתה סוכן גיוס משאבים חכם שמכיר את הארגון לעומק.

כלל סגנון קריטי לצ׳אט הזה:
תכתוב בדיוק כמו בן אדם שמדבר. בלי כוכביות, בלי מקפים, בלי כותרות, בלי רשימות עם תבליטים.
תכתוב פסקאות חופשיות. משפט אחרי משפט עם נקודה ביניהם. שפה חמה וישירה.
במקום "14-26" תכתוב "14 עד 26". במקום "early intervention" תכתוב את זה בעברית או תשלב בטבעיות.
אף פעם לא לכתוב תשובה שנראית כמו מסמך או דוח. זו שיחה.

התפקיד שלך כאן:
אתה לא שואל שאלות. יש לך את כל המסמכים, המחקרים, הדוחות, המצגות. תשתמש בהם.
כשמישהו שואל "מה אתה יודע" או "מה החוזקות שלנו" או "מה המספרים" אתה לא מבקש כלום. אתה הולך למסמכים, שולף את הנתונים הקונקרטיים, ועונה עם מספרים אמיתיים.
יש לך מחקר עם אחוזים? תביא את האחוזים. יש תקציב עם סכומים? תביא את הסכומים. יש מספרי מוטבים? תכתוב אותם.
אם באמת אין מידע ספציפי בשום מסמך, רק אז תגיד מה חסר.

כשמעלים מסמך חדש, קרא אותו ותספר מה למדת ממנו. תגיד "עד עכשיו ידעתי X, עכשיו אני מבין גם Y".
כשמישהו מדייק אותך, קבל ועדכן.

ראייה מאקרו ומיקרו:
מאקרו: מה הארגון עושה, למי, למה זה חשוב, מה הבעיה שהוא פותר, מה הייחוד.
מיקרו: כל פרויקט בנפרד, כמה מוטבים, באיזו עיר, מה התוצאות.
תדע לזהות איזה פרויקטים מתאימים לאיזה קולות קוראים ותציע התאמות.

מסמכים נדרשים: ניהול תקין, סעיף 46, ניכוי מס, רישום עמותה, דוח כספי מבוקר, תקציב מאושר.
אם חסר או פג תוקף, הזכר. אם הכל בסדר, אמור שמבחינת מסמכים הארגון מוכן להגיש.`,
      foundations: `\n\n===== הקשר נוכחי: קרנות ופדרציות =====
המשתמש בלשונית קרנות ופדרציות. יש לך את כל המסמכים של הארגון וכרטיס ארגון עם נתונים מאומתים. השתמש בהם.

כלל סגנון: תכתוב כמו בן אדם. בלי כוכביות, בלי מקפים, בלי כותרות, בלי רשימות. פסקאות חופשיות.

כשמציע קרנות, תסביר למה הן מתאימות על בסיס נתונים ספציפיים מהארגון. לא "כי אתם עוסקים בחינוך" אלא "כי יש לכם מחקר דו-עת שמראה 77% גיוס צבאי ו-76% תעסוקה, וקרן X מחפשת בדיוק הוכחות אימפקט כאלה".
כשכותב LOI או מייל פנייה, תשלב מספרים אמיתיים מכרטיס הארגון.`,
    };
    const tabFocus = (active_tab && TAB_FOCUS[active_tab]) || '';

    // Grant writing mode: load full documents when user asks to write a grant
    let grantWritingContext = '';
    if (userAsksForGrantWriting(message)) {
      grantWritingContext = await loadFullDocumentsForGrantWriting(supabase, org_id);
      console.log(`Grant writing mode: loaded ${grantWritingContext.length} chars of full documents`);

      // Load funder-specific lessons from org_memory
      const { data: allMemories } = await supabase
        .from('org_memory')
        .select('key, value, confidence')
        .eq('org_id', org_id)
        .in('source', ['chat_ai', 'chat_outcome'])
        .order('updated_at', { ascending: false })
        .limit(100);

      if (allMemories && allMemories.length > 0) {
        // Filter memories relevant to this message (funder name match or outcome-related keys)
        const msgLower = message.toLowerCase();
        const relevantMemories = allMemories.filter((m: { key: string; value: string; confidence: string }) => {
          const keyLower = m.key.toLowerCase();
          const valueLower = m.value.toLowerCase();
          return (
            keyLower.startsWith('approved_') ||
            keyLower.startsWith('rejected_') ||
            keyLower.includes('funder') ||
            keyLower.includes('lesson') ||
            keyLower.includes('writing_pref') ||
            // Check if funder name from memory appears in user message
            msgLower.includes(valueLower.slice(0, 20))
          );
        });

        if (relevantMemories.length > 0) {
          const memorySummary = relevantMemories
            .map((m: { key: string; value: string; confidence: string }) => `- ${m.value}`)
            .join('\n');
          grantWritingContext += `\n\n--- זיכרון היסטורי רלוונטי ---\n${memorySummary}\nהתחשב בלקחים אלה בעת כתיבת ההגשה.\n`;
          console.log(`Grant writing: added ${relevantMemories.length} historical memory items`);
        }
      }
    }

    // Submission Engine: RFP parsing + readiness check + org blocks
    let submissionEngineContext = '';
    try {
      if (userAsksForRfpParse(message) || userAsksForGrantWriting(message)) {
        // Load existing blocks
        let blocks = await loadOrgBlocks(supabase, org_id);

        // If no blocks exist yet, generate them from documents
        if (blocks.length === 0 && profile?.data) {
          const { data: docs } = await supabase
            .from('documents')
            .select('filename, category, parsed_text')
            .eq('org_id', org_id)
            .in('category', ['identity', 'budget', 'project', 'impact', 'programs', 'submission'])
            .limit(10);

          if (docs?.length) {
            console.log(`Generating org blocks from ${docs.length} documents...`);
            const docTexts = docs
              .filter((d: { parsed_text: string | null }) => d.parsed_text)
              .map((d: { category: string; parsed_text: string | null; filename: string }) => ({
                category: d.category,
                text: d.parsed_text || '',
                filename: d.filename,
              }));

            const generated = await generateOrgBlocks(profile.data as import('@/types').OrgProfileData, docTexts);
            await saveOrgBlocks(supabase, org_id, generated);
            blocks = await loadOrgBlocks(supabase, org_id);
            console.log(`Generated and saved ${blocks.length} org blocks`);
          }
        }

        // If there's a URL in the message that might be an RFP, or if fetchedUrls contain RFP content
        const rfpText = fetchedUrls.find(u => u.content.length > 500)?.content;

        if (rfpText && userAsksForRfpParse(message)) {
          console.log('Parsing RFP...');
          const rfp = await parseRfp(rfpText);
          rfp.org_id = org_id;
          const rfpId = await saveRfpParsed(supabase, org_id, rfp);
          console.log(`RFP parsed: ${rfp.questions.length} questions, saved as ${rfpId}`);

          // Load org docs for readiness check
          const { data: orgDocs } = await supabase
            .from('documents')
            .select('filename, category, metadata')
            .eq('org_id', org_id);

          const readiness = checkReadiness(
            rfp,
            (profile?.data || {}) as import('@/types').OrgProfileData,
            blocks,
            (orgDocs || []) as { filename: string; category: string; metadata?: Record<string, unknown> }[]
          );

          const assembled = assembleSubmission(rfp, blocks);
          const answeredCount = assembled.filter(a => a.answer && !a.answer.startsWith('[נדרש')).length;

          submissionEngineContext = `\n\n===== ניתוח קול קורא — מנוע הגשות =====
קול קורא: ${rfp.rfp_title}
גוף מממן: ${rfp.funder_name} (${rfp.funder_type})
${rfp.deadline ? `דדליין: ${rfp.deadline}` : ''}
${rfp.max_amount ? `סכום מקסימלי: ${rfp.max_amount.toLocaleString()} ₪` : ''}

שאלות שזוהו: ${rfp.questions.length}
שאלות שיש תשובה מוכנה: ${answeredCount}/${rfp.questions.length}
מסמכים נדרשים: ${rfp.required_documents.join(', ') || 'לא צוינו'}

${formatReadinessReport(readiness, rfp.rfp_title)}

תנאי סף: ${rfp.eligibility.other_conditions?.join('; ') || 'לא צוינו'}
${rfp.evaluation_criteria?.length ? `קריטריוני הערכה: ${rfp.evaluation_criteria.map(c => `${c.criterion} (${c.weight}%)`).join(', ')}` : ''}

הנחיות: הצג את הניתוח למשתמש. אם ציון המוכנות נמוך — הסבר מה חסר ואיך להשלים. אם גבוה — הצע להתחיל לכתוב טיוטה.`;

        } else if (blocks.length > 0) {
          // Just let Claude know about available blocks
          const blockSummary = blocks.map(b =>
            `${b.block_type}: ${b.content.standard.slice(0, 100)}...`
          ).join('\n');

          submissionEngineContext = `\n\n===== בלוקי תוכן מוכנים (${blocks.length}) =====
${blockSummary}
הנחיה: יש בלוקי תוכן מוכנים לארגון. כשכותב הגשה — השתמש בהם כבסיס והתאם לקול הקורא הספציפי.`;
        }
      }
    } catch (engineErr) {
      console.error('Submission engine error:', engineErr);
      // Non-fatal — continue without engine context
    }

    // Web Search: search the internet when user asks for current info
    let webSearchContext = '';
    if (process.env.TAVILY_API_KEY) {
      try {
        // Priority 1: explicit search intent ("תחפש", "ספר לי על X", etc.)
        const searchQuery = detectSearchIntent(message);
        // Priority 2: funder-specific query even without explicit search keywords
        const funderQuery = !searchQuery ? detectFunderQuery(message) : null;
        const effectiveQuery = searchQuery || funderQuery;

        if (effectiveQuery) {
          let results;
          if (active_tab === 'opportunities' || /קול קורא|מענק|grant/i.test(effectiveQuery)) {
            results = await searchGrants(effectiveQuery);
          } else if (active_tab === 'business' || active_tab === 'foundations' || /חברה|קרן|תורם|foundation|fund/i.test(effectiveQuery)) {
            // For funder queries: search both CSR + grants context
            const [csrResults, grantResults] = await Promise.all([
              searchCompany(effectiveQuery),
              webSearch(`${effectiveQuery} קרן מענק ישראל deadline`, { maxResults: 3, searchDepth: 'advanced' }),
            ]);
            results = [...csrResults, ...grantResults].slice(0, 6);
          } else {
            results = await webSearch(effectiveQuery, { maxResults: 5 });
          }
          if (results.length > 0) {
            webSearchContext = formatSearchResults(results);
            console.log(`Web search: "${effectiveQuery}" → ${results.length} results (funder=${!!funderQuery})`);
          }
        }
      } catch (e) {
        console.error('Web search error:', e);
      }
    }

    let systemPrompt = FISHGOLD_SYSTEM_PROMPT + FISHGOLD_BEHAVIOR_RULES + FISHGOLD_GRANT_EXPERTISE + FISHGOLD_GRANT_MASTERY + FISHGOLD_BUDGET_INTELLIGENCE + FISHGOLD_FUNDER_WRITING_DNA + FISHGOLD_FUNDER_QUESTIONS + FISHGOLD_FUNDER_INTEL + FISHGOLD_PROPOSAL_GUIDE + FISHGOLD_SUBMISSION_ENGINE + FISHGOLD_COMPETITIVE_INTEL + FISHGOLD_FUNDRAISING_INTEL + FISHGOLD_NONPROFITS_REFERENCE + FISHGOLD_NONPROFITS_PART2 + FISHGOLD_GRANTS_INTELLIGENCE + FISHGOLD_ENGLISH_GRANTS + FISHGOLD_SECTOR_KNOWLEDGE + FEDERATION_INTELLIGENCE + ISRAELI_FUNDERS_INTELLIGENCE + tabFocus + orgContext + orgMemory + submissionHistory + docSummary + knowledge + rag + grantWritingContext + submissionEngineContext + opportunityContext + companyContext + companiesIndex + grantsIndex + fundersIndex + sectorContext + webSearchContext + guidestarContext;

    // Safety: truncate system prompt if too large (Claude Sonnet context = 200K tokens ~ 600K chars)
    // Leave room for conversation history + response
    const MAX_SYSTEM_CHARS = 180000;
    if (systemPrompt.length > MAX_SYSTEM_CHARS) {
      console.warn(`System prompt too large: ${systemPrompt.length} chars, truncating to ${MAX_SYSTEM_CHARS}`);
      systemPrompt = systemPrompt.slice(0, MAX_SYSTEM_CHARS) + '\n[... חלק מהמידע נחתך בגלל מגבלת גודל]';
    }
    console.log(`System prompt size: ${systemPrompt.length} chars`);

    // Load conversation history
    let chatMessages: { role: 'user' | 'assistant'; content: string }[] = [];

    if (conversation_id) {
      const { data: conv } = await supabase
        .from('conversations')
        .select('messages')
        .eq('id', conversation_id)
        .eq('org_id', org_id)
        .single();

      if (conv?.messages) {
        chatMessages = (conv.messages as { role: string; content: string }[]).slice(-20).map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }));
      }
    }

    // Append URL content to the user message so Claude sees it
    const enrichedMessage = urlContent ? message + urlContent : message;
    chatMessages.push({ role: 'user', content: enrichedMessage });

    // Stream response with Claude — org tab uses Haiku for speed
    const chatModel = active_tab === 'org'
      ? 'claude-haiku-4-5-20251001'
      : 'claude-sonnet-4-20250514';
    const stream = anthropic.messages.stream({
      model: chatModel,
      system: systemPrompt,
      messages: chatMessages,
      max_tokens: active_tab === 'org' ? 4096 : 8192,
    });

    const encoder = new TextEncoder();
    let fullResponse = '';

    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of stream) {
            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
              const text = event.delta.text;
              fullResponse += text;
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text })}\n\n`));
            }
          }
        } catch (streamError) {
          console.error('Stream error:', streamError);
          const errMsg = streamError instanceof Error ? streamError.message : 'Unknown stream error';
          // Send error as text so the user sees what happened
          if (!fullResponse) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: `שגיאה: ${errMsg}` })}\n\n`));
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
          controller.close();
          return;
        }

        // Save conversation after streaming completes
        const now = new Date().toISOString();
        const userMsg = { role: 'user', content: message, timestamp: now };
        const assistantMsg = { role: 'assistant', content: fullResponse, timestamp: now };

        let convId = conversation_id;

        if (convId) {
          const { data: existing } = await supabase
            .from('conversations')
            .select('messages')
            .eq('id', convId)
            .single();

          const updatedMessages = [...((existing?.messages as unknown[]) || []), userMsg, assistantMsg];

          await supabase
            .from('conversations')
            .update({ messages: updatedMessages, updated_at: now })
            .eq('id', convId);
        } else {
          const { data: newConv } = await supabase
            .from('conversations')
            .insert({
              org_id,
              user_id,
              title: message.slice(0, 100),
              messages: [userMsg, assistantMsg],
            })
            .select('id')
            .single();

          convId = newConv?.id;
        }

        // Extract and save memory from this conversation (non-blocking)
        extractAndSaveMemory(supabase, org_id, message, fullResponse).catch(e =>
          console.error('Memory save failed:', e)
        );

        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ done: true, conversation_id: convId })}\n\n`)
        );
        controller.close();
      },
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('Chat API error:', errMsg, error);
    return Response.json({ error: errMsg }, { status: 500 });
  }
}
