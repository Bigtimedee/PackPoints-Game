/**
 * Additive fill-missing import (1987 Donruss). Insert-only: an existing row
 * (approved, pinned) is never rewritten; new rows land held for card review;
 * slab photos, checklists, Ripken, Clemente, off-set, non-base and duplicate
 * numbers never land. Card Hedge is mocked. Fixture rows only.
 */
import { createServer } from "http";
import type { AddressInfo } from "net";
import { randomUUID } from "crypto";
import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";

const stamp = randomUUID().slice(0, 8);
const ch = (n: string) => `fill-missing:${stamp}:${n}`;
const searchCards = [
  // Already in the set: Card Hedge now reports a different image. Must stay untouched.
  { card_id: ch("1"), player: "Wally Joyner", set: "1987 Donruss", number: "1", variant: "Base", category: "Baseball", image: "https://img.example/new-joyner.jpg" },
  { card_id: ch("2"), player: "Roger Clemens", set: "1987 Donruss", number: "2", variant: "Base", category: "Baseball", image: "https://img.example/clemens.jpg" },
  { card_id: ch("3"), player: "Dale Murphy", set: "1987 Donruss", number: "3", variant: "Base", category: "Baseball", image: "" },
  { card_id: ch("4"), player: "Darryl Strawberry", set: "1987 Donruss", number: "4", variant: "Base", category: "Baseball", image: "https://img.example/f1_hometown.jpg" },
  { card_id: ch("5"), player: "Checklist 1-26", set: "1987 Donruss", number: "5", variant: "Base", category: "Baseball", image: "https://img.example/cl.jpg" },
  { card_id: ch("89"), player: "Cal Ripken Jr.", set: "1987 Donruss", number: "89", variant: "Base", category: "Baseball", image: "https://img.example/ripken.jpg" },
  { card_id: ch("612c"), player: "Roberto Clemente", set: "1987 Donruss", number: "612", variant: "Base", category: "Baseball", image: "https://img.example/clemente.jpg" },
  { card_id: ch("7o"), player: "Somebody Else", set: "1987 Donruss Opening Day", number: "7", variant: "Base", category: "Baseball", image: "https://img.example/od.jpg" },
  { card_id: ch("8v"), player: "Glossy Guy", set: "1987 Donruss", number: "8", variant: "Glossy", category: "Baseball", image: "https://img.example/g.jpg" },
  { card_id: ch("9"), player: "Number Nine", set: "1987 Donruss", number: "9", variant: "Base", category: "Baseball", image: "https://img.example/nine.jpg" },
  { card_id: ch("9dup"), player: "Number Nine", set: "1987 Donruss", number: "9", variant: "Base", category: "Baseball", image: "https://img.example/nine2.jpg" },
  { card_id: ch("661"), player: "Too High", set: "1987 Donruss", number: "661", variant: "Base", category: "Baseball", image: "https://img.example/hi.jpg" },
  { card_id: ch("10"), player: "Football Guy", set: "1987 Donruss", number: "10", variant: "Base", category: "Football", image: "https://img.example/fb.jpg" },
];

vi.mock("../services/cardhedge/client", async (orig) => {
  const actual = await orig<typeof import("../services/cardhedge/client")>();
  return {
    ...actual,
    cardSearch: vi.fn(async (req: { page: number }) => ({ cards: req.page === 1 ? searchCards : [], pages: 1 })),
    cardDetails: vi.fn(async (req: { card_id: string }) => ({
      cards: req.card_id === ch("3") ? [{ card_id: ch("3"), image: "https://img.example/murphy-details.jpg" }] : [],
    })),
  };
});

const { db } = await import("../db");
const { gameSets, playableCards, cardReviewApprovals } = await import("@shared/schema");
const { DONRUSS_1987_HOLD_ID } = await import("../config/heldSets");
const { fillExclusionReason, fillMissingCards, FILL_MISSING_SETS, isSlabPhoto } = await import("../services/setFillMissing");
const { registerSetFillQaRoutes } = await import("../routes/setFillQa");

