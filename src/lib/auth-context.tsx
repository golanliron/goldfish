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

    // Safety timeout — never stay loading forever
    const safetyTimeout = setTimeout(() => setLoading(false), 5000);

    // Get initial session
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user);
      if (user) {
        // Fetch org_id from users table
        supabase
          .from('users')
          .select('org_id')
          .eq('id', user.id)
          .single()
          .then(({ data }) => {
            clearTimeout(safetyTimeout);
            setOrgId(data?.org_id ?? null);
            setLoading(false);
          }, () => { clearTimeout(safetyTimeout); setLoading(false); });
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
          const { data } = await supabase
            .from('users')
            .select('org_id')
            .eq('id', newUser.id)
            .single();
          setOrgId(data?.org_id ?? null);
        } else {
          setOrgId(null);
        }
      }
    );

    return () => subscription.unsubscribe();
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
