/**
 * Partner kit: captions, UTM, QR, allowlist, and no card spoilers.
 */
import { createServer } from "http";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { createRequire } from "module";
import { build } from "esbuild";
import { tmpdir } from "os";
import path from "path";
import type { AddressInfo } from "net";
import express from "express";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addPackptsDays } from "@shared/packptsDay";
import {
  FEED_CAPTIONS,
  KIT_FEED,
  KIT_FORBIDDEN_PHRASES,
  KIT_PAGE_DESCRIPTION,
  KIT_QRSHEET,
  KIT_RESULTS,
  KIT_STORY,
  RESULTS_CAPTION,
  STORY_BAKED_LINE,
  STORY_CAPTION,
  eligibleKitCardIds,
  feedCaptionForDay,
  kitAssetGateFromEnv,
  kitCopyProblem,
  kitPlayUrl,
  kitPublicCopy,
  parseKitSlug,
  pickKitCardId,
  resolveKitShopName,
  sanitizeShopName,
  shopLine,
  shopLockup,
} from "@shared/partnerKit";
import { kitSpaMeta } from "../lib/routeOg";
import { readShareAllowlistFile, setShareAllowlistForTests } from "../services/partnerKitAllowlist";
import { bakePartnerKit } from "../services/partnerKitBake";
import { qrModuleCount, renderPartnerKitAsset, renderQrPng, sha256Hex } from "../services/partnerKitRender";
import { KIT_ASSET_PENDING as PENDING, decideKitAsset, registerPartnerKitRoutes, setKitCardSourceForTests } from "../routes/partnerKit";

const SECRET_ID = "secret-card-id";
const SECRET_NAME = "Ken Griffey";
const SLUG = "bobs-cards";

function stripeCard(): Promise<Buffer> {
  const w = 1000;
  const h = 100;
  const raw = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const green = x >= 450 && x < 550;
      const i = (y * w + x) * 3;
      raw[i] = green ? 0 : 220;
      raw[i + 1] = green ? 180 : 20;
      raw[i + 2] = 20;
    }
  }
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}

