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

export const maxDuration = 300; // 5 דקות — Vercel Pro

export async function POST(req: NextRequest) {
  // ── אימות ──
  const auth = req.headers.get('authorization') || '';
  const cronSecret = process.env.CRON_SECRET || '';

  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── org_id אופציונלי מה-body ──
  let orgId: string | undefined;
  let mode: string = 'staging';
  try {
    const body = await req.json().catch(() => ({}));
    orgId = body?.org_id;
    mode  = body?.mode || 'staging'; // 'staging' | 'existing'
  } catch {
    // body ריק — בסדר
  }

  console.log(`[process-grants] mode=${mode} org=${orgId || 'DEV_ORG_ID'}`);

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
