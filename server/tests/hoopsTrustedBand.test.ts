/**
 * 1990 Hoops trusted profile band (`trustProfileBand`).
 *
 * - The fallback replaces mask_band_oversized, name_plate_unresolved, and a
 *   name_text_visible plate-row trip, only on a flagged profile.
 * - The post-mask OCR check refuses 3+ surname letters outside the band, and
 *   refuses on an OCR timeout.
 * - Every other registered profile, and the unmatched default used by
 *   2024 Basketball and 2022 Chronicles, bakes exactly as before.
 * - The 16 Hoops cards on BLOCKED_CARD_ID_RULES stay blocked (12 from #168, 4 from Design clearance).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { buildSetMaskHint, type NamePlateBox } from "@shared/maskGeometry";

vi.mock("../db", () => ({
  db: { update: vi.fn(), insert: vi.fn(), select: vi.fn(), delete: vi.fn() },
  pool: { on: vi.fn() },
}));

const plates = vi.hoisted(() => ({
  anchor: null as NamePlateBox | null,
  top: null as NamePlateBox | null,
  bottom: null as NamePlateBox | null,
}));

vi.mock("../masking/namePlateDetect", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../masking/namePlateDetect")>();
  return {
    ...actual,
    detectAnchorPlate: vi.fn(async () => plates.anchor),
    detectAnchorTextPlate: vi.fn(async (_buffer: Buffer, anchor: string) => (anchor === "top" ? plates.top : plates.bottom)),
  };
});

import { applyPercentRegions, maskCardImage } from "../masking/maskCardImage";
import { AWAITING_DESIGN_CLEARANCE_REASON, holdReasonForIdentity } from "../config/heldSets";
import {
  getMaskProfile,
  HOOPS_1990_PROFILE_ID,
  MASK_HOLD_EXEMPT_SET_IDS,
  MASK_LAYOUT_SET_IDS,
} from "../masking/maskProfiles";
import { resolveNameMaskPlan, type OcrWordBox } from "../masking/nameLocalization";
import { maskBandFailure, MAX_TOP_BAND_PCT } from "../masking/maskBandLimit";
import { setOcrJobFactoryForTests, resetOcrRuntimeForTests } from "../masking/ocrRuntime";
import {
  PROFILE_BAND_UNVERIFIED,
  tokenHasSurnameRun,
  trustedProfileBandCheck,
  verifyTrustedProfileBand,
} from "../masking/trustedProfileBand";
import {
  BLOCKED_CARD_ID_RULES,
  HOOPS_1990_SET_PREFIX,
  cardBlocklistWhereBody,
  isBlockedCard,
  isBlockedCardIdRow,
} from "../lib/cardBlocklist";

const W = 500;
const H = 700;
const HOOPS_SET_ID = "d226801a-da94-47f6-a09a-3735def60b2d";
const HOOPS_HINT = buildSetMaskHint({ year: 1990, brand: "Hoops", sport: "basketball", setName: "1990 Hoops Basketball" });

const OTHER_PROFILES = [
  { label: "1987 Topps", hint: buildSetMaskHint({ year: 1987, brand: "Topps", sport: "baseball", setName: "1987 Topps" }), id: MASK_LAYOUT_SET_IDS.toppsBaseball1987 },
  { label: "1987 Topps Football", hint: buildSetMaskHint({ year: 1987, brand: "Topps", sport: "football", setName: "1987 Topps Football" }), id: MASK_LAYOUT_SET_IDS.toppsFootball1987 },
  { label: "1989 Fleer (fleer-bball-top)", hint: buildSetMaskHint({ year: 1989, brand: "Fleer", sport: "basketball", setName: "1989 Fleer Basketball" }), id: MASK_LAYOUT_SET_IDS.fleerBasketball1989 },
  { label: "1989 Topps", hint: buildSetMaskHint({ year: 1989, brand: "Topps", sport: "baseball", setName: "1989 Topps" }), id: MASK_LAYOUT_SET_IDS.toppsBaseball1989 },
  { label: "1994 Topps Football", hint: buildSetMaskHint({ year: 1994, brand: "Topps", sport: "football", setName: "1994 Topps Football" }), id: MASK_LAYOUT_SET_IDS.toppsFootball1994 },
  { label: "2022 Panini Chronicles", hint: buildSetMaskHint({ year: 2022, brand: "Panini", sport: "football", setName: "2022 Panini Chronicles Football" }), id: MASK_HOLD_EXEMPT_SET_IDS[0] },
  { label: "2024 Basketball", hint: buildSetMaskHint({ year: 2025, brand: "Topps", sport: "basketball", setName: "2024 Basketball", category: "basketball" }), id: MASK_HOLD_EXEMPT_SET_IDS[1] },
] as const;

/** Light card, mid-gray photo box. The plate detectors are mocked. */
async function card(): Promise<Buffer> {
  const photo = await sharp({ create: { width: W - 60, height: Math.round(H * 0.6), channels: 3, background: { r: 120, g: 110, b: 100 } } }).png().toBuffer();
  return sharp({ create: { width: W, height: H, channels: 3, background: { r: 200, g: 200, b: 205 } } })
    .composite([{ input: photo, left: 30, top: Math.round(H * 0.22) }])
    .jpeg({ quality: 90 })
    .toBuffer();
}

