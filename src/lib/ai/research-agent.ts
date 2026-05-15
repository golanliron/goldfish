/**
 * Research Agent — ReAct Loop for Grant Intelligence
 *
 * לכל קול קורא גולמי, הסוכן:
 * 1. חושב מה הוא צריך לדעת
 * 2. בוחר tool מתאים
 * 3. מפרש את התוצאה
 * 4. חוזר — עד MAX_ITERATIONS
 *
 * שלושה דגשים:
 * A) parseReActResponse — עמיד לכל פורמט AI (אפילו בלי THOUGHT/ACTION)
 * B) fetch_call_page — מזהה PDF אוטומטית ומפנה ל-smart-reader
 * C) אם verdict=high → יוצר פריט Monday.com אוטומטית
 */

import { webSearch } from './web-search';
import { geminiCall } from './gemini';
import { createAdminClient } from '@/lib/supabase/admin';
import type { OrgDNA } from './org-dna';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface RawCall {
  id?: string;
  title: string;
  source: string;
  url: string;
  category: string;
  region: string;
  description?: string;
  deadline?: string;
  grant_amount?: string;
  tags?: string[];
  match_score?: number;
}

export interface FunderProfile {
  name: string;
  focus_areas: string[];
  past_grantees?: string[];
  typical_grant_size?: string;
  application_requirements?: string[];
  source_urls: string[];
}

export interface AgentResult {
  match_score: number;    // ציון בסיסי מהסורק
  deep_score: number;     // ציון עמוק מהסוכן
  funder_profile?: FunderProfile;
  research_notes: string;
  agent_verdict: 'high' | 'medium' | 'low' | 'skip';
  iterations_used: number;
}

export interface EnrichedCall extends RawCall, AgentResult {}

// ── Internal types ─────────────────────────────────────────────────────────────

type ToolName = 'search_funder' | 'search_past_grantees' | 'fetch_call_page' | 'verify_and_fix_link' | 'score_match' | 'finish';

interface ParsedAction {
  thought: string;
  action: ToolName;
  actionInput: Record<string, string>;
}

