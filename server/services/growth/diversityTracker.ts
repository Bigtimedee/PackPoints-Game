import { db } from "../../db";
import { growthContentItems, growthContentPlans } from "@shared/schema";
import { desc, sql, gte } from "drizzle-orm";

const HOOK_COOLDOWN_DAYS = 2;
const PLAYER_COOLDOWN_DAYS = 3;

export async function getRecentHooks(days: number = HOOK_COOLDOWN_DAYS): Promise<string[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const rows = await db.select({ title: growthContentItems.title })
    .from(growthContentItems)
    .where(gte(growthContentItems.createdAt, cutoff))
    .orderBy(desc(growthContentItems.createdAt))
    .limit(50);

  return rows.map(r => r.title).filter(Boolean) as string[];
}

export async function getRecentPlayerNames(days: number = PLAYER_COOLDOWN_DAYS): Promise<string[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const rows = await db.select({ body: growthContentItems.body, metadata: growthContentItems.metadata })
    .from(growthContentItems)
    .where(gte(growthContentItems.createdAt, cutoff))
    .orderBy(desc(growthContentItems.createdAt))
    .limit(50);

  const names = new Set<string>();
  for (const row of rows) {
    const meta = row.metadata as { mentionedPlayers?: string[] } | null;
    if (meta?.mentionedPlayers) {
      meta.mentionedPlayers.forEach(n => names.add(n));
    }
  }

  return Array.from(names);
}

export async function getRecentThemes(days: number = 5): Promise<string[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const plans = await db.select({ theme: growthContentPlans.theme })
    .from(growthContentPlans)
    .where(gte(growthContentPlans.createdAt, cutoff))
    .orderBy(desc(growthContentPlans.date))
    .limit(10);

  return plans.map(p => p.theme).filter(Boolean) as string[];
}

export function buildDiversityConstraints(recentHooks: string[], recentPlayers: string[], recentThemes: string[]): string {
  const parts: string[] = [];

  if (recentHooks.length > 0) {
    parts.push(`AVOID these recent hooks/titles (used in last ${HOOK_COOLDOWN_DAYS} days): ${recentHooks.slice(0, 10).join("; ")}`);
  }

  if (recentPlayers.length > 0) {
    parts.push(`AVOID mentioning these players (featured in last ${PLAYER_COOLDOWN_DAYS} days): ${recentPlayers.slice(0, 15).join(", ")}`);
  }

  if (recentThemes.length > 0) {
    parts.push(`Recent themes (don't repeat): ${recentThemes.slice(0, 5).join(", ")}`);
  }

  if (parts.length === 0) return "";

  return "\n\nDIVERSITY REQUIREMENTS:\n" + parts.join("\n");
}
