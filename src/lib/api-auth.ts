import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export interface AuthContext {
  userId: string;
  orgId: string;
  email: string;
}

const UNAUTHORIZED = NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

/**
 * Authenticate an API request and return the user's org context.
 * Falls back to x-org-id header if no Supabase session exists (e.g. mobile / SDK callers).
 * Returns null if neither session nor org_id header is present.
 */
export async function getAuthContext(req: NextRequest): Promise<AuthContext | null> {
  // Primary: try Supabase session (cookie-based auth)
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (!error && user) {
      // Get org_id from users table
      const { data: userData } = await supabase
        .from('users')
        .select('org_id')
        .eq('id', user.id)
        .single();

      if (userData?.org_id) {
        return {
          userId: user.id,
          orgId: userData.org_id,
          email: user.email || '',
        };
      }
    }
  } catch {
    // Session check failed — fall through to header fallback
  }

  // Fallback: allow requests with x-org-id header (no Supabase session needed)
  const headerOrgId = req.headers.get('x-org-id');
  if (headerOrgId) {
    return {
      userId: 'anonymous',
      orgId: headerOrgId,
      email: '',
    };
  }

  return null;
}

/**
 * Wrapper for route handlers that require authentication.
 * Injects AuthContext — handler never sees unauthenticated requests.
 */
export function withAuth(
  handler: (req: NextRequest, auth: AuthContext, params?: Record<string, string>) => Promise<Response>
) {
  return async (req: NextRequest, context?: { params?: Promise<Record<string, string>> }) => {
    const auth = await getAuthContext(req);
    if (!auth) return UNAUTHORIZED;

    const params = context?.params ? await context.params : undefined;
    return handler(req, auth, params);
  };
}