interface AgentContext {
  call: RawCall;
  orgDNA: OrgDNA;
  orgId: string;
  memory: Record<string, string>;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const MAX_ITERATIONS = 4;

// ── Tool: search_funder ────────────────────────────────────────────────────────

async function toolSearchFunder(args: Record<string, string>): Promise<string> {
  const query = args.query || args.funder_name || '';
  if (!query) return 'לא סופק שם גוף מממן לחיפוש.';

  const results = await webSearch(`"${query}" foundation grants strategy focus areas`, {
    maxResults: 3,
    searchDepth: 'advanced',
  });

  if (!results.length) return `לא נמצא מידע על "${query}".`;

  return results
    .map(r => `כותרת: ${r.title}\nתוכן: ${r.content.slice(0, 400)}\nURL: ${r.url}`)
    .join('\n\n');
}

// ── Tool: search_past_grantees ─────────────────────────────────────────────────

async function toolSearchPastGrantees(args: Record<string, string>): Promise<string> {
  const funder = args.funder_name || args.query || '';
  if (!funder) return 'לא סופק שם גוף מממן.';

  const results = await webSearch(
    `"${funder}" grants awarded nonprofits Israel youth education site:*.org OR site:*.il OR site:*.com`,
    { maxResults: 3 }
  );

  if (!results.length) return `לא נמצאו עמותות שקיבלו מימון מ-"${funder}".`;

  return results
    .map(r => `כותרת: ${r.title}\nתוכן: ${r.content.slice(0, 400)}\nURL: ${r.url}`)
    .join('\n\n');
}

// ── Tool: verify_and_fix_link ──────────────────────────────────────────────────
// בודק אם ה-URL הוא "מתווך" (פייסבוק, דף בית, אגרגטור)
// אם כן — מחפש את הדף הישיר של הקול הקורא ומחזיר URL מתוקן

const INDIRECT_URL_PATTERNS = [
  /facebook\.com/,
  /fb\.com/,
  /twitter\.com/,
  /linkedin\.com\/feed/,
  /t\.co\//,
  /bit\.ly\//,
  /tinyurl\.com/,
];

// דפי בית כלליים — URL שנגמר ב-/ או ב-domain בלי path משמעותי
function isIndirectUrl(url: string): boolean {
  if (INDIRECT_URL_PATTERNS.some(p => p.test(url))) return true;
  try {
    const u = new URL(url);
    // pathname קצר מדי = דף בית / קטגוריה כללית
    const path = u.pathname.replace(/\/$/, '');
    if (path.length < 4) return true;
    // דפי חיפוש / קטגוריה כללית
    if (/\/(search|category|tag|page|news|grants)\/?$/i.test(path)) return true;
  } catch { /* URL לא תקין — נתייחס כעקיף */ return true; }
  return false;
}

async function toolVerifyAndFixLink(
  args: Record<string, string>,
  ctx: AgentContext
): Promise<string> {
  const url = args.url || ctx.call.url;
  const title = args.title || ctx.call.title;

  if (!isIndirectUrl(url)) {
    return `OK:${url}`; // הלינק ישיר — אין מה לתקן
  }

  // חפש דף ישיר לקול הקורא
  const results = await webSearch(
    `"${title}" ${ctx.call.source} קול קורא הגשה apply`,
    { maxResults: 5 }
  );

  // מצא תוצאה עם URL שנראה ישיר (יש path משמעותי, לא פייסבוק)
  for (const r of results) {
    if (!isIndirectUrl(r.url) && r.url !== url) {
      return `FIXED:${r.url}`;
    }
  }

  return `UNFIXABLE:${url}`; // לא מצאנו — נשאר עם המקורי
}

// ── Tool: fetch_call_page ──────────────────────────────────────────────────────
// מזהה PDF אוטומטית ומשתמש ב-smart-reader

async function toolFetchCallPage(
  args: Record<string, string>,
  ctx: AgentContext
): Promise<string> {
  const url = args.url || ctx.call.url;
  if (!url) return 'לא סופק URL לשליפה.';

  const isPdf = /\.pdf($|\?)/i.test(url) || args.type === 'pdf';

  // PDF — שלח ל-smart-reader API
  if (isPdf) {
    try {
      const res = await fetch('/api/smart-reader', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          org_id: ctx.orgId,
          save: false,          // רק ניתוח, לא שמירה
          agent_mode: true,
        }),
      });

      if (!res.ok) return `smart-reader נכשל (${res.status}) עבור PDF: ${url}`;

      const data = await res.json();
      const summary: string = data?.summary || data?.text?.slice(0, 800) || '';
      return summary
        ? `[PDF מנותח ע"י smart-reader]\n${summary}`
        : 'smart-reader לא החזיר תוכן.';
    } catch (e) {
      return `שגיאת smart-reader: ${String(e)}`;
    }
  }

  // דף רגיל — חיפוש ממוקד
  const results = await webSearch(`site:${extractDomain(url)} ${ctx.call.title}`, {
    maxResults: 2,
  });

  if (results.length) {
    return results.map(r => `${r.title}\n${r.content.slice(0, 500)}`).join('\n\n');
  }

  // fallback — חיפוש כללי בשם הכותרת + המקור
  const fallback = await webSearch(`${ctx.call.title} ${ctx.call.source} דרישות הגשה`, {
    maxResults: 2,
  });

  return fallback.length
    ? fallback.map(r => `${r.title}\n${r.content.slice(0, 500)}`).join('\n\n')
    : 'לא נמצא מידע נוסף על דף הקול הקורא.';
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url.split('/')[0];
  }
}

// ── Tool: score_match ──────────────────────────────────────────────────────────

