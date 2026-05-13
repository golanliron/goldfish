import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { withAuth } from '@/lib/api-auth';
import { geminiClassify, geminiExtract, geminiSummarize } from '@/lib/ai/gemini';

export const maxDuration = 120;

// POST /api/documents/reclassify — re-classify all "other" documents for the authenticated org
export const POST = withAuth(async (req, auth) => {
  const org_id = auth.orgId;
  const supabase = createAdminClient();

  const { data: docs } = await supabase
    .from('documents')
    .select('id, filename, parsed_text, category')
    .eq('org_id', org_id)
    .eq('category', 'other')
    .not('parsed_text', 'is', null);

  if (!docs?.length) {
    return NextResponse.json({ reclassified: 0, message: 'אין מסמכים לסיווג מחדש' });
  }

  const results: { id: string; filename: string; oldCategory: string; newCategory: string }[] = [];

  const batch = async (doc: typeof docs[0]) => {
    const text = doc.parsed_text || '';
    if (text.length < 30) return;

    try {
      const [category, metadata, summary] = await Promise.all([
        geminiClassify(text),
        geminiExtract(text),
        geminiSummarize(text),
      ]);

      await supabase
        .from('documents')
        .update({
          category,
          metadata: { ...metadata, summary },
          status: 'ready',
        })
        .eq('id', doc.id);

      const { data: existing } = await supabase
        .from('org_profiles')
        .select('data')
        .eq('org_id', org_id)
        .single();

      const current = (existing?.data as Record<string, unknown>) || {};
      const merged = { ...current };
      for (const key of ['name', 'registration_number', 'founded_year', 'mission', 'focus_areas', 'target_populations', 'regions', 'beneficiaries_count', 'employees_count', 'volunteers_count', 'annual_budget', 'revenue_sources', 'partners', 'impact_metrics', 'key_achievements', 'key_people', 'contact_name', 'contact_email', 'contact_phone', 'website']) {
        if (metadata[key] && !merged[key]) merged[key] = metadata[key];
      }

      await supabase.from('org_profiles').upsert({
        org_id,
        data: merged,
        last_updated: new Date().toISOString(),
      }, { onConflict: 'org_id' });

      results.push({
        id: doc.id,
        filename: doc.filename || 'unknown',
        oldCategory: 'other',
        newCategory: category,
      });
    } catch {
      // Skip failed documents
    }
  };

  for (let i = 0; i < docs.length; i += 5) {
    await Promise.all(docs.slice(i, i + 5).map(batch));
  }

  return NextResponse.json({
    reclassified: results.length,
    total: docs.length,
    results,
  });
});