describe("partner kit copy and links", () => {
  it("keeps the captions exact and off the tagged link", () => {
    expect([...FEED_CAPTIONS]).toEqual([
      "Who is it? Drop your guess below. Thousands more masked cards to play free at PackPTS.",
      "Masked card, one name. Think you know your vintage? Tell us who it is.",
      "Pulled this one from the archives. Name the player, then play thousands more free.",
    ]);
    expect(STORY_CAPTION).toBe("Who is it? Tap to play free.");
    expect(RESULTS_CAPTION).toBe("Today's Daily 5 is in. How many did you get?");
    expect(STORY_BAKED_LINE).toBe("Play free at packpts.com");
    expect(STORY_BAKED_LINE).not.toContain("/kit/");
    expect(shopLine("Bob's Cards")).toBe("Bob's Cards x PackPTS. Stop by and tell us your guess.");
    const seen = new Set<string>();
    for (let i = 0; i < 12; i += 1) seen.add(feedCaptionForDay(addPackptsDays("2026-11-01", i)));
    expect([...seen].sort()).toEqual([...FEED_CAPTIONS].sort());
    expect(feedCaptionForDay("2026-11-03")).toBe(feedCaptionForDay("2026-11-03"));
    const blob = kitPublicCopy("2026-11-03", "Bob's Cards");
    expect(kitCopyProblem(blob)).toBeNull();
    expect(blob).not.toMatch(/utm_|https?:/i);
    for (const phrase of KIT_FORBIDDEN_PHRASES) expect(blob.toLowerCase()).not.toContain(phrase);
  });

  it("builds kit qr and copy links and caps the shop name", () => {
    expect(kitPlayUrl(SLUG, "qr")).toBe("https://packpts.com/?utm_source=kit&utm_medium=qr&utm_campaign=shop_bobs-cards");
    expect(kitPlayUrl(SLUG, "link")).toBe("https://packpts.com/?utm_source=kit&utm_medium=link&utm_campaign=shop_bobs-cards");
    expect(kitPlayUrl("kit", "qr")).not.toContain("utm_source=email");
    expect(kitPlayUrl("kit", "qr")).not.toContain("/kit/");
    expect(parseKitSlug("Bobs-Cards")).toBe(SLUG);
    expect(parseKitSlug("a".repeat(40))).toHaveLength(40);
    expect(parseKitSlug("a".repeat(41))).toBeNull();
    expect(parseKitSlug("bad_slug")).toBeNull();
    expect(parseKitSlug("-bob")).toBeNull();
    expect(parseKitSlug("bob-")).toBeNull();
    expect(sanitizeShopName("Lone Star Sportscards TX")).toBe("Lone Star Sportscards TX");
    expect([..."Lone Star Sportscards TXXXX"].length).toBeGreaterThan(24);
    expect(sanitizeShopName("Lone Star Sportscards TXXXX")).toBe("Lone Star Sportscards TX");
    expect(sanitizeShopName("10% off $5")).toBe("10 off 5");
    expect(resolveKitShopName(SLUG, "Query Shop", { [SLUG]: "Mapped Shop" })).toBe("Query Shop");
    expect(resolveKitShopName(SLUG, null, { [SLUG]: "Mapped Shop" })).toBe("Mapped Shop");
    const wrapped = shopLockup("Lone Star Sportscards TX", (text, size) => text.length * size, {
      startSize: 170,
      wrap: true,
      wrapSize: 200,
      limit: 2550 - 160,
    });
    expect(wrapped.wrapped).toBe(true);
    expect(wrapped.parts.map((part) => part.fill)).toEqual(["ink", "gold"]);
    expect(wrapped.parts[1].text).toBe("x PackPTS");
    expect(kitAssetGateFromEnv(undefined)).toBe("strict");
    expect(kitAssetGateFromEnv("frame")).toBe("frame");
    expect(kitAssetGateFromEnv("nope")).toBe("strict");
  });

  it("picks a cleared masked card that is not in Daily 5 or the cover slots", () => {
    const cards = [
      { id: "daily", setId: "Set-A" },
      { id: "cover", setId: "set-a" },
      { id: "held", setId: "set-held" },
      { id: "raw", setId: "set-a" },
      { id: "uncleared", setId: "set-new" },
      { id: "kit-card", setId: "set-a" },
    ];
    const eligible = eligibleKitCardIds({
      cards,
      clearedSetIds: new Set(["set-a", "set-held"]),
      heldSetIds: new Set(["set-held"]),
      daily5CardIds: new Set(["daily"]),
      coverCardIds: new Set(["cover"]),
      maskedCardIds: new Set(["daily", "cover", "held", "kit-card", "uncleared"]),
    });
    expect(eligible).toEqual(["kit-card"]);
    expect(pickKitCardId("2026-11-03", eligible)).toBe("kit-card");
    expect(pickKitCardId("2026-11-03", ["b", "a", "b"])).toBe(pickKitCardId("2026-11-03", ["a", "b"]));
    expect(pickKitCardId("not-a-day", ["a"])).toBeNull();
    expect(pickKitCardId("2026-11-03", [])).toBeNull();
  });
});

