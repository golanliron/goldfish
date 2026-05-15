/**
 * POST /api/notify-match
 *
 * Called by the match engine (or a cron job) when a high-score opportunity is found.
 * Sends a WhatsApp push notification to all registered users of that org.
 *
 * Body: {
 *   org_id: string,
 *   opportunity_id: string,
 *   score: number,        // 0–100
 *   secret?: string       // optional internal secret to prevent abuse
 * }
 *
 * The endpoint fetches the opportunity + org + whatsapp_users internally —
 * the caller only needs to pass IDs and score.
 */

import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { notifyUserOnMatch } from '@/app/api/whatsapp/route';

const NOTIFY_SECRET = process.env.NOTIFY_MATCH_SECRET || '';
const MIN_SCORE_FOR_PUSH = 90;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { org_id, opportunity_id, score, secret } = body as {
      org_id: string;
      opportunity_id: string;
      score: number;
      secret?: string;
    };

    // Basic auth — if NOTIFY_MATCH_SECRET is set, require it
    if (NOTIFY_SECRET && secret !== NOTIFY_SECRET) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!org_id || !opportunity_id || typeof score !== 'number') {
      return Response.json({ error: 'Missing required fields: org_id, opportunity_id, score' }, { status: 400 });
    }

    if (score < MIN_SCORE_FOR_PUSH) {
      return Response.json({ ok: true, skipped: true, reason: `Score ${score} < ${MIN_SCORE_FOR_PUSH} threshold` });
    }

    const supabase = createAdminClient();

    // Fetch opportunity details
    const { data: opp } = await supabase
      .from('opportunities')
      .select('id, title, funder, url, active')
      .eq('id', opportunity_id)
      .single();

    if (!opp || !opp.active) {
      return Response.json({ ok: true, skipped: true, reason: 'Opportunity not found or inactive' });
    }

    // Fetch org name
    const { data: org } = await supabase
      .from('organizations')
      .select('name')
      .eq('id', org_id)
      .single();

    if (!org) {
      return Response.json({ error: 'Organization not found' }, { status: 404 });
    }

    // Fetch all WhatsApp users linked to this org
    const { data: waUsers } = await supabase
      .from('whatsapp_users')
      .select('phone, name')
      .eq('org_id', org_id);

    if (!waUsers || waUsers.length === 0) {
      return Response.json({ ok: true, skipped: true, reason: 'No WhatsApp users for this org' });
    }

    // Send notification to each user (usually 1–2 per org)
    const results = await Promise.allSettled(
      waUsers.map(user =>
        notifyUserOnMatch({
          phone: user.phone,
          userName: user.name || '',
          orgName: org.name,
          opportunityTitle: opp.title,
          score,
          funder: opp.funder,
          url: opp.url,
          opportunityId: opportunity_id,
          orgId: org_id,
        })
      )
    );

    const sent = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    console.log('[notify-match] Results:', { org_id, opportunity_id, score, sent, failed });

    return Response.json({ ok: true, sent, failed });
  } catch (error) {
    console.error('[notify-match] Error:', error);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
