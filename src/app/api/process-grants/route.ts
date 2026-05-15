/**
 * POST /api/process-grants
 *
 * מופעל על-ידי:
 * 1. scanner.py (Python) — אחרי שמירת קולות קוראים גולמיים
 * 2. Vercel Cron / GitHub Actions
 * 3. ידנית מממשק האדמין
 *
 * אבטחה: Bearer token (CRON_SECRET) — לא מצריך Supabase session
 */

import { NextRequest, NextResponse } from 'next/server';
import { processStagingCalls, processExistingCalls } from '@/lib/ai/agent-pipeline';
import { ProcessGrantsRequestSchema } from '@/lib/utils/validate';

export const maxDuration = 300; // 5 דקות — Vercel Pro
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  // Read body ONCE — re-reading a consumed stream returns {}
  const rawBody = await req.json().catch(() => ({}));
  const parsed = ProcessGrantsRequestSchema.safeParse(rawBody);
  const body = parsed.success ? parsed.data : rawBody; // degrade gracefully for cron

  const authHeader = req.headers.get('authorization') || '';
  const cronSecret = process.env.CRON_SECRET || '';
  const isCron = !!cronSecret && authHeader === `Bearer ${cronSecret}`;

  const orgId: string | undefined = body?.org_id;
  const mode: string = body?.mode || 'staging';

  // Security: require valid CRON_SECRET token
  if (!isCron) {
    return NextResponse.json({
      error: 'Unauthorized',
      detail: 'Bearer CRON_SECRET token required.',
    }, { status: 401 });
  }

  // org_id is always required — no fallback to DEV_ORG_ID
  if (!orgId) {
    return NextResponse.json({
      error: 'org_id is required',
      detail: 'Include { org_id } in POST body.',
    }, { status: 400 });
  }

  console.log(`[process-grants] mode=${mode} org=${orgId} isCron=${isCron}`);

  try {
    const result = mode === 'existing'
      ? await processExistingCalls(orgId)
      : await processStagingCalls(orgId);
    return NextResponse.json({ ok: true, mode, result });
  } catch (e) {
    console.error('[process-grants] Pipeline error:', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// GET: בדיקת זמינות
export async function GET() {
  return NextResponse.json({
    ok: true,
    message: 'Grant Research Agent pipeline — POST with Bearer token to run',
  });
}
