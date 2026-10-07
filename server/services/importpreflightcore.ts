import { z } from 'zod';

// Shared by preflight and both import loops; no conversion to general search.
export function exactImportParameters(set: string, category: string | null | undefined, page = 1, pageSize = 100) {
  return { set, category: category || undefined, page, page_size: pageSize };
}
export const CreatePlayableSetSchema = z.object({
  sport: z.string().min(1, 'sport is required'), brand: z.string().min(1, 'brand is required'), year: z.coerce.number().int().min(1850).max(2100),
  setName: z.string().min(1, 'setName is required'), cardhedgeSetQuery: z.string().optional(), cardhedgeCategory: z.string().optional(),
  marketplaceKeywords: z.array(z.string()).optional().default([]), isActive: z.boolean().optional().default(true),
});
export const ImportPreflightInput = z.object({
  set: z.string().min(1).max(120).refine(s => s.trim().length > 0, 'An exact set is required'),
  category: z.string().max(120).optional(),
});
function integer(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function image(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try { const url = new URL(value.startsWith('//') ? `https:${value}` : value); return url.protocol === 'https:' ? url.href : null; } catch { return null; }
}
export function describeImportPreflight(result: unknown, parameters: ReturnType<typeof exactImportParameters>) {
  if (!result || typeof result !== 'object' || !Array.isArray((result as any).cards)) throw new Error('Invalid provider response');
  const response = result as Record<string, any>;
  const cards = response.cards;
  const count = integer(response.count), total = integer(response.total), pages = integer(response.pages);
  const conflict = count !== null && total !== null && count !== total;
  const reported = conflict ? null : count ?? total;
  const totalCards = reported !== null && reported >= cards.length ? reported : null;
  const pageCount = pages !== null && (totalCards === 0 || pages > 0) ? pages : null;
  return { parameters, totalCards, pages: pageCount, sampleCount: cards.length,
    totalStatus: totalCards === null ? 'unknown' : 'provider_reported',
    countField: totalCards === null ? null : count !== null ? 'count' : 'total',
    observedAt: new Date().toISOString(),
    warning: 'Provider counts describe source matches, not playable cards. Only the first page is previewed; layouts and all eligible cards still require review. Import fetches every page and source contents may change.',
    cards: cards.slice(0,20).map((card: any) => ({ id: typeof card.card_id === 'string' ? card.card_id : '',
      player: typeof card.player === 'string' ? card.player : '', set: typeof card.set === 'string' ? card.set : '',
      number: typeof card.number === 'string' ? card.number : '', description: typeof card.description === 'string' ? card.description : '',
      imageUrl: image(card.image) })) };
}

export async function performImportPreflight(body: unknown, search: (parameters: ReturnType<typeof exactImportParameters>, options: {useCache: boolean}) => Promise<unknown>) {
  const parsed = ImportPreflightInput.safeParse(body);
  if (!parsed.success) return { status: 400, body: { error: 'Enter an exact set query and valid category' } };
  try {
    const parameters = exactImportParameters(parsed.data.set, parsed.data.category);
    const result = await search(parameters, { useCache: false });
    return { status: 200, body: describeImportPreflight(result, parameters) };
  } catch {
    return { status: 503, body: { error: 'Exact import preflight is unavailable. No cards were imported; retry the check before importing.' } };
  }
}
