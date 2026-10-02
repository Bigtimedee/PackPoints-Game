/**
 * Homepage link preview v2. client/index.html carries the home tags, so every
 * route without its own preview serves them. /daily keeps its Daily 5 preview,
 * and play-sets pages do not inherit the homepage image alt text.
 */
import { createHash } from "node:crypto";
import express from "express";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HOME_ROUTE_META, SPA_ROUTE_META, injectSpaRouteMeta } from "../lib/routeOg";
import { injectPlaySetsOgTags } from "../lib/playSetsHtml";
import { mountSpaStatic } from "../static";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const INDEX_PATH = path.join(ROOT, "client/index.html");
const HOME_PNG_PATH = path.join(ROOT, "client/public/og-image.png");
const DAILY_PNG_PATH = path.join(ROOT, "client/public/og/daily-1200x630.png");
// Design's og-home-A2.png (real masked 1987 Topps cards), added byte-identical.
const HOME_PNG_SHA256 = "f934c084b388dc5de096666e905a9e869f8812a5a488f3512f2ce15852bab3a7";
// Design's og-daily-v2.png, added byte-identical.
const DAILY_PNG_SHA256 = "b01aa469bfc80f508986e954f787db4203b78adf1b83781b8ae2c96b08bdd4a9";

// Approved copy from Design's SPEC.md / COPY.md. Do not edit.
const TITLE = "Can you name all 5? \u00b7 PackPTS";
const OG_DESCRIPTION =
  "A real trading card with the name masked. Pick the player from four choices. Daily 5 is the same five for everyone, new every day. Play free.";
const TW_DESCRIPTION =
  "Real cards, names masked. Pick the player from four. Same Daily 5 for everyone. Play free.";
const IMAGE = "https://packpts.com/og-image.png?v=2";
const ALT = "A masked trading card with a gold bar over the name, next to the question: Who's on the card?";
const HOME_URL = "https://packpts.com/";

const HOME_TAGS = [
  `<meta property="og:url" content="${HOME_URL}" />`,
  `<meta property="og:title" content="${TITLE}" />`,
  `<meta property="og:description" content="${OG_DESCRIPTION}" />`,
  `<meta property="og:image" content="${IMAGE}" />`,
  `<meta property="og:image:width" content="1200" />`,
  `<meta property="og:image:height" content="630" />`,
  `<meta property="og:image:alt" content="${ALT}" />`,
  `<meta name="twitter:card" content="summary_large_image" />`,
  `<meta name="twitter:title" content="${TITLE}" />`,
  `<meta name="twitter:description" content="${TW_DESCRIPTION}" />`,
  `<meta name="twitter:image" content="${IMAGE}" />`,
];

const DAILY_TAGS = [
  `<title>Daily 5. Five cards. Name them.</title>`,
  `<meta property="og:url" content="https://packpts.com/daily" />`,
  `<meta property="og:title" content="Daily 5. Five cards. Name them." />`,
  `<meta property="og:description" content="A new hand every day. Same five for everyone. Play free at PackPTS." />`,
  `<meta property="og:image" content="https://packpts.com/og/daily-1200x630.png?v=2" />`,
  `<meta property="og:image:width" content="1200" />`,
  `<meta property="og:image:height" content="630" />`,
  `<meta property="og:image:alt" content="Five masked sports cards. Daily 5 on PackPTS." />`,
  `<meta name="twitter:card" content="summary_large_image" />`,
  `<meta name="twitter:title" content="Daily 5. Five cards. Name them." />`,
  `<meta name="twitter:description" content="A new hand every day. Same five for everyone. Play free at PackPTS." />`,
  `<meta name="twitter:image" content="https://packpts.com/og/daily-1200x630.png?v=2" />`,
];

