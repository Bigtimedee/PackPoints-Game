/**
 * Box-side Design packet. This is the executable entrypoint. It streams one
 * authenticated read at a time, then asks exportDesignSet to write and
 * validate the full packet. REVIEW_READY is removed before work and is
 * written only after that validation. It is not a release.
 *
 *   PACKPTS_BASE_URL=https://packpts.com COVER_QA_TOKEN=... \
 *     npx tsx scripts/export-design-inbox.ts --set <uuid> --out <private-dir> [--review]
 *
 * The token is an environment variable, never an argument. Default is
 * source discovery and does not write REVIEW_READY. --review asks for the
 * full paired packet. Refuses symlinks and public, static, dist, or
 * masked-cards destinations.
 */
import { createWriteStream, lstatSync, mkdirSync, realpathSync, renameSync, rmSync } from "fs";
import path from "path";
import { cardJpegName, clearReviewMarkers, exportDesignSet } from "../server/services/baseballExpansion/exportSet";
import { expansionTargetById } from "../server/services/baseballExpansion/registry";

const MAX_BYTES = 15 * 1024 * 1024;

function arg(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  return process.argv[index + 1] || null;
}

function refusedDir(dir: string): boolean {
  const text = dir.replace(/\\/g, "/").toLowerCase();
  return text.includes("/public") || text.includes("/static") || text.includes("/dist") || text.includes("masked-cards");
}

export function privateBoxDirectory(dir: string): string {
  mkdirSync(dir, { recursive: true });
  const listed = lstatSync(dir);
  if (listed.isSymbolicLink()) throw new Error("symlink destination refused");
  const real = realpathSync(dir);
  if (refusedDir(real)) throw new Error("public destination refused");
  return real;
}

async function readJson(url: string, token: string): Promise<unknown> {
  const res = await fetch(url, { headers: { "X-QA-Token": token } });
  if (!res.ok) throw new Error(`GET ${res.status}`);
  return res.json();
}

async function streamFile(url: string, token: string, file: string): Promise<void> {
  const partial = `${file}.partial`;
  rmSync(partial, { force: true });
  const res = await fetch(url, { headers: { "X-QA-Token": token }, signal: AbortSignal.timeout(20000) });
  if (!res.ok || !res.body) throw new Error("download failed");
  const length = Number(res.headers.get("content-length") || 0);
  if (length > MAX_BYTES) throw new Error("download too large");
  let seen = 0;
  const out = createWriteStream(partial);
  try {
    for await (const chunk of res.body as AsyncIterable<Uint8Array>) {
      seen += chunk.byteLength;
      if (seen > MAX_BYTES) throw new Error("download too large");
      if (!out.write(chunk)) await new Promise((resolve) => out.once("drain", resolve));
    }
    if (seen === 0) throw new Error("empty download");
    await new Promise<void>((resolve, reject) => { out.end(() => resolve()); out.on("error", reject); });
    rmSync(file, { force: true });
    renameSync(partial, file);
  } catch (error) {
    out.destroy();
    rmSync(partial, { force: true });
    rmSync(file, { force: true });
    throw error;
  }
}

async function main(): Promise<void> {
  const base = process.env.PACKPTS_BASE_URL?.replace(/\/$/, "");
  const token = process.env.COVER_QA_TOKEN;
  const setId = arg("--set");
  const out = arg("--out");
  const review = process.argv.includes("--review");
  if (!base || !token || !setId || !out) {
    console.error("Need PACKPTS_BASE_URL, COVER_QA_TOKEN, --set, and --out");
    process.exit(1);
  }
  const target = expansionTargetById(setId);
  if (!target) {
    console.error("Unknown set");
    process.exit(1);
  }
  const root = privateBoxDirectory(path.resolve(out));
  const directory = privateBoxDirectory(path.join(root, target.slug));
  clearReviewMarkers(directory);
  mkdirSync(path.join(directory, "source"), { recursive: true });
  mkdirSync(path.join(directory, "masked"), { recursive: true });
  try {
    const profile = await readJson(`${base}/api/qa/baseball-expansion/${setId}/profile`, token) as {
      explicit?: boolean;
      profileId?: string | null;
      side?: "top" | "bottom" | "both" | null;
      regions?: { x: number; y: number; w: number; h: number }[] | null;
    };
    const cards: {
      heldId: string; player: string; cardNo: string; sourceUrl: string;
      width: number; height: number; sourceJpeg: null; maskedJpeg: null;
      sourcePath: string; maskedPath: string; nameCheckPassed: boolean; variant: string; proposedCover: boolean;
    }[] = [];
    let offset = 0;
    for (;;) {
      const page = await readJson(`${base}/api/qa/sets/${setId}/cards?offset=${offset}&limit=20`, token) as {
        cards?: { cardId: string; player: string | null; number: string | null; imageUrl: string | null; sourcePath: string; maskedPath: string }[];
      };
      const rows = page.cards || [];
      if (rows.length === 0) break;
      for (const row of rows) {
        const name = cardJpegName(row.cardId);
        if (!name) throw new Error("card id is not a path segment");
        const sourcePath = path.join(directory, "source", name);
        const maskedPath = path.join(directory, "masked", name);
        await streamFile(`${base}${row.sourcePath}`, token, sourcePath);
        try {
          await streamFile(`${base}${row.maskedPath}`, token, maskedPath);
        } catch (error) {
          rmSync(sourcePath, { force: true });
          rmSync(maskedPath, { force: true });
          throw error;
        }
        cards.push({
          heldId: row.cardId.toLowerCase(),
          player: row.player || "",
          cardNo: row.number || "",
          sourceUrl: row.imageUrl || "",
          width: 0,
          height: 0,
          sourceJpeg: null,
          maskedJpeg: null,
          sourcePath,
          maskedPath,
          nameCheckPassed: true,
          variant: "Base",
          proposedCover: cards.length < 8,
        });
      }
      offset += rows.length;
      if (rows.length < 20) break;
    }
    const result = await exportDesignSet({
      target,
      profile: {
        explicit: profile.explicit === true,
        profileId: profile.profileId ?? null,
        side: profile.side ?? null,
        regions: profile.regions ?? null,
      },
      cards,
      directory,
      mode: review ? "review" : "source",
    });
    if (!result.ready) clearReviewMarkers(directory);
    console.log(JSON.stringify({
      setId,
      rows: cards.length,
      reviewReady: result.ready,
      releaseApproval: false,
      packetMissing: result.reconciliation.packetMissing,
    }));
    if (review && !result.ready) process.exit(2);
  } catch (error) {
    clearReviewMarkers(directory);
    console.error(error instanceof Error ? error.message : "export failed");
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1].includes("export-design-inbox")) {
  void main();
}
