import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { withAuth } from '@/lib/api-auth';
import { geminiCall, geminiSearchGrounding } from '@/lib/ai/gemini';

function isGovUrl(url: string): boolean {
  return /\.gov\.il|merkava\.|btl\.gov|most\.gov|mof\.gov|moital\.gov|education\.gov|welfare\.gov/i.test(url);
}

// Fetch grant URL content with multi-layer fallback
async function fetchRfpContent(url: string): Promise<string> {
  // Layer 1: Jina Reader (works for most non-gov sites)
  try {
    const res = await fetch(`https://r.jina.ai/${url}`, {
      headers: { Accept: 'text/plain', 'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8', 'X-Return-Format': 'text' },
      signal: AbortSignal.timeout(25000),
    });
    if (res.ok) {
      const text = await res.text();
      if (text.length > 200) return text;
    }
  } catch { /* try next */ }

  // Layer 2: Direct fetch with browser UA
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
        'Accept-Language': 'he,en;q=0.9',
      },
      signal: AbortSignal.timeout(15000),
      redirect: 'follow',
    });
    if (res.ok) {
      const html = await res.text();
      return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80000);
    }
  } catch { /* try next */ }

  // Layer 3: Gemini Search Grounding — works for gov.il and blocked sites
  try {
    const geminiText = await geminiSearchGrounding(url);
    if (geminiText && geminiText.length > 200) return geminiText;
  } catch { /* all failed */ }

  return '';
}

export const maxDuration = 120; // seconds — Vercel Pro/Team plan

// POST /api/rfp — parse a grant call (URL or text) and generate a draft submission
export const POST = withAuth(async (req, auth) => {
  const { url, text, opportunity_id } = await req.json();
  const org_id = auth.orgId;
  if (!url && !text) return NextResponse.json({ error: 'Missing url or text' }, { status: 400 });

  const supabase = createAdminClient();

  // 1. Fetch raw text if URL provided (multi-layer fallback)
  let rawText = text || '';
  if (url && !rawText) {
    rawText = await fetchRfpContent(url);
  }

  if (!rawText || rawText.length < 20) {
    return NextResponse.json({ error: 'לא הצלחתי לקרוא את קול הקורא. נסי להדביק את הטקסט ישירות.' }, { status: 400 });
  }

  // 2. Parse RFP with Gemini
  const parsePrompt = `אתה מומחה לניתוח קולות קוראים של קרנות ומענקים בישראל.
נתח את קול הקורא הבא והחזר JSON בלבד, ללא הסברים.

קול הקורא:
${rawText.slice(0, 60000)}

## הנחיות חילוץ max_chars — קריטי!
לכל שאלה, חפש הגבלת אורך בכל הפורמטים האפשריים:
- תווים: "עד 500 תווים", "מקסימום 1000 תווים", "לא יותר מ-300 תווים", "up to 500 characters", "max 1000 chars"
- מילים: "עד 200 מילים", "200 words maximum", "no more than 150 words" — המר למספר תווים: מילים × 6
- שורות: "עד 5 שורות" — המר: שורות × 80 תווים
- עמודים: "עמוד אחד" = 3000 תווים, "חצי עמוד" = 1500 תווים
- אם כתוב "קצר" / "תמציתי" בלי מספר — השתמש ב-500
- אם אין הגבלה בכלל — החזר null

## החזר JSON:
{
  "funder_name": "שם הגוף המממן",
  "funder_type": "government|foundation|corporate|federation|other",
  "rfp_title": "שם קול הקורא",
  "deadline": "YYYY-MM-DD או null",
  "max_amount": מספר בשקלים או null,
  "application_url": "הקישור הישיר לדף/טופס ההגשה (forms.monday, מרכבה, פורטל ממשלתי, PDF ישיר) — לא עמוד הבית של הקרן. null אם לא נמצא.",
  "eligibility": {
    "org_types": ["סוגי ארגונים מתאימים"],
    "regions": ["אזורים"],
    "populations": ["אוכלוסיות יעד"],
    "min_budget": null,
    "other": ["תנאי סף נוספים"]
  },
  "questions": [
    { "id": "q1", "question": "שאלה מלאה כפי שנוסחה", "max_chars": מספר_תווים_או_null, "required": true/false }
  ],
  "required_documents": ["רשימת מסמכים נדרשים"],
  "evaluation_criteria": ["קריטריוני הערכה"],
  "summary": "סיכום קצר של קול הקורא ב-2-3 משפטים"
}

## כללים נוספים:
- חלץ את כל שאלות הטופס בדיוק כפי שהן מנוסחות
- אם אין שאלות מפורשות — צור שאלות סטנדרטיות לפי סוג הגוף המממן
- בשאלות סטנדרטיות: תיאור הארגון=1500, מטרות=1000, תקציב=800, אימפקט=1200`;

  let rfpData: Record<string, unknown>;
  try {
    const raw = await geminiCall(parsePrompt, 4000);
    const clean = raw.replace(/```json|```/g, '').trim();
    rfpData = JSON.parse(clean);
  } catch (e) {
    console.error('[rfp] Gemini parse error:', e);
    return NextResponse.json({ error: 'שגיאה בניתוח קול הקורא' }, { status: 500 });
  }

  // 3. Save to rfp_parsed
  const { data: rfpRow } = await supabase
    .from('rfp_parsed')
    .insert({
      org_id,
      opportunity_id: opportunity_id || null,
      funder_name: String(rfpData.funder_name || ''),
      funder_type: String(rfpData.funder_type || 'other'),
      rfp_title: String(rfpData.rfp_title || ''),
      deadline: rfpData.deadline ? new Date(String(rfpData.deadline)).toISOString() : null,
      max_amount: rfpData.max_amount ? Number(rfpData.max_amount) : null,
      questions: rfpData.questions || [],
      required_documents: rfpData.required_documents || [],
      eligibility: rfpData.eligibility || {},
      evaluation_criteria: rfpData.evaluation_criteria || [],
      raw_text: rawText.slice(0, 50000),
      rfp_url: url || null,
      application_url: rfpData.application_url && typeof rfpData.application_url === 'string' && rfpData.application_url.startsWith('http')
        ? rfpData.application_url
        : (url || null),
    })
    .select('id')
    .single();

  // If we extracted a direct application_url — backfill to opportunities table
  const extractedAppUrl = rfpData.application_url && typeof rfpData.application_url === 'string' && rfpData.application_url.startsWith('http')
    ? rfpData.application_url as string
    : null;
  if (extractedAppUrl && opportunity_id) {
    await supabase.from('opportunities')
      .update({ application_url: extractedAppUrl })
      .eq('id', opportunity_id)
      .is('application_url', null); // only update if not already set
  }

  return NextResponse.json({
    rfp_id: rfpRow?.id,
    rfp: rfpData,
    application_url: extractedAppUrl || url || null,
  });
});
