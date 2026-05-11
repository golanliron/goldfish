import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const invite = searchParams.get('invite');
  const next = searchParams.get('next') ?? '/onboarding';

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const cookieStore = request.cookies;
  const response = NextResponse.redirect(`${origin}${next}`);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const { data: { user }, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !user) {
    return NextResponse.redirect(`${origin}/login?error=auth_failed`);
  }

  // Check if user already has an org setup
  const admin = createAdminClient();
  const { data: existingUser } = await admin
    .from('users')
    .select('org_id')
    .eq('id', user.id)
    .single();

  if (!existingUser) {
    // First-time user — check for invite code
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
      // No invite or invalid code — create new org
      const displayName = user.user_metadata?.full_name || user.email?.split('@')[0] || 'הארגון שלי';

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
      await admin.from('users').insert({
        id: user.id,
        org_id: orgId,
        email: user.email,
        full_name: user.user_metadata?.full_name || null,
        role,
      });
    }
  }

  return response;
}
