/**
 * GET /api/jobs/:id
 * Returns status and result of a queued job.
 */

import { withAuth } from '@/lib/api-auth';
import { getJob } from '@/lib/queue';

export const GET = withAuth(async (_request, _auth, params) => {
  const id = params?.id;
  if (!id) return Response.json({ error: 'חסר מזהה משימה' }, { status: 400 });

  const job = await getJob(id);

  if (!job) {
    return Response.json({ error: 'משימה לא נמצאה' }, { status: 404 });
  }

  return Response.json({
    job_id: job.id,
    type: job.type,
    status: job.status,
    created_at: job.created_at,
    started_at: job.started_at,
    finished_at: job.finished_at,
    result: job.status === 'done' ? job.result : null,
    error: job.status === 'failed' ? job.error : null,
  });
});
