/**
 * Baseball expansion contract. No database and no supplier calls.
 * Fixture names are synthetic. Nothing here is a Design approval.
 */
import { createHash } from "crypto";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import sharp from "sharp";
import { afterAll, describe, expect, it } from "vitest";
import { TOPPS_1988_PROFILE_ID, TOPPS_1988_REGIONS, TOPPS_1988_SET_ID } from "../masking/topps1988Geometry";
import { getMaskProfile, profileIsRegistered } from "../masking/maskProfiles";
import { replaceLifecycleRegistry } from "../services/setLifecycleRegistry";
import { canonicalMembership, canonicalSetKey, collidingIdentities, membershipMatches, planCanonicalBackfill } from "../services/baseballExpansion/identity";
import { exportDesignSet } from "../services/baseballExpansion/exportSet";
import {
  ENGINEERING_SET_MINIMUM,
  approvalHealthBlock,
  designApprovalDecision,
  evaluatePoolHealth,
  sourceFailReasons,
} from "../services/baseballExpansion/health";
import {
  BASEBALL_EXPANSION_TARGETS,
  EXPANSION_NAMESPACE,
  expansionTargetById,
  isDaily5ExpansionBlocked,
  missingExpansionTargets,
} from "../services/baseballExpansion/registry";

function uuidv5(name: string): string {
  const ns = Buffer.from(EXPANSION_NAMESPACE.replace(/-/g, ""), "hex");
  const hash = createHash("sha1").update(ns).update(name).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const h = hash.subarray(0, 16).toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const LIVE = {
  "1986-topps-baseball": "2b77043a-6583-4d79-b59d-d2ab20291a17",
  "1987-topps-baseball": "37fd025d-2ae1-4c92-b8ad-133375d0c722",
  "1988-topps-baseball": "affd57b8-2b1d-4ea3-9f51-1530d8088e5c",
  "1989-topps-baseball": "352b33d1-c110-4e09-b641-8e3c02a94442",
  "1987-donruss-baseball": "3ff8de8d-d6f3-4e3a-bd46-1eadb0c787e4",
} as const;

describe("21 baseball targets", () => {
  it("keeps all 16 missing sets and the five live ids", () => {
    expect(BASEBALL_EXPANSION_TARGETS).toHaveLength(21);
    expect(missingExpansionTargets()).toHaveLength(16);
    for (const [slug, id] of Object.entries(LIVE)) {
      const target = BASEBALL_EXPANSION_TARGETS.find((row) => row.slug === slug);
      expect(target?.id).toBe(id);
      expect(target?.role).toBe("live");
    }
    const held = readFileSync(path.join(__dirname, "../config/heldSets.ts"), "utf8");
    const cleared = held.slice(held.indexOf("export const CLEARED_SET_IDS"), held.indexOf("export const DONRUSS_1987_HOLD_ID"));
    for (const target of missingExpansionTargets()) {
      expect(cleared).not.toContain(target.id);
      expect(isDaily5ExpansionBlocked(target.id)).toBe(true);
      expect(target.baseCount).toBeNull();
      const key = `baseball|${target.identity.year}|${target.identity.brand.toLowerCase()}|${target.identity.setName}`;
      expect(target.id).toBe(uuidv5(key));
    }
    expect(isDaily5ExpansionBlocked(LIVE["1987-topps-baseball"])).toBe(false);
  });

  it("does not treat the 1989 Upper Deck 20% fallback as the new set profile", () => {
    const id = expansionTargetById("eb88c57e-cbd5-5d4b-a223-37b8fa8f99c2")!.id;
    const named = getMaskProfile("1989 Upper Deck");
    expect(named.id).toBe("1989-upper-deck");
    const exact = getMaskProfile("1989 Upper Deck Baseball", id);
    expect(exact.matched).toBe(false);
    expect(exact.id).toBe("default");
    expect(profileIsRegistered(exact, id)).toBe(false);
    const measured = { ...named, id: "measured-ud" };
    replaceLifecycleRegistry([{ setId: id, identity: "baseball|1989|upper deck|1989 upper deck baseball", revision: "r", profile: measured, published: false }]);
    try {
      expect(getMaskProfile("1989 Upper Deck Baseball", id).id).toBe("measured-ud");
    } finally {
      replaceLifecycleRegistry([]);
    }
  });

  it("leaves the 1988 Topps diagonal profile in place", () => {
    const profile = getMaskProfile("1988 Topps Baseball", TOPPS_1988_SET_ID);
    expect(profile.id).toBe(TOPPS_1988_PROFILE_ID);
    expect(profile.regions).toHaveLength(TOPPS_1988_REGIONS.length);
    expect(profile.regions[0]).toMatchObject({ ...TOPPS_1988_REGIONS[0] });
    expect(profile.regions.some((region) => region.wPct >= 100)).toBe(false);
  });
});

describe("original pool health", () => {
  it("requires 95% of the original pool and 100% of the release", () => {
    const ids = Array.from({ length: 20 }, (_, i) => `card-${i}`);
    const pass = ids.map((cardId, index) => ({ cardId, passed: index < 19 }));
    const ok = evaluatePoolHealth({ originalCardIds: ids, results: pass });
    expect(ok.verdict).toBe("pass");
    expect(ok.originalCount).toBe(20);
    expect(ok.releasedCount).toBe(19);
    expect(ok.releasedPassRate).toBe(1);
    expect(ok.cherryPickAllowed).toBe(false);
    const short = evaluatePoolHealth({
      originalCardIds: ids,
      results: ids.map((cardId, index) => ({ cardId, passed: index < 18 })),
    });
    expect(short.verdict).toBe("resubmit_systemic");
    expect(short.releaseAuthorized).toBe(false);
    expect(short.releasedCount).toBe(0);
    expect(short.originalCount).toBe(20);
    const leak = evaluatePoolHealth({
      originalCardIds: ids,
      results: pass,
      releaseIds: [ids[19]!],
    });
    expect(leak.verdict).toBe("released_leak");
    expect(approvalHealthBlock(true, { originalCount: 20, passedCount: 18, releasedCount: 18, verdict: "resubmit_systemic" })?.code).toBe("pool_health");
    expect(approvalHealthBlock(true, { originalCount: 20, passedCount: 19, releasedCount: 19, verdict: "pass" })).toBeNull();
    const denied = designApprovalDecision({ isExpansion: true, profileId: "measured", health: { originalCount: 20, passedCount: 20, releasedCount: 20, verdict: "pass" } });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.code).toBe("held_prep_only");
  });

  it("matches the public set minimum and fails a short or unchecked source", () => {
    const eligibility = readFileSync(path.join(__dirname, "../services/playableSetEligibility.ts"), "utf8");
    expect(eligibility).toContain(`PUBLIC_SET_MIN_ELIGIBLE_CARDS = ${ENGINEERING_SET_MINIMUM}`);
    expect(sourceFailReasons({
      width: 599, height: 800, hasSource: true, hasMasked: true, nameCheckPassed: true,
    })).toContain("short_side");
    expect(sourceFailReasons({
      width: 600, height: 800, hasSource: true, hasMasked: true, nameCheckPassed: false,
    })).toContain("name_check_failed");
    expect(sourceFailReasons({
      width: 600, height: 800, hasSource: true, hasMasked: true, nameCheckPassed: null,
    })).toContain("name_check_unknown");
    const unknown = evaluatePoolHealth({
      originalCardIds: ["a", "b"],
      results: [{ cardId: "a", passed: false, findingsComplete: false }, { cardId: "b", passed: true, findingsComplete: true }],
    });
    expect(unknown.verdict).toBe("findings_incomplete");
    expect(unknown.originalPassRate).toBeNull();
    expect(unknown.thresholdClaimed).toBe(false);
    expect(sourceFailReasons({
      width: 600, height: 800, hasSource: true, hasMasked: true, nameCheckPassed: true, variant: "Base",
    })).toEqual([]);
  });
});

