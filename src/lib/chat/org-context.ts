import Anthropic from '@anthropic-ai/sdk';
import { createAdminClient } from '@/lib/supabase/admin';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function loadOrgMemory(
  supabase: ReturnType<typeof createAdminClient>,
  orgId: string
): Promise<string> {
  try {
    const { data: memories } = await supabase
      .from('org_memory')
      .select('key, value, confidence, updated_at')
      .eq('org_id', orgId)
      .order('updated_at', { ascending: false })
      .limit(50);

    if (!memories?.length) return '';

    const lines = memories.map(m => `${m.key}: ${m.value}`);
    return `\n\n===== כרטיס ארגון (${memories.length} עובדות מאומתות) =====
אלה נתונים אמיתיים שנשלפו מהמסמכים הרשמיים של הארגון. השתמש בהם תמיד. אל תשאל שאלות שהתשובות כאן.
${lines.join('\n')}`;
  } catch (e) {
    console.error('Org memory load error:', e);
    return '';
  }
}

export async function loadSubmissionHistory(
  supabase: ReturnType<typeof createAdminClient>,
  orgId: string
): Promise<string> {
  try {
    const { data: subs } = await supabase
      .from('submissions')
      .select('status, outcome, approved_amount, requested_amount, funder_feedback, lessons_learned, created_at, opportunity:opportunities(title, funder)')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(20);

    if (!subs?.length) return '';

    const lines = subs.map(s => {
      const opp = s.opportunity as unknown as { title: string; funder: string } | null;
      const parts = [
        opp?.title || 'ללא שם',
        opp?.funder ? `(${opp.funder})` : '',
        `סטטוס: ${s.status}`,
      ];
      if (s.outcome) parts.push(`תוצאה: ${s.outcome}`);
      if (s.approved_amount) parts.push(`אושר: ${Number(s.approved_amount).toLocaleString('he-IL')} ש"ח`);
      if (s.requested_amount) parts.push(`בוקש: ${Number(s.requested_amount).toLocaleString('he-IL')} ש"ח`);
      if (s.funder_feedback) parts.push(`משוב: ${s.funder_feedback}`);
      if (s.lessons_learned) parts.push(`לקחים: ${s.lessons_learned}`);
      return parts.join(' | ');
    });

    return `\n\n===== היסטוריית הגשות (${subs.length}) =====
הגשות קודמות של הארגון — השתמש בלקחים כדי לשפר הגשות חדשות:
${lines.join('\n')}`;
  } catch (e) {
    console.error('Submission history load error:', e);
    return '';
  }
}

