/**
 * Submission Engine — Smart grant application assembly
 *
 * Pipeline:
 * 1. parseRfp() — Extract structure from any grant application (questions, limits, eligibility)
 * 2. checkReadiness() — Verify org has everything needed before writing
 * 3. assembleSubmission() — Build draft from org blocks, adapted to RFP constraints
 */

import type {
  RfpStructure,
  RfpQuestion,
  RfpEligibility,
  OrgBlock,
  OrgBlockType,
  BlockLength,
  ReadinessResult,
  OrgProfileData,
} from '@/types';

// ===== Gemini helpers (reuse same pattern as gemini.ts) =====

import { MODELS } from '@/lib/ai/prompts';

const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const PRO_MODEL = MODELS.docAnalysis;
const PRO_BASE = `https://generativelanguage.googleapis.com/v1beta/models/${PRO_MODEL}`;

async function geminiPro(prompt: string, maxTokens: number = 8000): Promise<string> {
  const res = await fetch(`${PRO_BASE}:generateContent?key=${GEMINI_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: maxTokens, temperature: 0 },
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Gemini Pro ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

function parseJsonFromGemini<T>(raw: string, fallback: T): T {
  try {
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, raw];
    return JSON.parse(jsonMatch[1]!.trim());
  } catch {
    return fallback;
  }
}

// ===== 1. RFP Parser =====

export async function parseRfp(
  text: string,
  funderName?: string,
  funderType?: RfpStructure['funder_type']
): Promise<RfpStructure> {
  const raw = await geminiPro(`אתה מומחה לניתוח קולות קוראים ובקשות מענק ישראליות. נתח את הטקסט הבא וחלץ את המבנה המלא.

הטקסט:
${text.slice(0, 80000)}

החזר JSON תקין בלבד עם המבנה הבא:
{
  "funder_name": "שם הגוף המממן (אם מופיע)",
  "funder_type": "government|foundation|corporate|federation|other",
  "rfp_title": "שם הקול קורא / הבקשה",
  "deadline": "תאריך הגשה (ISO format או null)",
  "max_amount": null,
  "questions": [
    {
      "id": "q1",
      "question": "הטקסט המלא של השאלה",
      "section": "אחת מ: org_identity, governance, project_description, target_audience, methodology, innovation, budget, measurement, sustainability, partnerships, risk, team, documents, declarations, other",
      "char_limit": null,
      "word_limit": null,
      "is_required": true,
      "field_type": "text|number|date|file|dropdown|budget_table",
      "mapped_block": "identity|problem|solution|capacity|budget|measurement|documents|null"
    }
  ],
  "required_documents": ["רשימת מסמכים נדרשים"],
  "eligibility": {
    "min_annual_budget": null,
    "min_years_active": null,
    "required_org_type": [],
    "required_regions": [],
    "required_populations": [],
    "max_funding_percent": null,
    "min_self_funding": null,
    "overhead_cap": null,
    "other_conditions": []
  },
  "evaluation_criteria": [
    { "criterion": "שם הקריטריון", "weight": 0 }
  ]
}

הנחיות חשובות:
- חלץ כל שאלה בנפרד, גם אם הן בתוך אותו סעיף
- אם יש הגבלת תווים או מילים — ציין. אם לא מופיעה — null
- mapped_block: לאיזה בלוק ארגוני השאלה שייכת (identity=זהות, problem=בעיה/צורך, solution=פתרון/פעילות, capacity=ניסיון/צוות, budget=תקציב, measurement=מדידה, documents=מסמכים)
- תנאי סף: חלץ כל תנאי סף שמופיע (מחזור מינימלי, שנות ניסיון, סוג ארגון, אזורים, אוכלוסיות)
- מסמכים: רשום כל מסמך שנדרש לצרף
- קריטריוני הערכה: אם יש משקלות — ציין. אם אין — השאר מערך ריק
- funder_type: government=ממשלתי/ציבורי, foundation=קרן פרטית/משפחתית, corporate=חברה/עסקי, federation=פדרציה/סוכנות יהודית`, 8000);

  const parsed = parseJsonFromGemini<Partial<RfpStructure>>(raw, {});

  return {
    org_id: '',
    funder_name: parsed.funder_name || funderName || 'לא ידוע',
    funder_type: parsed.funder_type || funderType || 'other',
    rfp_title: parsed.rfp_title || 'קול קורא',
    deadline: parsed.deadline || undefined,
    max_amount: parsed.max_amount || undefined,
    questions: (parsed.questions || []).map((q, i) => ({
      id: q.id || `q${i + 1}`,
      question: q.question || '',
      section: q.section || 'other',
      char_limit: q.char_limit || undefined,
      word_limit: q.word_limit || undefined,
      is_required: q.is_required !== false,
      field_type: q.field_type || 'text',
      mapped_block: q.mapped_block || undefined,
    })),
    required_documents: parsed.required_documents || [],
    eligibility: {
      min_annual_budget: parsed.eligibility?.min_annual_budget || undefined,
      min_years_active: parsed.eligibility?.min_years_active || undefined,
      required_org_type: parsed.eligibility?.required_org_type || [],
      required_regions: parsed.eligibility?.required_regions || [],
      required_populations: parsed.eligibility?.required_populations || [],
      max_funding_percent: parsed.eligibility?.max_funding_percent || undefined,
      min_self_funding: parsed.eligibility?.min_self_funding || undefined,
      overhead_cap: parsed.eligibility?.overhead_cap || undefined,
      other_conditions: parsed.eligibility?.other_conditions || [],
    },
    evaluation_criteria: parsed.evaluation_criteria || [],
    raw_text: text.slice(0, 50000),
    parsed_at: new Date().toISOString(),
  };
}

// ===== 2. Readiness Check =====

const COMMON_REQUIRED_DOCS = [
  'ניהול תקין',
  'אישור רישום עמותה',
  'דו"ח כספי מבוקר',
  'סעיף 46',
  'רשימת דירקטוריון',
];

export function checkReadiness(
  rfp: RfpStructure,
  profile: OrgProfileData,
  blocks: OrgBlock[],
  existingDocs: { filename: string; category: string; metadata?: Record<string, unknown> }[]
): ReadinessResult {
  const issues: string[] = [];
  const elig = rfp.eligibility;

  // --- Eligibility checks ---
  if (elig.min_annual_budget && profile.annual_budget && profile.annual_budget < elig.min_annual_budget) {
    issues.push(`מחזור שנתי ${profile.annual_budget?.toLocaleString()} ₪ — מתחת למינימום ${elig.min_annual_budget.toLocaleString()} ₪`);
  }

  if (elig.min_years_active && profile.founded_year) {
    const yearsActive = new Date().getFullYear() - profile.founded_year;
    if (yearsActive < elig.min_years_active) {
      issues.push(`${yearsActive} שנות פעילות — מינימום נדרש: ${elig.min_years_active}`);
    }
  }

  if (elig.required_regions?.length && profile.regions?.length) {
    const overlap = elig.required_regions.some(r => profile.regions!.includes(r));
    if (!overlap) {
      issues.push(`אזורי פעילות לא תואמים. נדרש: ${elig.required_regions.join(', ')}`);
    }
  }

  // --- Block availability ---
  const blockTypes: OrgBlockType[] = ['identity', 'problem', 'solution', 'capacity', 'budget', 'measurement', 'documents'];
  const neededBlocks = new Set<OrgBlockType>();
  for (const q of rfp.questions) {
    if (q.mapped_block) neededBlocks.add(q.mapped_block);
  }

  const blocksReady = blockTypes.map(bt => {
    const block = blocks.find(b => b.block_type === bt);
    const needed = neededBlocks.has(bt);
    if (!block) return { block: bt, available: false, freshness: 'missing' as const };

    const daysSinceUpdate = (Date.now() - new Date(block.last_updated).getTime()) / (1000 * 60 * 60 * 24);
    const freshness = daysSinceUpdate > 180 ? 'stale' as const : 'fresh' as const;
    return { block: bt, available: true, freshness };
  });

  // --- Document checks ---
  const allRequiredDocs = [...new Set([...rfp.required_documents, ...COMMON_REQUIRED_DOCS])];
  const existingFilenames = existingDocs.map(d => d.filename.toLowerCase());
  const existingCategories = existingDocs.map(d => d.category);

  const documentsReady = allRequiredDocs.map(doc => {
    const docLower = doc.toLowerCase();
    // Fuzzy match — check if any existing doc contains the required doc name
    const found = existingFilenames.some(f => f.includes(docLower)) ||
      existingDocs.some(d => {
        const meta = d.metadata || {};
        const docType = ((meta.document_type as string) || '').toLowerCase();
        return docType.includes(docLower);
      });

    if (!found) return { doc, status: 'missing' as const };

    // Check expiry
    const matchedDoc = existingDocs.find(d =>
      d.filename.toLowerCase().includes(docLower) ||
      ((d.metadata?.document_type as string) || '').toLowerCase().includes(docLower)
    );
    if (matchedDoc?.metadata?.valid_until) {
      const expiry = new Date(matchedDoc.metadata.valid_until as string);
      if (expiry < new Date()) return { doc, status: 'expired' as const };
    }

    return { doc, status: 'valid' as const };
  });

  // --- Missing answers (questions with no matching block) ---
  const missingAnswers: string[] = [];
  for (const q of rfp.questions) {
    if (!q.mapped_block) {
      missingAnswers.push(q.question.slice(0, 80));
    } else {
      const block = blocks.find(b => b.block_type === q.mapped_block);
      if (!block) {
        missingAnswers.push(q.question.slice(0, 80));
      }
    }
  }

  // --- Score ---
  const totalChecks = blocksReady.length + documentsReady.length + rfp.questions.length;
  const passedChecks =
    blocksReady.filter(b => b.available).length +
    documentsReady.filter(d => d.status === 'valid').length +
    (rfp.questions.length - missingAnswers.length);

  const score = totalChecks > 0 ? Math.round((passedChecks / totalChecks) * 100) : 0;

  // Estimated completion: ~5 min per missing block, ~2 min per missing doc, ~3 min per missing answer
  const missingBlocks = blocksReady.filter(b => !b.available).length;
  const missingDocs = documentsReady.filter(d => d.status !== 'valid').length;
  const estimated = missingBlocks * 5 + missingDocs * 2 + missingAnswers.length * 3;

  return {
    score,
    eligible: issues.length === 0,
    eligibility_issues: issues,
    blocks_ready: blocksReady,
    documents_ready: documentsReady,
    missing_answers: missingAnswers,
    estimated_completion: estimated,
  };
}

// ===== 3. Block Selection =====

/**
 * Choose the right block length based on char/word limit
 */
export function pickBlockLength(charLimit?: number, wordLimit?: number): BlockLength {
  if (charLimit) {
    if (charLimit <= 600) return 'mini';
    if (charLimit <= 1800) return 'standard';
    return 'extended';
  }
  if (wordLimit) {
    if (wordLimit <= 80) return 'mini';
    if (wordLimit <= 250) return 'standard';
    return 'extended';
  }
  return 'standard';
}

/**
 * Get the right content from a block, trimmed to limit
 */
export function getBlockContent(block: OrgBlock, length: BlockLength, charLimit?: number): string {
  let text = block.content[length] || block.content.standard || block.content.extended || '';

  // Trim to char limit if specified
  if (charLimit && text.length > charLimit) {
    // Cut at last sentence boundary before limit
    const trimmed = text.slice(0, charLimit);
    const lastPeriod = trimmed.lastIndexOf('.');
    if (lastPeriod > charLimit * 0.7) {
      text = trimmed.slice(0, lastPeriod + 1);
    } else {
      text = trimmed.slice(0, charLimit - 3) + '...';
    }
  }

  return text;
}

// ===== 4. Submission Assembly =====

export interface AssembledAnswer {
  question: RfpQuestion;
  answer: string;
  source_block?: OrgBlockType;
  char_count: number;
  within_limit: boolean;
}

/**
 * Assemble a draft submission by matching RFP questions to org blocks
 */
export function assembleSubmission(
  rfp: RfpStructure,
  blocks: OrgBlock[]
): AssembledAnswer[] {
  return rfp.questions.map(q => {
    if (!q.mapped_block || q.field_type !== 'text') {
      return {
        question: q,
        answer: '',
        char_count: 0,
        within_limit: true,
      };
    }

    const block = blocks.find(b => b.block_type === q.mapped_block);
    if (!block) {
      return {
        question: q,
        answer: `[נדרש להשלים — אין בלוק "${q.mapped_block}" מוכן]`,
        source_block: q.mapped_block,
        char_count: 0,
        within_limit: true,
      };
    }

    const length = pickBlockLength(q.char_limit, q.word_limit);
    const answer = getBlockContent(block, length, q.char_limit);

    return {
      question: q,
      answer,
      source_block: q.mapped_block,
      char_count: answer.length,
      within_limit: q.char_limit ? answer.length <= q.char_limit : true,
    };
  });
}

// ===== 5. Generate Org Blocks from Documents =====

export async function generateOrgBlocks(
  profile: OrgProfileData,
  documentTexts: { category: string; text: string; filename: string }[]
): Promise<Partial<Record<OrgBlockType, OrgBlock>>> {
  const allText = documentTexts.map(d => `[${d.category}: ${d.filename}]\n${d.text.slice(0, 10000)}`).join('\n\n');

  const profileSummary = [
    profile.name && `שם: ${profile.name}`,
    profile.registration_number && `ע.ר. ${profile.registration_number}`,
    profile.mission && `ייעוד: ${profile.mission}`,
    profile.annual_budget && `תקציב: ${profile.annual_budget.toLocaleString()} ₪`,
    profile.beneficiaries_count && `מוטבים: ${profile.beneficiaries_count.toLocaleString()}`,
    profile.employees_count && `עובדים: ${profile.employees_count}`,
    profile.focus_areas?.length && `תחומים: ${profile.focus_areas.join(', ')}`,
    profile.regions?.length && `אזורים: ${profile.regions.join(', ')}`,
    profile.key_achievements?.length && `הישגים: ${profile.key_achievements.join('; ')}`,
  ].filter(Boolean).join('\n');

  const raw = await geminiPro(`אתה גייס משאבים מנוסה עם 15 שנות ניסיון. בנה בלוקי תוכן מוכנים לארגון.

פרופיל הארגון:
${profileSummary}

מסמכי הארגון:
${allText.slice(0, 60000)}

בנה 6 בלוקים. לכל בלוק כתוב 3 גרסאות אורך:
- mini: עד 500 תווים — תמציתי ומדויק
- standard: עד 1500 תווים — מפורט עם נתונים
- extended: עד 2500 תווים — מלא עם סיפורים ונתונים

הכללים:
- כתוב בעברית, בגוף ראשון רבים ("אנחנו")
- פתח בנתון או עובדה, לא בהצהרה
- אסור: מקפים, כוכביות, אימוג'י, רשימות. רק פסקאות זורמות
- אסור: "אנו שמחים", "מהפכה", "פורץ דרך", "גישה הוליסטית"
- כל מספר חייב להיות מדויק ומבוסס על המסמכים. אם אין — כתוב [להשלים]
- טון: מקצועי, בטוח, שקט. לא מתחנן

החזר JSON תקין:
{
  "identity": { "mini": "...", "standard": "...", "extended": "..." },
  "problem": { "mini": "...", "standard": "...", "extended": "..." },
  "solution": { "mini": "...", "standard": "...", "extended": "..." },
  "capacity": { "mini": "...", "standard": "...", "extended": "..." },
  "budget": { "mini": "...", "standard": "...", "extended": "..." },
  "measurement": { "mini": "...", "standard": "...", "extended": "..." }
}

identity = מי אנחנו (שם, שנת ייסוד, מטרה, תחומים, מספרים)
problem = הבעיה/הצורך שאנחנו פותרים (נתונים ארציים, פער, השפעה)
solution = מה אנחנו עושים (מודל, שיטה, תוכניות, ייחודיות, חדשנות)
capacity = למה אנחנו (ניסיון, צוות, הישגים, שותפויות, מחקר)
budget = נתונים כספיים (מחזור, מקורות, ROI חברתי, עלות למוטב)
measurement = איך מודדים (KPIs, Theory of Change, מדדי אימפקט, כלי מדידה)`, 12000);

  const parsed = parseJsonFromGemini<Record<string, { mini: string; standard: string; extended: string }>>(raw, {});

  const result: Partial<Record<OrgBlockType, OrgBlock>> = {};
  const now = new Date().toISOString();

  for (const [key, value] of Object.entries(parsed)) {
    if (value?.mini || value?.standard || value?.extended) {
      result[key as OrgBlockType] = {
        org_id: '',
        block_type: key as OrgBlockType,
        content: {
          mini: (value.mini || '').slice(0, 600),
          standard: (value.standard || '').slice(0, 1800),
          extended: (value.extended || '').slice(0, 2800),
        },
        last_updated: now,
        auto_generated: true,
      };
    }
  }

  return result;
}

// ===== 6. Format Readiness Report =====

export function formatReadinessReport(result: ReadinessResult, rfpTitle: string): string {
  const lines: string[] = [];

  lines.push(`בדיקת מוכנות להגשה: ${rfpTitle}`);
  lines.push(`ציון מוכנות: ${result.score}/100`);
  lines.push('');

  if (!result.eligible) {
    lines.push('תנאי סף שלא מתקיימים:');
    for (const issue of result.eligibility_issues) {
      lines.push(`  ${issue}`);
    }
    lines.push('');
  }

  const missingBlocks = result.blocks_ready.filter(b => !b.available);
  if (missingBlocks.length) {
    lines.push('בלוקי תוכן חסרים:');
    for (const b of missingBlocks) {
      lines.push(`  ${b.block}`);
    }
    lines.push('');
  }

  const missingDocs = result.documents_ready.filter(d => d.status !== 'valid');
  if (missingDocs.length) {
    lines.push('מסמכים חסרים או פגי תוקף:');
    for (const d of missingDocs) {
      lines.push(`  ${d.doc} — ${d.status === 'expired' ? 'פג תוקף' : 'חסר'}`);
    }
    lines.push('');
  }

  if (result.missing_answers.length) {
    lines.push(`${result.missing_answers.length} שאלות שלא ניתן לענות עליהן אוטומטית`);
    lines.push('');
  }

  if (result.estimated_completion > 0) {
    lines.push(`זמן משוער להשלמת החסר: ~${result.estimated_completion} דקות`);
  }

  return lines.join('\n');
}
