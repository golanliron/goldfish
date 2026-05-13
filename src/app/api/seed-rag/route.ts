import { NextRequest } from 'next/server';
import { upsertChunks } from '@/lib/ai/rag';
import {
  FISHGOLD_NONPROFITS_REFERENCE,
  FISHGOLD_NONPROFITS_PART2,
  FISHGOLD_SECTOR_KNOWLEDGE,
  FISHGOLD_GRANTS_INTELLIGENCE,
  FISHGOLD_ENGLISH_GRANTS,
  FISHGOLD_VENTURE_PHILANTHROPY,
  FISHGOLD_INDIVIDUAL_DONORS,
  FISHGOLD_FUNDER_INTEL,
  FISHGOLD_BUDGET_INTELLIGENCE,
} from '@/lib/ai/fishgold';
import { FEDERATION_INTELLIGENCE } from '@/lib/ai/federation-intelligence';
import { ISRAELI_FUNDERS_INTELLIGENCE } from '@/lib/ai/israeli-funders';

export const maxDuration = 300; // 5 min for seeding

// Split a large text block into chunks by section headers or paragraphs
function splitToChunks(
  text: string,
  category: string,
  subcategory?: string
): { category: string; subcategory?: string; title: string; content: string }[] {
  const chunks: { category: string; subcategory?: string; title: string; content: string }[] = [];

  // Try splitting by section headers (===, ##, **)
  const sections = text.split(/\n(?=={3,}|#{2,}\s|\*\*[^*]+\*\*:)/);

  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed || trimmed.length < 30) continue;

    // Extract title from first line
    const firstLine = trimmed.split('\n')[0]
      .replace(/^[=#*\s]+/, '')
      .replace(/[=#*:]+$/, '')
      .trim();
    const title = firstLine.slice(0, 120) || `${category} chunk`;
    const content = trimmed;

    // If section is still too large (>2000 chars), split by paragraphs
    if (content.length > 2000) {
      const paragraphs = content.split(/\n\n+/);
      let buffer = '';
      let bufferTitle = title;
      let partNum = 0;

      for (const para of paragraphs) {
        if (buffer.length + para.length > 1500 && buffer.length > 100) {
          partNum++;
          chunks.push({
            category,
            subcategory,
            title: partNum > 1 ? `${bufferTitle} (${partNum})` : bufferTitle,
            content: buffer.trim(),
          });
          buffer = para;
          bufferTitle = title;
        } else {
          buffer += (buffer ? '\n\n' : '') + para;
        }
      }
      if (buffer.trim().length > 30) {
        partNum++;
        chunks.push({
          category,
          subcategory,
          title: partNum > 1 ? `${bufferTitle} (${partNum})` : bufferTitle,
          content: buffer.trim(),
        });
      }
    } else {
      chunks.push({ category, subcategory, title, content });
    }
  }

  return chunks;
}

// Split nonprofits text — each org or org group = chunk
function splitNonprofits(
  text: string,
  subcategory: string
): { category: string; subcategory: string; title: string; content: string }[] {
  const chunks: { category: string; subcategory: string; title: string; content: string }[] = [];

  // Split by org group lines (each line is "Name (details). Name (details).")
  const lines = text.split('\n').filter(l => l.trim().length > 30);

  for (const line of lines) {
    const trimmed = line.trim();
    // Get header-like lines as titles
    if (trimmed.match(/^[*=]+\s/) || trimmed.match(/^[א-ת].*:/)) {
      const title = trimmed.replace(/^[*=\s]+/, '').replace(/[:*=]+$/, '').trim().slice(0, 120);
      chunks.push({
        category: 'nonprofits',
        subcategory,
        title: title || subcategory,
        content: trimmed,
      });
    } else if (trimmed.length > 50) {
      // Extract first org name as title
      const firstOrg = trimmed.match(/^([^(]+)/)?.[1]?.trim().slice(0, 80) || subcategory;
      chunks.push({
        category: 'nonprofits',
        subcategory,
        title: firstOrg,
        content: trimmed,
      });
    }
  }

  return chunks;
}

export async function POST(req: NextRequest) {
  // Simple auth check
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.SEED_SECRET || 'goldfish-seed-2026'}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const allChunks: { category: string; subcategory?: string; title: string; content: string }[] = [];

  // 1. Nonprofits Reference (part 1 — in SECTOR_KNOWLEDGE)
  const sectorChunks = splitToChunks(FISHGOLD_SECTOR_KNOWLEDGE, 'sector', 'overview');
  allChunks.push(...sectorChunks);

  // 2. Nonprofits Reference
  const npRef = splitNonprofits(FISHGOLD_NONPROFITS_REFERENCE, 'reference');
  allChunks.push(...npRef);

  // 3. Nonprofits Part 2
  const npPart2 = splitNonprofits(FISHGOLD_NONPROFITS_PART2, 'expanded');
  allChunks.push(...npPart2);

  // 4. Grants Intelligence
  const grantsChunks = splitToChunks(FISHGOLD_GRANTS_INTELLIGENCE, 'grants', 'intelligence');
  allChunks.push(...grantsChunks);

  // 5. Federation Intelligence
  const fedChunks = splitToChunks(FEDERATION_INTELLIGENCE, 'funders', 'federations');
  allChunks.push(...fedChunks);

  // 6. Israeli Funders
  const funderChunks = splitToChunks(ISRAELI_FUNDERS_INTELLIGENCE, 'funders', 'israeli');
  allChunks.push(...funderChunks);

  // 7. English Grants
  const engChunks = splitToChunks(FISHGOLD_ENGLISH_GRANTS, 'grants', 'english');
  allChunks.push(...engChunks);

  // 8. Venture Philanthropy
  const vpChunks = splitToChunks(FISHGOLD_VENTURE_PHILANTHROPY, 'funders', 'venture_philanthropy');
  allChunks.push(...vpChunks);

  // 9. Individual Donors
  const donorChunks = splitToChunks(FISHGOLD_INDIVIDUAL_DONORS, 'funders', 'individual_donors');
  allChunks.push(...donorChunks);

  // 10. Funder Intel
  const funderIntelChunks = splitToChunks(FISHGOLD_FUNDER_INTEL, 'funders', 'intel');
  allChunks.push(...funderIntelChunks);

  // 11. Budget Intelligence
  const budgetChunks = splitToChunks(FISHGOLD_BUDGET_INTELLIGENCE, 'budget', 'intelligence');
  allChunks.push(...budgetChunks);

  const result = await upsertChunks(allChunks);

  return Response.json({
    total_chunks: allChunks.length,
    ...result,
    breakdown: {
      sector: sectorChunks.length,
      nonprofits_ref: npRef.length,
      nonprofits_part2: npPart2.length,
      grants: grantsChunks.length,
      federations: fedChunks.length,
      israeli_funders: funderChunks.length,
      english_grants: engChunks.length,
      venture_philanthropy: vpChunks.length,
      individual_donors: donorChunks.length,
      funder_intel: funderIntelChunks.length,
      budget: budgetChunks.length,
    },
  });
}