function box(topPct: number, endPct: number): NamePlateBox {
  return { x: 0, y: Math.round(topPct * H), w: W, h: Math.round((endPct - topPct) * H) };
}

type OcrScript = (call: { width: number; index: number }) => { words: OcrWordBox[]; hang?: boolean };

const ocrCalls: Array<{ width: number }> = [];
function scriptOcr(script: OcrScript) {
  ocrCalls.length = 0;
  setOcrJobFactoryForTests((_buffer, width) => {
    const index = ocrCalls.length;
    ocrCalls.push({ width });
    const { words, hang } = script({ width, index });
    return {
      promise: hang ? new Promise(() => {}) : Promise.resolve({ words }),
      cancel: () => {},
    };
  });
}

const savedGuard = process.env.MASK_BAND_GUARD;

beforeEach(() => {
  process.env.MASK_BAND_GUARD = "enforce";
  plates.anchor = null;
  plates.top = null;
  plates.bottom = null;
  scriptOcr(() => ({ words: [] }));
});

afterEach(() => {
  if (savedGuard == null) delete process.env.MASK_BAND_GUARD;
  else process.env.MASK_BAND_GUARD = savedGuard;
  resetOcrRuntimeForTests();
});

/** Same card with black/white letter-like stripes from 18% to 19.6% (just under the band). */
async function cardWithStripesUnderBand(): Promise<Buffer> {
  const stripeH = Math.round(H * 0.016);
  const raw = Buffer.alloc(W * stripeH * 3);
  for (let y = 0; y < stripeH; y++) {
    for (let x = 0; x < W; x++) {
      const v = Math.floor(x / 6) % 2 === 0 ? 10 : 245;
      const i = (y * W + x) * 3;
      raw[i] = v; raw[i + 1] = v; raw[i + 2] = v;
    }
  }
  const stripes = await sharp(raw, { raw: { width: W, height: stripeH, channels: 3 } }).png().toBuffer();
  return sharp(await card()).composite([{ input: stripes, left: 0, top: Math.round(H * 0.18) + 1 }]).png().toBuffer();
}

async function bake(playerName: string, setHint: string, gameSetId: string) {
  return maskCardImage(await card(), playerName, setHint, { gameSetId, skipOcr: true, imageRotation: 0, recordOrientNote: false });
}

describe("trustProfileBand flag", () => {
  it("is set only on 1990 Hoops", () => {
    const hoops = getMaskProfile(HOOPS_HINT, HOOPS_SET_ID);
    expect(hoops.id).toBe(HOOPS_1990_PROFILE_ID);
    expect(hoops.trustProfileBand).toBe(true);
    expect(hoops.topBandPct).toBe(0.18);
    for (const other of OTHER_PROFILES) {
      expect(getMaskProfile(other.hint, other.id).trustProfileBand, other.label).toBe(false);
    }
    expect(getMaskProfile("1989 Upper Deck").trustProfileBand).toBe(false);
    expect(getMaskProfile("1952 Topps").trustProfileBand).toBe(false);
    expect(getMaskProfile("").trustProfileBand).toBe(false);
  });
});

