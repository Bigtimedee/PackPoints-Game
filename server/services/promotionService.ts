/**
 * Seasonal Promotions Service
 *
 * Manages time-bounded promotions that apply points multipliers to gameplay.
 * Create and manage promotions via admin endpoints.
 */
import { pool } from '../db';

export interface ActivePromotion {
  id: number;
  name: string;
  description: string | null;
  pointsMultiplier: number;
  startAt: Date;
  endAt: Date;
}

let cachedPromotion: ActivePromotion | null = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 60_000; // 1 minute cache

/**
 * Get the currently active promotion, if any.
 * Results are cached for 60 seconds to minimize DB queries.
 */
export async function getActivePromotion(): Promise<ActivePromotion | null> {
  const now = Date.now();
  if (now < cacheExpiry) return cachedPromotion;

  try {
    const result = await pool.query(
      `SELECT id, name, description, points_multiplier, start_at, end_at
       FROM promotions
       WHERE active = true
         AND start_at <= NOW()
         AND end_at >= NOW()
       ORDER BY points_multiplier DESC
       LIMIT 1`
    );

    if (result.rows.length === 0) {
      cachedPromotion = null;
    } else {
      const row = result.rows[0];
      cachedPromotion = {
        id: row.id,
        name: row.name,
        description: row.description,
        pointsMultiplier: parseFloat(row.points_multiplier),
        startAt: row.start_at,
        endAt: row.end_at,
      };
    }

    cacheExpiry = now + CACHE_TTL_MS;
    return cachedPromotion;
  } catch (err) {
    console.error('[Promotions] Error fetching active promotion:', err);
    return null;
  }
}

/**
 * Invalidate the promotion cache (call after creating/updating promotions).
 */
export function invalidatePromotionCache(): void {
  cacheExpiry = 0;
  cachedPromotion = null;
}

/**
 * Apply promotion multiplier to a points value.
 */
export function applyPromotionMultiplier(basePoints: number, promotion: ActivePromotion | null): number {
  if (!promotion) return basePoints;
  return Math.round(basePoints * promotion.pointsMultiplier);
}
