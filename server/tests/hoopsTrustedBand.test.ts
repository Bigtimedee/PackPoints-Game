/**
 * 1990 Hoops trusted profile band (`trustProfileBand`).
 *
 * - The fallback replaces mask_band_oversized, name_plate_unresolved, and a
 *   name_text_visible plate-row trip, only on a flagged profile.
 * - The post-mask OCR check refuses 3+ surname letters outside the band, and
 *   refuses on an OCR timeout.
 * - Every other registered profile, and the unmatched default used by
 *   2024 Basketball and 2022 Chronicles, bakes exactly as before.
 * - The 29 Hoops cards on BLOCKED_CARD_ID_RULES stay blocked (12 from #168, 4 from Design clearance, 4 from the All-Star subset ruling, 1 Design P0 #210 Walker, 8 from Design's zoom re-review).
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
    // All-Star subset: Design blocked #17 and #24, kept #1 and #7 held.
    { id: "941433b8-f6ba-417c-973b-33fc35d6325a", player: "Charles Barkley", number: "1" },
    { id: "0b59775d-9a4c-459c-8152-ff4a794cd2b9", player: "Reggie Miller", number: "7" },
    { id: "3905b67e-e6cf-413d-90c0-05997d4caddc", player: "A.C. Green", number: "17" },
    { id: "c197de24-b783-465a-ae95-06fbd3975975", player: "David Robinson", number: "24" },
    // Design P0 2026-10-02: BOWIE #25 on a defender's jersey back.
    { id: "6154edb7-41d7-4f89-862a-1aa04ef5e8e2", player: "Kenny Walker", number: "210" },
    // Design zoom re-review 2026-10-02: duplicates and close-up leaks.
    { id: "27323dcf-26d9-41bd-899a-e37bd4da9d13", player: "Michael Jordan", number: "385" },
    { id: "478616ae-8851-4f8c-a41f-a5845620008a", player: "Michael Jordan", number: "385" },
    { id: "8a933899-f252-4700-981d-73d5fd8412db", player: "Akeem Olajuwon", number: "127" },
    { id: "ae15a554-385d-43d7-8bde-4ad06e932f31", player: "Akeem Olajuwon", number: "23" },
    { id: "cb9cf3eb-b8c1-4ef8-81cd-6ac2bccb76dd", player: "Robert Parish", number: "8" },
    { id: "683cc4eb-4a39-46af-b7ee-82e552b1538a", player: "Kevin Willis", number: "37" },
    { id: "8e49902d-ed15-4521-bbbf-918a164889d4", player: "Kevin McHale", number: "6" },
    { id: "7cdc6abb-5679-4830-95c9-e3041057f73f", player: "Karl Malone", number: "21" },
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

  it("blocks #210 Kenny Walker on re-import (Design P0) and leaves #8 Parish All-Star playable", () => {
    expect(isBlockedCardIdRow({ id: "00000000-0000-4000-8000-000000000210", gameSetId: HOOPS_SET_ID, player: "Kenny Walker", number: "210", variant: "Base" })).toBe(true);
    expect(isBlockedCard(HOOPS_SET_ID, "Robert Parish", { id: "cec031ac-781d-44a8-8fa0-6547f006e6c6", number: "8", variant: "Base" })).toBe(false);
  });

  it("drops one copy of each duplicate pair by id only and keeps the twin playable (Design re-review)", () => {
    const body = cardBlocklistWhereBody("playable_cards");
    const kept = [
      { id: "8013caa1-b20c-4dba-8f63-3b3d6bb00227", player: "Hakeem Olajuwon", number: "127", variant: "Base" },
      { id: "775e6ba0-abf6-46a6-9d36-a998d16903f3", player: "Hakeem Olajuwon", number: "23", variant: "Base" },
      { id: "cec031ac-781d-44a8-8fa0-6547f006e6c6", player: "Robert Parish", number: "8", variant: "Base" },
    ];
    for (const row of kept) {
      expect(isBlockedCard(HOOPS_SET_ID, row.player, row), row.id).toBe(false);
      expect(isBlockedCardIdRow({ ...row, gameSetId: HOOPS_SET_ID }), row.id).toBe(false);
      expect(body).not.toContain(row.id);
    }
    // The dropped copies match by id only, so the same number + surname + variant is not blocked.
    for (const row of [
      { player: "Akeem Olajuwon", number: "127", variant: "Base" },
      { player: "Akeem Olajuwon", number: "23", variant: "Base" },
      { player: "Robert Parish", number: "8", variant: "Base " },
    ]) {
      expect(isBlockedCardIdRow({ id: "00000000-0000-4000-8000-0000000000aa", gameSetId: HOOPS_SET_ID, ...row })).toBe(false);
    }
    // In SQL a normal rule is followed by its re-import match; an id-only rule is not.
    const afterId = (id: string) => body.slice(body.indexOf(`'${id}'`) + id.length + 2, body.indexOf(`'${id}'`) + id.length + 50);
    expect(afterId("6154edb7-41d7-4f89-862a-1aa04ef5e8e2")).toContain("game_set_id");
    for (const id of ["8a933899-f252-4700-981d-73d5fd8412db", "ae15a554-385d-43d7-8bde-4ad06e932f31", "cb9cf3eb-b8c1-4ef8-81cd-6ac2bccb76dd"]) {
      expect(body).toContain(id);
      expect(afterId(id), id).not.toContain("game_set_id");
    }
    expect(body).not.toContain("'parish'");
    // Both #385 copies are dropped, so its re-import match stays on.
    expect(isBlockedCardIdRow({ id: "00000000-0000-4000-8000-000000000385", gameSetId: HOOPS_SET_ID, player: "Michael Jordan", number: "385", variant: "Base" })).toBe(true);
    // The three close-up leaks also block on re-import.
    expect(isBlockedCardIdRow({ id: "00000000-0000-4000-8000-000000000037", gameSetId: HOOPS_SET_ID, player: "Kevin Willis", number: "37", variant: "Base" })).toBe(true);
    expect(isBlockedCardIdRow({ id: "00000000-0000-4000-8000-000000000006", gameSetId: HOOPS_SET_ID, player: "Kevin McHale", number: "6", variant: "Base" })).toBe(true);
    expect(isBlockedCardIdRow({ id: "00000000-0000-4000-8000-000000000021", gameSetId: HOOPS_SET_ID, player: "Karl Malone", number: "21", variant: "Base" })).toBe(true);
    // Karl Malone base #292 and Jordan #65 (cover picks) stay playable.
    expect(isBlockedCard(HOOPS_SET_ID, "Karl Malone", { id: "00000000-0000-4000-8000-000000000292", number: "292", variant: "Base" })).toBe(false);
  });

  it("blocks the Design clearance cards on re-import and leaves Rodman #10 playable", () => {
    expect(isBlockedCardIdRow({ id: "00000000-0000-4000-8000-000000000109", gameSetId: HOOPS_SET_ID, player: "Dennis Rodman", number: "109", variant: "Base" })).toBe(true);
    expect(isBlockedCardIdRow({ id: "00000000-0000-4000-8000-000000000339", gameSetId: HOOPS_SET_ID, player: "Detroit Pistons", number: "339", variant: "Base" })).toBe(true);
    expect(isBlockedCard(HOOPS_SET_ID, "Dennis Rodman", { id: "9210f721-8387-4fa1-8c80-409c550c3394", number: "10", variant: "Base" })).toBe(false);
  });

  it("leaves the 15 All-Star subset cards still cleared playable (Design later blocked #6, #21 and one copy each of #8 and #23)", () => {
    const cleared = [
      { id: "0958ffad-e8c7-445d-a8ad-14380ec9457c", player: "Isiah Thomas", number: "11" },
      { id: "248dcd40-29ac-483d-897b-71c119a1c3bd", player: "Tom Chambers", number: "15" },
      { id: "593b50f4-44d4-47af-8324-6f9274376813", player: "Clyde Drexler", number: "16" },
      { id: "5648feda-8ff0-4c69-8276-d675a933aa20", player: "Earvin Johnson", number: "18" },
      { id: "7eb0eaa5-5f85-4cd9-ab61-59d7894ed74e", player: "Kevin Johnson", number: "19" },
      { id: "07a77a6d-2948-476f-8f92-4a48218eea9b", player: "Larry Bird", number: "2" },
      { id: "0705b462-06a6-4258-a038-461660da7e04", player: "Lafayette Lever", number: "20" },
      { id: "775e6ba0-abf6-46a6-9d36-a998d16903f3", player: "Hakeem Olajuwon", number: "23" },
      { id: "a8ccae95-5f14-49b5-b98c-d43f8dd379b0", player: "John Stockton", number: "25" },
      { id: "a0f0f135-eb0f-4436-b022-ab3d73699be0", player: "James Worthy", number: "26" },
      { id: "7c628f44-b527-47e4-a7c6-b121fb2274ce", player: "Joe Dumars", number: "3" },
      { id: "95eaec4e-5570-444d-8267-9389510f3d57", player: "Patrick Ewing", number: "4" },
      { id: "3ad93f9b-a88c-4ea7-a871-631f4d7a48cd", player: "Michael Jordan", number: "5" },
      { id: "cec031ac-781d-44a8-8fa0-6547f006e6c6", player: "Robert Parish", number: "8" },
      { id: "ccb8adde-c761-43b4-a41e-aa60686a2299", player: "Scottie Pippen", number: "9" },
    ];
    expect(cleared).toHaveLength(15);
    for (const row of cleared) {
      expect(isBlockedCard(HOOPS_SET_ID, row.player, { id: row.id, number: row.number, variant: "Base" }), row.player).toBe(false);
      expect(isBlockedCardIdRow({ id: row.id, gameSetId: HOOPS_SET_ID, player: row.player, number: row.number, variant: "Base" }), row.player).toBe(false);
    }
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