const ONCE_KEYS: Array<["property" | "name", string]> = [
  ["property", "og:type"],
  ["property", "og:url"],
  ["property", "og:title"],
  ["property", "og:description"],
  ["property", "og:site_name"],
  ["property", "og:image"],
  ["property", "og:image:width"],
  ["property", "og:image:height"],
  ["property", "og:image:alt"],
  ["name", "description"],
  ["name", "twitter:card"],
  ["name", "twitter:title"],
  ["name", "twitter:description"],
  ["name", "twitter:image"],
];

function countExact(html: string, needle: string): number {
  let count = 0;
  let from = 0;
  for (;;) {
    const at = html.indexOf(needle, from);
    if (at < 0) return count;
    count += 1;
    from = at + needle.length;
  }
}

function readAttr(tag: string, name: string): string | null {
  const re = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(tag))) {
    if (match[1].toLowerCase() === name.toLowerCase()) return match[2] ?? match[3] ?? "";
  }
  return null;
}

function countMeta(html: string, attr: "property" | "name", key: string): number {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  return tags.filter((tag) => readAttr(tag, attr) === key).length;
}

function expectEachKeyOnce(html: string): void {
  expect(countExact(html, "<title>")).toBe(1);
  for (const [attr, key] of ONCE_KEYS) {
    expect(countMeta(html, attr, key), `${attr}=${key}`).toBe(1);
  }
}

function expectHomeTagsOnce(html: string): void {
  for (const tag of HOME_TAGS) {
    expect(countExact(html, tag), tag).toBe(1);
  }
  expect(countExact(html, "<title>PackPTS</title>")).toBe(1);
  expectEachKeyOnce(html);
  expect(html).not.toContain('content="https://packpts.com/og-image.png"');
  expect(html).not.toContain("daily-1200x630.png");
}

function expectDailyTagsOnce(html: string): void {
  for (const tag of DAILY_TAGS) {
    expect(countExact(html, tag), tag).toBe(1);
  }
  expectEachKeyOnce(html);
  expect(html).not.toContain("https://packpts.com/og-image.png");
  expect(html).not.toContain(TITLE);
  expect(html).not.toContain(ALT);
  expect(html).not.toContain(TW_DESCRIPTION);
}

const sha256 = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");

