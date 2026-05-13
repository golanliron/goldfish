import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api-auth';
import { calculateReadiness } from '@/lib/ai/funder-learning';

// GET /api/opportunities/readiness — check org readiness for a specific opportunity
export const GET = withAuth(async (req, auth) => {
  const opportunityId = req.nextUrl.searchParams.get('opportunity_id');

  if (!opportunityId) {
    return NextResponse.json({ error: 'Missing opportunity_id' }, { status: 400 });
  }

  const readiness = await calculateReadiness(auth.orgId, opportunityId);
  return NextResponse.json(readiness);
});