async function toolScoreMatch(ctx: AgentContext): Promise<string> {
  const memoryText = Object.entries(ctx.memory)
    .map(([k, v]) => `[${k}]\n${v}`)
    .join('\n\n');

  const prompt = `אתה מומחה לגיוס משאבים לעמותות. בהינתן הנתונים הבאים, תן ציון התאמה מ-0 עד 100.

DNA ארגוני:
- אוכלוסיות: ${ctx.orgDNA.populations?.join(', ') || 'לא צוין'}
- תחומים: ${ctx.orgDNA.domains?.join(', ') || 'לא צוין'}
- גיאוגרפיה: ${ctx.orgDNA.geography?.join(', ') || 'לא צוין'}
- סוגי התערבות: ${ctx.orgDNA.interventionTypes?.join(', ') || 'לא צוין'}

קול קורא:
- כותרת: ${ctx.call.title}
- מקור: ${ctx.call.source}
- תיאור: ${(ctx.call.description || '').slice(0, 400)}
- קטגוריה: ${ctx.call.category}
- אזור: ${ctx.call.region}

מחקר שנאסף:
${memoryText || 'לא בוצע מחקר נוסף.'}

ענה ב-JSON בלבד (אין טקסט לפני או אחרי):
{
  "deep_score": <מספר 0-100>,
  "reasoning": "<נימוק קצר עד 3 משפטים בעברית>",
  "key_match_factors": ["<גורם 1>", "<גורם 2>"],
  "key_risks": ["<סיכון 1>"]
}`;

  const raw = await geminiCall(prompt, 400, 0);

  // חלץ JSON — גם אם יש טקסט מסביב
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return JSON.stringify({ deep_score: ctx.call.match_score || 30, reasoning: 'לא ניתן לנתח תשובת AI.' });
  return jsonMatch[0];
}

// ── ReAct Parser — עמיד לפורמטים שבורים ────────────────────────────────────────

function parseReActResponse(text: string): ParsedAction | null {
  if (!text?.trim()) return null;

  // ניסיון 1: פורמט מחמיר THOUGHT/ACTION/ACTION_INPUT
  const strictThought = text.match(/THOUGHT:\s*([\s\S]*?)(?=ACTION:|$)/i)?.[1]?.trim() ?? '';
  const strictAction = text.match(/ACTION:\s*(\w+)/i)?.[1]?.trim();
  const strictInput = text.match(/ACTION_INPUT:\s*(\{[\s\S]*?\})/i)?.[1];

  if (strictAction && isValidTool(strictAction)) {
    let parsed: Record<string, string> = {};
    if (strictInput) {
      try { parsed = JSON.parse(strictInput); } catch { /* נמשיך בלי */ }
    }
    return { thought: strictThought, action: strictAction as ToolName, actionInput: parsed };
  }

  // ניסיון 2: JSON עטוף ב-```
  const jsonBlock = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/i)?.[1];
  if (jsonBlock) {
    try {
      const obj = JSON.parse(jsonBlock);
      if (obj.action && isValidTool(obj.action)) {
        return {
          thought: obj.thought || obj.reasoning || '',
          action: obj.action as ToolName,
          actionInput: obj.input || obj.action_input || obj.params || {},
        };
      }
    } catch { /* ממשיכים */ }
  }

  // ניסיון 3: JSON ישיר בתוך התשובה
  const inlineJson = text.match(/\{[\s\S]*?"action"\s*:\s*"(\w+)"[\s\S]*?\}/)?.[0];
  if (inlineJson) {
    try {
      const obj = JSON.parse(inlineJson);
      if (obj.action && isValidTool(obj.action)) {
        return {
          thought: obj.thought || obj.reasoning || '',
          action: obj.action as ToolName,
          actionInput: obj.input || obj.action_input || obj.params || {},
        };
      }
    } catch { /* ממשיכים */ }
  }

  // ניסיון 4: זיהוי מילות מפתח בטקסט חופשי
  const lowerText = text.toLowerCase();
  if (lowerText.includes('finish') || lowerText.includes('score_match') ||
      lowerText.includes('סיים') || lowerText.includes('ציון סופי')) {
    return { thought: text, action: 'score_match', actionInput: {} };
  }
  if (lowerText.includes('search_funder') || lowerText.includes('חיפוש קרן')) {
    const nameMatch = text.match(/(?:קרן|foundation|fund|גוף)\s+["']?([^"'\n,]{3,40})["']?/i);
    return { thought: text, action: 'search_funder', actionInput: { query: nameMatch?.[1] || ctx_placeholder(text) } };
  }
  if (lowerText.includes('search_past_grantees') || lowerText.includes('מוטבים')) {
    return { thought: text, action: 'search_past_grantees', actionInput: { funder_name: '' } };
  }
  if (lowerText.includes('fetch_call_page') || lowerText.includes('דף הקול')) {
    return { thought: text, action: 'fetch_call_page', actionInput: {} };
  }

  // Fallback — לא זוהה פורמט כלל → סיים עם ציון
  console.warn('[research-agent] Could not parse AI response, defaulting to score_match');
  return { thought: text, action: 'score_match', actionInput: {} };
}

