'use client';

import { useEffect, useState } from 'react';

interface UrgentOpportunity {
  id: string;
  title: string;
  deadline?: string | null;
  score?: number;
}

interface WhatUrgentNowProps {
  orgId: string;
}

function navigateToTab(tab: string) {
  window.dispatchEvent(new CustomEvent('fishgold:activeTab', { detail: tab }));
  const url = new URL(window.location.href);
  url.searchParams.set('tab', tab);
  window.history.replaceState({}, '', url.toString());
}

function formatDeadline(deadline: string | null | undefined): { text: string; urgent: boolean } | null {
  if (!deadline) return null;
  try {
    const d = new Date(deadline);
    const now = new Date();
    const diffDays = Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return null;
    if (diffDays === 0) return { text: 'היום!', urgent: true };
    if (diffDays <= 7) return { text: `${diffDays} ימים`, urgent: true };
    if (diffDays <= 21) return { text: `${diffDays} ימים`, urgent: false };
    return { text: d.toLocaleDateString('he-IL', { day: 'numeric', month: 'long' }), urgent: false };
  } catch {
    return null;
  }
}

// Skeleton card during loading
function SkeletonCard() {
  return (
    <div className="bg-bg2 border border-border rounded-2xl p-5 animate-pulse">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-surf2 flex-shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-3 bg-surf2 rounded w-24" />
          <div className="h-4 bg-surf2 rounded w-3/4" />
          <div className="h-3 bg-surf2 rounded w-1/2" />
          <div className="h-7 bg-surf2 rounded-lg w-28 mt-3" />
        </div>
      </div>
    </div>
  );
}

