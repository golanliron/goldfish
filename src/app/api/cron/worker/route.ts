/**
 * GET /api/cron/worker
 *
 * Vercel Cron job — runs every 2 minutes.
 * Processes up to 5 pending jobs per invocation.
 *
 * Add to vercel.json:
 *   { "crons": [{ "path": "/api/cron/worker", "schedule": "every 2 minutes" }] }
 *
 * Security: CRON_SECRET Bearer token (set in Vercel env vars)
 */

import { NextRequest } from 'next/server';
import { processNext } from '@/lib/queue';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const MAX_JOBS_PER_RUN = 5;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET || '';
  const auth = req.headers.get('authorization') || '';

  if (secret && auth !== `Bearer ${secret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const processed: string[] = [];
  const errors: string[] = [];

  for (let i = 0; i < MAX_JOBS_PER_RUN; i++) {
    const result = await processNext();
    if (!result) break; // no more pending jobs

    if (result) processed.push(`${result.job_id}(${result.type})`);
  }

  console.log(`[worker] Processed ${processed.length} jobs:`, processed.join(', ') || 'none');

  return Response.json({
    ok: true,
    processed: processed.length,
    jobs: processed,
    errors,
  });
}