describe("canonical identity", () => {
  const row = (over: Partial<{ sport: string; brand: string; setName: string; year: number; isActive: boolean }>) => ({
    id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    sport: "baseball",
    year: 1986,
    brand: "Fleer",
    setName: "1986 Fleer Baseball",
    isActive: false,
    isUserCreated: false,
    cards: 1,
    ...over,
  });
  const fleer = missingExpansionTargets().find((item) => item.slug === "1986-fleer-baseball")!;
  const topps = missingExpansionTargets().find((item) => item.slug === "1990-topps-baseball")!;
  const ud = missingExpansionTargets().find((item) => item.slug === "1989-upper-deck-baseball")!;

  it("matches mixed case, hyphens, reorder, and Upper Deck aliases, including inactive rows", () => {
    expect(canonicalSetKey({ sport: "Baseball", year: 1986, brand: "FLEER", setName: "Fleer 1986" }))
      .toBe(canonicalSetKey(fleer.identity));
    expect(canonicalSetKey({ sport: "mlb", year: 1986, brand: "fleer", setName: "1986-Fleer-Baseball" }))
      .toBe(canonicalSetKey(fleer.identity));
    expect(canonicalSetKey({ sport: "baseball", year: 1989, brand: "UpperDeck", setName: "1989 UD" }))
      .toBe(canonicalSetKey(ud.identity));
    expect(canonicalSetKey({ sport: "baseball", year: 1989, brand: "Upper-Deck", setName: "Upper Deck Baseball 1989" }))
      .toBe(canonicalSetKey(ud.identity));
    expect(collidingIdentities(fleer.identity, [row({ sport: "Baseball", brand: "fleer", setName: "1986 Fleer", isActive: false })], fleer.id))
      .toHaveLength(1);
  });

  it("does not collide a distinct Topps product or a same-id row", () => {
    expect(canonicalSetKey({ sport: "baseball", year: 1990, brand: "Topps", setName: "1990 Topps Traded" }))
      .not.toBe(canonicalSetKey(topps.identity));
    expect(collidingIdentities(topps.identity, [row({ year: 1990, brand: "Topps", setName: "1990 Topps Traded Baseball" })], topps.id))
      .toEqual([]);
    expect(collidingIdentities(topps.identity, [row({ year: 1990, brand: "Topps", setName: "1990 Topps Tiffany" })], topps.id))
      .toEqual([]);
    expect(collidingIdentities(fleer.identity, [{ ...row({}), id: fleer.id }], fleer.id)).toEqual([]);
  });

  it("plans a backfill without writing and reports collisions", () => {
    const plan = planCanonicalBackfill([
      { id: "a", sport: "Baseball", year: 1986, brand: "Fleer", setName: "1986 Fleer", isActive: false, isUserCreated: false, cards: 1 },
      { id: "b", sport: "baseball", year: 1986, brand: "Fleer", setName: "1986 Fleer Baseball", isActive: true, isUserCreated: false, cards: 2 },
      { id: "c", sport: "baseball", year: 1986, brand: "Topps", setName: "1986 Topps Traded", isActive: true, isUserCreated: false, cards: 3 },
      { id: "d", sport: "baseball", year: 1986, brand: "Topps", setName: "1986 Topps", isActive: true, isUserCreated: true, cards: 4 },
    ]);
    expect(plan.writes).toBe(0);
    expect(plan.skippedUserCreated).toBe(1);
    expect(plan.collisions).toHaveLength(1);
    expect(plan.assignments.map((row) => row.id)).toEqual(["c"]);
  });

  it("rejects a same-size substitution of the original id list", () => {
    const left = canonicalMembership(["b", "a", "a"]);
    const right = canonicalMembership(["a", "c"]);
    expect(left.count).toBe(2);
    expect(left.hash).not.toBe(right.hash);
    expect(membershipMatches(left, { ids: ["a", "b"], hash: left.hash })).toBe(true);
    expect(membershipMatches({ ids: ["a", "b"], hash: left.hash }, { ids: ["a", "c"], hash: canonicalMembership(["a", "c"]).hash })).toBe(false);
    expect(canonicalMembership(["a", "b"]).count).toBe(canonicalMembership(["b", "c"]).count);
  });
});

