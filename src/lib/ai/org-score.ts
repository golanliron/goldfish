// Goldfish Org Knowledge Score
// Measures how well Goldfish *actually knows* the org — based on real extracted facts, not form fields.

import type { OrgScore, OrgScoreBreakdown, OrgScoreCategory } from '@/types';
export type { OrgScore, OrgScoreBreakdown, OrgScoreCategory };

interface MemoryItem {
  category: string | null;
  depth: number | null;
  updated_at: string;
}

const CATEGORY_CONFIG: Record<OrgScoreCategory, {
  label: string;
  weight: number;
  cap: number; // max facts that contribute to score
  cta: string;
}> = {
  identity:    { label: 'זהות',           weight: 0.10, cap: 5,  cta: 'הוסיפי פרטי זהות בסיסיים — שם, מספר עמותה, שנת הקמה' },
  dna:         { label: 'DNA',            weight: 0.25, cap: 10, cta: 'ספרי לי על האוכלוסיות שאת משרתת ועל גישת העבודה שלכם' },
  impact:      { label: 'אימפקט',         weight: 0.20, cap: 8,  cta: 'שתפי נתוני תוצאות — כמה נהנו מהשירות ומה הושג' },
  operations:  { label: 'ביצוע',          weight: 0.15, cap: 6,  cta: 'הוסיפי מידע על תקציב, עובדים ופרויקטים פעילים' },
  submissions: { label: 'הגשות קודמות',   weight: 0.30, cap: 8,  cta: 'העלי הגשה קודמת — Goldfish ילמד את הסגנון שלכם' },
};

function categoryScore(facts: number[], now: Date): number {
  if (facts.length === 0) return 0;
  // average effective depth (0-3), normalized to 0-100
  const avgDepth = facts.reduce((a, b) => a + b, 0) / facts.length;
  return Math.round((avgDepth / 3) * 100);
}

function getStatus(score: number): 'full' | 'partial' | 'missing' {
  if (score >= 75) return 'full';
  if (score >= 25) return 'partial';
  return 'missing';
}

export function calculateOrgScore(memories: MemoryItem[]): OrgScore {
  const now = new Date();

  // Bucket effective depths per category
  const buckets: Record<OrgScoreCategory, number[]> = {
    identity: [], dna: [], impact: [], operations: [], submissions: [],
  };

  for (const m of memories) {
    const cat = m.category as OrgScoreCategory;
    if (!cat || !CATEGORY_CONFIG[cat]) continue;

    const rawDepth = m.depth ?? 1;
    const ageYears = (now.getTime() - new Date(m.updated_at).getTime()) / (365 * 24 * 60 * 60 * 1000);
    const effectiveDepth = ageYears > 1 ? Math.max(1, rawDepth - 1) : rawDepth;

    const { cap } = CATEGORY_CONFIG[cat];
    if (buckets[cat].length < cap) {
      buckets[cat].push(effectiveDepth);
    }
  }

  // Build breakdown
  const breakdown: OrgScoreBreakdown[] = (Object.keys(CATEGORY_CONFIG) as OrgScoreCategory[]).map((cat) => {
    const score = categoryScore(buckets[cat], now);
    const status = getStatus(score);
    return {
      category: cat,
      label: CATEGORY_CONFIG[cat].label,
      score,
      status,
      cta: status !== 'full' ? CATEGORY_CONFIG[cat].cta : null,
    };
  });

  // Weighted total
  const total = Math.round(
    breakdown.reduce((sum, b) => sum + b.score * CATEGORY_CONFIG[b.category].weight, 0)
  );

  return { total, breakdown };
}
