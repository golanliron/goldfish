import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { withAuth } from '@/lib/api-auth';
import Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'crypto';
import { z } from 'zod';

const SubmissionRequestSchema = z.object({
  rfp_id: z.string().min(1, 'rfp_id הוא שדה חובה'),
  opportunity_id: z.string().optional(),
});

export const maxDuration = 120; // seconds — Vercel Pro/Team plan

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// GET /api/submissions — list all submissions for authenticated org
export const GET = withAuth(async (req, auth) => {
  const orgId = auth.orgId;

  const supabase = createAdminClient();
  const { data } = await supabase
    .from('submissions')
    .select('id, status, version, created_at, requested_amount, share_token, opportunity_id, outcome, approved_amount, funder_feedback, lessons_learned, opportunity:opportunities(title, funder)')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });

  return NextResponse.json({ submissions: data || [] });
});

// POST /api/submissions — generate draft submission from rfp_id + org profile
export const POST = withAuth(async (req, auth) => {
  const body = await req.json();
  const parsed = SubmissionRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'נתונים לא תקינים', details: parsed.error.flatten() }, { status: 400 });
  }
  const { rfp_id, opportunity_id } = parsed.data;
  const org_id = auth.orgId;

  const supabase = createAdminClient();

  // Load RFP + org profile + documents + org memory + past submissions in parallel
  const [rfpRes, profileRes, docsRes, memoryRes, pastSubsRes] = await Promise.all([
    supabase.from('rfp_parsed').select('*').eq('id', rfp_id).single(),
    supabase.from('org_profiles').select('data').eq('org_id', org_id).single(),
    supabase.from('documents').select('filename, category, metadata, parsed_text').eq('org_id', org_id).limit(10),
    supabase.from('org_memory').select('key, value').eq('org_id', org_id).limit(30),
    supabase.from('submissions').select('outcome, funder_feedback, lessons_learned, funder_name')
      .eq('org_id', org_id).not('outcome', 'is', null).limit(10),
  ]);

  const rfp = rfpRes.data;
  const profile = (profileRes.data?.data as Record<string, unknown>) || {};
  const docs = docsRes.data || [];
  const orgMemory = memoryRes.data || [];
  const pastSubs = pastSubsRes.data || [];

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

  // Funder-type-specific writing style guide
  const funderStyleGuide: Record<string, string> = {
    government: `גוף ממשלתי: השתמש בשפה רשמית ומדויקת. הדגש עמידה בקריטריונים מוגדרים, מדדים כמותיים, יעדים מדידים (SMART), ציות לנהלים, שיתוף פעולה עם גופים ממשלתיים. הצג תוכנית ביצוע ברורה עם אבני דרך. הוכח יכולת ניהולית ומוסדית.`,
    foundation: `קרן פילנתרופית: הדגש אימפקט חברתי עמוק, תיאוריית שינוי (Theory of Change) ברורה — בעיה → פעולה → תוצאה → שינוי מערכתי. כתוב בשפה חמה אך מקצועית. הצג ראיות, נתוני השפעה, וסיפורי שינוי. הראה חדשנות, ייחודיות מודל, ויכולת להשפיע בסקייל.`,
    corporate: `חברה עסקית / CSR: הדגש ROI חברתי (SROI), השפעה על הקהילה הרלוונטית לפעילות העסקית, מדדי ביצוע ברורים, שקיפות ואחריות תאגידית. קשר את הפרויקט לערכי החברה ולאסטרטגיה העסקית שלה. הצג שותפות עסקית-חברתית שמחזקת את שניהם.`,
    federation: `פדרציה יהודית / קהילתית: הדגש קשר לזהות יהודית, ערכי tikkun olam, חיזוק הקהילה, חינוך ערכי. הראה כיצד הפרויקט מחזק יהדות הגולה-ישראל. השתמש בשפה של שותפות, אחריות הדדית, קהילה. הצג מספרים ממשיים על הקהילה המושפעת.`,
    other: `הצג תשובות מקצועיות, ממוקדות אימפקט, עם נתונים ברורים ושפה שכנועית.`,
  };
  const funderStyle = funderStyleGuide[(rfp.funder_type as string)] || funderStyleGuide.other;

  // Load funder intelligence for personalized writing
  let funderIntel = '';
  const funderName = rfp.funder_name as string;
  if (funderName) {
    const { data: fi } = await supabase
      .from('funder_intelligence')
      .select('preferred_domains, preferred_populations, typical_amount_min, typical_amount_max, writing_tips, funder_style, total_approved, total_submissions')
      .eq('funder_name', funderName)
      .single();

    if (fi) {
      const parts: string[] = [];
      if (fi.preferred_domains?.length > 0) parts.push(`תחומים מועדפים: ${fi.preferred_domains.join(', ')}`);
      if (fi.preferred_populations?.length > 0) parts.push(`אוכלוסיות מועדפות: ${fi.preferred_populations.join(', ')}`);
      if (fi.typical_amount_min || fi.typical_amount_max) {
        parts.push(`טווח מענקים טיפוסי: ${fi.typical_amount_min || '?'} - ${fi.typical_amount_max || '?'} ש"ח`);
      }
      if (fi.total_submissions > 0) {
        parts.push(`אחוז אישור ידוע: ${Math.round((fi.total_approved / fi.total_submissions) * 100)}%`);
      }
      if (fi.writing_tips) parts.push(`טיפים: ${fi.writing_tips}`);
      if (parts.length > 0) funderIntel = parts.join('\n');
    }
  }

  // Build org memory context
  const memoryContext = orgMemory.length > 0
    ? orgMemory.map(m => `${(m as { key: string }).key}: ${(m as { value: string }).value}`).join('\n')
    : '';

  // Build past outcomes context (lessons learned)
  const pastOutcomesContext = pastSubs.length > 0
    ? pastSubs
      .filter(s => (s as { lessons_learned?: string }).lessons_learned || (s as { funder_feedback?: string }).funder_feedback)
      .map(s => {
        const sub = s as { outcome?: string; funder_name?: string; funder_feedback?: string; lessons_learned?: string };
        const parts = [`תוצאה: ${sub.outcome}`];
        if (sub.funder_name) parts.push(`גוף: ${sub.funder_name}`);
        if (sub.funder_feedback) parts.push(`משוב: ${sub.funder_feedback}`);
        if (sub.lessons_learned) parts.push(`לקחים: ${sub.lessons_learned}`);
        return parts.join(' | ');
      })
      .join('\n')
    : '';

  // Generate answers for all questions
  const prompt = `אתה מומחה בכיר בכתיבת הגשות לקרנות ומענקים לארגונים חברתיים בישראל. אתה יודע מה קרנות באמת רוצות לראות — נתונים, אימפקט, ייחודיות, אמינות.

## משימה
כתוב תשובות מנצחות לשאלות קול הקורא הבא. כל תשובה צריכה לשכנע את הוועדה שהארגון הזה הוא הבחירה הנכונה.

## פרטי קול הקורא
גוף מממן: ${rfp.funder_name}
סוג גוף: ${rfp.funder_type}
שם קול הקורא: ${rfp.rfp_title}
קריטריוני הערכה: ${(rfp.evaluation_criteria as string[])?.join(' | ') || 'לא צוינו'}
${funderIntel ? `\n## מודיעין על הגוף המממן\n${funderIntel}` : ''}

