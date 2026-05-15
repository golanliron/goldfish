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

// Max concurrent jobs — keeps LLM rate limits safe while still parallelising
const MAX_CONCURRENT_JOBS = 3;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET || '';
  const auth = req.headers.get('authorization') || '';

  if (secret && auth !== `Bearer ${secret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Run up to MAX_CONCURRENT_JOBS in parallel.
  // processNext() uses an optimistic lock (status='pending' check) so two
  // concurrent calls will never claim the same job.
  const settled = await Promise.allSettled(
    Array.from({ length: MAX_CONCURRENT_JOBS }, () => processNext()),
  );

  const processed: string[] = [];
  const errors: string[] = [];

  for (const s of settled) {
    if (s.status === 'fulfilled' && s.value) {
      processed.push(`${s.value.job_id}(${s.value.type})`);
    } else if (s.status === 'rejected') {
      errors.push(String(s.reason));
    }
  }

  console.log(`[worker] Processed ${processed.length} jobs:`, processed.join(', ') || 'none');

  return Response.json({
    ok: true,
    processed: processed.length,
    jobs: processed,
    errors,
  });
}
