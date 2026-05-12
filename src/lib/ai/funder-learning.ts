// Goldfish — Funder Learning Engine
// Learns from submission outcomes + grant patterns to improve matching
// Multi-tenant: all data is aggregated anonymously across orgs

import { createAdminClient } from '@/lib/supabase/admin';

// ===== Types =====

export interface FunderProfile {
  funder_name: string;
  company_id?: string;
  preferred_domains: string[];
  preferred_populations: string[];
  preferred_regions: string[];
  preferred_org_sizes: string[];
  typical_amount_min?: number;
  typical_amount_max?: number;
  recurring_months: number[];
  cycle_notes?: string;
  total_submissions: number;
  total_approved: number;
  total_rejected: number;
  avg_approved_amount?: number;
  funder_style?: string;
  writing_tips?: string;
  approval_rate?: number; // computed
}

export interface OutcomeSignal {
  funder_name: string;
  opportunity_categories: string[];
  opportunity_populations: string[];
  org_domains: string[];
  org_populations: string[];
  org_size: string;
  outcome: 'approved' | 'rejected' | 'partial';
  approved_amount?: number;
  requested_amount?: number;
}

export interface ReadinessScore {
  score: number;        // 0-100
  factors: ReadinessFactor[];
  missingDocs: string[];
  timeWarning?: string;
}

interface ReadinessFactor {
  label: string;
  met: boolean;
  weight: number;
}

// ===== Funder Intelligence =====

/**
 * Get or create a funder intelligence profile by funder name.
 * If one doesn't exist, creates a stub from opportunity data.
 */
export async function getFunderProfile(funderName: string): Promise<FunderProfile | null> {
  if (!funderName) return null;
  const supabase = createAdminClient();

  const { data } = await supabase
    .from('funder_intelligence')
    .select('*')
    .eq('funder_name', funderName)
    .single();

  if (data) {
    return {
      ...data,
      approval_rate: data.total_submissions > 0
        ? Math.round((data.total_approved / data.total_submissions) * 100)
        : undefined,
    };
  }

  return null;
}

/**
 * Build funder profiles from existing opportunity data.
 * Analyzes all grants by each funder to learn their patterns.
 * Called by cron or manually.
 */