export default function WhatUrgentNow({ orgId }: WhatUrgentNowProps) {
  const [opportunity, setOpportunity] = useState<UrgentOpportunity | null | 'none'>('none');
  const [missingDocs, setMissingDocs] = useState<string[]>([]);
  const [companiesCount, setCompaniesCount] = useState<number | null>(null);
  const [profileScore, setProfileScore] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId) return;

    async function load() {
      try {
        const [oppRes, orgRes] = await Promise.all([
          fetch(`/api/opportunities?org_id=${orgId}&limit=1`).then(r => r.json()).catch(() => ({})),
          fetch(`/api/org?org_id=${orgId}`).then(r => r.json()).catch(() => ({})),
        ]);

        // Best opportunity
        const opps: UrgentOpportunity[] = oppRes.opportunities || oppRes.results || oppRes.data || [];
        setOpportunity(opps.length > 0 ? opps[0] : null);

        // Missing docs
        const docs: { filename?: string }[] = orgRes.documents || [];
        const found = new Set(docs.map(d => (d.filename || '').toLowerCase()));
        const REQUIRED_PATTERNS = [
          { label: 'ניהול תקין', pattern: /ניהול תקין/i },
          { label: 'סעיף 46', pattern: /סעיף 46|אישור 46/i },
          { label: 'דוח כספי', pattern: /דוח כספי|דוחות כספיים/i },
        ];
        const missing = REQUIRED_PATTERNS
          .filter(r => ![...found].some(f => r.pattern.test(f)))
          .map(r => r.label)
          .slice(0, 2);
        setMissingDocs(missing);

        // Profile score
        const profile = orgRes.profile;
        if (orgRes.score?.total !== undefined) {
          setProfileScore(Math.round(orgRes.score.total));
        } else if (profile) {
          let sc = 0;
          if (profile.name) sc += 20;
          if (profile.mission) sc += 20;
          if (profile.domains?.length) sc += 20;
          if (profile.populations?.length) sc += 20;
          if (docs.length > 0) sc += 20;
          setProfileScore(sc);
        }

        // Companies count
        try {
          const bizRes = await fetch(`/api/companies?org_id=${orgId}&limit=1`).then(r => r.json());
          const count = bizRes.total ?? bizRes.count ?? bizRes.data?.length ?? null;
          setCompaniesCount(typeof count === 'number' ? count : null);
        } catch {
          setCompaniesCount(null);
        }
      } catch {
        // silent
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [orgId]);

  const score = profileScore ?? 0;
  const deadline = opportunity && opportunity !== 'none' ? formatDeadline(opportunity.deadline) : null;

  // Count actionable items for the status bar
  const actionCount = [
    opportunity && opportunity !== 'none',
    missingDocs.length > 0,
  ].filter(Boolean).length;

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto" dir="rtl">

      {/* Header */}
      <div className="mb-5">
        <div className="flex items-baseline justify-between gap-3 mb-1">
          <h1 className="text-[17px] font-bold tracking-tight">מה דחוף עכשיו</h1>
          {!loading && actionCount > 0 && (
            <span className="text-[11px] font-medium text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full flex-shrink-0">
              {actionCount} דבר{actionCount > 1 ? 'ים' : ''} לטיפול
            </span>
          )}
        </div>
        <p className="text-[12px] text-muted leading-relaxed">
          Goldfish בדק את הארגון, ההזדמנויות והמסמכים. אלה הדברים שכדאי לעשות קודם.
        </p>
      </div>

      {/* Cards grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">

        {loading ? (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        ) : (
          <>
            {/* Card 1: Urgent opportunity */}
            <div className={`relative bg-bg2 border rounded-2xl p-5 flex flex-col gap-3 transition-all hover:shadow-sm ${
              opportunity && opportunity !== 'none'
                ? 'border-accent/25 hover:border-accent/40'
                : 'border-border'
            }`}>
              {/* Top accent line when opportunity exists */}
              {opportunity && opportunity !== 'none' && (
                <div className="absolute top-0 right-0 left-0 h-[2px] bg-accent rounded-t-2xl opacity-60" />
              )}
              <div className="flex items-center gap-2.5">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
                  opportunity && opportunity !== 'none' ? 'bg-accent/10' : 'bg-surf2'
                }`}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                    className={opportunity && opportunity !== 'none' ? 'text-accent' : 'text-muted'}>
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                  </svg>
                </div>
                <p className="text-[11px] font-semibold text-muted uppercase tracking-wide">הזדמנות דחופה</p>
              </div>

              {opportunity && opportunity !== 'none' ? (
                <>
                  <div>
                    <p className="font-bold text-[14px] leading-snug mb-2 line-clamp-2">{opportunity.title}</p>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {deadline && (
                        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-md ${
                          deadline.urgent
                            ? 'bg-red-50 text-red-600 border border-red-200'
                            : 'bg-amber-50 text-amber-700 border border-amber-200'
                        }`}>
                          {deadline.urgent ? '⏰ ' : ''}{deadline.text}
                        </span>
                      )}
                      {!!opportunity.score && (
                        <span className="text-[11px] font-medium bg-green-50 text-green-700 border border-green-200 px-2 py-0.5 rounded-md">
                          {opportunity.score}% התאמה
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => navigateToTab('opportunities')}
                    className="mt-auto w-full py-2 text-[12px] font-bold bg-accent text-white rounded-xl hover:bg-accent-hover active:scale-[0.98] transition-all"
                  >
                    נתח והכן טיוטה ←
                  </button>
                </>
              ) : (
                <>
                  <p className="text-[13px] text-muted leading-relaxed">עוד אין הזדמנות דחופה. המאגר מתעדכן יומיומית.</p>
                  <button
                    onClick={() => navigateToTab('opportunities')}
                    className="mt-auto w-full py-2 text-[12px] font-medium border border-border rounded-xl hover:bg-surf2 hover:border-accent/30 transition-all"
                  >
                    ראו את כל ההזדמנויות
                  </button>
                </>
              )}
            </div>

            {/* Card 2: Missing docs */}
            <div className={`bg-bg2 border rounded-2xl p-5 flex flex-col gap-3 transition-all hover:shadow-sm ${
              missingDocs.length > 0 ? 'border-amber-200/60 hover:border-amber-300' : 'border-border'
            }`}>
              <div className="flex items-center gap-2.5">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
                  missingDocs.length > 0 ? 'bg-amber-500/10' : 'bg-green-500/10'
                }`}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                    className={missingDocs.length > 0 ? 'text-amber-500' : 'text-green-500'}>
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    {missingDocs.length === 0 && <polyline points="9 15 11 17 15 13" />}
                  </svg>
                </div>
                <p className="text-[11px] font-semibold text-muted uppercase tracking-wide">תיק מסמכים</p>
              </div>

              {missingDocs.length > 0 ? (
                <>
                  <div>
                    <p className="text-[12px] text-amber-700 font-medium mb-2">חסרים {missingDocs.length} מסמכים קריטיים</p>
                    <div className="flex flex-wrap gap-1.5">
                      {missingDocs.map(doc => (
                        <span key={doc} className="text-[11px] bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-md">
                          {doc}
                        </span>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <p className="text-[13px] text-muted leading-relaxed">המסמכים הבסיסיים נמצאים. תמיד אפשר להוסיף עוד.</p>
              )}

              <button
                onClick={() => navigateToTab('org')}
                className="mt-auto w-full py-2 text-[12px] font-medium border border-border rounded-xl hover:bg-surf2 hover:border-accent/30 transition-all"
              >
                השלימו תיק ארגון
              </button>
            </div>

            {/* Card 3: Companies */}
            <div className="bg-bg2 border border-border rounded-2xl p-5 flex flex-col gap-3 transition-all hover:shadow-sm hover:border-purple-200">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-purple-500/10 flex items-center justify-center flex-shrink-0">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-purple-500">
                    <rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" /><line x1="12" y1="12" x2="12" y2="16" /><line x1="10" y1="14" x2="14" y2="14" />
                  </svg>
                </div>
                <p className="text-[11px] font-semibold text-muted uppercase tracking-wide">חברות ועסקים</p>
              </div>

              {companiesCount !== null && companiesCount > 0 ? (
                <div>
                  <p className="text-[24px] font-bold text-purple-600 leading-none mb-1">{companiesCount.toLocaleString()}</p>
                  <p className="text-[12px] text-muted">חברות שכדאי לפנות אליהן</p>
                </div>
              ) : (
                <p className="text-[13px] text-muted leading-relaxed">חברות ועסקים ממתינים אחרי השלמת פרופיל הארגון.</p>
              )}

              <button
                onClick={() => navigateToTab('business')}
                className="mt-auto w-full py-2 text-[12px] font-medium border border-border rounded-xl hover:bg-surf2 hover:border-purple-200 transition-all"
              >
                ראו חברות ועסקים
              </button>
            </div>

            {/* Card 4: Profile familiarity */}
            <div className="bg-bg2 border border-border rounded-2xl p-5 flex flex-col gap-3 transition-all hover:shadow-sm hover:border-blue-200">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-500">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
                  </svg>
                </div>
                <p className="text-[11px] font-semibold text-muted uppercase tracking-wide">היכרות Goldfish</p>
              </div>

              <div>
                <div className="flex items-baseline gap-1.5 mb-2">
                  <span className={`text-[28px] font-bold leading-none ${
                    score >= 80 ? 'text-green-600' : score >= 50 ? 'text-accent' : 'text-amber-600'
                  }`}>{score}%</span>
                  <span className="text-[12px] text-muted">מכירים אתכם</span>
                </div>
                <div className="w-full h-1.5 bg-surf2 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${
                      score >= 80 ? 'bg-green-500' : score >= 50 ? 'bg-accent' : 'bg-amber-500'
                    }`}
                    style={{ width: `${score}%` }}
                  />
                </div>
                {score < 60 && (
                  <p className="text-[11px] text-muted mt-1.5">ככל שנדע יותר, ההתאמות יהיו מדויקות יותר.</p>
                )}
              </div>

              <button
                onClick={() => navigateToTab('org')}
                className="mt-auto w-full py-2 text-[12px] font-medium border border-border rounded-xl hover:bg-surf2 hover:border-blue-200 transition-all"
              >
                שפר פרופיל ←
              </button>
            </div>
          </>
        )}
      </div>

      {/* Chat CTA */}
      {!loading && (
        <div className="mt-5 flex items-center justify-center gap-2">
          <div className="h-px bg-border flex-1" />
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('fishgold:focusChat'))}
            className="text-[11px] text-muted hover:text-accent transition-colors flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-surf2"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
            </svg>
            שאלו את Goldfish שאלה חופשית
          </button>
          <div className="h-px bg-border flex-1" />
        </div>
      )}
    </div>
  );
}
