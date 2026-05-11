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
  const [socialUrl, setSocialUrl] = useState('');
  const [driveUrl, setDriveUrl] = useState('');
  const [urlLoading, setUrlLoading] = useState<string | null>(null);
  const [urlDone, setUrlDone] = useState<string[]>([]);
  const [finishing, setFinishing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const { orgId, loading: authLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (authLoading) return;
    if (!orgId) { setReady(true); return; }

    const supabase = createClient();
    // Safety timeout — never stay stuck more than 4 seconds
    const timeout = setTimeout(() => setReady(true), 4000);

    supabase
      .from('org_profiles')
      .select('data')
      .eq('org_id', orgId)
      .single()
      .then(({ data: profile }) => {
        clearTimeout(timeout);
        const d = profile?.data as Record<string, unknown> | null;
        if (d?.onboarding_complete) {
          router.replace('/dashboard');
        } else {
          setReady(true);
        }
      }, () => { clearTimeout(timeout); setReady(true); });

    return () => clearTimeout(timeout);
  }, [orgId, authLoading, router]);

  const uploadFile = async (file: File, index: number) => {
    if (!orgId) return;
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
    newFiles.forEach((f, i) => uploadFile(f, startIndex + i));
  };

  const learnUrl = async (url: string, label: string) => {
    if (!orgId || !url.trim()) return;
    setUrlLoading(label);
    try {
      await fetch('/api/learn-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: orgId, url: url.trim() }),
      });
      setUrlDone(prev => [...prev, label]);
    } catch { /* ignore */ }
    setUrlLoading(null);
  };

  const finish = async () => {
    setFinishing(true);
    try {
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
          data: { ...currentData, onboarding_complete: true },
          last_updated: new Date().toISOString(),
        }, { onConflict: 'org_id' });
      }
    } catch (e) {
      console.error('Onboarding finish error:', e);
    }
    // Always navigate, even if DB update failed
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

  if (!ready) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-bg gap-3">
        <FishLogo size={48} className="swim" />
        <p className="text-sm text-muted animate-pulse">שוחה בשבילך נגד הזרם...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg">
      <div className="max-w-lg mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-4">
            <FishLogo size={32} className="swim" />
            <span className="font-semibold text-lg">Goldfish</span>
          </div>
          <h1 className="text-2xl font-bold mb-2">ספרו לי על הארגון</h1>
          <p className="text-sm text-muted">
            ככל שאכיר יותר, אדייק יותר בהתאמת קולות קוראים ובכתיבת הגשות.
          </p>
        </div>

        {/* Section 1: Documents */}
        <div className="bg-bg2 rounded-2xl border border-border p-5 mb-4">
          <h3 className="font-medium mb-1">מסמכים</h3>
          <p className="text-xs text-muted mb-3">
            אודות הארגון, מודל פעולה, מצגות, דוחות כספיים, הגשות קודמות — הכל.
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
            className={`w-full py-6 border-2 border-dashed rounded-xl text-sm cursor-pointer transition-all text-center ${
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
                <div key={i} className="flex items-center gap-2 py-1.5 px-3 bg-surf rounded-lg text-sm">
                  {f.status === 'uploading' && (
                    <div className="w-3.5 h-3.5 border-2 border-accent border-t-transparent rounded-full animate-spin flex-shrink-0" />
                  )}
                  {f.status === 'done' && <span className="text-green-500 flex-shrink-0 text-xs">✓</span>}
                  {f.status === 'error' && <span className="text-red flex-shrink-0 text-xs">✗</span>}
                  <span className="flex-1 truncate text-xs">{f.name}</span>
                  {f.status === 'done' && f.category && (
                    <span className="text-[10px] text-muted bg-bg px-1.5 py-0.5 rounded-full">
                      {categoryLabels[f.category] || f.category}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Section 2: Links */}
        <div className="bg-bg2 rounded-2xl border border-border p-5 mb-4">
          <h3 className="font-medium mb-3">קישורים</h3>

          <div className="space-y-3">
            {/* Website */}
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
                {urlLoading === 'website' ? '...' : urlDone.includes('website') ? '✓' : 'שלח'}
              </button>
            </div>

            {/* Social */}
            <div className="flex gap-2">
              <input
                type="url"
                value={socialUrl}
                onChange={e => setSocialUrl(e.target.value)}
                className="flex-1 px-3 py-2 rounded-xl border border-border bg-surf text-sm focus:outline-none focus:border-accent"
                placeholder="פייסבוק / אינסטגרם / לינקדאין"
                dir="ltr"
              />
              <button
                onClick={() => learnUrl(socialUrl, 'social')}
                disabled={!socialUrl.trim() || urlLoading === 'social' || urlDone.includes('social')}
                className="px-3 py-2 bg-accent text-white text-sm rounded-xl hover:bg-accent-hover disabled:opacity-50 transition-all flex-shrink-0"
              >
                {urlLoading === 'social' ? '...' : urlDone.includes('social') ? '✓' : 'שלח'}
              </button>
            </div>

            {/* Drive */}
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
                  {urlLoading === 'drive' ? '...' : urlDone.includes('drive') ? '✓' : 'שלח'}
                </button>
              </div>
              <p className="text-[10px] text-muted mt-1">Share → Anyone with the link</p>
            </div>
          </div>
        </div>

        {/* CTA */}
        <button
          onClick={finish}
          disabled={finishing}
          className="w-full py-3 bg-accent text-white font-medium rounded-xl hover:bg-accent-hover disabled:opacity-50 transition-all hover:scale-[1.02] active:scale-[0.98]"
        >
          {finishing ? 'שוחה לדשבורד...' : files.length > 0 || urlDone.length > 0 ? 'סיימתי, קחו אותי לדשבורד' : 'דלגו אחר כך'}
        </button>
        {files.length === 0 && urlDone.length === 0 && (
          <p className="text-center text-[11px] text-muted mt-3 leading-relaxed">
            בלי מסמכים Goldfish לא יכול לסמן לך קולות קוראים או לדוג דברים בשבילך.<br />
            אני מבין שרוצים ישר ולעניין — אבל עוד רגע וזה ישתלם.
          </p>
        )}
        <p className="text-center text-[10px] text-muted mt-2">
          תמיד אפשר להעלות עוד מסמכים דרך הצ׳אט.
        </p>
      </div>
    </div>
  );
}
