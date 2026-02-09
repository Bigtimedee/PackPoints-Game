import { db } from "../db";
import { featureFlags } from "@shared/schema";
import { eq, sql, like } from "drizzle-orm";

const panicCache = new Map<string, { enabled: boolean; timestamp: number }>();
const CACHE_TTL_MS = 10_000;

export async function isPanicEnabled(key: string): Promise<boolean> {
  const cached = panicCache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.enabled;
  }

  try {
    const [flag] = await db
      .select({ enabled: featureFlags.enabled })
      .from(featureFlags)
      .where(eq(featureFlags.key, key))
      .limit(1);

    const enabled = flag?.enabled ?? false;
    panicCache.set(key, { enabled, timestamp: Date.now() });
    return enabled;
  } catch (err) {
    console.error(`[PanicService] Error checking flag "${key}":`, err);
    return false;
  }
}

export async function setPanicSwitch(
  key: string,
  enabled: boolean,
  description?: string
): Promise<void> {
  const now = new Date();
  const existing = await db
    .select({ id: featureFlags.id })
    .from(featureFlags)
    .where(eq(featureFlags.key, key))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(featureFlags)
      .set({ enabled, updatedAt: now })
      .where(eq(featureFlags.key, key));
  } else {
    await db.insert(featureFlags).values({
      key,
      enabled,
      description: description || `Panic switch: ${key}`,
      createdAt: now,
      updatedAt: now,
    });
  }

  panicCache.set(key, { enabled, timestamp: Date.now() });
}

export async function getPanicStatus(): Promise<
  Record<string, { enabled: boolean; description: string | null; updatedAt: Date | null }>
> {
  const rows = await db
    .select({
      key: featureFlags.key,
      enabled: featureFlags.enabled,
      description: featureFlags.description,
      updatedAt: featureFlags.updatedAt,
    })
    .from(featureFlags)
    .where(
      like(featureFlags.key, "disable_%")
    );

  const result: Record<string, { enabled: boolean; description: string | null; updatedAt: Date | null }> = {};
  for (const row of rows) {
    result[row.key] = {
      enabled: row.enabled,
      description: row.description,
      updatedAt: row.updatedAt,
    };
  }
  return result;
}
