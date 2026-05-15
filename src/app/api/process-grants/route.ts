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
import { getAuthContext } from '@/lib/api-auth';

export const maxDuration = 300; // 5 דקות — Vercel Pro

export async function POST(req: NextRequest) {
  // Read body ONCE — re-reading a consumed stream returns {}
  const body = await req.json().catch(() => ({}));

  const authHeader = req.headers.get('authorization') || '';
  const cronSecret = process.env.CRON_SECRET || '';
  const isCron = !!cronSecret && authHeader === `Bearer ${cronSecret}`;

  let orgId: string | undefined;
  let mode: string = body?.mode || 'staging';

  if (isCron) {
    orgId = body?.org_id;
  } else {
    // UI path — try cookie session, then fall back to org_id from body
    const auth = await getAuthContext(req);
    orgId = body?.org_id || auth?.orgId;
    if (!orgId) {
      console.log('[process-grants] Unauthorized — no org_id in body and no session', {
        hasBody: !!body,
        bodyKeys: Object.keys(body),
        hasSession: !!auth,
        detail: 'send org_id in POST body or ensure cookies are included',
      });
      return NextResponse.json({
        error: 'Unauthorized',
        detail: 'No session found and no org_id in request body. Include { org_id } in POST body.',
      }, { status: 401 });
    }
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
