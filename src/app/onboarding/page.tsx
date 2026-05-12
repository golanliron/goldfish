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
  const [dragging, setDragging] = useState(false);
  const [orgName, setOrgName] = useState('');
  const [orgDesc, setOrgDesc] = useState('');
  const [orgPopulation, setOrgPopulation] = useState('');
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
    if (isPreviewMode) { setReady(true); return; }
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
          setReady(true);
        }
      }, () => setReady(true));
  }, [orgId, authLoading]);

  const uploadFile = async (file: File, index: number) => {
    if (!orgId) {
      setFiles(prev => prev.map((f, i) => i === index ? { ...f, status: 'error' } : f));
      return;
    }
    const formData = new FormData();
    formData.append('file', file);
    formData.append('org_id', orgId);

    try {
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (res.ok) {
        setFiles(prev => prev.map((f, i) => i === index
          ? { ...f, status: 'done', category: data.category, summary: data.summary }
          : f
        ));
      } else {
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
            onboarding_complete: true,
          },
          last_updated: new Date().toISOString(),
        }, { onConflict: 'org_id' });
      }
    } catch (e) {
      console.error('Onboarding finish error:', e);
    }
    window.location.href = '/dashboard?tab=org';
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
              <label className="text-xs font-medium text-muted block mb-1">אוכלוסיית יעד</label>
              <input
                type="text"
                value={orgPopulation}
                onChange={e => setOrgPopulation(e.target.value)}
                placeholder="למשל: נוער בסיכון גילאי 16-25"
                className="w-full px-3 py-2.5 rounded-xl border border-border bg-surf text-sm focus:outline-none focus:border-accent transition-colors"
              />
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
