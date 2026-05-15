import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  if (error) {
    console.error('Google OAuth error:', error);
    return Response.redirect(`${origin}/dashboard?drive_error=${error}`);
  }

  if (!code || !state) {
    return Response.redirect(`${origin}/dashboard?drive_error=missing_params`);
  }

  // Verify logged-in user matches state (CSRF check)
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || user.id !== state) {
    return Response.redirect(`${origin}/dashboard?drive_error=unauthorized`);
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return Response.redirect(`${origin}/dashboard?drive_error=not_configured`);
  }

  // Exchange code for tokens
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: `${origin}/api/drive/callback`,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text().catch(() => '');
    console.error('Google token exchange failed:', err);
    return Response.redirect(`${origin}/dashboard?drive_error=token_failed`);
  }

  const tokenData = await tokenRes.json();
  const { access_token, refresh_token, expires_in, scope } = tokenData;

  if (!access_token) {
    return Response.redirect(`${origin}/dashboard?drive_error=no_token`);
  }

  // Fetch Google user email
  let googleEmail: string | null = null;
  try {
    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    if (userRes.ok) {
      const userData = await userRes.json();
      googleEmail = userData.email || null;
    }
  } catch { /* non-critical */ }

  const tokenExpiry = expires_in
    ? new Date(Date.now() + expires_in * 1000).toISOString()
    : null;

  // Get org_id for this user
  const admin = createAdminClient();
  const { data: userData } = await admin
    .from('users')
    .select('org_id')
    .eq('id', user.id)
    .single();

  if (!userData?.org_id) {
    return Response.redirect(`${origin}/dashboard?drive_error=no_org`);
  }

  // Save tokens — upsert by org_id
  const { error: upsertError } = await admin.from('google_connections').upsert(
    {
      org_id: userData.org_id,
      user_id: user.id,
      access_token,
      refresh_token: refresh_token || null,
      token_expiry: tokenExpiry,
      scope: scope || null,
      google_email: googleEmail,
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'org_id' }
  );

  if (upsertError) {
    console.error('google_connections upsert failed:', upsertError);
    return Response.redirect(`${origin}/dashboard?drive_error=save_failed`);
  }

  return Response.redirect(`${origin}/dashboard?drive_connected=true`);
}
