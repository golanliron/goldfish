import { NextResponse } from 'next/server';

export async function GET() {
  const key = process.env.GEMINI_API_KEY || '';
  if (!key) return NextResponse.json({ error: 'no GEMINI_API_KEY' });

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
  const data = await res.json();

  if (!res.ok) return NextResponse.json({ error: data });

  const models = (data.models || [])
    .filter((m: { supportedGenerationMethods?: string[] }) => m.supportedGenerationMethods?.includes('generateContent'))
    .map((m: { name: string }) => m.name);

  return NextResponse.json({ models });
}
