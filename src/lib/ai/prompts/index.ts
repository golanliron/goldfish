/**
 * Goldfish — Central AI Configuration
 *
 * Single source of truth for:
 * - Model IDs (change once, affects entire system)
 * - Token limits per model
 * - Prompt assembly utilities
 *
 * To upgrade a model: change the constant here, nowhere else.
 */

// ─── Model Registry ───────────────────────────────────────────────────────────

export const MODELS = {
  /** Main chat — full intelligence, streaming */
  chat: 'claude-sonnet-4-20250514',

  /** Fast scoring & classification — low cost */
  scoring: 'claude-haiku-4-5-20251001',

  /** Deep document analysis — long context */
  docAnalysis: 'gemini-2.5-pro-preview-06-05',

  /** OCR, Excel parsing — multimodal */
  ocr: 'gemini-2.5-flash-preview-05-20',

  /** RAG embeddings */
  embedding: 'text-embedding-004',

  /** Org DNA / tag resolution — fast Gemini */
  dna: 'gemini-2.5-flash',
} as const;

export type ModelKey = keyof typeof MODELS;

// ─── Token Limits ─────────────────────────────────────────────────────────────

export const TOKEN_LIMITS = {
  /** Max tokens in system prompt for chat */
  systemPrompt: 16_000,

  /** Max chars of a single document included in context */
  docChunk: 80_000,

  /** Max chars of org context block */
  orgContext: 6_000,

  /** Max chars from URL fetch (Jina reader) */
  urlFetch: 1_500,

  /** Max chars per RAG chunk */
  ragChunk: 800,

  /** Number of RAG chunks to retrieve */
  ragTopK: 12,

  /** Max opportunities to score per AI call */
  scoringBatch: 20,
} as const;

// ─── Prompt Assembler ─────────────────────────────────────────────────────────

/**
 * Builds the final system prompt by joining non-empty sections.
 * Sections are joined with double newlines.
 */
export function assembleSystemPrompt(...sections: (string | null | undefined)[]): string {
  return sections
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .join('\n\n');
}

/**
 * Truncates a string to maxChars, appending a note if truncated.
 */
export function truncateContext(text: string, maxChars: number, label = 'תוכן'): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + `\n\n[${label} קוצר ל-${maxChars} תווים]`;
}

// ─── Model Selector ───────────────────────────────────────────────────────────

/**
 * Returns the right chat model based on whether the message needs
 * full intelligence or can use the fast/cheap model.
 */
export function selectChatModel(opts: { isSimple?: boolean } = {}): string {
  return opts.isSimple ? MODELS.scoring : MODELS.chat;
}

// ─── Re-exports for convenience ───────────────────────────────────────────────
// These re-export the heavy prompt constants from fishgold.ts so callers
// can import from one place without needing to know the source file.

export {
  FISHGOLD_SYSTEM_PROMPT,
  FISHGOLD_GRANT_EXPERTISE,
  FISHGOLD_FUNDER_WRITING_DNA,
  FISHGOLD_FUNDER_QUESTIONS,
  FISHGOLD_NONPROFITS_REFERENCE,
  FISHGOLD_COMPETITIVE_INTEL,
  FISHGOLD_FUNDRAISING_INTEL,
  FISHGOLD_ENGLISH_GRANTS,
  FISHGOLD_GRANT_MASTERY,
  FISHGOLD_BUDGET_INTELLIGENCE,
  FISHGOLD_SECTOR_KNOWLEDGE,
  FISHGOLD_NONPROFITS_PART2,
  FISHGOLD_GRANTS_INTELLIGENCE,
  FISHGOLD_SALES_PROMPT,
  FISHGOLD_WELCOME,
  FISHGOLD_MICRO,
  FISHGOLD_BEHAVIOR_RULES,
  FISHGOLD_FUNDER_INTEL,
  FISHGOLD_PROPOSAL_GUIDE,
  FISHGOLD_SUBMISSION_ENGINE,
  FISHGOLD_EMAIL_MASTERY,
  FISHGOLD_INDIVIDUAL_DONORS,
  FISHGOLD_VENTURE_PHILANTHROPY,
  getRandomLoadingPhrase,
  buildContext,
  buildOrgContext,
  matchKnownOrg,
} from '@/lib/ai/fishgold';
