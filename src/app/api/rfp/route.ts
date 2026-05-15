import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { withAuth } from '@/lib/api-auth';
import { geminiCall } from '@/lib/ai/gemini';

export const maxDuration = 120; // seconds — Vercel Pro/Team plan

// POST /api/rfp — parse a grant call (URL or text) and generate a draft submission
export const POST = withAuth(async (req, auth) => {
  const { url, text, opportunity_id } = await req.json();
  const org_id = auth.orgId;
  if (!url && !text) return NextResponse.json({ error: 'Missing url or text' }, { status: 400 });

  const supabase = createAdminClient();

  // 1. Fetch raw text if URL provided
  let rawText = text || '';
  if (url && !rawText) {
    try {
      const res = await fetch(`https://r.jina.ai/${url}`, {
        headers: { Accept: 'text/plain', 'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8' },
        signal: AbortSignal.timeout(25000),
      });
      if (res.ok) rawText = await res.text();
    } catch { /* ignore, will fail gracefully */ }

    // Direct fetch fallback
    if (!rawText) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (res.ok) {
          const html = await res.text();
          rawText = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80000);
        }
      } catch { /* ignore */ }
    }
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
    })
    .select('id')
    .single();

  return NextResponse.json({
    rfp_id: rfpRow?.id,
    rfp: rfpData,
  });
});
