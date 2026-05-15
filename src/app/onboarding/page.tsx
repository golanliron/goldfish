'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import FishLogo from '@/components/chat/FishLogo';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';

interface UploadedFile {
  name: string;
  category: string;
  summary: string;
  status: 'uploading' | 'done' | 'error';
}

export default function OnboardingPage() {
  const [ready, setReady] = useState(false);
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [driveUrl, setDriveUrl] = useState('');
  const [urlLoading, setUrlLoading] = useState<string | null>(null);
  const [urlDone, setUrlDone] = useState<string[]>([]);
  const [finishing, setFinishing] = useState(false);
  const [showWow, setShowWow] = useState(false);
  const [wowMatches, setWowMatches] = useState<Array<{ id: string; title: string; funder: string; deadline: string | null; score: number; amount_min: number | null; amount_max: number | null; type: string }>>([]);
  const [wowLoading, setWowLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [orgName, setOrgName] = useState('');
  const [orgDesc, setOrgDesc] = useState('');
  const [orgPopulation, setOrgPopulation] = useState('');
  const [selectedPopulations, setSelectedPopulations] = useState<string[]>([]);
  const [selectedDomains, setSelectedDomains] = useState<string[]>([]);
  const [urlResults, setUrlResults] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const { orgId: authOrgId, loading: authLoading, user } = useAuth();
  const [localOrgId, setLocalOrgId] = useState<string | null>(null);
  const orgId = authOrgId || localOrgId;
  const router = useRouter();

  useEffect(() => {
    if (authOrgId || !user) return;
    const supabase = createClient();
    let cancelled = false;
    const tryFetch = (attempt: number) => {
      supabase.from('users').select('org_id').eq('id', user.id).single()
        .then(({ data }) => {
          if (cancelled) return;
          if (data?.org_id) {
            setLocalOrgId(data.org_id);
          } else if (attempt < 3) {
            setTimeout(() => tryFetch(attempt + 1), 1500);
          }
        }, () => {
          if (!cancelled && attempt < 3) setTimeout(() => tryFetch(attempt + 1), 1500);
        });
    };
    tryFetch(0);
    return () => { cancelled = true; };
  }, [authOrgId, user]);

  useEffect(() => {
    const globalTimeout = setTimeout(() => {
      if (!ready) setReady(true);
    }, 5000);
    return () => clearTimeout(globalTimeout);
  }, []);

  useEffect(() => {
    const isPreviewMode = typeof window !== 'undefined' && window.location.search.includes('preview=1');
    if (isPreviewMode) {
      setReady(true);
      // In preview mode, skip auth and show onboarding directly
      return;
    }
    if (authLoading) return;
    if (!orgId) { setReady(true); return; }

    const supabase = createClient();
    supabase
      .from('org_profiles')
      .select('data')
      .eq('org_id', orgId)
      .single()
      .then(({ data: profile }) => {
        const d = profile?.data as Record<string, unknown> | null;
        const isEditMode = window.location.search.includes('edit=1');
        const isPreview = window.location.search.includes('preview=1');
        if (d?.onboarding_complete && !isEditMode && !isPreview) {
          window.location.href = '/';
        } else {
          if (d?.name) setOrgName(d.name as string);
          if (d?.summary) setOrgDesc(d.summary as string);
          if (Array.isArray(d?.target_populations) && d.target_populations[0]) setOrgPopulation(d.target_populations[0] as string);
          if (Array.isArray(d?.populations)) setSelectedPopulations(d.populations as string[]);
          if (Array.isArray(d?.domains)) setSelectedDomains(d.domains as string[]);
          setReady(true);
        }
      }, () => setReady(true));
  }, [orgId, authLoading]);

  const uploadFile = async (file: File, index: number) => {
    if (!orgId) {
      setFiles(prev => prev.map((f, i) => i === index ? { ...f, status: 'error' } : f));
      return;
    }

    const MAX_BYTES = 50 * 1024 * 1024;
    if (file.size > MAX_BYTES) {
      setFiles(prev => prev.map((f, i) => i === index ? { ...f, status: 'error' } : f));
      return;
    }

    try {
      // Step 1: Get signed upload URL + create document record (status=processing)
      const urlRes = await fetch('/api/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(orgId ? { 'x-org-id': orgId } : {}) },
        body: JSON.stringify({ filename: file.name, fileSize: file.size }),
      });
      const urlData = await urlRes.json();

      if (!urlRes.ok) {
        setFiles(prev => prev.map((f, i) => i === index ? { ...f, status: 'error' } : f));
        return;
      }

      // Already exists
      if (urlData.already_exists) {
        setFiles(prev => prev.map((f, i) => i === index
          ? { ...f, status: 'done', category: urlData.category, summary: urlData.summary }
          : f
        ));
        return;
      }

      // Step 2: Upload directly to Supabase Storage via signed URL
      const uploadRes = await fetch(urlData.signed_url, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });

      if (!uploadRes.ok) {
        // Document record exists as processing — mark error via process-upload
        await fetch('/api/process-upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ document_id: urlData.document_id }),
        });
        setFiles(prev => prev.map((f, i) => i === index ? { ...f, status: 'error' } : f));
        return;
      }

      // Step 3: Trigger processing (synchronous — waits for AI enrichment)
      const processRes = await fetch('/api/process-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document_id: urlData.document_id }),
      });
      const processData = await processRes.json();

      if (processRes.ok) {
        setFiles(prev => prev.map((f, i) => i === index
          ? { ...f, status: 'done', category: processData.category, summary: processData.summary }
          : f
        ));
      } else {
        // Processing failed — document exists in DB with status=error
        setFiles(prev => prev.map((f, i) => i === index ? { ...f, status: 'error' } : f));
      }
    } catch {
      setFiles(prev => prev.map((f, i) => i === index ? { ...f, status: 'error' } : f));
    }
  };

  const handleFiles = (fileList: FileList | null) => {
    if (!fileList) return;
    const newFiles = Array.from(fileList);
    const startIndex = files.length;
    setFiles(prev => [
      ...prev,
      ...newFiles.map(f => ({ name: f.name, category: '', summary: '', status: 'uploading' as const })),
    ]);
    // Upload sequentially to avoid Gemini rate limiting
    (async () => {
      for (let i = 0; i < newFiles.length; i++) {
        await uploadFile(newFiles[i], startIndex + i);
      }
    })();
  };

  const learnUrl = async (url: string, label: string) => {
    if (!url.trim()) return;
    if (!orgId) {
      setUrlResults(prev => ({ ...prev, [label]: 'טוען נתוני ארגון... נסו שוב בעוד שנייה' }));
      return;
    }
    setUrlLoading(label);
    try {
      const res = await fetch('/api/learn-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: orgId, url: url.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setUrlDone(prev => [...prev, label]);
        setUrlResults(prev => ({ ...prev, [label]: data.summary || data.title || 'נקרא בהצלחה' }));
      } else {
        setUrlResults(prev => ({ ...prev, [label]: data.error || 'לא הצלחתי לקרוא' }));
      }
    } catch {
      setUrlResults(prev => ({ ...prev, [label]: 'שגיאת רשת' }));
    }
    setUrlLoading(null);
  };

  const finish = async () => {
    setFinishing(true);
    try {
      // Auto-submit any URLs that were typed but not manually sent
      const pendingUrls: Array<[string, string]> = [];
      if (websiteUrl.trim() && !urlDone.includes('website')) pendingUrls.push([websiteUrl.trim(), 'website']);
      if (driveUrl.trim() && !urlDone.includes('drive')) pendingUrls.push([driveUrl.trim(), 'drive']);

      if (pendingUrls.length > 0 && orgId) {
        await Promise.all(pendingUrls.map(([url, label]) => learnUrl(url, label)));
      }

      if (orgId) {
        const supabase = createClient();
        const { data: profile } = await supabase
          .from('org_profiles')
          .select('data')
          .eq('org_id', orgId)
          .single();

        const currentData = (profile?.data as Record<string, unknown>) || {};
        await supabase.from('org_profiles').upsert({
          org_id: orgId,
          data: {
            ...currentData,
            ...(orgName.trim() ? { name: orgName.trim() } : {}),
            ...(orgDesc.trim() ? { summary: orgDesc.trim() } : {}),
            ...(orgPopulation.trim() ? { target_populations: [orgPopulation.trim()] } : {}),
            ...(selectedPopulations.length > 0 ? { populations: selectedPopulations } : {}),
            ...(selectedDomains.length > 0 ? { domains: selectedDomains } : {}),
            onboarding_complete: true,
          },
          last_updated: new Date().toISOString(),
        }, { onConflict: 'org_id' });
      }
    } catch (e) {
      console.error('Onboarding finish error:', e);
    }

    // Fetch top matches for WOW screen
    if (orgId) {
      setWowLoading(true);
      try {
        const res = await fetch(`/api/opportunities?org_id=${orgId}`);
        if (res.ok) {
          const data = await res.json();
          const top = (data.opportunities || [])
            .filter((o: Record<string, unknown>) => (o.matchScore as number) >= 50)
            .sort((a: Record<string, unknown>, b: Record<string, unknown>) => (b.matchScore as number) - (a.matchScore as number))
            .slice(0, 6)
            .map((o: Record<string, unknown>) => ({
              id: String(o.id),
              title: String(o.title),
              funder: String(o.funder || ''),
              deadline: o.deadline ? String(o.deadline) : null,
              score: o.matchScore as number,
              amount_min: o.amount_min as number | null,
              amount_max: o.amount_max as number | null,
              type: String(o.type || ''),
            }));
          setWowMatches(top);
        }
      } catch {
        // silently ignore — will still show WOW with 0 matches
      }
      setWowLoading(false);
    }

    setFinishing(false);
    setShowWow(true);
  };

  const categoryLabels: Record<string, string> = {
    identity: 'זהות ארגוני',
    budget: 'דוח כספי',
    project: 'פרויקט',
    grant: 'מענק',
    submission: 'הגשה',
    other: 'מסמך',
  };

  const hasContent = orgName.trim() || orgDesc.trim() || files.length > 0 || urlDone.length > 0;

  if (!ready) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-bg gap-3">
        <FishLogo size={48} className="swim" />
        <p className="text-sm text-muted animate-pulse">שוחה בשבילך נגד הזרם...</p>
      </div>
    );
  }

  if (ready && !orgId && !authLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-bg gap-4 p-4">
        <FishLogo size={48} />
        <h2 className="text-lg font-semibold">משהו השתבש בהרשמה</h2>
        <p className="text-sm text-muted text-center max-w-xs">
          לא הצלחתי לאתחל את הארגון שלך. נסי להתנתק ולהירשם מחדש.
        </p>
        <button
          onClick={async () => {
            const supabase = createClient();
            await supabase.auth.signOut();
            window.location.href = '/signup';
          }}
          className="px-6 py-2.5 rounded-xl bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-colors"
        >
          חזרה להרשמה
        </button>
      </div>
    );
  }

  if (showWow) {
    // Calculate familiarity score
    const familiarityScore = Math.min(100, Math.round(
      (orgName.trim() ? 15 : 0) +
      (orgDesc.trim() ? 20 : 0) +
      (selectedPopulations.length > 0 ? 15 : 0) +
      (selectedDomains.length > 0 ? 10 : 0) +
      (urlDone.includes('website') ? 20 : 0) +
      (urlDone.includes('drive') ? 10 : 0) +
      (files.filter(f => f.status === 'done').length * 5)
    ));

    return (
      <div className="min-h-screen bg-bg flex flex-col items-center justify-center px-4 py-12" dir="rtl">
        <div className="max-w-lg w-full">

          {/* Header */}
          <div className="text-center mb-8">
            <div className="flex items-center justify-center gap-2 mb-5">
              <FishLogo size={40} className="swim" />
              <span className="font-bold text-xl tracking-tight">Goldfish</span>
            </div>
            {wowLoading ? (
              <p className="text-sm text-muted animate-pulse">דג לכם הזדמנויות...</p>
            ) : wowMatches.length > 0 ? (
              <>
                <div className="inline-block bg-accent/10 text-accent text-xs font-semibold px-3 py-1 rounded-full mb-4">
                  {wowMatches.length} קולות קוראים וקרנות שמתאימים לכם עכשיו
                </div>
                <h1 className="text-2xl font-bold leading-snug">
                  מצאנו כסף<br />שמחכה לכם
                </h1>
              </>
            ) : (
              <>
                <div className="inline-block bg-green-100 text-green-700 text-xs font-semibold px-3 py-1 rounded-full mb-4">
                  הפרופיל נשמר בהצלחה
                </div>
                <h1 className="text-2xl font-bold leading-snug">
                  גולדפיש כבר<br />מחפש בשבילכם
                </h1>
              </>
            )}
          </div>

          {/* Familiarity meter */}
          <div className="bg-bg2 border border-border rounded-2xl p-4 mb-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-text">כמה גולדפיש מכיר אתכם</span>
              <span className="text-sm font-bold text-accent">{familiarityScore}%</span>
            </div>
            <div className="h-2 bg-border rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${familiarityScore}%`,
                  background: familiarityScore >= 70 ? '#22c55e' : familiarityScore >= 40 ? '#f59e0b' : '#E8358A',
                }}
              />
            </div>
            {familiarityScore < 60 && (
              <p className="text-[10px] text-muted mt-2">
                הוסיפו מסמכים ואתר הארגון כדי שגולדפיש יכיר אתכם טוב יותר ויתאים הצעות מדויקות יותר
              </p>
            )}
          </div>

          {/* Matches list */}
          {!wowLoading && wowMatches.length > 0 && (
            <div className="space-y-3 mb-8">
              {wowMatches.map((m) => (
                <div key={m.id} className="bg-bg2 border border-border rounded-2xl p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm leading-snug mb-1 line-clamp-2">{m.title}</p>
                      {m.funder && (
                        <p className="text-xs text-muted">{m.funder}</p>
                      )}
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        {m.type && (
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium border ${
                            m.type === 'foundation' ? 'bg-purple-50 text-purple-700 border-purple-200' :
                            m.type === 'government' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                            m.type === 'corporate' ? 'bg-green-50 text-green-700 border-green-200' :
                            'bg-gray-50 text-gray-600 border-gray-200'
                          }`}>
                            {m.type === 'foundation' ? 'קרן' : m.type === 'government' ? 'ממשלה' : m.type === 'corporate' ? 'CSR' : m.type}
                          </span>
                        )}
                        {m.deadline && (
                          <span className="text-[11px] text-orange-600 bg-orange-50 border border-orange-200 px-2 py-0.5 rounded-full">
                            עד {new Date(m.deadline).toLocaleDateString('he-IL', { day: 'numeric', month: 'long' })}
                          </span>
                        )}
                        {(m.amount_min || m.amount_max) && (
                          <span className="text-[11px] text-muted">
                            {m.amount_max
                              ? `עד ₪${m.amount_max.toLocaleString()}`
                              : m.amount_min
                              ? `מ-₪${m.amount_min.toLocaleString()}`
                              : ''}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex-shrink-0 text-center">
                      <div className="w-10 h-10 rounded-full bg-accent/10 border-2 border-accent flex items-center justify-center">
                        <span className="text-accent font-bold text-sm">{m.score}%</span>
                      </div>
                      <p className="text-[9px] text-muted mt-1">התאמה</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Loading state */}
          {wowLoading && (
            <div className="flex flex-col items-center gap-3 py-10 mb-8">
              <FishLogo size={32} className="swim" />
              <p className="text-sm text-muted">סורק {223} קולות קוראים פעילים...</p>
            </div>
          )}

          {/* CTA */}
          <button
            onClick={() => { window.location.href = '/dashboard?tab=opportunities'; }}
            className="w-full py-3.5 bg-accent text-white font-semibold rounded-xl hover:bg-accent-hover transition-all hover:scale-[1.02] active:scale-[0.98] text-sm"
          >
            {wowMatches.length > 0 ? 'בואו נגש לעבודה' : 'כניסה לדשבורד'}
          </button>

          {wowMatches.length > 0 && (
            <p className="text-center text-[11px] text-muted mt-3">
              תמיד אפשר להוסיף מסמכים ולשפר את ההתאמה
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg" dir="rtl">
      <div className="max-w-lg mx-auto px-4 py-10">

        {/* Hero */}
        <div className="text-center mb-10">
          <div className="flex items-center justify-center gap-2 mb-5">
            <FishLogo size={36} className="swim" />
            <span className="font-bold text-xl tracking-tight">Goldfish</span>
          </div>
          <div className="inline-block bg-accent/10 text-accent text-xs font-semibold px-3 py-1 rounded-full mb-4">
            עוד רגע תחשפו להצעות וקולות קוראים שמתאימים בדיוק לכם
          </div>
          <h1 className="text-2xl font-bold mb-2 leading-snug">
            קודם תנו לגולדפיש<br />להכיר אתכם
          </h1>
          <p className="text-sm text-muted leading-relaxed">
            גולדפיש דג מענקים לאלפי עמותות — אבל הוא עובד בשבילכם רק אם הוא מכיר אתכם.
          </p>
        </div>

        {/* Section 1: Basic info */}
        <div className="bg-bg2 rounded-2xl border border-border p-5 mb-4">
          <div className="flex items-center gap-2 mb-4">
            <span className="w-6 h-6 rounded-full bg-accent text-white text-xs font-bold flex items-center justify-center flex-shrink-0">1</span>
            <h3 className="font-semibold">הארגון שלכם</h3>
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted block mb-1">שם הארגון</label>
              <input
                type="text"
                value={orgName}
                onChange={e => setOrgName(e.target.value)}
                placeholder="למשל: עמותת הופה"
                className="w-full px-3 py-2.5 rounded-xl border border-border bg-surf text-sm focus:outline-none focus:border-accent transition-colors"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-muted block mb-1">מה אתם עושים? <span className="text-muted/60">(2-3 משפטים)</span></label>
              <textarea
                value={orgDesc}
                onChange={e => setOrgDesc(e.target.value)}
                placeholder="תארו את הפעילות, המטרה, והאנשים שאתם משרתים..."
                rows={3}
                className="w-full px-3 py-2.5 rounded-xl border border-border bg-surf text-sm focus:outline-none focus:border-accent transition-colors resize-none leading-relaxed"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-muted block mb-1">מי הם המוטבים שלכם? <span className="text-muted/60">(בחרו הכל שרלוונטי)</span></label>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { key: 'youth_at_risk', label: 'נוער בסיכון' },
                  { key: 'youth', label: 'נוער / ילדים' },
                  { key: 'young_adults', label: 'צעירים (18-26)' },
                  { key: 'women', label: 'נשים' },
                  { key: 'elderly', label: 'קשישים' },
                  { key: 'disabilities', label: 'אנשים עם מוגבלות' },
                  { key: 'immigrants', label: 'עולים / אתיופים' },
                  { key: 'arab', label: 'חברה ערבית' },
                  { key: 'haredi', label: 'חרדים' },
                  { key: 'homeless', label: 'חסרי בית' },
                  { key: 'soldiers', label: 'חיילים / משוחררים' },
                  { key: 'addiction', label: 'התמכרויות' },
                  { key: 'lgbtq', label: 'להט"ב' },
                  { key: 'general', label: 'אוכלוסייה כללית' },
                ].map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSelectedPopulations(prev =>
                      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
                    )}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                      selectedPopulations.includes(key)
                        ? 'bg-accent text-white border-accent'
                        : 'bg-surf border-border text-muted hover:border-accent/50'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-muted block mb-1">תחומי פעילות <span className="text-muted/60">(בחרו הכל שרלוונטי)</span></label>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { key: 'education', label: 'חינוך' },
                  { key: 'welfare', label: 'רווחה' },
                  { key: 'employment', label: 'תעסוקה' },
                  { key: 'health', label: 'בריאות' },
                  { key: 'mental_health', label: 'בריאות הנפש' },
                  { key: 'community', label: 'קהילה' },
                  { key: 'social_innovation', label: 'חדשנות חברתית' },
                  { key: 'dropout_prevention', label: 'מניעת נשירה' },
                  { key: 'technology', label: 'טכנולוגיה' },
                  { key: 'culture', label: 'תרבות' },
                  { key: 'coexistence', label: 'דו-קיום' },
                  { key: 'legal', label: 'זכויות וייצוג' },
                  { key: 'housing', label: 'דיור' },
                  { key: 'environment', label: 'סביבה' },
                ].map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSelectedDomains(prev =>
                      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
                    )}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                      selectedDomains.includes(key)
                        ? 'bg-accent text-white border-accent'
                        : 'bg-surf border-border text-muted hover:border-accent/50'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Section 2: Documents */}
        <div className="bg-bg2 rounded-2xl border border-border p-5 mb-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-6 h-6 rounded-full bg-accent text-white text-xs font-bold flex items-center justify-center flex-shrink-0">2</span>
            <h3 className="font-semibold">מסמכים</h3>
          </div>
          <p className="text-xs text-muted mb-4 mr-8">
            אודות הארגון, מצגות, דוחות כספיים, הגשות קודמות — ככל שיותר, כך גולדפיש ידייק יותר.
          </p>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.doc,.docx,.txt,.csv,.xlsx,.xls,.html,.pptx,.ppt"
            onChange={e => handleFiles(e.target.files)}
            className="hidden"
          />
          <div
            ref={dropRef}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragEnter={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={e => { e.preventDefault(); if (dropRef.current && !dropRef.current.contains(e.relatedTarget as Node)) setDragging(false); }}
            onDrop={e => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}
            className={`w-full py-7 border-2 border-dashed rounded-xl text-sm cursor-pointer transition-all text-center ${
              dragging
                ? 'border-accent bg-accent/5 text-accent scale-[1.02]'
                : 'border-border text-muted hover:border-accent hover:text-accent'
            }`}
          >
            {dragging ? 'שחררו כאן' : 'גררו קבצים לכאן או לחצו לבחירה'}
            <span className="block text-[10px] mt-1 opacity-60">PDF, Word, Excel, PPT</span>
          </div>

          {files.length > 0 && (
            <div className="space-y-1.5 mt-3">
              {files.map((f, i) => (
                <div key={i}>
                  <div className="flex items-center gap-2 py-1.5 px-3 bg-surf rounded-lg text-sm">
                    {f.status === 'uploading' && (
                      <div className="w-3.5 h-3.5 border-2 border-accent border-t-transparent rounded-full animate-spin flex-shrink-0" />
                    )}
                    {f.status === 'done' && <span className="text-green-500 flex-shrink-0 text-xs">✓</span>}
                    {f.status === 'error' && <span className="text-red-500 flex-shrink-0 text-xs">✗</span>}
                    <span className="flex-1 truncate text-xs">{f.name}</span>
                    {f.status === 'done' && f.category && (
                      <span className="text-[10px] text-muted bg-bg px-1.5 py-0.5 rounded-full">
                        {categoryLabels[f.category] || f.category}
                      </span>
                    )}
                  </div>
                  {f.status === 'done' && f.summary && (
                    <p className="text-[11px] text-green-600 px-3 pb-1.5 leading-relaxed line-clamp-2">{f.summary}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Section 3: Links */}
        <div className="bg-bg2 rounded-2xl border border-border p-5 mb-6">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-6 h-6 rounded-full bg-accent text-white text-xs font-bold flex items-center justify-center flex-shrink-0">3</span>
            <h3 className="font-semibold">קישורים</h3>
          </div>
          <p className="text-xs text-muted mb-4 mr-8">גולדפיש יקרא את הדפים ויחלץ מהם מידע על הארגון.</p>

          <div className="space-y-3">
            <div>
              <div className="flex gap-2">
                <input
                  type="url"
                  value={websiteUrl}
                  onChange={e => setWebsiteUrl(e.target.value)}
                  className="flex-1 px-3 py-2 rounded-xl border border-border bg-surf text-sm focus:outline-none focus:border-accent"
                  placeholder="אתר הארגון"
                  dir="ltr"
                />
                <button
                  onClick={() => learnUrl(websiteUrl, 'website')}
                  disabled={!websiteUrl.trim() || urlLoading === 'website' || urlDone.includes('website')}
                  className="px-3 py-2 bg-accent text-white text-sm rounded-xl hover:bg-accent-hover disabled:opacity-50 transition-all flex-shrink-0"
                >
                  {urlLoading === 'website' ? 'קורא...' : urlDone.includes('website') ? '✓' : 'שלח'}
                </button>
              </div>
              {urlResults.website && (
                <p className={`text-[11px] mt-1 leading-relaxed ${urlDone.includes('website') ? 'text-green-600' : 'text-red-500'}`}>
                  {urlResults.website}
                </p>
              )}
            </div>

            <div>
              <div className="flex gap-2">
                <input
                  type="url"
                  value={driveUrl}
                  onChange={e => setDriveUrl(e.target.value)}
                  className="flex-1 px-3 py-2 rounded-xl border border-border bg-surf text-sm focus:outline-none focus:border-accent"
                  placeholder="תיקיית Google Drive"
                  dir="ltr"
                />
                <button
                  onClick={() => learnUrl(driveUrl, 'drive')}
                  disabled={!driveUrl.trim() || urlLoading === 'drive' || urlDone.includes('drive')}
                  className="px-3 py-2 bg-accent text-white text-sm rounded-xl hover:bg-accent-hover disabled:opacity-50 transition-all flex-shrink-0"
                >
                  {urlLoading === 'drive' ? 'קורא...' : urlDone.includes('drive') ? '✓' : 'שלח'}
                </button>
              </div>
              {urlResults.drive ? (
                <p className={`text-[11px] mt-1 leading-relaxed ${urlDone.includes('drive') ? 'text-green-600' : 'text-red-500'}`}>
                  {urlResults.drive}
                </p>
              ) : (
                <p className="text-[10px] text-muted mt-1">Share → Anyone with the link</p>
              )}
            </div>
          </div>
        </div>

        {/* Goldfish personality note */}
        {!hasContent && (
          <div className="flex gap-3 items-start bg-orange-50 border border-orange-200 rounded-2xl p-4 mb-5 text-sm">
            <span className="text-lg flex-shrink-0">🐟</span>
            <p className="text-orange-700 leading-relaxed">
              <span className="font-semibold">גולדפיש לא אוהב חפיפניקים.</span>{' '}
              ככל שתספרו יותר — הוא ידוג יותר. ארגון שמגיע בלי מידע מקבל הצעות גנריות. ארגון שמגיע עם תמונה מלאה — מקבל זהב.
            </p>
          </div>
        )}

        {hasContent && (
          <div className="flex gap-3 items-start bg-green-50 border border-green-200 rounded-2xl p-4 mb-5 text-sm">
            <span className="text-lg flex-shrink-0">🐟</span>
            <p className="text-green-700 leading-relaxed">
              <span className="font-semibold">יופי, מתחילים לגבש תמונה.</span>{' '}
              אפשר תמיד לחזור ולהוסיף עוד — גולדפיש לומד כל הזמן.
            </p>
          </div>
        )}

        {/* CTA */}
        <button
          onClick={finish}
          disabled={finishing}
          className="w-full py-3.5 bg-accent text-white font-semibold rounded-xl hover:bg-accent-hover disabled:opacity-50 transition-all hover:scale-[1.02] active:scale-[0.98] text-sm"
        >
          {finishing
            ? (urlLoading ? `קורא ${urlLoading === 'drive' ? 'Drive' : urlLoading === 'social' ? 'רשת חברתית' : 'אתר'}...` : 'שוחה לדשבורד...')
            : hasContent ? 'קחו אותי לדשבורד' : 'דלגו על זה עכשיו'}
        </button>

        {!hasContent && (
          <p className="text-center text-[11px] text-muted mt-3 leading-relaxed">
            אפשר תמיד לחזור לכאן דרך הצ׳אט ולהוסיף מידע אחר כך.
          </p>
        )}
      </div>
    </div>
  );
}
