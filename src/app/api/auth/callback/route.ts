import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const invite = searchParams.get('invite');

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const cookieStore = request.cookies;

  // Collect cookies that Supabase sets during exchangeCodeForSession
  const pendingCookies: { name: string; value: string; options: Record<string, unknown> }[] = [];

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          pendingCookies.push(...cookiesToSet);
        },
      },
    }
  );

  const { data: { user }, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !user) {
    return NextResponse.redirect(`${origin}/login?error=auth_failed`);
  }

  // Check if user already has an org setup (using RPC to bypass RLS)
  const admin = createAdminClient();
  const { data: rpcResult } = await admin.rpc('get_user_by_id', { user_id: user.id });
  const existingUser = rpcResult?.[0] || null;

  let redirectTo = '/onboarding';

  if (existingUser) {
    // User exists — verify org_id is valid and org_profiles exists
    const { data: profile } = await admin
      .from('org_profiles')
      .select('data')
      .eq('org_id', existingUser.org_id)
      .single();

    const profileData = profile?.data as Record<string, unknown> | null;

    // If org_profile is missing, create it (can happen on partial signup failures)
    if (!profile) {
      await admin.from('org_profiles').upsert({
        org_id: existingUser.org_id,
        data: { name: existingUser.full_name || user.email?.split('@')[0] || 'הארגון שלי' },
      }, { onConflict: 'org_id' });
    }

    if (profileData?.onboarding_complete) {
      redirectTo = '/dashboard';
    }
  }

  if (!existingUser) {
    // First-time user — create org + user, then go to onboarding
    let orgId: string | null = null;
    let role = 'admin';

    if (invite) {
      const { data: invitedOrg } = await admin
        .from('organizations')
        .select('id')
        .eq('invite_code', invite)
        .single();

      if (invitedOrg) {
        orgId = invitedOrg.id;
        role = 'member';
      }
    }

    if (!orgId) {
      const displayName = user.user_metadata?.full_name || user.user_metadata?.org_name || user.email?.split('@')[0] || 'הארגון שלי';

      const { data: newOrg } = await admin
        .from('organizations')
        .insert({ name: displayName })
        .select('id')
        .single();

      if (newOrg) {
        orgId = newOrg.id;

        await admin.from('org_profiles').insert({
          org_id: newOrg.id,
          data: { name: displayName },
        });
      }
    }

    if (orgId) {
      // Use upsert to avoid duplicate key errors on retry
      await admin.from('users').upsert({
        id: user.id,
        org_id: orgId,
        email: user.email,
        full_name: user.user_metadata?.full_name || null,
        role,
      }, { onConflict: 'id' });
    } else {
      // Critical failure — redirect to signup with error
      const response = NextResponse.redirect(`${origin}/signup?error=org_creation_failed`);
      for (const { name, value, options } of pendingCookies) {
        response.cookies.set(name, value, options);
      }
      return response;
    }

    redirectTo = '/onboarding';
  }

  // Create redirect response and apply all auth cookies with full options
  const response = NextResponse.redirect(`${origin}${redirectTo}`);
  for (const { name, value, options } of pendingCookies) {
    response.cookies.set(name, value, options);
  }
  return response;
}