describe("design export", () => {
  const root = mkdtempSync(path.join(tmpdir(), "packpts-expansion-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  async function jpeg(width: number, height: number): Promise<Buffer> {
    return sharp({ create: { width, height, channels: 3, background: { r: 8, g: 16, b: 24 } } }).jpeg().toBuffer();
  }

  it("writes READY only for a complete explicit pool and keeps the original count", async () => {
    const target = missingExpansionTargets()[0]!;
    const directory = path.join(root, target.slug);
    const source = await jpeg(600, 800);
    const masked = await jpeg(600, 800);
    const cards = Array.from({ length: 20 }, (_, i) => ({
      heldId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      player: `Player ${i}`,
      cardNo: String(i + 1),
      sourceUrl: `https://img.example/${i}.jpg`,
      width: 600,
      height: 800,
      sourceJpeg: source,
      maskedJpeg: masked,
      nameCheckPassed: true,
      variant: "Base",
      proposedCover: i === 0,
    }));
    const first = await exportDesignSet({
      target,
      profile: { explicit: false, profileId: null, side: null, regions: null },
      cards,
      directory,
    });
    expect(first.ready).toBe(false);
    expect(existsSync(path.join(directory, "READY"))).toBe(false);
    expect(existsSync(path.join(directory, "REVIEW_READY"))).toBe(false);
    expect(JSON.parse(readFileSync(path.join(directory, "profile.json"), "utf8")).explicit).toBe(false);
    expect(JSON.parse(readFileSync(path.join(directory, "covers", "NOT_DAILY5.json"), "utf8")).dealDaily5).toBe(false);
    const second = await exportDesignSet({
      target,
      profile: { explicit: true, profileId: "measured-test", side: "bottom", regions: [{ x: 0, y: 0.86, w: 1, h: 0.14 }] },
      cards,
      directory,
    });
    expect(second.ready).toBe(true);
    const marker = JSON.parse(readFileSync(path.join(directory, "REVIEW_READY"), "utf8"));
    expect(marker.releaseApproval).toBe(false);
    expect(marker.reviewReady).toBe(true);
    expect(second.originalCount).toBe(20);
    expect(existsSync(path.join(directory, "source", `${cards[0]!.heldId}.jpg`))).toBe(true);
    expect(existsSync(path.join(directory, "masked", `${cards[0]!.heldId}.jpg`))).toBe(true);
    expect(existsSync(path.join(directory, "masked-300", `${cards[0]!.heldId}.jpg`))).toBe(true);
    const shrunk = await exportDesignSet({
      target,
      profile: { explicit: true, profileId: "measured-test", side: "bottom", regions: [{ x: 0, y: 0.86, w: 1, h: 0.14 }] },
      cards: cards.slice(0, 10),
      directory,
    });
    expect(shrunk.originalCount).toBe(20);
    expect(shrunk.ready).toBe(false);
    expect(shrunk.health.verdict).toBe("resubmit_systemic");
    const manifest = readFileSync(path.join(directory, "original-submitted.csv"), "utf8");
    expect(manifest.trim().split(/\n/)).toHaveLength(21);
    expect(manifest).toContain(cards[19]!.heldId);
  });
});
