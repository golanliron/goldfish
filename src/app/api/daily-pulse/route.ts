import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { withAuth } from '@/lib/api-auth';

export const GET = withAuth(async (_req, auth) => {
  const supabase = createAdminClient();
  const orgId = auth.orgId;

  // Get org profile for sector matching
  const { data: profileData } = await supabase
    .from('org_profiles')
    .select('data')
    .eq('org_id', orgId)
    .single();

  const profile = (profileData?.data as Record<string, unknown>) || {};
  const focusAreas = (profile.focus_areas as string[]) || [];
  const populations = (profile.target_populations as string[]) || [];
  const orgKeywords = [...focusAreas, ...populations].join(' ').toLowerCase();

  // Fetch recent sector intelligence (last 48h, high/medium relevance)
  const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const { data: items } = await supabase
    .from('sector_intelligence')
    .select('id, title, summary, category, tags, relevance_score, source, scan_date')
    .gte('scan_date', since)
    .gte('relevance_score', 60)
    .order('relevance_score', { ascending: false })
    .limit(20);

  if (!items || items.length === 0) {
    return NextResponse.json({ items: [], matched: 0 });
  }

  // Score each item against org keywords
  const scored = items.map((item) => {
    const text = `${item.title} ${item.summary} ${(item.tags || []).join(' ')}`.toLowerCase();
    let score = item.relevance_score || 0;

    // Boost if matches org keywords
    for (const kw of orgKeywords.split(/\s+/).filter(Boolean)) {
      if (kw.length > 2 && text.includes(kw)) score += 15;
    }

    return { ...item, computed_score: Math.min(score, 100) };
  });

  // Sort by computed score, take top 3
  const top = scored
    .sort((a, b) => b.computed_score - a.computed_score)
    .slice(0, 3);

  return NextResponse.json({ items: top, matched: top.length });
});
