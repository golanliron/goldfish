import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { withAuth } from '@/lib/api-auth';
import pdfParse from 'pdf-parse';
import { geminiAnalyzeDocument, geminiDeepAnalysis, geminiOcrPdf, geminiParseXlsx } from '@/lib/ai/gemini';
import { embedBatch } from '@/lib/ai/rag';
import { stripHtml, chunkText } from '@/lib/utils/text';

// ===== PDF Parsing =====

async function parsePDF(buffer: Buffer): Promise<string> {
  try {
    const result = await pdfParse(buffer);
    if (result.text && result.text.trim().length > 20) {
      return result.text;
    }
  } catch (e) {
    console.error('PDF parse error, trying Gemini fallback:', e);
  }

  // Fallback: Gemini OCR
  try {
    const text = await geminiOcrPdf(buffer);
    if (text.length > 20) return text;
  } catch (e) {
    console.error('Gemini PDF fallback error:', e);
  }

  return '';
}

// ===== DOCX Parsing =====

async function parseDocx(buffer: Buffer): Promise<string> {
  const mammoth = await import('mammoth');
  const extract = mammoth.default?.extractRawText || mammoth.extractRawText;
  const result = await extract({ buffer });
  return result.value || '';
}

// ===== ZIP Parsing =====

async function parseZip(buffer: Buffer): Promise<string> {
  try {
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(buffer);
    const texts: string[] = [];

    for (const [filename, file] of Object.entries(zip.files)) {
      if (file.dir) continue;
      const ext = filename.split('.').pop()?.toLowerCase();
      if (!ext || ['png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'mp4', 'mp3', 'zip'].includes(ext)) continue;

      try {
        const fileBuffer = Buffer.from(await file.async('arraybuffer'));

        if (ext === 'pdf') {
          const text = await parsePDF(fileBuffer);
          if (text.length > 20) texts.push(`=== ${filename} ===\n${text}`);
        } else if (ext === 'docx' || ext === 'doc') {
          const text = await parseDocx(fileBuffer);
          if (text.length > 20) texts.push(`=== ${filename} ===\n${text}`);
        } else if (ext === 'xlsx' || ext === 'xls') {
          const text = await parseXlsx(fileBuffer);
          if (text.length > 20) texts.push(`=== ${filename} ===\n${text}`);
        } else if (['txt', 'md', 'csv', 'html', 'htm'].includes(ext)) {
          const text = fileBuffer.toString('utf-8');
          if (text.length > 20) texts.push(`=== ${filename} ===\n${text.slice(0, 10000)}`);
        }
      } catch { /* skip unreadable file */ }
    }

    return texts.join('\n\n').slice(0, 50000);
  } catch (e) {
    console.error('ZIP parse error:', e);
    return '';
  }
}

// ===== XLSX Parsing =====

async function parseXlsx(buffer: Buffer): Promise<string> {
  try {
    const text = await geminiParseXlsx(buffer);
    if (text.length > 20) return text;
  } catch (e) {
    console.error('XLSX parse error:', e);
  }
  return '[קובץ אקסל — לא הצלחתי לחלץ טקסט. נסו לשמור כ-PDF ולהעלות.]';
}

// ===== URL Fetching =====

function isLinkedInUrl(url: string): boolean {
  return /linkedin\.com\/(company|in|posts|pulse|feed)/i.test(url);
}

function isPdfUrl(url: string): boolean {
  return /\.pdf(\?|$|#)/i.test(url);
}

async function fetchWithJinaReader(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
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
    if (text.length > 200) return text.slice(0, 20000);
    return null;
  } catch {
    return null;
  }
}

async function fetchPdfFromUrl(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'application/pdf,*/*',
      },
    });
    clearTimeout(timeout);

    if (!res.ok) return '';

    const buffer = Buffer.from(await res.arrayBuffer());
    return await parsePDF(buffer);
  } catch (e) {
    clearTimeout(timeout);
    console.error('fetchPdfFromUrl error:', e);
    return '';
  }
}

