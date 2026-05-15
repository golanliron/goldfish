import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const maxDuration = 120;
import { createAdminClient } from '@/lib/supabase/admin';
import { withAuth } from '@/lib/api-auth';
import { FISHGOLD_SYSTEM_PROMPT, FISHGOLD_GRANT_EXPERTISE, FISHGOLD_FUNDER_WRITING_DNA, FISHGOLD_FUNDER_QUESTIONS, FISHGOLD_GRANT_MASTERY, FISHGOLD_BEHAVIOR_RULES, FISHGOLD_PROPOSAL_GUIDE, FISHGOLD_SUBMISSION_ENGINE, FISHGOLD_COMPETITIVE_INTEL, FISHGOLD_FUNDRAISING_INTEL, FISHGOLD_EMAIL_MASTERY, buildOrgContext } from '@/lib/ai/fishgold';
import { buildRAGContext } from '@/lib/ai/rag';
import { detectSearchIntent, detectFunderQuery, webSearch, searchCompany, searchGrants, formatSearchResults } from '@/lib/ai/web-search';
import { autoResearchFunder, formatFunderResearch } from '@/lib/ai/funder-auto-research';
import { parseRfp, checkReadiness, assembleSubmission, generateOrgBlocks, formatReadinessReport } from '@/lib/ai/submission-engine';
import { fetchByRegistrationNumber, formatForContext, formatForProfile } from '@/lib/ai/guidestar';
import type { OrgBlock, OrgBlockType, RfpStructure } from '@/types';
import { fetchUrls, formatUrlsForMessage } from '@/lib/chat/url-fetcher';
import { learnFromUrls, loadAllChunks } from '@/lib/chat/knowledge-loader';
import { loadOrgMemory, loadSubmissionHistory, extractAndSaveMemory, loadSectorIntelligence } from '@/lib/chat/org-context';
import { scanOpportunities, scanCompanies, loadCompaniesIndex, loadGrantsIndex, loadFundersIndex } from '@/lib/chat/opportunity-scanner';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ===== Submission Engine helpers =====

const RFP_PARSE_KEYWORDS = ['נתח קול קורא', 'נתח את הקול קורא', 'תנתח קול קורא', 'תנתח את זה', 'בדוק מוכנות', 'בדיקת מוכנות', 'בדוק התאמה', 'האם אנחנו מתאימים', 'תבדוק אם מתאים', 'parse rfp', 'analyze rfp'];
const GRANT_WRITING_KEYWORDS = ['תכתוב הגשה', 'כתוב הגשה', 'טיוטת הגשה', 'תכין הצעה', 'כתוב הצעה', 'תכתוב הצעה', 'תתחיל לכתוב', 'כן תכתוב', 'כתוב טיוטה', 'תכין טיוטה', 'כתוב proposal', 'write proposal', 'write grant', 'כתוב LOI', 'תכתוב LOI', 'מכתב פנייה', 'letter of inquiry'];

function userAsksForRfpParse(message: string): boolean {
  return RFP_PARSE_KEYWORDS.some((kw) => message.toLowerCase().includes(kw.toLowerCase()));
}

function userAsksForGrantWriting(message: string): boolean {
  return GRANT_WRITING_KEYWORDS.some((kw) => message.toLowerCase().includes(kw.toLowerCase()));
}

async function loadOrgBlocks(
  supabase: ReturnType<typeof createAdminClient>,
  orgId: string
): Promise<OrgBlock[]> {
  const { data } = await supabase
    .from('org_blocks')
    .select('*')
    .eq('org_id', orgId)
    .order('block_type');

  if (!data?.length) return [];

  return data.map((row: Record<string, unknown>) => ({
    id: row.id as string,
    org_id: row.org_id as string,
    block_type: row.block_type as OrgBlockType,
    project_id: row.project_id as string | undefined,
    content: {
      mini: (row.content_mini as string) || '',
      standard: (row.content_standard as string) || '',
      extended: (row.content_extended as string) || '',
    },
    metadata: (row.metadata as Record<string, unknown>) || {},
    last_updated: (row.last_updated as string) || new Date().toISOString(),
    auto_generated: (row.auto_generated as boolean) ?? true,
  }));
}

