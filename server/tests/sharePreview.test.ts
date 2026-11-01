/**
 * Each public set page has its own 1200x630 share image. The file is fetchable
 * now. It is used as og:image / twitter:image only after its sha256 is listed
 * in server/assets/share/APPROVED.json and the set is cleared.
 */
import { createHash } from "crypto";
import express from "express";
import fs from "fs";
import http from "http";
import path from "path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { getMaskProfile, profileIsRegistered } from "../masking/maskProfiles";
import { renderSharePreviewPng } from "../contentFactory/renderSharePreview";
import { readShareApproval, resolveSharePng, setShareApprovalForTests } from "../lib/shareApproval";
import { applySharePreview, approvedShareImageUrl, setSharePageCleared } from "../lib/sharePreviewHtml";
import { getServedBuildId } from "../lib/servedBuildId";
import { resolveSeoPage, type SeoSet } from "../lib/seoPages";
import { setShareSlug } from "../contentFactory/makerShareSlug";
import {
  SET_SHARE_PAGES,
  SHARE_OG_HEIGHT,
  SHARE_OG_WIDTH,
  STATIC_SHARE_PAGES,
  shareImagePublicPath,
  staticShareCopyForbidden,
} from "@shared/sharePreview";

const ROOT = path.resolve(__dirname, "../..");
const INDEX = fs.readFileSync(path.join(ROOT, "client/index.html"), "utf8");
const PUBLIC = path.join(ROOT, "client/public");

function pngSize(buf: Buffer): { w: number; h: number } {
  expect(buf.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

describe("share preview files", () => {
  const app = express();
  app.use(express.static(PUBLIC));
  const server = http.createServer(app);
  let base = "";

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no port");
    base = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  });

  it("serves a unique 1200x630 image for every set page", async () => {
    const hashes = new Set<string>();
    const paths = new Set<string>();
    for (const page of SET_SHARE_PAGES) {
      expect(page.file).toBe(`${page.setId}.png`);
      expect(page.alt).toBe(`Masked ${page.setName} card`);
      expect(page.file).toMatch(/^[0-9a-f-]+\.png$/);
      const url = shareImagePublicPath(page.file);
      expect(paths.has(url)).toBe(false);
      paths.add(url);
      const res = await fetch(`${base}${url}`);
      expect(res.status, url).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/^image\/png\b/);
      const buf = Buffer.from(await res.arrayBuffer());
      expect(pngSize(buf)).toEqual({ w: SHARE_OG_WIDTH, h: SHARE_OG_HEIGHT });
      const sha = createHash("sha256").update(buf).digest("hex");
      expect(hashes.has(sha)).toBe(false);
      hashes.add(sha);
      const profile = getMaskProfile(page.setName, page.setId);
      expect(profileIsRegistered(profile, page.setId)).toBe(true);
    }
    expect(hashes.size).toBe(SET_SHARE_PAGES.length);
  });

  it("serves a 1200x630 image for each static page and keeps share copy free of digits and percentages", async () => {
    const seen = new Set<string>();
    for (const page of STATIC_SHARE_PAGES) {
      expect(staticShareCopyForbidden(page.shareTitle)).toBe(false);
      expect(staticShareCopyForbidden(page.shareDescription)).toBe(false);
      expect(staticShareCopyForbidden(page.alt)).toBe(false);
      const res = await fetch(`${base}${shareImagePublicPath(page.file)}`);
      expect(res.status).toBe(200);
      const buf = Buffer.from(await res.arrayBuffer());
      expect(pngSize(buf)).toEqual({ w: SHARE_OG_WIDTH, h: SHARE_OG_HEIGHT });
      seen.add(createHash("sha256").update(buf).digest("hex"));
    }
    expect(seen.size).toBe(STATIC_SHARE_PAGES.length);
  });
});

