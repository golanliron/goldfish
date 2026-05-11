'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import FishLogo from '@/components/chat/FishLogo';
import { createClient } from '@/lib/supabase/client';

export default function SignupPage() {
  return (
    <Suspense>
      <SignupInner />
    </Suspense>
  );
}

function SignupInner() {
  const [orgName, setOrgName] = useState('');
  const [contactName, setContactName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();
  const searchParams = useSearchParams();
  const invite = searchParams.get('invite');

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const supabase = createClient();

    // 1. Create auth user
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { org_name: orgName, full_name: contactName },
      },
    });

    if (authError || !authData.user) {
      setError(authError?.message || 'שגיאה ביצירת חשבון');
      setLoading(false);
      return;
    }

    // 2. Create organization + user record via API
    const res = await fetch('/api/auth/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: authData.user.id,
        email,
        full_name: contactName,
        org_name: orgName || 'הארגון שלי',
        invite_code: invite || undefined,
      }),
    });

    if (!res.ok) {
      setError('שגיאה ביצירת ארגון');
      setLoading(false);
      return;
    }

    router.push('/dashboard');
  };

  const handleGoogleSignup = async () => {
    setGoogleLoading(true);
    setError('');
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/api/auth/callback${invite ? `?invite=${invite}` : ''}`,
      },
    });
    if (error) {
      setError('שגיאה בהרשמה עם Google');
      setGoogleLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <FishLogo size={64} className="mx-auto swim mb-3" />
          <h1 className="text-2xl font-bold">{invite ? 'הצטרפי לצוות' : 'ברוכה הבאה ל-Goldfish'}</h1>
          <p className="text-sm text-muted mt-1">{invite ? 'קיבלת הזמנה להצטרף לארגון' : 'בואי נתחיל בהקמת הארגון שלך'}</p>
        </div>

        <div className="bg-bg2 rounded-2xl border border-border p-6">
          {/* Google OAuth */}
          <button
            onClick={handleGoogleSignup}
            disabled={googleLoading}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-border bg-white text-sm font-medium hover:bg-gray-50 disabled:opacity-50 transition-colors mb-4"
          >
            <svg width="18" height="18" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            {googleLoading ? 'נרשם...' : 'הרשמה עם Google'}
          </button>

          <div className="flex items-center gap-3 mb-4">
            <div className="flex-1 h-px bg-border" />
            <span className="text-[10px] text-muted2">או עם מייל וסיסמה</span>
            <div className="flex-1 h-px bg-border" />
          </div>

          <form onSubmit={handleSignup} className="space-y-3">
            {!invite && (
              <div>
                <label className="block text-xs font-medium text-muted mb-1">שם הארגון / עמותה</label>
                <input
                  type="text"
                  value={orgName}
                  onChange={e => setOrgName(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-border bg-surf text-sm focus:outline-none focus:border-accent"
                  placeholder="שם העמותה שלך"
                  required
                />
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-muted mb-1">שם איש קשר</label>
              <input
                type="text"
                value={contactName}
                onChange={e => setContactName(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-border bg-surf text-sm focus:outline-none focus:border-accent"
                placeholder="השם המלא שלך"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted mb-1">אימייל</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-border bg-surf text-sm focus:outline-none focus:border-accent"
                placeholder="your@email.com"
                required
                dir="ltr"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted mb-1">סיסמה</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-border bg-surf text-sm focus:outline-none focus:border-accent"
                placeholder="6 תווים לפחות"
                required
                minLength={6}
                dir="ltr"
              />
            </div>

            {error && <p className="text-xs text-red">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-xl bg-accent text-white text-sm font-medium hover:bg-accent-hover disabled:opacity-50 transition-colors"
            >
              {loading ? 'יוצר חשבון...' : 'יצירת חשבון והתחלה'}
            </button>
          </form>

          <p className="text-center text-[10px] text-muted2 mt-4">
            כבר יש לי חשבון?{' '}
            <a href="/login" className="text-accent hover:underline">התחברות</a>
          </p>
        </div>
      </div>
    </div>
  );
}
