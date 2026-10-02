/**
 * Daily 5 set pick.
 *
 * pickDaily5Set is the legacy pick: the active integrated set with the most
 * imported cards. Held sets and user-created sets are not candidates. It still
 * picks every day before the fixed calendar starts, and is the last resort.
 *
 * resolveDaily5SetForDate is the fixed calendar (daily5Calendar.ts) with
 * runtime exclusions and fallback.
 */
import { and, desc, eq, notInArray } from "drizzle-orm";
import { gameSets } from "@shared/schema";
import { db } from "../db";
import { currentHeldSetIds, ensureHeldSets, isHeldSet } from "../config/heldSets";
import {
  daily5CalendarConfig,
  scheduledDaily5Set,
  type Daily5CalendarConfig,
} from "./daily5Calendar";
import {
  DAILY5_CARDS_PER_DEAL,
  daily5DealableCount,
  describeDaily5Set,
  type Daily5SetRow,
} from "./daily5Pool";

export async function pickDaily5Set(): Promise<{ id: string; setName: string } | null> {
  await ensureHeldSets();
  const heldIds = currentHeldSetIds();
  const filters = [
    eq(gameSets.isActive, true),
    eq(gameSets.isUserCreated, false),
  ];
  if (heldIds.length > 0) {
    filters.push(notInArray(gameSets.id, [...heldIds]));
  }
  const [row] = await db
    .select({ id: gameSets.id, setName: gameSets.setName })
    .from(gameSets)
    .where(and(...filters))
    .orderBy(desc(gameSets.cardsImportedCount))
    .limit(1);
  return row ?? null;
}

export type Daily5SetSource = "legacy" | "scheduled" | "fallback" | "last_resort";

export interface Daily5SetChoice {
  id: string;
  setName: string;
  source: Daily5SetSource;
  /** Calendar set for the day, or null before the calendar start. */
  scheduledSetId: string | null;
  slot: "green" | "fallback" | null;
  /** Dealable cards in the chosen set, when it was counted. */
  dealableCount: number | null;
  /** Sets passed over for this day and why. */
  skipped: { id: string; reason: string }[];
}

export interface Daily5ResolverDeps {
  config: () => Daily5CalendarConfig;
  legacyPick: () => Promise<{ id: string; setName: string } | null>;
  refreshHeld: () => Promise<void>;
  isHeld: (id: string) => boolean;
  describe: (id: string) => Promise<Daily5SetRow | null>;
  dealableCount: (id: string) => Promise<number>;
}

export const defaultDaily5ResolverDeps: Daily5ResolverDeps = {
  config: () => daily5CalendarConfig(),
  legacyPick: () => pickDaily5Set(),
  refreshHeld: () => ensureHeldSets(),
  isHeld: (id) => isHeldSet(id),
  describe: (id) => describeDaily5Set(id),
  dealableCount: (id) => daily5DealableCount(id),
};

/**
 * Set for a CT day's Daily 5.
 *
 * Before DAILY5_CALENDAR_START: the legacy pick, unchanged.
 * From the start: the fixed calendar set. A held, inactive, user-created,
 * missing, or under-5-dealable set falls back to DAILY5_FALLBACK_SET_ID, then
 * to the legacy pick, so a day never ends up with an empty deal.
 */
export async function resolveDaily5SetForDate(
  dayKey: string,
  deps: Daily5ResolverDeps = defaultDaily5ResolverDeps,
): Promise<Daily5SetChoice | null> {
  const config = deps.config();
  const scheduled = scheduledDaily5Set(dayKey, config);
  if (!scheduled) {
    const legacy = await deps.legacyPick();
    return legacy
      ? { ...legacy, source: "legacy", scheduledSetId: null, slot: null, dealableCount: null, skipped: [] }
      : null;
  }

  await deps.refreshHeld();
  const skipped: { id: string; reason: string }[] = [];

  const usable = async (id: string): Promise<{ row: Daily5SetRow; count: number } | null> => {
    const row = await deps.describe(id);
    if (!row) { skipped.push({ id, reason: "missing" }); return null; }
    if (!row.isActive || row.isUserCreated) { skipped.push({ id, reason: "inactive" }); return null; }
    if (deps.isHeld(id)) { skipped.push({ id, reason: "held" }); return null; }
    const count = await deps.dealableCount(id);
    if (count < DAILY5_CARDS_PER_DEAL) { skipped.push({ id, reason: "too_few_cards" }); return null; }
    return { row, count };
  };

  const order: { id: string; source: Daily5SetSource }[] = [
    { id: scheduled.setId, source: scheduled.slot === "green" ? "scheduled" : "fallback" },
  ];
  if (config.fallbackSetId !== scheduled.setId) {
    order.push({ id: config.fallbackSetId, source: "fallback" });
  }
  for (const step of order) {
    const ok = await usable(step.id);
    if (ok) {
      return {
        id: ok.row.id,
        setName: ok.row.setName,
        source: step.source,
        scheduledSetId: scheduled.setId,
        slot: scheduled.slot,
        dealableCount: ok.count,
        skipped,
      };
    }
  }

  const legacy = await deps.legacyPick();
  if (legacy && !order.some((step) => step.id === legacy.id)) {
    const ok = await usable(legacy.id);
    if (ok) {
      return {
        id: ok.row.id,
        setName: ok.row.setName,
        source: "last_resort",
        scheduledSetId: scheduled.setId,
        slot: scheduled.slot,
        dealableCount: ok.count,
        skipped,
      };
    }
  }
  console.error(`[Daily5] No dealable set for ${dayKey}: ${skipped.map((s) => `${s.id.slice(0, 8)}:${s.reason}`).join(",")}`);
  return null;
}