describe("share approval gate", () => {
  afterEach(() => setShareApprovalForTests(null));

  it("does not use an image as a share image until its hash is approved", () => {
    const allow = readShareApproval();
    const buildId = getServedBuildId();
    for (const page of SET_SHARE_PAGES) {
      const file = resolveSharePng(page.file);
      expect(file).toBeTruthy();
      expect(allow.has(file!.sha256)).toBe(false);
      expect(approvedShareImageUrl(page, buildId)).toBeNull();
    }
    const html = applySharePreview(INDEX, "/sets/1987-topps-baseball-37fd025d", buildId);
    expect(html).not.toContain("/og/share/");
    expect(html).toContain(`og-image.png?v=${buildId}`);
  });

  it("serves a cleared set image once the hash is in APPROVED.json, and still holds an uncleared set", () => {
    const cleared = SET_SHARE_PAGES.find((page) => page.setId.startsWith("37fd025d"))!;
    const held = SET_SHARE_PAGES.find((page) => page.setId.startsWith("2b77043a"))!;
    expect(setSharePageCleared(cleared)).toBe(true);
    expect(setSharePageCleared(held)).toBe(false);
    const clearedFile = resolveSharePng(cleared.file)!;
    const heldFile = resolveSharePng(held.file)!;
    setShareApprovalForTests(new Set([clearedFile.sha256, heldFile.sha256]));
    const buildId = "abc123";
    const html = applySharePreview(INDEX, cleared.pagePath, buildId);
    expect(html).toContain(`https://packpts.com/og/share/${cleared.file}?v=${buildId}`);
    expect(html).toContain(`content="${cleared.alt}"`);
    const heldHtml = applySharePreview(INDEX, held.pagePath, buildId);
    expect(heldHtml).not.toContain(`/og/share/${held.file}`);
  });

  it("gives the four static pages their own share title and description", () => {
    const buildId = getServedBuildId();
    for (const page of STATIC_SHARE_PAGES) {
      const html = applySharePreview(INDEX, page.pagePath, buildId);
      expect(html).toContain(`property="og:title" content="${page.shareTitle}"`);
      expect(html).toContain(`name="twitter:title" content="${page.shareTitle}"`);
      expect(html).toContain(`property="og:description" content="${page.shareDescription}"`);
      expect(html).toContain(`name="twitter:description" content="${page.shareDescription}"`);
      expect(html).not.toContain("/og/share/");
    }
  });

  it("rejects static preview copy that contains a digit or a percentage", async () => {
    await expect(renderSharePreviewPng({
      kind: "static",
      eyebrow: "PACKPTS",
      title: "Points",
      line: "Earn 70% back.",
      footer: "packpts.com/points",
    })).rejects.toThrow(/share_preview_static_copy/);
  });
});

describe("set page title and VideoGame schema", () => {
  const rows = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/seoSets.json"), "utf8")) as Omit<SeoSet, "slug">[];
  const sets: SeoSet[] = rows.map((row) => ({ ...row, slug: setShareSlug(row.setName, row.id) }));
  const deps = {
    listSets: async () => sets,
    resolveSet: async (ref: string) => sets.find((row) => row.slug === ref || row.id === ref || ref.endsWith("-" + row.id.slice(0, 8))) ?? null,
  };

  it("adds | PackPTS to the /sets title", async () => {
    const page = await resolveSeoPage("/sets", deps);
    expect(page.title).toBe("Sports Card Sets to Play: Baseball, Basketball, Football | PackPTS");
  });

  it("adds one VideoGame node per set page with no player name and no percentage", async () => {
    for (const set of sets) {
      const page = await resolveSeoPage(`/sets/${set.slug}`, deps);
      const graph = (page.jsonld?.["@graph"] as Record<string, unknown>[]) ?? [];
      const games = graph.filter((node) => node["@type"] === "VideoGame");
      expect(games).toHaveLength(1);
      const game = games[0];
      expect(game.name).toBe(set.setName);
      expect(String(game.description)).not.toMatch(/%/);
      expect(JSON.stringify(game)).not.toMatch(/%/);
      expect(String(game.url)).toBe(`https://packpts.com/sets/${set.slug}`);
    }
  });
});
