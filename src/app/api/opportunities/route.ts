import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { extractOrgDNA, scoreDNAMatch } from '@/lib/ai/org-dna';

export async function GET(req: NextRequest) {
  const orgId = req.nextUrl.searchParams.get('org_id');
  const supabase = createAdminClient();
  const today = new Date().toISOString().split('T')[0];

  const [taxRes, oppRes, matchRes, profileRes, docsRes] = await Promise.all([
    supabase.from('grant_taxonomy').select('*').order('label_he'),
    supabase
      .from('opportunities')
      .select('*')
      .eq('active', true)
      .order('deadline', { ascending: true, nullsFirst: false })
      .limit(500),
    orgId
      ? supabase.from('matches').select('opportunity_id, score, reasoning').eq('org_id', orgId).gte('score', 50)
      : Promise.resolve({ data: [] }),
    orgId
      ? supabase.from('org_profiles').select('data').eq('org_id', orgId).single()
      : Promise.resolve({ data: null }),
    orgId
      ? supabase.from('documents').select('summary, content').eq('org_id', orgId)
      : Promise.resolve({ data: [] }),
  ]);

  const opportunities = (oppRes.data || []).filter(
    (o: Record<string, unknown>) =>
      (!o.deadline || String(o.deadline) >= today) &&
      o.type !== 'fund' // funds belong in the companies/funds tab, not here
  );

  let matches = matchRes.data || [];

  // If no saved matches but we have a profile, do DNA-based matching
  if (matches.length === 0 && profileRes.data && orgId) {
    const profileData = (profileRes.data as { data: Record<string, unknown> }).data || {};

    // Use AI-extracted DNA if available (stored in profile), else fall back to regex
    let orgDna: import('@/lib/ai/org-dna').OrgDNA;
    if (profileData._dna && typeof profileData._dna === 'object') {
      orgDna = profileData._dna as import('@/lib/ai/org-dna').OrgDNA;
    } else {
      const docTexts = (docsRes.data || [])
        .map((d: { summary?: string; content?: string }) => d.summary || d.content || '')
        .filter(Boolean);
      orgDna = extractOrgDNA(profileData, docTexts);
    }

    if (orgDna.populations.length > 0 || orgDna.domains.length > 0) {
      const scored = opportunities
        .map((opp: Record<string, unknown>) => {
          const { score, reasoning, isNegativeMatch } = scoreDNAMatch(
            orgDna,
            (opp.categories as string[]) || [],
            (opp.target_populations as string[]) || [],
            String(opp.title || ''),
            String(opp.description || '')
          );
          return { opportunity_id: String(opp.id), score, reasoning, isNegativeMatch };
        })
        .filter(m => !m.isNegativeMatch && m.score >= 50)
        .sort((a, b) => b.score - a.score);

      matches = scored;
    }
  }

  return NextResponse.json({
    taxonomy: taxRes.data || [],
    opportunities,
    matches,
  });
}