function isValidTool(name: string): boolean {
  return ['search_funder', 'search_past_grantees', 'fetch_call_page', 'verify_and_fix_link', 'score_match', 'finish'].includes(name);
}

function ctx_placeholder(text: string): string {
  // מנסה לחלץ שם קרן מהטקסט
  return text.match(/["']([^"']{5,40})["']/)?.[1] || '';
}

// ── System Prompt ──────────────────────────────────────────────────────────────

function buildSystemPrompt(orgDNA: OrgDNA, call: RawCall): string {
  return `אתה סוכן מחקר מומחה בגיוס משאבים לעמותות. אתה עובד בלולאת ReAct: חשב → בחר כלי → קבל תצפית → חשב שוב.

DNA הארגון שאתה מייצג:
- אוכלוסיות: ${orgDNA.populations?.join(', ') || 'לא ידוע'}
- תחומים: ${orgDNA.domains?.join(', ') || 'לא ידוע'}
- גיאוגרפיה: ${orgDNA.geography?.join(', ') || 'לא ידוע'}

קול קורא לניתוח:
- כותרת: ${call.title}
- מקור: ${call.source}
- URL: ${call.url}
- תיאור: ${(call.description || '').slice(0, 300)}

כלים זמינים:
- verify_and_fix_link: בדוק אם ה-URL ישיר. אם הוא פייסבוק / דף בית / מתווך — מצא את הדף הספציפי. השתמש תמיד כצעד ראשון (שדה: url, title)
- search_funder: חיפוש מידע על הגוף המממן (שדה: query)
- search_past_grantees: חיפוש עמותות שקיבלו מימון (שדה: funder_name)
- fetch_call_page: שליפת תוכן דף הקול הקורא, מזהה PDF אוטומטית (שדה: url, type)
- score_match: חישוב ציון סופי (אין שדות)
- finish: סיים (אין שדות)

כלל ברזל: הצעד הראשון תמיד הוא verify_and_fix_link. אם חזר FIXED — השתמש ב-URL החדש בכל הכלים הבאים.

חשיבה יצירתית — חובה:
אל תחפש רק התאמה ישירה 1:1. חשוב כמו מגייס משאבים מנוסה שמוצא זוויות עקיפות.
דוגמאות:
- קול קורא על "איכות הסביבה" + עמותת נוער → זווית: "מנהיגות סביבתית לנוער בסיכון"
- קול קורא על "תעסוקה" + עמותת חינוך → זווית: "מיומנויות עבודה כהמשך לחינוך"
- קול קורא על "קהילה" + עמותת בריאות → זווית: "בריאות קהילתית כגורם מגן"

בסוף, לפני score_match, הוסף ל-research_notes שלך 2-3 "זוויות הגשה יצירתיות" בפורמט:
[יצירתי] זווית 1: ...
[יצירתי] זווית 2: ...

ענה תמיד בפורמט:
THOUGHT: [מה אתה חושב]
ACTION: [שם הכלי]
ACTION_INPUT: {"key": "value"}

אחרי 3-4 צעדים — קרא ל-score_match.`;
}

// ── Monday.com integration ─────────────────────────────────────────────────────

// ── Monday API — server-side direct call with org token ───────────────────────

