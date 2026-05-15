import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { withAuth } from '@/lib/api-auth';
import { extractOrgDNA } from '@/lib/ai/org-dna';
import { scoreCompanyDNA, buildOrgContextFromProfile } from '@/lib/ai/scoring-service';
import { companiesLog } from '@/lib/logger';

interface OrgProfile {
  focus_areas?: string[];
  mission?: string;
  regions?: string[];
  populations?: string[];
  domains?: string[];
  _dna?: {
    populations?: string[];
    domains?: string[];
    regions?: string[];
    negative_matches?: string[];
  };
}

interface OrgMemoryFact {
  key: string;
  value: string;
}

// scoreCompany is now provided by scoring-service.ts (scoreCompanyDNA)

export const GET = withAuth(async (req, auth) => {
  const orgId = auth.orgId;
  const search = req.nextUrl.searchParams.get('search') || '';
  const type = req.nextUrl.searchParams.get('type') || '';
  const matchedOnly = req.nextUrl.searchParams.get('matched') === 'true';
  const supabase = createAdminClient();

  try {
  let query = supabase
    .from('companies')
    .select('id, name, company_type, description, interests, donation_amount, market_cap, csr_rank, contact_name, contact_email, contact_phone, contact_role, website, active')
    .eq('active', true)
    .order('name');

  if (type) {
    query = query.eq('company_type', type);
  }

  if (search) {
    query = query.or(`name.ilike.%${search}%,description.ilike.%${search}%,contact_name.ilike.%${search}%`);
  }

  // Always load all companies for accurate matched count
  const { data: companies, error } = await query.limit(1100);

  if (error) {
    companiesLog.error({ err: error, org_id: orgId }, 'companies DB load failed');
    return NextResponse.json({ error: 'שגיאה בטעינת הנתונים. נסי שוב.', companies: [], total: 0, typeCounts: {}, matchedCount: 0 }, { status: 502 });
  }

  // Get company type stats
  const { data: stats } = await supabase
    .from('companies')
    .select('company_type')
    .eq('active', true);

  const typeCounts: Record<string, number> = {};
  for (const row of stats || []) {
    const t = (row as { company_type: string }).company_type || 'other';
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  }

  // If org_id provided, score and sort by relevance
  let scored = companies || [];
  let matchedCount = 0;

  if (orgId) {
    // Load profile + org_memory in parallel
    const [profileRes, memoryRes] = await Promise.all([
      supabase.from('org_profiles').select('data').eq('org_id', orgId).single(),
      supabase.from('org_memory').select('key, value').eq('org_id', orgId).limit(50),
    ]);

    const profileData = ((profileRes.data as { data?: OrgProfile } | null)?.data || {}) as OrgProfile;
    const memoryFacts: OrgMemoryFact[] = (memoryRes.data || []) as OrgMemoryFact[];

    const mission = profileData.mission || '';

    // Auto-generate DNA if missing (fire-and-forget save)
    let dna = profileData._dna || {};
    if (!dna.populations?.length && !dna.domains?.length) {
      const autoDna = extractOrgDNA(profileData as Record<string, unknown>, [mission]);
      dna = { populations: autoDna.populations, domains: autoDna.domains, regions: autoDna.geography, negative_matches: autoDna.excludePopulations };
      if (autoDna.populations.length > 0 || autoDna.domains.length > 0) {
        supabase.from('org_profiles')
          .update({ data: { ...(profileData as Record<string, unknown>), _dna: dna } })
          .eq('org_id', orgId)
          .then(() => {});
      }
    }

    const memoryKeywords = memoryFacts
      .filter(f => ['target_population', 'domain', 'region', 'focus', 'activity'].includes(f.key))
      .map(f => f.value.toLowerCase())
      .filter(v => v.length > 2);

    // Build unified OrgContext via scoring-service helper
    const orgCtx = buildOrgContextFromProfile(
      profileData as Record<string, unknown>,
      memoryKeywords,
    );

    if (orgCtx.focusAreas.length > 0 || orgCtx.populations.length > 0 || orgCtx.domains.length > 0) {
      const withScores = scored.map(c => ({
        ...c,
        relevance_score: scoreCompanyDNA(c, orgCtx),
      }));

      withScores.sort((a, b) => b.relevance_score - a.relevance_score);
      matchedCount = withScores.filter(c => c.relevance_score >= 15).length;

      if (matchedOnly) {
        scored = withScores.filter(c => c.relevance_score >= 15).slice(0, 300);
      } else {
        scored = withScores.slice(0, 300);
      }
    }
  }

  return NextResponse.json({
    companies: scored,
    total: (stats || []).length,
    typeCounts,
    matchedCount,
  });

  } catch (error) {
    companiesLog.error({ err: error, org_id: orgId }, 'companies unexpected error');
    return NextResponse.json(
      { error: 'אירעה שגיאה בלתי צפויה. נסי שוב בעוד מספר דקות.', companies: [], total: 0, typeCounts: {}, matchedCount: 0 },
      { status: 500 },
    );
  }
});
