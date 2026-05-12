import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'crypto';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// GET /api/submissions?org_id=xxx — list all submissions for org
export async function GET(req: NextRequest) {
  const orgId = req.nextUrl.searchParams.get('org_id');
  if (!orgId) return NextResponse.json({ error: 'Missing org_id' }, { status: 400 });

  const supabase = createAdminClient();
  const { data } = await supabase
    .from('submissions')
    .select('id, status, version, created_at, requested_amount, share_token, opportunity_id')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });

  return NextResponse.json({ submissions: data || [] });
}

// POST /api/submissions — generate draft submission from rfp_id + org profile
export async function POST(req: NextRequest) {
  const { org_id, rfp_id, opportunity_id } = await req.json();
  if (!org_id || !rfp_id) return NextResponse.json({ error: 'Missing org_id or rfp_id' }, { status: 400 });

  const supabase = createAdminClient();

  // Load RFP + org profile + documents in parallel
  const [rfpRes, profileRes, docsRes] = await Promise.all([
    supabase.from('rfp_parsed').select('*').eq('id', rfp_id).single(),
    supabase.from('org_profiles').select('data').eq('org_id', org_id).single(),
    supabase.from('documents').select('filename, category, metadata, parsed_text').eq('org_id', org_id).limit(10),
  ]);

  const rfp = rfpRes.data;
  const profile = (profileRes.data?.data as Record<string, unknown>) || {};
  const docs = docsRes.data || [];

  if (!rfp) return NextResponse.json({ error: 'RFP not found' }, { status: 404 });

  const questions = (rfp.questions as { id: string; question: string; max_chars?: number }[]) || [];

  // Build org context
  const orgContext = [
    profile.name ? `שם הארגון: ${profile.name}` : '',
    profile.mission ? `ייעוד: ${profile.mission}` : '',
    profile.summary ? `תיאור: ${profile.summary}` : '',
    Array.isArray(profile.focus_areas) ? `תחומי פעילות: ${(profile.focus_areas as string[]).join(', ')}` : '',
    Array.isArray(profile.target_populations) ? `אוכלוסיות יעד: ${(profile.target_populations as string[]).join(', ')}` : '',
    Array.isArray(profile.regions) ? `אזורי פעילות: ${(profile.regions as string[]).join(', ')}` : '',
    profile.beneficiaries_count ? `מספר מוטבים: ${profile.beneficiaries_count}` : '',
    profile.annual_budget ? `תקציב שנתי: ${profile.annual_budget}` : '',
    profile.employees_count ? `עובדים: ${profile.employees_count}` : '',
    profile.theory_of_change ? `תיאוריית שינוי: ${profile.theory_of_change}` : '',
    profile.unique_model ? `מה ייחודי בנו: ${profile.unique_model}` : '',
    Array.isArray(profile.key_achievements) ? `הישגים: ${(profile.key_achievements as string[]).join('. ')}` : '',
  ].filter(Boolean).join('\n');

  const docContext = docs
    .filter(d => d.parsed_text)
    .map(d => `[${d.filename}]: ${String(d.parsed_text).slice(0, 1500)}`)
    .join('\n\n')
    .slice(0, 15000);

  // Generate answers for all questions
  const prompt = `אתה מומחה בכתיבת הגשות לקרנות ומענקים עבור ארגונים חברתיים בישראל.
כתוב תשובות מקצועיות לשאלות קול הקורא הבא, בהתבסס על פרופיל הארגון.

גוף מממן: ${rfp.funder_name}
שם קול הקורא: ${rfp.rfp_title}
קריטריוני הערכה: ${(rfp.evaluation_criteria as string[])?.join(', ') || 'לא צוינו'}

פרופיל הארגון:
${orgContext}

מסמכים נוספים:
${docContext || 'אין מסמכים נוספים'}

כתוב תשובה לכל שאלה. כל תשובה צריכה:
- להיות מדויקת, מקצועית, ובגוף ראשון רבים
- להשתמש בנתונים אמיתיים מהפרופיל
- להתאים לסגנון הגוף המממן (${rfp.funder_type})
- לא לעלות על ${'{max_chars}'} תווים אם צוין
- להיות בעברית תקינה ומשכנעת

החזר JSON בלבד:
{
  "answers": [
    ${questions.map(q => `{ "id": "${q.id}", "question": "${q.question.replace(/"/g, "'")}",  "answer": "תשובה מפורטת" }`).join(',\n    ')}
  ]
}`;

  let answers: { id: string; question: string; answer: string }[] = [];
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8000,
      messages: [{ role: 'user', content: prompt }],
    });
    const raw = msg.content[0].type === 'text' ? msg.content[0].text : '';
    const clean = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    answers = parsed.answers || [];
  } catch {
    // Fallback — empty answers
    answers = questions.map(q => ({ id: q.id, question: q.question, answer: '' }));
  }

  // Build content array
  const content = answers.map(a => ({
    id: a.id,
    question: a.question,
    answer: a.answer,
    max_chars: questions.find(q => q.id === a.id)?.max_chars || null,
  }));

  // Generate share token
  const shareToken = randomUUID().replace(/-/g, '').slice(0, 16);

  // Save submission
  const { data: sub } = await supabase
    .from('submissions')
    .insert({
      org_id,
      opportunity_id: opportunity_id || null,
      content,
      status: 'draft',
      share_token: shareToken,
    })
    .select('id, share_token')
    .single();

  return NextResponse.json({
    submission_id: sub?.id,
    share_token: sub?.share_token,
    share_url: `${process.env.NEXT_PUBLIC_APP_URL || ''}/s/${sub?.share_token}`,
    content,
    rfp_title: rfp.rfp_title,
    funder_name: rfp.funder_name,
  });
}
