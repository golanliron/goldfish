'use client';

import { useEffect, useState, useMemo, useRef, lazy, Suspense } from 'react';
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

interface PillarScores {
  eligibility: number;
  mission_alignment: number;
  geography: number;
  capacity: number;
  total: number;
  reasoning: string;
}

interface MatchScore {
  opportunity_id: string;
  score: number;
  reasoning: string;
  pillars?: PillarScores;
}

interface FunderInfoMap {
  [funderName: string]: {
    style?: string;
    approval_rate?: number;
    typical_amount_min?: number;
    typical_amount_max?: number;
    writing_tips?: string;
  };
}

interface UpcomingRecurrence {
  funder_name: string;
  last_title: string;
  expected_month: number;
}

interface ReadinessData {
  score: number;
  factors: { label: string; met: boolean; weight: number }[];
  missingDocs: string[];
  timeWarning?: string;
}

interface HotOpportunity {
  id: string;
  source_type: string;
  source_name: string;
  source_url: string | null;
  title: string;
  description: string;
  pain_point: string;
  strategic_insight: string;
  amount_hint: string | null;
  deadline_hint: string | null;
  discovered_at: string;
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
  const [profileCompleteness, setProfileCompleteness] = useState<number | null>(null);
  const [funderInfo, setFunderInfo] = useState<FunderInfoMap>({});
  const [upcomingRecurrences, setUpcomingRecurrences] = useState<UpcomingRecurrence[]>([]);
  const [hotOpportunities, setHotOpportunities] = useState<HotOpportunity[]>([]);
  const [expandedHotOpp, setExpandedHotOpp] = useState<string | null>(null);
  const [agentRunning, setAgentRunning] = useState(false);
  const [agentToast, setAgentToast] = useState<{ type: 'info' | 'success' | 'error'; text: string } | null>(null);
  const agentPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const categories = useMemo(() => taxonomy.filter(t => t.type === 'category'), [taxonomy]);
  const populations = useMemo(() => taxonomy.filter(t => t.type === 'population'), [taxonomy]);
  // matchedCount = opportunities with score >= 60 (the "relevant" threshold)
  const matchedCount = useMemo(
    () => opportunities.filter(o => (matchScores.get(o.id)?.score ?? 0) >= 60).length,
    [opportunities, matchScores]
  );
  // Per-bucket counts (exclusive ranges)
  const bucketCount = useMemo(() => ({
    '80': opportunities.filter(o => (matchScores.get(o.id)?.score ?? 0) >= 80).length,
    '70': opportunities.filter(o => { const s = matchScores.get(o.id)?.score ?? 0; return s >= 70 && s < 80; }).length,
    '60': opportunities.filter(o => { const s = matchScores.get(o.id)?.score ?? 0; return s >= 60 && s < 70; }).length,
  }), [opportunities, matchScores]);

  const GEO_LABELS: Record<string, string> = {
    negev: 'נגב',
    galilee: 'גליל',
    periphery: 'פריפריה',
    center: 'מרכז',
    jerusalem: 'ירושלים',
    haifa: 'חיפה',
    national: 'ארצי',
  };

