'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { User as SupaUser } from '@supabase/supabase-js';

interface AuthState {
  user: SupaUser | null;
  orgId: string | null;
  userId: string | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  user: null,
  orgId: null,
  userId: null,
  loading: true,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SupaUser | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    // Safety timeout — never stay loading forever
    const safetyTimeout = setTimeout(() => setLoading(false), 5000);

    // Fetch orgId with retry
    const fetchOrgId = (userId: string, attempt: number) => {
      supabase
        .from('users')
        .select('org_id')
        .eq('id', userId)
        .single()
        .then(({ data }) => {
          if (cancelled) return;
          if (data?.org_id) {
            clearTimeout(safetyTimeout);
            setOrgId(data.org_id);
            setLoading(false);
          } else if (attempt < 4) {
            // Retry — RLS may not be ready yet
            setTimeout(() => fetchOrgId(userId, attempt + 1), 1000);
          } else {
            clearTimeout(safetyTimeout);
            setLoading(false);
          }
        }, () => {
          if (!cancelled && attempt < 4) {
            setTimeout(() => fetchOrgId(userId, attempt + 1), 1000);
          } else {
            clearTimeout(safetyTimeout);
            setLoading(false);
          }
        });
    };

    // Get initial session
    supabase.auth.getUser().then(({ data: { user: u } }) => {
      if (cancelled) return;
      setUser(u);
      if (u) {
        fetchOrgId(u.id, 0);
      } else {
        clearTimeout(safetyTimeout);
        setLoading(false);
      }
    }, () => { clearTimeout(safetyTimeout); setLoading(false); });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        const newUser = session?.user ?? null;
        setUser(newUser);

        if (newUser) {
          fetchOrgId(newUser.id, 0);
        } else {
          setOrgId(null);
        }
      }
    );

    return () => { cancelled = true; subscription.unsubscribe(); };
  }, []);

  const signOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    setUser(null);
    setOrgId(null);
  };

  return (
    <AuthContext.Provider value={{
      user,
      orgId,
      userId: user?.id ?? null,
      loading,
      signOut,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