describe("trustedProfileBandCheck", () => {
  const hoops = getMaskProfile(HOOPS_HINT, HOOPS_SET_ID);
  const base = { profile: hoops, words: [], playerName: "Dennis Rodman", imageWidth: W, imageHeight: H };

  it("trusts an absent run, a run inside the band, and a photo-tall run", () => {
    expect(trustedProfileBandCheck({ ...base, topTextPlate: null }).ok).toBe(true);
    expect(trustedProfileBandCheck({ ...base, topTextPlate: box(0, 0.06) }).ok).toBe(true);
    expect(trustedProfileBandCheck({ ...base, topTextPlate: box(0, 0.195) }).ok).toBe(true);
    expect(trustedProfileBandCheck({ ...base, topTextPlate: box(0, 0.41) }).ok).toBe(true);
  });

  it("does not trust a run that ends just past the band", () => {
    expect(trustedProfileBandCheck({ ...base, topTextPlate: box(0, 0.21) }).ok).toBe(false);
  });

  it("does not trust OCR surname boxes below the band or on the bottom plate", () => {
    const below = [{ text: "RODMAN", x: 20, y: Math.round(H * 0.17), w: 120, h: Math.round(H * 0.04) }];
    expect(trustedProfileBandCheck({ ...base, topTextPlate: null, words: below }).ok).toBe(false);
    const bottom = [{ text: "RODMAN", x: 20, y: Math.round(H * 0.9), w: 120, h: 20 }];
    expect(trustedProfileBandCheck({ ...base, topTextPlate: null, words: bottom }).ok).toBe(false);
    const inside = [{ text: "RODMAN", x: 20, y: Math.round(H * 0.02), w: 120, h: Math.round(H * 0.05) }];
    expect(trustedProfileBandCheck({ ...base, topTextPlate: null, words: inside }).ok).toBe(true);
  });

  it("does not trust a landscape file or any unflagged profile", () => {
    expect(trustedProfileBandCheck({ ...base, topTextPlate: null, imageWidth: H, imageHeight: W }).ok).toBe(false);
    for (const other of OTHER_PROFILES) {
      expect(trustedProfileBandCheck({ ...base, profile: getMaskProfile(other.hint, other.id), topTextPlate: null }).ok, other.label).toBe(false);
    }
  });
});

describe("surname run rule", () => {
  it("matches 3 consecutive surname letters, case-insensitive, and the whole of a short surname", () => {
    expect(tokenHasSurnameRun("Don Nelson", "NELS")).toBe(true);
    expect(tokenHasSurnameRun("Don Nelson", "els")).toBe(true);
    expect(tokenHasSurnameRun("Don Nelson", "NE")).toBe(false);
    expect(tokenHasSurnameRun("K.C. Jones", "JO")).toBe(false);
    expect(tokenHasSurnameRun("Manute Bol", "BOL")).toBe(true);
    expect(tokenHasSurnameRun("Manute Bol", "BO")).toBe(false);
    expect(tokenHasSurnameRun("Dennis Rodman", "pistons")).toBe(false);
  });
});

