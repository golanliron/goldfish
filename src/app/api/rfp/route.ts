import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { geminiCall } from '@/lib/ai/gemini';

// POST /api/rfp — parse a grant call (URL or text) and generate a draft submission
export async function POST(req: NextRequest) {
  const { org_id, url, text, opportunity_id } = await req.json();
  if (!org_id) return NextResponse.json({ error: 'Missing org_id' }, { status: 400 });
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

  if (!rawText || rawText.length < 50) {
    return NextResponse.json({ error: 'לא הצלחתי לקרוא את קול הקורא. נסי להדביק את הטקסט ישירות.' }, { status: 400 });
  }

  // 2. Parse RFP with Gemini
  const parsePrompt = `אתה מומחה לניתוח קולות קוראים של קרנות ומענקים בישראל.
נתח את קול הקורא הבא והחזר JSON בלבד.

קול הקורא:
${rawText.slice(0, 60000)}

החזר JSON עם המבנה הבא:
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
    { "id": "q1", "question": "שאלה מלאה", "max_chars": מספר או null, "required": true/false }
  ],
  "required_documents": ["רשימת מסמכים נדרשים"],
  "evaluation_criteria": ["קריטריוני הערכה"],
  "summary": "סיכום קצר של קול הקורא ב-2-3 משפטים"
}

חשוב: חלץ את כל שאלות הטופס בדיוק כפי שהן מנוסחות. אם אין שאלות מפורשות, צור שאלות סטנדרטיות המתאימות לסוג הגוף המממן.`;

  let rfpData: Record<string, unknown>;
  try {
    const raw = await geminiCall(parsePrompt, 4000);
    const clean = raw.replace(/```json|```/g, '').trim();
    rfpData = JSON.parse(clean);
  } catch {
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
    })
    .select('id')
    .single();

  return NextResponse.json({
    rfp_id: rfpRow?.id,
    rfp: rfpData,
  });
}
