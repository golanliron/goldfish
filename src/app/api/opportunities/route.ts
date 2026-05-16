import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { withAuth } from '@/lib/api-auth';
import { extractOrgDNA } from '@/lib/ai/org-dna';
import { scoreOpportunityDNA, type FunderIntel } from '@/lib/ai/scoring-service';
import { calculateReadiness, findUpcomingRecurrences } from '@/lib/ai/funder-learning';
import { opportunitiesLog } from '@/lib/logger';

export const GET = withAuth(async (req, auth) => {
  const orgId = auth.orgId;
  const supabase = createAdminClient();
  const today = new Date().toISOString().split('T')[0];

  try {
  const [taxRes, oppRes, matchRes, profileRes, docsRes, hotOppsRes] = await Promise.all([
    supabase.from('grant_taxonomy').select('*').order('label_he'),
    supabase
      .from('opportunities')
      .select('*')
      .eq('active', true)
      .order('deadline', { ascending: true, nullsFirst: false })
      .limit(500),
    orgId
      ? supabase.from('matches').select('opportunity_id, score, reasoning, pillars').eq('org_id', orgId).gte('score', 50)
      : Promise.resolve({ data: [] }),
    orgId
      ? supabase.from('org_profiles').select('data').eq('org_id', orgId).single()
      : Promise.resolve({ data: null }),
    orgId
      ? supabase.from('documents').select('parsed_text').eq('org_id', orgId)
      : Promise.resolve({ data: [] }),
    // Hot opportunities: org-specific + global (org_id is null)
    orgId
      ? supabase
          .from('hot_opportunities')
          .select('id, source_type, source_name, source_url, title, description, pain_point, strategic_insight, amount_hint, deadline_hint, match_orgs, discovered_at')
          .eq('active', true)
          .or(`org_id.is.null,match_orgs->>${orgId}.not.is.null`)
          .order('discovered_at', { ascending: false })
          .limit(20)
      : supabase
          .from('hot_opportunities')
          .select('id, source_type, source_name, source_url, title, description, pain_point, strategic_insight, amount_hint, deadline_hint, discovered_at')
          .eq('active', true)
          .order('discovered_at', { ascending: false })
          .limit(20),
  ]);

  const opportunities = (oppRes.data || []).filter(
    (o: Record<string, unknown>) =>
      (!o.deadline || String(o.deadline) >= today) &&
      o.type !== 'fund' // funds belong in the companies/funds tab, not here
  );

  // Pre-load funder intelligence for all active opportunities (used in scoring + display)
  const allFunderNames = [...new Set(
    opportunities.map((o: Record<string, unknown>) => String(o.funder || '')).filter(Boolean)
  )];
  const funderIntelMap = new Map<string, { style: string; approval_rate: number; preferred_populations: string[]; preferred_domains: string[]; preferred_org_sizes: string[]; total_submissions: number; total_approved: number; typical_amount_min: number | null; typical_amount_max: number | null; writing_tips: string | null }>();

  if (allFunderNames.length > 0) {
    const { data: fiAll } = await supabase
      .from('funder_intelligence')
      .select('funder_name, funder_style, preferred_populations, preferred_domains, preferred_org_sizes, total_submissions, total_approved, typical_amount_min, typical_amount_max, writing_tips')
      .in('funder_name', allFunderNames);
    if (fiAll) {
      for (const fi of fiAll) {
        funderIntelMap.set(fi.funder_name, {
          style: fi.funder_style || 'other',
          approval_rate: fi.total_submissions > 0 ? Math.round((fi.total_approved / fi.total_submissions) * 100) : 0,
          preferred_populations: fi.preferred_populations || [],
          preferred_domains: fi.preferred_domains || [],
          preferred_org_sizes: fi.preferred_org_sizes || [],
          total_submissions: fi.total_submissions || 0,
          total_approved: fi.total_approved || 0,
          typical_amount_min: fi.typical_amount_min,
          typical_amount_max: fi.typical_amount_max,
          writing_tips: fi.writing_tips,
        });
      }
    }
  }

  // Pre-load outcome signals for cross-org learning (which funders approved similar orgs)
  let outcomeBoosts = new Map<string, number>(); // funder_name → bonus points
  if (orgId && profileRes.data) {
    const profileData = (profileRes.data as { data: Record<string, unknown> }).data || {};
    const dna = profileData._dna as { domains?: string[]; populations?: string[]; orgType?: string } | undefined;
    if (dna?.domains && dna.domains.length > 0) {
      const { data: signals } = await supabase
        .from('outcome_signals')
        .select('funder_name, outcome, org_domains, org_populations, org_size')
        .in('outcome', ['approved', 'partial'])
        .limit(200);

      if (signals && signals.length > 0) {
        // For each funder, check if approved orgs had similar DNA
        const funderScores = new Map<string, { hits: number; total: number }>();
        for (const s of signals) {
          const entry = funderScores.get(s.funder_name) || { hits: 0, total: 0 };
          entry.total++;
          const domainOverlap = (s.org_domains || []).some((d: string) => dna.domains!.includes(d));
          const popOverlap = (s.org_populations || []).some((p: string) => (dna.populations || []).includes(p));
          if (domainOverlap || popOverlap) entry.hits++;
          funderScores.set(s.funder_name, entry);
        }
        // Funders where similar orgs got approved get a bonus
        for (const [funder, { hits, total }] of funderScores) {
          if (hits > 0 && total >= 2) {
            outcomeBoosts.set(funder, Math.min(10, Math.round((hits / total) * 10)));
          }
        }
      }
    }
  }

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
        .map((d: { parsed_text?: string }) => d.parsed_text || '')
        .filter(Boolean);
      orgDna = extractOrgDNA(profileData, docTexts);
    }

    if (orgDna.populations.length > 0 || orgDna.domains.length > 0) {
      const scored = opportunities
        .map((opp: Record<string, unknown>) => {
          const funderName = String(opp.funder || '');
          const fi = funderIntelMap.get(funderName) as FunderIntel | undefined;
          const outcomeBonus = outcomeBoosts.get(funderName) || 0;

          return scoreOpportunityDNA(
            opp as Parameters<typeof scoreOpportunityDNA>[0],
            orgDna,
            fi,
            outcomeBonus,
          );
        })
        .filter(m => !m.isNegativeMatch && m.score >= 50)
        .sort((a, b) => b.score - a.score);

      matches = scored as unknown as typeof matches;
    }
  }

  // Calculate profile completeness for the UI hint
  let profileCompleteness: number | undefined;
  if (profileRes.data && orgId) {
    const profileData = (profileRes.data as { data: Record<string, unknown> }).data || {};
    if (profileData._dna && typeof profileData._dna === 'object') {
      profileCompleteness = (profileData._dna as { profileCompleteness?: number }).profileCompleteness;
    }
    if (profileCompleteness === undefined) {
      const docTexts = (docsRes.data || [])
        .map((d: { parsed_text?: string }) => d.parsed_text || '')
        .filter(Boolean);
      const dna = extractOrgDNA(profileData, docTexts);
      profileCompleteness = dna.profileCompleteness;
    }
  }

  // Build funderInfo for frontend from pre-loaded data
  const funderInfo: Record<string, { style?: string; approval_rate?: number; typical_amount_min?: number | null; typical_amount_max?: number | null; writing_tips?: string | null }> = {};
  for (const [name, fi] of funderIntelMap) {
    funderInfo[name] = {
      style: fi.style,
      approval_rate: fi.total_submissions > 0 ? fi.approval_rate : undefined,
      typical_amount_min: fi.typical_amount_min,
      typical_amount_max: fi.typical_amount_max,
      writing_tips: fi.writing_tips,
    };
  }

  // Find upcoming recurring grants (only if org has profile)
  let upcomingRecurrences: { funder_name: string; last_title: string; expected_month: number }[] = [];
  if (orgId && profileRes.data) {
    try {
      upcomingRecurrences = (await findUpcomingRecurrences()).slice(0, 10);
    } catch { /* non-critical */ }
  }

  // Filter hot opportunities: for org-specific ones, only include if score >= 50
  const hotOpportunities = (hotOppsRes.data || []).filter((h: Record<string, unknown>) => {
    if (!orgId || !h.match_orgs) return true; // global or no matching data
    const score = (h.match_orgs as Record<string, number>)[orgId];
    return score === undefined || score >= 50;
  });

  return NextResponse.json({
    taxonomy: taxRes.data || [],
    opportunities,
    matches,
    profileCompleteness,
    funderInfo,
    upcomingRecurrences,
    hotOpportunities,
  });

  } catch (error) {
    opportunitiesLog.error({ err: error, org_id: orgId }, 'opportunities unexpected error');
    return NextResponse.json(
      {
        error: 'שגיאה בטעינת ההזדמנויות. נסי שוב בעוד מספר דקות.',
        taxonomy: [],
        opportunities: [],
        matches: [],
        hotOpportunities: [],
      },
      { status: 500 },
    );
  }
});
