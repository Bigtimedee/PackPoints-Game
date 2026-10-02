/**
 * /daily link preview is rewritten in the HTML Express sends.
 * Crawlers do not run the client bundle.
 */
import { createHash } from "node:crypto";
import express from "express";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decorateSpaIndexHtml } from "../lib/spaIndexHtml";
import { SPA_ROUTE_META, injectSpaRouteMeta, spaRouteMetaForUrl } from "../lib/routeOg";
import { mountSpaStatic } from "../static";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const INDEX_PATH = path.join(ROOT, "client/index.html");
const PNG_PATH = path.join(ROOT, "client/public/og/daily-1200x630.png");
// Design og-daily-v2.png (real masked 1987 Topps cards), added byte-identical.
const PNG_SHA256 = "b01aa469bfc80f508986e954f787db4203b78adf1b83781b8ae2c96b08bdd4a9";

const TITLE = "Daily 5. Five cards. Name them.";
const DESCRIPTION = "A new hand every day. Same five for everyone. Play free at PackPTS.";
const PAGE_URL = "https://packpts.com/daily";
const IMAGE = "https://packpts.com/og/daily-1200x630.png?v=2";
const ALT = "Five masked sports cards. Daily 5 on PackPTS.";

const DAILY_TAGS = [
  `<title>${TITLE}</title>`,
  `<meta name="description" content="${DESCRIPTION}" />`,
  `<meta property="og:title" content="${TITLE}" />`,
  `<meta property="og:description" content="${DESCRIPTION}" />`,
  `<meta property="og:url" content="${PAGE_URL}" />`,
  `<meta property="og:type" content="website" />`,
  `<meta property="og:site_name" content="PackPTS" />`,
  `<meta property="og:image" content="${IMAGE}" />`,
  `<meta property="og:image:width" content="1200" />`,
  `<meta property="og:image:height" content="630" />`,
  `<meta property="og:image:alt" content="${ALT}" />`,
  `<meta name="twitter:card" content="summary_large_image" />`,
  `<meta name="twitter:title" content="${TITLE}" />`,
  `<meta name="twitter:description" content="${DESCRIPTION}" />`,
  `<meta name="twitter:image" content="${IMAGE}" />`,
];

