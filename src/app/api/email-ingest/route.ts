/**
 * /api/email-ingest
 * Webhook endpoint for receiving forwarded newsletters to ingest@goldfish.ai
 *
 * Compatible with:
 *   - SendGrid Inbound Parse (POST multipart/form-data)
 *   - Postmark Inbound (POST application/json)
 *   - Resend Inbound Webhooks (POST application/json)
 *
 * Setup: point your MX record / email forwarding service to this URL.
 * Auth:  INGEST_WEBHOOK_SECRET env var (add as bearer or query param ?secret=)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { extractFromEmail } from '@/lib/ai/social-signals';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  // Auth check
  const secret = process.env.INGEST_WEBHOOK_SECRET;
  if (secret) {
    const authHeader = request.headers.get('authorization');
    const querySecret = request.nextUrl.searchParams.get('secret');
    if (authHeader !== `Bearer ${secret}` && querySecret !== secret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  let subject = '';
  let fromEmail = '';
  let bodyText = '';
  let orgId: string | null = null;

  const contentType = request.headers.get('content-type') || '';

  try {
    if (contentType.includes('application/json')) {
      // Postmark / Resend format
      const body = await request.json();
      subject = body.Subject || body.subject || '';
      fromEmail = body.From || body.from_email || body.from || '';
      bodyText = body.TextBody || body.text || body.plain_text || '';
      // Org can be encoded in the To address: ingest+ORG_ID@goldfish.ai
      const toAddress: string = body.To || body.to || '';
      const orgMatch = toAddress.match(/ingest\+([a-f0-9-]+)@/i);
      if (orgMatch) orgId = orgMatch[1];
    } else {
      // SendGrid multipart format
      const formData = await request.formData();
      subject = String(formData.get('subject') || '');
      fromEmail = String(formData.get('from') || '');
      bodyText = String(formData.get('text') || formData.get('html') || '');
      const toAddress = String(formData.get('to') || '');
      const orgMatch = toAddress.match(/ingest\+([a-f0-9-]+)@/i);
      if (orgMatch) orgId = orgMatch[1];
    }
  } catch {
    return NextResponse.json({ error: 'Failed to parse body' }, { status: 400 });
  }

  if (!bodyText && !subject) {
    return NextResponse.json({ error: 'Empty email' }, { status: 400 });
  }

  const supabase = createAdminClient();

  // Save raw ingest
  const { data: ingestRow } = await supabase
    .from('email_ingests')
    .insert({ org_id: orgId, from_email: fromEmail, subject, body_text: bodyText.slice(0, 50000) })
    .select('id')
    .single()
    .then((r: { data: { id: string } | null }) => r, () => ({ data: null }));

  // Extract opportunity using AI
  const opp = await extractFromEmail(subject, bodyText);

  if (!opp) {
    return NextResponse.json({ status: 'received', opportunity: false });
  }

  // Save as hot opportunity
  const row = {
    org_id: orgId || null,
    source_type: 'email_ingest' as const,
    source_name: fromEmail || 'Email Ingest',
    source_url: null,
    title: opp.title,
    description: opp.description,
    pain_point: opp.pain_point,
    strategic_insight: opp.strategic_insight,
    amount_hint: opp.amount_hint || null,
    deadline_hint: opp.deadline_hint || null,
    raw_text: opp.raw_text,
    active: true,
    notified: false,
  };

  const { data: hotRow } = await supabase
    .from('hot_opportunities')
    .insert(row)
    .select('id')
    .single()
    .then((r: { data: { id: string } | null }) => r, () => ({ data: null }));

  // Link back to ingest record
  if (ingestRow?.id && hotRow?.id) {
    await supabase
      .from('email_ingests')
      .update({ processed: true, hot_opportunity_id: hotRow.id })
      .eq('id', ingestRow.id);
  }

  return NextResponse.json({
    status: 'processed',
    opportunity: true,
    hot_opportunity_id: hotRow?.id || null,
    title: opp.title,
  });
}