async function maybeUpdateSubmissionOutcome(
  supabase: ReturnType<typeof createAdminClient>,
  orgId: string,
  userMessage: string
): Promise<void> {
  const approvedMatch = userMessage.match(
    /(?:קרן|גוף)\s+([^,\n]{3,40})\s+(?:אישרה?|אישרו|קיבלנו|זכינו)[^.]{0,80}?(\d[\d,]+)?\s*(?:ש"ח|שקל)?/
  );
  if (approvedMatch) {
    const funder = approvedMatch[1]?.trim();
    const amount = approvedMatch[2]?.replace(/,/g, '');
    if (funder) {
      const key = `approved_${funder.replace(/\s+/g, '_').slice(0, 30)}`;
      const value = amount
        ? `אושר ${Number(amount).toLocaleString('he-IL')} ש"ח מ-${funder}`
        : `אושר מענק מ-${funder}`;
      await supabase.from('org_memory').upsert(
        { org_id: orgId, key, value, source: 'chat_outcome', confidence: 'high', updated_at: new Date().toISOString() },
        { onConflict: 'org_id,key' }
      );
    }
  }

  const rejectedMatch = userMessage.match(
    /(?:קרן|גוף)\s+([^,\n]{3,40})\s+(?:דחתה?|דחו|לא אישרו?|נדחינו)[^.]{0,120}/
  );
  if (rejectedMatch) {
    const funder = rejectedMatch[1]?.trim();
    if (funder) {
      const key = `rejected_${funder.replace(/\s+/g, '_').slice(0, 30)}`;
      await supabase.from('org_memory').upsert(
        { org_id: orgId, key, value: rejectedMatch[0].trim().slice(0, 200), source: 'chat_outcome', confidence: 'high', updated_at: new Date().toISOString() },
        { onConflict: 'org_id,key' }
      );
    }
  }
}

export async function extractAndSaveMemory(
  supabase: ReturnType<typeof createAdminClient>,
  orgId: string,
  userMessage: string,
  assistantResponse: string
): Promise<void> {
  try {
    const combined = userMessage + ' ' + assistantResponse;
    if (combined.length < 80) return;

    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const extractionPrompt = `אתה מחלץ עובדות חשובות משיחה עם עמותה לצורך שמירה בזיכרון ארגוני.

הודעת משתמש:
"${userMessage.slice(0, 1500)}"

תשובת הסוכן:
"${assistantResponse.slice(0, 1500)}"

חלץ עד 10 עובדות חשובות. התמקד במה שיעזור לסוכן בשיחות עתידיות:
- תוצאות הגשות (אושר/נדחה, סכום, משוב מהגוף המממן)
- העדפות כתיבה של הארגון
- מידע ייחודי שלא במסמכים (שותפויות, מספרים, יעדים)
- יחסים עם גופים מממנים (חיובי/שלילי/היסטוריה)
- לקחים מהגשות קודמות
- דדליינים וצירי זמן חשובים
- תתי-אוכלוסיות שהארגון מלווה (נשים, ערבים, עולים, אתיופים, חרדים, בדואים, LGBTQ, חד-הוריים)
- תיאוריית שינוי / מודל פעולה ייחודי (Theory of Change)
- חוזקות ייחודיות (מחקר מלווה, טכנולוגיה, רשת שותפים, ניסיון)
- מספרי מוטבים, בתי ספר, ערים, עובדים חדשים שנזכרו
- שמות אנשי מפתח (מנכ"ל/ית, יו"ר, רכזים) ופרטי קשר

לכל עובדה, הוסף גם:
- category: לאיזו שכבת ידע היא שייכת:
  * "identity" — זהות הארגון (שם, מספר עמותה, שנת הקמה, איש קשר, אתר)
  * "dna" — מי הם ומה הם עושים (אוכלוסיות, תחומים, Theory of Change, גישה ייחודית, מודל פעולה)
  * "impact" — ראיות ותוצאות (מספרי מוטבים, אחוזי הצלחה, מחקרים, הישגים מוכחים)
  * "operations" — יכולת ביצוע (תקציב, עובדים, שותפויות, פרויקטים פעילים, ערים)
  * "submissions" — הגשות קודמות (מה אושר/נדחה, סגנון כתיבה, לקחים, יחסים עם קרנות)
- depth: עומק העובדה:
  * 1 = כללי ("עמותה בתחום החינוך", "מגישים לקרנות")
  * 2 = ספציפי ("משרתת 500 נערים בגיל 14-18 בפריפריה")
  * 3 = עמוק עם נתון/ראיה ("78% מהבוגרים הגיעו לתעסוקה תוך 6 חודשים, מחקר אונ' ת"א 2024")

החזר JSON בלבד, ללא טקסט נוסף:
{"items":[{"key":"מזהה_קצר_באנגלית","value":"הערך בעברית","confidence":"high|medium|low","category":"identity|dna|impact|operations|submissions","depth":1}]}

דוגמאות ל-key טובים: theory_of_change, unique_model, sub_populations, ceo_name, total_beneficiaries, partner_orgs, funder_relation_joint, strength_research, age_range, cities_active

אם אין עובדות חשובות לשמור, החזר: {"items":[]}`;

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1000,
      messages: [{ role: 'user', content: extractionPrompt }],
    });

    const rawText = response.content[0].type === 'text' ? response.content[0].text.trim() : '';
    if (!rawText) return;

    const jsonText = rawText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    let parsed: { items: { key: string; value: string; confidence: string; category?: string; depth?: number }[] };
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      console.error('[memory] Failed to parse JSON:', jsonText.slice(0, 200));
      return;
    }

    const VALID_CATEGORIES = ['identity', 'dna', 'impact', 'operations', 'submissions'];
    const memoryItems = (parsed.items || []).filter(
      (item) => item.key && item.value && item.value.length > 3
    );

    if (memoryItems.length === 0) return;

    await maybeUpdateSubmissionOutcome(supabase, orgId, userMessage);

    for (const item of memoryItems) {
      const category = item.category && VALID_CATEGORIES.includes(item.category) ? item.category : null;
      const depth = [1, 2, 3].includes(Number(item.depth)) ? Number(item.depth) : 1;
      await supabase
        .from('org_memory')
        .upsert(
          {
            org_id: orgId,
            key: item.key,
            value: item.value,
            source: 'chat_ai',
            confidence: item.confidence || 'medium',
            category,
            depth,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'org_id,key' }
        );
    }

  } catch (e) {
    console.error('Memory extraction error:', e);
  }
}