describe("partner kit images", () => {
  const previousGate = process.env.KIT_ASSET_GATE;
  let card: Buffer;
  let baseHash = "";

  beforeAll(async () => {
    card = await stripeCard();
    const rendered = await renderPartnerKitAsset({
      kind: "feed",
      slug: SLUG,
      shopName: null,
      card,
      qrUrl: kitPlayUrl(SLUG, "qr"),
    });
    baseHash = sha256Hex(rendered.base);
    const meta = await sharp(rendered.base).metadata();
    expect(meta.width).toBe(1080);
    expect(meta.height).toBe(1350);
    expect(meta.height).not.toBe(meta.width);
  });

  afterAll(() => {
    if (previousGate === undefined) delete process.env.KIT_ASSET_GATE;
    else process.env.KIT_ASSET_GATE = previousGate;
    setShareAllowlistForTests(null);
    setKitCardSourceForTests(null);
  });

  it("covers the slot from the center and does not paint the shop name over the card", async () => {
    const plain = await renderPartnerKitAsset({
      kind: "feed",
      slug: SLUG,
      shopName: null,
      card,
      qrUrl: kitPlayUrl(SLUG, "qr"),
    });
    const named = await renderPartnerKitAsset({
      kind: "feed",
      slug: SLUG,
      shopName: "Bob's Cards",
      card,
      qrUrl: kitPlayUrl(SLUG, "qr"),
    });
    expect(sha256Hex(plain.base)).toBe(baseHash);
    expect(sha256Hex(named.base)).toBe(baseHash);
    expect(sha256Hex(named.bytes)).not.toBe(baseHash);
    const sample = async (bytes: Buffer, x: number, y: number) => {
      const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const i = (y * info.width + x) * 4;
      return [data[i], data[i + 1], data[i + 2], data[i + 3]];
    };
    const slotX = KIT_FEED.slot.x + 8;
    const slotY = KIT_FEED.slot.y + Math.floor(KIT_FEED.slot.h / 2);
    const plainSlot = await sample(plain.bytes, slotX, slotY);
    const namedSlot = await sample(named.bytes, slotX, slotY);
    expect(plainSlot[1]).toBeGreaterThan(140);
    expect(plainSlot[0]).toBeLessThan(80);
    expect(namedSlot).toEqual(plainSlot);
    const edge = await sample(plain.bytes, KIT_FEED.slot.x - 4, KIT_FEED.slot.y - 4);
    expect(edge[0]).toBeGreaterThan(220);
    expect(edge[1]).toBeGreaterThan(160);
    expect(edge[2]).toBeLessThan(60);
    const outside = await sample(plain.bytes, 12, 12);
    expect(outside[1]).toBeLessThan(40);
    expect(Buffer.from(plain.bytes).includes(Buffer.from(SECRET_ID))).toBe(false);
    expect(Buffer.from(plain.bytes).includes(Buffer.from(SECRET_NAME))).toBe(false);
  });

  it("places a quiet-zone QR on the letter sheet", async () => {
    const url = kitPlayUrl(SLUG, "qr");
    const counts = qrModuleCount(url);
    expect(counts.withQuiet - counts.modules).toBe(8);
    const native = await renderQrPng(url, counts.withQuiet);
    const { data, info } = await sharp(native).raw().toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number) => {
      const i = (y * info.width + x) * info.channels;
      return data[i];
    };
    expect(pixel(0, 0)).toBe(255);
    expect(pixel(3, 3)).toBe(255);
    expect(pixel(4, 4)).toBe(0);
    const sheet = await renderPartnerKitAsset({
      kind: "qrsheet",
      slug: SLUG,
      shopName: "Lone Star Sportscards TX",
      card: null,
      qrUrl: url,
    });
    const meta = await sharp(sheet.bytes).metadata();
    expect(meta.width).toBe(KIT_QRSHEET.width);
    expect(meta.height).toBe(KIT_QRSHEET.height);
    expect(meta.density).toBe(300);
    const qr = await renderQrPng(url, KIT_QRSHEET.qr.size);
    const crop = await sharp(sheet.base)
      .extract({ left: KIT_QRSHEET.qr.x, top: KIT_QRSHEET.qr.y, width: KIT_QRSHEET.qr.size, height: KIT_QRSHEET.qr.size })
      .removeAlpha()
      .raw()
      .toBuffer();
    const qrRaw = await sharp(qr).removeAlpha().raw().toBuffer();
    expect(crop.equals(qrRaw)).toBe(true);
    expect(KIT_STORY.lockup.y).toBe(1560);
    expect(KIT_STORY.lockup.h).toBe(120);
    expect(KIT_RESULTS.lockup).toEqual({ y: 40, h: 100 });
  });

  it("writes a no-shop manifest whose hash is the served base", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "kit-bake-"));
    const manifest = await bakePartnerKit({
      startDay: "2026-11-03",
      days: 2,
      slug: SLUG,
      outDir: dir,
      cardForDay: async () => ({ cardId: SECRET_ID, bytes: card }),
    });
    const feed = manifest.days[0].assets.find((asset) => asset.template === "feed");
    expect(feed?.sha256).toBe(baseHash);
    expect(feed?.width).toBe(1080);
    expect(feed?.height).toBe(1350);
    const again = pickKitCardId("2026-11-03", [SECRET_ID]);
    expect(manifest.days[0].cardId).toBe(again);
    const text = readFileSync(path.join(dir, "manifest.json"), "utf8");
    expect(text).not.toContain(SECRET_NAME);
    expect(text).not.toContain("utm_source=email");
    expect(JSON.parse(text).status).toMatch(/APPROVED\.json/);
  });
});