const TOKEN = `fill-${stamp}`;
const previousToken = process.env.COVER_QA_TOKEN;
const existingId = randomUUID();
let createdSet = false;
let base = "";
let server: ReturnType<typeof createServer> | null = null;

beforeAll(async () => {
  process.env.COVER_QA_TOKEN = TOKEN;
  const [found] = await db.select({ id: gameSets.id }).from(gameSets).where(eq(gameSets.id, DONRUSS_1987_HOLD_ID));
  if (!found) {
    await db.insert(gameSets).values({
      id: DONRUSS_1987_HOLD_ID, sport: "baseball", brand: "Donruss", year: 1987, setName: "1987 Donruss Baseball",
      cardhedgeSetQuery: "1987 Donruss Baseball", cardhedgeCategory: "Baseball", isActive: true,
    } as typeof gameSets.$inferInsert);
    createdSet = true;
  }
  await db.insert(playableCards).values({
    id: existingId, gameSetId: DONRUSS_1987_HOLD_ID, cardhedgeCardId: ch("1"), player: "Wally Joyner",
    set: "1987 Donruss", number: "1", variant: "Base", imageUrl: "https://img.example/approved-joyner.jpg", category: "Baseball", isPlayable: true,
  });
  await db.insert(cardReviewApprovals).values({ cardId: existingId, gameSetId: DONRUSS_1987_HOLD_ID, source: "qa", approvedBy: "test", note: "fixture" });
  const app = express();
  app.use(express.json());
  registerSetFillQaRoutes(app);
  server = createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
});

afterAll(async () => {
  const rows = await db.select({ id: playableCards.id }).from(playableCards).where(eq(playableCards.gameSetId, DONRUSS_1987_HOLD_ID));
  const mine = (await db.select({ id: playableCards.id, ch: playableCards.cardhedgeCardId }).from(playableCards)
    .where(inArray(playableCards.id, rows.map((r) => r.id)))).filter((r) => r.ch.startsWith(`fill-missing:${stamp}:`)).map((r) => r.id);
  if (mine.length) {
    await db.delete(cardReviewApprovals).where(inArray(cardReviewApprovals.cardId, mine));
    await db.delete(playableCards).where(inArray(playableCards.id, mine));
  }
  if (createdSet) {
    const { cardhedgeImportRuns } = await import("@shared/schema");
    await db.delete(cardhedgeImportRuns).where(eq(cardhedgeImportRuns.gameSetId, DONRUSS_1987_HOLD_ID));
    await db.delete(gameSets).where(eq(gameSets.id, DONRUSS_1987_HOLD_ID));
  }
  if (previousToken === undefined) delete process.env.COVER_QA_TOKEN; else process.env.COVER_QA_TOKEN = previousToken;
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
});

describe("fill-missing exclusions (pure)", () => {
  const ctx = { sport: "baseball", canonicalSet: "1987 Donruss", config: FILL_MISSING_SETS[DONRUSS_1987_HOLD_ID] };
  const ok = { player: "Kirby Puckett", set: "1987 Donruss", variant: "Base", number: "149", category: "Baseball" };
  it("passes a base card and rejects every excluded kind", () => {
    expect(fillExclusionReason(ok, ctx)).toBeNull();
    expect(fillExclusionReason({ ...ok, player: "Cal Ripken Jr." }, ctx)).toBe("denylist_ripken_wristband_signature");
    expect(fillExclusionReason({ ...ok, player: "Roberto Clemente" }, ctx)).toBe("denylist_off_set_clemente");
    expect(fillExclusionReason({ ...ok, player: "Checklist 27-130" }, ctx)).toBe("classifier_checklist");
    expect(fillExclusionReason({ ...ok, set: "1987 Donruss Rookies" }, ctx)).toBe("off_set");
    expect(fillExclusionReason({ ...ok, set: "1987 Donruss Rookies" }, { ...ctx, acceptSets: ["1987 donruss rookies"] })).toBeNull();
    expect(fillExclusionReason({ ...ok, variant: "Glossy" }, ctx)).toBe("not_base");
    expect(fillExclusionReason({ ...ok, number: "661" }, ctx)).toBe("bad_number");
    expect(fillExclusionReason({ ...ok, category: "Football" }, ctx)).toBe("wrong_sport");
    expect(isSlabPhoto("https://x/f1706882866535x667695662112719000_hometown.jpg")).toBe(true);
    expect(isSlabPhoto("https://x/f1730363329358x756484817878209200_crop_image")).toBe(false);
  });
});

