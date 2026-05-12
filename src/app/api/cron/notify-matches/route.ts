import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

const META_API_VERSION = 'v21.0';
const META_PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID || '';
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN || '';
const GREEN_API_URL = process.env.GREEN_API_URL || '';
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN || '';
const GREEN_API_INSTANCE = process.env.GREEN_API_INSTANCE || '';

const USE_META = !!META_PHONE_NUMBER_ID && !!META_ACCESS_TOKEN;

// Cron: runs after daily scan to notify users about new matches
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results = await notifyNewMatches();
  return Response.json(results);
}

async function notifyNewMatches() {
  const supabase = createAdminClient();
  let notified = 0;
  let skipped = 0;

  // Find matches created in last 24h that haven't been notified
  const { data: newMatches } = await supabase
    .from('matches')
    .select('id, org_id, score, reasoning, opportunity_id, notified_at')
    .is('notified_at', null)
    .gte('score', 60)
    .order('score', { ascending: false });

  if (!newMatches || newMatches.length === 0) {
    return { notified: 0, skipped: 0, message: 'No new matches to notify' };
  }

  // Group by org
  const byOrg: Record<string, typeof newMatches> = {};
  for (const match of newMatches) {
    if (!byOrg[match.org_id]) byOrg[match.org_id] = [];
    byOrg[match.org_id].push(match);
  }

  for (const [orgId, matches] of Object.entries(byOrg)) {
    // Get org users with WhatsApp
    const { data: users } = await supabase
      .from('whatsapp_users')
      .select('phone, name')
      .eq('org_id', orgId)
      .not('phone', 'is', null);

    if (!users || users.length === 0) {
      skipped += matches.length;
      continue;
    }

    // Get opportunity details
    const oppIds = matches.map(m => m.opportunity_id);
    const { data: opps } = await supabase
      .from('opportunities')
      .select('id, title, funder, deadline, url, amount_max')
      .in('id', oppIds)
      .eq('active', true);

    if (!opps || opps.length === 0) {
      skipped += matches.length;
      continue;
    }

    // Get org name
    const { data: org } = await supabase
      .from('organizations')
      .select('name')
      .eq('id', orgId)
      .single();

    // Build notification message
    const lines = opps.slice(0, 3).map((o, i) => {
      const match = matches.find(m => m.opportunity_id === o.id);
      const deadline = o.deadline ? new Date(o.deadline).toLocaleDateString('he-IL') : 'פתוח';
      const amount = o.amount_max ? ` | עד ${(o.amount_max / 1000).toFixed(0)}K` : '';
      return `${i + 1}. *${o.title}*\n   ${o.funder || ''} | ציון: ${match?.score}%${amount}\n   דדליין: ${deadline}${o.url ? `\n   ${o.url}` : ''}`;
    });

    const message =
      `שלום${org?.name ? ` *${org.name}*` : ''}!\n\n` +
      `מצאתי ${opps.length} קולות קוראים חדשים שמתאימים לכם:\n\n` +
      `${lines.join('\n\n')}\n\n` +
      `${opps.length > 3 ? `ועוד ${opps.length - 3} נוספים — שלחו *התאמות* לרשימה המלאה.\n\n` : ''}` +
      `רוצים שאכתוב טיוטת הגשה? שלחו את מספר ההזדמנות.`;

    // Send to all org users
    for (const user of users) {
      await sendWhatsApp(user.phone, message);
    }

    // Mark as notified
    const matchIds = matches.map(m => m.id);
    await supabase
      .from('matches')
      .update({ notified_at: new Date().toISOString() })
      .in('id', matchIds);

    notified += matches.length;
  }

  return { notified, skipped, orgs_notified: Object.keys(byOrg).length };
}

// Deadline reminder — call separately or add to cron
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results = await sendDeadlineReminders();
  return Response.json(results);
}

async function sendDeadlineReminders() {
  const supabase = createAdminClient();
  let reminded = 0;

  // Find matches with deadlines in 7 days or 2 days
  const now = new Date();
  const in2days = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const in7days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const { data: urgentOpps } = await supabase
    .from('opportunities')
    .select('id, title, funder, deadline, url')
    .eq('active', true)
    .or(`deadline.eq.${in2days},deadline.eq.${in7days}`);

  if (!urgentOpps || urgentOpps.length === 0) {
    return { reminded: 0, message: 'No urgent deadlines' };
  }

  const oppIds = urgentOpps.map(o => o.id);

  // Find orgs that have these matches
  const { data: matches } = await supabase
    .from('matches')
    .select('org_id, opportunity_id, score')
    .in('opportunity_id', oppIds)
    .gte('score', 50);

  if (!matches || matches.length === 0) {
    return { reminded: 0 };
  }

  // Group by org
  const byOrg: Record<string, typeof matches> = {};
  for (const m of matches) {
    if (!byOrg[m.org_id]) byOrg[m.org_id] = [];
    byOrg[m.org_id].push(m);
  }

  for (const [orgId, orgMatches] of Object.entries(byOrg)) {
    const { data: users } = await supabase
      .from('whatsapp_users')
      .select('phone')
      .eq('org_id', orgId);

    if (!users || users.length === 0) continue;

    for (const m of orgMatches) {
      const opp = urgentOpps.find(o => o.id === m.opportunity_id);
      if (!opp) continue;

      const daysLeft = opp.deadline === in2days ? 2 : 7;
      const urgency = daysLeft === 2 ? 'עכשיו או אף פעם.' : 'עוד שבוע לסגירה.';

      const message =
        `*תזכורת דדליין*\n\n` +
        `*${opp.title}*\n` +
        `${opp.funder || ''} | נסגר בעוד ${daysLeft} ימים\n` +
        `${urgency}\n\n` +
        `${opp.url ? `${opp.url}\n\n` : ''}` +
        `רוצים שאכתוב הגשה? שלחו "כתוב הגשה ל-${opp.title}"`;

      for (const user of users) {
        await sendWhatsApp(user.phone, message);
      }
      reminded++;
    }
  }

  return { reminded };
}

// ===== Send helpers =====
async function sendWhatsApp(phone: string, text: string) {
  if (USE_META) {
    await sendViaMeta(phone, text);
  } else if (GREEN_API_URL && GREEN_API_INSTANCE && GREEN_API_TOKEN) {
    await sendViaGreenApi(phone, text);
  } else {
    console.log('[Notify] No WhatsApp provider configured:', { phone, text: text.slice(0, 80) });
  }
}

async function sendViaMeta(phone: string, text: string) {
  const url = `https://graph.facebook.com/${META_API_VERSION}/${META_PHONE_NUMBER_ID}/messages`;
  await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${META_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: phone,
      type: 'text',
      text: { body: text },
    }),
  });
}

async function sendViaGreenApi(phone: string, text: string) {
  await fetch(
    `${GREEN_API_URL}/waInstance${GREEN_API_INSTANCE}/sendMessage/${GREEN_API_TOKEN}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: `${phone}@c.us`, message: text }),
    }
  );
}
