/**
 * GET /api/cron/process-documents?batch=20
 *
 * Processes documents saved with status='processing':
 * 1. Classify with Gemini (category)
 * 2. Extract org metadata
 * 3. Summarize
 * 4. Create embeddings + document_chunks for RAG
 * 5. Mark as 'ready'
 *
 * Runs every hour. Handles Drive imports + any other async uploads.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { geminiClassify, geminiExtract, geminiSummarize } from '@/lib/ai/gemini';
import { embedBatch } from '@/lib/ai/rag';
import { chunkText } from '@/lib/utils/text';

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const batch = parseInt(request.nextUrl.searchParams.get('batch') || '15');
  const supabase = createAdminClient();

  // Fetch unprocessed documents
  const { data: docs, error } = await supabase
    .from('documents')
    .select('id, org_id, filename, parsed_text, file_type, metadata')
    .eq('status', 'processing')
    .not('parsed_text', 'is', null)
    .limit(batch);

  if (error) {
    console.error('[process-documents] fetch error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!docs || docs.length === 0) {
    return NextResponse.json({ processed: 0, message: 'אין מסמכים לעיבוד' });
  }

  let processed = 0;
  let failed = 0;

  for (const doc of docs) {
    if (!doc.parsed_text || doc.parsed_text.length < 20) {
      // Mark as ready even if empty — don't retry forever
      await supabase.from('documents').update({ status: 'ready', category: 'other' }).eq('id', doc.id);
      continue;
    }

    try {
      const text = doc.parsed_text.slice(0, 50000);

      // Get org name for better extraction
      const { data: orgData } = await supabase
        .from('organizations')
        .select('name')
        .eq('id', doc.org_id)
        .single();
      const orgName = orgData?.name || '';

      const [category, metadata, summary] = await Promise.all([
        geminiClassify(text),
        geminiExtract(text, undefined, orgName),
        geminiSummarize(text),
      ]);

      // Update document
      await supabase.from('documents').update({
        category,
        status: 'ready',
        metadata: {
          ...(doc.metadata as Record<string, unknown> || {}),
          summary,
          ...metadata,
        },
      }).eq('id', doc.id);

      // Create chunks + embeddings for RAG
      const chunks = chunkText(text);
      let embeddings: number[][] = [];
      try {
        embeddings = await embedBatch(chunks);
      } catch (e) {
        console.error(`[process-documents] embedBatch failed for ${doc.filename}:`, e);
      }

      for (let i = 0; i < chunks.length; i++) {
        await supabase.from('document_chunks').insert({
          document_id: doc.id,
          org_id: doc.org_id,
          content: chunks[i],
          embedding: embeddings[i] ?? null,
          metadata: { category, filename: doc.filename, source: 'drive' },
        });
      }

      // Update org profile if this is org content with useful metadata
      if (Object.keys(metadata).length > 0) {
        const { data: existingProfile } = await supabase
          .from('org_profiles')
          .select('data')
          .eq('org_id', doc.org_id)
          .single();

        const current = (existingProfile?.data as Record<string, unknown>) || {};
        const merged = { ...current };
        for (const key of ['name', 'registration_number', 'founded_year', 'mission', 'focus_areas', 'target_populations', 'regions', 'beneficiaries_count', 'employees_count', 'annual_budget', 'website', 'contact_email', 'contact_phone', 'key_people', 'partners']) {
          if ((metadata as Record<string, unknown>)[key] && !merged[key]) {
            merged[key] = (metadata as Record<string, unknown>)[key];
          }
        }

        await supabase.from('org_profiles').upsert({
          org_id: doc.org_id,
          data: merged,
          last_updated: new Date().toISOString(),
        }, { onConflict: 'org_id' });
      }

      processed++;
    } catch (e) {
      console.error(`[process-documents] error processing ${doc.filename}:`, e);
      // Mark as ready to avoid infinite retry loop
      await supabase.from('documents').update({ status: 'ready', category: 'other' }).eq('id', doc.id);
      failed++;
    }
  }

  return NextResponse.json({
    processed,
    failed,
    total: docs.length,
    message: `עובדו ${processed} מסמכים${failed > 0 ? `, ${failed} נכשלו` : ''}`,
  });
}
