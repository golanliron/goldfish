import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (auth !== 'Bearer goldfish-seed-2026') {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createAdminClient();

  // Get all active opportunities with URL but no full_content
  const { data: opps, error } = await supabase
    .from('opportunities')
    .select('id, url')
    .eq('active', true)
    .not('url', 'is', null)
    .is('full_content', null)
    .limit(200);

  if (error || !opps) {
    return Response.json({ error: String(error) }, { status: 500 });
  }

  let updated = 0;
  let failed = 0;

  for (const opp of opps) {
    if (!opp.url) continue;
    try {
      const res = await fetch(opp.url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) { failed++; continue; }

      const html = await res.text();
      const text = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (text.length < 200) { failed++; continue; }

      const { error: updateErr } = await supabase
        .from('opportunities')
        .update({ full_content: text.slice(0, 8000) })
        .eq('id', opp.id);

      if (!updateErr) updated++;
      else failed++;
    } catch {
      failed++;
    }
  }

  return Response.json({ total: opps.length, updated, failed });
}
