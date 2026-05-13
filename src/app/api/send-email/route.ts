import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/api-auth';

// Gmail send endpoint — uses Resend or SMTP
// TODO: integrate with Resend API when RESEND_API_KEY is available

export const POST = withAuth(async (req, auth) => {
  try {
    const { to, subject, body, from_name } = await req.json();

    if (!to || !subject || !body) {
      return NextResponse.json({ error: 'Missing required fields: to, subject, body' }, { status: 400 });
    }

    // Check if we have Resend API key for server-side sending
    const resendKey = process.env.RESEND_API_KEY;

    if (resendKey) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${resendKey}`,
        },
        body: JSON.stringify({
          from: from_name ? `${from_name} <onboarding@resend.dev>` : 'Goldfish <onboarding@resend.dev>',
          to: [to],
          subject,
          html: body.replace(/\n/g, '<br>'),
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        console.error('Resend error:', err);
        return NextResponse.json({ error: 'Failed to send email', fallback: 'mailto' }, { status: 500 });
      }

      const data = await res.json();
      return NextResponse.json({ success: true, id: data.id });
    }

    // Fallback: return mailto link for client-side opening
    const mailtoUrl = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

    return NextResponse.json({
      success: true,
      method: 'mailto',
      mailto_url: mailtoUrl,
    });
  } catch (error) {
    console.error('Send email error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
});
