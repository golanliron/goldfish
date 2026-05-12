import { NextResponse } from 'next/server';
import { buildFunderProfiles, findUpcomingRecurrences } from '@/lib/ai/funder-learning';
import { createAdminClient } from '@/lib/supabase/admin';
import { generateRecurrenceKey } from '@/lib/ai/funder-learning';

export const maxDuration = 120;

// Runs weekly — builds/updates funder intelligence profiles from opportunity data
export async function GET() {
  const start = Date.now();

  // 1. Build/update funder profiles from all opportunities
  const { created, updated } = await buildFunderProfiles();

  // 2. Update recurrence keys on all opportunities
  const supabase = createAdminClient();
  const { data: opps } = await supabase
    .from('opportunities')
    .select('id, funder, title')
    .is('recurrence_key', null)
    .not('funder', 'is', null);

  let recurrenceUpdated = 0;
  if (opps) {
    for (const opp of opps) {
      const key = generateRecurrenceKey(opp.funder, opp.title);
      if (key && key.length > 3) {
        await supabase
          .from('opportunities')
          .update({ recurrence_key: key, last_seen_at: new Date().toISOString() })
          .eq('id', opp.id);
        recurrenceUpdated++;
      }
    }
  }

  // 3. Find upcoming recurrences
  const upcoming = await findUpcomingRecurrences();

  const elapsed = Date.now() - start;

  return NextResponse.json({
    ok: true,
    elapsed_ms: elapsed,
    funder_profiles: { created, updated },
    recurrence_keys_updated: recurrenceUpdated,
    upcoming_recurrences: upcoming.length,
    upcoming,
  });
}