describe("fill-missing import (DB)", () => {
  it("dry run inserts nothing", async () => {
    const report = await fillMissingCards(DONRUSS_1987_HOLD_ID, { dryRun: true, details: true });
    expect(report.canonicalSet).toBe("1987 Donruss");
    expect(report.candidates.map((c) => c.number)).toEqual(["2", "3", "9"]);
    expect(report.inserted).toEqual([]);
    const rows = await db.select({ id: playableCards.id }).from(playableCards).where(eq(playableCards.gameSetId, DONRUSS_1987_HOLD_ID));
    expect(rows.length).toBe(1);
  });

  it("inserts only missing base cards, never touches the existing row, never approves", async () => {
    const report = await fillMissingCards(DONRUSS_1987_HOLD_ID, { dryRun: false, details: true });
    expect(report.inserted.map((r) => r.number).sort()).toEqual(["2", "3", "9"]);
    expect(report.detailsImagesFound).toBe(1);
    expect(report.skipped.psa_slab_photo).toBe(1);
    expect(report.skipped.number_already_in_set).toBe(1);
    expect(report.excluded.map((e) => e.reason).sort()).toEqual([
      "classifier_checklist", "denylist_off_set_clemente", "denylist_ripken_wristband_signature", "psa_slab_photo",
    ]);
    const [kept] = await db.select().from(playableCards).where(eq(playableCards.id, existingId));
    expect(kept.imageUrl).toBe("https://img.example/approved-joyner.jpg");
    const newIds = report.inserted.map((r) => r.id);
    const approvals = await db.select().from(cardReviewApprovals).where(inArray(cardReviewApprovals.cardId, newIds));
    expect(approvals).toEqual([]);
    const [murphy] = await db.select().from(playableCards).where(eq(playableCards.cardhedgeCardId, ch("3")));
    expect(murphy.imageUrl).toBe("https://img.example/murphy-details.jpg");
    const again = await fillMissingCards(DONRUSS_1987_HOLD_ID, { dryRun: false, details: true });
    expect(again.inserted).toEqual([]);
  });
});

describe("fill-missing QA route", () => {
  it("is 404 without the token or for a set that is not allowlisted", async () => {
    const url = `${base}/api/qa/sets/${DONRUSS_1987_HOLD_ID}/fill-missing`;
    expect((await fetch(url, { method: "POST" })).status).toBe(404);
    expect((await fetch(`${url}?token=${TOKEN}`, { method: "POST" })).status).toBe(404);
    expect((await fetch(url, { method: "POST", headers: { "X-QA-Token": "nope" } })).status).toBe(404);
    const other = `${base}/api/qa/sets/${randomUUID()}/fill-missing`;
    expect((await fetch(other, { method: "POST", headers: { "X-QA-Token": TOKEN } })).status).toBe(404);
  });

  it("validates the body and runs a dry-run job by default", async () => {
    const url = `${base}/api/qa/sets/${DONRUSS_1987_HOLD_ID}/fill-missing`;
    const headers = { "X-QA-Token": TOKEN, "Content-Type": "application/json" };
    const bad = await fetch(url, { method: "POST", headers, body: JSON.stringify({ dryRun: "no" }) });
    expect(bad.status).toBe(400);
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify({}) });
    expect(res.status).toBe(202);
    const { jobId, dryRun } = await res.json();
    expect(dryRun).toBe(true);
    let job: { state: string; report?: { inserted: unknown[] } } = { state: "running" };
    for (let i = 0; i < 50 && job.state === "running"; i++) {
      await new Promise((r) => setTimeout(r, 100));
      job = await (await fetch(`${url}/${jobId}`, { headers: { "X-QA-Token": TOKEN } })).json();
    }
    expect(job.state).toBe("completed");
    expect(job.report?.inserted).toEqual([]);
  });
});

