import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { withAuth } from '@/lib/api-auth';
import Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'crypto';
import { z } from 'zod';

const SubmissionRequestSchema = z.object({
  rfp_id: z.string().min(1, 'rfp_id הוא שדה חובה'),
  opportunity_id: z.string().optional(),
  skip_existing_check: z.boolean().optional(), // force new draft even if one exists
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
  const { rfp_id, opportunity_id, skip_existing_check } = parsed.data;
  const org_id = auth.orgId;

  const supabase = createAdminClient();

  // ── Check for existing draft (same org + opportunity) ──────────────────────
  if (opportunity_id && !skip_existing_check) {
    const { data: existing } = await supabase
      .from('submissions')
      .select('id, share_token, content, status')
      .eq('org_id', org_id)
      .eq('opportunity_id', opportunity_id)
      .in('status', ['draft', 'submitted'])
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (existing?.share_token) {
      return NextResponse.json({
        submission_id: existing.id,
        share_token: existing.share_token,
        share_url: `${process.env.NEXT_PUBLIC_APP_URL || ''}/s/${existing.share_token}`,
        existing: true,
        status: existing.status,
      });
    }
  }

  // ── Load all context in parallel ──────────────────────────────────────────
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
  const requiredDocs = (rfp.required_documents as string[]) || [];
  const eligibility = (rfp.eligibility as Record<string, unknown>) || {};
  const rawText = (rfp.raw_text as string) || '';

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

  // What documents org already has
  const existingDocNames = docs.map(d => d.filename).join(', ') || 'אין';

  // Funder-type-specific writing style guide
  const funderStyleGuide: Record<string, string> = {
    government: `גוף ממשלתי: השתמש בשפה רשמית ומדויקת. הדגש עמידה בקריטריונים מוגדרים, מדדים כמותיים, יעדים מדידים (SMART), ציות לנהלים. הצג תוכנית ביצוע ברורה עם אבני דרך. הוכח יכולת ניהולית ומוסדית.`,
    foundation: `קרן פילנתרופית: הדגש אימפקט חברתי עמוק, Theory of Change ברורה — בעיה → פעולה → תוצאה → שינוי מערכתי. כתוב בשפה חמה אך מקצועית. הצג ראיות, נתוני השפעה, וסיפורי שינוי.`,
    corporate: `חברה עסקית / CSR: הדגש ROI חברתי (SROI), השפעה על הקהילה הרלוונטית לפעילות העסקית, מדדי ביצוע ברורים. קשר את הפרויקט לערכי החברה.`,
    federation: `פדרציה יהודית / קהילתית: הדגש קשר לזהות יהודית, ערכי tikkun olam, חיזוק הקהילה. הראה כיצד הפרויקט מחזק יהדות הגולה-ישראל.`,
    other: `הצג תשובות מקצועיות, ממוקדות אימפקט, עם נתונים ברורים ושפה שכנועית.`,
  };
  const funderStyle = funderStyleGuide[(rfp.funder_type as string)] || funderStyleGuide.other;

  // Load funder intelligence
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
      if (fi.typical_amount_min || fi.typical_amount_max) parts.push(`טווח מענקים: ${fi.typical_amount_min || '?'}-${fi.typical_amount_max || '?'} ₪`);
      if (fi.total_submissions > 0) parts.push(`אחוז אישור ידוע: ${Math.round((fi.total_approved / fi.total_submissions) * 100)}%`);
      if (fi.writing_tips) parts.push(`טיפים: ${fi.writing_tips}`);
      if (parts.length > 0) funderIntel = parts.join('\n');
    }
  }

  const memoryContext = orgMemory.length > 0
    ? orgMemory.map(m => `${(m as { key: string }).key}: ${(m as { value: string }).value}`).join('\n')
    : '';

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

  // ── Build sections list ────────────────────────────────────────────────────
  // If the RFP has explicit questions — use them as sections.
  // If not — derive sections from raw_text or use smart defaults.
  const hasExplicitQuestions = questions.length > 0;

  // Fixed meta-blocks always prepended
  const metaBlocks = [
    {
      id: '_rfp_info',
      question: 'פרטי קול הקורא',
      isFixed: true,
    },
    {
      id: '_missing',
      question: 'מסמכים וחסרים',
      isFixed: true,
    },
    {
      id: '_goldfish_notes',
      question: 'הערות Goldfish',
      isFixed: true,
    },
  ];

  // Sections for AI to fill
  const sectionsForAI: { id: string; question: string; max_chars?: number }[] = hasExplicitQuestions
    ? questions
    : [
        { id: 's1', question: 'תיאור הארגון ורקע' },
        { id: 's2', question: 'הצורך / הבעיה החברתית שאנו פותרים' },
        { id: 's3', question: 'תיאור הפרויקט המוצע' },
        { id: 's4', question: 'אוכלוסיית יעד ואזור פעילות' },
        { id: 's5', question: 'מטרות ויעדים מדידים' },
        { id: 's6', question: 'תוכנית עבודה ולוח זמנים' },
        { id: 's7', question: 'תוצאות ומדדי הצלחה' },
        { id: 's8', question: 'תקציב מבוקש ופירוט' },
      ];

  const sectionsJson = sectionsForAI
    .map(q => `{ "id": "${q.id}", "question": "${q.question.replace(/"/g, "'")}"${q.max_chars ? `, "max_chars": ${q.max_chars}` : ''} }`)
    .join(',\n    ');

  // Generate draft content
  const prompt = `אתה מומחה בכיר בכתיבת הגשות לקרנות ומענקים לארגונים חברתיים בישראל.
המשימה שלך: לכתוב טיוטת הגשה ראשונית אמיתית — לא שלד ריק, לא כותרות בלבד.
כל סעיף צריך לכלול טקסט ממשי המבוסס על נתוני הארגון ועל דרישות הקול הקורא.

## קול הקורא
שם: ${rfp.rfp_title}
גוף מממן: ${rfp.funder_name} (${rfp.funder_type || 'לא ידוע'})
${rfp.max_amount ? `סכום מקסימלי: ${rfp.max_amount} ₪` : ''}
${rfp.deadline ? `דדליין: ${new Date(rfp.deadline as string).toLocaleDateString('he-IL')}` : ''}
קריטריוני הערכה: ${(rfp.evaluation_criteria as string[])?.join(' | ') || 'לא צוינו'}
${eligibility.other ? `תנאי סף: ${(eligibility.other as string[]).join(', ')}` : ''}
${requiredDocs.length > 0 ? `מסמכים נדרשים: ${requiredDocs.join(', ')}` : ''}
${funderIntel ? `\n## מודיעין על הגוף המממן\n${funderIntel}` : ''}
${rawText ? `\n## תוכן קול הקורא המלא (לחילוץ דרישות נוספות)\n${rawText.slice(0, 8000)}` : ''}

