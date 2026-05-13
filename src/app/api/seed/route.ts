import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

const HOPA_ORG_ID = 'd5f860e8-4958-408c-a00f-679a93f1d470';

const HOPA_PROFILE = {
  name: 'הופה',
  registration_number: '580700142',
  founded_year: 2020,
  mission:
    'הופה פועלת למניעת נשירה וליווי צעירים ובוגרים בישראל. יוצרת רצף תמיכה אמיתי מגיל 14 עד 26 — מבית הספר ועד החיים הבוגרים. משלבת ליווי אנושי, חשיבה מערכתית וכלים טכנולוגיים.',
  focus_areas: [
    'מניעת נשירה',
    'ליווי בוגרים',
    'תעסוקה והכוונה מקצועית',
    'מלגות ולימודים',
    'מיצוי זכויות',
    'חיים עצמאיים',
    'שירות צבאי ולאומי',
    'חיבור לקהילה',
  ],
  annual_budget: 857100,
  employees_count: 12,
  beneficiaries_count: 3500,
  regions: ['דרום', 'נגב', 'פריפריה', 'ארצי'],
  active_projects: [
    {
      name: 'מניעת נשירה בבתי ספר',
      description:
        'זיהוי מוקדם של תלמידים במצבי סיכון, מעקב, ליווי וחיבור למענים. עבודה מערכתית מול צוותי חינוך בחטיבות ובתיכונים.',
      beneficiaries: 1500,
    },
    {
      name: 'ליווי בוגרים 18-26',
      description:
        'המשך ליווי לאחר סיום הלימודים — שירות צבאי/לאומי, תעסוקה, לימודים, מלגות, מיצוי זכויות, חיים עצמאיים.',
      beneficiaries: 2000,
    },
    {
      name: 'מאגר 600+ מענים',
      description:
        'מיפוי והנגשה של מענים, תוכניות, זכויות והזדמנויות לצעירים ולצוותים חינוכיים. כולל מלגות, הכשרות, תעסוקה, לינת חירום, מרכזי צעירים.',
      beneficiaries: 3500,
    },
    {
      name: 'רדאר 360',
      description:
        'מודל טכנולוגי ייחודי לזיהוי, מיון, התאמה וליווי צעירים. 4 שלבים: שידור (איתור) → רמזור (סיווג דחיפות) → התאמה (מענה מותאם) → גלים (מעקב ויצירת קשר מתמשך).',
      beneficiaries: 3500,
    },
  ],
  key_achievements: [
    'רצף ליווי מגיל 14 עד 26 — מבית הספר ועד החיים הבוגרים',
    'מאגר 600+ מענים ממופים ומונגשים לצעירים',
    'מודל רדאר 360 — טכנולוגיה ייחודית לזיהוי וליווי',
    'עבודה בשיתוף בתי ספר, רשויות, עמותות וקרנות',
    'שילוב ייחודי בין ליווי אנושי לתשתית טכנולוגית',
    'פעילות בדרום ובפריפריה עם דגש על אוכלוסיות בסיכון',
  ],
};