async function saveOrgBlocks(
  supabase: ReturnType<typeof createAdminClient>,
  orgId: string,
  blocks: Partial<Record<OrgBlockType, OrgBlock>>
): Promise<void> {
  for (const [blockType, block] of Object.entries(blocks)) {
    if (!block) continue;
    await supabase
      .from('org_blocks')
      .upsert({
        org_id: orgId,
        block_type: blockType,
        content_mini: block.content.mini,
        content_standard: block.content.standard,
        content_extended: block.content.extended,
        metadata: block.metadata || {},
        auto_generated: block.auto_generated ?? true,
        last_updated: new Date().toISOString(),
      }, { onConflict: 'org_id,block_type,COALESCE(project_id, \'__org__\')' })
      .then(undefined, (err: unknown) => {
        console.error('Upsert failed, trying delete+insert:', err);
        return supabase
          .from('org_blocks')
          .delete()
          .eq('org_id', orgId)
          .eq('block_type', blockType)
          .is('project_id', null)
          .then(() =>
            supabase.from('org_blocks').insert({
              org_id: orgId,
              block_type: blockType,
              content_mini: block.content.mini,
              content_standard: block.content.standard,
              content_extended: block.content.extended,
              metadata: block.metadata || {},
              auto_generated: block.auto_generated ?? true,
              last_updated: new Date().toISOString(),
            })
          );
      });
  }
}

async function saveRfpParsed(
  supabase: ReturnType<typeof createAdminClient>,
  orgId: string,
  rfp: RfpStructure
): Promise<string | null> {
  const { data } = await supabase
    .from('rfp_parsed')
    .insert({
      org_id: orgId,
      funder_name: rfp.funder_name,
      funder_type: rfp.funder_type,
      rfp_title: rfp.rfp_title,
      deadline: rfp.deadline || null,
      max_amount: rfp.max_amount || null,
      questions: rfp.questions,
      required_documents: rfp.required_documents,
      eligibility: rfp.eligibility,
      evaluation_criteria: rfp.evaluation_criteria || [],
      raw_text: rfp.raw_text?.slice(0, 50000) || null,
    })
    .select('id')
    .single();

  return (data as { id: string } | null)?.id || null;
}

async function loadFullDocumentsForGrantWriting(
  supabase: ReturnType<typeof createAdminClient>,
  orgId: string
): Promise<string> {
  try {
    const { data: docs } = await supabase
      .from('documents')
      .select('filename, category, parsed_text, metadata')
      .eq('org_id', orgId)
      .in('category', ['identity', 'budget', 'project', 'impact', 'submission'])
      .order('created_at', { ascending: false })
      .limit(10);

    if (!docs?.length) return '';

    const parts = docs.map(d => {
      const meta = (d.metadata || {}) as Record<string, unknown>;
      const text = d.parsed_text || '';
      const insights = (meta.insights as string) || '';
      return `\n--- ${d.filename} [${d.category}] ---\n${text.slice(0, 15000)}${insights ? `\n\nתובנות AI: ${insights}` : ''}`;
    });

    let fullContext = `\n\n===== מסמכים מלאים לכתיבת הגשה =====\nלהלן כל המסמכים הרלוונטיים של הארגון בשלמותם. השתמש בכל הנתונים, המספרים, והפרטים מהמסמכים האלה כשאתה כותב את ההגשה:\n${parts.join('\n')}`;

    if (fullContext.length > 80000) {
      fullContext = fullContext.slice(0, 80000) + '\n[... חלק מהמסמכים נחתכו]';
    }

    return fullContext;
  } catch {
    return '';
  }
}

// ===== Tab focus instructions =====