## פרופיל הארגון
${orgContext || '⚠️ פרופיל ארגון לא מולא — כתוב תשובות כלליות וסמן [יש להשלים]'}
${memoryContext ? `\n## עובדות מאומתות\n${memoryContext}` : ''}
${docContext ? `\n## מסמכי הארגון\n${docContext}` : ''}
${pastOutcomesContext ? `\n## לקחים מהגשות קודמות\n${pastOutcomesContext}` : ''}

## הנחיית כתיבה
${funderStyle}

## כללי כתיבה מחייבים
1. נתונים אמיתיים בלבד — השתמש רק בנתונים מפרופיל הארגון. כשנתון חסר, כתוב [יש להשלים: שם הנתון].
2. כל תשובה = טקסט ממשי, לא כותרת. מינימום 2-3 משפטים לכל סעיף.
3. PAS: בעיה → החמרה → פתרון. Theory of Change: בעיה → התערבות → תוצאה → אימפקט.
4. מספרים = אמינות. כשיש מספרים בפרופיל — שלב אותם.
5. גוף ראשון רבים: "אנחנו", "הארגון שלנו".
6. כשמגבלת תווים קיימת (max_chars) — עמוד בה בדיוק.
7. עברית מדויקת, לא ז'רגון.

## פורמט החזרה
JSON בלבד, ללא \`\`\`json\`\`\`, ללא הסברים.
עבור כל סעיף — כתוב תשובה אמיתית. אל תשאיר שדה ריק.
{
  "sections": [
    ${sectionsJson}
  ],
  "rfp_summary": "2-3 משפטים: מה הקול הקורא מחפש, מה נדרש להגיש, ומה ייחודי בו",
  "missing_info": ["רשימת פרטים שחסרים מפרופיל הארגון ונדרשים להגשה"],
  "missing_docs": ["מסמכים שנדרשים אך לא קיימים בתיק הארגון (יש לארגון: ${existingDocNames})"],
  "goldfish_notes": "2-3 משפטים: סיכום ניתוח ההתאמה, הנקודות החזקות, והמלצות לשיפור הטיוטה"
}`;

  // ── Run AI draft + fit analysis in parallel ───────────────────────────────
  const fitPrompt = `נתח התאמה בין הארגון לקול הקורא הזה.
גוף מממן: ${rfp.funder_name} | קול קורא: ${rfp.rfp_title}
פרופיל ארגון: ${orgContext.slice(0, 2000)}
החזר JSON בלבד:
{"score": <1-10>, "verdict": "<שווה להגיש|שקלי פעמיים|לא מומלץ>", "verdict_reason": "<1-2 משפטים>", "strengths": ["<1>","<2>"], "gaps": ["<1>","<2>"], "tips": ["<1>","<2>"]}`;

  type DraftSection = { id: string; question: string; answer: string; max_chars?: number | null };
  type DraftResponse = {
    sections?: DraftSection[];
    rfp_summary?: string;
    missing_info?: string[];
    missing_docs?: string[];
    goldfish_notes?: string;
  };

  let draftResponse: DraftResponse = {};
  let fitAnalysis: Record<string, unknown> | null = null;

  const [draftResult, fitResult] = await Promise.allSettled([
    anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 8000,
      messages: [{ role: 'user', content: prompt }],
    }),
    anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{ role: 'user', content: fitPrompt }],
    }),
  ]);

  // Parse draft
  if (draftResult.status === 'fulfilled') {
    try {
      const raw = draftResult.value.content[0].type === 'text' ? draftResult.value.content[0].text : '';
      draftResponse = JSON.parse(raw.replace(/```json|```/g, '').trim());
    } catch { /* fallback below */ }
  }

  // Parse fit
  if (fitResult.status === 'fulfilled') {
    try {
      const raw = fitResult.value.content[0].type === 'text' ? fitResult.value.content[0].text : '';
      fitAnalysis = JSON.parse(raw.replace(/```json|```/g, '').trim());
    } catch { /* ignore */ }
  }

  // ── Build content array ────────────────────────────────────────────────────
  // 1. Fixed meta-block: RFP info (always first)
  const rfpInfoText = [
    rfp.rfp_title ? `שם הקול הקורא: ${rfp.rfp_title}` : '',
    rfp.funder_name ? `גוף מממן: ${rfp.funder_name}` : '',
    rfp.deadline ? `דדליין להגשה: ${new Date(rfp.deadline as string).toLocaleDateString('he-IL', { day: '2-digit', month: 'long', year: 'numeric' })}` : '',
    rfp.max_amount ? `סכום מקסימלי: ${Number(rfp.max_amount).toLocaleString('he-IL')} ₪` : '',
    requiredDocs.length > 0 ? `מסמכים נדרשים: ${requiredDocs.join(' | ')}` : '',
    (eligibility as { other?: string[] }).other?.length
      ? `תנאי סף: ${(eligibility as { other: string[] }).other.join(' | ')}`
      : '',
    draftResponse.rfp_summary ? `\nסיכום: ${draftResponse.rfp_summary}` : '',
  ].filter(Boolean).join('\n');

  // 2. Main sections from AI
  const aiSections: DraftSection[] = draftResponse.sections || sectionsForAI.map(s => ({
    id: s.id,
    question: s.question,
    answer: '[לא הצלחנו לכתוב תשובה אוטומטית — יש להשלים ידנית]',
    max_chars: s.max_chars || null,
  }));

  // 3. Fixed meta-block: missing docs + info
  const missingText = [
    ...(draftResponse.missing_docs?.length
      ? [`📎 מסמכים חסרים:\n${draftResponse.missing_docs.map(d => `• ${d}`).join('\n')}`]
      : requiredDocs.length > 0 ? [`📎 מסמכים נדרשים: ${requiredDocs.join(', ')}\nיש לבדוק אילו קיימים בתיק הארגון.`] : []),
    ...(draftResponse.missing_info?.length
      ? [`\n❓ מידע חסר מפרופיל הארגון:\n${draftResponse.missing_info.map(m => `• ${m}`).join('\n')}`]
      : []),
  ].join('\n') || 'לא זוהו חסרים ספציפיים. בדקי שכל הנתונים מלאים לפני ההגשה.';

  // 4. Fixed meta-block: Goldfish notes
  const goldfishNotes = [
    draftResponse.goldfish_notes || '',
    fitAnalysis
      ? `\nציון התאמה: ${(fitAnalysis as { score?: number }).score ?? '?'}/10 — ${(fitAnalysis as { verdict?: string }).verdict || ''}\n${(fitAnalysis as { verdict_reason?: string }).verdict_reason || ''}`
      : '',
    (fitAnalysis as { tips?: string[] } | null)?.tips?.length
      ? `\nטיפים לשיפור:\n${((fitAnalysis as { tips: string[] }).tips).map((t: string) => `• ${t}`).join('\n')}`
      : '',
  ].filter(Boolean).join('\n') || 'הטיוטה נוצרה אוטומטית. בדקי את כל הסעיפים לפני ההגשה.';

  const content = [
    {
      id: '_rfp_info',
      question: '📋 פרטי קול הקורא',
      answer: rfpInfoText,
      max_chars: null,
      readonly: true,
    },
    ...aiSections.map(s => ({
      id: s.id,
      question: s.question,
      answer: s.answer || '',
      // prefer max_chars from AI response (it mirrors what was sent), fallback to sectionsForAI
      max_chars: s.max_chars
        ?? (sectionsForAI.find(q => q.id === s.id) as { max_chars?: number } | undefined)?.max_chars
        ?? null,
    })),
    {
      id: '_missing',
      question: '📎 מסמכים וחסרים',
      answer: missingText,
      max_chars: null,
    },
    {
      id: '_goldfish_notes',
      question: '🐟 הערות Goldfish',
      answer: goldfishNotes,
      max_chars: null,
      readonly: true,
    },
  ];

  // Generate share token
  const shareToken = randomUUID().replace(/-/g, '').slice(0, 16);

  // Save submission (with fit_analysis embedded in metadata)
  const { data: sub } = await supabase
    .from('submissions')
    .insert({
      org_id,
      opportunity_id: opportunity_id || null,
      content,
      status: 'draft',
      share_token: shareToken,
      ...(fitAnalysis ? { fit_analysis: fitAnalysis } : {}),
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
    fit_analysis: fitAnalysis,
    existing: false,
  });
});
