import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(request: NextRequest) {
  try {
    const { user_id, email, full_name, org_name, invite_code } = await request.json();

    if (!user_id || !email) {
      return Response.json({ error: 'Missing fields' }, { status: 400 });
    }

    const supabase = createAdminClient();
    let orgId: string;
    let role = 'admin';

    if (invite_code) {
      // Join existing org via invite code
      const { data: invitedOrg } = await supabase
        .from('organizations')
        .select('id')
        .eq('invite_code', invite_code)
        .single();

      if (invitedOrg) {
        orgId = invitedOrg.id;
        role = 'member';
      } else {
        return Response.json({ error: 'Invalid invite code' }, { status: 400 });
      }
    } else {
      // Create new organization
      if (!org_name) {
        return Response.json({ error: 'Missing org_name' }, { status: 400 });
      }

      const { data: org, error: orgError } = await supabase
        .from('organizations')
        .insert({ name: org_name })
        .select('id')
        .single();

      if (orgError || !org) {
        return Response.json({ error: 'Failed to create organization' }, { status: 500 });
      }

      orgId = org.id;

      // Create empty org profile
      await supabase
        .from('org_profiles')
        .insert({
          org_id: orgId,
          data: { name: org_name },
        });
    }

    // Create user record linked to org
    const { error: userError } = await supabase
      .from('users')
      .insert({
        id: user_id,
        org_id: orgId,
        email,
        full_name: full_name || null,
        role,
      });

    if (userError) {
      return Response.json({ error: 'Failed to create user' }, { status: 500 });
    }

    return Response.json({ org_id: orgId });
  } catch (error) {
    console.error('Auth setup error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