describe("1987 Donruss exclusion blocks", () => {
  it("blocks Ripken #89, Clemente #612 (also after a re-import) and the 4 held PSA slab rows by id", async () => {
    const { isBlockedCardIdRow, BLOCKED_CARD_ID_RULES, DONRUSS_1987_SET_PREFIX } = await import("../lib/cardBlocklist");
    const rules = BLOCKED_CARD_ID_RULES.filter((rule) => rule.gameSetId === DONRUSS_1987_SET_PREFIX);
    expect(rules).toHaveLength(15);
    expect(rules.filter((rule) => rule.idOnly)).toHaveLength(10);
    expect(isBlockedCardIdRow({ id: randomUUID(), gameSetId: DONRUSS_1987_HOLD_ID, player: "Cal Ripken Jr.", number: "89", variant: "Base" })).toBe(true);
    expect(isBlockedCardIdRow({ id: randomUUID(), gameSetId: DONRUSS_1987_HOLD_ID, player: "Roberto Clemente", number: "612", variant: "Base" })).toBe(true);
    expect(isBlockedCardIdRow({ id: "77ae124c-2b13-4077-bd52-4746378d31dd", gameSetId: DONRUSS_1987_HOLD_ID, player: "Len Matuszek", number: "423", variant: "Base" })).toBe(true);
    // idOnly: a clean re-imported copy is not matched (the review guard holds it instead).
    expect(isBlockedCardIdRow({ id: randomUUID(), gameSetId: DONRUSS_1987_HOLD_ID, player: "Len Matuszek", number: "423", variant: "Base" })).toBe(false);
    // The 8 pinned covers are not blocked.
    for (const id of ["0a79dce3-4a0b-4acc-a8c5-fef5b7b8beaa", "c5edb3da-0688-4ea3-a305-4238ff7f430b", "a3d21bbd-7c66-470f-a29b-c04188da577d",
      "b9d9cd6d-b2dc-4bed-a359-155b7d38d319", "5c5a365d-c61e-4e1c-83df-c26d3dc4a3c7", "e86503dd-5b91-45bb-8f50-bcdd776f38be",
      "bd8ed5ca-3832-429b-86b4-1e14a3acd403", "31c802bd-9f73-4226-b374-0e258a4a3ac1"]) {
      expect(rules.some((rule) => rule.id === id)).toBe(false);
    }
  });
});