function countExact(html: string, needle: string): number {
  let count = 0;
  let from = 0;
  while (from <= html.length) {
    const at = html.indexOf(needle, from);
    if (at < 0) return count;
    count += 1;
    from = at + needle.length;
  }
  return count;
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

function expectDailyTagsOnce(html: string): void {
  for (const tag of DAILY_TAGS) {
    expect(countExact(html, tag)).toBe(1);
  }
  expect(countExact(html, "<title>")).toBe(1);
  expect(countMeta(html, "name", "description")).toBe(1);
  expect(countMeta(html, "property", "og:title")).toBe(1);
  expect(countMeta(html, "property", "og:description")).toBe(1);
  expect(countMeta(html, "property", "og:url")).toBe(1);
  expect(countMeta(html, "property", "og:type")).toBe(1);
  expect(countMeta(html, "property", "og:site_name")).toBe(1);
  expect(countMeta(html, "property", "og:image")).toBe(1);
  expect(countMeta(html, "property", "og:image:width")).toBe(1);
  expect(countMeta(html, "property", "og:image:height")).toBe(1);
  expect(countMeta(html, "property", "og:image:alt")).toBe(1);
  expect(countMeta(html, "name", "twitter:card")).toBe(1);
  expect(countMeta(html, "name", "twitter:title")).toBe(1);
  expect(countMeta(html, "name", "twitter:description")).toBe(1);
  expect(countMeta(html, "name", "twitter:image")).toBe(1);
  expect(html).not.toContain("https://packpts.com/og-image.png");
  expect(html).not.toContain('og:url" content="https://packpts.com/"');
  const copy = [TITLE, DESCRIPTION, ALT, PAGE_URL, IMAGE].join("\n");
  expect(copy).not.toMatch(/[\u2013\u2014]/);
}

describe("daily route meta map", () => {
  const home = fs.readFileSync(INDEX_PATH, "utf8");

  it("maps only /daily, including a trailing slash and a query string", () => {
    expect(spaRouteMetaForUrl("/daily")).toMatchObject({ title: TITLE, url: PAGE_URL });
    expect(spaRouteMetaForUrl("/daily/")).toMatchObject({ title: TITLE });
    expect(spaRouteMetaForUrl("/daily?utm_source=share&utm_medium=beatme&challenge=abc")).toMatchObject({
      url: PAGE_URL,
      image: IMAGE,
    });
    expect(spaRouteMetaForUrl("/")).toBeNull();
    expect(spaRouteMetaForUrl("/daily5")).toBeNull();
    expect(spaRouteMetaForUrl("/daily/extra")).toBeNull();
    expect(Object.keys(SPA_ROUTE_META)).toEqual(["/daily"]);
    const src = fs.readFileSync(path.join(ROOT, "server/lib/routeOg.ts"), "utf8");
    expect(src).toContain(
      'image: "https://packpts.com/og/daily-1200x630.png?v=2", // v2 = real masked 1987 Topps cards (2026-10-02). Bump ?v= if the file changes again so X and iMessage refetch.',
    );
  });

  it("rewrites index.html in production static serving and after the Vite dev transform", () => {
    const staticSrc = fs.readFileSync(path.join(ROOT, "server/static.ts"), "utf8");
    const viteSrc = fs.readFileSync(path.join(ROOT, "server/vite.ts"), "utf8");
    expect(staticSrc).toContain("decorateSpaIndexHtml(raw, url)");
    const transformAt = viteSrc.indexOf("vite.transformIndexHtml");
    const decorateAt = viteSrc.indexOf("decorateSpaIndexHtml(page, url)");
    expect(transformAt).toBeGreaterThan(-1);
    expect(decorateAt).toBeGreaterThan(transformAt);
  });

  it("rewrites /daily once and leaves every other route byte-identical", () => {
    const daily = injectSpaRouteMeta(home, "/daily");
    expectDailyTagsOnce(daily);
    expect(injectSpaRouteMeta(daily, "/daily?x=1")).toBe(daily);
    expect(injectSpaRouteMeta(home, "/")).toBe(home);
    expect(injectSpaRouteMeta(home, "/daily5")).toBe(home);
    expect(injectSpaRouteMeta(home, "/game/solo")).toBe(home);
  });

  it("replaces a duplicated or reordered tag instead of adding another", () => {
    const shell = `<!DOCTYPE html><html><head>
    <title>PackPTS</title>
    <title>PackPTS</title>
    <meta content="Guess." name="description" />
    <meta property="og:title" content="PackPTS" />
    <meta property="og:title" content="Again" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image" content="https://packpts.com/og-image.png" />
  </head><body></body></html>`;
    const html = injectSpaRouteMeta(shell, "/daily/");
    expectDailyTagsOnce(html);
    expect(html).not.toContain("Again");
    expect(html).not.toContain("Guess.");
  });

  it("keeps a Vite transform's build id when the dev index path decorates /daily", async () => {
    const transformed = home.replace(
      "</head>",
      `    <meta name="packpts-build-id" content="abc123" />\n  </head>`,
    );
    const html = await decorateSpaIndexHtml(
      transformed,
      "/daily?utm_source=share&utm_medium=beatme&utm_campaign=daily5&challenge=zz-beat-token",
    );
    expectDailyTagsOnce(html);
    expect(html).toContain('<meta name="packpts-build-id" content="abc123" />');
    expect(html).not.toContain("zz-beat-token");
    expect(await decorateSpaIndexHtml(home, "/")).toBe(home);
  });
});

describe("served /daily HTML and preview image", () => {
  const home = fs.readFileSync(INDEX_PATH, "utf8");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "packpts-daily-og-"));
  fs.mkdirSync(path.join(dir, "og"));
  fs.copyFileSync(INDEX_PATH, path.join(dir, "index.html"));
  fs.copyFileSync(PNG_PATH, path.join(dir, "og/daily-1200x630.png"));

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

  async function read(pathname: string) {
    const res = await fetch(`${base}${pathname}`);
    const buf = Buffer.from(await res.arrayBuffer());
    return { res, buf, text: buf.toString("utf8") };
  }

  it("serves / unchanged and /daily with each new tag once", async () => {
    const root = await read("/");
    expect(root.res.status).toBe(200);
    expect(root.res.headers.get("content-type")).toContain("text/html");
    expect(root.text).toBe(home);
    expect(root.text).toContain('og:url" content="https://packpts.com/"');
    expect(root.text).toContain("https://packpts.com/og-image.png");
    expect(root.text).not.toContain(IMAGE);

    const daily = await read("/daily");
    expect(daily.res.status).toBe(200);
    expect(daily.res.headers.get("content-type")).toContain("text/html");
    expectDailyTagsOnce(daily.text);

    const solo = await read("/game/solo");
    expect(solo.text).toBe(home);
    const daily5 = await read("/daily5");
    expect(daily5.text).toBe(home);
  });

  it("keeps /daily tags for a trailing slash and for query strings", async () => {
    const plain = await read("/daily");
    const slash = await read("/daily/");
    const beat = await read(
      "/daily?utm_source=share&utm_medium=beatme&utm_campaign=daily5&challenge=zz-beat-token",
    );
    const slashQuery = await read("/daily/?utm_source=share&challenge=zz-beat-token");
    expect(slash.text).toBe(plain.text);
    expect(beat.text).toBe(plain.text);
    expect(slashQuery.text).toBe(plain.text);
    expectDailyTagsOnce(beat.text);
    expect(beat.text).not.toContain("zz-beat-token");
    expect(beat.text).not.toContain("utm_medium");
  });

  it("serves the Daily 5 PNG as image/png", async () => {
    const file = fs.readFileSync(PNG_PATH);
    expect(createHash("sha256").update(file).digest("hex")).toBe(PNG_SHA256);
    expect(file.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(file.readUInt32BE(16)).toBe(1200);
    expect(file.readUInt32BE(20)).toBe(630);

    const png = await read("/og/daily-1200x630.png?v=2");
    expect(png.res.status).toBe(200);
    expect(png.res.headers.get("content-type")).toMatch(/^image\/png\b/);
    expect(createHash("sha256").update(png.buf).digest("hex")).toBe(PNG_SHA256);
  });
});
