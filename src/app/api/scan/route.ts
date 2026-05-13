import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createAdminClient } from '@/lib/supabase/admin';
import { withAuth } from '@/lib/api-auth';
import { buildOrgContext } from '@/lib/ai/fishgold';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

interface ScoredMatch {
  opportunity_id: string;
  title: string;
  score: number;
  reasoning: string;
  deadline: string | null;
  funder: string | null;
  url: string | null;
}

export const POST = withAuth(async (request, auth) => {
  try {
    const org_id = auth.orgId;

    const supabase = createAdminClient();

    // 1. Load org profile
    const [{ data: profile }, { data: org }] = await Promise.all([
      supabase.from('org_profiles').select('data').eq('org_id', org_id).single(),
      supabase.from('organizations').select('name').eq('id', org_id).single(),
    ]);

    const profileData = profile?.data as Record<string, unknown> | null;

    if (!profileData || Object.keys(profileData).length === 0) {
      return Response.json({
        error: 'אין פרופיל ארגוני. שלחי לינק לאתר או העלי מסמכים כדי שאלמד על הארגון.',
        matches: [],
      });
    }

    // 2. Load active grants from opportunities table (updated daily by scanner)
    const today = new Date().toISOString().split('T')[0];
    const { data: opportunities } = await supabase
      .from('opportunities')
      .select('id, title, description, deadline, categories, target_populations, funder, url, type')
      .eq('active', true)
      .or(`deadline.is.null,deadline.gte.${today}`)
      .order('deadline', { ascending: true, nullsFirst: false })
      .limit(60);

    if (!opportunities || opportunities.length === 0) {
      return Response.json({ matches: [], message: 'אין קולות קוראים פתוחים כרגע.' });
    }

    // 3. Pre-filter: match by categories and populations overlap
    const orgCategories = extractOrgCategories(profileData);
    const orgPopulations = extractOrgPopulations(profileData);

    const preFiltered = opportunities.filter((opp) => {
      const catOverlap = opp.categories?.some((c: string) => orgCategories.includes(c));
      const popOverlap = opp.target_populations?.some((p: string) => orgPopulations.includes(p));
      // Pass if either categories or populations match, or if opp has no specific filters
      return catOverlap || popOverlap || (!opp.categories?.length && !opp.target_populations?.length);
    });

    // Take top 20 pre-filtered for AI scoring
    const candidates = preFiltered.slice(0, 20);

    if (candidates.length === 0) {
      return Response.json({
        matches: [],
        message: 'לא מצאתי קולות קוראים שמתאימים לפרופיל שלך כרגע. נסי לעדכן את הפרופיל או לחכות לקולות חדשים.',
      });
    }

    // 4. AI Scoring - Claude rates each opportunity
    const orgContext = buildOrgContext(profileData, org?.name ?? null);
    const oppList = candidates.map((o, i) =>
      `${i + 1}. "${o.title}" | קטגוריות: ${o.categories?.join(', ') || 'לא צוין'} | אוכלוסיות: ${o.target_populations?.join(', ') || 'לא צוין'} | דדליין: ${o.deadline || 'לא צוין'} | גוף: ${o.funder || 'לא ידוע'}`
    ).join('\n');

    const res = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      system: `אתה מומחה גיוס משאבים ישראלי. קיבלת פרופיל ארגון ורשימת קולות קוראים.
דרג כל קול קורא מ-1 עד 10 לפי התאמה **ספציפית** לארגון.

כללי ציון (תהיה מחמיר!):
- 9-10: התאמה מושלמת — תחום, אוכלוסייה, גודל ואזור תואמים בדיוק
- 7-8: התאמה גבוהה — תחום ואוכלוסייה תואמים, שאר הקריטריונים סבירים
- 5-6: התאמה בינונית — חפיפה ברורה בתחום OR אוכלוסייה, אבל לא בשניהם
- 1-4: לא מתאים — אל תכלול ברשימה

קריטריונים:
- תחום פעילות תואם (40%) — חייב להיות חפיפה אמיתית, לא מילה בודדת. קול קורא על חקלאות/מים/מזון לא מתאים לעמותת חינוך/נוער
- אוכלוסיית יעד תואמת (30%) — האוכלוסיה שהקול הקורא מכוון אליה חייבת להתאים לאוכלוסייה שהארגון משרת
- גודל/סוג הארגון מתאים (15%) — מחקר אקדמי לא מתאים לעמותה קטנה
- אזור גיאוגרפי (15%)

חשוב: אם הקול הקורא עוסק בתחום שונה מהותית מהארגון (למשל חקלאות/מים/סביבה לעומת חינוך/נוער), הציון חייב להיות 4 או פחות גם אם יש מילים משותפות.

החזר JSON בלבד — מערך של אובייקטים:
[{"index": 1, "score": 8, "reasoning": "נימוק קצר בעברית"}, ...]

רק פריטים עם ציון 5 ומעלה. אם אין — החזר מערך ריק.`,
      messages: [{
        role: 'user',
        content: `${orgContext}\n\n===== קולות קוראים פתוחים =====\n${oppList}`,
      }],
      max_tokens: 2000,
    });

    // Parse AI response
    const raw = res.content[0].type === 'text' ? res.content[0].text : '[]';
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, raw];
    let scored: { index: number; score: number; reasoning: string }[] = [];
    try {
      scored = JSON.parse(jsonMatch[1]!.trim());
    } catch {
      scored = [];
    }

    // 5. Build matches and save to DB
    const matches: ScoredMatch[] = [];

    for (const item of scored) {
      if (item.score < 5) continue;
      const opp = candidates[item.index - 1];
      if (!opp) continue;

      matches.push({
        opportunity_id: opp.id,
        title: opp.title,
        score: item.score,
        reasoning: item.reasoning,
        deadline: opp.deadline,
        funder: opp.funder,
        url: opp.url,
      });

      // Save match to DB (upsert to avoid duplicates)
      await supabase.from('matches').upsert(
        {
          org_id,
          opportunity_id: opp.id,
          score: item.score * 10, // DB stores 0-100
          reasoning: item.reasoning,
          status: 'new',
        },
        { onConflict: 'org_id,opportunity_id', ignoreDuplicates: true }
      );
    }

    // Sort by score descending
    matches.sort((a, b) => b.score - a.score);

    return Response.json({
      matches,
      total_scanned: candidates.length,
      message: matches.length > 0
        ? `מצאתי ${matches.length} הזדמנויות שמתאימות לך!`
        : 'לא מצאתי התאמות חזקות כרגע. ננסה שוב כשיהיו קולות קוראים חדשים.',
    });
  } catch (error) {
    console.error('Scan error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});

// ===== Helpers =====

function extractOrgCategories(profile: Record<string, unknown>): string[] {
  const focusAreas = (profile.focus_areas as string[]) || [];
  const categoryMap: Record<string, string[]> = {
    'חינוך': ['education'],
    'נשירה': ['education', 'welfare'],
    'מניעת נשירה': ['education', 'welfare'],
    'נוער': ['education', 'welfare'],
    'צעירים': ['education', 'welfare', 'employment'],
    'בוגרים': ['education', 'employment'],
    'תעסוקה': ['employment'],
    'רווחה': ['welfare'],
    'קהילה': ['community'],
    'בריאות': ['health'],
    'תרבות': ['culture'],
    'סביבה': ['environment'],
    'מלגות': ['education'],
    'ליווי': ['welfare', 'community'],
    'זכויות': ['welfare'],
    'מוגבלויות': ['welfare', 'health'],
    'עולים': ['welfare', 'community'],
  };

  const result = new Set<string>();
  for (const area of focusAreas) {
    for (const [keyword, categories] of Object.entries(categoryMap)) {
      if (area.includes(keyword)) {
        categories.forEach((c) => result.add(c));
      }
    }
  }

  // Default: at least education and welfare
  if (result.size === 0) {
    result.add('education');
    result.add('welfare');
  }

  return [...result];
}

function extractOrgPopulations(profile: Record<string, unknown>): string[] {
  const focusAreas = (profile.focus_areas as string[]) || [];
  const mission = (profile.mission as string) || '';
  const combined = [...focusAreas, mission].join(' ');

  const popMap: Record<string, string> = {
    'נוער': 'youth',
    'צעירים': 'youth',
    'בני נוער': 'youth',
    'נשירה': 'youth_at_risk',
    'סיכון': 'youth_at_risk',
    'נשים': 'women',
    'מוגבלויות': 'disabilities',
    'עולים': 'new_immigrants',
    'קליטה': 'new_immigrants',
    'קשישים': 'elderly',
    'זקנה': 'elderly',
    'סטודנטים': 'students',
    'לימודים': 'students',
    'מלגות': 'students',
    'חרדים': 'haredi',
    'ערבים': 'arab',
    'דרום': 'south_residents',
    'נגב': 'south_residents',
    'צפון': 'north_residents',
    'פריפריה': 'periphery_residents',
  };

  const result = new Set<string>();
  for (const [keyword, pop] of Object.entries(popMap)) {
    if (combined.includes(keyword)) {
      result.add(pop);
    }
  }

  return [...result];
}