const TAB_FOCUS: Record<string, string> = {
  chat: `\n\n===== צ׳אט ראשי =====
יש לך כרטיס ארגון מאומת ואת כל המסמכים. כשעונה על שאלות, השתמש בנתונים אמיתיים. כשמבקשים לכתוב הגשה, שלוף מספרים מכרטיס הארגון ומהמחקר. כשמציע קולות קוראים, ודא שהם באמת מתאימים לתחום הארגון.
כלל סגנון: תכתוב כמו בן אדם. בלי כוכביות, בלי מקפים, בלי כותרות. פסקאות חופשיות.`,
  opportunities: `\n\n===== הקשר נוכחי: קולות קוראים =====
המשתמש בלשונית קולות קוראים. יש לך את כל המסמכים של הארגון. השתמש בהם.

כלל סגנון: תכתוב כמו בן אדם. בלי כוכביות, בלי מקפים, בלי כותרות, בלי רשימות. פסקאות חופשיות.

אתה מכיר את הארגון לעומק מכל המסמכים שקראת. כשמישהו שואל על קול קורא, תנתח אותו ביחס לארגון הספציפי הזה. אם קול קורא לא מתאים, תגיד בפירוש למה ותציע חלופות.
כשכותב הגשה, תשלוף נתונים אמיתיים מהמסמכים: מספרי מוטבים, אחוזים מהמחקר, סכומי תקציב, שמות פרויקטים.
אל תמציא קולות קוראים שלא קיימים. אם לא מצאת התאמה טובה, אמור את זה.`,
  business: `\n\n===== הקשר נוכחי: חברות וקרנות =====
המשתמש בלשונית חברות וקרנות. יש לך את כל המסמכים של הארגון. השתמש בהם.

כלל סגנון: תכתוב כמו בן אדם. בלי כוכביות, בלי מקפים, בלי כותרות, בלי רשימות. פסקאות חופשיות.

כשמציע חברות או כותב מיילי פנייה, השתמש בנתונים אמיתיים מהמסמכים. לא סיסמאות גנריות אלא מספרים, שמות פרויקטים, תוצאות.`,
  org: `\n\n===== הקשר נוכחי: פרופיל הארגון =====
המשתמש בלשונית פרופיל הארגון. אתה סוכן גיוס משאבים חכם שמכיר את הארגון לעומק.

כלל סגנון קריטי לצ׳אט הזה:
תכתוב בדיוק כמו בן אדם שמדבר. בלי כוכביות, בלי מקפים, בלי כותרות, בלי רשימות עם תבליטים.
תכתוב פסקאות חופשיות. משפט אחרי משפט עם נקודה ביניהם. שפה חמה וישירה.
במקום "14-26" תכתוב "14 עד 26". במקום "early intervention" תכתוב את זה בעברית או תשלב בטבעיות.
אף פעם לא לכתוב תשובה שנראית כמו מסמך או דוח. זו שיחה.

התפקיד שלך כאן:
אתה לא שואל שאלות. יש לך את כל המסמכים, המחקרים, הדוחות, המצגות. תשתמש בהם.
כשמישהו שואל "מה אתה יודע" או "מה החוזקות שלנו" או "מה המספרים" אתה לא מבקש כלום. אתה הולך למסמכים, שולף את הנתונים הקונקרטיים, ועונה עם מספרים אמיתיים.
יש לך מחקר עם אחוזים? תביא את האחוזים. יש תקציב עם סכומים? תביא את הסכומים. יש מספרי מוטבים? תכתוב אותם.
אם באמת אין מידע ספציפי בשום מסמך, רק אז תגיד מה חסר.

כשמעלים מסמך חדש, קרא אותו ותספר מה למדת ממנו. תגיד "עד עכשיו ידעתי X, עכשיו אני מבין גם Y".
כשמישהו מדייק אותך, קבל ועדכן.

ראייה מאקרו ומיקרו:
מאקרו: מה הארגון עושה, למי, למה זה חשוב, מה הבעיה שהוא פותר, מה הייחוד.
מיקרו: כל פרויקט בנפרד, כמה מוטבים, באיזו עיר, מה התוצאות.
תדע לזהות איזה פרויקטים מתאימים לאיזה קולות קוראים ותציע התאמות.

מסמכים נדרשים: ניהול תקין, סעיף 46, ניכוי מס, רישום עמותה, דוח כספי מבוקר, תקציב מאושר.
אם חסר או פג תוקף, הזכר. אם הכל בסדר, אמור שמבחינת מסמכים הארגון מוכן להגיש.`,
  foundations: `\n\n===== הקשר נוכחי: קרנות ופדרציות =====
המשתמש בלשונית קרנות ופדרציות. יש לך את כל המסמכים של הארגון וכרטיס ארגון עם נתונים מאומתים. השתמש בהם.

כלל סגנון: תכתוב כמו בן אדם. בלי כוכביות, בלי מקפים, בלי כותרות, בלי רשימות. פסקאות חופשיות.

כשמציע קרנות, תסביר למה הן מתאימות על בסיס נתונים ספציפיים מהארגון. לא "כי אתם עוסקים בחינוך" אלא "כי יש לכם מחקר דו-עת שמראה 77% גיוס צבאי ו-76% תעסוקה, וקרן X מחפשת בדיוק הוכחות אימפקט כאלה".
כשכותב LOI או מייל פנייה, תשלב מספרים אמיתיים מכרטיס הארגון.`,
};

