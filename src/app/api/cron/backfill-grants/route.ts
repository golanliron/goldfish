import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createAdminClient } from '@/lib/supabase/admin';
import { generateRecurrenceKey } from '@/lib/ai/funder-learning';

export const maxDuration = 300;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const VALID_CATEGORIES = [
  'education', 'welfare', 'health', 'mental_health', 'employment', 'culture',
  'environment', 'technology', 'coexistence', 'community', 'social_innovation',
  'legal', 'sport', 'housing', 'agriculture', 'science', 'religion', 'infrastructure',
  'dropout_prevention',
];
const VALID_POPULATIONS = [
  'youth_at_risk', 'youth', 'young_adults', 'children', 'disabilities', 'elderly',
  'immigrants', 'arab', 'haredi', 'women', 'soldiers', 'homeless', 'addiction',
  'lgbtq', 'refugees', 'prisoners', 'general',
];
const VALID_REGIONS = [
  'negev', 'galilee', 'periphery', 'center', 'jerusalem', 'haifa', 'national', 'international',
];

// One-time backfill: classify existing grants that don't have also_relevant_for
// Run manually: GET /api/cron/backfill-grants?batch=20
export async function GET(req: Request) {
  const url = new URL(req.url);
  const batchSize = Math.min(50, parseInt(url.searchParams.get('batch') || '20'));
  const supabase = createAdminClient();

  // Find grants without also_relevant_for (or empty)
  const { data: grants } = await supabase
    .from('opportunities')
    .select('id, title, description, funder, categories, target_populations, regions')
    .eq('active', true)
    .or('also_relevant_for.is.null,also_relevant_for.eq.{}')
    .limit(batchSize);

  if (!grants || grants.length === 0) {
    return NextResponse.json({ ok: true, message: 'No grants to backfill', processed: 0 });
  }

  let classified = 0;
  let recurrenceUpdated = 0;

  for (const grant of grants) {
    try {
      const text = `${grant.title}\n${grant.description || ''}`.slice(0, 3000);

      const res = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        system: `אתה יועץ גיוס משאבים. סווג את הקול קורא והוסף "also_relevant_for" — קטגוריות/אוכלוסיות נוספות שיכולים להגיש.

קטגוריות: ${VALID_CATEGORIES.join(', ')}
אוכלוסיות: ${VALID_POPULATIONS.join(', ')}
אזורים: ${VALID_REGIONS.join(', ')}

חשוב מעבר: "חוסן קהילתי"=חינוך+נוער+בריאות, "שוויון"=נשים+ערבים+מוגבלויות+פריפריה, "פיתוח נגב"=כל ארגון באזור.

החזר JSON:
{ "categories": [], "target_populations": [], "regions": [], "also_relevant_for": [], "relevance_reasoning": "" }`,
        messages: [{ role: 'user', content: text }],
        max_tokens: 400,
      });

      const aiText = res.content[0].type === 'text' ? res.content[0].text : '{}';
      const jsonMatch = aiText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) continue;

      const parsed = JSON.parse(jsonMatch[0]);
      const allValidTags = [...VALID_CATEGORIES, ...VALID_POPULATIONS, ...VALID_REGIONS];
      const alsoRelevant = (parsed.also_relevant_for || []).filter((k: string) => allValidTags.includes(k));

      // Merge — keep existing categories, add AI-classified ones
      const newCategories = [...new Set([...(grant.categories || []), ...(parsed.categories || []).filter((k: string) => VALID_CATEGORIES.includes(k))])];
      const newPops = [...new Set([...(grant.target_populations || []), ...(parsed.target_populations || []).filter((k: string) => VALID_POPULATIONS.includes(k))])];
      const newRegions = [...new Set([...(grant.regions || []), ...(parsed.regions || []).filter((k: string) => VALID_REGIONS.includes(k))])];

      const updates: Record<string, unknown> = {
        also_relevant_for: alsoRelevant,
      };

      // Only update categories/populations/regions if they were empty
      if (!grant.categories || grant.categories.length === 0) updates.categories = newCategories;
      if (!grant.target_populations || grant.target_populations.length === 0) updates.target_populations = newPops;
      if (!grant.regions || grant.regions.length === 0) updates.regions = newRegions;

      // Add recurrence key if missing
      if (grant.funder) {
        const recKey = generateRecurrenceKey(grant.funder, grant.title);
        if (recKey.length > 3) {
          updates.recurrence_key = recKey;
          updates.last_seen_at = new Date().toISOString();
          recurrenceUpdated++;
        }
      }

      await supabase.from('opportunities').update(updates).eq('id', grant.id);
      classified++;

      // Small delay to avoid rate limits
      await new Promise(r => setTimeout(r, 200));
    } catch {
      // Skip individual failures
    }
  }

  return NextResponse.json({
    ok: true,
    processed: grants.length,
    classified,
    recurrence_updated: recurrenceUpdated,
    remaining: grants.length === batchSize ? 'more to process' : 'done',
  });
}
