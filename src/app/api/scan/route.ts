import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { withAuth } from '@/lib/api-auth';
import { buildOrgContext } from '@/lib/ai/fishgold';
import { scoreOpportunitiesAI, type ScoredOpportunity } from '@/lib/ai/scoring-service';
import { enqueue } from '@/lib/queue';
import { scanLog } from '@/lib/logger';

type ScoredMatch = ScoredOpportunity;

// Cache key = today's date + org_id (invalidated daily)
function scanCacheKey(orgId: string): string {
  const today = new Date().toISOString().split('T')[0];
  return `scan_${today}_${orgId}`;
}

export const POST = withAuth(async (request, auth) => {
  const org_id = auth.orgId;
  const supabase = createAdminClient();
  const start = Date.now();

  // ?async=true → enqueue job, return 202 immediately
  const url = new URL(request.url);
  const asyncMode = url.searchParams.get('async') === 'true';

  if (asyncMode) {
    try {
      const cacheKey = scanCacheKey(org_id);
      const { data: cached } = await supabase
        .from('scan_cache').select('payload')
        .eq('org_id', org_id).eq('cache_type', 'opportunities').eq('cache_key', cacheKey)
        .gt('expires_at', new Date().toISOString()).single();
      if (cached?.payload) {
        scanLog.info({ org_id, duration_ms: Date.now() - start }, 'scan cache hit (async path)');
        return Response.json({ ...(cached.payload as object), from_cache: true });
      }
      const { job_id } = await enqueue('scan_opportunities', {}, org_id);
      scanLog.info({ org_id, job_id }, 'scan enqueued async');
      return Response.json(
        { job_id, status: 'pending', message: 'הסריקה החלה ברקע — תוצאות יהיו מוכנות תוך 30 שניות' },
        { status: 202 },
      );
    } catch (err) {
      scanLog.error({ err, org_id }, 'failed to enqueue scan');
      return Response.json({ error: 'שגיאה בהפעלת הסריקה. נסי שוב.' }, { status: 500 });
    }
  }

  scanLog.info({ org_id }, 'scan started (sync)');

  try {
    // ── 0. Cache check: return stored results if scan ran today ──────────
    const cacheKey = scanCacheKey(org_id);
    const { data: cached } = await supabase
      .from('scan_cache')
      .select('payload')
      .eq('org_id', org_id)
      .eq('cache_type', 'opportunities')
      .eq('cache_key', cacheKey)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (cached?.payload) {
      return Response.json({ ...(cached.payload as object), from_cache: true });
    }

    // ── 1. Load org profile ───────────────────────────────────────────────
    const [{ data: profile }, { data: org }] = await Promise.all([
      supabase.from('org_profiles').select('data').eq('org_id', org_id).single(),
      supabase.from('organizations').select('name').eq('id', org_id).single(),
    ]);

    const profileData = profile?.data as Record<string, unknown> | null;

    if (!profileData || Object.keys(profileData).length === 0) {
      return Response.json({
        error: 'אין פרופיל ארגוני. שלחי לינק לאתר או העלי מסמכים כדי שאלמד על הארגון.',
        matches: [],
      });
    }

    // ── 2. Load active opportunities ──────────────────────────────────────
    const today = new Date().toISOString().split('T')[0];
    const { data: opportunities, error: oppError } = await supabase
      .from('opportunities')
      .select('id, title, description, deadline, categories, target_populations, funder, url, type')
      .eq('active', true)
      .or(`deadline.is.null,deadline.gte.${today}`)
      .order('deadline', { ascending: true, nullsFirst: false })
      .limit(60);

    if (oppError) {
      scanLog.error({ err: oppError, org_id }, 'opportunities load error');
      return Response.json({ error: 'שגיאה בטעינת קולות קוראים. נסי שוב.', matches: [] }, { status: 502 });
    }

    if (!opportunities || opportunities.length === 0) {
      return Response.json({ matches: [], message: 'אין קולות קוראים פתוחים כרגע.' });
    }

    // ── 3. Pre-filter by category/population overlap ───────────────────────
    const orgCategories = extractOrgCategories(profileData);
    const orgPopulations = extractOrgPopulations(profileData);

    const preFiltered = opportunities.filter((opp) => {
      const catOverlap = opp.categories?.some((c: string) => orgCategories.includes(c));
      const popOverlap = opp.target_populations?.some((p: string) => orgPopulations.includes(p));
      return catOverlap || popOverlap || (!opp.categories?.length && !opp.target_populations?.length);
    });

    const candidates = preFiltered.slice(0, 20);

    if (candidates.length === 0) {
      return Response.json({
        matches: [],
        message: 'לא מצאתי קולות קוראים שמתאימים לפרופיל שלך כרגע. נסי לעדכן את הפרופיל או לחכות לקולות חדשים.',
      });
    }

    // ── 4. AI Scoring via centralized scoring-service ─────────────────────
    let matches: ScoredMatch[];
    try {
      const orgContextText = buildOrgContext(profileData, org?.name ?? null);
      matches = await scoreOpportunitiesAI(candidates, orgContextText);
    } catch (aiError) {
      scanLog.error({ err: aiError, org_id }, 'AI scoring failed');
      return Response.json({
        error: 'שגיאה בניתוח ה-AI. ייתכן שהשירות זמנית לא זמין — נסי שוב בעוד מספר דקות.',
        matches: [],
      }, { status: 503 });
    }

    // ── 5. Persist matches to DB ──────────────────────────────────────────
    for (const m of matches) {
      await supabase.from('matches').upsert(
        {
          org_id,
          opportunity_id: m.opportunity_id,
          score: m.score * 10,
          reasoning: m.reasoning,
          status: 'new',
        },
        { onConflict: 'org_id,opportunity_id', ignoreDuplicates: true },
      );
    }

    // ── 6. Save to scan_cache for 24h ─────────────────────────────────────
    const responsePayload = {
      matches,
      total_scanned: candidates.length,
      message:
        matches.length > 0
          ? `מצאתי ${matches.length} הזדמנויות שמתאימות לך!`
          : 'לא מצאתי התאמות חזקות כרגע. ננסה שוב כשיהיו קולות קוראים חדשים.',
    };

    await supabase.from('scan_cache').upsert(
      {
        org_id,
        cache_type: 'opportunities',
        cache_key: cacheKey,
        payload: responsePayload,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      },
      { onConflict: 'org_id,cache_type,cache_key' },
    );

    scanLog.info({ org_id, matches: matches.length, duration_ms: Date.now() - start }, 'scan complete');
    return Response.json(responsePayload);

  } catch (error) {
    scanLog.error({ err: error, org_id, duration_ms: Date.now() - start }, 'scan unexpected error');
    return Response.json(
      { error: 'אירעה שגיאה בלתי צפויה. נסי שוב בעוד מספר דקות.', matches: [] },
      { status: 500 },
    );
  }
});

