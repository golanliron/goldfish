/**
 * POST /api/jobs/enqueue
 *
 * Enqueue a background job. Returns immediately with job_id.
 * Client can poll GET /api/jobs/:id for status.
 *
 * Body: { type: JobType, payload: object }
 */

import { withAuth } from '@/lib/api-auth';
import { enqueue, type JobType } from '@/lib/queue';
import { z } from 'zod';

const EnqueueSchema = z.object({
  type: z.enum([
    'scan_opportunities',
    'process_grants',
    'learn_url',
    'analyze_document',
    'refresh_sector',
    'backfill_embeddings',
  ]),
  payload: z.record(z.string(), z.unknown()).default({}),
});

export const POST = withAuth(async (request, auth) => {
  const raw = await request.json().catch(() => ({}));
  const parsed = EnqueueSchema.safeParse(raw);

  if (!parsed.success) {
    return Response.json({ error: 'סוג המשימה לא תקין', details: parsed.error.issues }, { status: 400 });
  }

  const { type, payload } = parsed.data;

  const { job_id } = await enqueue(type as JobType, payload, auth.orgId);

  return Response.json({ job_id, status: 'pending', message: 'המשימה נוספה לתור' });
});
