import { NextRequest, NextResponse } from 'next/server';
import { calculateReadiness } from '@/lib/ai/funder-learning';

// GET /api/opportunities/readiness?org_id=xxx&opportunity_id=yyy
export async function GET(req: NextRequest) {
  const orgId = req.nextUrl.searchParams.get('org_id');
  const opportunityId = req.nextUrl.searchParams.get('opportunity_id');

  if (!orgId || !opportunityId) {
    return NextResponse.json({ error: 'Missing org_id or opportunity_id' }, { status: 400 });
  }

  const readiness = await calculateReadiness(orgId, opportunityId);
  return NextResponse.json(readiness);
}