// ===== Helpers =====

function extractOrgCategories(profile: Record<string, unknown>): string[] {
  const focusAreas = (profile.focus_areas as string[]) || [];
  const categoryMap: Record<string, string[]> = {
    'חינוך': ['education'],
    'נשירה': ['education', 'welfare'],
    'מניעת נשירה': ['education', 'welfare'],
    'נוער': ['education', 'welfare'],
    'צעירים': ['education', 'welfare', 'employment'],
    'בוגרים': ['education', 'employment'],
    'תעסוקה': ['employment'],
    'רווחה': ['welfare'],
    'קהילה': ['community'],
    'בריאות': ['health'],
    'תרבות': ['culture'],
    'סביבה': ['environment'],
    'מלגות': ['education'],
    'ליווי': ['welfare', 'community'],
    'זכויות': ['welfare'],
    'מוגבלויות': ['welfare', 'health'],
    'עולים': ['welfare', 'community'],
  };

  const result = new Set<string>();
  for (const area of focusAreas) {
    for (const [keyword, categories] of Object.entries(categoryMap)) {
      if (area.includes(keyword)) {
        categories.forEach((c) => result.add(c));
      }
    }
  }

  // Default: at least education and welfare
  if (result.size === 0) {
    result.add('education');
    result.add('welfare');
  }

  return [...result];
}

function extractOrgPopulations(profile: Record<string, unknown>): string[] {
  const focusAreas = (profile.focus_areas as string[]) || [];
  const mission = (profile.mission as string) || '';
  const combined = [...focusAreas, mission].join(' ');

  const popMap: Record<string, string> = {
    'נוער': 'youth',
    'צעירים': 'youth',
    'בני נוער': 'youth',
    'נשירה': 'youth_at_risk',
    'סיכון': 'youth_at_risk',
    'נשים': 'women',
    'מוגבלויות': 'disabilities',
    'עולים': 'new_immigrants',
    'קליטה': 'new_immigrants',
    'קשישים': 'elderly',
    'זקנה': 'elderly',
    'סטודנטים': 'students',
    'לימודים': 'students',
    'מלגות': 'students',
    'חרדים': 'haredi',
    'ערבים': 'arab',
    'דרום': 'south_residents',
    'נגב': 'south_residents',
    'צפון': 'north_residents',
    'פריפריה': 'periphery_residents',
  };

  const result = new Set<string>();
  for (const [keyword, pop] of Object.entries(popMap)) {
    if (combined.includes(keyword)) {
      result.add(pop);
    }
  }

  return [...result];
}
