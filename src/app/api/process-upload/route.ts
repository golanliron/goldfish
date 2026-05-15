import { withAuth } from '@/lib/api-auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { geminiClassify, geminiExtract, geminiSummarize } from '@/lib/ai/gemini';
import { embedBatch, upsertChunk } from '@/lib/ai/rag';
import { parseFileContent } from '@/lib/utils/file-parser';
import { extractOrgDNA, extractOrgDNAWithAI, mergeOrgDNA } from '@/lib/ai/org-dna';
import { calculateOrgScore } from '@/lib/ai/org-score';
import { extractProfileData } from '@/lib/ai/profile-autopilot';
import { REQUIRED_VAULT_DOCS } from '@/lib/vault-docs';

export const maxDuration = 60;

// Derive extension from filename for mime-type-agnostic fallback
function extFromFilename(filename: string): string {
  return filename.split('.').pop()?.toLowerCase() ?? '';
}

// Map stored file_type extension to a pseudo-MIME so parseFileContent can route correctly
function extToMime(ext: string): string {
  const map: Record<string, string> = {
    pdf:  'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    doc:  'application/msword',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xls:  'application/vnd.ms-excel',
    csv:  'text/csv',
    txt:  'text/plain',
    md:   'text/markdown',
    html: 'text/html',
    htm:  'text/html',
  };
  return map[ext] ?? 'application/octet-stream';
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
    const { error: markErr } = await supabase.from('documents').update({
      status: 'error',
      metadata: { error: msg.slice(0, 200) },
    }).eq('id', doc.id);
    if (markErr) console.error('[process-upload] markError UPDATE failed:', markErr.message, markErr);
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
  const ext = doc.file_type || extFromFilename(doc.filename);
  const mimeType = extToMime(ext);

  // Extract text
  let parsedText = '';
  try {
    parsedText = await parseFileContent(buffer, mimeType, doc.filename);
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
  const VALID_CATEGORIES = new Set(['identity', 'budget', 'project', 'grant', 'submission', 'other', 'impact', 'project_budget']);
  let category = 'other';
  let finalMetadata: Record<string, unknown> = {};
  let summary = `קובץ: ${doc.filename}`;
  try { category = await geminiClassify(parsedText); } catch { /* keep 'other' */ }
  if (!VALID_CATEGORIES.has(category)) {
    console.error('[process-upload] invalid category from Gemini:', category, '— falling back to other');
    category = 'other';
  }
  try { finalMetadata = await geminiExtract(parsedText, category, orgName); } catch { /* keep empty */ }
  try { summary = await geminiSummarize(parsedText); } catch { /* keep filename */ }

  // Detect vault doc type from filename + parsed content, store vault_key in metadata
  // This ensures the /api/documents/vault checklist can identify the doc even without re-parsing
  const vaultText = `${doc.filename} ${parsedText.slice(0, 500)}`;
  for (const req of REQUIRED_VAULT_DOCS) {
    if (req.pattern.test(vaultText)) {
      finalMetadata.vault_key = req.key;
      if (category === 'other') category = 'official';
      break;
    }
  }

  // Update document to ready
  const { error: updateError } = await supabase.from('documents').update({
    category,
    parsed_text: parsedText.slice(0, 50000),
    metadata: { ...finalMetadata, summary },
    status: 'ready',
  }).eq('id', doc.id);

  if (updateError) {
    console.error('[process-upload] UPDATE to ready failed:', updateError.message, updateError);
    return Response.json({ error: 'document update failed', detail: updateError.message }, { status: 500 });
  }

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

    // Bridge into knowledge_chunks so RAG (match_knowledge RPC) can find them
    // Each chunk is scoped to this org so it won't surface for other orgs
    for (let i = 0; i < chunks.length; i++) {
      upsertChunk({
        category: 'document',
        subcategory: category,
        title: `${doc.filename} [${i + 1}/${chunks.length}]`,
        content: chunks[i],
        metadata: { document_id: doc.id, filename: doc.filename, category },
        organization_id: orgId,
      }).catch(() => { /* non-blocking */ });
    }
  } catch { /* chunks failure doesn't affect document status */ }

  // ===== Profile Autopilot =====
  // Dedicated extraction pass targeting profile-specific fields (CEO, board, NGO number, budget, etc.)
  // Uses "patch" logic: never overwrites existing data with shorter/weaker values.
  // Runs in parallel with org_memory seeding (both non-fatal).
  let scoreBefore = 0;
  let scoreAfter = 0;
  let profileUpdateSummary = '';
  try {
    const { data: existing } = await supabase.from('org_profiles').select('data').eq('org_id', orgId).single();
    const currentProfile = (existing?.data as Record<string, unknown>) || {};

    // Run profile autopilot extraction
    const autopilot = await extractProfileData(parsedText, currentProfile, orgName);
    profileUpdateSummary = autopilot.summary;

    // Merge autopilot results with general geminiExtract results
    // Autopilot results take precedence for the fields it specializes in;
    // geminiExtract fills remaining fields (theory_of_change, unique_model, etc.)
    const merged: Record<string, unknown> = { ...currentProfile };

    // Apply general extraction fields first (lower priority)
    const GENERAL_FIELDS = [
      'name', 'theory_of_change', 'unique_model', 'age_range', 'sub_populations',
      'geographic_focus', 'impact_metrics', 'success_rate', 'research_backing',
      'testimonials', 'partner_organizations', 'strengths', 'funder', 'amount',
      'doc_type', 'submission_history', 'active_projects',
    ];
    for (const key of GENERAL_FIELDS) {
      const newVal = finalMetadata[key];
      if (!newVal) continue;
      const newStr = typeof newVal === 'string' ? newVal : JSON.stringify(newVal);
      const existingStr = merged[key] ? (typeof merged[key] === 'string' ? merged[key] as string : JSON.stringify(merged[key])) : '';
      if (newStr.length > existingStr.length || !existingStr) {
        merged[key] = newVal;
      }
    }

    // Apply autopilot patched profile (higher priority, type-aware patch logic)
    Object.assign(merged, autopilot.patched);

    // Re-run DNA extraction on the merged profile so _dna stays current
    const orgTextParts = [
      merged.name, merged.mission, merged.theory_of_change, merged.unique_model,
      Array.isArray(merged.focus_areas) ? (merged.focus_areas as string[]).join(' ') : merged.focus_areas,
      Array.isArray(merged.target_populations) ? (merged.target_populations as string[]).join(' ') : merged.target_populations,
    ].filter(Boolean).join('\n');

    if (orgTextParts.length > 50) {
      try {
        const aiDna = await extractOrgDNAWithAI(orgTextParts as string);
        const regexDna = extractOrgDNA(merged);
        merged._dna = mergeOrgDNA(regexDna, aiDna ?? {});
        merged._dna_extracted_at = new Date().toISOString();
      } catch { /* non-blocking */ }
    }

    await supabase.from('org_profiles').upsert(
      { org_id: orgId, data: merged, last_updated: new Date().toISOString() },
      { onConflict: 'org_id' }
    );
  } catch { /* non-blocking */ }

  // ===== Seed org_memory — all fields, no cap =====
  // Map category → memory category and all its relevant fields at the right depth
  try {
    const CATEGORY_TO_MEM: Record<string, string> = {
      identity: 'identity', official: 'identity',
      impact: 'impact',
      budget: 'operations', project: 'operations', project_budget: 'operations',
      grant: 'submissions', submission: 'submissions',
      other: 'dna',
    };
    const memCat = CATEGORY_TO_MEM[category] || 'dna';

    // All fields by memory category — each gets the right depth
    const FIELDS_BY_MEM_CAT: Record<string, { field: string; depth: number }[]> = {
      identity: [
        { field: 'name',                depth: 2 },
        { field: 'mission',             depth: 2 },
        { field: 'registration_number', depth: 3 },
        { field: 'website',             depth: 1 },
        { field: 'contact_name',        depth: 2 },
        { field: 'contact_email',       depth: 2 },
        { field: 'founded_year',        depth: 2 },
      ],
      dna: [
        { field: 'focus_areas',         depth: 2 },
        { field: 'target_populations',  depth: 2 },
        { field: 'theory_of_change',    depth: 3 },
        { field: 'unique_model',        depth: 3 },
        { field: 'age_range',           depth: 2 },
        { field: 'sub_populations',     depth: 2 },
        { field: 'geographic_focus',    depth: 2 },
      ],
      impact: [
        { field: 'impact_metrics',      depth: 3 },
        { field: 'key_achievements',    depth: 3 },
        { field: 'beneficiaries_count', depth: 3 },
        { field: 'success_rate',        depth: 3 },
        { field: 'research_backing',    depth: 3 },
        { field: 'testimonials',        depth: 2 },
      ],
      operations: [
        { field: 'annual_budget',       depth: 3 },
        { field: 'employees_count',     depth: 2 },
        { field: 'active_projects',     depth: 2 },
        { field: 'partner_organizations', depth: 2 },
        { field: 'cities_active',       depth: 2 },
        { field: 'strengths',           depth: 2 },
      ],
      submissions: [
        { field: 'funder',              depth: 2 },
        { field: 'amount',              depth: 3 },
        { field: 'doc_type',            depth: 1 },
        { field: 'submission_history',  depth: 3 },
      ],
    };

    // Collect records across all relevant categories, not just the primary one
    // e.g. an identity doc might also surface impact_metrics
    const allFieldDefs = Object.values(FIELDS_BY_MEM_CAT).flat();
    const { data: memoriesBefore } = await supabase
      .from('org_memory')
      .select('category, depth, updated_at')
      .eq('org_id', orgId);
    scoreBefore = calculateOrgScore(memoriesBefore || []).total;

    for (const { field, depth } of allFieldDefs) {
      const val = finalMetadata[field];
      if (!val) continue;
      const strVal = typeof val === 'string' ? val : JSON.stringify(val);
      if (strVal.length < 3) continue;

      // Determine which memory category this field belongs to
      const fieldMemCat = Object.entries(FIELDS_BY_MEM_CAT).find(([, defs]) =>
        defs.some(d => d.field === field)
      )?.[0] || memCat;

      await supabase.from('org_memory').upsert({
        org_id: orgId,
        key: `doc_${doc.id.slice(0, 8)}_${field}`,
        value: strVal.slice(0, 300),
        source: 'document_upload',
        confidence: strVal.length > 20 ? 'high' : 'medium',
        category: fieldMemCat,
        depth,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'org_id,key' });
    }

    // Always record that this document was uploaded (fallback entry)
    await supabase.from('org_memory').upsert({
      org_id: orgId,
      key: `doc_${doc.id.slice(0, 8)}_uploaded`,
      value: `מסמך "${doc.filename}" מסוג ${category} הועלה`,
      source: 'document_upload',
      confidence: 'medium',
      category: memCat,
      depth: 1,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'org_id,key' });

    // Recalculate score after upserts
    const { data: memoriesAfter } = await supabase
      .from('org_memory')
      .select('category, depth, updated_at')
      .eq('org_id', orgId);
    scoreAfter = calculateOrgScore(memoriesAfter || []).total;
  } catch { /* non-blocking */ }

  return Response.json({
    document_id: doc.id,
    status: 'ready',
    category,
    summary,
    score_before: scoreBefore,
    score_after: scoreAfter,
    score_delta: scoreAfter - scoreBefore,
    profile_update: profileUpdateSummary || null,
  });
});
