/**
 * Play-integrated set share kit — destinations, UTMs, OG, kit compose.
 * Contract: docs/PLAY_SETS_SHARE.md
 */
import { describe, expect, it, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import sharp from "sharp";
import {
  PLAY_SETS_COPY,
  PLAY_SETS_DESIGN_EXPORT_MAP,
  PLAY_SETS_STORY_FILES,
  PLAY_SETS_UTM,
  canonicalPlaySetsPath,
  containsForbiddenPlaySetsShareCopy,
  isPlaySetsShareDestination,
  normalizePlaySetsSetRef,
  parsePlaySetsFormat,
  parsePlaySetsHtmlPath,
  parsePlaySetsSurface,
  playSetsDashedUuid,
  playSetsKitPath,
  playSetsOgDescription,
  playSetsOgTitle,
  playSetsSetRefFromQuery,
  playSetsSharePath,
  playSetsShareUrl,
  playSetsSlugIdPrefix,
  playSetsStoryKitPath,
  preferPlaySetsShareImage,
} from "@shared/playSetsShare";
import { injectPlaySetsOgTags } from "../lib/playSetsHtml";
import {
  PLAY_SETS_KIT_SIZE,
  PLAY_SETS_OG_HEIGHT,
  PLAY_SETS_OG_WIDTH,
  PLAY_SETS_STORY_HEIGHT,
  PLAY_SETS_STORY_WIDTH,
  buildPlaySetsShareSvg,
  containsForbiddenPlaySetsKitCopy,
  letterboxPlaySetsOg,
  letterboxPlaySetsStory,
  playSetsFooterUrl,
  renderPlaySetsSharePng,
  writePlaySetsKitFiles,
  writePlaySetsStoryFiles,
} from "../contentFactory/generatePlaySetsKit";
import { copyPlaySetsDesignExports } from "../contentFactory/copyPlaySetsDesign";

const created: string[] = [];

afterAll(() => {
  for (const filePath of created) {
    fs.rmSync(filePath, { force: true, recursive: true });
  }
});

describe("play-sets destinations + UTMs", () => {
  it("locks share UTMs", () => {
    expect(PLAY_SETS_UTM).toEqual({
      utm_source: "share",
      utm_medium: "play_sets",
      utm_campaign: "integrated",
    });
  });

  it("deep-links a known slug and falls back to /sets", () => {
    expect(canonicalPlaySetsPath("porch-87s-a1b2c3d4")).toBe("/sets/porch-87s-a1b2c3d4");
    expect(canonicalPlaySetsPath("17e5d554-aaaa-4bbb-8ccc-ddddeeeeffff")).toBe(
      "/sets/17e5d554-aaaa-4bbb-8ccc-ddddeeeeffff",
    );
    expect(canonicalPlaySetsPath("")).toBe("/sets");
    expect(canonicalPlaySetsPath(null)).toBe("/sets");
    expect(canonicalPlaySetsPath("../make")).toBe("/sets");
    expect(canonicalPlaySetsPath("make")).toBe("/sets");
    expect(canonicalPlaySetsPath("/make")).toBe("/sets");
  });

  it("builds packpts.com destinations with locked UTMs only", () => {
    const withSlug = playSetsShareUrl({ slugOrId: "porch-87s-a1b2c3d4" });
    expect(withSlug).toBe(
      "https://packpts.com/sets/porch-87s-a1b2c3d4?utm_source=share&utm_medium=play_sets&utm_campaign=integrated",
    );
    expect(isPlaySetsShareDestination(withSlug)).toBe(true);
    expect(playSetsSharePath()).toBe("/sets?utm_source=share&utm_medium=play_sets&utm_campaign=integrated");
    expect(isPlaySetsShareDestination("https://packpts.com/make")).toBe(false);
    expect(isPlaySetsShareDestination("https://packpts.com/daily?utm_medium=beatme")).toBe(false);
  });

  it("parses A/B/C surfaces", () => {
    expect(parsePlaySetsSurface("A")).toBe("play_this_set");
    expect(parsePlaySetsSurface("B")).toBe("integrated_shelf");
    expect(parsePlaySetsSurface("C")).toBe("beat_me_from_set");
    expect(parsePlaySetsSurface("unknown")).toBe("integrated_shelf");
  });

  it("maps beat_me aliases to surface C, not integrated_shelf", () => {
    for (const alias of [
      "beat_me",
      "beat-me",
      "beat_me_from_a_set",
      "beat-me-from-a-set",
      "beat_me_from_set",
      "beatme",
      "BEAT_ME",
    ]) {
      expect(parsePlaySetsSurface(alias)).toBe("beat_me_from_set");
    }
    expect(playSetsKitPath("beat_me_from_set")).toBe("/assets/play-sets/beat-me-from-a-set.png");
    expect(playSetsStoryKitPath("beat_me_from_set")).toBe("/assets/play-sets/play-beatme-story.png");
  });

  it("normalizes set slugs from URLs, slug=, and id-only UUIDs", () => {
    expect(normalizePlaySetsSetRef("porch-87s-a1b2c3d4")).toBe("porch-87s-a1b2c3d4");
    expect(normalizePlaySetsSetRef("/sets/porch-87s-a1b2c3d4/")).toBe("porch-87s-a1b2c3d4");
    expect(normalizePlaySetsSetRef(
      "https://packpts.com/sets/porch-87s-a1b2c3d4?utm_source=share&utm_medium=play_sets&utm_campaign=integrated",
    )).toBe("porch-87s-a1b2c3d4");
    expect(playSetsSetRefFromQuery({ slug: "porch-87s-a1b2c3d4" })).toBe("porch-87s-a1b2c3d4");
    expect(playSetsSetRefFromQuery({ set: "https://packpts.com/sets/porch-87s-a1b2c3d4" }))
      .toBe("porch-87s-a1b2c3d4");
    expect(playSetsSlugIdPrefix("porch-87s-a1b2c3d4")).toBe("a1b2c3d4");
    expect(playSetsSlugIdPrefix("a1b2c3d4")).toBe("a1b2c3d4");
    expect(playSetsDashedUuid("17e5d554aaaa4bbb8cccddddeeeeffff"))
      .toBe("17e5d554-aaaa-4bbb-8ccc-ddddeeeeffff");
    expect(canonicalPlaySetsPath("porch-87s-a1b2c3d4")).toBe("/sets/porch-87s-a1b2c3d4");
    expect(playSetsShareUrl({ slugOrId: "porch-87s-a1b2c3d4" })).toBe(
      "https://packpts.com/sets/porch-87s-a1b2c3d4?utm_source=share&utm_medium=play_sets&utm_campaign=integrated",
    );
  });

  it("parses story format and prefers runtime cover over story kit", () => {
    expect(parsePlaySetsFormat("story")).toBe("story");
    expect(parsePlaySetsFormat("9-16")).toBe("story");
    expect(parsePlaySetsFormat("square")).toBe("square");
    const kitStory = preferPlaySetsShareImage({
      surface: "beat_me",
      wantKit: true,
      format: "story",
    });
    expect(kitStory).toEqual({ kind: "kit", path: "/assets/play-sets/play-beatme-story.png" });
    const runtime = preferPlaySetsShareImage({
      runtimeCoverUrl: "/generated/share/2026-09-08/qa.png",
      surface: "beat_me",
      format: "story",
    });
    expect(runtime).toEqual({ kind: "runtime", path: "/generated/share/2026-09-08/qa.png" });
  });

  it("prefers runtime cover over kit A and never treats stock fan as runtime", () => {
    const runtime = preferPlaySetsShareImage({
      runtimeCoverUrl: "/generated/share/2026-09-08/qa.png",
      surface: "play_this_set",
    });
    expect(runtime).toEqual({ kind: "runtime", path: "/generated/share/2026-09-08/qa.png" });

    const stock = preferPlaySetsShareImage({
      runtimeCoverUrl: "/assets/maker-set-1080.png",
      surface: "play_this_set",
    });
    expect(stock).toEqual({ kind: "kit", path: playSetsKitPath("play_this_set") });

    const forcedKit = preferPlaySetsShareImage({
      runtimeCoverUrl: "/generated/share/2026-09-08/qa.png",
      surface: "play_this_set",
      wantKit: true,
    });
    expect(forcedKit.kind).toBe("kit");
  });

  it("keeps share copy free of /make, Maker Rate, and PackPoints", () => {
    const blob = [
      playSetsOgTitle({ surface: "play_this_set", setName: "Porch 87s" }),
      playSetsOgDescription({ surface: "beat_me_from_set", setName: "Porch 87s" }),
      PLAY_SETS_COPY.integrated_shelf.description,
      playSetsFooterUrl({ surface: "play_this_set", slugOrId: "porch-87s-a1b2c3d4" }),
    ].join("\n");
    expect(containsForbiddenPlaySetsShareCopy(blob)).toBe(false);
    expect(containsForbiddenPlaySetsShareCopy("Make a set at /make")).toBe(true);
    expect(containsForbiddenPlaySetsShareCopy("Maker Rate 12%")).toBe(true);
    expect(containsForbiddenPlaySetsShareCopy("PackPoints")).toBe(true);
  });
});

describe("play-sets OG inject", () => {
  const shell = `<!DOCTYPE html><html><head>
    <title>PackPTS</title>
    <link rel="canonical" href="https://packpts.com/" />
    <meta property="og:title" content="PackPTS" />
    <meta property="og:description" content="Guess the player." />
    <meta property="og:image" content="https://packpts.com/og-image.png" />
    <meta property="og:url" content="https://packpts.com/" />
    <meta name="twitter:title" content="PackPTS" />
    <meta name="twitter:description" content="Guess the player." />
    <meta name="twitter:image" content="https://packpts.com/og-image.png" />
    <meta name="description" content="Guess the player." />
  </head><body></body></html>`;

  it("rewrites title, canonical, and images for a set page", () => {
    const html = injectPlaySetsOgTags(shell, {
      title: "Porch 87s · PackPTS",
      description: "Play Porch 87s on PackPTS.",
      image: "/generated/share/2026-09-08/qa.png",
      url: "https://packpts.com/sets/porch-87s-a1b2c3d4",
      canonical: "https://packpts.com/sets/porch-87s-a1b2c3d4",
    });
    expect(html).toContain("<title>Porch 87s · PackPTS</title>");
    expect(html).toContain('og:image" content="https://packpts.com/generated/share/2026-09-08/qa.png"');
    expect(html).toContain('rel="canonical" href="https://packpts.com/sets/porch-87s-a1b2c3d4"');
    expect(html).not.toContain("/make");
    expect(html).not.toContain("og-image.png");
  });

  it("refuses forbidden OG copy", () => {
    expect(() => injectPlaySetsOgTags(shell, {
      title: "Make a set",
      description: "Publish on /make",
      image: "/assets/play-sets/play-this-set.png",
      url: "https://packpts.com/sets",
      canonical: "https://packpts.com/sets",
    })).toThrow();
  });

  it("recognizes /sets HTML paths only", () => {
    expect(parsePlaySetsHtmlPath("/sets")).toEqual({ kind: "index" });
    expect(parsePlaySetsHtmlPath("/sets/porch-87s-a1b2c3d4?utm_medium=play_sets")).toEqual({
      kind: "detail",
      slug: "porch-87s-a1b2c3d4",
    });
    expect(parsePlaySetsHtmlPath("/settings")).toBeNull();
    expect(parsePlaySetsHtmlPath("/make")).toBeNull();
    expect(parsePlaySetsHtmlPath("/daily")).toBeNull();
  });
});

describe("play-sets kit compose", () => {
  it("renders 1080 kit PNGs without forbidden copy", async () => {
    for (const surface of ["play_this_set", "integrated_shelf", "beat_me_from_set"] as const) {
      const svg = await buildPlaySetsShareSvg({ surface });
      expect(containsForbiddenPlaySetsKitCopy(svg)).toBe(false);
      expect(svg.toLowerCase()).toContain("packpts");
      expect(svg).toContain("packpts.com/sets");
      expect(svg).not.toContain("I MADE THIS SET");
      const png = await renderPlaySetsSharePng({ surface });
      const meta = await sharp(png).metadata();
      expect(meta.width).toBe(PLAY_SETS_KIT_SIZE);
      expect(meta.height).toBe(PLAY_SETS_KIT_SIZE);
    }
  });

  it("letterboxes kit art to 1200×630 OG", async () => {
    const square = await renderPlaySetsSharePng({ surface: "integrated_shelf" });
    const og = await letterboxPlaySetsOg(square);
    const meta = await sharp(og).metadata();
    expect(meta.width).toBe(PLAY_SETS_OG_WIDTH);
    expect(meta.height).toBe(PLAY_SETS_OG_HEIGHT);
  });

  it("writes the three Marketing kit files", async () => {
    const dir = path.resolve("public/generated/share/play-sets-kit-test");
    const files = await writePlaySetsKitFiles(dir);
    created.push(...files);
    expect(files).toHaveLength(3);
    for (const file of files) {
      expect(fs.existsSync(file)).toBe(true);
      const meta = await sharp(file).metadata();
      expect(meta.width).toBe(1080);
    }
  });

  it("hosts kit PNGs as static Marketing assets", async () => {
    const dir = path.resolve("client/public/assets/play-sets");
    for (const file of ["play-this-set.png", "integrated-shelf.png", "beat-me-from-a-set.png"]) {
      const disk = path.join(dir, file);
      expect(fs.existsSync(disk)).toBe(true);
      const meta = await sharp(disk).metadata();
      expect(meta.width).toBe(1080);
      expect(meta.height).toBe(1080);
    }
  });

  it("letterboxes kit art to 1080×1920 story without new copy", async () => {
    const square = await renderPlaySetsSharePng({ surface: "beat_me_from_set" });
    const story = await letterboxPlaySetsStory(square);
    const meta = await sharp(story).metadata();
    expect(meta.width).toBe(PLAY_SETS_STORY_WIDTH);
    expect(meta.height).toBe(PLAY_SETS_STORY_HEIGHT);
  });

  it("writes Design-named story crops next to the 1080 kit", async () => {
    const dir = path.resolve("public/generated/share/play-sets-story-test");
    const squares = await writePlaySetsKitFiles(dir);
    const stories = await writePlaySetsStoryFiles(dir);
    created.push(...squares, ...stories);
    expect(stories.map((file) => path.basename(file)).sort()).toEqual(
      Object.values(PLAY_SETS_STORY_FILES).slice().sort(),
    );
    for (const file of stories) {
      const meta = await sharp(file).metadata();
      expect(meta.width).toBe(1080);
      expect(meta.height).toBe(1920);
    }
  });

  it("copies Design exports by rename map and does not invent missing art", () => {
    expect(PLAY_SETS_DESIGN_EXPORT_MAP).toEqual([
      { from: "play-set-1080.png", to: "play-this-set.png" },
      { from: "play-shelf-1080.png", to: "integrated-shelf.png" },
      { from: "play-beatme-1080.png", to: "beat-me-from-a-set.png" },
      { from: "play-set-story.png", to: "play-set-story.png" },
      { from: "play-shelf-story.png", to: "play-shelf-story.png" },
      { from: "play-beatme-story.png", to: "play-beatme-story.png" },
    ]);

    const src = path.resolve("public/generated/share/play-sets-design-src");
    const dest = path.resolve("public/generated/share/play-sets-design-dest");
    fs.mkdirSync(src, { recursive: true });
    fs.mkdirSync(dest, { recursive: true });
    created.push(src, dest);
    fs.writeFileSync(path.join(src, "play-beatme-1080.png"), Buffer.from("design-c"));
    const result = copyPlaySetsDesignExports({ sourceDir: src, destDir: dest });
    expect(result.copied.map((file) => path.basename(file))).toEqual(["beat-me-from-a-set.png"]);
    expect(result.missing).toContain("play-set-1080.png");
    expect(fs.readFileSync(path.join(dest, "beat-me-from-a-set.png"), "utf8")).toBe("design-c");
    expect(fs.existsSync(path.join(dest, "play-this-set.png"))).toBe(false);
  });

  it("hosts Design story crops as static Marketing assets", async () => {
    const dir = path.resolve("client/public/assets/play-sets");
    for (const file of Object.values(PLAY_SETS_STORY_FILES)) {
      const disk = path.join(dir, file);
      expect(fs.existsSync(disk)).toBe(true);
      const meta = await sharp(disk).metadata();
      expect(meta.width).toBe(1080);
      expect(meta.height).toBe(1920);
    }
  });
});