const HOPA_KNOWLEDGE = [
  {
    key: 'overview',
    title: 'תיאור כללי',
    content: `הופה היא עמותה הפועלת בתחום מניעת נשירה וליווי צעירים ובוגרים בישראל, גילאי 14-26.
הופה מפתחת ומפעילה מענים שמטרתם לייצר רצף תמיכה אמיתי — מתקופת בית הספר ועד שלבי החיים הבוגרים.
הבעיה: צעירים במצבי סיכון חווים פער בין המסגרות החינוכיות לבין החיים הבוגרים. ברגע שהתלמיד מסיים בית הספר, הליווי נפסק.
הפתרון: רצף ליווי בשני צירים — מניעת נשירה בתוך בתי ספר + ליווי בוגרים לאחר סיום הלימודים.
הייחוד: חיבור בין עולם בית הספר לחיים שאחרי, מעטפת שממשיכה ללוות. שילוב ליווי אנושי, שיתופי פעולה, מענים חיצוניים, חשיבה מערכתית וכלים טכנולוגיים.`,
  },
  {
    key: 'programs',
    title: 'מענים ותחומי פעילות',
    content: `ציר 1 - מניעת נשירה בבתי ספר:
- זיהוי מוקדם של תלמידים במצבי סיכון
- מעקב סימנים: ירידה בתפקוד, שייכות, התמדה, מעורבות
- עבודה מערכתית מול צוותי חינוך
- ליווי תלמידים + חיבור למענים מותאמים

ציר 2 - ליווי בוגרים וצעירים (18-26):
- שמירה על קשר עם בוגרים
- ליווי אישי בשלבי מעבר
- הכוונה: שירות צבאי/לאומי, תעסוקה, לימודים, מלגות, מיצוי זכויות, חיים עצמאיים
- תיווך למענים קיימים בקהילה

מאגר 600+ מענים: מלגות, הכשרות מקצועיות, תוכניות תעסוקה, מסגרות לימודים, מענים לחיילים בודדים, לינת חירום, מרכזי צעירים, תוכניות לאוכלוסיות ייחודיות.

הופה לא מפעילה את כל המענים בעצמה — היא ממפה, מנגישה ומחברת צעירים למענים קיימים.`,
  },
  {
    key: 'vision',
    title: 'חזון ותפיסת עולם',
    content: `חזון: ליצור שינוי חברתי בישראל באמצעות רצף ליווי משמעותי לבני נוער וצעירים. אף צעיר לא צריך להישאר לבד ברגעי מעבר קריטיים.
תפיסה: רצף ולא מענה חד פעמי. הליווי ממשיך גם בשלבי גיוס, שירות, חיפוש עבודה, לימודים, חיים עצמאיים.
עקרונות:
- כל צעיר צריך מבוגר משמעותי שלא נעלם
- מניעת נשירה מתחילה הרבה לפני עזיבה בפועל
- שייכות = תנאי בסיסי להתמדה וצמיחה
- ליווי חייב להיות מותאם אישית
- טכנולוגיה = כלי תומך, לא תחליף לקשר אנושי
- יש לבנות רצף ולא אוסף פעולות מנותקות`,
  },
  {
    key: 'audiences',
    title: 'קהלי יעד',
    content: `4 קהלי יעד:
1. בני נוער בבתי ספר (14-18): תלמידים בסיכון לנשירה, קשיי שייכות/תפקוד/רגש
2. בוגרים וצעירים (18-26): בשלבי מעבר, חיפוש כיוון — צבא, תעסוקה, לימודים, מלגות, זכויות
3. צוותי חינוך: מנהלים, רכזים, יועצות, מחנכים — שותפים לעבודה
4. שותפים, תורמים וקרנות: מבינים את המודל, ההשפעה והייחוד

הופה לא מדברת באותה צורה לכל הקהלים: לצעירים — נגיש וחם, לצוותים — מקצועי ומעשי, לקרנות — מדויק ותמציתי.`,
  },
  {
    key: 'radar',
    title: 'מודל רדאר 360',
    content: `מודל טכנולוגי ייחודי של הופה — 4 שלבים:
1. שידור — איתור צעירים דרך בתי ספר, רשתות, שותפים
2. רמזור — סיווג דחיפות (אדום/כתום/ירוק) לפי צורך
3. התאמה — מענה מותאם אישית מתוך מאגר 600+ מענים
4. גלים — מעקב, יצירת קשר מתמשך, ליווי לאורך זמן

סלוגן: "מזהים · מכווינים · מלווים"
המודל משלב AI וטכנולוגיה עם ליווי אנושי.`,
  },
  {
    key: 'budget',
    title: 'תקציב',
    content: `תקציב שנתי: 857,100 ₪
פירוט לפי צירים:
- ציר מניעת נשירה (14-18): 93,500 ₪
- ציר בוגרים (18-26): 60,500 ₪
- ציר משולב: 137,500 ₪
- שכר ותקורות: ~565,000 ₪

12 עובדים, ~3,500 מוטבים בשנה.
הופה פועלת בדרום, בנגב ובפריפריה.`,
  },
];

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get('secret');

  // Protection via env var or CRON_SECRET
  const expectedSecret = process.env.SEED_SECRET || process.env.CRON_SECRET;
  if (!expectedSecret || secret !== expectedSecret) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createAdminClient();

  // 1. Seed org_profile
  const { error: profileError } = await supabase.from('org_profiles').upsert(
    {
      org_id: HOPA_ORG_ID,
      data: HOPA_PROFILE,
      last_updated: new Date().toISOString(),
    },
    { onConflict: 'org_id' }
  );

  // 2. Seed knowledge base as document chunks (for RAG)
  let chunksInserted = 0;
  const errors: string[] = [];
  for (const item of HOPA_KNOWLEDGE) {
    // Check if chunk already exists
    const { data: existing } = await supabase
      .from('document_chunks')
      .select('id')
      .eq('org_id', HOPA_ORG_ID)
      .eq('metadata->>key', item.key)
      .limit(1);

    if (existing && existing.length > 0) continue;

    // Create a document record first (document_id is required)
    const { data: doc } = await supabase
      .from('documents')
      .insert({
        org_id: HOPA_ORG_ID,
        filename: `knowledge_${item.key}.md`,
        file_type: 'txt',
        storage_path: `knowledge/${item.key}`,
        category: 'identity',
        parsed_text: item.content,
        metadata: { source: 'knowledge_base', key: item.key, title: item.title },
        status: 'ready',
      })
      .select('id')
      .single();

    if (!doc) {
      errors.push(`doc insert failed for ${item.key}`);
      continue;
    }

    const { error } = await supabase.from('document_chunks').insert({
      document_id: doc.id,
      org_id: HOPA_ORG_ID,
      content: item.content,
      metadata: { key: item.key, title: item.title, source: 'knowledge_base', category: 'identity' },
    });

    if (!error) chunksInserted++;
    else errors.push(`chunk insert failed for ${item.key}: ${error.message}`);
  }

  return Response.json({
    success: true,
    profile_error: profileError?.message || null,
    chunks_inserted: chunksInserted,
    total_knowledge_items: HOPA_KNOWLEDGE.length,
    errors: errors.length > 0 ? errors : null,
  });
}