describe("homepage link preview tags in index.html", () => {
  const home = fs.readFileSync(INDEX_PATH, "utf8");

  it("carries Design's v2 copy, image, and alt once each", () => {
    expectHomeTagsOnce(home);
  });

  it("matches HOME_ROUTE_META and keeps the approved copy verbatim", () => {
    expect(HOME_ROUTE_META).toMatchObject({
      title: TITLE,
      description: OG_DESCRIPTION,
      twitterDescription: TW_DESCRIPTION,
      url: HOME_URL,
      image: IMAGE,
      imageWidth: "1200",
      imageHeight: "630",
      imageAlt: ALT,
      twitterCard: "summary_large_image",
    });
    // The middle dot is intended, and the copy has no en or em dashes.
    expect(TITLE).toContain(" \u00b7 ");
    expect([TITLE, OG_DESCRIPTION, TW_DESCRIPTION, ALT].join("\n")).not.toMatch(/[\u2013\u2014]/);
    expect(IMAGE.startsWith("https://packpts.com/")).toBe(true);
    expect(IMAGE.endsWith("?v=2")).toBe(true);
  });

  it("ships Design's PNG byte-identical at 1200x630", () => {
    const file = fs.readFileSync(HOME_PNG_PATH);
    expect(sha256(file)).toBe(HOME_PNG_SHA256);
    expect(file.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(file.readUInt32BE(16)).toBe(1200);
    expect(file.readUInt32BE(20)).toBe(630);
  });

  it("leaves generic routes on the home tags and rewrites only /daily", () => {
    expect(Object.keys(SPA_ROUTE_META)).toEqual(["/daily"]);
    for (const route of ["/", "/?s=2", "/leaderboard", "/game/solo", "/daily5", "/invite"]) {
      expect(injectSpaRouteMeta(home, route)).toBe(home);
    }
    expectDailyTagsOnce(injectSpaRouteMeta(home, "/daily"));
    expectDailyTagsOnce(injectSpaRouteMeta(home, "/daily/?utm_source=share"));
  });

  it("does not carry the homepage image alt onto a play-sets page", () => {
    const html = injectPlaySetsOgTags(home, {
      title: "Porch 87s \u00b7 PackPTS",
      description: "Play Porch 87s on PackPTS.",
      image: "/generated/share/2026-09-08/qa.png",
      url: "https://packpts.com/sets/porch-87s-a1b2c3d4",
      canonical: "https://packpts.com/sets/porch-87s-a1b2c3d4",
    });
    expect(countMeta(html, "property", "og:image:alt")).toBe(0);
    expect(html).not.toContain(ALT);
    expect(html).not.toContain("https://packpts.com/og-image.png");
    expect(countMeta(html, "property", "og:image")).toBe(1);
    expect(countMeta(html, "property", "og:title")).toBe(1);
  });
});

describe("served HTML and homepage preview image", () => {
  const home = fs.readFileSync(INDEX_PATH, "utf8");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "packpts-home-og-"));
  fs.mkdirSync(path.join(dir, "og"));
  fs.copyFileSync(INDEX_PATH, path.join(dir, "index.html"));
  fs.copyFileSync(HOME_PNG_PATH, path.join(dir, "og-image.png"));
  fs.copyFileSync(DAILY_PNG_PATH, path.join(dir, "og/daily-1200x630.png"));

  const app = express();
  mountSpaStatic(app, dir);
  const server = http.createServer(app);
  let base = "";

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no port");
    base = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  async function read(pathname: string, userAgent?: string) {
    const res = await fetch(`${base}${pathname}`, {
      headers: userAgent ? { "User-Agent": userAgent } : {},
    });
    const buf = Buffer.from(await res.arrayBuffer());
    return { res, buf, text: buf.toString("utf8") };
  }

  const UAS = [
    undefined,
    "facebookexternalhit/1.1",
    "Twitterbot/1.0",
    "Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 (KHTML, like Gecko) facebookexternalhit/1.1 Facebot Twitterbot/1.0",
  ];

  it("serves / with the home tags once for browsers and crawlers", async () => {
    for (const ua of UAS) {
      const root = await read("/", ua);
      expect(root.res.status).toBe(200);
      expect(root.res.headers.get("content-type")).toContain("text/html");
      expect(root.text).toBe(home);
      expectHomeTagsOnce(root.text);
    }
  });

  it("serves a generic route with the home tags", async () => {
    for (const route of ["/leaderboard", "/game/solo", "/?s=2"]) {
      const page = await read(route, "facebookexternalhit/1.1");
      expect(page.res.status).toBe(200);
      expectHomeTagsOnce(page.text);
    }
  });

  it("keeps /daily on the Daily 5 tags and image", async () => {
    for (const ua of UAS) {
      const daily = await read("/daily", ua);
      expect(daily.res.status).toBe(200);
      expectDailyTagsOnce(daily.text);
    }
    const slash = await read("/daily/?utm_source=share");
    expectDailyTagsOnce(slash.text);
  });

  it("serves og-image.png?v=2 as image/png with Design's bytes", async () => {
    const png = await read("/og-image.png?v=2");
    expect(png.res.status).toBe(200);
    expect(png.res.headers.get("content-type")).toMatch(/^image\/png\b/);
    expect(sha256(png.buf)).toBe(HOME_PNG_SHA256);
  });

  it("serves the /daily preview at ?v=2 with Design's og-daily-v2 bytes", async () => {
    const file = fs.readFileSync(DAILY_PNG_PATH);
    expect(sha256(file)).toBe(DAILY_PNG_SHA256);
    expect(file.readUInt32BE(16)).toBe(1200);
    expect(file.readUInt32BE(20)).toBe(630);
    const png = await read("/og/daily-1200x630.png?v=2");
    expect(png.res.status).toBe(200);
    expect(png.res.headers.get("content-type")).toMatch(/^image\/png\b/);
    expect(sha256(png.buf)).toBe(DAILY_PNG_SHA256);
  });
});
