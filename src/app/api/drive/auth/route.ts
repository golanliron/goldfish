import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Redirects user to Google OAuth consent screen for Drive access
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return Response.json({ error: 'Google OAuth not configured' }, { status: 500 });
  }

  const redirectUri = `${request.nextUrl.origin}/api/drive/callback`;

  // state = user_id for CSRF verification in callback
  const state = user.id;

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', [
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/userinfo.email',
  ].join(' '));
  authUrl.searchParams.set('access_type', 'offline');   // get refresh_token
  authUrl.searchParams.set('prompt', 'consent');         // always ask — ensures refresh_token returned
  authUrl.searchParams.set('state', state);

  return Response.redirect(authUrl.toString());
}