// ===== Main Handler =====

export const POST = withAuth(async (request, auth) => {
  try {
    const { message, conversation_id, active_tab } = await request.json();
    const org_id = auth.orgId;
    const user_id = auth.userId;

    if (!message) {
      return Response.json({ error: 'Missing message' }, { status: 400 });
    }

    const supabase = createAdminClient();

    const [fetchedUrls, { data: org }, { data: profileBefore }] = await Promise.all([
      fetchUrls(message),
      supabase.from('organizations').select('name, domain').eq('id', org_id).single(),
      supabase.from('org_profiles').select('data').eq('org_id', org_id).single(),
    ]);

    if (fetchedUrls.length > 0) {
      await learnFromUrls(supabase, org_id, fetchedUrls);
    }

    const [{ data: profile }, { knowledge, rag, docSummary }] = await Promise.all([
      fetchedUrls.length > 0
        ? supabase.from('org_profiles').select('data').eq('org_id', org_id).single()
        : Promise.resolve({ data: profileBefore }),
      loadAllChunks(supabase, org_id, message, active_tab),
    ]);

    const urlContent = formatUrlsForMessage(fetchedUrls);

    const isCompanyTab = active_tab === 'business' || active_tab === 'foundations';
    const isOpportunityTab = active_tab === 'opportunities';
    const isOrgTab = active_tab === 'org';

    const [opportunityContext, companyContext, sectorContext, companiesIndex, grantsIndex, fundersIndex, orgMemory, submissionHistory, rawMemories] = await Promise.all([
      isOpportunityTab
        ? scanOpportunities(supabase, org_id, profile?.data as Record<string, unknown> | null, org?.name ?? null, message)
        : Promise.resolve(''),
      isCompanyTab
        ? scanCompanies(supabase, profile?.data as Record<string, unknown> | null, org?.name ?? null, message)
        : Promise.resolve(''),
      isOrgTab ? Promise.resolve('') : loadSectorIntelligence(supabase, message),
      isCompanyTab ? loadCompaniesIndex(supabase) : Promise.resolve(''),
      isOpportunityTab || active_tab === 'chat' ? loadGrantsIndex() : Promise.resolve(''),
      isCompanyTab ? loadFundersIndex(supabase) : Promise.resolve(''),
      loadOrgMemory(supabase, org_id),
      isOrgTab ? Promise.resolve('') : loadSubmissionHistory(supabase, org_id),
      supabase.from('org_memory').select('key, value').eq('org_id', org_id).limit(50).then(r => r.data as { key: string; value: string }[] || []),
    ]);

    // GuideStar auto-enrichment
    let guidestarContext = '';
    const profileData = (profile?.data ?? null) as Record<string, unknown> | null;
    const regNum = profileData?.registration_number as string | undefined;
    if (regNum && !profileData?._guidestar_fetched) {
      try {
        const gsOrg = await fetchByRegistrationNumber(regNum);
        if (gsOrg) {
          guidestarContext = formatForContext(gsOrg);
          const gsProfile = formatForProfile(gsOrg);
          const merged = { ...profileData };
          for (const [k, v] of Object.entries(gsProfile)) {
            if (!merged[k] && v) merged[k] = v;
          }
          merged._guidestar_fetched = true;
          supabase.from('org_profiles').upsert({
            org_id,
            data: merged,
            last_updated: new Date().toISOString(),
          }, { onConflict: 'org_id' });
        }
      } catch (e) {
        console.error('[guidestar] Error:', e);
      }
    }

    const orgContext = buildOrgContext(profile?.data ?? null, org?.name ?? null, rawMemories);
    const tabFocus = (active_tab && TAB_FOCUS[active_tab]) || '';

    // Grant writing mode
    let grantWritingContext = '';
    if (userAsksForGrantWriting(message)) {
      grantWritingContext = await loadFullDocumentsForGrantWriting(supabase, org_id);

      const { data: allMemories } = await supabase
        .from('org_memory')
        .select('key, value, confidence')
        .eq('org_id', org_id)
        .in('source', ['chat_ai', 'chat_outcome'])
        .order('updated_at', { ascending: false })
        .limit(100);

      if (allMemories && allMemories.length > 0) {
        const msgLower = message.toLowerCase();
        const relevantMemories = allMemories.filter((m: { key: string; value: string; confidence: string }) => {
          const keyLower = m.key.toLowerCase();
          const valueLower = m.value.toLowerCase();
          return (
            keyLower.startsWith('approved_') ||
            keyLower.startsWith('rejected_') ||
            keyLower.includes('funder') ||
            keyLower.includes('lesson') ||
            keyLower.includes('writing_pref') ||
            msgLower.includes(valueLower.slice(0, 20))
          );
        });

        if (relevantMemories.length > 0) {
          const memorySummary = relevantMemories
            .map((m: { key: string; value: string; confidence: string }) => `- ${m.value}`)
            .join('\n');
          grantWritingContext += `\n\n--- זיכרון היסטורי רלוונטי ---\n${memorySummary}\nהתחשב בלקחים אלה בעת כתיבת ההגשה.\n`;
        }
      }
    }

    // Submission Engine
    let submissionEngineContext = '';
    try {
      if (userAsksForRfpParse(message) || userAsksForGrantWriting(message)) {
        let blocks = await loadOrgBlocks(supabase, org_id);

        if (blocks.length === 0 && profile?.data) {
          const { data: docs } = await supabase
            .from('documents')
            .select('filename, category, parsed_text')
            .eq('org_id', org_id)
            .in('category', ['identity', 'budget', 'project', 'impact', 'programs', 'submission'])
            .limit(10);

          if (docs?.length) {
            const docTexts = docs
              .filter((d: { parsed_text: string | null }) => d.parsed_text)
              .map((d: { category: string; parsed_text: string | null; filename: string }) => ({
                category: d.category,
                text: d.parsed_text || '',
                filename: d.filename,
              }));

            const generated = await generateOrgBlocks(profile.data as import('@/types').OrgProfileData, docTexts);
            await saveOrgBlocks(supabase, org_id, generated);
            blocks = await loadOrgBlocks(supabase, org_id);
          }
        }

        const rfpText = fetchedUrls.find(u => u.content.length > 500)?.content;

        if (rfpText && userAsksForRfpParse(message)) {
          const rfp = await parseRfp(rfpText);
          rfp.org_id = org_id;
          await saveRfpParsed(supabase, org_id, rfp);

          const { data: orgDocs } = await supabase
            .from('documents')
            .select('filename, category, metadata')
            .eq('org_id', org_id);

          const readiness = checkReadiness(
            rfp,
            (profile?.data || {}) as import('@/types').OrgProfileData,
            blocks,
            (orgDocs || []) as { filename: string; category: string; metadata?: Record<string, unknown> }[]
          );

          const assembled = assembleSubmission(rfp, blocks);
          const answeredCount = assembled.filter(a => a.answer && !a.answer.startsWith('[נדרש')).length;

          submissionEngineContext = `\n\n===== ניתוח קול קורא — מנוע הגשות =====
קול קורא: ${rfp.rfp_title}
גוף מממן: ${rfp.funder_name} (${rfp.funder_type})
${rfp.deadline ? `דדליין: ${rfp.deadline}` : ''}
${rfp.max_amount ? `סכום מקסימלי: ${rfp.max_amount.toLocaleString()} ₪` : ''}

שאלות שזוהו: ${rfp.questions.length}
שאלות שיש תשובה מוכנה: ${answeredCount}/${rfp.questions.length}
מסמכים נדרשים: ${rfp.required_documents.join(', ') || 'לא צוינו'}

${formatReadinessReport(readiness, rfp.rfp_title)}

תנאי סף: ${rfp.eligibility.other_conditions?.join('; ') || 'לא צוינו'}
${rfp.evaluation_criteria?.length ? `קריטריוני הערכה: ${rfp.evaluation_criteria.map(c => `${c.criterion} (${c.weight}%)`).join(', ')}` : ''}

הנחיות: הצג את הניתוח למשתמש. אם ציון המוכנות נמוך — הסבר מה חסר ואיך להשלים. אם גבוה — הצע להתחיל לכתוב טיוטה.`;

        } else if (blocks.length > 0) {
          const blockSummary = blocks.map(b =>
            `${b.block_type}: ${b.content.standard.slice(0, 100)}...`
          ).join('\n');

          submissionEngineContext = `\n\n===== בלוקי תוכן מוכנים (${blocks.length}) =====
${blockSummary}
הנחיה: יש בלוקי תוכן מוכנים לארגון. כשכותב הגשה — השתמש בהם כבסיס והתאם לקול הקורא הספציפי.`;
        }
      }
    } catch (engineErr) {
      console.error('Submission engine error:', engineErr);
    }

    // Web Search
    let webSearchContext = '';
    if (process.env.TAVILY_API_KEY) {
      try {
        const searchQuery = detectSearchIntent(message);
        const funderQuery = !searchQuery ? detectFunderQuery(message) : null;
        const effectiveQuery = searchQuery || funderQuery;

        if (effectiveQuery) {
          let results;
          if (active_tab === 'opportunities' || /קול קורא|מענק|grant/i.test(effectiveQuery)) {
            results = await searchGrants(effectiveQuery);
          } else if (active_tab === 'business' || active_tab === 'foundations' || /חברה|קרן|תורם|foundation|fund/i.test(effectiveQuery)) {
            const [csrResults, grantResults] = await Promise.all([
              searchCompany(effectiveQuery),
              webSearch(`${effectiveQuery} קרן מענק ישראל deadline`, { maxResults: 3, searchDepth: 'advanced' }),
            ]);
            results = [...csrResults, ...grantResults].slice(0, 6);
          } else {
            results = await webSearch(effectiveQuery, { maxResults: 5 });
          }
          if (results.length > 0) {
            webSearchContext = formatSearchResults(results);
          }
        }
      } catch (e) {
        console.error('Web search error:', e);
      }
    }

    // Auto-Research: unknown funder detection + auto-ingestion
    let autoResearchContext = '';
    try {
      const research = await autoResearchFunder(message, org_id);
      if (research?.found) {
        autoResearchContext = formatFunderResearch(research);
      }
    } catch (e) {
      console.error('Auto-research error:', e);
    }

    // Funder intelligence
    let funderIntelligenceContext = '';
    if (active_tab === 'opportunities' || active_tab === 'foundations' || /קול קורא|מענק|קרן|גוף מממן|הגשה|grant|funder/i.test(message)) {
      try {
        const { data: matchedFunders } = await supabase
          .from('funder_intelligence')
          .select('funder_name, funder_style, preferred_domains, preferred_populations, typical_amount_min, typical_amount_max, total_submissions, total_approved, writing_tips, recurring_months, cycle_notes')
          .or(`funder_name.ilike.%${message.split(/\s+/).filter((w: string) => w.length > 3).slice(0, 3).join('%,funder_name.ilike.%')}%`)
          .limit(5);

        if (matchedFunders && matchedFunders.length > 0) {
          const funderLines = matchedFunders.map(f => {
            const parts = [`גוף: ${f.funder_name} (${f.funder_style})`];
            if (f.preferred_domains?.length > 0) parts.push(`  תחומים: ${f.preferred_domains.join(', ')}`);
            if (f.preferred_populations?.length > 0) parts.push(`  אוכלוסיות: ${f.preferred_populations.join(', ')}`);
            if (f.typical_amount_min || f.typical_amount_max) parts.push(`  סכום טיפוסי: ${f.typical_amount_min || '?'}-${f.typical_amount_max || '?'} ש"ח`);
            if (f.total_submissions > 0) parts.push(`  אחוז אישור: ${Math.round((f.total_approved / f.total_submissions) * 100)}% (מתוך ${f.total_submissions} הגשות)`);
            if (f.writing_tips) parts.push(`  טיפים: ${f.writing_tips}`);
            if (f.recurring_months?.length > 0) parts.push(`  מחזוריות: חודשים ${f.recurring_months.join(', ')}`);
            if (f.cycle_notes) parts.push(`  הערת מחזוריות: ${f.cycle_notes}`);
            return parts.join('\n');
          });
          funderIntelligenceContext = `\n\n===== מודיעין גופים מממנים =====\n${funderLines.join('\n\n')}\n\nהשתמש במידע הזה כשאתה ממליץ על קולות קוראים, כותב הגשות, או עונה על שאלות על גופים מממנים.`;
        }
      } catch {
        // Non-critical
      }
    }

    const ragContext = await buildRAGContext(message);

    let systemPrompt = FISHGOLD_SYSTEM_PROMPT + FISHGOLD_BEHAVIOR_RULES + FISHGOLD_GRANT_EXPERTISE + FISHGOLD_GRANT_MASTERY + FISHGOLD_FUNDER_WRITING_DNA + FISHGOLD_FUNDER_QUESTIONS + FISHGOLD_PROPOSAL_GUIDE + FISHGOLD_SUBMISSION_ENGINE + FISHGOLD_COMPETITIVE_INTEL + FISHGOLD_FUNDRAISING_INTEL + FISHGOLD_EMAIL_MASTERY + ragContext + tabFocus + orgContext + orgMemory + submissionHistory + docSummary + knowledge + rag + grantWritingContext + submissionEngineContext + opportunityContext + companyContext + companiesIndex + grantsIndex + fundersIndex + sectorContext + webSearchContext + guidestarContext + funderIntelligenceContext + autoResearchContext;

    const MAX_SYSTEM_CHARS = 180000;
    if (systemPrompt.length > MAX_SYSTEM_CHARS) {
      console.warn(`System prompt too large: ${systemPrompt.length} chars, truncating to ${MAX_SYSTEM_CHARS}`);
      systemPrompt = systemPrompt.slice(0, MAX_SYSTEM_CHARS) + '\n[... חלק מהמידע נחתך בגלל מגבלת גודל]';
    }

    let chatMessages: { role: 'user' | 'assistant'; content: string }[] = [];

    if (conversation_id) {
      const { data: conv } = await supabase
        .from('conversations')
        .select('messages')
        .eq('id', conversation_id)
        .eq('org_id', org_id)
        .single();

      if (conv?.messages) {
        chatMessages = (conv.messages as { role: string; content: string }[]).slice(-20).map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }));
      }
    }

    const enrichedMessage = urlContent ? message + urlContent : message;
    chatMessages.push({ role: 'user', content: enrichedMessage });

    const chatModel = active_tab === 'org'
      ? 'claude-haiku-4-5-20251001'
      : 'claude-sonnet-4-20250514';
    const stream = anthropic.messages.stream({
      model: chatModel,
      system: systemPrompt,
      messages: chatMessages,
      max_tokens: active_tab === 'org' ? 4096 : 8192,
    });

    const encoder = new TextEncoder();
    let fullResponse = '';

    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of stream) {
            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
              const text = event.delta.text
                .replace(/\*\*/g, '')
                .replace(/\*/g, '')
                .replace(/^#{1,4}\s/gm, '')
                .replace(/^- /gm, '');
              fullResponse += text;
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text })}\n\n`));
            }
          }
        } catch (streamError) {
          console.error('Stream error:', streamError);
          const errMsg = streamError instanceof Error ? streamError.message : 'Unknown stream error';
          if (!fullResponse) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: `שגיאה: ${errMsg}` })}\n\n`));
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
          controller.close();
          return;
        }

        const now = new Date().toISOString();
        const userMsg = { role: 'user', content: message, timestamp: now };
        const assistantMsg = { role: 'assistant', content: fullResponse, timestamp: now };

        let convId = conversation_id;

        if (convId) {
          const { data: existing } = await supabase
            .from('conversations')
            .select('messages')
            .eq('id', convId)
            .single();

          const updatedMessages = [...((existing?.messages as unknown[]) || []), userMsg, assistantMsg];

          await supabase
            .from('conversations')
            .update({ messages: updatedMessages, updated_at: now })
            .eq('id', convId);
        } else {
          const { data: newConv } = await supabase
            .from('conversations')
            .insert({
              org_id,
              user_id,
              title: message.slice(0, 100),
              messages: [userMsg, assistantMsg],
            })
            .select('id')
            .single();

          convId = newConv?.id;
        }

        extractAndSaveMemory(supabase, org_id, message, fullResponse).catch(e =>
          console.error('Memory save failed:', e)
        );

        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ done: true, conversation_id: convId })}\n\n`)
        );
        controller.close();
      },
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('Chat API error:', errMsg, error);
    return Response.json({ error: errMsg }, { status: 500 });
  }
});