export async function buildFunderProfiles(): Promise<{ created: number; updated: number }> {
  const supabase = createAdminClient();

  // Get all unique funders with their grant data
  const { data: opps } = await supabase
    .from('opportunities')
    .select('funder, categories, target_populations, regions, amount_min, amount_max, deadline, open_date, type')
    .not('funder', 'is', null);

  if (!opps || opps.length === 0) return { created: 0, updated: 0 };

  // Group by funder
  const funderMap = new Map<string, typeof opps>();
  for (const opp of opps) {
    const name = normalizeFunderName(opp.funder);
    if (!name) continue;
    const list = funderMap.get(name) || [];
    list.push(opp);
    funderMap.set(name, list);
  }

  let created = 0;
  let updated = 0;

  for (const [funderName, grants] of funderMap) {
    // Aggregate domains, populations, regions across all their grants
    const allDomains = new Set<string>();
    const allPops = new Set<string>();
    const allRegions = new Set<string>();
    const amounts: { min: number; max: number }[] = [];
    const months = new Set<number>();

    for (const g of grants) {
      for (const c of (g.categories || [])) allDomains.add(c);
      for (const p of (g.target_populations || [])) allPops.add(p);
      for (const r of (g.regions || [])) allRegions.add(r);
      if (g.amount_min) amounts.push({ min: g.amount_min, max: g.amount_max || g.amount_min });
      if (g.deadline) {
        const month = new Date(g.deadline).getMonth() + 1;
        months.add(month);
      }
      if (g.open_date) {
        const month = new Date(g.open_date).getMonth() + 1;
        months.add(month);
      }
    }

    // Calculate typical amounts
    const typicalMin = amounts.length > 0
      ? Math.round(amounts.reduce((s, a) => s + a.min, 0) / amounts.length)
      : undefined;
    const typicalMax = amounts.length > 0
      ? Math.round(amounts.reduce((s, a) => s + a.max, 0) / amounts.length)
      : undefined;

    // Detect funder style from name
    const style = detectFunderStyle(funderName);

    // Try to match with a company in the companies table
    const { data: matchedCompany } = await supabase
      .from('companies')
      .select('id')
      .or(`name.ilike.%${funderName}%`)
      .limit(1)
      .single();

    const profile = {
      funder_name: funderName,
      company_id: matchedCompany?.id || null,
      preferred_domains: [...allDomains],
      preferred_populations: [...allPops],
      preferred_regions: [...allRegions],
      typical_amount_min: typicalMin,
      typical_amount_max: typicalMax,
      recurring_months: [...months].sort((a, b) => a - b),
      funder_style: style,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from('funder_intelligence')
      .upsert(profile, { onConflict: 'funder_name' });

    if (!error) {
      if (matchedCompany) updated++;
      else created++;
    }
  }

  // Link opportunities to their funder_intelligence record
  const { data: allFunders } = await supabase
    .from('funder_intelligence')
    .select('id, funder_name');

  if (allFunders) {
    for (const fi of allFunders) {
      await supabase
        .from('opportunities')
        .update({ funder_id: fi.id })
        .eq('funder', fi.funder_name)
        .is('funder_id', null);
    }
  }

  return { created, updated };
}

// ===== Outcome Learning =====

/**
 * Record an outcome signal when a submission result is reported.
 * Updates both outcome_signals (anonymous cross-org learning) and funder_intelligence.
 */
export async function recordOutcome(
  submissionId: string,
  outcome: 'approved' | 'rejected' | 'partial',
  approvedAmount?: number
): Promise<void> {
  const supabase = createAdminClient();

  // Load submission + opportunity + org profile
  const { data: sub } = await supabase
    .from('submissions')
    .select('id, org_id, opportunity_id, requested_amount, funder_name')
    .eq('id', submissionId)
    .single();

  if (!sub) return;

  // Get opportunity data
  let oppData: { funder: string; categories: string[]; target_populations: string[] } | null = null;
  if (sub.opportunity_id) {
    const { data } = await supabase
      .from('opportunities')
      .select('funder, categories, target_populations')
      .eq('id', sub.opportunity_id)
      .single();
    oppData = data;
  }

  // Get org DNA
  let orgDomains: string[] = [];
  let orgPopulations: string[] = [];
  let orgSize = 'small';
  if (sub.org_id) {
    const { data: profile } = await supabase
      .from('org_profiles')
      .select('data')
      .eq('org_id', sub.org_id)
      .single();
    const profileData = (profile?.data as Record<string, unknown>) || {};
    const dna = profileData._dna as Record<string, unknown> | undefined;
    if (dna) {
      orgDomains = (dna.domains as string[]) || [];
      orgPopulations = (dna.populations as string[]) || [];
      orgSize = (dna.orgType as string) || 'small';
    }
  }

  const funderName = sub.funder_name || oppData?.funder || '';

  // 1. Save anonymous outcome signal
  if (funderName) {
    await supabase.from('outcome_signals').insert({
      funder_name: funderName,
      opportunity_categories: oppData?.categories || [],
      opportunity_populations: oppData?.target_populations || [],
      org_domains: orgDomains,
      org_populations: orgPopulations,
      org_size: orgSize,
      outcome,
      approved_amount: approvedAmount,
      requested_amount: sub.requested_amount,
    });
  }

  // 2. Update funder_intelligence aggregates
  if (funderName) {
    const { data: fi } = await supabase
      .from('funder_intelligence')
      .select('id, total_submissions, total_approved, total_rejected, avg_approved_amount')
      .eq('funder_name', funderName)
      .single();

    if (fi) {
      const newTotal = (fi.total_submissions || 0) + 1;
      const newApproved = (fi.total_approved || 0) + (outcome === 'approved' || outcome === 'partial' ? 1 : 0);
      const newRejected = (fi.total_rejected || 0) + (outcome === 'rejected' ? 1 : 0);

      // Running average of approved amounts
      let newAvg = fi.avg_approved_amount;
      if (approvedAmount && approvedAmount > 0) {
        const prevAvg = fi.avg_approved_amount || 0;
        const prevCount = fi.total_approved || 0;
        newAvg = prevCount > 0
          ? (prevAvg * prevCount + approvedAmount) / (prevCount + 1)
          : approvedAmount;
      }

      await supabase
        .from('funder_intelligence')
        .update({
          total_submissions: newTotal,
          total_approved: newApproved,
          total_rejected: newRejected,
          avg_approved_amount: newAvg,
          updated_at: new Date().toISOString(),
        })
        .eq('id', fi.id);
    }
  }
}

// ===== Readiness Score =====

/**
 * Calculate how ready an org is to submit to a specific opportunity.
 * Considers: profile completeness, document availability, time to deadline, funder fit.
 */
export async function calculateReadiness(
  orgId: string,
  opportunityId: string
): Promise<ReadinessScore> {
  const supabase = createAdminClient();

  const [profileRes, docsRes, oppRes, memoryRes] = await Promise.all([
    supabase.from('org_profiles').select('data').eq('org_id', orgId).single(),
    supabase.from('documents').select('filename, category').eq('org_id', orgId),
    supabase.from('opportunities').select('*, funder_intelligence:funder_id(*)').eq('id', opportunityId).single(),
    supabase.from('org_memory').select('key, value').eq('org_id', orgId).limit(50),
  ]);

  const profile = (profileRes.data?.data as Record<string, unknown>) || {};
  const docs = docsRes.data || [];
  const opp = oppRes.data;
  const memory = memoryRes.data || [];

  if (!opp) return { score: 0, factors: [], missingDocs: [] };

  const factors: ReadinessFactor[] = [];
  const missingDocs: string[] = [];

  // 1. Profile completeness (25 points)
  const dna = profile._dna as Record<string, unknown> | undefined;
  const profileComplete = (dna?.profileCompleteness as number) || 0;
  factors.push({
    label: 'שלמות פרופיל ארגוני',
    met: profileComplete >= 60,
    weight: 25,
  });

  // 2. Has relevant documents (20 points)
  const docCategories = docs.map(d => (d as { category?: string }).category).filter(Boolean);
  const hasFinancials = docCategories.some(c => c === 'financial' || c === 'budget');
  const hasActivity = docCategories.some(c => c === 'activity_report' || c === 'impact');
  const hasRegistration = docCategories.some(c => c === 'registration' || c === 'legal');

  if (!hasFinancials) missingDocs.push('דוח כספי / תקציב');
  if (!hasActivity) missingDocs.push('דוח פעילות / אימפקט');
  if (!hasRegistration) missingDocs.push('מסמכי רישום / ניהול תקין');

  factors.push({
    label: 'מסמכים נדרשים',
    met: missingDocs.length === 0,
    weight: 20,
  });

  // 3. Time to deadline (20 points)
  let timeWarning: string | undefined;
  if (opp.deadline) {
    const daysLeft = Math.ceil((new Date(opp.deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (daysLeft < 0) {
      timeWarning = 'פג תוקף';
      factors.push({ label: 'זמן עד דדליין', met: false, weight: 20 });
    } else if (daysLeft < 7) {
      timeWarning = `נותרו ${daysLeft} ימים בלבד!`;
      factors.push({ label: 'זמן עד דדליין (דחוף)', met: false, weight: 20 });
    } else if (daysLeft < 21) {
      timeWarning = `נותרו ${daysLeft} ימים`;
      factors.push({ label: 'זמן עד דדליין (צפוף)', met: true, weight: 10 });
    } else {
      factors.push({ label: 'זמן עד דדליין', met: true, weight: 20 });
    }
  } else {
    // No deadline = always ready
    factors.push({ label: 'ללא דדליין', met: true, weight: 20 });
  }

  // 4. Previous experience with this funder (15 points)
  const funderName = opp.funder || '';
  const submissionsRes = await supabase
    .from('submissions')
    .select('outcome')
    .eq('org_id', orgId)
    .ilike('funder_name', `%${funderName}%`);

  const prevSubmissions = submissionsRes.data || [];
  const hasPrevExperience = prevSubmissions.length > 0;
  const hadApproval = prevSubmissions.some(s => (s as { outcome?: string }).outcome === 'approved');

  factors.push({
    label: 'ניסיון קודם עם גוף מממן',
    met: hasPrevExperience,
    weight: hadApproval ? 15 : (hasPrevExperience ? 10 : 0),
  });

  // 5. Org has mission / theory of change defined (10 points)
  const hasMission = !!(profile.mission && String(profile.mission).length > 30);
  const hasTheoryOfChange = !!(profile.theory_of_change);
  factors.push({
    label: 'ייעוד ותיאוריית שינוי מוגדרים',
    met: hasMission,
    weight: hasTheoryOfChange ? 10 : (hasMission ? 7 : 0),
  });

  // 6. Org memory richness (10 points) — more facts = better prepared
  const memoryCount = memory.length;
  factors.push({
    label: 'עומק הכרת הארגון',
    met: memoryCount >= 10,
    weight: Math.min(10, memoryCount),
  });

  // Calculate total
  const score = Math.min(100, factors.reduce((sum, f) => sum + (f.met ? f.weight : 0), 0));

  return { score, factors, missingDocs, timeWarning };
}

// ===== Cross-Org Pattern Learning =====

/**
 * Get aggregated outcome patterns for a specific funder.
 * Returns anonymous insights: "orgs like yours that applied to X had Y% success".
 */
export async function getFunderPatterns(funderName: string): Promise<{
  approvalRate: number | null;
  avgAmount: number | null;
  successfulOrgProfile: { domains: string[]; populations: string[]; sizes: string[] } | null;
  totalDataPoints: number;
}> {
  const supabase = createAdminClient();

  const { data: signals } = await supabase
    .from('outcome_signals')
    .select('*')
    .eq('funder_name', funderName);

  if (!signals || signals.length === 0) {
    return { approvalRate: null, avgAmount: null, successfulOrgProfile: null, totalDataPoints: 0 };
  }

  const approved = signals.filter(s => s.outcome === 'approved' || s.outcome === 'partial');
  const approvalRate = Math.round((approved.length / signals.length) * 100);

  const amounts = approved
    .map(s => s.approved_amount)
    .filter((a): a is number => a != null && a > 0);
  const avgAmount = amounts.length > 0
    ? Math.round(amounts.reduce((s, a) => s + a, 0) / amounts.length)
    : null;

  // What kind of org succeeds with this funder?
  const successDomains = new Map<string, number>();
  const successPops = new Map<string, number>();
  const successSizes = new Map<string, number>();

  for (const s of approved) {
    for (const d of (s.org_domains || [])) successDomains.set(d, (successDomains.get(d) || 0) + 1);
    for (const p of (s.org_populations || [])) successPops.set(p, (successPops.get(p) || 0) + 1);
    if (s.org_size) successSizes.set(s.org_size, (successSizes.get(s.org_size) || 0) + 1);
  }

  const topDomains = [...successDomains.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(e => e[0]);
  const topPops = [...successPops.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(e => e[0]);
  const topSizes = [...successSizes.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);

  return {
    approvalRate,
    avgAmount,
    successfulOrgProfile: approved.length > 0 ? { domains: topDomains, populations: topPops, sizes: topSizes } : null,
    totalDataPoints: signals.length,
  };
}

// ===== Recurrence Detection =====

/**
 * Generate a recurrence key for a grant — used to detect recurring grants
 * across years. Normalizes the title by removing year references.
 */
export function generateRecurrenceKey(funder: string, title: string): string {
  const normalizedTitle = title
    .replace(/\b20\d{2}\b/g, '')           // remove years like 2024, 2025, 2026
    .replace(/\b\d{4}\b/g, '')              // remove 4-digit numbers
    .replace(/תשפ"[א-ת]|תשפ[א-ת]/g, '')   // remove Hebrew years
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  const normalizedFunder = normalizeFunderName(funder);
  return `${normalizedFunder}::${normalizedTitle}`;
}

/**
 * Find grants that are likely to recur based on past patterns.
 * Returns funders that had grants before but don't have active ones now.
 */
export async function findUpcomingRecurrences(): Promise<{
  funder_name: string;
  last_title: string;
  expected_month: number;
  last_deadline: string;
}[]> {
  const supabase = createAdminClient();

  // Get funder intelligence with recurring months
  const { data: funders } = await supabase
    .from('funder_intelligence')
    .select('funder_name, recurring_months, cycle_notes')
    .not('recurring_months', 'eq', '{}');

  if (!funders || funders.length === 0) return [];

  const currentMonth = new Date().getMonth() + 1;
  const upcoming: {
    funder_name: string;
    last_title: string;
    expected_month: number;
    last_deadline: string;
  }[] = [];

  for (const f of funders) {
    const months = f.recurring_months || [];
    // Check if any of their months is 1-3 months away
    for (const m of months) {
      const diff = m - currentMonth;
      if (diff >= 1 && diff <= 3) {
        // Get their last grant
        const { data: lastGrant } = await supabase
          .from('opportunities')
          .select('title, deadline')
          .eq('funder', f.funder_name)
          .order('deadline', { ascending: false })
          .limit(1)
          .single();

        if (lastGrant) {
          upcoming.push({
            funder_name: f.funder_name,
            last_title: lastGrant.title,
            expected_month: m,
            last_deadline: lastGrant.deadline,
          });
        }
      }
    }
  }

  return upcoming;
}

// ===== Helpers =====

function normalizeFunderName(name: string | null): string {
  if (!name) return '';
  return name
    .replace(/\s+/g, ' ')
    .trim();
}

function detectFunderStyle(funderName: string): string {
  const name = funderName.toLowerCase();

  if (/משרד|ממשל|רשות|ביטוח לאומי|בתי המשפט|מינהל/.test(name)) {
    return 'government';
  }
  if (/קרן|foundation|fund/.test(name)) {
    return 'foundation';
  }
  if (/federation|פדרציה|ujа|cjp|juf/.test(name)) {
    return 'federation';
  }
  if (/חברה|בע"מ|corp|inc|ltd/.test(name)) {
    return 'corporate';
  }
  if (/ג'וינט|ג׳וינט|joint|jdc/.test(name)) {
    return 'foundation';
  }
  if (/מפעל הפיס|pais/.test(name)) {
    return 'government';
  }
  if (/סוכנות|jewish agency/.test(name)) {
    return 'federation';
  }
  return 'other';
}
