// RAG module — embedding, search, and knowledge retrieval
// Uses Gemini text-embedding-004 (768 dimensions) + Supabase pgvector

import { createAdminClient } from '@/lib/supabase/admin';

const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const EMBED_MODEL = 'text-embedding-004';
const EMBED_BASE = `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}`;

// ===== Embedding =====

export async function embed(text: string): Promise<number[]> {
  if (!GEMINI_KEY) throw new Error('GEMINI_API_KEY missing');

  const res = await fetch(`${EMBED_BASE}:embedContent?key=${GEMINI_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: `models/${EMBED_MODEL}`,
      content: { parts: [{ text }] },
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Gemini embed ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  return data.embedding?.values || [];
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (!GEMINI_KEY) throw new Error('GEMINI_API_KEY missing');

  const res = await fetch(`${EMBED_BASE}:batchEmbedContents?key=${GEMINI_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: texts.map(text => ({
        model: `models/${EMBED_MODEL}`,
        content: { parts: [{ text }] },
      })),
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Gemini batchEmbed ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  return (data.embeddings || []).map((e: { values: number[] }) => e.values);
}

// ===== Search =====

export async function searchKnowledge(
  query: string,
  options: {
    category?: string;
    limit?: number;
    threshold?: number;
  } = {}
): Promise<{ title: string; content: string; category: string; subcategory?: string; similarity: number }[]> {
  const { category, limit = 10, threshold = 0.5 } = options;

  const queryEmbedding = await embed(query);
  const supabase = createAdminClient();

  const { data, error } = await supabase.rpc('match_knowledge', {
    query_embedding: queryEmbedding,
    match_count: limit,
    filter_category: category || null,
    similarity_threshold: threshold,
  });

  if (error) {
    console.error('[rag] search error:', error);
    return [];
  }

  return (data || []).map((row: { title: string; content: string; category: string; subcategory: string; similarity: number }) => ({
    title: row.title,
    content: row.content,
    category: row.category,
    subcategory: row.subcategory,
    similarity: row.similarity,
  }));
}

// ===== Build RAG context for prompt =====

export async function buildRAGContext(userMessage: string): Promise<string> {
  const results = await searchKnowledge(userMessage, { limit: 12, threshold: 0.45 });

  if (!results.length) return '';

  const sections = results.map(r =>
    `[${r.category}${r.subcategory ? '/' + r.subcategory : ''}] ${r.title}\n${r.content}`
  );

  return `\n\n===== ידע רלוונטי (RAG) =====\n${sections.join('\n\n')}\n`;
}

// ===== Upsert chunks =====

export async function upsertChunk(chunk: {
  category: string;
  subcategory?: string;
  title: string;
  content: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const embedding = await embed(`${chunk.title}\n${chunk.content}`);
  const supabase = createAdminClient();

  // Check if chunk with same title+category exists
  const { data: existing } = await supabase
    .from('knowledge_chunks')
    .select('id')
    .eq('category', chunk.category)
    .eq('title', chunk.title)
    .limit(1);

  if (existing?.length) {
    await supabase
      .from('knowledge_chunks')
      .update({
        content: chunk.content,
        subcategory: chunk.subcategory || null,
        embedding,
        metadata: chunk.metadata || {},
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing[0].id);
  } else {
    await supabase.from('knowledge_chunks').insert({
      category: chunk.category,
      subcategory: chunk.subcategory || null,
      title: chunk.title,
      content: chunk.content,
      embedding,
      metadata: chunk.metadata || {},
    });
  }
}

export async function upsertChunks(chunks: {
  category: string;
  subcategory?: string;
  title: string;
  content: string;
  metadata?: Record<string, unknown>;
}[]): Promise<{ success: number; failed: number }> {
  let success = 0;
  let failed = 0;

  // Process in batches of 10 to avoid rate limits
  for (let i = 0; i < chunks.length; i += 10) {
    const batch = chunks.slice(i, i + 10);
    const texts = batch.map(c => `${c.title}\n${c.content}`);

    try {
      const embeddings = await embedBatch(texts);
      const supabase = createAdminClient();

      for (let j = 0; j < batch.length; j++) {
        const chunk = batch[j];
        const { error } = await supabase.from('knowledge_chunks').upsert(
          {
            category: chunk.category,
            subcategory: chunk.subcategory || null,
            title: chunk.title,
            content: chunk.content,
            embedding: embeddings[j],
            metadata: chunk.metadata || {},
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'category,title', ignoreDuplicates: false }
        );

        if (error) {
          console.error(`[rag] upsert failed for "${chunk.title}":`, error);
          failed++;
        } else {
          success++;
        }
      }
    } catch (err) {
      console.error(`[rag] batch embed failed:`, err);
      failed += batch.length;
    }

    // Rate limit pause between batches
    if (i + 10 < chunks.length) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  return { success, failed };
}