describe("fill-missing prepare (silhouette scan + bake, new cards only)", () => {
  it("bakes only new unreviewed unrefused cards and never approves", async () => {
    const { prepareFilledCards } = await import("../services/setFillMissing");
    const mk = (n: string, extra?: Partial<typeof playableCards.$inferInsert>) => ({
      id: randomUUID(), gameSetId: DONRUSS_1987_HOLD_ID, cardhedgeCardId: ch(`prep-${n}`), player: `Prep Player ${n}`,
      set: "1987 Donruss", number: `6${n}`, variant: "Base", imageUrl: `https://img.example/prep-${n}.jpg`, category: "Baseball", isPlayable: true, ...extra,
    });
    const fresh = mk("1");
    const ghost = mk("2");
    const refused = mk("3");
    const approved = mk("4");
    const blockedReason = mk("5", { isPlayable: false, blockedReason: "name_visible_outside_mask" });
    await db.insert(playableCards).values([fresh, ghost, refused, approved, blockedReason]);
    await db.insert(cardReviewApprovals).values({ cardId: approved.id, gameSetId: DONRUSS_1987_HOLD_ID, source: "qa", approvedBy: "test", note: "fixture" });
    const baked: string[] = [];
    const readySet = new Set<string>();
    const results: { cardId: string; status: string; reason?: string }[] = [];
    await prepareFilledCards(DONRUSS_1987_HOLD_ID, [fresh.id, ghost.id, refused.id, approved.id, blockedReason.id, randomUUID()], {
      analyze: async (url) => ({ isPlaceholder: url.includes("prep-2"), confidence: 90 }),
      bake: async (id) => { baked.push(id); readySet.add(id); },
      ready: (id) => readySet.has(id),
      failure: (id) => (id === refused.id ? "name_visible_outside_mask" : null),
    }, (r) => results.push(r));
    const status = Object.fromEntries(results.map((r) => [r.cardId, r.status]));
    expect(status[fresh.id]).toBe("ready");
    expect(status[ghost.id]).toBe("silhouette");
    expect(status[refused.id]).toBe("skipped");
    expect(status[approved.id]).toBe("skipped");
    expect(status[blockedReason.id]).toBe("skipped");
    expect(baked).toEqual([fresh.id]);
    const rows = await db.select().from(playableCards).where(inArray(playableCards.id, [fresh.id, ghost.id]));
    expect(rows.find((r) => r.id === fresh.id)?.contentVerified).toBe(true);
    expect(rows.find((r) => r.id === ghost.id)?.contentVerified).toBe(false);
    const approvals = await db.select().from(cardReviewApprovals).where(inArray(cardReviewApprovals.cardId, [fresh.id, ghost.id]));
    expect(approvals).toEqual([]);
  });

  it("prepare route requires the token and explicit ids", async () => {
    const url = `${base}/api/qa/sets/${DONRUSS_1987_HOLD_ID}/fill-missing/prepare`;
    expect((await fetch(url, { method: "POST" })).status).toBe(404);
    const headers = { "X-QA-Token": TOKEN, "Content-Type": "application/json" };
    expect((await fetch(url, { method: "POST", headers, body: JSON.stringify({}) })).status).toBe(400);
    expect((await fetch(url, { method: "POST", headers, body: JSON.stringify({ cardIds: ["nope"] }) })).status).toBe(400);
  });
});

describe("stock placeholder images", () => {
  it("treats the Card Hedge 05-Baseball stock image as no image and retires such rows reversibly", async () => {
    const { isStockPlaceholderImage, retirePlaceholderRows } = await import("../services/setFillMissing");
    const stock = "https://s3.amazonaws.com/appforest_uf/f1598844013957x762581963247106700/05-Baseball.jpg";
    expect(isStockPlaceholderImage(stock)).toBe(true);
    expect(isStockPlaceholderImage("https://942284f33c575895b4be9de571ca6e40.cdn.bubble.io/f1730363329358x756484817878209200/crop_image")).toBe(false);
    const a = { id: randomUUID(), gameSetId: DONRUSS_1987_HOLD_ID, cardhedgeCardId: ch("ph-a"), player: "Stock A", number: "640", variant: "Base", imageUrl: stock, category: "Baseball", isPlayable: true };
    const b = { ...a, id: randomUUID(), cardhedgeCardId: ch("ph-b"), player: "Stock B", number: "641" };
    await db.insert(playableCards).values([a, b]);
    await db.insert(cardReviewApprovals).values({ cardId: b.id, gameSetId: DONRUSS_1987_HOLD_ID, source: "qa", approvedBy: "test", note: "fixture" });
    const dry = await retirePlaceholderRows(DONRUSS_1987_HOLD_ID, true);
    expect(dry.retired).toEqual([]);
    const real = await retirePlaceholderRows(DONRUSS_1987_HOLD_ID, false);
    expect(real.retired).toEqual([a.id]);
    const rows = await db.select().from(playableCards).where(inArray(playableCards.id, [a.id, b.id]));
    expect(rows.find((r) => r.id === a.id)?.isPlayable).toBe(false);
    expect(rows.find((r) => r.id === a.id)?.blockedReason).toBe("stock_placeholder_image");
    expect(rows.find((r) => r.id === b.id)?.isPlayable).toBe(true);
  });
});
