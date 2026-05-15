import { NextRequest } from 'next/server';
import { ingestAllSources, SECTOR_SOURCES } from '@/lib/ai/sector-ingestion';

export const maxDuration = 300; // 5 min — allow full ingestion cycle

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const force = request.nextUrl.searchParams.get('force') === 'true';

  console.log(`[cron/sector-knowledge] Starting ingestion — ${SECTOR_SOURCES.length} sources, force=${force}`);

  const summary = await ingestAllSources(SECTOR_SOURCES, force);

  console.log(`[cron/sector-knowledge] Done: ${summary.success} success, ${summary.skipped} skipped, ${summary.errors} errors`);

  return Response.json({
    ok: true,
    summary,
    timestamp: new Date().toISOString(),
  });
}
