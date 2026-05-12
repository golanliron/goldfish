import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

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

// Hebrew ↔ English mapping for interest/domain matching
const INTEREST_TRANSLATIONS: Record<string, string[]> = {
  // Populations
  'נוער בסיכון': ['youth_at_risk', 'youth at risk'],
  'נוער': ['youth'],
  'צעירים': ['young_adults', 'young adults'],
  'ילדים': ['children'],
  'מוגבלויות': ['disabilities'],
  'קשישים': ['elderly'],
  'עולים': ['immigrants'],
  'ערבים': ['arab'],
  'חרדים': ['haredi'],
  'נשים': ['women'],
  'חיילים': ['soldiers'],
  'סטודנטים': ['students'],
  'אתיופים': ['immigrants', 'ethiopian'],
  'פליטים': ['refugees'],
  'אסירים': ['prisoners'],
  'להטב': ['lgbtq'],
  'חסרי בית': ['homeless'],
  'התמכרות': ['addiction'],
  // Domains
  'חינוך': ['education'],
  'רווחה': ['welfare'],
  'בריאות': ['health'],
  'בריאות הנפש': ['mental_health', 'mental health'],
  'תעסוקה': ['employment'],
  'תרבות': ['culture'],
  'סביבה': ['environment'],
  'טכנולוגיה': ['technology'],
  'קהילה': ['community'],
  'ספורט': ['sport', 'sports'],
  'משפטי': ['legal'],
  'דיור': ['housing'],
  'דו-קיום': ['coexistence'],
  'חדשנות חברתית': ['social_innovation', 'social innovation'],
  'מצוקה חברתית': ['welfare', 'social_distress', 'youth_at_risk'],
  'פיתוח מנהיגות': ['education', 'leadership'],
  'פיתוח קהילתי': ['community'],
  'הוראה': ['education'],
  'מנהיגות': ['education', 'leadership'],
  'מלגות': ['education', 'fellowships'],
  'מחקר': ['science', 'research'],
  'זכויות אדם': ['legal', 'human_rights'],
  // Regions
  'נגב': ['negev'],
  'גליל': ['galilee'],
  'פריפריה': ['periphery'],
  'ירושלים': ['jerusalem'],
  'ארצי': ['national'],
};

// DNA + keyword relevance scoring for companies
function scoreCompany(
  company: { description: string | null; interests: string[] | null; company_type: string },
  orgKeywords: string[],
  orgMission: string,
  orgPopulations: string[],
  orgDomains: string[],
  orgGeoRegions: string[],
  negativeMatches: string[]
): number {
  // Build searchable text: original interests + translated equivalents
  const interests = company.interests || [];
  const translatedInterests: string[] = [];
  for (const interest of interests) {
    const translations = INTEREST_TRANSLATIONS[interest];
    if (translations) translatedInterests.push(...translations);
  }

  const companyText = [
    ...interests,
    ...translatedInterests,
    company.description || '',
  ].join(' ').toLowerCase();

  // Negative match — hard reject
  for (const neg of negativeMatches) {
    if (companyText.includes(neg.toLowerCase())) return 0;
  }

  let score = 0;

  // DNA population overlap (strongest signal)
  for (const pop of orgPopulations) {
    if (companyText.includes(pop)) score += 20;
  }

  // DNA domain overlap
  for (const domain of orgDomains) {
    if (companyText.includes(domain)) score += 18;
  }

  // Geographic region overlap
  for (const region of orgGeoRegions) {
    if (companyText.includes(region)) score += 12;
  }

  // Keyword overlap with org focus areas
  for (const kw of orgKeywords) {
    if (companyText.includes(kw)) score += 10;
  }

  // Mission word overlap
  if (orgMission) {
    const missionWords = orgMission.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    for (const w of missionWords) {
      if (companyText.includes(w)) score += 3;
    }
  }

  // Israel grants boost (for federations that fund Israel)
  if (company.interests?.includes('israel_grants')) score += 25;

  // Federation with Israeli focus areas — strong signal
  if (company.interests?.includes('federation') && orgGeoRegions.length > 0) score += 10;

  // Fund type bonus
  if (company.company_type === 'fund') score += 8;

  // Penalize if no data
  if (!company.description && (!company.interests || company.interests.length === 0)) {
    score = Math.max(0, score - 20);
  }

  return Math.min(100, score);
}

export async function GET(req: NextRequest) {
  const orgId = req.nextUrl.searchParams.get('org_id');
  const search = req.nextUrl.searchParams.get('search') || '';
  const type = req.nextUrl.searchParams.get('type') || '';
  const matchedOnly = req.nextUrl.searchParams.get('matched') === 'true';
  const supabase = createAdminClient();

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
    return NextResponse.json({ error: error.message }, { status: 500 });
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

    // Build org context from profile + memory
    const focusAreas = profileData.focus_areas || [];
    const mission = profileData.mission || '';
    const geoRegions = profileData.regions || [];

    // DNA from profile (if AI extracted it)
    const dna = profileData._dna || {};
    const orgPopulations = dna.populations || profileData.populations || [];
    const orgDomains = dna.domains || profileData.domains || [];
    const orgGeoRegions = [...new Set([...geoRegions, ...(dna.regions || [])])];
    const negativeMatches = dna.negative_matches || [];

    // Augment keywords from org_memory (e.g. "target_population: נוער בסיכון")
    const memoryKeywords = memoryFacts
      .filter(f => ['target_population', 'domain', 'region', 'focus', 'activity'].includes(f.key))
      .map(f => f.value.toLowerCase())
      .filter(v => v.length > 2);

    const orgKeywords = [...focusAreas, ...memoryKeywords]
      .map(s => s.toLowerCase())
      .filter(s => s.length > 2);

    if (orgKeywords.length > 0 || orgPopulations.length > 0 || orgDomains.length > 0) {
      const withScores = scored.map(c => ({
        ...c,
        relevance_score: scoreCompany(c, orgKeywords, mission, orgPopulations, orgDomains, orgGeoRegions, negativeMatches),
      }));

      withScores.sort((a, b) => b.relevance_score - a.relevance_score);
      matchedCount = withScores.filter(c => c.relevance_score >= 20).length;

      if (matchedOnly) {
        scored = withScores.filter(c => c.relevance_score >= 20).slice(0, 300);
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
}