## פרופיל הארגון
${orgContext}
${memoryContext ? `\n## עובדות מאומתות על הארגון\n${memoryContext}` : ''}

## מסמכים ומידע נוסף
${docContext || 'אין מסמכים נוספים'}
${pastOutcomesContext ? `\n## לקחים מהגשות קודמות\nהארגון הגיש בעבר ולמד מהניסיון:\n${pastOutcomesContext}\nהשתמש בלקחים האלה כדי לשפר את הכתיבה הפעם.` : ''}

## הנחיית כתיבה לסוג הגוף המממן
${funderStyle}

## כללי כתיבה מחייבים
1. נתונים אמיתיים בלבד — השתמש רק בנתונים שמופיעים בפרופיל הארגון. אל תמציא מספרים, שמות, או הישגים.
2. מבנה PAS — Problem (הבעיה שפותרים) → Agitation (למה זה קריטי עכשיו) → Solution (מה הארגון עושה ואיך).
3. Theory of Change — בעיה חברתית ברורה → התערבות ייחודית → תוצאות מדידות → אימפקט מערכתי.
4. מדדים מספריים — כשיש מספרים בפרופיל (מוטבים, תקציב, שנות ניסיון), השתמש בהם. מספרים = אמינות.
5. גוף ראשון רבים — "אנחנו מפעילים", "הארגון שלנו", "המודל שלנו".
6. ייחודיות — הדגש מה שרק הארגון הזה עושה שאחרים לא עושים.
7. הגבלת תווים — אם יש max_chars לשאלה, כתוב תשובה שלא עוברת את הגבול.
8. עברית מדויקת — ללא ניסוחים גנריים, ללא ז'רגון מיותר. כתוב כמו מקצוען שמכיר את הארגון.

## פורמט החזרה
החזר JSON בלבד, ללא \`\`\`json\`\`\`, ללא הסברים.

{
  "answers": [
    ${questions.map(q => `{ "id": "${q.id}", "question": "${q.question.replace(/"/g, "'")}",  "answer": "תשובה מקצועית ומשכנעת" }`).join(',\n    ')}
  ]
}`;

  let answers: { id: string; question: string; answer: string }[] = [];
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
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
});
