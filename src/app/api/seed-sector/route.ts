import { NextRequest } from 'next/server';
import { ingestAllSources, ingestCustomUrl, SECTOR_SOURCES, SectorSource } from '@/lib/ai/sector-ingestion';
import { getAuthContext } from '@/lib/api-auth';

export const maxDuration = 300;

/**
 * POST /api/seed-sector
 * Manual trigger for sector knowledge ingestion.
 * Admin-only endpoint — requires valid session.
 *
 * Body (optional):
 *   { force?: boolean, sources?: SectorSource[] }
 *   or
 *   { url: string, name: string, category?: string, subcategory?: string }
 */
export async function POST(request: NextRequest) {
  const auth = await getAuthContext(request);
  if (!auth) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    // empty body is fine — defaults apply
  }

  // Single custom URL mode
  if (body.url && body.name) {
    const result = await ingestCustomUrl(
      body.url as string,
      body.name as string,
      (body.category as SectorSource['category']) || 'sector_knowledge',
      body.subcategory as string | undefined
    );
    return Response.json({ ok: true, result, timestamp: new Date().toISOString() });
  }

  // Bulk mode — use provided sources or fall back to default list
  const sources = (body.sources as SectorSource[] | undefined) ?? SECTOR_SOURCES;
  const force = body.force === true;

  console.log(`[seed-sector] Starting manual ingestion — ${sources.length} sources, force=${force}, org=${auth.orgId}`);

  const summary = await ingestAllSources(sources, force);

  console.log(`[seed-sector] Done: ${summary.success} success, ${summary.skipped} skipped, ${summary.errors} errors`);

  return Response.json({
    ok: true,
    summary,
    timestamp: new Date().toISOString(),
  });
}

/**
 * GET /api/seed-sector
 * Quick status — how many sector chunks exist in the knowledge base.
 */
export async function GET(request: NextRequest) {
  const auth = await getAuthContext(request);
  if (!auth) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { createAdminClient } = await import('@/lib/supabase/admin');
  const supabase = createAdminClient();

  const { count } = await supabase
    .from('knowledge_chunks')
    .select('*', { count: 'exact', head: true })
    .in('category', ['sector_knowledge', 'grants_intel', 'funder_intel', 'research', 'news']);

  const { data: recent } = await supabase
    .from('knowledge_chunks')
    .select('title, category, updated_at')
    .in('category', ['sector_knowledge', 'grants_intel', 'funder_intel', 'research', 'news'])
    .order('updated_at', { ascending: false })
    .limit(5);

  return Response.json({
    ok: true,
    total_chunks: count ?? 0,
    sources_configured: SECTOR_SOURCES.length,
    recent,
    next_cron: '1st of every month at 03:00 UTC',
  });
}