  const loadOpportunities = () => {
    fetch(`/api/opportunities${orgId ? `?org_id=${orgId}` : ''}`)
      .then(r => r.json())
      .then((data) => {
        const { taxonomy: tax, opportunities: opps, matches: m, profileCompleteness: pc, funderInfo: fi, upcomingRecurrences: ur } = data;
        if (tax) setTaxonomy(tax as TaxItem[]);
        if (opps) setOpportunities(opps as Opportunity[]);
        if (m && m.length > 0) {
          const map = new Map<string, MatchScore>();
          m.forEach((ms: MatchScore) => map.set(ms.opportunity_id, ms));
          setMatchScores(map);
        }
        if (typeof pc === 'number') setProfileCompleteness(pc);
        if (fi) setFunderInfo(fi as FunderInfoMap);
        if (ur && Array.isArray(ur)) setUpcomingRecurrences(ur as UpcomingRecurrence[]);
        if (data.hotOpportunities && Array.isArray(data.hotOpportunities)) setHotOpportunities(data.hotOpportunities as HotOpportunity[]);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    loadOpportunities();
    return () => {
      if (agentPollRef.current) clearInterval(agentPollRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAgentSync = async () => {
    if (!orgId || agentRunning) return;
    setAgentRunning(true);
    setAgentToast({ type: 'info', text: 'הסוכן יצא לסרוק. העמוד יתעדכן כשיסיים...' });

    try {
      // Enqueue — returns immediately with job_id
      const res = await fetch('/api/jobs/enqueue', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'scan_opportunities', payload: { mode: 'existing' } }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'שגיאה בהפעלת הסוכן');

      const { job_id } = data;

      // Poll /api/jobs/:id every 4 seconds until done or failed
      let elapsed = 0;
      agentPollRef.current = setInterval(async () => {
        elapsed += 4;
        try {
          const statusRes = await fetch(`/api/jobs/${job_id}`, { credentials: 'include' });
          const statusData = await statusRes.json();

          if (statusData.status === 'done') {
            clearInterval(agentPollRef.current!);
            agentPollRef.current = null;
            const { processed = 0, high = 0, medium = 0 } = statusData.result?.matches != null
              ? { processed: statusData.result.matches, high: 0, medium: 0 }
              : statusData.result || {};
            setAgentToast({
              type: 'success',
              text: `הסוכן סיים! עובדו ${processed} הגשות — ${high} גבוהות, ${medium} בינוניות`,
            });
            loadOpportunities();
            setAgentRunning(false);
            setTimeout(() => setAgentToast(null), 6000);

          } else if (statusData.status === 'failed') {
            clearInterval(agentPollRef.current!);
            agentPollRef.current = null;
            setAgentToast({ type: 'error', text: statusData.error || 'הסוכן נכשל' });
            setAgentRunning(false);
            setTimeout(() => setAgentToast(null), 6000);

          } else if (elapsed >= 180) {
            // 3 minute timeout — stop polling, leave job running in background
            clearInterval(agentPollRef.current!);
            agentPollRef.current = null;
            setAgentToast({ type: 'info', text: 'הסוכן עדיין עובד ברקע. ההגשות יתעדכנו בקרוב.' });
            setAgentRunning(false);
            setTimeout(() => setAgentToast(null), 8000);
          }
        } catch {
          // network hiccup — keep polling
        }
      }, 4000);

    } catch (err) {
      setAgentToast({ type: 'error', text: err instanceof Error ? err.message : 'שגיאה לא צפויה' });
      setAgentRunning(false);
      setTimeout(() => setAgentToast(null), 6000);
    }
  };

  const filtered = useMemo(() => {
    let result = opportunities;

    // Filter by match to org (≥60 = "relevant")
    if (showOnlyMatched && matchScores.size > 0) {
      result = result.filter(o => (matchScores.get(o.id)?.score ?? 0) >= 60);
    }

    // Filter by exclusive bucket (e.g. "70%" = 70–79, "80%" = ≥80)
    if (minMatchScore) {
      const min = parseInt(minMatchScore);
      const max = min === 80 ? Infinity : min + 10;
      result = result.filter(o => {
        const score = matchScores.get(o.id)?.score ?? 0;
        return score >= min && score < max;
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
      {/* Agent Toast */}
      {agentToast && (
        <div className={`mx-3 mt-2 px-3 py-2 rounded-xl text-[11px] font-medium flex items-start gap-2 border transition-all ${
          agentToast.type === 'info'    ? 'bg-blue-50 border-blue-200 text-blue-800' :
          agentToast.type === 'success' ? 'bg-green-50 border-green-200 text-green-800' :
                                          'bg-red-50 border-red-200 text-red-700'
        }`}>
          {agentToast.type === 'info' && (
            <div className="w-3.5 h-3.5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin flex-shrink-0 mt-0.5" />
          )}
          {agentToast.type === 'success' && <span className="flex-shrink-0">✓</span>}
          {agentToast.type === 'error'   && <span className="flex-shrink-0">!</span>}
          {agentToast.text}
        </div>
      )}

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
          {/* Secondary: summary text + sync button */}
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green animate-pulse flex-shrink-0" />
              <span className="text-[11px] text-muted leading-tight">
                {matchedCount > 0
                  ? `מצאנו ${matchedCount} קולות קוראים מותאמים מתוך ${opportunities.length} פתוחות במאגר`
                  : `${opportunities.length} הגשות פתוחות במאגר`}
              </span>
            </div>
            {orgId && (
              <button
                onClick={handleAgentSync}
                disabled={agentRunning}
                title="סנכרון והעשרת הגשות"
                className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg border font-medium transition-colors flex-shrink-0 ${
                  agentRunning
                    ? 'bg-surf2 text-muted border-border cursor-not-allowed'
                    : 'bg-surf2 text-muted border-border hover:border-accent/40 hover:text-accent'
                }`}
              >
                {agentRunning ? (
                  <div className="w-3 h-3 border-2 border-muted border-t-transparent rounded-full animate-spin" />
                ) : (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 3v3M12 18v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M3 12h3M18 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12" />
                  </svg>
                )}
                {agentRunning ? 'מנתח...' : 'סנכרון והעשרה'}
              </button>
            )}
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
              {/* Quick match % filter — exclusive buckets */}
              <div className="flex gap-1">
                {(['80', '70', '60'] as const).map(pct => {
                  const count = bucketCount[pct];
                  const isActive = minMatchScore === pct;
                  return (
                    <button
                      key={pct}
                      onClick={() => {
                        if (isActive) {
                          setMinMatchScore('');
                          setShowOnlyMatched(true);
                        } else {
                          setMinMatchScore(pct as typeof minMatchScore);
                          setShowOnlyMatched(false);
                        }
                      }}
                      className={`flex-1 text-[9px] py-1 rounded-md font-medium transition-colors ${
                        isActive
                          ? 'bg-green-600 text-white'
                          : count === 0
                          ? 'bg-surf2 text-muted/40 border border-border/30 cursor-default'
                          : 'bg-surf2 text-muted hover:text-text border border-border/50'
                      }`}
                      disabled={count === 0}
                    >
                      +{pct}% ({count})
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Profile completeness hint */}
        {profileCompleteness !== null && profileCompleteness < 60 && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-start gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2" className="flex-shrink-0 mt-0.5">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <div>
              <div className="text-[11px] font-medium text-amber-800">
                הפרופיל שלכם {profileCompleteness}% שלם
              </div>
              <div className="text-[10px] text-amber-600 mt-0.5">
                העלו עוד מסמכים בלשונית הארגון כדי לקבל התאמות מדויקות יותר
              </div>
            </div>
          </div>
        )}

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

      {/* Upcoming recurrences banner */}
      {upcomingRecurrences.length > 0 && (
        <div className="mx-3 mt-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
          <div className="text-[11px] font-medium text-blue-800 mb-1">צפי קולות קוראים קרובים</div>
          {upcomingRecurrences.slice(0, 3).map((r, i) => (
            <div key={i} className="text-[10px] text-blue-600 flex items-center gap-1.5">
              <span>•</span>
              <span className="font-medium">{r.funder_name}</span>
              <span className="text-blue-400">— צפוי להיפתח בחודש {r.expected_month}</span>
            </div>
          ))}
        </div>
      )}

      {/* Opportunities list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5">

        {/* HOT OPPORTUNITIES — from the field */}
        {hotOpportunities.length > 0 && (
          <div className="mb-3">
            <div className="flex items-center gap-2 mb-2 px-0.5">
              <span className="text-[10px] font-bold text-orange-600 uppercase tracking-wide">הזדמנות חמה מהשטח</span>
              <span className="bg-orange-100 text-orange-700 text-[9px] font-bold px-1.5 py-0.5 rounded-full">{hotOpportunities.length}</span>
              <div className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" />
            </div>
            <div className="space-y-2">
              {hotOpportunities.map(hot => (
                <div
                  key={hot.id}
                  className="bg-orange-50 border border-orange-200 rounded-xl p-3 cursor-pointer hover:border-orange-400 transition-colors"
                  onClick={() => setExpandedHotOpp(expandedHotOpp === hot.id ? null : hot.id)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="text-[9px] font-medium text-orange-600 bg-orange-100 px-1.5 py-0.5 rounded-full capitalize">
                          {hot.source_type === 'linkedin' ? 'LinkedIn' :
                           hot.source_type === 'news' ? 'חדשות' :
                           hot.source_type === 'newsletter' ? 'ניוזלטר' :
                           hot.source_type === 'twitter' ? 'X/Twitter' : hot.source_type}
                        </span>
                        {hot.amount_hint && (
                          <span className="text-[9px] text-green-700 bg-green-100 px-1.5 py-0.5 rounded-full">{hot.amount_hint}</span>
                        )}
                        {hot.deadline_hint && (
                          <span className="text-[9px] text-red-700 bg-red-100 px-1.5 py-0.5 rounded-full">{hot.deadline_hint}</span>
                        )}
                      </div>
                      <p className="text-[12px] font-semibold text-gray-800 leading-snug line-clamp-2">{hot.title}</p>
                      <p className="text-[10px] text-gray-500 mt-0.5">{hot.source_name}</p>
                    </div>
                    <svg
                      width="14" height="14"
                      className={`flex-shrink-0 text-orange-400 transition-transform mt-0.5 ${expandedHotOpp === hot.id ? 'rotate-180' : ''}`}
                      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </div>

                  {expandedHotOpp === hot.id && (
                    <div className="mt-2 pt-2 border-t border-orange-200 space-y-1.5">
                      {hot.description && (
                        <p className="text-[11px] text-gray-700 leading-relaxed">{hot.description}</p>
                      )}
                      {hot.pain_point && (
                        <div className="bg-orange-100/60 rounded-lg px-2.5 py-1.5">
                          <span className="text-[9px] font-semibold text-orange-700 block mb-0.5">הצורך שהגוף מנסה לפתור:</span>
                          <p className="text-[11px] text-orange-900">{hot.pain_point}</p>
                        </div>
                      )}
                      {hot.strategic_insight && (
                        <div className="bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                          <span className="text-[9px] font-semibold text-amber-700 block mb-0.5">תובנה אסטרטגית:</span>
                          <p className="text-[11px] text-amber-900 font-medium">{hot.strategic_insight}</p>
                        </div>
                      )}
                      {hot.source_url && (
                        <a
                          href={hot.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-[10px] text-orange-600 hover:text-orange-800 font-medium mt-1"
                          onClick={e => e.stopPropagation()}
                        >
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" />
                          </svg>
                          פתח מקור
                        </a>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {filtered.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm text-muted">לא נמצאו תוצאות</p>
            <p className="text-xs text-muted2 mt-1">נסו לשנות את החיפוש או הסינון</p>
          </div>
        ) : (
          filtered.map(opp => <OpportunityCard key={opp.id} opp={opp} match={matchScores.get(opp.id)} orgId={orgId} funderMeta={opp.funder ? funderInfo[opp.funder] : undefined} />)
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
  if (opp.application_url) parts.push(`\nקישור ישיר להגשה: ${opp.application_url}`);
  else if (opp.url) parts.push(`\nקישור: ${opp.url}`);
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

function OpportunityCard({ opp, match, orgId, funderMeta }: { opp: Opportunity; match?: MatchScore; orgId?: string | null; funderMeta?: FunderInfoMap[string] }) {
  const [expanded, setExpanded] = useState(false);
  const [draftState, setDraftState] = useState<'idle' | 'parsing' | 'analyzing' | 'fit_review' | 'generating' | 'done' | 'error'>('idle');
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [fitAnalysis, setFitAnalysis] = useState<FitAnalysis | null>(null);
  const [pendingRfpId, setPendingRfpId] = useState<string | null>(null);
  const [readiness, setReadiness] = useState<ReadinessData | null>(null);
  const [loadingReadiness, setLoadingReadiness] = useState(false);

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
          url: opp.application_url || opp.url || null,
          text: !(opp.application_url || opp.url) ? [opp.title, opp.description, opp.eligibility, opp.how_to_apply].filter(Boolean).join('\n') : null,
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
    if (opp.amount_max) parts.push(`סכום מקסימלי: ${opp.amount_max.toLocaleString()} ₪`);
    if (opp.eligibility) parts.push(`תנאי סף: ${opp.eligibility}`);
    if (opp.how_to_apply) parts.push(`אופן הגשה: ${opp.how_to_apply}`);
    if (opp.application_url) parts.push(`לינק ישיר להגשה: ${opp.application_url}`);
    else if (opp.url) parts.push(`לינק לקול הקורא: ${opp.url}`);
    // Include raw page content if available — this is the actual RFP text
    if (opp.raw_text && opp.raw_text.length > 200) {
      parts.push(`\n===== תוכן קול הקורא המלא =====\n${opp.raw_text.slice(0, 6000)}`);
    } else if (opp.description) {
      parts.push(`\nתיאור: ${opp.description.slice(0, 800)}`);
    }
    const detail = parts.join('\n');
    // Close sidebar first (mobile), then send after ChatPanel mounts
    window.dispatchEvent(new CustomEvent('fishgold:closeSidebar'));
    setTimeout(() => window.dispatchEvent(new CustomEvent('fishgold:send', { detail })), 50);
  };

  return (
    <div
      className={`bg-surf rounded-xl border overflow-hidden hover:border-accent/30 transition-colors cursor-pointer ${match && match.score >= 80 ? 'border-green-200' : 'border-border'}`}
      onClick={() => setExpanded(!expanded)}
    >
      {/* ── HEADER ── */}
      <div className="p-3 pb-2">
      {/* Match score badge + 4-pillar breakdown */}
      {match && (
        <div className={`mb-2.5 rounded-lg border text-[10px] overflow-hidden ${matchColor}`}>
          {/* Main score row */}
          <div className="flex items-center gap-1.5 px-2.5 py-1.5">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="flex-shrink-0">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
            <span className="font-bold flex-1">{match.score}% התאמה לארגון שלכם</span>
            {match.pillars && (
              <span className="text-[8px] opacity-60 ml-1">לפי 4 עמודות</span>
            )}
          </div>
          {/* Pillar mini-bars — only when pillars data exists */}
          {match.pillars && (
            <div className="px-2.5 pb-2 grid grid-cols-4 gap-1">
              {[
                { key: 'eligibility',       label: 'סף', value: match.pillars.eligibility },
                { key: 'mission_alignment', label: 'משימה', value: match.pillars.mission_alignment },
                { key: 'geography',         label: 'אזור', value: match.pillars.geography },
                { key: 'capacity',          label: 'כמות', value: match.pillars.capacity },
              ].map(({ key, label, value }) => (
                <div key={key} className="flex flex-col items-center gap-0.5">
                  <div className="w-full h-1 rounded-full bg-current/20 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${value >= 70 ? 'bg-green-500' : value >= 40 ? 'bg-amber-500' : 'bg-red-400'}`}
                      style={{ width: `${value}%` }}
                    />
                  </div>
                  <span className="text-[8px] opacity-70">{label}</span>
                </div>
              ))}
            </div>
          )}
          {/* Reasoning — shown when reasoning exists */}
          {match.reasoning && (
            <div className="px-2.5 pb-2 text-[9px] opacity-75 leading-snug border-t border-current/10 pt-1.5">
              {match.reasoning}
            </div>
          )}
        </div>
      )}

      {/* Top row: title + type badge + source link */}
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <h4 className="text-[15px] font-bold leading-snug flex-1 min-w-0 line-clamp-2">
          {opp.title}
        </h4>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          {opp.type && (
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${TYPE_COLORS[opp.type]}`}>
              {TYPE_LABELS[opp.type]}
            </span>
          )}
          {/* source_url — direct link to original grant page, or Google Search fallback */}
          {opp.source_url ? (
            <a
              href={opp.source_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              title="מעבר לדף המקור"
              className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-md bg-accent/10 text-accent hover:bg-accent/20 font-medium transition-colors"
            >
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
              מקור
            </a>
          ) : (
            <a
              href={`https://www.google.com/search?q=${encodeURIComponent(`${opp.funder || ''} ${opp.title}`)}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              title="חפש את קול הקורא בגוגל"
              className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-md bg-gray-100 text-gray-500 hover:bg-gray-200 font-medium transition-colors"
            >
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              חפש
            </a>
          )}
          {(opp.application_url || opp.url) && (() => {
            const href = opp.application_url || opp.url!;
            // Don't duplicate if source_url and this href are the same
            if (href === opp.source_url) return null;
            const isDirect = !!opp.application_url;
            const isGov = href.includes('gov.il') || href.includes('merkava') || href.includes('taktziv') || href.includes('pras.');
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                title={isDirect ? 'מעבר לאתר ההגשה' : 'מעבר לאתר המקור'}
                className="inline-flex items-center gap-0.5 text-[9px] text-muted hover:text-accent hover:underline"
              >
                {isGov ? <span>🇮🇱</span> : (
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                )}
                {isDirect ? 'הגשה' : 'אתר'}
              </a>
            );
          })()}
        </div>
      </div>

      {/* Funder + intelligence */}
      {opp.funder && (
        <div className="flex items-center gap-1.5 mb-1.5">
          <p className="text-[11px] text-muted">{opp.funder}</p>
          {funderMeta?.style && (
            <span className={`text-[8px] px-1.5 py-0.5 rounded-full font-medium ${
              funderMeta.style === 'government' ? 'bg-slate-100 text-slate-600' :
              funderMeta.style === 'foundation' ? 'bg-purple-100 text-purple-600' :
              funderMeta.style === 'federation' ? 'bg-blue-100 text-blue-600' :
              funderMeta.style === 'corporate' ? 'bg-emerald-100 text-emerald-600' :
              'bg-gray-100 text-gray-500'
            }`}>
              {funderMeta.style === 'government' ? 'ממשלתי' :
               funderMeta.style === 'foundation' ? 'קרן' :
               funderMeta.style === 'federation' ? 'פדרציה' :
               funderMeta.style === 'corporate' ? 'עסקי' : ''}
            </span>
          )}
          {funderMeta?.approval_rate != null && funderMeta.approval_rate > 0 && (
            <span className="text-[8px] text-muted">{funderMeta.approval_rate}% אישור</span>
          )}
        </div>
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

      {/* Category tags */}
      {opp.categories && opp.categories.length > 0 && (
        <div className="flex flex-wrap gap-1">
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
      </div>

      {/* ── CONTENT (expanded) ── */}
      {expanded && (
        <div className="border-t border-border">
          <div className="px-3 pt-3 pb-2 space-y-2.5 text-[11px]">

          {opp.description && (
            <ul className="space-y-1 text-text2 leading-relaxed list-none">
              {opp.description.split(/[.。\n]+/).filter(s => s.trim().length > 10).slice(0, 4).map((sentence, i) => (
                <li key={i} className="flex gap-1.5">
                  <span className="text-accent mt-0.5 flex-shrink-0">•</span>
                  <span>{sentence.trim()}</span>
                </li>
              ))}
            </ul>
          )}
          {/* 4-Pillar Match Breakdown */}
          {match?.pillars && (
            <div className="rounded-lg border border-border bg-surf2 p-2.5 space-y-2">
              <p className="text-[10px] font-semibold text-text">ניתוח התאמה</p>
              {match.pillars.reasoning && (
                <p className="text-[10px] text-text2 leading-relaxed">{match.pillars.reasoning}</p>
              )}
              <div className="space-y-1.5">
                {([
                  { key: 'eligibility',       label: 'זכאות',       color: 'bg-blue-400' },
                  { key: 'mission_alignment', label: 'התאמת משימה', color: 'bg-accent' },
                  { key: 'geography',         label: 'גיאוגרפיה',   color: 'bg-emerald-400' },
                  { key: 'capacity',          label: 'היקף מענק',   color: 'bg-amber-400' },
                ] as const).map(({ key, label, color }) => (
                  <div key={key} className="flex items-center gap-2">
                    <span className="text-[9px] text-muted w-20 text-right">{label}</span>
                    <div className="flex-1 h-1.5 bg-border rounded-full overflow-hidden">
                      <div
                        className={`h-full ${color} rounded-full`}
                        style={{ width: `${match.pillars![key]}%` }}
                      />
                    </div>
                    <span className="text-[9px] font-medium text-text w-6 text-left">{match.pillars![key]}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {opp.eligibility && (
            <div>
              <span className="font-semibold text-text">תנאי סף: </span>
              <span className="text-text2 text-[10px]">{opp.eligibility}</span>
            </div>
          )}
          {opp.how_to_apply && (
            <div>
              <span className="font-semibold text-text">אופן הגשה: </span>
              <span className="text-text2 text-[10px]">{opp.how_to_apply}</span>
            </div>
          )}
          {opp.contact_info && (
            <div>
              <span className="font-semibold text-text">איש קשר: </span>
              <span className="text-text2 text-[10px]">{opp.contact_info}</span>
            </div>
          )}
          {opp.target_populations && opp.target_populations.length > 0 && (
            <div className="flex flex-wrap gap-1">
              <span className="font-semibold text-text ml-1">אוכלוסיות:</span>
              {opp.target_populations.map(pop => (
                <span key={pop} className="text-[9px] px-1.5 py-0.5 bg-accent/10 text-accent rounded-md">
                  {pop}
                </span>
              ))}
            </div>
          )}
          </div>

          {/* Doc Progress Bar */}
          {orgId && <DocProgressBar opportunityId={opp.id} orgId={orgId} />}

          {/* Readiness check */}
          {orgId && (
            <div className="px-3 pb-2">
              {!readiness && !loadingReadiness && (
                <button
                  onClick={e => {
                    e.stopPropagation();
                    setLoadingReadiness(true);
                    fetch(`/api/opportunities/readiness?org_id=${orgId}&opportunity_id=${opp.id}`)
                      .then(r => r.json())
                      .then(data => { setReadiness(data as ReadinessData); setLoadingReadiness(false); })
                      .catch(() => setLoadingReadiness(false));
                  }}
                  className="w-full py-1.5 text-[10px] font-medium border border-accent/30 text-accent rounded-lg hover:bg-accent/5 transition-colors"
                >
                  בדוק מוכנות להגשה
                </button>
              )}
              {loadingReadiness && (
                <div className="flex items-center justify-center gap-1.5 py-1.5 text-[10px] text-muted">
                  <div className="w-3 h-3 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                  בודק מוכנות...
                </div>
              )}
              {readiness && (
                <div className={`rounded-lg border p-2.5 space-y-1.5 ${
                  readiness.score >= 70 ? 'bg-green-50 border-green-200' :
                  readiness.score >= 40 ? 'bg-amber-50 border-amber-200' :
                  'bg-red-50 border-red-200'
                }`}>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold text-gray-700">ציון מוכנות</span>
                    <span className={`text-lg font-bold ${
                      readiness.score >= 70 ? 'text-green-600' :
                      readiness.score >= 40 ? 'text-amber-600' :
                      'text-red-500'
                    }`}>{readiness.score}</span>
                  </div>
                  {readiness.timeWarning && (
                    <div className="text-[9px] text-red-600 font-medium">{readiness.timeWarning}</div>
                  )}
                  {readiness.factors.filter(f => !f.met).map((f, i) => (
                    <div key={i} className="flex items-center gap-1 text-[9px] text-gray-600">
                      <span className="text-red-400">✗</span> {f.label}
                    </div>
                  ))}
                  {readiness.missingDocs.length > 0 && (
                    <div className="text-[9px] text-amber-700">
                      חסרים: {readiness.missingDocs.join(', ')}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="border-t border-border bg-surf2/40 px-3 pt-3 pb-3 space-y-2">
          {orgId && (
            <div>
              {draftState === 'idle' && (
                <button
                  onClick={handlePrepareDraft}
                  className="w-full py-2.5 text-[11px] font-bold bg-orange-500 text-white rounded-xl hover:bg-orange-600 active:scale-[0.98] transition-all shadow-sm flex items-center justify-center gap-2"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
                  </svg>
                  הכן טיוטת הגשה אוטומטית
                </button>
              )}
              {(draftState === 'parsing' || draftState === 'analyzing' || draftState === 'generating') && (
                <div className="w-full py-2.5 text-[11px] font-medium bg-orange-50 text-orange-600 rounded-xl border border-orange-200 flex items-center justify-center gap-1.5">
                  <div className="w-3 h-3 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
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
                  {(opp.source_url || opp.url) && (
                    <a
                      href={opp.source_url || opp.url!}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      className="flex items-center gap-1 text-[10px] text-orange-600 hover:underline font-medium"
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                        <polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
                      </svg>
                      לינק לקול הקורא
                    </a>
                  )}
                  {opp.application_url && (
                    <a
                      href={opp.application_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      className="flex items-center gap-1 text-[10px] text-orange-600 hover:underline font-medium"
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                        <polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
                      </svg>
                      לינק להגשה
                    </a>
                  )}
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

          {/* SECONDARY: Write in chat */}
          <button
            onClick={handleWriteSubmission}
            className="w-full py-2 text-[10px] font-medium bg-accent/10 text-accent rounded-lg hover:bg-accent/20 transition-colors border border-accent/20"
          >
            כתוב הגשה בצ'אט
          </button>

          {/* Share row — icons only */}
          <div className="flex items-center justify-end gap-1 pt-0.5">
            <span className="text-[9px] text-muted ml-auto">שתף:</span>
            <a
              href={`mailto:?subject=${encodeURIComponent(opp.title)}&body=${encodeURIComponent(buildShareText(opp))}`}
              onClick={e => e.stopPropagation()}
              title="שלח במייל"
              className="w-7 h-7 flex items-center justify-center border border-border rounded-lg hover:bg-surf2 transition-colors text-muted hover:text-text"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                <polyline points="22,6 12,13 2,6" />
              </svg>
            </a>
            <a
              href={`https://wa.me/?text=${encodeURIComponent(buildShareText(opp))}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              title="שלח בוואטסאפ"
              className="w-7 h-7 flex items-center justify-center border border-green-200 rounded-lg hover:bg-green-50 transition-colors text-green-600"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
              </svg>
            </a>
          </div>
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

// ── DocProgressBar ─────────────────────────────────────────────────────────────

function DocProgressBar({ opportunityId, orgId }: { opportunityId: string; orgId: string }) {
  const [data, setData] = useState<DocGapData | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const load = () => {
    if (data || loading) return;
    setLoading(true);
    fetch(`/api/opportunities/doc-gap?org_id=${orgId}&opportunity_id=${opportunityId}`)
      .then(r => r.json())
      .then(d => { setData(d as DocGapData); setLoading(false); })
      .catch(() => setLoading(false));
  };

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!open) load();
    setOpen(o => !o);
  };

  const { ok = 0, missing = 0, expired = 0, total = 0 } = data?.summary || {};
  const pct = total > 0 ? Math.round((ok / total) * 100) : 0;
  const barColor = pct >= 80 ? 'bg-green-500' : pct >= 50 ? 'bg-amber-500' : 'bg-red-400';

  return (
    <div className="px-3 pb-2">
      <button
        onClick={toggle}
        className="w-full text-right mb-1.5"
      >
        <div className="flex items-center justify-between text-[10px] mb-1">
          <span className="font-medium text-text">
            {loading ? 'טוען מסמכים...' : data ? `מסמכים: ${ok}/${total}` : 'מסמכים נדרשים'}
          </span>
          {data && (
            <span className={`font-bold ${pct >= 80 ? 'text-green-600' : pct >= 50 ? 'text-amber-600' : 'text-red-500'}`}>
              {pct}%
            </span>
          )}
        </div>
        <div className="w-full h-1.5 bg-surf2 rounded-full overflow-hidden border border-border/40">
          {loading ? (
            <div className="h-full w-1/3 bg-accent/40 rounded-full animate-pulse" />
          ) : data ? (
            <div className={`h-full rounded-full transition-all duration-500 ${barColor}`} style={{ width: `${pct}%` }} />
          ) : (
            <div className="h-full w-0" />
          )}
        </div>
        {data && (missing > 0 || expired > 0) && (
          <div className="flex gap-2 mt-1 text-[9px]">
            {missing > 0 && <span className="text-red-500">❌ {missing} חסרים</span>}
            {expired > 0 && <span className="text-amber-500">⚠️ {expired} פגי תוקף</span>}
            {ok > 0 && <span className="text-green-600">✅ {ok} תקינים</span>}
          </div>
        )}
      </button>
      {open && data && data.checklist.length > 0 && (
        <div className="space-y-1 border border-border rounded-lg p-2 bg-surf2/50">
          {data.checklist.map(item => (
            <div key={item.key} className="flex items-center gap-1.5 text-[9px]">
              <span className="flex-shrink-0">
                {item.status === 'ok' ? '✅' : item.status === 'missing' ? '❌' : '⚠️'}
              </span>
              <span className={item.status === 'ok' ? 'text-text2' : item.status === 'missing' ? 'text-red-600' : 'text-amber-600'}>
                {item.label}
              </span>
              {item.expiry_date && item.status !== 'ok' && (
                <span className="text-muted mr-auto">{new Date(item.expiry_date).toLocaleDateString('he-IL')}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── DocChecklist ───────────────────────────────────────────────────────────────

interface DocChecklistItem {
  key: string;
  label: string;
  hint: string;
  category: string;
  status: 'ok' | 'missing' | 'expired' | 'expiring';
  doc_id: string | null;
  doc_filename: string | null;
  expiry_date: string | null;
}

interface DocGapData {
  checklist: DocChecklistItem[];
  agent_requirements: string[];
  form_links: { label: string; url: string }[];
  summary: { ok: number; missing: number; expired: number; total: number };
}

function DocChecklist({ opportunityId, orgId }: { opportunityId: string; orgId: string }) {
  const [data, setData] = useState<DocGapData | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const load = () => {
    if (data || loading) return;
    setLoading(true);
    fetch(`/api/opportunities/doc-gap?org_id=${orgId}&opportunity_id=${opportunityId}`)
      .then(r => r.json())
      .then(d => { setData(d as DocGapData); setLoading(false); })
      .catch(() => setLoading(false));
  };

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!open) load();
    setOpen(o => !o);
  };

  const { ok = 0, missing = 0, expired = 0 } = data?.summary || {};
  const hasIssues = missing > 0 || expired > 0;

  return (
    <div className="pt-1">
      <button
        onClick={toggle}
        className={`w-full flex items-center justify-between text-[10px] px-2.5 py-2 rounded-lg border font-medium transition-colors ${
          open
            ? 'bg-blue-50 border-blue-200 text-blue-700'
            : hasIssues
            ? 'bg-amber-50 border-amber-200 text-amber-800 hover:border-amber-300'
            : data
            ? 'bg-green-50 border-green-200 text-green-700 hover:border-green-300'
            : 'bg-surf2 border-border text-muted hover:border-accent/30 hover:text-accent'
        }`}
      >
        <div className="flex items-center gap-1.5">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <polyline points="10 9 9 9 8 9" />
          </svg>
          Checklist מסמכים
        </div>
        <div className="flex items-center gap-1.5">
          {data && (
            <>
              {ok > 0 && <span className="text-green-600">✓ {ok}</span>}
              {missing > 0 && <span className="text-red-500">✗ {missing} חסרים</span>}
              {expired > 0 && <span className="text-amber-600">! {expired} פגי תוקף</span>}
            </>
          )}
          {loading && <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />}
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`transition-transform ${open ? 'rotate-180' : ''}`}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </button>

      {open && data && (
        <div className="mt-1.5 space-y-1">
          {data.checklist.map(item => (
            <div
              key={item.key}
              className={`flex items-start gap-2 px-2.5 py-1.5 rounded-lg text-[10px] ${
                item.status === 'ok'       ? 'bg-green-50 text-green-700' :
                item.status === 'expiring' ? 'bg-amber-50 text-amber-700' :
                item.status === 'expired'  ? 'bg-red-50 text-red-600' :
                                             'bg-gray-50 text-gray-500'
              }`}
            >
              <span className="flex-shrink-0 mt-0.5">
                {item.status === 'ok'       ? '✓' :
                 item.status === 'expiring' ? '⚠' :
                 item.status === 'expired'  ? '✗' : '○'}
              </span>
              <div className="flex-1 min-w-0">
                <div className="font-medium">{item.label}</div>
                {item.status !== 'ok' && (
                  <div className="text-[9px] opacity-75 mt-0.5">{item.hint}</div>
                )}
                {item.expiry_date && item.status !== 'missing' && (
                  <div className="text-[9px] opacity-60">תוקף: {new Date(item.expiry_date).toLocaleDateString('he-IL')}</div>
                )}
              </div>
            </div>
          ))}

          {/* Agent-extracted dynamic requirements */}
          {data.agent_requirements.length > 0 && (
            <div className="mt-2 pt-1.5 border-t border-border">
              <div className="text-[9px] text-muted font-medium mb-1">דרישות ייחודיות לקול קורא זה:</div>
              {data.agent_requirements.map((req, i) => (
                <div key={i} className="flex items-center gap-1.5 text-[10px] text-text2 py-0.5">
                  <span className="text-blue-400">→</span> {req}
                </div>
              ))}
            </div>
          )}

          {/* Form/attachment links found by agent */}
          {data.form_links.length > 0 && (
            <div className="mt-1.5 pt-1.5 border-t border-border">
              <div className="text-[9px] text-muted font-medium mb-1">טפסים להורדה:</div>
              {data.form_links.map((link, i) => (
                <a
                  key={i}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={e => e.stopPropagation()}
                  className="flex items-center gap-1 text-[10px] text-accent hover:underline py-0.5"
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  {link.label}
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
