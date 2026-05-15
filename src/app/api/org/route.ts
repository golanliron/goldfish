import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { fetchByRegistrationNumber, formatForProfile } from '@/lib/ai/guidestar';
import { extractOrgDNA, extractOrgDNAWithAI, mergeOrgDNA } from '@/lib/ai/org-dna';
import { calculateOrgScore } from '@/lib/ai/org-score';

export async function GET(req: NextRequest) {
  const orgId = req.nextUrl.searchParams.get('org_id');
  if (!orgId) return NextResponse.json({ error: 'missing org_id' }, { status: 400 });

  const supabase = createAdminClient();

  const [profileRes, docsRes, memoriesRes] = await Promise.all([
    supabase.from('org_profiles').select('data').eq('org_id', orgId).single(),
    supabase.from('documents').select('*').eq('org_id', orgId).order('uploaded_at', { ascending: false }),
    supabase.from('org_memory').select('category, depth, updated_at').eq('org_id', orgId),
  ]);

  const score = calculateOrgScore(memoriesRes.data || []);

  return NextResponse.json({
    profile: profileRes.data?.data || null,
    documents: docsRes.data || [],
    score,
  });
}

export async function POST(req: NextRequest) {
  const { org_id, data } = await req.json();
  if (!org_id) return NextResponse.json({ error: 'missing org_id' }, { status: 400 });

  const supabase = createAdminClient();

  // Auto-enrich from GuideStar if registration number provided
  let enrichedData = { ...data };
  const regNum = data?.registration_number as string | undefined;
  if (regNum && !data?._guidestar_fetched) {
    try {
      const gsOrg = await fetchByRegistrationNumber(regNum);
      if (gsOrg) {
        const gsProfile = formatForProfile(gsOrg);
        for (const [k, v] of Object.entries(gsProfile)) {
          if (!enrichedData[k] && v) enrichedData[k] = v;
        }
        enrichedData._guidestar_fetched = true;
      }
    } catch (e) {
      console.error('[guidestar] Enrichment error:', e);
    }
  }

  // Build org text for AI DNA extraction
  const orgTextParts: string[] = [];
  if (enrichedData.name) orgTextParts.push(enrichedData.name);
  if (enrichedData.mission) orgTextParts.push(enrichedData.mission);
  if (enrichedData.summary) orgTextParts.push(enrichedData.summary);
  if (Array.isArray(enrichedData.focus_areas)) orgTextParts.push((enrichedData.focus_areas as string[]).join(' '));
  if (Array.isArray(enrichedData.active_projects)) {
    for (const p of enrichedData.active_projects as { name?: string; description?: string }[]) {
      if (p?.name) orgTextParts.push(p.name);
      if (p?.description) orgTextParts.push(p.description);
    }
  }
  if (Array.isArray(enrichedData.key_achievements)) orgTextParts.push((enrichedData.key_achievements as string[]).join(' '));

  // Also pull existing documents for richer AI context
  const { data: docs } = await supabase
    .from('documents')
    .select('summary, parsed_text')
    .eq('org_id', org_id)
    .limit(5);

  for (const doc of docs || []) {
    const d = doc as { summary?: string; content?: string; parsed_text?: string };
    if (d.summary) orgTextParts.push(d.summary);
    else if (d.parsed_text) orgTextParts.push((d.parsed_text as string).slice(0, 500));
  }

  const orgText = orgTextParts.join('\n');

  // Run AI DNA extraction (async, non-blocking for save)
  let aiDna: Partial<import('@/lib/ai/org-dna').OrgDNA> | null = null;
  if (orgText.length > 50) {
    try {
      aiDna = await extractOrgDNAWithAI(orgText);
    } catch {
      // Fallback to regex if AI fails
    }
  }

  // Merge AI + regex DNA and store in profile
  if (aiDna) {
    const regexDna = extractOrgDNA(enrichedData);
    const mergedDna = mergeOrgDNA(regexDna, aiDna);
    enrichedData._dna = mergedDna;
    enrichedData._dna_extracted_at = new Date().toISOString();
  }

  await supabase.from('org_profiles').upsert({
    org_id,
    data: enrichedData,
    last_updated: new Date().toISOString(),
  }, { onConflict: 'org_id' });

  return NextResponse.json({ ok: true, dna_extracted: !!aiDna });
}
