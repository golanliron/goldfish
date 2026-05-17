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

const TYPE_LABELS: Record<string, string> = {
  kok: 'קול קורא',
  grant: 'מענק',
  prize: 'פרס',
  fellowship: 'מלגה',
  tender: 'מכרז',
  fund: 'קרן',
  business: 'עסקי',
  endowment: 'הקדש',
};

const TYPE_COLORS: Record<string, string> = {
  kok: 'bg-blue-100 text-blue-700',
  grant: 'bg-blue-100 text-blue-700',
  prize: 'bg-purple-100 text-purple-700',
  fellowship: 'bg-indigo-100 text-indigo-700',
  tender: 'bg-gray-100 text-gray-700',
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
  const [showAdvanced, setShowAdvanced] = useState(false);
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
  // matchedCount = opportunities with score >= 40 (the "relevant" threshold)
  const matchedCount = useMemo(
    () => opportunities.filter(o => (matchScores.get(o.id)?.score ?? 0) >= 40).length,
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
    const headers: Record<string, string> = {};
    if (orgId) headers['x-org-id'] = orgId;

    fetch(`/api/opportunities${orgId ? `?org_id=${orgId}` : ''}`, {
      credentials: 'include',
      headers,
    })
      .then(async r => {
        const data = await r.json();
        if (r.status === 401) {
          console.error('[GoldFish Opportunities] 401 Unauthorized — session missing or expired');
          setLoading(false);
          return null;
        }
        console.log('[GoldFish Opportunities] API response:', {
          http_status: r.status,
          status_error: data.error,
          opportunities_count: data.opportunities?.length,
          matches_count: data.matches?.length,
          sample_opp: data.opportunities?.[0] ? { title: data.opportunities[0].title, type: data.opportunities[0].type, url: data.opportunities[0].url, app_url: data.opportunities[0].application_url } : null,
        });
        return data;
      })
      .then((data) => {
        if (!data) return;
        const { taxonomy: tax, opportunities: opps, matches: m, profileCompleteness: pc, funderInfo: fi, upcomingRecurrences: ur } = data;
        if (tax) setTaxonomy(tax as TaxItem[]);
        if (Array.isArray(opps)) setOpportunities(opps as Opportunity[]);
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
      .catch((err) => {
        console.error('[GoldFish Opportunities] fetch error:', err);
        setLoading(false);
      });
  };

  // Load on mount (catalog without matches if no orgId).
  // Re-load when orgId changes so matches/scores are added.
  const mountedRef = useRef(false);
  const prevOrgIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const isFirstMount = !mountedRef.current;
    mountedRef.current = true;
    const orgIdChanged = prevOrgIdRef.current !== orgId;
    prevOrgIdRef.current = orgId;
    if (isFirstMount || orgIdChanged) {
      loadOpportunities();
    }
    // Clear any stale agent state from a previous session
    setAgentRunning(false);
    setAgentToast(null);
    if (agentPollRef.current) {
      clearInterval(agentPollRef.current);
      agentPollRef.current = null;
    }
    return () => {
      if (agentPollRef.current) clearInterval(agentPollRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

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

    // Main toggle: matched-only (score >= 40) vs all
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

    // Sort: high match + urgent deadline first, then high match, then medium
    result = [...result].sort((a, b) => {
      const scoreA = matchScores.get(a.id)?.score || 0;
      const scoreB = matchScores.get(b.id)?.score || 0;
      const daysA = a.deadline ? Math.ceil((new Date(a.deadline).getTime() - Date.now()) / 86400000) : 9999;
      const daysB = b.deadline ? Math.ceil((new Date(b.deadline).getTime() - Date.now()) / 86400000) : 9999;
      // Urgency bonus: deadline within 30 days + high score
      const urgentA = scoreA >= 70 && daysA <= 30 ? 1 : 0;
      const urgentB = scoreB >= 70 && daysB <= 30 ? 1 : 0;
      if (urgentA !== urgentB) return urgentB - urgentA;
      if (scoreA !== scoreB) return scoreB - scoreA;
      return daysA - daysB;
    });

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

        {/* Main heading */}
        <div className="flex items-center justify-between">
          <h3 className="text-[15px] font-bold text-text leading-tight">קולות קוראים פתוחים</h3>
          <span className="text-[11px] text-muted">{opportunities.length} במאגר</span>
        </div>

        {/* Profile completeness hint */}
        {profileCompleteness !== null && profileCompleteness < 60 && matchedCount > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-start gap-2">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2" className="flex-shrink-0 mt-0.5">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <div>
              <div className="text-[11px] font-medium text-amber-800">
                פרופיל {profileCompleteness}% שלם — התאמות יהיו מדויקות יותר עם יותר מידע
              </div>
            </div>
          </div>
        )}

        {/* Matched / All toggle — always visible when there are opportunities */}
        {opportunities.length > 0 && (
          <div className="flex rounded-xl border border-border overflow-hidden">
            <button
              onClick={() => setShowOnlyMatched(true)}
              className={`flex-1 text-[11px] py-1.5 font-medium transition-colors flex items-center justify-center gap-1 ${
                showOnlyMatched ? 'bg-accent text-white' : 'bg-surf text-muted hover:text-text'
              }`}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
              </svg>
              מותאמים לארגון
              {matchedCount > 0 && (
                <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${showOnlyMatched ? 'bg-white/25' : 'bg-accent/15 text-accent'}`}>
                  {matchedCount}
                </span>
              )}
            </button>
            <button
              onClick={() => setShowOnlyMatched(false)}
              className={`flex-1 text-[11px] py-1.5 font-medium transition-colors flex items-center justify-center gap-1 ${
                !showOnlyMatched ? 'bg-accent text-white' : 'bg-surf text-muted hover:text-text'
              }`}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
                <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
              </svg>
              כל הקולות הקוראים
              <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${!showOnlyMatched ? 'bg-white/25' : 'bg-surf2 text-muted'}`}>
                {opportunities.length}
              </span>
            </button>
          </div>
        )}

        {/* When no matches computed: if has orgId → soft info, else → nudge to complete profile */}
        {matchScores.size === 0 && opportunities.length > 0 && orgId && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-[11px] text-blue-700">
            עוד לא חושבו התאמות לארגון. בינתיים מוצגים כל הקולות הקוראים.
          </div>
        )}
        {matchScores.size === 0 && opportunities.length > 0 && !orgId && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-start gap-2">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2" className="flex-shrink-0 mt-0.5">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <p className="text-[11px] text-amber-800 leading-relaxed">
              השלימו פרופיל ארגון כדי לראות רק מה שמתאים לכם —{' '}
              <button
                onClick={() => window.dispatchEvent(new CustomEvent('fishgold:activeTab', { detail: 'org' }))}
                className="underline font-semibold hover:text-amber-900"
              >
                לחצו כאן
              </button>
            </p>
          </div>
        )}

        {/* Agent sync button */}
        {orgId && (
          <div className="flex justify-end">
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
              {agentRunning ? 'מנתח...' : 'סנכרון'}
            </button>
          </div>
        )}

        {/* Advanced options (collapsible) */}
        <div>
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-1 text-[10px] text-muted hover:text-text transition-colors"
          >
            <svg
              width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              className={`transition-transform ${showAdvanced ? 'rotate-180' : ''}`}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
            אפשרויות מתקדמות
            {activeFilters > 0 && (
              <span className="bg-accent text-white text-[9px] w-4 h-4 rounded-full flex items-center justify-center mr-1">
                {activeFilters}
              </span>
            )}
          </button>

          {showAdvanced && (
            <div className="mt-2 space-y-2 pt-2 border-t border-border/50">
              {/* Search */}
              <div className="relative">
                <svg className="absolute right-3 top-1/2 -translate-y-1/2 text-muted" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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

              {/* Calendar toggle */}
              <button
                onClick={() => setShowTimeline(!showTimeline)}
                className={`flex items-center gap-1.5 text-[10px] px-2 py-1.5 rounded-lg border transition-colors w-full ${
                  showTimeline ? 'bg-accent/10 text-accent border-accent/30' : 'bg-surf2 text-muted border-border hover:text-text'
                }`}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
                לוח זמנים
              </button>

              {/* Match buckets */}
              {matchScores.size > 0 && (
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
              )}

              {/* Filter dropdowns */}
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

              <div className="text-[10px] text-muted text-left">
                {filtered.length} מתוך {opportunities.length}
              </div>
            </div>
          )}
        </div>
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

        {opportunities.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm text-muted">לא נמצאו קולות קוראים פעילים במאגר כרגע.</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm text-muted">לא נמצאו תוצאות</p>
            <p className="text-xs text-muted2 mt-1">נסו לשנות את החיפוש או הסינון</p>
          </div>
        ) : (() => {
          // Split by reliability: placeholders go last under their own heading
          const getReliability = (o: Opportunity) => (o as unknown as Record<string, unknown>).reliability as string | undefined;
          const verified = filtered.filter(o => getReliability(o) !== 'placeholder');
          const placeholders = filtered.filter(o => getReliability(o) === 'placeholder');

          const matched = verified.filter(o => (matchScores.get(o.id)?.score ?? 0) >= 60);
          const rest = verified.filter(o => (matchScores.get(o.id)?.score ?? 0) < 60);
          return (
            <>
              {matched.length > 0 && (
                <>
                  <div className="text-[10px] font-bold text-accent uppercase tracking-wide px-0.5 mb-1">
                    מתאים לארגון שלכם ({matched.length})
                  </div>
                  {matched.map(opp => (
                    <OpportunityCard key={opp.id} opp={opp} match={matchScores.get(opp.id)} orgId={orgId} funderMeta={opp.funder ? funderInfo[opp.funder] : undefined} />
                  ))}
                  {rest.length > 0 && (
                    <div className="border-t border-border/50 pt-3 mt-1">
                      <div className="text-[10px] font-bold text-muted uppercase tracking-wide px-0.5 mb-1">
                        כל הקולות הקוראים ({rest.length})
                      </div>
                    </div>
                  )}
                </>
              )}
              {rest.map(opp => (
                <OpportunityCard key={opp.id} opp={opp} match={matchScores.get(opp.id)} orgId={orgId} funderMeta={opp.funder ? funderInfo[opp.funder] : undefined} />
              ))}
              {placeholders.length > 0 && (
                <>
                  <div className="border-t border-border/50 pt-3 mt-2">
                    <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wide px-0.5 mb-1">
                      דורש אימות ({placeholders.length})
                    </div>
                    <p className="text-[9px] text-gray-400 px-0.5 mb-2">קולות קוראים שחסר להם מידע לאימות — ייתכן שהם מדויקים אך לא ניתן להציג לינק ישיר</p>
                  </div>
                  {placeholders.map(opp => (
                    <OpportunityCard key={opp.id} opp={opp} match={matchScores.get(opp.id)} orgId={orgId} funderMeta={opp.funder ? funderInfo[opp.funder] : undefined} />
                  ))}
                </>
              )}
            </>
          );
        })()}
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
  const [draftState, setDraftState] = useState<'idle' | 'checking' | 'parsing' | 'generating' | 'done' | 'error'>('idle');
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState<string | null>(null);
  const [draftIsExisting, setDraftIsExisting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [readiness, setReadiness] = useState<ReadinessData | null>(null);
  const [loadingReadiness, setLoadingReadiness] = useState(false);

  const handlePrepareDraft = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!orgId) return;

    // If draft already done — open it directly
    if (draftState === 'done' && shareUrl) {
      window.open(shareUrl, '_blank');
      return;
    }

    setDraftState('checking');
    setDraftError(null);
    setShareUrl(null);
    setDraftIsExisting(false);

    try {
      // Step 1: Check for existing draft first (fast, no AI)
      const existingRes = await fetch('/api/submissions/check?' + new URLSearchParams({
        opportunity_id: opp.id,
      }), {
        credentials: 'include',
        headers: orgId ? { 'x-org-id': orgId } : {},
      });
      if (existingRes.ok) {
        const existingData = await existingRes.json();
        if (existingData.share_url) {
          setShareUrl(existingData.share_url);
          setDraftTitle(opp.title);
          setDraftIsExisting(true);
          setDraftState('done');
          window.open(existingData.share_url, '_blank');
          return;
        }
      }

      // Step 2: Parse the RFP (so submission engine gets structured questions)
      setDraftState('parsing');
      const oppExtra = opp as unknown as Record<string, unknown>;
      const rfpRes = await fetch('/api/rfp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          org_id: orgId,
          url: opp.application_url || opp.url || null,
          text: !(opp.application_url || opp.url)
            ? [opp.title, opp.description, oppExtra.eligibility, oppExtra.how_to_apply].filter(Boolean).join('\n')
            : null,
          opportunity_id: opp.id,
          // Fallback fields used if URL fetch fails
          title: opp.title || null,
          description: opp.description || null,
          funder: opp.funder || null,
          deadline: opp.deadline || null,
          amount_min: opp.amount_min || null,
          amount_max: opp.amount_max || null,
          requirements: oppExtra.requirements || null,
          full_content: oppExtra.full_content || null,
        }),
      });
      let rfpData = await rfpRes.json();

      if (!rfpRes.ok || !rfpData.rfp_id) {
        // Fallback: retry with plain text from card fields
        console.warn('[Goldfish] /api/rfp failed, retrying with text fallback:', rfpData.error);
        const fallbackText = [
          opp.title,
          opp.funder ? `גוף מממן: ${opp.funder}` : '',
          opp.description,
          oppExtra.requirements as string || '',
          oppExtra.full_content as string || '',
        ].filter(Boolean).join('\n\n') || `קול קורא: ${opp.title}`;

        const rfpFallbackRes = await fetch('/api/rfp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            text: fallbackText,
            opportunity_id: opp.id,
            title: opp.title,
            funder: opp.funder,
            deadline: opp.deadline,
            amount_min: opp.amount_min,
            amount_max: opp.amount_max,
          }),
        });
        const rfpFallbackData = await rfpFallbackRes.json();
        if (!rfpFallbackRes.ok || !rfpFallbackData.rfp_id) {
          // Both rfp calls failed — skip rfp entirely, go direct to submissions with opportunity_id only
          rfpData = { rfp_id: null };
        } else {
          rfpData = rfpFallbackData;
        }
        setDraftError('לא הצלחתי לקרוא את כל הקול הקורא. יצרתי טיוטה בסיסית לעריכה.');
      }

      // Step 3: Generate draft (fit analysis runs in parallel inside the API)
      setDraftState('generating');
      const subRes = await fetch('/api/submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          rfp_id: rfpData.rfp_id,
          opportunity_id: opp.id,
        }),
      });
      const subData = await subRes.json();
      if (!subRes.ok || !subData.share_url) throw new Error(subData.error || 'שגיאה ביצירת הטיוטה');

      setShareUrl(subData.share_url);
      setDraftTitle(subData.rfp_title || opp.title);
      setDraftIsExisting(false);
      setDraftState('done');
      window.open(subData.share_url, '_blank');
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : 'שגיאה לא צפויה');
      setDraftState('error');
    }
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
    : match.score >= 40 ? 'bg-amber-100 text-amber-700 border-amber-200'
    : 'bg-gray-100 text-gray-600 border-gray-200'
    : '';


  const reliability = (opp as unknown as Record<string, unknown>).reliability as string | undefined;

  // Status tag logic — placeholders never show "high match" since data is unverified
  const statusTag: { label: string; cls: string } = (() => {
    if (reliability === 'placeholder') {
      return { label: 'דורש אימות', cls: 'bg-gray-100 text-gray-500 border-gray-200' };
    }
    if (daysLeft !== null && daysLeft >= 0 && daysLeft <= 14) {
      return { label: 'דחוף', cls: 'bg-red-100 text-red-700 border-red-200' };
    }
    if (match && match.score >= 75) {
      return { label: 'התאמה גבוהה', cls: 'bg-green-100 text-green-700 border-green-200' };
    }
    if (match && match.score >= 40) {
      return { label: 'שווה בדיקה', cls: 'bg-amber-100 text-amber-700 border-amber-200' };
    }
    if (!match || match.score === 0) {
      return { label: 'חסר מידע', cls: 'bg-gray-100 text-gray-500 border-gray-200' };
    }
    return { label: 'שווה בדיקה', cls: 'bg-amber-100 text-amber-700 border-amber-200' };
  })();

  // Classify link quality based on URL patterns
  const classifyLinkQuality = (url: string | null, appUrl: string | null): string => {
    if ((url && (url.startsWith('mailto:') || url.includes('youtube') || url.includes('youtu.be'))) ||
        (appUrl && appUrl.startsWith('mailto:'))) return 'broken';
    if (appUrl && (appUrl.includes('docs.google.com/forms') || appUrl.includes('forms.office.com') ||
        appUrl.includes('monday.com') || appUrl.includes('my.pais.co.il') ||
        appUrl.includes('manof') || appUrl.includes('tmichot'))) return 'direct_application';
    if (url && (url.includes('docs.google.com/forms') || url.includes('forms.office.com') ||
        url.includes('my.pais.co.il') || url.includes('manof'))) return 'direct_application';
    if ((url && url.endsWith('.pdf')) || (appUrl && appUrl.endsWith('.pdf'))) return 'official_pdf';
    if (url && url.includes('shatil.org.il') && url !== 'https://www.shatil.org.il/') return 'aggregator_specific';
    if (url && url.includes('budgetkey') && url !== 'https://next.obudget.org/') return 'aggregator_specific';
    if (url && url.includes('ezvonot') && url !== 'https://ezvonot.com/') return 'aggregator_specific';
    if (url && /^https?:\/\/[^/]+\/?$/.test(url)) return 'homepage';
    if (url && (/\/(grants|apply|kolotkorim|tenders|kol-kore|calls|open-calls|funding|support|מענקים)/.test(url))) return 'general_listing';
    if (!url && !appUrl) return 'unknown';
    return 'direct_call_page';
  };

  const linkQuality = classifyLinkQuality(opp.url, opp.application_url);

  // Decide href and button label based on quality
  const isGoodLink = ['direct_application', 'official_pdf', 'direct_call_page', 'aggregator_specific'].includes(linkQuality);
  const sourceHref = isGoodLink
    ? (opp.application_url || opp.url)
    : null;
  const sourceBtnLabel =
    linkQuality === 'direct_application' ? 'פתח הגשה' :
    linkQuality === 'official_pdf' ? 'פתח קול קורא (PDF)' :
    linkQuality === 'direct_call_page' ? 'פתח קול קורא' :
    linkQuality === 'aggregator_specific' ? `פתח מקור ב-${opp.source || 'אגרגטור'}` :
    linkQuality === 'broken' ? 'לינק שבור' :
    'נסה למצוא לינק ישיר';
  const linkQualityLabel =
    linkQuality === 'direct_application' ? 'הגשה ישירה' :
    linkQuality === 'official_pdf' ? 'PDF רשמי' :
    linkQuality === 'aggregator_specific' ? `מקור: ${opp.source || 'אגרגטור'}` :
    linkQuality === 'general_listing' || linkQuality === 'homepage' || linkQuality === 'unknown' ? 'לינק דורש אימות' :
    linkQuality === 'broken' ? 'לינק שבור' :
    null;

  const handleAnalyzeInChat = (e: React.MouseEvent) => {
    e.stopPropagation();

    // Build structured opportunity context for deep analysis
    const oppContext: Record<string, unknown> = {
      id: opp.id,
      title: opp.title,
      funder: opp.funder || null,
      deadline: opp.deadline ? new Date(opp.deadline).toLocaleDateString('he-IL') : null,
      daysLeft: opp.deadline ? Math.ceil((new Date(opp.deadline).getTime() - Date.now()) / 86400000) : null,
      amount_min: opp.amount_min || null,
      amount_max: opp.amount_max || null,
      eligibility: opp.eligibility || null,
      description: opp.description ? opp.description.slice(0, 1200) : null,
      how_to_apply: (opp as unknown as Record<string, unknown>).how_to_apply || null,
      requirements: (opp as unknown as Record<string, unknown>).requirements || null,
      url: opp.url || null,
      application_url: opp.application_url || null,
      full_content: opp.full_content
        ? opp.full_content.slice(0, 6000)
        : null,
      match_score: match?.score ?? null,
      match_reasoning: match?.reasoning ?? null,
      match_pillars: match?.pillars ?? null,
      funder_style: funderMeta?.style ?? null,
      funder_approval_rate: funderMeta?.approval_rate ?? null,
      funder_writing_tips: funderMeta?.writing_tips ?? null,
    };

    // Dispatch to ChatPanel with full opportunity context
    window.dispatchEvent(new CustomEvent('fishgold:closeSidebar'));
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('fishgold:activeTab', { detail: 'opportunities' }));
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('fishgold:analyzeOpportunity', { detail: oppContext }));
      }, 30);
    }, 50);
  };

  return (
    <div
      className={`bg-surf rounded-xl border overflow-hidden hover:border-accent/30 transition-colors cursor-pointer ${match && match.score >= 80 ? 'border-green-200' : 'border-border'}`}
      onClick={() => setExpanded(!expanded)}
    >
      {/* ── HEADER ── */}
      <div className="p-3 pb-2">

      {/* Status tag */}
      <div className="flex items-center gap-1.5 mb-2">
        <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold border ${statusTag.cls}`}>
          {statusTag.label}
        </span>
        {match && match.score > 0 && (
          <span className={`text-[9px] font-medium ${matchColor.includes('green') ? 'text-green-700' : matchColor.includes('amber') ? 'text-amber-700' : 'text-gray-500'}`}>
            {match.score}% התאמה
          </span>
        )}
        {opp.type && TYPE_LABELS[opp.type] && (
          <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium mr-auto ${TYPE_COLORS[opp.type] || 'bg-gray-100 text-gray-600'}`}>
            {TYPE_LABELS[opp.type]}
          </span>
        )}
        {linkQualityLabel && (
          <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${
            linkQuality === 'direct_application' ? 'bg-green-100 text-green-700' :
            linkQuality === 'official_pdf' ? 'bg-blue-100 text-blue-700' :
            linkQuality === 'aggregator_specific' ? 'bg-amber-50 text-amber-600' :
            'bg-gray-100 text-gray-400'
          }`}>
            {linkQualityLabel}
          </span>
        )}
      </div>

      {/* Title */}
      <h4 className="text-[14px] font-bold leading-snug mb-1.5 line-clamp-2">{opp.title}</h4>

      {/* Funder */}
      {opp.funder && (
        <p className="text-[11px] text-muted mb-1.5">{opp.funder}</p>
      )}

      {/* Reliability indicators */}
      {(opp as unknown as Record<string, unknown>).reliability === 'placeholder' && (
        <span className="text-[9px] text-gray-400 bg-gray-50 border border-gray-200 rounded px-1.5 py-0.5 mb-1 inline-block">דורש אימות</span>
      )}
      {(linkQuality === 'general_listing' || linkQuality === 'homepage' || linkQuality === 'unknown') && (
        <div className="text-[9px] text-gray-400 mb-1 flex items-center gap-1">
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          לינק כללי — מומלץ לאמת ישירות
        </div>
      )}
      {(!opp.description || opp.description.length < 80) && (opp as unknown as Record<string, unknown>).reliability !== 'placeholder' && (
        <div className="text-[9px] text-amber-500 mb-1">חסר מידע לניתוח מלא</div>
      )}

      {/* Meta: amount + deadline */}
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

      {/* Reasoning (brief) */}
      {match?.reasoning && (
        <p className="text-[10px] text-muted leading-snug mb-2 line-clamp-2">{match.reasoning}</p>
      )}

      {/* Actions */}
      <div className="mt-2 space-y-1.5" onClick={e => e.stopPropagation()}>
        {/* Primary: Create draft — full width */}
        {orgId && (
          <button
            onClick={handlePrepareDraft}
            disabled={draftState === 'checking' || draftState === 'parsing' || draftState === 'generating'}
            className={`w-full py-2 text-[12px] font-bold rounded-lg active:scale-[0.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 ${
              draftState === 'done'
                ? 'bg-green-600 hover:bg-green-700 text-white'
                : 'bg-orange-500 hover:bg-orange-600 text-white'
            }`}
          >
            {(draftState === 'checking' || draftState === 'parsing' || draftState === 'generating') ? (
              <>
                <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                {draftState === 'checking' ? 'בודק...' : draftState === 'parsing' ? 'קורא קול קורא...' : 'כותב טיוטה...'}
              </>
            ) : draftState === 'done' ? (
              <>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                </svg>
                {draftIsExisting ? 'פתח טיוטה קיימת →' : 'פתח טיוטה לעריכה →'}
              </>
            ) : (
              'צור טיוטה לעריכה ←'
            )}
          </button>
        )}

        {/* Secondary actions row */}
        <div className="flex gap-1.5">
          <button
            onClick={handleAnalyzeInChat}
            className="flex-1 py-1.5 text-[10px] font-medium bg-surf2 border border-border text-muted rounded-lg hover:text-accent hover:border-accent/40 transition-colors"
          >
            נתח בצ׳אט
          </button>
          {linkQuality === 'broken' ? (
            <span className="flex-1 py-1.5 text-[10px] font-medium border border-red-200 bg-red-50 text-red-400 rounded-lg text-center flex items-center justify-center gap-1 cursor-not-allowed">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
              </svg>
              לינק שבור
            </span>
          ) : sourceHref ? (
            <a
              href={sourceHref}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className={`flex-1 py-1.5 text-[10px] font-medium border rounded-lg transition-colors text-center flex items-center justify-center gap-1 ${
                linkQuality === 'direct_application' ? 'bg-green-50 border-green-300 text-green-700 hover:bg-green-100' :
                linkQuality === 'official_pdf' ? 'bg-blue-50 border-blue-300 text-blue-700 hover:bg-blue-100' :
                linkQuality === 'direct_call_page' ? 'bg-accent/10 border-accent/40 text-accent hover:bg-accent/20' :
                'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100'
              }`}
              title={sourceBtnLabel}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
              {sourceBtnLabel}
            </a>
          ) : (
            <a
              href={`https://www.google.com/search?q=${encodeURIComponent(opp.title + ' ' + (opp.funder || '') + ' קול קורא')}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className="flex-1 py-1.5 text-[10px] font-medium border border-dashed border-gray-300 bg-gray-50 text-gray-400 rounded-lg transition-colors text-center flex items-center justify-center gap-1 hover:text-gray-600 hover:border-gray-400"
              title="הלינק דורש אימות — חיפוש בגוגל"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              {sourceBtnLabel}
            </a>
          )}
        </div>
      </div>

      {/* Draft done state — banner */}
      {draftState === 'done' && shareUrl && (
        <div className="mt-2 bg-green-50 border border-green-200 rounded-lg p-2.5 space-y-1.5" onClick={e => e.stopPropagation()}>
          <div className="text-[11px] font-semibold text-green-800">
            {draftIsExisting ? '✓ טיוטה קיימת' : '✓ טיוטה נוצרה'}
            {draftTitle ? ` — ${draftTitle}` : ''}
          </div>
          {draftError && (
            <div className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">{draftError}</div>
          )}
          <div className="flex items-center gap-2">
            <a
              href={shareUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-[10px] bg-green-700 text-white px-2.5 py-1 rounded-md hover:bg-green-800 font-medium"
            >
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
              פתח לעריכה
            </a>
            {!draftIsExisting && (
              <button
                onClick={() => { setDraftState('idle'); setShareUrl(null); setDraftTitle(null); }}
                className="text-[9px] text-green-600 hover:underline"
              >
                צור טיוטה חדשה
              </button>
            )}
          </div>
        </div>
      )}

      {/* Draft error */}
      {draftState === 'error' && draftError && (
        <div className="mt-1.5 bg-red-50 border border-red-200 rounded-lg p-2" onClick={e => e.stopPropagation()}>
          <div className="text-[10px] text-red-600">{draftError}</div>
          <div className="flex items-center gap-2 mt-1">
            <button onClick={e => { e.stopPropagation(); setDraftState('idle'); }} className="text-[9px] text-accent hover:underline">
              נסה שוב
            </button>
            {(opp.application_url || opp.url) && (
              <a
                href={opp.application_url || opp.url || '#'}
                target="_blank"
                rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                className="text-[9px] text-blue-600 hover:underline"
              >
                פתח קול קורא ישירות ↗
              </a>
            )}
          </div>
        </div>
      )}

      </div>

      {/* ── EXPANDED DETAILS ── */}
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

          {/* Doc Progress Bar (advanced) */}
          {orgId && <DocProgressBar opportunityId={opp.id} orgId={orgId} />}

          {/* Readiness check (advanced) */}
          {orgId && (
            <div className="px-3 pb-2">
              {!readiness && !loadingReadiness && (
                <button
                  onClick={e => {
                    e.stopPropagation();
                    setLoadingReadiness(true);
                    fetch(`/api/opportunities/readiness?org_id=${orgId}&opportunity_id=${opp.id}`, { credentials: 'include' })
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

          {/* Share row */}
          <div className="border-t border-border bg-surf2/40 px-3 py-2 flex items-center justify-end gap-1">
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
    fetch(`/api/opportunities/doc-gap?org_id=${orgId}&opportunity_id=${opportunityId}`, { credentials: 'include' })
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
    fetch(`/api/opportunities/doc-gap?org_id=${orgId}&opportunity_id=${opportunityId}`, { credentials: 'include' })
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
