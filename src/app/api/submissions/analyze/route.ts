import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import Anthropic from '@anthropic-ai/sdk';

export const maxDuration = 60;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// POST /api/submissions/analyze — analyze org-RFP fit before writing a draft
export async function POST(req: NextRequest) {
  const { org_id, rfp_id } = await req.json();
  if (!org_id || !rfp_id) {
    return NextResponse.json({ error: 'Missing org_id or rfp_id' }, { status: 400 });
  }

  const supabase = createAdminClient();

  const [rfpRes, profileRes, docsRes] = await Promise.all([
    supabase.from('rfp_parsed').select('*').eq('id', rfp_id).single(),
    supabase.from('org_profiles').select('data').eq('org_id', org_id).single(),
    supabase.from('documents').select('filename, parsed_text').eq('org_id', org_id).limit(8),
  ]);

  const rfp = rfpRes.data;
  const profile = (profileRes.data?.data as Record<string, unknown>) || {};
  const docs = docsRes.data || [];

  if (!rfp) return NextResponse.json({ error: 'RFP not found' }, { status: 404 });

  const orgContext = [
    profile.name ? `שם: ${profile.name}` : '',
    profile.mission ? `ייעוד: ${profile.mission}` : '',
    profile.summary ? `תיאור: ${profile.summary}` : '',
    Array.isArray(profile.focus_areas) ? `תחומים: ${(profile.focus_areas as string[]).join(', ')}` : '',
    Array.isArray(profile.target_populations) ? `אוכלוסיות: ${(profile.target_populations as string[]).join(', ')}` : '',
    Array.isArray(profile.regions) ? `אזורים: ${(profile.regions as string[]).join(', ')}` : '',
    profile.beneficiaries_count ? `מוטבים: ${profile.beneficiaries_count}` : '',
    profile.annual_budget ? `תקציב: ${profile.annual_budget}` : '',
    profile.theory_of_change ? `תיאוריית שינוי: ${profile.theory_of_change}` : '',
    profile.unique_model ? `ייחודיות: ${profile.unique_model}` : '',
    Array.isArray(profile.key_achievements) ? `הישגים: ${(profile.key_achievements as string[]).join('. ')}` : '',
  ].filter(Boolean).join('\n');

  const docSnippet = docs
    .filter(d => d.parsed_text)
    .map(d => `[${d.filename}]: ${String(d.parsed_text).slice(0, 800)}`)
    .join('\n\n')
    .slice(0, 6000);

  const prompt = `אתה יועץ מומחה בגיוס משאבים לארגונים חברתיים. נתחת אלפי בקשות מענק — אתה יודע מה עובד ומה לא.

## קול קורא
שם: ${rfp.rfp_title}
גוף מממן: ${rfp.funder_name}
סוג גוף: ${rfp.funder_type || 'לא ידוע'}
תיאור: ${rfp.rfp_description || ''}
קריטריוני הערכה: ${(rfp.evaluation_criteria as string[])?.join(' | ') || 'לא צוינו'}
אוכלוסיות יעד: ${(rfp.target_populations as string[])?.join(', ') || 'לא צוינו'}
תחומים: ${(rfp.focus_areas as string[])?.join(', ') || 'לא צוינו'}
סכום מענק: ${rfp.max_amount ? `עד ${rfp.max_amount} ₪` : 'לא צוין'}

## פרופיל הארגון
${orgContext || 'פרופיל לא מלא'}

## מסמכי הארגון (קטעים)
${docSnippet || 'אין מסמכים'}

## משימה
נתח את רמת ההתאמה בין הארגון לבין קול הקורא הזה.

החזר JSON בלבד (ללא \`\`\`json\`\`\`):
{
  "score": <מספר 1-10>,
  "verdict": "<משפט אחד: שווה להגיש / שקלי פעמיים / לא מומלץ>",
  "verdict_reason": "<הסבר קצר — 1-2 משפטים למה הציון הזה>",
  "strengths": ["<חוזקה 1>", "<חוזקה 2>", "<חוזקה 3>"],
  "gaps": ["<פער/חולשה 1>", "<פער/חולשה 2>"],
  "tips": ["<טיפ מעשי לשיפור ההגשה 1>", "<טיפ מעשי 2>"]
}

כללים:
- score 8-10: התאמה גבוהה, verdict = "שווה להגיש"
- score 5-7: התאמה חלקית, verdict = "שקלי פעמיים"
- score 1-4: התאמה נמוכה, verdict = "לא מומלץ"
- strengths: מה הארגון עושה טוב ביחס לדרישות הספציפיות של קול הקורא הזה
- gaps: מה חסר בפרופיל הארגון ביחס לדרישות
- tips: המלצות קונקרטיות לכתיבת הגשה מנצחת לקול קורא ספציפי זה`;

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1200,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = msg.content[0].type === 'text' ? msg.content[0].text : '';
    const clean = raw.replace(/```json|```/g, '').trim();
    const analysis = JSON.parse(clean);

    return NextResponse.json({ analysis });
  } catch (err) {
    console.error('Analyze error:', err);
    return NextResponse.json({ error: 'Analysis failed' }, { status: 500 });
  }
}