describe("1990 Hoops bake with the trusted band", () => {
  it("paints the 18% profile band instead of refusing an oversized detected plate", async () => {
    plates.anchor = box(0, 0.38);
    plates.top = box(0, 0.38);
    plates.bottom = box(0.85, 0.92);
    const result = await bake("Byron Scott", HOOPS_HINT, HOOPS_SET_ID);
    expect(result.trustedBand?.trigger).toBe("mask_band_oversized");
    expect(result.regions).toEqual([{ xPct: 0, yPct: 0, wPct: 100, hPct: 18, type: "blur", radiusPct: 0 }]);
    expect(maskBandFailure(result.regions)).toBeNull();
    expect(result.plateTrace.decision).toBe("trusted_profile_band");
    expect(result.coverageOk).toBe(true);
    expect(result.coverageReason).toBeNull();
    // Full card plus the left and right halves of the strip under the band.
    expect(ocrCalls).toHaveLength(3);
  });

  it("refuses when OCR reads 3 surname letters in the strip under the band", async () => {
    plates.anchor = box(0, 0.38);
    plates.top = box(0, 0.38);
    scriptOcr(({ index }) => ({ words: index === 1 ? [{ text: "NELS", x: 10, y: 4, w: 60, h: 20 }] : [] }));
    const result = await bake("Don Nelson", HOOPS_HINT, HOOPS_SET_ID);
    expect(result.trustedBand?.trigger).toBe("mask_band_oversized");
    expect(result.coverageOk).toBe(false);
    expect(result.coverageReason).toBe("name_text_visible");
  });

  it("refuses when OCR reads the surname anywhere outside the band on the full card", async () => {
    plates.top = null;
    plates.bottom = box(0.86, 0.93);
    scriptOcr(({ index }) => ({
      words: index === 0 ? [{ text: "PAYTON", x: 100, y: Math.round(H * 0.88), w: 200, h: 30 }] : [],
    }));
    const result = await bake("Gary Payton", HOOPS_HINT, HOOPS_SET_ID);
    expect(result.trustedBand?.trigger).toBe("name_plate_unresolved");
    expect(result.coverageOk).toBe(false);
    expect(result.coverageReason).toBe("name_text_visible");
  });

  it("refuses when the verification OCR times out", async () => {
    plates.anchor = box(0, 0.38);
    plates.top = box(0, 0.38);
    const verdict = await verifyTrustedProfileBand({
      buffer: await card(),
      playerName: "Byron Scott",
      regions: [{ xPct: 0, yPct: 0, wPct: 100, hPct: 18, type: "blur", radiusPct: 0 }],
      bandBottomPct: 0.18,
      imageWidth: W,
      imageHeight: H,
      deadlineMs: 30,
      recognize: async (_b, _w, opts) => ({ words: [], timedOut: (opts?.deadlineMs ?? 0) <= 30, ms: 30 }),
    });
    expect(verdict).toEqual({ ok: false, reason: PROFILE_BAND_UNVERIFIED, token: null });
  });

  it("bakes a name_plate_unresolved card with the profile band when OCR is clean", async () => {
    plates.anchor = box(0, 0.06);
    plates.top = null;
    plates.bottom = box(0.86, 0.93);
    const result = await bake("Kevin Gamble", HOOPS_HINT, HOOPS_SET_ID);
    expect(result.trustedBand?.trigger).toBe("name_plate_unresolved");
    expect(result.regions).toHaveLength(1);
    expect(result.regions[0].hPct).toBe(18);
    expect(result.coverageOk).toBe(true);
  });

  it("hands a plate-row trip under the band to the OCR check, and serves when OCR is clean", async () => {
    plates.anchor = box(0, 0.174);
    plates.top = box(0, 0.174);
    const source = await cardWithStripesUnderBand();
    const hoops = await maskCardImage(source, "Manute Bol", HOOPS_HINT, { gameSetId: HOOPS_SET_ID, skipOcr: true, imageRotation: 0, recordOrientNote: false });
    expect(hoops.trustedBand?.trigger).toBe("name_text_visible");
    expect(hoops.regions).toHaveLength(1);
    expect(hoops.regions[0].hPct).toBe(18);
    expect(hoops.coverageOk).toBe(true);

    // The same pixels on 1989 Fleer (same 18% band, not flagged) still refuse.
    ocrCalls.length = 0;
    const fleer = OTHER_PROFILES[2];
    const other = await maskCardImage(source, "Manute Bol", fleer.hint, { gameSetId: fleer.id, skipOcr: true, imageRotation: 0, recordOrientNote: false });
    expect(other.trustedBand).toBeNull();
    expect(other.coverageOk).toBe(false);
    expect(other.coverageReason).toBe("name_text_visible");
    expect(ocrCalls).toHaveLength(0);
  });

  it("refuses a plate-row trip when OCR then reads the surname", async () => {
    plates.anchor = box(0, 0.174);
    plates.top = box(0, 0.174);
    scriptOcr(({ index }) => ({ words: index === 2 ? [{ text: "BOL", x: 10, y: 2, w: 40, h: 18 }] : [] }));
    const source = await cardWithStripesUnderBand();
    const hoops = await maskCardImage(source, "Manute Bol", HOOPS_HINT, { gameSetId: HOOPS_SET_ID, skipOcr: true, imageRotation: 0, recordOrientNote: false });
    expect(hoops.trustedBand?.trigger).toBe("name_text_visible");
    expect(hoops.coverageOk).toBe(false);
    expect(hoops.coverageReason).toBe("name_text_visible");
  });

  it("keeps refusing when the top letter run ends just past the band", async () => {
    plates.anchor = box(0, 0.38);
    plates.top = box(0, 0.21);
    const result = await bake("Byron Scott", HOOPS_HINT, HOOPS_SET_ID);
    expect(result.trustedBand).toBeNull();
    expect(result.plateTrace.decision).toBe("plate_extends_profile");
    expect(maskBandFailure(result.regions)).toBe("mask_band_oversized");
    expect(ocrCalls).toHaveLength(0);
  });

  it("does not use the fallback in report mode (no band refusal to replace)", async () => {
    process.env.MASK_BAND_GUARD = "report";
    plates.anchor = box(0, 0.38);
    plates.top = box(0, 0.38);
    const result = await bake("Byron Scott", HOOPS_HINT, HOOPS_SET_ID);
    expect(result.trustedBand).toBeNull();
    expect(result.plateTrace.decision).toBe("plate_extends_profile");
  });

  it("leaves a Hoops card the old path already served unchanged", async () => {
    plates.anchor = box(0, 0.08);
    plates.top = box(0, 0.08);
    const result = await bake("Larry Bird", HOOPS_HINT, HOOPS_SET_ID);
    expect(result.trustedBand).toBeNull();
    expect(result.plateTrace.decision).toBe("profile_band");
    expect(ocrCalls).toHaveLength(0);
  });

  it("keeps MAX_TOP_BAND_PCT at 35", () => {
    expect(MAX_TOP_BAND_PCT).toBe(35);
  });
});

