/**
 * Daily 5 set rotation. One CT day, one set, stable across requests.
 *
 * The day key is `getPackptsDayKey` (America/Chicago midnight). The roster
 * is the active integrated list from `loadActiveIntegratedSets` (same query
 * as GET /api/sets). Order is created_at ascending, then set id, so a newly
 * added set appends. Index is calendar days since DAILY5_ROTATION_EPOCH,
 * mod the roster length. A set under PUBLIC_SET_MIN_ELIGIBLE_CARDS is
 * skipped and the next set is used.
 *
 * A stored daily_challenges row is not recomputed. Adding or removing a set
 * does not rewrite past days that already have a row.
 */
import { isPackptsDayKey } from "@shared/packptsDay";
import { PUBLIC_SET_MIN_ELIGIBLE_CARDS } from "./playableSetEligibility";

/** Fixed CT calendar epoch. Do not change this; it would move every unstored day. */
export const DAILY5_ROTATION_EPOCH = "2020-01-01";

const MS_PER_DAY = 86_400_000;

export interface Daily5RotationCandidate {
  id: string;
  createdAt?: Date | string | null;
  cardCount: number;
}

export function daysSinceDaily5Epoch(dayKey: string): number {
  if (!isPackptsDayKey(dayKey) || !isPackptsDayKey(DAILY5_ROTATION_EPOCH)) {
    throw new Error("invalid packpts day key");
  }
  const epoch = Date.parse(`${DAILY5_ROTATION_EPOCH}T00:00:00.000Z`);
  const day = Date.parse(`${dayKey}T00:00:00.000Z`);
  return Math.round((day - epoch) / MS_PER_DAY);
}

function positiveMod(value: number, modulus: number): number {
  if (modulus <= 0) return 0;
  return ((value % modulus) + modulus) % modulus;
}

function createdAtMs(value: Date | string | null | undefined): number {
  if (!value) return 0;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

export function compareDaily5RotationOrder(
  a: Daily5RotationCandidate,
  b: Daily5RotationCandidate,
): number {
  const delta = createdAtMs(a.createdAt) - createdAtMs(b.createdAt);
  if (delta !== 0) return delta;
  return a.id.localeCompare(b.id);
}

export function orderDaily5RotationSets<T extends Daily5RotationCandidate>(sets: readonly T[]): T[] {
  return [...sets].sort(compareDaily5RotationOrder);
}

/** Roster walk for a CT day, starting at the rotation index. Includes thin sets. */
export function daily5RotationCandidates<T extends Daily5RotationCandidate>(
  sets: readonly T[],
  dayKey: string,
): T[] {
  const ordered = orderDaily5RotationSets(sets);
  const count = ordered.length;
  if (count === 0) return [];
  const start = positiveMod(daysSinceDaily5Epoch(dayKey), count);
  const out: T[] = [];
  for (let step = 0; step < count; step++) {
    out.push(ordered[(start + step) % count]);
  }
  return out;
}

/** First roster set at or after the day's index with at least 5 eligible cards. */
export function pickDaily5RotationSet<T extends Daily5RotationCandidate>(
  sets: readonly T[],
  dayKey: string,
): T | null {
  for (const set of daily5RotationCandidates(sets, dayKey)) {
    if (set.cardCount >= PUBLIC_SET_MIN_ELIGIBLE_CARDS) return set;
  }
  return null;
}
