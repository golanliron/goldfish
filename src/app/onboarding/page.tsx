'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import FishLogo from '@/components/chat/FishLogo';
import { useAuth } from '@/lib/auth-context';
import { createClient } from '@/lib/supabase/client';

type Step = 'loading' | 'welcome' | 'documents' | 'links' | 'done';

interface UploadedFile {
  name: string;
  category: string;
  summary: string;
  status: 'uploading' | 'done' | 'error';
}

export default function OnboardingPage() {
  const [step, setStep] = useState<Step>('loading');
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [socialUrl, setSocialUrl] = useState('');
  const [driveUrl, setDriveUrl] = useState('');
  const [urlLoading, setUrlLoading] = useState<string | null>(null);
  const [urlDone, setUrlDone] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const grantInputRef = useRef<HTMLInputElement>(null);
  const { orgId, loading: authLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    // Still loading auth
    if (authLoading) return;

    // Auth done but no orgId — shouldn't happen (middleware redirects), but handle gracefully
    if (!orgId) {
      setStep('welcome');
      return;
    }

    const supabase = createClient();
    supabase
      .from('org_profiles')
      .select('data')
      .eq('org_id', orgId)
      .single()
      .then(({ data: profile }) => {
        const d = profile?.data as Record<string, unknown> | null;
        if (d?.onboarding_complete) {
          router.replace('/dashboard');
        } else {
          setStep('welcome');
        }
      });
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
    if (!orgId) return;
    // Mark onboarding complete
    const supabase = (await import('@/lib/supabase/client')).createClient();
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

    router.push('/dashboard');
  };

  const categoryLabels: Record<string, string> = {
    identity: 'מסמך זהות ארגוני',
    budget: 'דוח כספי',
    project: 'תיאור פרויקט',
    grant: 'הסכם מענק',
    submission: 'הגשה קודמת',
    other: 'מסמך',
  };

  const brandHeader = (
    <div className="flex items-center justify-center gap-2 mb-6">
      <FishLogo size={32} className="swim" />
      <span className="font-semibold text-lg">Goldfish</span>
    </div>
  );

  if (step === 'loading') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-bg gap-3">
        <FishLogo size={48} className="swim" />
        <p className="text-sm text-muted animate-pulse">שוחה בשבילך נגד הזרם...</p>
      </div>
    );
  }

  if (step === 'welcome') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg p-4">
        <div className="w-full max-w-lg text-center">
          {brandHeader}
          <FishLogo size={80} className="mx-auto swim mb-4" />
          <h1 className="text-2xl font-bold mb-2">רגע, לפני שמתחילים לשחות במים העמוקים...</h1>
          <div className="bg-bg2 rounded-2xl border border-border p-6 mt-6 text-right space-y-4">
            <p className="text-sm leading-relaxed text-text2">
              שלום! אני <strong>Goldfish</strong>. אדוג לך קולות קוראים, אכתוב טיוטות הגשה, ואשחה
              בשבילך בין מאות מקורות מימון.
            </p>
            <p className="text-sm leading-relaxed text-text2">
              אבל בשביל שהזהב שאדוג יהיה באמת רלוונטי — <strong>אני צריך להכיר אותך לעומק.</strong>
            </p>
            <p className="text-sm leading-relaxed text-text2">
              ככל שתשלחו לי יותר חומרים, אדע לדייק יותר — גם בהתאמת קולות קוראים וגם בכתיבת הגשות.
            </p>
            <p className="text-sm leading-relaxed text-muted">
              זה ייקח דקה-שתיים. מוכנים?
            </p>
          </div>
          <button
            onClick={() => setStep('documents')}
            className="mt-6 px-8 py-3 bg-accent text-white font-medium rounded-xl hover:bg-accent-hover transition-all hover:scale-105 active:scale-95"
          >
            יאללה, בואו נתחיל
          </button>
        </div>
      </div>
    );
  }

  if (step === 'documents') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg p-4">
        <div className="w-full max-w-lg">
          {brandHeader}
          <div className="text-center mb-6">
            <FishLogo size={48} className="mx-auto swim mb-2" />
            <h2 className="text-xl font-bold">שלב 1: מסמכים על הארגון</h2>
            <p className="text-sm text-muted mt-1">שלחו לי כל מסמך שיעזור לי להכיר את הארגון</p>
          </div>

          <div className="bg-bg2 rounded-2xl border border-border p-6 space-y-5">
            {/* Org documents */}
            <div>
              <label className="block text-sm font-medium mb-2">מסמכי הארגון</label>
              <p className="text-xs text-muted mb-3">תקנון, דוחות כספיים, מצגות, תוכניות עבודה — כל מה שיש</p>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.doc,.docx,.txt,.csv,.xlsx,.xls,.html"
                onChange={e => handleFiles(e.target.files)}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-3 border-2 border-dashed border-border rounded-xl text-sm text-muted hover:border-accent hover:text-accent transition-colors"
              >
                📄 בחרו קבצים (PDF, Word, Excel, TXT)
              </button>
            </div>

            {/* Previous submissions */}
            <div>
              <label className="block text-sm font-medium mb-2">הגשות קודמות לקרנות</label>
              <p className="text-xs text-muted mb-3">כל בקשה שכבר שלחתם — אדע ללמוד מהסגנון שלכם</p>
              <input
                ref={grantInputRef}
                type="file"
                multiple
                accept=".pdf,.doc,.docx,.txt"
                onChange={e => handleFiles(e.target.files)}
                className="hidden"
              />
              <button
                onClick={() => grantInputRef.current?.click()}
                className="w-full py-3 border-2 border-dashed border-border rounded-xl text-sm text-muted hover:border-accent hover:text-accent transition-colors"
              >
                📋 העלו הגשות קודמות
              </button>
            </div>

            {/* Uploaded files list */}
            {files.length > 0 && (
              <div className="space-y-2">
                {files.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 py-2 px-3 bg-surf rounded-xl text-sm">
                    {f.status === 'uploading' && (
                      <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin flex-shrink-0" />
                    )}
                    {f.status === 'done' && <span className="text-green-500 flex-shrink-0">✓</span>}
                    {f.status === 'error' && <span className="text-red flex-shrink-0">✗</span>}
                    <span className="flex-1 truncate">{f.name}</span>
                    {f.status === 'done' && f.category && (
                      <span className="text-xs text-muted bg-bg px-2 py-0.5 rounded-full">
                        {categoryLabels[f.category] || f.category}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-3 mt-6">
            <button
              onClick={() => setStep('links')}
              className="flex-1 py-3 bg-accent text-white font-medium rounded-xl hover:bg-accent-hover transition-all"
            >
              {files.length > 0 ? 'המשך לשלב הבא' : 'דלג, אעלה אחר כך'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'links') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg p-4">
        <div className="w-full max-w-lg">
          {brandHeader}
          <div className="text-center mb-6">
            <FishLogo size={48} className="mx-auto swim mb-2" />
            <h2 className="text-xl font-bold">שלב 2: קישורים</h2>
            <p className="text-sm text-muted mt-1">אקרא את האתר והרשתות שלכם כדי להכיר טוב יותר</p>
          </div>

          <div className="bg-bg2 rounded-2xl border border-border p-6 space-y-5">
            {/* Website */}
            <div>
              <label className="block text-sm font-medium mb-1">אתר הארגון</label>
              <div className="flex gap-2">
                <input
                  type="url"
                  value={websiteUrl}
                  onChange={e => setWebsiteUrl(e.target.value)}
                  className="flex-1 px-3 py-2.5 rounded-xl border border-border bg-surf text-sm focus:outline-none focus:border-accent"
                  placeholder="https://example.org.il"
                  dir="ltr"
                />
                <button
                  onClick={() => learnUrl(websiteUrl, 'website')}
                  disabled={!websiteUrl.trim() || urlLoading === 'website' || urlDone.includes('website')}
                  className="px-4 py-2.5 bg-accent text-white text-sm rounded-xl hover:bg-accent-hover disabled:opacity-50 transition-all flex-shrink-0"
                >
                  {urlLoading === 'website' ? '🐟 קורא...' : urlDone.includes('website') ? '✓ נקרא' : 'שלח'}
                </button>
              </div>
            </div>

            {/* Social */}
            <div>
              <label className="block text-sm font-medium mb-1">דף פייסבוק / אינסטגרם / לינקדאין</label>
              <div className="flex gap-2">
                <input
                  type="url"
                  value={socialUrl}
                  onChange={e => setSocialUrl(e.target.value)}
                  className="flex-1 px-3 py-2.5 rounded-xl border border-border bg-surf text-sm focus:outline-none focus:border-accent"
                  placeholder="https://facebook.com/your-org"
                  dir="ltr"
                />
                <button
                  onClick={() => learnUrl(socialUrl, 'social')}
                  disabled={!socialUrl.trim() || urlLoading === 'social' || urlDone.includes('social')}
                  className="px-4 py-2.5 bg-accent text-white text-sm rounded-xl hover:bg-accent-hover disabled:opacity-50 transition-all flex-shrink-0"
                >
                  {urlLoading === 'social' ? '🐟 קורא...' : urlDone.includes('social') ? '✓ נקרא' : 'שלח'}
                </button>
              </div>
            </div>

            {/* Google Drive */}
            <div>
              <label className="block text-sm font-medium mb-1">תיקיית Google Drive</label>
              <p className="text-xs text-muted mb-2">שתפו תיקייה עם מסמכי הארגון — אקרא הכל בבת אחת</p>
              <div className="flex gap-2">
                <input
                  type="url"
                  value={driveUrl}
                  onChange={e => setDriveUrl(e.target.value)}
                  className="flex-1 px-3 py-2.5 rounded-xl border border-border bg-surf text-sm focus:outline-none focus:border-accent"
                  placeholder="https://drive.google.com/drive/folders/..."
                  dir="ltr"
                />
                <button
                  onClick={() => learnUrl(driveUrl, 'drive')}
                  disabled={!driveUrl.trim() || urlLoading === 'drive' || urlDone.includes('drive')}
                  className="px-4 py-2.5 bg-accent text-white text-sm rounded-xl hover:bg-accent-hover disabled:opacity-50 transition-all flex-shrink-0"
                >
                  {urlLoading === 'drive' ? '🐟 קורא...' : urlDone.includes('drive') ? '✓ נשמר' : 'שלח'}
                </button>
              </div>
              <p className="text-[10px] text-muted mt-1">ודאו שהתיקייה משותפת (Share → Anyone with the link)</p>
            </div>
          </div>

          <div className="flex gap-3 mt-6">
            <button
              onClick={() => setStep('done')}
              className="flex-1 py-3 bg-accent text-white font-medium rounded-xl hover:bg-accent-hover transition-all"
            >
              {urlDone.length > 0 || files.length > 0 ? 'סיימתי, בואו נתחיל!' : 'דלג, אוסיף אחר כך'}
            </button>
          </div>

          <button
            onClick={() => setStep('documents')}
            className="w-full mt-2 py-2 text-sm text-muted hover:text-accent transition-colors"
          >
            ← חזרה למסמכים
          </button>
        </div>
      </div>
    );
  }

  // Done step
  return (
    <div className="min-h-screen flex items-center justify-center bg-bg p-4">
      <div className="w-full max-w-lg text-center">
        {brandHeader}
        <FishLogo size={80} className="mx-auto swim mb-4" />
        <h1 className="text-2xl font-bold mb-2">מעולה! אני מוכן לשחות</h1>
        <div className="bg-bg2 rounded-2xl border border-border p-6 mt-4 text-right space-y-3">
          {files.filter(f => f.status === 'done').length > 0 && (
            <p className="text-sm text-text2">
              📄 קראתי {files.filter(f => f.status === 'done').length} מסמכים
            </p>
          )}
          {urlDone.length > 0 && (
            <p className="text-sm text-text2">
              🌐 למדתי {urlDone.length} קישורים
            </p>
          )}
          <p className="text-sm text-text2">
            עכשיו אני מכיר את הארגון שלכם הרבה יותר טוב. אתחיל לחפש קולות קוראים רלוונטיים
            ואהיה מוכן לכתוב טיוטות הגשה.
          </p>
          <p className="text-xs text-muted">
            תמיד אפשר להעלות עוד מסמכים דרך הצ'אט או לשונית "העמותה".
          </p>
        </div>
        <button
          onClick={finish}
          className="mt-6 px-8 py-3 bg-accent text-white font-medium rounded-xl hover:bg-accent-hover transition-all hover:scale-105 active:scale-95"
        >
          קחו אותי לדשבורד 🐟
        </button>
      </div>
    </div>
  );
}
