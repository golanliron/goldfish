import { withAuth } from '@/lib/api-auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { geminiClassify, geminiExtract, geminiSummarize, geminiOcrPdf, geminiParseXlsx } from '@/lib/ai/gemini';
import { embedBatch } from '@/lib/ai/rag';
import pdfParse from 'pdf-parse';

export const maxDuration = 60;

// ===== Text extraction from Buffer =====

async function parsePDF(buffer: Buffer): Promise<string> {
  try {
    const result = await pdfParse(buffer);
    if (result.text && result.text.trim().length > 20) return result.text;
  } catch { /* fall through to Gemini */ }
  try {
    const text = await geminiOcrPdf(buffer);
    if (text.length > 20) return text;
  } catch { /* give up */ }
  return '';
}

async function parseDocx(buffer: Buffer): Promise<string> {
  const mammoth = await import('mammoth');
  const extract = mammoth.default?.extractRawText || mammoth.extractRawText;
  const result = await extract({ buffer });
  return result.value || '';
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ').trim();
}

async function extractTextFromBuffer(buffer: Buffer, ext: string, filename: string): Promise<string> {
  switch (ext) {
    case 'pdf': return parsePDF(buffer);
    case 'docx': case 'doc': return parseDocx(buffer);
    case 'xlsx': case 'xls': return (await geminiParseXlsx(buffer)) || `[קובץ אקסל: ${filename}]`;
    case 'html': case 'htm': return stripHtml(buffer.toString('utf-8'));
    case 'txt': case 'md': case 'csv': return buffer.toString('utf-8');
    default: {
      const text = buffer.toString('utf-8');
      return (text.length > 100 && !text.includes('\u0000')) ? text : `[קובץ ${ext}: ${filename}]`;
    }
  }
}