async function mondayDirectCall(
  accessToken: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const res = await fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': accessToken,
      'API-Version': '2024-10',
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Monday API ${res.status}`);
  const data = await res.json() as Record<string, unknown>;
  if ((data as any).errors) throw new Error((data as any).errors[0]?.message);
  return (data as any).data || {};
}

async function createMondayItem(
  call: EnrichedCall,
  orgId: string
): Promise<void> {
  try {
    // 1. שלוף את ה-Monday token של הארגון הספציפי מה-DB
    const admin = createAdminClient();
    const { data: tokenRow } = await admin
      .from('monday_tokens')
      .select('access_token')
      .eq('org_id', orgId)
      .maybeSingle();

    if (!tokenRow?.access_token) {
      console.log(`[research-agent] No Monday token for org ${orgId} — skipping`);
      return;
    }

    const token = tokenRow.access_token;

    // 2. מצא לוח grants של הארגון
    const boardsData = await mondayDirectCall(token, `{ boards(limit: 50) { id name } }`);
    const boards = (boardsData.boards as Array<{ id: string; name: string }>) || [];

    const grantsBoard = boards.find(b =>
      /grants|גיוס|קולות|opportunities/i.test(b.name)
    );

    if (!grantsBoard) {
      console.warn(`[research-agent] No grants board in Monday for org ${orgId}`);
      return;
    }

    // 3. צור פריט
    const columnValues = JSON.stringify({
      status:  { label: 'לבדיקה' },
      text:    call.source,
      date:    call.deadline ? { date: call.deadline.slice(0, 10) } : undefined,
      numbers: call.deep_score,
    });

    const created = await mondayDirectCall(
      token,
      `mutation ($boardId: ID!, $itemName: String!, $columnValues: JSON!) {
         create_item(board_id: $boardId, item_name: $itemName, column_values: $columnValues) { id }
       }`,
      {
        boardId:      grantsBoard.id,
        itemName:     `[התאמה גבוהה] ${call.title.slice(0, 80)}`,
        columnValues,
      }
    );

    const itemId = (created as any).create_item?.id;
    console.log(`[research-agent] Monday item ${itemId} created for org ${orgId} — "${call.title}"`);

    // 4. הוסף update עם ממצאי המחקר
    if (itemId) {
      const body = [
        `**ציון התאמה:** ${call.deep_score}/100`,
        `**מקור:** ${call.source}`,
        call.url          ? `**קישור:** ${call.url}`              : '',
        call.deadline     ? `**דדליין:** ${call.deadline}`         : '',
        call.grant_amount ? `**סכום:** ${call.grant_amount}`       : '',
        call.research_notes
          ? `\n**ממצאי מחקר:**\n${call.research_notes.slice(0, 500)}`
          : '',
      ].filter(Boolean).join('\n');

      await mondayDirectCall(
        token,
        `mutation ($itemId: ID!, $body: String!) {
           create_update(item_id: $itemId, body: $body) { id }
         }`,
        { itemId, body }
      );
    }
  } catch (e) {
    // שגיאת Monday לעולם לא תפיל את ה-pipeline
    console.error('[research-agent] Monday error (non-fatal):', e);
  }
}

// ── Main: runResearchAgent ─────────────────────────────────────────────────────

export async function runResearchAgent(
  rawCall: RawCall,
  orgDNA: OrgDNA,
  orgId: string
): Promise<EnrichedCall> {
  const context: AgentContext = {
    call: rawCall,
    orgDNA,
    orgId,
    memory: {},
  };

  const systemPrompt = buildSystemPrompt(orgDNA, rawCall);
  const messages: string[] = [];

  let iterations = 0;
  let finalScoreStr: string | null = null;

  // ── Conversation turn 0: kick off ──
  const firstUserMsg = `קול קורא חדש נמצא. נתח אותו והחלט מה לחקור.

כותרת: ${rawCall.title}
מקור: ${rawCall.source}
URL: ${rawCall.url}
תיאור: ${(rawCall.description || '').slice(0, 300)}
ציון בסיסי (מילות מפתח): ${rawCall.match_score ?? 'לא ידוע'}

כתוב THOUGHT → ACTION → ACTION_INPUT.`;

  let currentPrompt = `${systemPrompt}\n\n${firstUserMsg}`;

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    // שלח ל-Gemini
    let llmResponse: string;
    try {
      llmResponse = await geminiCall(currentPrompt, 600, 0.1);
    } catch (e) {
      console.error(`[research-agent] Gemini error at iteration ${iterations}:`, e);
      break;
    }

    messages.push(`[Iteration ${iterations}]\nAI: ${llmResponse}`);

    // פרסר — עמיד לשגיאות
    const parsed = parseReActResponse(llmResponse);
    if (!parsed) {
      console.warn('[research-agent] Empty parse result, stopping loop');
      break;
    }

    // score_match או finish — עצור
    if (parsed.action === 'score_match' || parsed.action === 'finish') {
      finalScoreStr = await toolScoreMatch(context);
      break;
    }

    // הרץ את הכלי המבוקש
    let observation: string;
    try {
      switch (parsed.action) {
        case 'search_funder':
          observation = await toolSearchFunder(parsed.actionInput);
          break;
        case 'search_past_grantees':
          observation = await toolSearchPastGrantees(parsed.actionInput);
          break;
        case 'fetch_call_page':
          observation = await toolFetchCallPage(parsed.actionInput, context);
          break;
        case 'verify_and_fix_link': {
          observation = await toolVerifyAndFixLink(parsed.actionInput, context);
          // אם נמצא URL טוב יותר — עדכן ב-context לשימוש בציון הסופי
          if (observation.startsWith('FIXED:')) {
            context.call = { ...context.call, url: observation.slice(6) };
          }
          break;
        }
        default:
          observation = `כלי לא ידוע: ${parsed.action}`;
      }
    } catch (e) {
      observation = `שגיאת כלי ${parsed.action}: ${String(e)}`;
    }

    // שמור לזיכרון
    context.memory[parsed.action] = observation.slice(0, 1000);
    messages.push(`OBSERVATION [${parsed.action}]: ${observation.slice(0, 300)}`);

    // בנה את ה-prompt לאיטרציה הבאה
    currentPrompt = `${systemPrompt}

היסטוריה:
${messages.join('\n\n')}

OBSERVATION האחרון:
${observation.slice(0, 600)}

האם יש עוד מה לחקור, או שנעבור ל-score_match?
ענה בפורמט: THOUGHT → ACTION → ACTION_INPUT`;
  }

  // אם יצאנו בלי finalScore — חשב ציון סופי עכשיו
  if (!finalScoreStr) {
    try {
      finalScoreStr = await toolScoreMatch(context);
    } catch (e) {
      finalScoreStr = JSON.stringify({ deep_score: rawCall.match_score || 30, reasoning: 'חישוב ציון נכשל.' });
    }
  }

  // פרסר את ה-score JSON
  let deepScore = rawCall.match_score || 30;
  let reasoning = '';
  try {
    const scoreObj = JSON.parse(finalScoreStr!);
    deepScore = typeof scoreObj.deep_score === 'number' ? scoreObj.deep_score : deepScore;
    reasoning = scoreObj.reasoning || '';
    if (scoreObj.key_match_factors?.length) {
      reasoning += `\nגורמי התאמה: ${scoreObj.key_match_factors.join(', ')}`;
    }
    if (scoreObj.key_risks?.length) {
      reasoning += `\nסיכונים: ${scoreObj.key_risks.join(', ')}`;
    }
  } catch {
    console.warn('[research-agent] Could not parse final score JSON');
  }

  // קבע verdict
  let agentVerdict: EnrichedCall['agent_verdict'];
  if (deepScore >= 75)      agentVerdict = 'high';
  else if (deepScore >= 50) agentVerdict = 'medium';
  else if (deepScore >= 30) agentVerdict = 'low';
  else                      agentVerdict = 'skip';

  const enriched: EnrichedCall = {
    ...rawCall,
    url: context.call.url, // ← URL מתוקן אם verify_and_fix_link שינה אותו
    match_score: rawCall.match_score ?? 0,
    deep_score: deepScore,
    research_notes: reasoning,
    agent_verdict: agentVerdict,
    iterations_used: iterations,
  };

  // דגש C: אם התאמה גבוהה — צור פריט Monday אוטומטית
  if (agentVerdict === 'high') {
    console.log(`[research-agent] High match detected — creating Monday item for "${rawCall.title}"`);
    await createMondayItem(enriched, orgId);
  }

  return enriched;
}