describe("other profiles bake exactly as before", () => {
  const scenarios: Array<{ name: string; anchor: NamePlateBox | null; top: NamePlateBox | null; bottom: NamePlateBox | null }> = [
    { name: "oversized top plate", anchor: box(0, 0.38), top: box(0, 0.38), bottom: box(0.85, 0.92) },
    { name: "bottom run only", anchor: box(0, 0.06), top: null, bottom: box(0.86, 0.93) },
    { name: "top run only", anchor: box(0.7, 1), top: box(0, 0.08), bottom: null },
    { name: "no detection", anchor: null, top: null, bottom: null },
  ];
  for (const other of OTHER_PROFILES) {
    for (const scenario of scenarios) {
      it(`${other.label}: ${scenario.name}`, async () => {
        plates.anchor = scenario.anchor;
        plates.top = scenario.top;
        plates.bottom = scenario.bottom;
        const source = await card();
        const result = await maskCardImage(source, "Test Player", other.hint, { gameSetId: other.id, skipOcr: true, imageRotation: 0, recordOrientNote: false });
        const profile = getMaskProfile(other.hint, other.id);
        const expected = resolveNameMaskPlan({
          playerName: "Test Player",
          setHint: other.hint,
          gameSetId: other.id,
          words: [],
          imageWidth: W,
          imageHeight: H,
          slabLayout: false,
          plateBox: profile.nameAnchor === "both" ? null : scenario.anchor,
          topTextPlate: scenario.top,
          bottomTextPlate: scenario.bottom,
        });
        expect(result.trustedBand).toBeNull();
        expect(result.regions).toEqual(expected.regions);
        expect(result.plateTrace.decision).toBe(expected.plateTrace.decision);
        expect(result.plateTrace.decision).not.toBe("trusted_profile_band");
        if (expected.namePlateUnresolved) expect(result.coverageReason).toBe("name_plate_unresolved");
        const pixels = await applyPercentRegions(source, expected.regions);
        expect(result.maskedBuffer.equals(pixels)).toBe(true);
        // The trusted-band OCR never runs off Hoops.
        expect(ocrCalls).toHaveLength(0);
      });
    }
  }
});