export async function loadSectorIntelligence(
  supabase: ReturnType<typeof createAdminClient>,
  userMessage: string
): Promise<string> {
  const SECTOR_KEYWORDS = ['מגזר שלישי', 'עמותות', 'מתחרים', 'מגמות', 'טרנדים', 'חדשות', 'סטארטאפ חברתי', 'אימפקט', 'CSR', 'פילנתרופיה', 'תרומות בישראל', 'קרנות בישראל', 'שוק', 'מגזר', 'תחרות', 'benchmarking', 'דוח מגזרי', 'נתוני שוק'];

  try {
    const { data: knowledge } = await supabase
      .from('sector_knowledge')
      .select('topic, content')
      .not('topic', 'like', 'daily_digest_%')
      .order('last_updated', { ascending: false })
      .limit(10);

    let sectorContext = '';
    if (knowledge?.length) {
      const topics = knowledge.map(k => `[${k.topic}]\n${k.content}`);
      sectorContext = `\n\n===== ידע מגזרי — מגזר שלישי ישראלי =====\n${topics.join('\n\n')}`;

      if (sectorContext.length > 15000) {
        sectorContext = sectorContext.slice(0, 15000) + '\n[... עוד ידע מגזרי]';
      }
    }

    const today = new Date().toISOString().split('T')[0];
    const { data: digest } = await supabase
      .from('sector_knowledge')
      .select('content')
      .eq('topic', `daily_digest_${today}`)
      .single();

    if (digest?.content) {
      sectorContext += `\n\n===== סיכום יומי — ${today} =====\n${digest.content}`;
    }

    if (SECTOR_KEYWORDS.some(kw => userMessage.includes(kw))) {
      const keywords = userMessage.split(/\s+/).filter(w => w.length > 2).slice(0, 5).join(' & ');
      let intelligenceQuery = supabase
        .from('sector_intelligence')
        .select('title, summary, category, source, source_url, relevance_score, scan_date')
        .gte('relevance_score', 40)
        .order('relevance_score', { ascending: false })
        .limit(10);

      if (keywords) {
        intelligenceQuery = intelligenceQuery.textSearch('fts', keywords, { type: 'plain' });
      }

      const { data: intel } = await intelligenceQuery;
      if (intel?.length) {
        const items = intel.map(i =>
          `- [${i.category}] ${i.title} (${i.source}, ${i.scan_date})${i.summary ? `: ${i.summary}` : ''}${i.source_url ? ` | ${i.source_url}` : ''}`
        );
        sectorContext += `\n\n===== חדשות אחרונות מהמגזר =====\n${items.join('\n')}`;
      }
    }

    return sectorContext;
  } catch {
    return '';
  }
}
