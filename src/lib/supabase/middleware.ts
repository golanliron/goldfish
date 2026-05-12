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
  const ADMIN_EMAILS = ['golanliron1@gmail.com'];
  const isAdmin = user?.email && ADMIN_EMAILS.includes(user.email);

  const isProtectedRoute = request.nextUrl.pathname.startsWith('/dashboard') ||
                          request.nextUrl.pathname.startsWith('/onboarding');
  const isAuthRoute = request.nextUrl.pathname.startsWith('/login') ||
                      request.nextUrl.pathname.startsWith('/signup');

  if (!user && isProtectedRoute) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  // Admin can go anywhere — no forced redirects
  if (isAdmin) {
    return supabaseResponse;
  }

  if (user && isAuthRoute) {
    // Check if user already has an org profile — if so, go to dashboard
    const { data: existing } = await supabase
      .from('organizations')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle();
    const url = request.nextUrl.clone();
    url.pathname = existing ? '/' : '/onboarding';
    return NextResponse.redirect(url);
  }

  // If user is logged in and goes to /onboarding without ?edit=1, and already has profile — send to dashboard
  if (user && request.nextUrl.pathname === '/onboarding' && !request.nextUrl.searchParams.has('edit')) {
    const { data: existing } = await supabase
      .from('organizations')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle();
    if (existing) {
      const url = request.nextUrl.clone();
      url.pathname = '/';
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}