describe("1990 Hoops card blocklist", () => {
  const HOOPS_BLOCKED = [
    { id: "551ee60e-478f-4c75-b0ab-41c7217d00da", player: "K.C. Jones", number: "343" },
    { id: "467667f7-1149-4270-a568-187ddb9b0ed1", player: "Wes Unseld", number: "344" },
    { id: "0a468fe3-721d-4e83-a580-cf3df5fc321b", player: "Don Nelson", number: "345" },
    { id: "41758b03-4135-4593-9fea-a63e2a38d5b6", player: "Bob Weiss", number: "346" },
    { id: "b077f597-97dd-49f5-800c-341fdda7f2a8", player: "Chris Ford", number: "347" },
    { id: "63e1216f-0d38-4239-af92-9bd067588c67", player: "Phil Jackson", number: "348" },
    { id: "ffea1480-e2b9-485d-9f6e-6b9f7d12134d", player: "Don Chaney", number: "350" },
    { id: "a949ea98-bf2d-49fa-b51b-caf592986d81", player: "Jerry Sloan", number: "354" },
    { id: "2d9492f0-6f04-4a42-9ad6-cf2385938613", player: "Michael Jordan", number: "382" },
    { id: "0a61f1ce-6a84-438f-acf6-d6d8c5e9d2c1", player: "Gary Payton", number: "391" },
    { id: "349a5190-a09e-4804-bd32-e2bcd50ed9cd", player: "Horace Grant", number: "63" },
    { id: "8aa2109c-53d4-4417-9cf9-0aae98e59de7", player: "David Robinson", number: "NNO" },
    // Design clearance 2026-10-02.
    { id: "fa62eec8-75b8-4624-ba6b-85b37dacf621", player: "John Salley", number: "110" },
    { id: "2d7222b3-9acf-4d5d-9b71-c700e22d535e", player: "Detroit Pistons", number: "339" },
    { id: "9e6319f6-40d3-4695-89c1-9c03d45a298d", player: "Dennis Rodman", number: "109" },
    { id: "badf917b-8887-4cd9-b923-5ab703592ca9", player: "Paul Westhead", number: "422" },
  ];

  it("blocks the four coach-legend cards named in the request, the other eight, and Design's four clearance blocks", () => {
    const hoopsRules = BLOCKED_CARD_ID_RULES.filter((rule) => rule.gameSetId === HOOPS_1990_SET_PREFIX);
    expect(hoopsRules.map((rule) => rule.id).sort()).toEqual(HOOPS_BLOCKED.map((row) => row.id).sort());
    expect(HOOPS_SET_ID.startsWith(HOOPS_1990_SET_PREFIX)).toBe(true);
    for (const required of ["345", "343", "344", "347"]) {
      expect(HOOPS_BLOCKED.some((row) => row.number === required)).toBe(true);
    }
    const body = cardBlocklistWhereBody("playable_cards");
    for (const row of HOOPS_BLOCKED) {
      expect(isBlockedCard(HOOPS_SET_ID, row.player, { id: row.id, number: row.number, variant: "Base" }), row.player).toBe(true);
      expect(isBlockedCardIdRow({ id: row.id, gameSetId: HOOPS_SET_ID, player: row.player, number: row.number, variant: "Base" })).toBe(true);
      expect(body).toContain(row.id);
    }
  });

  it("blocks the Design clearance cards on re-import and leaves Rodman #10 playable", () => {
    expect(isBlockedCardIdRow({ id: "00000000-0000-4000-8000-000000000109", gameSetId: HOOPS_SET_ID, player: "Dennis Rodman", number: "109", variant: "Base" })).toBe(true);
    expect(isBlockedCardIdRow({ id: "00000000-0000-4000-8000-000000000339", gameSetId: HOOPS_SET_ID, player: "Detroit Pistons", number: "339", variant: "Base" })).toBe(true);
    expect(isBlockedCard(HOOPS_SET_ID, "Dennis Rodman", { id: "9210f721-8387-4fa1-8c80-409c550c3394", number: "10", variant: "Base" })).toBe(false);
  });

  it("leaves Chris Ford #306, Michael Jordan #65, and David Robinson #378 playable", () => {
    expect(isBlockedCard(HOOPS_SET_ID, "Chris Ford", { id: "8d44622f-c944-4fdb-8aea-933d08902ca0", number: "306", variant: "Base" })).toBe(false);
    expect(isBlockedCard(HOOPS_SET_ID, "Michael Jordan", { id: "a49bc8e8-9222-4195-809d-d16253619eb9", number: "65", variant: "Base" })).toBe(false);
    expect(isBlockedCard(HOOPS_SET_ID, "David Robinson", { id: "94ba8b0c-8b93-4643-bbe3-c1225c6d0ecf", number: "378", variant: "Base" })).toBe(false);
  });

  it("still blocks a Hoops coach legend after a re-import on the same set prefix", () => {
    const reimported = { id: "00000000-0000-4000-8000-000000000345", gameSetId: HOOPS_SET_ID, player: "Don Nelson", number: "#345", variant: "Base" };
    expect(isBlockedCardIdRow(reimported)).toBe(true);
  });
});

describe("1990 Hoops design clearance", () => {
  const identity = { id: HOOPS_SET_ID, year: 1990, brand: "Hoops", sport: "Basketball", setName: "1990 Hoops Basketball", isActive: true, isUserCreated: false };

  it("is held until its id is in CLEARED_SET_IDS_EXTRA, and that env alone lifts the hold", () => {
    const previous = process.env.CLEARED_SET_IDS_EXTRA;
    try {
      process.env.CLEARED_SET_IDS_EXTRA = "00000000-0000-4000-8000-000000000001";
      expect(holdReasonForIdentity(identity)).toBe(AWAITING_DESIGN_CLEARANCE_REASON);
      process.env.CLEARED_SET_IDS_EXTRA = `00000000-0000-4000-8000-000000000001, ${HOOPS_SET_ID}`;
      expect(holdReasonForIdentity(identity)).toBeNull();
    } finally {
      if (previous === undefined) delete process.env.CLEARED_SET_IDS_EXTRA;
      else process.env.CLEARED_SET_IDS_EXTRA = previous;
    }
  });
});
