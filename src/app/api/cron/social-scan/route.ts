import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { runSocialScan, scoreOppForOrg, type Influencer, type HotOpportunity } from '@/lib/ai/social-signals';

// Vercel Cron: daily at 09:00 UTC
export const maxDuration = 300; // 5 min

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results = await socialScanJob();
  return Response.json(results);
}

async function socialScanJob() {
  const supabase = createAdminClient();
  const log: string[] = [];

  // 1. Expire old hot opportunities
  await supabase.rpc('expire_hot_opportunities').then(
    () => log.push('expired old opportunities'),
    (err: unknown) => log.push(`expire failed: ${err}`)
  );

  // 2. Load active influencers from watchlist
  const { data: influencers, error: infErr } = await supabase
    .from('funder_influencers')
    .select('id, name, title, organization, org_type, keywords, topics, regions')
    .eq('active', true);

  if (infErr || !influencers) {
    return { error: 'Failed to load influencers', log };
  }

  log.push(`loaded ${influencers.length} influencers`);

  // 3. Run the social scan
  const scanResult = await runSocialScan(influencers as Influencer[], 2);
  log.push(`scanned ${scanResult.scanned_queries} queries, found ${scanResult.opportunities.length} raw opportunities`);

  if (scanResult.opportunities.length === 0) {
    return { saved: 0, scanned: scanResult.scanned_queries, log };
  }

  // 4. Load all org profiles for multi-tenant matching
  const { data: orgs } = await supabase
    .from('org_profiles')
    .select('org_id, topics, regions, name')
    .not('org_id', 'is', null);

  // 5. For each opportunity: compute match scores, save if any org scores >= 50
  let saved = 0;

  for (const opp of scanResult.opportunities) {
    const matchOrgs: Record<string, number> = {};

    if (orgs && orgs.length > 0) {
      for (const org of orgs) {
        const topics = (org.topics as string[] | null) || [];
        const regions = (org.regions as string[] | null) || ['IL'];
        const score = scoreOppForOrg(opp, topics, regions);
        if (score >= 50) {
          matchOrgs[org.org_id] = score;
        }
      }
    }

    // Only save if at least one org matches OR if it's high-value (has amount/deadline)
    const shouldSave = Object.keys(matchOrgs).length > 0 || !!opp.amount_hint || !!opp.deadline_hint;
    if (!shouldSave) continue;

    // Check for duplicate (same source_url in last 7 days)
    if (opp.source_url) {
      const { data: existing } = await supabase
        .from('hot_opportunities')
        .select('id')
        .eq('source_url', opp.source_url)
        .gte('discovered_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
        .limit(1);

      if (existing && existing.length > 0) continue; // already saved
    }

    const row = {
      source_type: opp.source_type,
      source_name: opp.source_name,
      source_url: opp.source_url || null,
      title: opp.title,
      description: opp.description,
      pain_point: opp.pain_point,
      strategic_insight: opp.strategic_insight,
      amount_hint: opp.amount_hint || null,
      deadline_hint: opp.deadline_hint || null,
      match_orgs: Object.keys(matchOrgs).length > 0 ? matchOrgs : null,
      raw_text: opp.raw_text,
      active: true,
      notified: false,
    };

    await supabase.from('hot_opportunities').insert(row).then(
      () => saved++,
      (err: unknown) => log.push(`insert failed: ${err}`)
    );
  }

  // 6. Update last_scanned_at for influencers
  await supabase
    .from('funder_influencers')
    .update({ last_scanned_at: new Date().toISOString() })
    .eq('active', true);

  // 7. Notify orgs with new hot opportunities (via existing WhatsApp/notify infrastructure)
  if (saved > 0) {
    await notifyNewHotOpportunities(supabase);
  }

  log.push(`saved ${saved} new hot opportunities`);

  return {
    saved,
    scanned_queries: scanResult.scanned_queries,
    influencers_checked: scanResult.influencers_checked,
    total_found: scanResult.opportunities.length,
    log,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function notifyNewHotOpportunities(supabase: any) {
  // Find unnotified hot opportunities
  const { data: hotOpps } = await supabase
    .from('hot_opportunities')
    .select('id, title, match_orgs, strategic_insight, source_url')
    .eq('notified', false)
    .eq('active', true);

  if (!hotOpps || hotOpps.length === 0) return;

  // Group by org
  const byOrg: Record<string, typeof hotOpps> = {};
  for (const opp of hotOpps) {
    if (!opp.match_orgs) continue;
    for (const orgId of Object.keys(opp.match_orgs)) {
      if (!byOrg[orgId]) byOrg[orgId] = [];
      byOrg[orgId].push(opp);
    }
  }

  for (const [orgId, opps] of Object.entries(byOrg)) {
    // Get org WhatsApp users
    const { data: users } = await supabase
      .from('whatsapp_users')
      .select('phone, name')
      .eq('org_id', orgId)
      .not('phone', 'is', null);

    if (!users || users.length === 0) continue;

    const titles = (opps as typeof hotOpps).map((o: { title: string }) => `• ${o.title}`).join('\n');
    const msg = `*הזדמנות חמה מהשטח* — Goldfish\n\nזיהינו ${opps.length} הזדמנות/ות חבויה/ות שרלוונטית/ות לארגון שלכם:\n\n${titles}\n\nהיכנסו ל-Goldfish ← לשונית קולות קוראים לפרטים ותובנה אסטרטגית.`;

    for (const user of (users as { phone: string }[])) {
      const greenApiUrl = process.env.GREEN_API_URL;
      const greenApiToken = process.env.GREEN_API_TOKEN;
      const greenApiInstance = process.env.GREEN_API_INSTANCE;

      if (!greenApiUrl || !greenApiToken || !greenApiInstance) continue;

      await fetch(
        `${greenApiUrl}/waInstance${greenApiInstance}/sendMessage/${greenApiToken}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chatId: `${user.phone}@c.us`, message: msg }),
        }
      ).catch(() => {/* silent */});
    }
  }

  // Mark all as notified
  const ids = hotOpps.map((o: { id: string }) => o.id);
  await supabase.from('hot_opportunities').update({ notified: true }).in('id', ids);
}