describe("partner kit http gate", () => {
  const previousGate = process.env.KIT_ASSET_GATE;
  const app = express();
  registerPartnerKitRoutes(app);
  const server = createServer(app);
  let base = "";
  let card: Buffer;

  beforeAll(async () => {
    card = await stripeCard();
    setKitCardSourceForTests(async () => ({ cardId: SECRET_ID, bytes: card }));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const addr = server.address() as AddressInfo;
    base = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    if (previousGate === undefined) delete process.env.KIT_ASSET_GATE;
    else process.env.KIT_ASSET_GATE = previousGate;
    setShareAllowlistForTests(null);
    setKitCardSourceForTests(null);
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  });

  async function get(pathname: string) {
    const res = await fetch(`${base}${pathname}`);
    const buf = Buffer.from(await res.arrayBuffer());
    return { res, buf, text: buf.toString("utf8") };
  }

  it("serves captions and the play link with no card fields", async () => {
    delete process.env.KIT_ASSET_GATE;
    setShareAllowlistForTests(new Set());
    const meta = await get(`/api/kit/meta/${SLUG}?shop=Bob%27s%20Cards`);
    expect(meta.res.status).toBe(200);
    const body = JSON.parse(meta.text);
    expect(body.links.qr).toBe(kitPlayUrl(SLUG, "qr"));
    expect(body.links.copy).toBe(kitPlayUrl(SLUG, "link"));
    expect(body.shopName).toBe("Bob's Cards");
    expect(body.captions.feed).toBe(feedCaptionForDay(body.day));
    expect(kitCopyProblem(JSON.stringify(body.captions) + body.lead + body.description)).toBeNull();
    expect(meta.text).not.toContain(SECRET_ID);
    expect(meta.text).not.toContain(SECRET_NAME);
    expect(meta.text.toLowerCase()).not.toContain("coming soon");
    expect(meta.text).not.toContain(PENDING);
    expect(meta.text).not.toContain("correctAnswer");
    expect(meta.text).not.toContain("cardId");
    expect(body.description).toBe(KIT_PAGE_DESCRIPTION);
    const bad = await get("/api/kit/meta/Bad_Slug");
    expect(bad.res.status).toBe(404);
    expect(bad.text).not.toContain(PENDING);
  });

  it("404s a composite until its exact sha256 is approved, then serves the shop variant from that base", async () => {
    delete process.env.KIT_ASSET_GATE;
    setShareAllowlistForTests(new Set());
    const blocked = await get(`/api/kit/asset/feed?slug=${SLUG}`);
    expect(blocked.res.status).toBe(404);
    expect(blocked.text).not.toContain(SECRET_NAME);
    expect(blocked.text).not.toContain(PENDING);
    expect(blocked.text.toLowerCase()).not.toContain("coming soon");
    const pending = await decideKitAsset({ kind: "feed", slug: SLUG, shopName: null, dayKey: "2026-11-03" });
    expect(pending.serve).toBe(false);
    if (!pending.serve) expect(pending.reason).toBe(PENDING);

    const rendered = await renderPartnerKitAsset({
      kind: "feed",
      slug: SLUG,
      shopName: null,
      card,
      qrUrl: kitPlayUrl(SLUG, "qr"),
    });
    setShareAllowlistForTests(new Set([sha256Hex(rendered.base)]));
    const open = await get(`/api/kit/asset/feed?slug=${SLUG}`);
    expect(open.res.status).toBe(200);
    expect(open.res.headers.get("content-type")).toContain("image/png");
    expect(open.res.headers.get("x-card-id")).toBeNull();
    expect(sha256Hex(open.buf)).toBe(sha256Hex(rendered.base));
    const shop = await get(`/api/kit/asset/feed?slug=${SLUG}&shop=Bob%27s%20Cards`);
    expect(shop.res.status).toBe(200);
    expect(sha256Hex(shop.buf)).not.toBe(sha256Hex(rendered.base));
    expect(shop.buf.includes(Buffer.from(SECRET_ID))).toBe(false);

    const qr = await get(`/api/kit/qr.png?slug=${SLUG}`);
    expect(qr.res.status).toBe(200);
    const expected = await renderQrPng(kitPlayUrl(SLUG, "qr"), 512);
    expect(sha256Hex(qr.buf)).toBe(sha256Hex(expected));
    const svg = await get(`/api/kit/qr.svg?slug=${SLUG}`);
    expect(svg.res.headers.get("content-type")).toContain("image/svg+xml");
    expect(svg.text).toContain("<svg");
    expect(svg.text).not.toContain("utm_source=email");
    expect(svg.text).not.toContain(SECRET_NAME);
  });

  it("keeps frame mode off unless the env is set, and still hash-gates the results card", async () => {
    setShareAllowlistForTests(new Set());
    process.env.KIT_ASSET_GATE = "frame";
    const feed = await get(`/api/kit/asset/feed?slug=${SLUG}`);
    expect(feed.res.status).toBe(200);
    const results = await get(`/api/kit/asset/results?slug=${SLUG}`);
    expect(results.res.status).toBe(404);
    delete process.env.KIT_ASSET_GATE;
    const closed = await get(`/api/kit/asset/feed?slug=${SLUG}`);
    expect(closed.res.status).toBe(404);
    expect(readShareAllowlistFile(path.join(process.cwd(), "server", "assets", "share", "APPROVED.json")).size).toBe(0);
  });

  it("gives /kit its own preview copy", () => {
    const page = readFileSync(path.join(process.cwd(), "client/src/pages/partner-kit.tsx"), "utf8");
    expect(page).not.toMatch(/utm_source=email|today's card|a new card every day|Coming soon/i);
    expect(page).not.toMatch(/[\u2013\u2014]/);
    const meta = kitSpaMeta("/kit/bobs-cards?shop=Bob");
    expect(meta?.description).toBe(KIT_PAGE_DESCRIPTION);
    expect(meta?.description.toLowerCase()).not.toContain("a new card every day");
    expect(meta?.description.toLowerCase()).not.toContain("today's card");
    expect(meta?.imageAlt).not.toContain(SECRET_NAME);
  });

  it("loads the kit renderer from an esbuild CJS bundle and draws a QR", async () => {
    const outfile = path.join(process.cwd(), `.kit-render-cjs-${process.pid}.cjs`);
    await build({
      entryPoints: [path.resolve(__dirname, "../services/partnerKitRender.ts")],
      bundle: true,
      platform: "node",
      format: "cjs",
      outfile,
      external: ["sharp", "qrcode", "opentype.js"],
      logLevel: "silent",
    });
    try {
      const loaded = createRequire(import.meta.url)(outfile) as { renderQrSvg: (url: string) => string };
      const svg = loaded.renderQrSvg(kitPlayUrl("kit", "qr"));
      expect(svg).toContain("<svg");
      expect(svg).not.toContain("utm_source=email");
    } finally {
      rmSync(outfile, { force: true });
    }
  });
});
