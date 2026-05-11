import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import pdfParse from 'pdf-parse';
import { geminiClassify, geminiExtract, geminiSummarize, geminiOcrPdf, geminiParseXlsx } from '@/lib/ai/gemini';

// PDF: use pdf-parse v1, fallback to Gemini OCR
async function parsePDF(buffer: Buffer): Promise<string> {
  try {
    const result = await pdfParse(buffer);
    if (result.text && result.text.trim().length > 20) {
      return result.text;
    }
  } catch (e) {
    console.error('PDF parse error, trying Gemini fallback:', e);
  }

  try {
    const text = await geminiOcrPdf(buffer);
    if (text.length > 20) return text;
  } catch (e) {
    console.error('Gemini PDF fallback error:', e);
  }

  return '';
}

// DOCX: mammoth works fine with dynamic import
async function parseDocx(buffer: Buffer): Promise<string> {
  const mammoth = await import('mammoth');
  const extract = mammoth.default?.extractRawText || mammoth.extractRawText;
  const result = await extract({ buffer });
  return result.value || '';
}

// ===== Text Extraction =====

async function extractTextFromFile(file: File): Promise<{ text: string; fileType: string }> {
  const ext = file.name.split('.').pop()?.toLowerCase() || 'txt';
  const buffer = Buffer.from(await file.arrayBuffer());

  switch (ext) {
    case 'pdf': {
      const text = await parsePDF(buffer);
      return { text, fileType: 'pdf' };
    }
    case 'docx':
    case 'doc': {
      const text = await parseDocx(buffer);
      return { text, fileType: 'docx' };
    }
    case 'xlsx':
    case 'xls': {
      const text = await geminiParseXlsx(buffer);
      return { text: text || `[קובץ אקסל: ${file.name}]`, fileType: 'xlsx' };
    }
    case 'html':
    case 'htm': {
      const html = buffer.toString('utf-8');
      const cleaned = stripHtml(html);
      return { text: cleaned, fileType: 'html' };
    }
    case 'txt':
    case 'md':
    case 'csv': {
      return { text: buffer.toString('utf-8'), fileType: ext };
    }
    default: {
      const text = buffer.toString('utf-8');
      if (text.length > 100 && !text.includes('\u0000')) {
        return { text, fileType: ext };
      }
      return { text: `[קובץ ${ext}: ${file.name}]`, fileType: ext };
    }
  }
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

// ===== AI Classification & Extraction (Gemini) =====

async function classifyDocument(text: string): Promise<string> {
  return geminiClassify(text);
}

async function extractStructuredData(text: string, category: string): Promise<Record<string, unknown>> {
  return geminiExtract(text, category);
}

async function summarizeDocument(text: string): Promise<string> {
  return geminiSummarize(text);
}

// ===== Chunking =====

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

// ===== Route Config =====

export const maxDuration = 60;

// ===== Main Handler =====

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type') || '';

    // ===== JSON body: free-text or URL input =====
    if (contentType.includes('application/json')) {
      const { org_id, text, category, filename } = await request.json();
      if (!org_id || !text) {
        return Response.json({ error: 'Missing org_id or text' }, { status: 400 });
      }

      const supabase = createAdminClient();
      const cat = category || 'identity';

      // Classify + extract + summarize
      const [aiCategory, metadata, summary] = await Promise.all([
        cat === 'identity' ? Promise.resolve('identity') : classifyDocument(text),
        extractStructuredData(text, cat),
        summarizeDocument(text),
      ]);

      // Save as document
      const { data: doc } = await supabase
        .from('documents')
        .insert({
          org_id,
          filename: filename || 'תיאור חופשי.txt',
          file_type: 'txt',
          storage_path: `${org_id}/text_${Date.now()}.txt`,
          category: aiCategory,
          parsed_text: text.slice(0, 50000),
          metadata: { ...metadata, summary },
          status: 'ready',
        })
        .select('id')
        .single();

      if (doc) {
        // Save chunks for RAG
        const chunks = chunkText(text);
        for (const chunk of chunks) {
          await supabase.from('document_chunks').insert({
            document_id: doc.id,
            org_id,
            content: chunk,
            metadata: { category: aiCategory, filename: filename || 'free_text' },
          });
        }
      }

      // Update org profile
      await updateOrgProfile(supabase, org_id, aiCategory, metadata);

      return Response.json({ document_id: doc?.id, category: aiCategory, summary, extracted_fields: metadata });
    }

    // ===== FormData: file upload =====
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const orgId = formData.get('org_id') as string;

    if (!orgId || !file) {
      return Response.json({ error: 'Missing file or org_id' }, { status: 400 });
    }

    const supabase = createAdminClient();

    // Check for duplicate file
    const { data: existingDoc } = await supabase
      .from('documents')
      .select('id')
      .eq('org_id', orgId)
      .eq('filename', file.name)
      .limit(1);

    if (existingDoc && existingDoc.length > 0) {
      return Response.json({
        document_id: existingDoc[0].id,
        category: 'existing',
        summary: `"${file.name}" כבר קיים במערכת`,
        already_exists: true,
      });
    }

    // 1. Extract text from file
    const { text: parsedText, fileType } = await extractTextFromFile(file);

    if (parsedText.length < 20) {
      return Response.json({
        error: 'לא הצלחתי לחלץ טקסט מהקובץ. נסי פורמט אחר (PDF, DOCX, TXT).',
      }, { status: 400 });
    }

    // 2. Classify + Extract + Summarize in parallel
    const [category, metadata, summary] = await Promise.all([
      classifyDocument(parsedText),
      extractStructuredData(parsedText, 'identity'),
      summarizeDocument(parsedText),
    ]);

    // Re-extract with correct category if not identity
    let finalMetadata = metadata;
    if (category !== 'identity') {
      finalMetadata = await extractStructuredData(parsedText, category);
    }

    // 3. Upload to storage (non-blocking)
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    let storagePath = `${orgId}/${Date.now()}_${safeName}`;
    try {
      await supabase.storage.from('documents').upload(storagePath, file);
    } catch {
      storagePath = `local/${safeName}`;
    }

    // 4. Save document record
    const { data: doc, error: docError } = await supabase
      .from('documents')
      .insert({
        org_id: orgId,
        filename: file.name,
        file_type: fileType,
        storage_path: storagePath,
        category,
        parsed_text: parsedText.slice(0, 50000),
        metadata: { ...finalMetadata, summary },
        status: 'ready',
      })
      .select('id')
      .single();

    if (docError || !doc) {
      console.error('Doc insert error:', docError);
      return Response.json({ error: 'Failed to save document' }, { status: 500 });
    }

    // 5. Store chunks for RAG
    const chunks = chunkText(parsedText);
    for (const chunkContent of chunks) {
      await supabase.from('document_chunks').insert({
        document_id: doc.id,
        org_id: orgId,
        content: chunkContent,
        metadata: { category, filename: file.name },
      });
    }

    // 6. Update org profile
    await updateOrgProfile(supabase, orgId, category, finalMetadata);

    return Response.json({
      document_id: doc.id,
      category,
      summary,
      extracted_fields: finalMetadata,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('Upload error:', msg, error);
    return Response.json({ error: `שגיאה בעיבוד: ${msg.slice(0, 200)}` }, { status: 500 });
  }
}

// ===== Org Profile Update =====

async function updateOrgProfile(
  supabase: ReturnType<typeof createAdminClient>,
  orgId: string,
  category: string,
  newData: Record<string, unknown>
) {
  const { data: existing } = await supabase
    .from('org_profiles')
    .select('data')
    .eq('org_id', orgId)
    .single();

  const current = (existing?.data as Record<string, unknown>) || {};
  const merged = { ...current };

  // Always merge core identity fields regardless of category
  for (const key of ['name', 'registration_number', 'founded_year', 'mission', 'focus_areas', 'target_populations', 'regions', 'beneficiaries_count', 'employees_count', 'volunteers_count', 'annual_budget', 'revenue_sources', 'partners', 'impact_metrics', 'key_achievements', 'key_people', 'contact_name', 'contact_email', 'contact_phone', 'website']) {
    if (newData[key] && !merged[key]) merged[key] = newData[key];
  }

  // Category-specific overrides (these always update, not just fill gaps)
  if (category === 'identity') {
    for (const key of ['name', 'registration_number', 'founded_year', 'mission', 'focus_areas', 'target_populations', 'regions', 'beneficiaries_count', 'employees_count', 'volunteers_count']) {
      if (newData[key]) merged[key] = newData[key];
    }
  } else if (category === 'budget') {
    if (newData.annual_budget) merged.annual_budget = newData.annual_budget;
    if (newData.revenue_sources) merged.revenue_sources = newData.revenue_sources;
  } else if (category === 'impact') {
    if (newData.impact_metrics) merged.impact_metrics = newData.impact_metrics;
    if (newData.key_achievements) merged.key_achievements = newData.key_achievements;
    if (newData.beneficiaries_count) merged.beneficiaries_count = newData.beneficiaries_count;
  } else if (category === 'project') {
    const projects = (merged.active_projects as unknown[]) || [];
    projects.push(newData);
    merged.active_projects = projects;
  } else if (category === 'grant') {
    const grants = (merged.existing_grants as unknown[]) || [];
    grants.push(newData);
    merged.existing_grants = grants;
  }

  await supabase.from('org_profiles').upsert({
    org_id: orgId,
    data: merged,
    last_updated: new Date().toISOString(),
  }, { onConflict: 'org_id' });
}
