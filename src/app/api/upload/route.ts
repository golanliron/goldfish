import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { withAuth } from '@/lib/api-auth';
import pdfParse from 'pdf-parse';
import { geminiClassify, geminiExtract, geminiSummarize, geminiOcrPdf, geminiParseXlsx, geminiCall } from '@/lib/ai/gemini';
import { embedBatch } from '@/lib/ai/rag';
import { REQUIRED_VAULT_DOCS } from '@/lib/vault-docs';
import { analyzeRejectionLetter } from '@/lib/ai/funder-learning';

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

// DOCX: mammoth — try all known export shapes
async function parseDocx(buffer: Buffer): Promise<string> {
  const mammoth = await import('mammoth');
  // ESM/CJS interop: extractRawText may live on default or on the module directly
  const extract =
    (mammoth as unknown as { extractRawText: (opts: { buffer: Buffer }) => Promise<{ value: string }> }).extractRawText ||
    (mammoth.default as unknown as { extractRawText: (opts: { buffer: Buffer }) => Promise<{ value: string }> })?.extractRawText;
  if (!extract) throw new Error('mammoth.extractRawText not found');
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

async function extractStructuredData(text: string, category: string, orgName?: string): Promise<Record<string, unknown>> {
  return geminiExtract(text, category, orgName);
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

// ===== Vault Document Validation =====

// Match by filename OR by content snippet (first 1000 chars)
function detectVaultDocType(filename: string, contentSnippet?: string): typeof REQUIRED_VAULT_DOCS[number] | null {
  const combined = `${filename} ${contentSnippet?.slice(0, 1000) || ''}`;
  for (const req of REQUIRED_VAULT_DOCS) {
    if (req.pattern.test(combined)) return req;
  }
  return null;
}

interface VaultValidationResult {
  vaultKey: string | null;
  vaultLabel: string | null;
  isGenuine: boolean;
  expiryDate: string | null; // ISO date string YYYY-MM-DD
  isExpired: boolean;
  warning: string | null;
}

async function validateVaultDoc(text: string, filename: string): Promise<VaultValidationResult> {
  // Try to detect vault type from filename + content
  const match = detectVaultDocType(filename, text);
  if (!match) {
    return { vaultKey: null, vaultLabel: null, isGenuine: true, expiryDate: null, isExpired: false, warning: null };
  }

  const snippet = text.slice(0, 3000);

  // Ask Gemini: verify doc type + extract expiry date
  const prompt = `אתה מומחה לניתוח מסמכים רשמיים ישראליים.

סוג המסמך הצפוי: "${match.label}" (${match.hint})
תוכן המסמך (עד 3000 תווים):
---
${snippet}
---

ענה ONLY בפורמט JSON בלי הסבר נוסף:
{
  "is_genuine": true,
  "expiry_date": "YYYY-MM-DD",
  "confidence": "high"
}

חוקים:
- is_genuine: false רק אם הטקסט ריק לחלוטין או ברור שזה מסמך אחר לגמרי
- expiry_date: חפש תאריך "בתוקף עד", "תוקף", "valid until", "expires" — פורמט YYYY-MM-DD. null אם אין
- confidence: high/medium/low לפי בהירות הזיהוי`;

  try {
    const raw = await geminiCall(prompt, 150, 0);
    const jsonMatch = raw.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) throw new Error('no json');
    const parsed = JSON.parse(jsonMatch[0]);

    const expiryDate = (typeof parsed.expiry_date === 'string' && parsed.expiry_date !== 'null')
      ? parsed.expiry_date
      : null;
    const isExpired = expiryDate ? new Date(expiryDate) < new Date() : false;
    const isGenuine = parsed.is_genuine !== false;

    let warning: string | null = null;
    if (!isGenuine) {
      warning = `הקובץ שהועלה אינו נראה כ"${match.label}" — יתכן שהועלה הקובץ הלא נכון`;
    } else if (isExpired && expiryDate) {
      const d = new Date(expiryDate);
      const formatted = d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
      warning = `שימו לב — המסמך שהעליתם (${match.label}) אינו בתוקף. פג תוקפו ב-${formatted}`;
    }

    return { vaultKey: match.key, vaultLabel: match.label, isGenuine, expiryDate, isExpired, warning };
  } catch {
    // Validation failed silently — doc still saved, just no vault metadata
    return { vaultKey: match.key, vaultLabel: match.label, isGenuine: true, expiryDate: null, isExpired: false, warning: null };
  }
}

// ===== Route Config =====

export const maxDuration = 60;

// ===== Main Handler =====

export const POST = withAuth(async (request, auth) => {
  try {
    const contentType = request.headers.get('content-type') || '';

    // ===== JSON body: free-text or URL input =====
    if (contentType.includes('application/json')) {
      const { text, category, filename } = await request.json();
      const org_id = auth.orgId;
      if (!text) {
        return Response.json({ error: 'Missing text' }, { status: 400 });
      }

      const supabase = createAdminClient();
      const cat = category || 'identity';

      // Get org name for context-aware extraction
      const { data: orgData } = await supabase.from('organizations').select('name').eq('id', org_id).single();
      const orgName = orgData?.name || undefined;

      // Classify + extract + summarize
      const [aiCategory, metadata, summary] = await Promise.all([
        cat === 'identity' ? Promise.resolve('identity') : classifyDocument(text),
        extractStructuredData(text, cat, orgName),
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
        // Save chunks for RAG with embeddings
        const chunks = chunkText(text);
        let embeddings: number[][] = [];
        try { embeddings = await embedBatch(chunks); } catch { /* save without vectors */ }
        for (let i = 0; i < chunks.length; i++) {
          await supabase.from('document_chunks').insert({
            document_id: doc.id,
            org_id,
            content: chunks[i],
            embedding: embeddings[i] ?? null,
            metadata: { category: aiCategory, filename: filename || 'free_text' },
          });
        }
        // Seed org_memory from extracted metadata
        await seedMemoryFromDoc(supabase, org_id, doc.id, aiCategory, metadata);
      }

      // Update org profile
      await updateOrgProfile(supabase, org_id, aiCategory, metadata);

      return Response.json({ document_id: doc?.id, category: aiCategory, summary, extracted_fields: metadata });
    }

    // ===== FormData: file upload =====
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const orgId = auth.orgId;

    if (!file) {
      return Response.json({ error: 'Missing file' }, { status: 400 });
    }

    const supabase = createAdminClient();

    // Get org name for context-aware extraction
    const { data: orgData } = await supabase.from('organizations').select('name').eq('id', orgId).single();
    const orgName = orgData?.name || undefined;

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

    // 1. Determine fileType from extension (before any processing)
    const fileType = file.name.split('.').pop()?.toLowerCase() || 'txt';

    // 2. Build final storagePath once
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `${orgId}/${Date.now()}_${safeName}`;

    // 3. Create document record immediately — status=processing
    // This ensures the document appears in the dashboard even if enrichment fails
    const { data: doc, error: docError } = await supabase
      .from('documents')
      .insert({
        org_id: orgId,
        filename: file.name,
        file_type: fileType,
        storage_path: storagePath,
        category: 'other',
        parsed_text: null,
        metadata: {},
        status: 'processing',
      })
      .select('id')
      .single();

    if (docError || !doc) {
      console.error('Doc insert error:', JSON.stringify(docError));
      return Response.json({ error: `Failed to create document: ${docError?.message || 'unknown'}` }, { status: 500 });
    }

    // Helper to mark doc as error
    const markError = async (msg: string) => {
      await supabase.from('documents').update({
        status: 'error',
        metadata: { error: msg.slice(0, 200) },
      }).eq('id', doc.id);
    };

    // 4. Upload to storage
    try {
      await supabase.storage.from('documents').upload(storagePath, file);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await markError(`storage upload failed: ${msg}`);
      return Response.json({ error: 'שגיאה בהעלאת הקובץ לאחסון' }, { status: 500 });
    }

    // 5. Extract text
    let parsedText = '';
    try {
      const extracted = await extractTextFromFile(file);
      parsedText = extracted.text;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await markError(`text extraction failed: ${msg}`);
      return Response.json({ error: 'לא הצלחתי לחלץ טקסט מהקובץ' }, { status: 400 });
    }

    if (parsedText.length < 20) {
      await markError('extracted text too short');
      return Response.json({ error: 'לא הצלחתי לחלץ טקסט מהקובץ. נסי PDF, Word, Excel, CSV או TXT.' }, { status: 400 });
    }

    // 6. Gemini classify + extract + summarize (each in try/catch)
    let category = 'other';
    let finalMetadata: Record<string, unknown> = {};
    let summary = `קובץ: ${file.name}`;
    try { category = await classifyDocument(parsedText); } catch { /* keep 'other' */ }
    try { finalMetadata = await extractStructuredData(parsedText, category, orgName); } catch { /* keep empty */ }
    try { summary = await summarizeDocument(parsedText); } catch { /* keep filename */ }

    // 6.5 Rejection letter detection — learn from failure
    let rejectionInsight: string | null = null;
    const isRejectionLetter = /דחייה|נדחה|נדחית|rejected|rejection|regret|unfortunately|לא נוכל לאשר|לא אושרה|לא עברתם|הבקשה לא|not approved|unable to fund/i.test(parsedText.slice(0, 1000));
    if (isRejectionLetter || category === 'rejection') {
      category = 'rejection';
      try {
        const rejection = await analyzeRejectionLetter(parsedText, orgId);
        if (rejection.rawInsight) {
          rejectionInsight = rejection.rawInsight;
          finalMetadata = {
            ...finalMetadata,
            rejection_funder: rejection.funderName,
            rejection_reasons: rejection.rejectionReasons,
            improvement_tips: rejection.improvementTips,
          };
        }
      } catch { /* non-fatal */ }
    }

    // 6.6 Vault validation — detect type, verify genuineness, extract expiry date
    let vaultWarning: string | null = null;
    try {
      const vault = await validateVaultDoc(parsedText, file.name);
      if (vault.expiryDate) {
        finalMetadata = { ...finalMetadata, expiry_date: vault.expiryDate };
      }
      if (vault.vaultKey) {
        finalMetadata = { ...finalMetadata, vault_key: vault.vaultKey };
        // Override category to 'official' for vault docs
        category = 'official';
      }
      if (vault.warning) {
        vaultWarning = vault.warning;
      }
    } catch { /* vault validation failure does not block upload */ }

    // 7. Update document with enriched data — status=ready
    const { error: updateError } = await supabase.from('documents').update({
      category,
      parsed_text: parsedText.slice(0, 50000),
      metadata: { ...finalMetadata, summary },
      status: 'ready',
    }).eq('id', doc.id);

    if (updateError) {
      console.error('[upload] DB update failed:', JSON.stringify(updateError));
      await markError(`DB update failed: ${updateError.message}`);
      return Response.json({ error: `שגיאה בשמירת המסמך: ${updateError.message}` }, { status: 500 });
    }

    // 8. Store chunks for RAG with embeddings (non-fatal)
    try {
      const chunks = chunkText(parsedText);
      let chunkEmbeddings: number[][] = [];
      try { chunkEmbeddings = await embedBatch(chunks); } catch { /* save without vectors */ }
      for (let i = 0; i < chunks.length; i++) {
        await supabase.from('document_chunks').insert({
          document_id: doc.id,
          org_id: orgId,
          content: chunks[i],
          embedding: chunkEmbeddings[i] ?? null,
          metadata: { category, filename: file.name },
        });
      }
    } catch { /* chunks failure does not affect document status */ }

    // 9. Update org profile (non-fatal)
    try { await updateOrgProfile(supabase, orgId, category, finalMetadata); } catch { /* non-blocking */ }

    // 10. Seed org_memory (non-fatal)
    try { await seedMemoryFromDoc(supabase, orgId, doc.id, category, finalMetadata); } catch { /* non-blocking */ }

    // Build human-readable message for immediate UI display
    const vaultKey = (finalMetadata.vault_key as string) || null;
    const expiryDate = (finalMetadata.expiry_date as string) || null;
    const VAULT_LABELS: Record<string, string> = {
      nihul_takin: 'ניהול תקין', seif_46: 'סעיף 46', nikuy_mas: 'ניכוי מס במקור',
      'teudат_rіshum': 'תעודת רישום', 'doch_kaspі': 'דוח כספי', nihul_sfarim: 'ניהול ספרים',
      vaad_mnahel: 'חברי ועד', "ba'al_heshbon": 'אישור בנק',
    };
    let message: string;
    if (vaultWarning) {
      message = `⚠️ ${vaultWarning}`;
    } else if (vaultKey) {
      const label = VAULT_LABELS[vaultKey] || vaultKey;
      if (expiryDate) {
        const formatted = new Date(expiryDate).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
        message = `✅ זוהה כ"${label}", בתוקף עד ${formatted}`;
      } else {
        message = `✅ זוהה כ"${label}"`;
      }
    } else {
      message = summary || `הקובץ נקלט`;
    }

    return Response.json({
      status: 'ready',
      document_id: doc.id,
      category,
      summary,
      message,
      expiry_date: expiryDate,
      vault_key: vaultKey,
      vault_warning: vaultWarning,
      rejection_insight: rejectionInsight,
      extracted_fields: finalMetadata,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('Upload error:', msg, error);
    return Response.json({ error: `שגיאה בעיבוד: ${msg.slice(0, 200)}` }, { status: 500 });
  }
});

// ===== Seed org_memory from document metadata =====

const CATEGORY_TO_MEMORY: Record<string, string> = {
  identity: 'identity',
  official: 'identity',
  impact: 'impact',
  budget: 'operations',
  project: 'operations',
  grant: 'submissions',
  other: 'dna',
};

async function seedMemoryFromDoc(
  supabase: ReturnType<typeof createAdminClient>,
  orgId: string,
  docId: string,
  category: string,
  metadata: Record<string, unknown>
) {
  const memCat = CATEGORY_TO_MEMORY[category] || 'dna';

  // Build 1-3 memory records from extracted metadata fields
  const records: { key: string; value: string; confidence: 'medium' | 'high'; depth: number }[] = [];

  // Pick the most meaningful fields per category
  const fieldPriority: string[] = [];
  if (memCat === 'identity') fieldPriority.push('name', 'mission', 'registration_number', 'founded_year', 'website');
  else if (memCat === 'impact') fieldPriority.push('impact_metrics', 'key_achievements', 'beneficiaries_count');
  else if (memCat === 'operations') fieldPriority.push('annual_budget', 'employees_count', 'active_projects', 'revenue_sources');
  else if (memCat === 'submissions') fieldPriority.push('funder', 'amount', 'doc_type');
  else fieldPriority.push('focus_areas', 'target_populations', 'theory_of_change', 'unique_model');

  for (const field of fieldPriority) {
    if (records.length >= 3) break;
    const val = metadata[field];
    if (!val) continue;
    const strVal = typeof val === 'string' ? val : JSON.stringify(val);
    if (strVal.length < 3) continue;

    records.push({
      key: `doc_${docId.slice(0, 8)}_${field}`,
      value: strVal.slice(0, 300),
      confidence: strVal.length > 20 ? 'high' : 'medium',
      depth: strVal.length > 50 ? 2 : 1,
    });
  }

  // Always add at least one record: the document category fact
  if (records.length === 0) {
    records.push({
      key: `doc_${docId.slice(0, 8)}_uploaded`,
      value: `מסמך מסוג ${category} הועלה`,
      confidence: 'medium',
      depth: 1,
    });
  }

  for (const rec of records) {
    await supabase.from('org_memory').upsert(
      {
        org_id: orgId,
        key: rec.key,
        value: rec.value,
        source: 'document_upload',
        confidence: rec.confidence,
        category: memCat,
        depth: rec.depth,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'org_id,key' }
    );
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
  for (const key of ['name', 'registration_number', 'founded_year', 'mission', 'focus_areas', 'target_populations', 'sub_populations', 'regions', 'beneficiaries_count', 'employees_count', 'volunteers_count', 'annual_budget', 'revenue_sources', 'partners', 'impact_metrics', 'key_achievements', 'key_people', 'contact_name', 'contact_email', 'contact_phone', 'website', 'theory_of_change', 'unique_model', 'strengths', 'challenges', 'age_range', 'certifications']) {
    if (newData[key] && !merged[key]) merged[key] = newData[key];
  }

  // Category-specific overrides (these always update, not just fill gaps)
  if (category === 'official') {
    // Official docs: extract registration numbers, certifications
    for (const key of ['registration_number', 'certifications', 'founded_year']) {
      if (newData[key]) merged[key] = newData[key];
    }
    // Track which official docs exist
    const officialDocs = (merged.official_docs as string[]) || [];
    if (newData.doc_type && !officialDocs.includes(newData.doc_type as string)) {
      merged.official_docs = [...officialDocs, newData.doc_type as string];
    }
  } else if (category === 'identity') {
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
