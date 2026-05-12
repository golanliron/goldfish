'use client';

import { useEffect, useState, useMemo, lazy, Suspense } from 'react';
import type { Opportunity, OpportunityType } from '@/types';

const TimelineTab = lazy(() => import('./TimelineTab'));

interface TaxItem {
  id: number;
  type: 'category' | 'population';
  key: string;
  label_he: string;
}

interface OpportunitiesTabProps {
  stage: number;
  orgId: string | null;
}

const TYPE_LABELS: Record<OpportunityType, string> = {
  kok: 'קול קורא',
  fund: 'קרן',
  business: 'עסקי',
  endowment: 'הקדש',
};

const TYPE_COLORS: Record<OpportunityType, string> = {
  kok: 'bg-blue-100 text-blue-700',
  fund: 'bg-green-100 text-green-700',
  business: 'bg-purple-100 text-purple-700',
  endowment: 'bg-amber-100 text-amber-700',
};

interface MatchScore {
  opportunity_id: string;
  score: number;
  reasoning: string;
}

export default function OpportunitiesTab({ stage, orgId }: OpportunitiesTabProps) {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [taxonomy, setTaxonomy] = useState<TaxItem[]>([]);
  const [matchScores, setMatchScores] = useState<Map<string, MatchScore>>(new Map());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedPopulation, setSelectedPopulation] = useState('');
  const [selectedType, setSelectedType] = useState<OpportunityType | ''>('');
  const [showOnlyMatched, setShowOnlyMatched] = useState(false);
  const [minMatchScore, setMinMatchScore] = useState<'' | '60' | '70' | '80' | '90'>('');
  const [showTimeline, setShowTimeline] = useState(false);
  const [selectedRegion, setSelectedRegion] = useState('');

  const categories = useMemo(() => taxonomy.filter(t => t.type === 'category'), [taxonomy]);
  const populations = useMemo(() => taxonomy.filter(t => t.type === 'population'), [taxonomy]);
  const matchedCount = useMemo(() => matchScores.size, [matchScores]);

  const GEO_LABELS: Record<string, string> = {
    negev: 'נגב',
    galilee: 'גליל',
    periphery: 'פריפריה',
    center: 'מרכז',
    jerusalem: 'ירושלים',
    haifa: 'חיפה',
    national: 'ארצי',
  };

  useEffect(() => {
    fetch(`/api/opportunities${orgId ? `?org_id=${orgId}` : ''}`)
      .then(r => r.json())
      .then(({ taxonomy: tax, opportunities: opps, matches: m }) => {
        if (tax) setTaxonomy(tax as TaxItem[]);
        if (opps) setOpportunities(opps as Opportunity[]);
        if (m && m.length > 0) {
          const map = new Map<string, MatchScore>();
          m.forEach((ms: MatchScore) => map.set(ms.opportunity_id, ms));
          setMatchScores(map);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    let result = opportunities;

    // Filter by match to org
    if (showOnlyMatched && matchScores.size > 0) {
      result = result.filter(o => matchScores.has(o.id));
    }

    // Filter by minimum match score
    if (minMatchScore) {
      const min = parseInt(minMatchScore);
      result = result.filter(o => {
        const score = matchScores.get(o.id)?.score || 0;
        return score >= min;
      });
    }

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(o =>
        o.title.toLowerCase().includes(q) ||
        (o.description && o.description.toLowerCase().includes(q)) ||
        (o.funder && o.funder.toLowerCase().includes(q))
      );
    }

    if (selectedCategory) {
      result = result.filter(o => o.categories?.includes(selectedCategory));
    }

    if (selectedPopulation) {
      result = result.filter(o => o.target_populations?.includes(selectedPopulation));
    }

    if (selectedType) {
      result = result.filter(o => o.type === selectedType);
    }

    if (selectedRegion) {
      result = result.filter(o => (o.regions as string[] | undefined)?.includes(selectedRegion));
    }

    // Sort by match score (highest first) when we have matches
    if (matchScores.size > 0) {
      result = [...result].sort((a, b) => {
        const scoreA = matchScores.get(a.id)?.score || 0;
        const scoreB = matchScores.get(b.id)?.score || 0;
        return scoreB - scoreA;
      });
    }

    return result;
  }, [opportunities, search, selectedCategory, selectedPopulation, selectedType, showOnlyMatched, minMatchScore, matchScores]);

  const activeFilters = [selectedCategory, selectedPopulation, minMatchScore, selectedRegion].filter(Boolean).length + (showOnlyMatched ? 1 : 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b border-border space-y-2">
        {/* Stats banner */}
        <div className="bg-accent/5 border border-accent/15 rounded-xl px-3 py-2.5">
          {/* Main stat: matched for you */}
          {matchedCount > 0 && (
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[14px] font-extrabold text-accent">{matchedCount}</span>
              <span className="text-[12px] font-bold text-accent">הגשות מותאמות לארגון שלכם</span>
            </div>
          )}
          {/* Secondary: total open */}
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2 h-2 rounded-full bg-green animate-pulse" />
            <span className="text-[11px] text-muted">
              מתוך {opportunities.length} הגשות פתוחות במאגר
            </span>
          </div>
          {matchedCount > 0 && (
            <>
              <div className="flex gap-1.5 mb-1.5">
                <button
                  onClick={() => { setShowOnlyMatched(true); setMinMatchScore(''); }}
                  className={`flex-1 text-[10px] py-1 rounded-md font-medium transition-colors ${
                    showOnlyMatched && !minMatchScore
                      ? 'bg-accent text-white'
                      : 'bg-surf2 text-muted hover:text-text'
                  }`}
                >
                  מותאמים ({matchedCount})
                </button>
                <button
                  onClick={() => { setShowOnlyMatched(false); setMinMatchScore(''); }}
                  className={`flex-1 text-[10px] py-1 rounded-md font-medium transition-colors ${
                    !showOnlyMatched && !minMatchScore
                      ? 'bg-accent text-white'
                      : 'bg-surf2 text-muted hover:text-text'
                  }`}
                >
                  כל ההגשות ({opportunities.length})
                </button>
              </div>
              {/* Quick match % filter */}
              <div className="flex gap-1">
                {(['60', '70', '80'] as const).map(pct => {
                  const count = opportunities.filter(o => (matchScores.get(o.id)?.score || 0) >= parseInt(pct)).length;
                  if (count === 0) return null;
                  return (
                    <button
                      key={pct}
                      onClick={() => {
                        if (minMatchScore === pct) {
                          setMinMatchScore('');
                          setShowOnlyMatched(false);
                        } else {
                          setMinMatchScore(pct as typeof minMatchScore);
                          setShowOnlyMatched(false);
                        }
                      }}
                      className={`flex-1 text-[9px] py-1 rounded-md font-medium transition-colors ${
                        minMatchScore === pct
                          ? 'bg-green-600 text-white'
                          : 'bg-surf2 text-muted hover:text-text border border-border/50'
                      }`}
                    >
                      {pct}%+ ({count})
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Search + Calendar toggle */}
        <div className="flex gap-1.5">
          <div className="relative flex-1">
            <svg className="absolute right-3 top-1/2 -translate-y-1/2 text-muted" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder="חיפוש הגשה, קרן, מממן..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pr-9 pl-3 py-2 text-xs bg-surf2 border border-border rounded-lg focus:border-accent focus:outline-none transition-colors"
            />
          </div>
          <button
            onClick={() => setShowTimeline(!showTimeline)}
            title="לוח זמנים"
            className={`flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-lg border transition-colors ${
              showTimeline ? 'bg-accent text-white border-accent' : 'bg-surf2 text-muted border-border hover:text-text'
            }`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </button>
        </div>

        {/* Filter toggle */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-1 text-[11px] px-2 py-1 rounded-md transition-colors ${
              showFilters || activeFilters > 0
                ? 'bg-accent/10 text-accent font-medium'
                : 'text-muted hover:text-text'
            }`}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="4" y1="6" x2="20" y2="6" />
              <line x1="8" y1="12" x2="16" y2="12" />
              <line x1="11" y1="18" x2="13" y2="18" />
            </svg>
            סינון
            {activeFilters > 0 && (
              <span className="bg-accent text-white text-[9px] w-4 h-4 rounded-full flex items-center justify-center">
                {activeFilters}
              </span>
            )}
          </button>
          <span className="text-[10px] text-muted">
            {filtered.length} מתוך {opportunities.length}
            {matchedCount > 0 && !showOnlyMatched && ` (${matchedCount} מתאימים)`}
          </span>
        </div>

        {/* Filter dropdowns */}
        {showFilters && (
          <div className="space-y-1.5 pt-1">
            <select
              value={selectedCategory}
              onChange={e => setSelectedCategory(e.target.value)}
              className="w-full text-[11px] px-2 py-1.5 bg-surf2 border border-border rounded-md focus:border-accent focus:outline-none"
            >
              <option value="">כל הקטגוריות</option>
              {categories.map(c => (
                <option key={c.key} value={c.key}>{c.label_he}</option>
              ))}
            </select>

            <select
              value={selectedPopulation}
              onChange={e => setSelectedPopulation(e.target.value)}
              className="w-full text-[11px] px-2 py-1.5 bg-surf2 border border-border rounded-md focus:border-accent focus:outline-none"
            >
              <option value="">כל אוכלוסיות היעד</option>
              {populations.map(p => (
                <option key={p.key} value={p.key}>{p.label_he}</option>
              ))}
            </select>

            {matchScores.size > 0 && (
              <select
                value={minMatchScore}
                onChange={e => setMinMatchScore(e.target.value as '' | '60' | '70' | '80' | '90')}
                className="w-full text-[11px] px-2 py-1.5 bg-surf2 border border-accent/20 rounded-md focus:border-accent focus:outline-none"
              >
                <option value="">כל רמות ההתאמה</option>
                <option value="60">60%+ התאמה לארגון</option>
                <option value="70">70%+ התאמה גבוהה</option>
                <option value="80">80%+ התאמה מעולה</option>
                <option value="90">90%+ התאמה מושלמת</option>
              </select>
            )}

            {/* Region filter */}
            <div>
              <div className="text-[10px] text-muted mb-1">אזור גאוגרפי</div>
              <div className="flex flex-wrap gap-1">
                {Object.entries(GEO_LABELS).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setSelectedRegion(selectedRegion === key ? '' : key)}
                    className={`text-[9px] px-1.5 py-0.5 rounded-md font-medium transition-colors ${
                      selectedRegion === key ? 'bg-accent text-white' : 'bg-surf2 text-muted hover:text-text'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {activeFilters > 0 && (
              <button
                onClick={() => {
                  setSelectedCategory('');
                  setSelectedPopulation('');
                  setMinMatchScore('');
                  setSelectedRegion('');
                }}
                className="text-[10px] text-accent hover:underline"
              >
                נקה סינון
              </button>
            )}
          </div>
        )}
      </div>

      {/* Timeline view (inline) */}
      {showTimeline && (
        <div className="border-b border-border">
          <Suspense fallback={<div className="flex items-center justify-center py-8"><div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" /></div>}>
            <div className="p-4">
              <TimelineTab stage={stage as 0 | 1 | 2} orgId={orgId} />
            </div>
          </Suspense>
        </div>
      )}

      {/* Opportunities list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
        {filtered.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm text-muted">לא נמצאו תוצאות</p>
            <p className="text-xs text-muted2 mt-1">נסו לשנות את החיפוש או הסינון</p>
          </div>
        ) : (
          filtered.map(opp => <OpportunityCard key={opp.id} opp={opp} match={matchScores.get(opp.id)} orgId={orgId} />)
        )}
      </div>
    </div>
  );
}

function buildShareText(opp: Opportunity): string {
  const parts = [`*${opp.title}*`];
  if (opp.funder) parts.push(`מממן: ${opp.funder}`);
  if (opp.amount_max) parts.push(`סכום: עד ${formatAmount(opp.amount_max)} ש"ח`);
  if (opp.deadline) {
    const d = new Date(opp.deadline);
    parts.push(`דדליין: ${d.toLocaleDateString('he-IL')}`);
  }
  if (opp.description) parts.push(`\n${opp.description.slice(0, 200)}${opp.description.length > 200 ? '...' : ''}`);
  if (opp.url) parts.push(`\nקישור: ${opp.url}`);
  parts.push('\n-- נשלח מ-Goldfish');
  return parts.join('\n');
}

interface FitAnalysis {
  score: number;
  verdict: string;
  verdict_reason: string;
  strengths: string[];
  gaps: string[];
  tips: string[];
}

function FitAnalysisCard({ analysis, onProceed, onCancel }: { analysis: FitAnalysis; onProceed: () => void; onCancel: () => void }) {
  const scoreColor = analysis.score >= 8 ? 'text-green-600' : analysis.score >= 5 ? 'text-amber-600' : 'text-red-500';
  const scoreBg = analysis.score >= 8 ? 'bg-green-50 border-green-200' : analysis.score >= 5 ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200';

  return (
    <div className={`rounded-xl border p-4 mt-3 text-sm space-y-3 ${scoreBg}`}>
      <div className="flex items-center justify-between">
        <div className="font-semibold text-gray-700">ניתוח התאמה לקול הקורא</div>
        <div className={`text-2xl font-bold ${scoreColor}`}>{analysis.score}/10</div>
      </div>
      <div className={`font-medium ${scoreColor}`}>{analysis.verdict} — {analysis.verdict_reason}</div>

      {analysis.strengths.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-gray-500 mb-1">חוזקות</div>
          <ul className="space-y-0.5">
            {analysis.strengths.map((s, i) => (
              <li key={i} className="flex gap-1.5 text-gray-700"><span className="text-green-500 mt-0.5">✓</span>{s}</li>
            ))}
          </ul>
        </div>
      )}

      {analysis.gaps.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-gray-500 mb-1">פערים</div>
          <ul className="space-y-0.5">
            {analysis.gaps.map((g, i) => (
              <li key={i} className="flex gap-1.5 text-gray-700"><span className="text-amber-500 mt-0.5">!</span>{g}</li>
            ))}
          </ul>
        </div>
      )}

      {analysis.tips.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-gray-500 mb-1">טיפים לכתיבה</div>
          <ul className="space-y-0.5">
            {analysis.tips.map((t, i) => (
              <li key={i} className="flex gap-1.5 text-gray-700"><span className="text-blue-400 mt-0.5">→</span>{t}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <button
          onClick={onProceed}
          className="flex-1 bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold py-2 rounded-lg transition-colors"
        >
          כתוב טיוטה
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-2 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg transition-colors"
        >
          ביטול
        </button>
      </div>
    </div>
  );
}

function OpportunityCard({ opp, match, orgId }: { opp: Opportunity; match?: MatchScore; orgId?: string | null }) {
  const [expanded, setExpanded] = useState(false);
  const [draftState, setDraftState] = useState<'idle' | 'parsing' | 'analyzing' | 'fit_review' | 'generating' | 'done' | 'error'>('idle');
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [fitAnalysis, setFitAnalysis] = useState<FitAnalysis | null>(null);
  const [pendingRfpId, setPendingRfpId] = useState<string | null>(null);

  const handlePrepareDraft = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!orgId) return;
    setDraftState('parsing');
    setDraftError(null);
    setShareUrl(null);
    setFitAnalysis(null);

    try {
      // Step 1: Parse the RFP
      const rfpRes = await fetch('/api/rfp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          org_id: orgId,
          url: opp.url || null,
          text: !opp.url ? [opp.title, opp.description, opp.eligibility, opp.how_to_apply].filter(Boolean).join('\n') : null,
          opportunity_id: opp.id,
        }),
      });
      const rfpData = await rfpRes.json();
      if (!rfpRes.ok || !rfpData.rfp_id) throw new Error(rfpData.error || 'שגיאה בניתוח קול הקורא');

      // Step 2: Analyze fit
      setDraftState('analyzing');
      const analyzeRes = await fetch('/api/submissions/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: orgId, rfp_id: rfpData.rfp_id }),
      });
      const analyzeData = await analyzeRes.json();

      if (analyzeRes.ok && analyzeData.analysis) {
        setPendingRfpId(rfpData.rfp_id);
        setFitAnalysis(analyzeData.analysis);
        setDraftState('fit_review');
        return; // Wait for user confirmation
      }

      // If analysis fails, proceed directly
      await generateDraft(orgId, rfpData.rfp_id);
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : 'שגיאה לא צפויה');
      setDraftState('error');
    }
  };

  const generateDraft = async (orgIdParam: string, rfpIdParam: string) => {
    setDraftState('generating');
    try {
      const subRes = await fetch('/api/submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: orgIdParam, rfp_id: rfpIdParam, opportunity_id: opp.id }),
      });
      const subData = await subRes.json();
      if (!subRes.ok || !subData.share_url) throw new Error(subData.error || 'שגיאה ביצירת הטיוטה');
      setShareUrl(subData.share_url);
      setDraftState('done');
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : 'שגיאה לא צפויה');
      setDraftState('error');
    }
  };

  const handleProceedFromAnalysis = () => {
    if (!orgId || !pendingRfpId) return;
    setFitAnalysis(null);
    generateDraft(orgId, pendingRfpId);
  };

  const handleCancelAnalysis = () => {
    setFitAnalysis(null);
    setPendingRfpId(null);
    setDraftState('idle');
  };

  const daysLeft = opp.deadline
    ? Math.ceil((new Date(opp.deadline).getTime() - Date.now()) / 86400000)
    : null;

  const deadlineColor =
    daysLeft !== null && daysLeft <= 0 ? 'text-red-500' :
    daysLeft !== null && daysLeft <= 7 ? 'text-red-500 font-semibold' :
    daysLeft !== null && daysLeft <= 14 ? 'text-amber-500 font-semibold' :
    'text-muted';

  const deadlineText =
    daysLeft !== null
      ? daysLeft <= 0
        ? 'פג תוקף'
        : `${daysLeft} ימים`
      : null;

  const matchColor = match
    ? match.score >= 80 ? 'bg-green-100 text-green-700 border-green-200'
    : match.score >= 60 ? 'bg-amber-100 text-amber-700 border-amber-200'
    : 'bg-gray-100 text-gray-600 border-gray-200'
    : '';

  const handleWriteSubmission = (e: React.MouseEvent) => {
    e.stopPropagation();
    const parts = [`תכתוב טיוטת הגשה לקול הקורא: "${opp.title}"`];
    if (opp.funder) parts.push(`מממן: ${opp.funder}`);
    if (opp.deadline) parts.push(`דדליין: ${new Date(opp.deadline).toLocaleDateString('he-IL')}`);
    if (opp.url) parts.push(`\nקישור לקול הקורא: ${opp.url}\nתקרא את הקול הקורא בלינק, תבין מה הם מבקשים, ותכתוב הצעה שעונה בדיוק על הדרישות שלהם.`);
    if (opp.description) parts.push(`\nתיאור: ${opp.description.slice(0, 800)}`);
    if (opp.eligibility) parts.push(`תנאי סף: ${opp.eligibility}`);
    if (opp.how_to_apply) parts.push(`אופן הגשה: ${opp.how_to_apply}`);
    const detail = parts.join('\n');
    // Close sidebar first (mobile), then send after ChatPanel mounts
    window.dispatchEvent(new CustomEvent('fishgold:closeSidebar'));
    setTimeout(() => window.dispatchEvent(new CustomEvent('fishgold:send', { detail })), 50);
  };

  return (
    <div
      className={`bg-surf rounded-xl border p-3 hover:border-accent/30 transition-colors cursor-pointer ${match && match.score >= 80 ? 'border-green-200' : 'border-border'}`}
      onClick={() => setExpanded(!expanded)}
    >
      {/* Match score badge */}
      {match && (
        <div className={`flex items-center gap-1.5 mb-2 px-2.5 py-1.5 rounded-lg border text-[10px] ${matchColor}`}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="flex-shrink-0">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
          <span className="font-bold">{match.score}% התאמה לארגון שלכם</span>
        </div>
      )}

      {/* Top row: title + type badge */}
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <h4 className="text-[13px] font-semibold leading-snug flex-1 min-w-0 line-clamp-2">
          {opp.title}
        </h4>
        {opp.type && (
          <span className={`flex-shrink-0 text-[9px] px-1.5 py-0.5 rounded-full font-medium ${TYPE_COLORS[opp.type]}`}>
            {TYPE_LABELS[opp.type]}
          </span>
        )}
      </div>

      {/* Funder */}
      {opp.funder && (
        <p className="text-[11px] text-muted mb-1.5">{opp.funder}</p>
      )}

      {/* Meta row: amount + deadline */}
      <div className="flex items-center gap-3 text-[10px] mb-2">
        {(opp.amount_min || opp.amount_max) && (
          <span className="text-green-600 font-medium">
            {opp.amount_min && opp.amount_max
              ? `${formatAmount(opp.amount_min)} - ${formatAmount(opp.amount_max)}`
              : opp.amount_max
                ? `עד ${formatAmount(opp.amount_max)}`
                : `מ-${formatAmount(opp.amount_min!)}`
            }
          </span>
        )}
        {deadlineText && (
          <span className={deadlineColor}>{deadlineText}</span>
        )}
        {opp.deadline && (
          <span className="text-muted">
            {new Date(opp.deadline).toLocaleDateString('he-IL', { day: 'numeric', month: 'short' })}
          </span>
        )}
      </div>

      {/* Link to original — direct URL or Google search fallback */}
      <a
        href={opp.url || `https://www.google.com/search?q=${encodeURIComponent(opp.title + (opp.funder ? ' ' + opp.funder : '') + ' הגשה')}`}
        target="_blank"
        rel="noopener noreferrer"
        onClick={e => e.stopPropagation()}
        className={`inline-flex items-center gap-1 text-[10px] mb-2 ${opp.url ? 'text-accent hover:underline' : 'text-muted hover:text-accent hover:underline'}`}
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
          <polyline points="15 3 21 3 21 9" />
          <line x1="10" y1="14" x2="21" y2="3" />
        </svg>
        {opp.url ? 'לינק להגשה' : 'חפש הגשה'}
      </a>

      {/* Category tags */}
      {opp.categories && opp.categories.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {opp.categories.slice(0, 3).map(cat => (
            <span key={cat} className="text-[9px] px-1.5 py-0.5 bg-surf2 text-muted rounded-md">
              {cat}
            </span>
          ))}
          {opp.categories.length > 3 && (
            <span className="text-[9px] text-muted">+{opp.categories.length - 3}</span>
          )}
        </div>
      )}

      {/* Expanded details */}
      {expanded && (
        <div className="mt-2 pt-2 border-t border-border space-y-2 text-[11px]">
          {opp.description && (
            <p className="text-text2 leading-relaxed">{opp.description}</p>
          )}
          {opp.eligibility && (
            <div>
              <span className="font-medium text-text">תנאי סף: </span>
              <span className="text-text2">{opp.eligibility}</span>
            </div>
          )}
          {opp.how_to_apply && (
            <div>
              <span className="font-medium text-text">אופן הגשה: </span>
              <span className="text-text2">{opp.how_to_apply}</span>
            </div>
          )}
          {opp.contact_info && (
            <div>
              <span className="font-medium text-text">איש קשר: </span>
              <span className="text-text2">{opp.contact_info}</span>
            </div>
          )}
          {opp.target_populations && opp.target_populations.length > 0 && (
            <div className="flex flex-wrap gap-1">
              <span className="font-medium text-text ml-1">אוכלוסיות:</span>
              {opp.target_populations.map(pop => (
                <span key={pop} className="text-[9px] px-1.5 py-0.5 bg-accent/10 text-accent rounded-md">
                  {pop}
                </span>
              ))}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-1.5 pt-1">
            <button
              onClick={handleWriteSubmission}
              className="flex-1 py-1.5 text-[10px] font-medium bg-accent text-white rounded-lg hover:opacity-90 transition-opacity"
            >
              כתוב הגשה
            </button>
            <a
              href={opp.url || `https://www.google.com/search?q=${encodeURIComponent(opp.title + (opp.funder ? ' ' + opp.funder : '') + ' הגשה קול קורא')}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className="flex-1 py-1.5 text-[10px] font-medium text-center border border-border rounded-lg hover:bg-surf2 transition-colors"
            >
              {opp.url ? 'פתח הגשה' : 'חפש הגשה בגוגל'}
            </a>
          </div>

          {/* Prepare draft submission button */}
          {orgId && (
            <div className="pt-1">
              {draftState === 'idle' && (
                <button
                  onClick={handlePrepareDraft}
                  className="w-full py-2 text-[10px] font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center gap-1.5"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
                  </svg>
                  הכן טיוטת הגשה אוטומטית
                </button>
              )}
              {(draftState === 'parsing' || draftState === 'analyzing' || draftState === 'generating') && (
                <div className="w-full py-2 text-[10px] font-medium bg-blue-50 text-blue-600 rounded-lg flex items-center justify-center gap-1.5">
                  <div className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                  {draftState === 'parsing' ? 'קורא את קול הקורא...' : draftState === 'analyzing' ? 'מנתח התאמה...' : 'כותב טיוטת הגשה...'}
                </div>
              )}
              {draftState === 'fit_review' && fitAnalysis && (
                <FitAnalysisCard
                  analysis={fitAnalysis}
                  onProceed={handleProceedFromAnalysis}
                  onCancel={handleCancelAnalysis}
                />
              )}
              {draftState === 'done' && shareUrl && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-2.5 space-y-1.5">
                  <div className="text-[10px] font-semibold text-green-700">הטיוטה מוכנה!</div>
                  <a
                    href={shareUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    className="flex items-center gap-1 text-[10px] text-blue-600 hover:underline font-medium"
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                      <polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                    פתח דף עריכה שיתופי
                  </a>
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      const url = window.location.origin + shareUrl.replace(window.location.origin, '');
                      navigator.clipboard.writeText(url);
                    }}
                    className="flex items-center gap-1 text-[10px] text-muted hover:text-text"
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                    </svg>
                    העתק לינק
                  </button>
                  <button
                    onClick={e => { e.stopPropagation(); setDraftState('idle'); setShareUrl(null); }}
                    className="text-[9px] text-muted hover:underline"
                  >
                    הכן טיוטה חדשה
                  </button>
                </div>
              )}
              {draftState === 'error' && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-2 space-y-1">
                  <div className="text-[10px] text-red-600">{draftError}</div>
                  <button
                    onClick={e => { e.stopPropagation(); setDraftState('idle'); }}
                    className="text-[9px] text-accent hover:underline"
                  >
                    נסה שוב
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Share row */}
          <div className="flex gap-1.5 pt-1">
            <a
              href={`mailto:?subject=${encodeURIComponent(opp.title)}&body=${encodeURIComponent(buildShareText(opp))}`}
              onClick={e => e.stopPropagation()}
              className="flex-1 py-1.5 text-[10px] font-medium text-center border border-border rounded-lg hover:bg-surf2 transition-colors flex items-center justify-center gap-1"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                <polyline points="22,6 12,13 2,6" />
              </svg>
              שלח במייל
            </a>
            <a
              href={`https://wa.me/?text=${encodeURIComponent(buildShareText(opp))}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className="flex-1 py-1.5 text-[10px] font-medium text-center border border-green-300 text-green-700 rounded-lg hover:bg-green-50 transition-colors flex items-center justify-center gap-1"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
              </svg>
              שלח בוואטסאפ
            </a>
          </div>

        </div>
      )}
    </div>
  );
}

function formatAmount(amount: number): string {
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(0)}K`;
  return amount.toLocaleString('he-IL');
}