async function fetchDocxFromUrl(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    clearTimeout(timeout);

    if (!res.ok) return '';

    const buffer = Buffer.from(await res.arrayBuffer());
    return await parseDocx(buffer);
  } catch (e) {
    clearTimeout(timeout);
    console.error('fetchDocxFromUrl error:', e);
    return '';
  }
}

async function fetchUrlSmart(url: string): Promise<{ text: string; source: string }> {
  // 1. LinkedIn — always use Jina Reader (renders JS-heavy pages)
  if (isLinkedInUrl(url)) {
    const text = await fetchWithJinaReader(url);
    if (text) return { text, source: 'linkedin_jina' };
    return { text: '', source: 'linkedin_failed' };
  }

  // 2. PDF URL — download and parse
  if (isPdfUrl(url)) {
    const text = await fetchPdfFromUrl(url);
    if (text) return { text, source: 'pdf_url' };
    return { text: '', source: 'pdf_failed' };
  }

  // 3. DOCX URL
  if (/\.docx?(\?|$|#)/i.test(url)) {
    const text = await fetchDocxFromUrl(url);
    if (text) return { text, source: 'docx_url' };
    return { text: '', source: 'docx_failed' };
  }

  // 4. Regular URL — direct fetch with Jina fallback
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,*/*',
        'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const jinaText = await fetchWithJinaReader(url);
      if (jinaText) return { text: jinaText, source: 'jina_fallback' };
      return { text: '', source: 'fetch_failed' };
    }

    const contentType = res.headers.get('content-type') || '';

    // Binary PDF (URL didn't end with .pdf but content is PDF)
    if (contentType.includes('pdf')) {
      const buffer = Buffer.from(await res.arrayBuffer());
      const text = await parsePDF(buffer);
      if (text) return { text, source: 'pdf_content_type' };
      return { text: '', source: 'pdf_parse_failed' };
    }

    // Binary DOCX
    if (contentType.includes('wordprocessingml') || contentType.includes('msword')) {
      const buffer = Buffer.from(await res.arrayBuffer());
      const text = await parseDocx(buffer);
      if (text) return { text, source: 'docx_content_type' };
      return { text: '', source: 'docx_parse_failed' };
    }

    // Binary XLSX
    if (contentType.includes('spreadsheetml') || contentType.includes('ms-excel')) {
      const buffer = Buffer.from(await res.arrayBuffer());
      const text = await parseXlsx(buffer);
      if (text) return { text, source: 'xlsx_content_type' };
      return { text: '', source: 'xlsx_parse_failed' };
    }

    // ZIP — extract and parse contents
    if (contentType.includes('zip') || contentType.includes('compressed') || url.match(/\.zip(\?|$|#)/i)) {
      const buffer = Buffer.from(await res.arrayBuffer());
      const text = await parseZip(buffer);
      if (text) return { text, source: 'zip_url' };
      return { text: '', source: 'zip_empty' };
    }

    // Skip other binary types
    if (contentType.match(/image|video|audio|octet-stream/)) {
      return { text: '', source: 'binary_unsupported' };
    }

    const html = await res.text();

    if (contentType.includes('json')) {
      return { text: html.slice(0, 15000), source: 'json' };
    }

    const cleaned = stripHtml(html);

    // Short content — try Jina Reader (likely SPA)
    if (cleaned.length < 500) {
      const jinaText = await fetchWithJinaReader(url);
      if (jinaText) return { text: jinaText, source: 'jina_spa' };
    }

    if (cleaned.length < 50) {
      return { text: '', source: 'empty_page' };
    }

    return { text: cleaned.slice(0, 15000), source: 'html' };
  } catch {
    const jinaText = await fetchWithJinaReader(url);
    if (jinaText) return { text: jinaText, source: 'jina_error_fallback' };
    return { text: '', source: 'error' };
  }
}

// ===== AI Classification & Extraction =====

async function classifyAndExtract(text: string, orgName?: string): Promise<{
  category: string;
  metadata: Record<string, unknown>;
  summary: string;
}> {
  return geminiAnalyzeDocument(text, orgName);
}

// ===== Save to RAG =====

async function saveToRag(
  supabase: ReturnType<typeof createAdminClient>,
  orgId: string,
  filename: string,
  fileType: string,
  storagePath: string,
  text: string,
  category: string,
  metadata: Record<string, unknown>,
  summary: string,
  source: string,
  insights?: string,
  missingInfo?: string[]
): Promise<string | null> {
  const { data: doc } = await supabase
    .from('documents')
    .insert({
      org_id: orgId,
      filename,
      file_type: fileType === 'linkedin' ? 'url' : fileType,
      storage_path: storagePath,
      category: category === 'linkedin' ? 'other' : category,
      parsed_text: text.slice(0, 50000),
      metadata: { ...metadata, summary, smart_reader_source: source, ...(insights ? { insights } : {}), ...(missingInfo?.length ? { missing_info: missingInfo } : {}) },
      status: 'ready',
    })
    .select('id')
    .single();

  if (doc) {
    const chunks = chunkText(text);
    // Embed all chunks in batch for RAG search
    let embeddings: number[][] = [];
    try {
      embeddings = await embedBatch(chunks);
    } catch (e) {
      console.error('[smart-reader] embedBatch failed, saving chunks without vectors:', e);
    }
    for (let i = 0; i < chunks.length; i++) {
      await supabase.from('document_chunks').insert({
        document_id: doc.id,
        org_id: orgId,
        content: chunks[i],
        embedding: embeddings[i] ?? null,
        metadata: { category, source: `smart_reader_${source}`, filename },
      });
    }
  }

  return doc?.id || null;
}

// ===== Main Handler =====

export const POST = withAuth(async (request, auth) => {
  try {
    const contentType = request.headers.get('content-type') || '';

    // ===== JSON body: URL or text =====
    if (contentType.includes('application/json')) {
      const { url, text, urls, org_name } = await request.json();
      const org_id = auth.orgId;

      // Fetch org name if not provided
      const supabase = createAdminClient();
      let resolvedOrgName: string | undefined = org_name;
      if (!resolvedOrgName) {
        const { data: profile } = await supabase.from('org_profiles').select('data').eq('org_id', org_id).single();
        resolvedOrgName = (profile?.data as Record<string, unknown>)?.name as string | undefined;
      }

      const results: Array<{
        url?: string;
        document_id: string | null;
        category: string;
        summary: string;
        source: string;
        extracted_fields: Record<string, unknown>;
      }> = [];

      // Handle multiple URLs
      const urlList: string[] = urls || (url ? [url] : []);

      for (const u of urlList) {
        const { text: fetchedText, source } = await fetchUrlSmart(u);

        if (!fetchedText || fetchedText.length < 30) {
          results.push({
            url: u,
            document_id: null,
            category: 'error',
            summary: `לא הצלחתי לקרוא את הלינק (${source})`,
            source,
            extracted_fields: {},
          });
          continue;
        }

        const { category, metadata, summary } = await classifyAndExtract(fetchedText, resolvedOrgName);

        const hostname = (() => { try { return new URL(u).hostname; } catch { return 'unknown'; } })();
        const docId = await saveToRag(
          supabase, org_id, hostname, 'url', u,
          fetchedText, category, metadata, summary, source
        );

        results.push({
          url: u,
          document_id: docId,
          category,
          summary,
          source,
          extracted_fields: metadata,
        });
      }

      // Handle free text
      if (text && text.length > 20) {
        const { category, metadata, summary } = await classifyAndExtract(text);
        const docId = await saveToRag(
          supabase, org_id, 'קלט טקסט', 'txt', `text_${Date.now()}`,
          text, category, metadata, summary, 'free_text'
        );

        results.push({
          document_id: docId,
          category,
          summary,
          source: 'free_text',
          extracted_fields: metadata,
        });
      }

      return NextResponse.json({ results });
    }

    // ===== FormData: file upload =====
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const orgId = auth.orgId;

    if (!file) {
      return NextResponse.json({ error: 'Missing file' }, { status: 400 });
    }

    const supabase = createAdminClient();

    // Fetch org name for accurate extraction
    let uploadOrgName: string | undefined;
    const { data: uploadProfile } = await supabase.from('org_profiles').select('data').eq('org_id', orgId).single();
    uploadOrgName = (uploadProfile?.data as Record<string, unknown>)?.name as string | undefined;
    const ext = file.name.split('.').pop()?.toLowerCase() || 'txt';
    const buffer = Buffer.from(await file.arrayBuffer());

    let parsedText = '';
    let fileType = ext;

    switch (ext) {
      case 'pdf':
        parsedText = await parsePDF(buffer);
        fileType = 'pdf';
        break;
      case 'docx':
      case 'doc':
        parsedText = await parseDocx(buffer);
        fileType = 'docx';
        break;
      case 'xlsx':
      case 'xls':
        parsedText = await parseXlsx(buffer);
        fileType = 'xlsx';
        break;
      case 'zip':
        parsedText = await parseZip(buffer);
        fileType = 'zip';
        break;
      case 'html':
      case 'htm':
        parsedText = stripHtml(buffer.toString('utf-8'));
        fileType = 'txt';
        break;
      case 'txt':
      case 'md':
      case 'csv':
        parsedText = buffer.toString('utf-8');
        fileType = 'txt';
        break;
      default: {
        const asText = buffer.toString('utf-8');
        if (asText.length > 50 && !asText.includes('\u0000')) {
          parsedText = asText;
        }
        fileType = 'txt';
        break;
      }
    }

    if (parsedText.length < 20) {
      return NextResponse.json({
        error: 'לא הצלחתי לחלץ טקסט מהקובץ. נסי PDF, Word, Excel, CSV או TXT.',
      }, { status: 400 });
    }

    // Use deep analysis for file uploads — leverage Pro's full context window
    const analysis = await geminiDeepAnalysis(parsedText, undefined, uploadOrgName);

    // Upload to storage
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    let storagePath = `${orgId}/${Date.now()}_${safeName}`;
    try {
      await supabase.storage.from('documents').upload(storagePath, file);
    } catch {
      storagePath = `local/${safeName}`;
    }

    const docId = await saveToRag(
      supabase, orgId, file.name, fileType, storagePath,
      parsedText, analysis.category, analysis.metadata, analysis.summary, `file_upload_${ext}`,
      analysis.insights, analysis.missing_info
    );

    // Update org profile with extracted data + AI insights
    if (Object.keys(analysis.metadata).length > 0 || analysis.insights) {
      const { data: existing } = await supabase
        .from('org_profiles')
        .select('data')
        .eq('org_id', orgId)
        .single();

      const current = (existing?.data as Record<string, unknown>) || {};
      const merged = { ...current };

      // Merge structured fields from extraction
      for (const key of ['name', 'registration_number', 'founded_year', 'mission', 'focus_areas', 'target_populations', 'sub_populations', 'regions', 'beneficiaries_count', 'employees_count', 'volunteers_count', 'annual_budget', 'revenue_sources', 'partners', 'impact_metrics', 'key_achievements', 'key_people', 'contact_name', 'contact_email', 'contact_phone', 'website', 'theory_of_change', 'unique_model', 'strengths', 'challenges', 'age_range', 'certifications']) {
        if (analysis.metadata[key]) merged[key] = analysis.metadata[key];
      }

      // Save AI insights for grant writing context
      if (analysis.insights) merged.ai_insights = analysis.insights;
      if (analysis.missing_info?.length) {
        const existingMissing = (merged.missing_info as string[]) || [];
        const newMissing = analysis.missing_info.filter((m: string) => !existingMissing.includes(m));
        merged.missing_info = [...existingMissing, ...newMissing];
      }

      await supabase.from('org_profiles').upsert({
        org_id: orgId,
        data: merged,
        last_updated: new Date().toISOString(),
      }, { onConflict: 'org_id' });
    }

    return NextResponse.json({
      document_id: docId,
      category: analysis.category,
      summary: analysis.summary,
      insights: analysis.insights,
      missing_info: analysis.missing_info,
      source: `file_${ext}`,
      extracted_fields: analysis.metadata,
    });
  } catch (error) {
    console.error('Smart reader error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
});
