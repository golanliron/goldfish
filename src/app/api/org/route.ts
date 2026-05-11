import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { fetchByRegistrationNumber, formatForProfile } from '@/lib/ai/guidestar';

export async function GET(req: NextRequest) {
  const orgId = req.nextUrl.searchParams.get('org_id');
  if (!orgId) return NextResponse.json({ error: 'missing org_id' }, { status: 400 });

  const supabase = createAdminClient();

  const [profileRes, docsRes] = await Promise.all([
    supabase.from('org_profiles').select('data').eq('org_id', orgId).single(),
    supabase.from('documents').select('*').eq('org_id', orgId).order('uploaded_at', { ascending: false }),
  ]);

  return NextResponse.json({
    profile: profileRes.data?.data || null,
    documents: docsRes.data || [],
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

  await supabase.from('org_profiles').upsert({
    org_id,
    data: enrichedData,
    last_updated: new Date().toISOString(),
  }, { onConflict: 'org_id' });

  return NextResponse.json({ ok: true });
}
