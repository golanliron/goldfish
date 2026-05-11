'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import SplashScreen from '@/components/SplashScreen';
import FishLogo from '@/components/chat/FishLogo';
import Link from 'next/link';
import SidebarPanel from '@/components/sidebar/SidebarPanel';
import { useAuth } from '@/lib/auth-context';
import type { AppStage, SidebarTab } from '@/types';

const MOBILE_TABS: { id: 'chat' | SidebarTab; label: string; icon: string }[] = [
  { id: 'chat', label: 'צ\'אט', icon: 'M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z' },
  { id: 'opportunities', label: 'הגשות', icon: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z' },
  { id: 'org', label: 'הארגון', icon: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4' },
  { id: 'business', label: 'עסקיות', icon: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4' },
  { id: 'foundations', label: 'קרנות', icon: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5' },
];

function FeedbackModal({ onClose, orgId }: { onClose: () => void; orgId: string | null }) {
  const [type, setType] = useState<'bug' | 'idea' | 'love' | 'other'>('idea');
  const [text, setText] = useState('');
  const [sent, setSent] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { ref.current?.focus(); }, []);

  const send = async () => {
    if (!text.trim()) return;
    try {
      const supabase = (await import('@/lib/supabase/client')).createClient();
      await supabase.from('feedback').insert({
        org_id: orgId,
        type,
        message: text,
      });
    } catch { /* ignore */ }
    setSent(true);
    setTimeout(onClose, 1500);
  };

  const types = [
    { key: 'bug' as const, label: 'בעיה', emoji: '🐛' },
    { key: 'idea' as const, label: 'רעיון', emoji: '💡' },
    { key: 'love' as const, label: 'אהבתי', emoji: '❤️' },
    { key: 'other' as const, label: 'אחר', emoji: '📝' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-bg border border-border rounded-2xl p-6 max-w-md w-full mx-4 shadow-xl" dir="rtl" onClick={e => e.stopPropagation()}>
        {sent ? (
          <div className="text-center py-8">
            <p className="text-2xl mb-2">🐟</p>
            <p className="font-bold">קיבלתי. אטפל בזה.</p>
          </div>
        ) : (
          <>
            <h3 className="font-bold text-lg mb-1">יש לכם מה להגיד?</h3>
            <p className="text-sm text-muted mb-4">תלונות, באגים, רעיונות. Goldfish לא רגיש, תכתבו מה שיש.</p>
            <div className="flex gap-2 mb-4">
              {types.map(t => (
                <button
                  key={t.key}
                  onClick={() => setType(t.key)}
                  className={`flex-1 py-2 rounded-xl text-sm font-medium transition-all ${type === t.key ? 'bg-accent text-white' : 'bg-surf2 hover:bg-surf2/80'}`}
                >
                  {t.emoji} {t.label}
                </button>
              ))}
            </div>
            <textarea
              ref={ref}
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="ספרו לנו..."
              className="w-full p-3 border border-border rounded-xl bg-surf2 text-sm resize-none focus:border-accent focus:outline-none"
              rows={4}
            />
            <div className="flex gap-2 mt-3">
              <button onClick={send} className="flex-1 py-2.5 bg-accent text-white font-medium rounded-xl hover:bg-accent-hover transition-all">
                שלח
              </button>
              <button onClick={onClose} className="px-4 py-2.5 border border-border rounded-xl hover:bg-surf2 transition-all text-sm">
                ביטול
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function DashboardInner({ children }: { children: React.ReactNode }) {
  const [showSplash, setShowSplash] = useState(true);
  const [stage, setStage] = useState<AppStage>(0);
  const [mobileTab, setMobileTab] = useState<'chat' | SidebarTab>('chat');
  const [showFeedback, setShowFeedback] = useState(false);
  const { orgId, user, loading, signOut } = useAuth();
  const router = useRouter();

  const switchTab = (tab: 'chat' | SidebarTab) => {
    setMobileTab(tab);
    window.dispatchEvent(new CustomEvent('fishgold:activeTab', { detail: tab }));
  };

  useEffect(() => {
    const saved = localStorage.getItem('fishgold_stage');
    if (saved) setStage(Number(saved) as AppStage);

    const closeSidebar = () => switchTab('chat');
    window.addEventListener('fishgold:closeSidebar', closeSidebar);
    return () => window.removeEventListener('fishgold:closeSidebar', closeSidebar);
  }, []);

  if (loading) {
    return (
      <div className="h-dvh flex flex-col items-center justify-center bg-bg gap-3">
        <FishLogo size={48} className="swim" />
        <p className="text-sm text-muted animate-pulse">שוחה בשבילך נגד הזרם...</p>
      </div>
    );
  }

  if (showSplash) {
    return <SplashScreen onComplete={() => setShowSplash(false)} />;
  }

  const userInitial = user?.user_metadata?.full_name?.[0] || user?.email?.[0]?.toUpperCase() || '?';

  return (
    <div className="h-dvh flex flex-col fade-in">
      <header className="flex items-center justify-between px-4 py-2 border-b border-border bg-bg2 flex-shrink-0 relative">
        <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-gradient-to-l from-accent via-accent/40 to-transparent" />
        <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <FishLogo size={28} className="swim" />
          <span className="font-semibold text-sm">Goldfish</span>
          <span className="text-xs text-muted hidden sm:inline">| מילה של דג זהב</span>
        </Link>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowFeedback(true)}
            className="text-[11px] text-muted hover:text-accent transition-colors px-2 py-1 rounded-lg hover:bg-surf2"
            title="כתבו לנו"
          >
            🐟 כתבו לנו
          </button>
          <button
            onClick={() => {
              if (navigator.share) {
                navigator.share({ title: 'Goldfish', text: 'דג זהב עתיק שדג מענקים. מערכת גיוס חכמה לעמותות.', url: 'https://goldfish.co.il' });
              } else {
                navigator.clipboard.writeText('https://goldfish.co.il');
                alert('הלינק הועתק!');
              }
            }}
            className="text-[11px] text-muted hover:text-accent transition-colors px-2 py-1 rounded-lg hover:bg-surf2"
            title="שתפו"
          >
            📤 אהבתם? שתפו חבר
          </button>
          <button
            onClick={async () => {
              await signOut();
              router.push('/login');
            }}
            className="w-7 h-7 rounded-full bg-accent text-white flex items-center justify-center text-xs font-bold hover:bg-accent-hover transition-colors"
            title="יציאה"
          >
            {userInitial}
          </button>
        </div>
      </header>

      <div className="flex-1 hidden md:flex overflow-hidden">
        <aside className="w-[370px] flex-shrink-0 border-l border-border overflow-hidden bg-bg2">
          <SidebarPanel stage={stage} orgId={orgId || ''} />
        </aside>
        <main className="flex-1 overflow-hidden">
          {children}
        </main>
      </div>

      <div className="flex-1 md:hidden overflow-hidden flex flex-col">
        <div className="flex-1 overflow-hidden">
          {mobileTab === 'chat' ? (
            <main className="h-full overflow-hidden">
              {children}
            </main>
          ) : (
            <div className="h-full overflow-y-auto bg-bg2">
              <SidebarPanel stage={stage} orgId={orgId || ''} initialTab={mobileTab as SidebarTab} />
            </div>
          )}
        </div>

        <nav className="flex-shrink-0 bg-bg2 border-t border-border safe-area-bottom">
          <div className="flex">
            {MOBILE_TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => switchTab(tab.id)}
                className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 transition-colors relative
                  ${mobileTab === tab.id ? 'text-accent' : 'text-muted'}
                `}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={mobileTab === tab.id ? "2.5" : "2"} strokeLinecap="round" strokeLinejoin="round">
                  <path d={tab.icon} />
                </svg>
                <span className={`text-[10px] ${mobileTab === tab.id ? 'font-bold' : 'font-medium'}`}>{tab.label}</span>
                {mobileTab === tab.id && (
                  <span className="absolute top-0 inset-x-4 h-[3px] bg-accent rounded-full" />
                )}
              </button>
            ))}
          </div>
        </nav>
      </div>
      {showFeedback && <FeedbackModal onClose={() => setShowFeedback(false)} orgId={orgId} />}
    </div>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <DashboardInner>{children}</DashboardInner>;
}