function chunkText(text: string, maxChars = 2000): string[] {
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

// ===== Main Handler =====

export const POST = withAuth(async (request, auth) => {
  const orgId = auth.orgId;
  const { document_id } = await request.json();

  if (!document_id) {
    return Response.json({ error: 'Missing document_id' }, { status: 400 });
  }

  const supabase = createAdminClient();

  // Verify document belongs to this org
  const { data: doc, error: fetchError } = await supabase
    .from('documents')
    .select('id, filename, file_type, storage_path, status')
    .eq('id', document_id)
    .eq('org_id', orgId)
    .single();

  if (fetchError || !doc) {
    return Response.json({ error: 'Document not found or access denied' }, { status: 404 });
  }

  if (doc.status !== 'processing') {
    // Already processed — return current status
    return Response.json({ document_id: doc.id, status: doc.status });
  }

  const markError = async (msg: string) => {
    await supabase.from('documents').update({
      status: 'error',
      metadata: { error: msg.slice(0, 200) },
    }).eq('id', doc.id);
  };

  // Download file from Storage
  const { data: fileData, error: downloadError } = await supabase.storage
    .from('documents')
    .download(doc.storage_path);

  if (downloadError || !fileData) {
    await markError(`storage download failed: ${downloadError?.message || 'file not found'}`);
    return Response.json({ error: 'הקובץ לא נמצא ב-Storage — ייתכן שההעלאה לא הסתיימה' }, { status: 422 });
  }

  const buffer = Buffer.from(await fileData.arrayBuffer());
  const ext = doc.file_type || doc.filename.split('.').pop()?.toLowerCase() || 'txt';

  // Extract text
  let parsedText = '';
  try {
    parsedText = await extractTextFromBuffer(buffer, ext, doc.filename);
  } catch (e) {
    await markError(`text extraction failed: ${e instanceof Error ? e.message : String(e)}`);
    return Response.json({ error: 'לא הצלחתי לחלץ טקסט מהקובץ' }, { status: 422 });
  }

  if (parsedText.length < 20) {
    await markError('extracted text too short');
    return Response.json({ error: 'לא הצלחתי לחלץ טקסט — נסי PDF, Word, Excel, CSV או TXT' }, { status: 422 });
  }

  // Get org name for context-aware extraction
  const { data: orgData } = await supabase.from('organizations').select('name').eq('id', orgId).single();
  const orgName = orgData?.name || undefined;

  // Gemini classify + extract + summarize (each non-fatal)
  let category = 'other';
  let finalMetadata: Record<string, unknown> = {};
  let summary = `קובץ: ${doc.filename}`;
  try { category = await geminiClassify(parsedText); } catch { /* keep 'other' */ }
  try { finalMetadata = await geminiExtract(parsedText, category, orgName); } catch { /* keep empty */ }
  try { summary = await geminiSummarize(parsedText); } catch { /* keep filename */ }

  // Update document to ready
  await supabase.from('documents').update({
    category,
    parsed_text: parsedText.slice(0, 50000),
    metadata: { ...finalMetadata, summary },
    status: 'ready',
  }).eq('id', doc.id);

  // Chunks + embeddings (non-fatal)
  try {
    const chunks = chunkText(parsedText);
    let embeddings: number[][] = [];
    try { embeddings = await embedBatch(chunks); } catch { /* without vectors */ }
    for (let i = 0; i < chunks.length; i++) {
      await supabase.from('document_chunks').insert({
        document_id: doc.id,
        org_id: orgId,
        content: chunks[i],
        embedding: embeddings[i] ?? null,
        metadata: { category, filename: doc.filename },
      });
    }
  } catch { /* chunks failure doesn't affect document status */ }

  // Update org profile (non-fatal)
  try {
    const { data: existing } = await supabase.from('org_profiles').select('data').eq('org_id', orgId).single();
    const current = (existing?.data as Record<string, unknown>) || {};
    const merged = { ...current };
    for (const key of ['name', 'registration_number', 'founded_year', 'mission', 'focus_areas', 'target_populations', 'annual_budget', 'contact_name', 'contact_email', 'contact_phone', 'website', 'theory_of_change', 'unique_model', 'strengths', 'age_range']) {
      if (finalMetadata[key] && !merged[key]) merged[key] = finalMetadata[key];
    }
    await supabase.from('org_profiles').upsert({ org_id: orgId, data: merged, last_updated: new Date().toISOString() }, { onConflict: 'org_id' });
  } catch { /* non-blocking */ }

  // Seed org_memory (non-fatal)
  try {
    const CATEGORY_TO_MEM: Record<string, string> = { identity: 'identity', official: 'identity', impact: 'impact', budget: 'operations', project: 'operations', grant: 'submissions', other: 'dna' };
    const memCat = CATEGORY_TO_MEM[category] || 'dna';
    const fieldPriority = memCat === 'identity' ? ['name', 'mission', 'registration_number', 'website']
      : memCat === 'impact' ? ['impact_metrics', 'key_achievements', 'beneficiaries_count']
      : memCat === 'operations' ? ['annual_budget', 'employees_count', 'active_projects']
      : memCat === 'submissions' ? ['funder', 'amount', 'doc_type']
      : ['focus_areas', 'target_populations', 'theory_of_change', 'unique_model'];

    const records: { key: string; value: string; confidence: 'medium' | 'high'; depth: number }[] = [];
    for (const field of fieldPriority) {
      if (records.length >= 3) break;
      const val = finalMetadata[field];
      if (!val) continue;
      const strVal = typeof val === 'string' ? val : JSON.stringify(val);
      if (strVal.length < 3) continue;
      records.push({ key: `doc_${doc.id.slice(0, 8)}_${field}`, value: strVal.slice(0, 300), confidence: strVal.length > 20 ? 'high' : 'medium', depth: strVal.length > 50 ? 2 : 1 });
    }
    if (records.length === 0) records.push({ key: `doc_${doc.id.slice(0, 8)}_uploaded`, value: `מסמך מסוג ${category} הועלה`, confidence: 'medium', depth: 1 });

    for (const rec of records) {
      await supabase.from('org_memory').upsert({ org_id: orgId, key: rec.key, value: rec.value, source: 'document_upload', confidence: rec.confidence, category: memCat, depth: rec.depth, updated_at: new Date().toISOString() }, { onConflict: 'org_id,key' });
    }
  } catch { /* non-blocking */ }

  return Response.json({ document_id: doc.id, status: 'ready', category, summary });
});
