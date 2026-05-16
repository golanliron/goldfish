import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  // Admin emails that can freely navigate between all pages
  const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'golanliron1@gmail.com').split(',').map(e => e.trim());
  const isAdmin = user?.email && ADMIN_EMAILS.includes(user.email);

  const isProtectedRoute = request.nextUrl.pathname.startsWith('/dashboard') ||
                          request.nextUrl.pathname.startsWith('/onboarding');
  const isAuthRoute = request.nextUrl.pathname.startsWith('/login') ||
                      request.nextUrl.pathname.startsWith('/signup');

  // Admin or preview/edit mode — no redirects ever
  const isPreview = request.nextUrl.searchParams.has('preview');
  const isEdit = request.nextUrl.searchParams.has('edit');
  if (isAdmin || isPreview || isEdit) {
    return supabaseResponse;
  }

  if (!user && isProtectedRoute) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  if (user && isAuthRoute) {
    // Check onboarding_complete to decide where to send the user
    const { data: userRow } = await supabase
      .from('users')
      .select('org_id')
      .eq('id', user.id)
      .maybeSingle();

    let onboardingDone = false;
    if (userRow?.org_id) {
      const { data: profile } = await supabase
        .from('org_profiles')
        .select('data')
        .eq('org_id', userRow.org_id)
        .maybeSingle();
      onboardingDone = !!(profile?.data as Record<string, unknown> | null)?.onboarding_complete;
    }

    const url = request.nextUrl.clone();
    url.pathname = onboardingDone ? '/dashboard' : '/onboarding';
    return NextResponse.redirect(url);
  }

  // If user is logged in and goes to /onboarding — only redirect to dashboard if onboarding is truly complete
  if (user && request.nextUrl.pathname === '/onboarding' && !request.nextUrl.searchParams.has('edit') && !request.nextUrl.searchParams.has('preview')) {
    const { data: userRow } = await supabase
      .from('users')
      .select('org_id')
      .eq('id', user.id)
      .maybeSingle();

    if (userRow?.org_id) {
      const { data: profile } = await supabase
        .from('org_profiles')
        .select('data')
        .eq('org_id', userRow.org_id)
        .maybeSingle();
      const done = !!(profile?.data as Record<string, unknown> | null)?.onboarding_complete;
      if (done) {
        const url = request.nextUrl.clone();
        url.pathname = '/dashboard';
        return NextResponse.redirect(url);
      }
    }
  }

  return supabaseResponse;
}
