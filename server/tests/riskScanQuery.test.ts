import { describe, it, expect, afterAll } from "vitest";
import { db } from "../db";
import { gameSessionsTable as gameSessions } from "@shared/schema";
import { inArray, sql } from "drizzle-orm";
import { activeUsersQuery } from "../services/riskScanWorker";

const tag = `rs-${Date.now()}`;
const recent = new Date(Date.now() - 3600_000).toISOString();
const old = new Date(Date.now() - 3 * 86_400_000).toISOString();
const rows = [
  { u: `${tag}-recent`, s: recent },
  { u: `${tag}-recent-space`, s: recent.replace("T", " ").replace("Z", "+00") },
  { u: `${tag}-old`, s: old },
  { u: `${tag}-empty`, s: "" },
  { u: `${tag}-garbage`, s: "not a date" },
  { u: `${tag}-badmonth`, s: "2026-13-40T99:00:00Z" },
];

describe("RiskScan active-user query on text started_at", () => {
  afterAll(async () => {
    await db.delete(gameSessions).where(inArray(gameSessions.userId, rows.map(r => r.u)));
  });
  it("runs against Postgres, keeps recent ISO rows, skips old/empty/malformed without throwing", async () => {
    await db.insert(gameSessions).values(rows.map(r => ({
      id: `${r.u}-id`, mode: "solo", userId: r.u, questions: [], totalQuestions: 10, startedAt: r.s,
    })) as any);
    const res = await db.execute(activeUsersQuery(10_000));
    const ids = new Set((res.rows as any[]).map(r => r.user_id).filter((u: string) => u?.startsWith(tag)));
    expect(ids).toEqual(new Set([`${tag}-recent`, `${tag}-recent-space`]));
  });
  it("the old uncast comparison is what crashed prod", async () => {
    await expect(db.execute(sql`SELECT 1 FROM game_sessions WHERE started_at > NOW() - INTERVAL '24 hours' LIMIT 1`))
      .rejects.toThrow(/operator does not exist/);
  });
});
