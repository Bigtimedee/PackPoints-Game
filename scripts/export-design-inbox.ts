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
 * full paired packet. The first review stores the original id list once.
 * A later run does not replace that list. --resubmit records a membership,
 * witness, or mask-revision change without changing the first submission.
 *
 * --out is a trusted private directory. Symlink and public-path checks are
 * not a proof against a hostile writer racing this process.
 */
import { createWriteStream, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "fs";
import path from "path";
import { CURRENT_MASK_VERSION } from "@shared/maskGeometry";
import { canonicalMembership, membershipMatches, sourceWitness } from "../server/services/baseballExpansion/identity";
import { assertContained, cardJpegName, clearReviewMarkers, exportDesignSet, originalCsvForIds, originalRowsFromCsv } from "../server/services/baseballExpansion/exportSet";
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

type StoredPool = { ids: string[]; hash: string; sourceWitness: string; maskVersion: string };

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  const a = canonicalMembership(left);
  const b = canonicalMembership(right);
  return membershipMatches(a, b);
}

function readRegularFile(file: string): string | null {
  if (!existsSync(file)) return null;
  const listed = lstatSync(file);
  if (listed.isSymbolicLink() || !listed.isFile()) throw new Error("symlink refused");
  return readFileSync(file, "utf8");
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

type Resubmission = {
  at: string;
  kinds: string[];
  replacesOriginal: false;
  maskVersion: string;
  storedMaskVersion: string;
  sourceWitness: string;
  storedSourceWitness: string;
  cardIds: string[];
  storedCardIds: string[];
};

function readResubmissions(publishedDir: string): Resubmission[] {
  const text = readRegularFile(path.join(publishedDir, "resubmissions.json"));
  if (!text) return [];
  const parsed = JSON.parse(text) as { entries?: Resubmission[] };
  return Array.isArray(parsed.entries) ? parsed.entries : [];
}

async function readStoredPool(base: string, setId: string, token: string): Promise<StoredPool | null> {
  const res = await fetch(`${base}/api/qa/baseball-expansion/${setId}/original-pool`, { headers: { "X-QA-Token": token } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`membership ${res.status}`);
  const body = await res.json() as { cardIds?: unknown; manifestSha256?: unknown; sourceWitness?: unknown; maskVersion?: unknown };
  if (!Array.isArray(body.cardIds) || typeof body.manifestSha256 !== "string" || typeof body.sourceWitness !== "string" || typeof body.maskVersion !== "string") {
    throw new Error("membership unreadable");
  }
  const ids = body.cardIds.filter((id): id is string => typeof id === "string");
  const membership = canonicalMembership(ids);
  if (membership.hash !== body.manifestSha256) throw new Error("membership hash does not match ids");
  return { ids: membership.ids, hash: membership.hash, sourceWitness: body.sourceWitness, maskVersion: body.maskVersion };
}

async function postPool(
  base: string,
  setId: string,
  token: string,
  rows: { id: string; sourceUrl: string }[],
): Promise<{ ok: true } | { ok: false; code: string }> {
  const res = await fetch(`${base}/api/qa/baseball-expansion/${setId}/original-pool`, {
    method: "POST",
    headers: { "X-QA-Token": token, "Content-Type": "application/json" },
    body: JSON.stringify({ cards: rows.map((row) => ({ id: row.id, sourceUrl: row.sourceUrl })) }),
  });
  if (res.ok) return { ok: true };
  if (res.status === 409) {
    const body = await res.json() as { code?: string };
    return { ok: false, code: body.code || "rejected" };
  }
  throw new Error(`membership ${res.status}`);
}

async function main(): Promise<void> {
  const base = process.env.PACKPTS_BASE_URL?.replace(/\/$/, "");
  const token = process.env.COVER_QA_TOKEN;
  const setId = arg("--set");
  const out = arg("--out");
  const review = process.argv.includes("--review");
  const resubmit = process.argv.includes("--resubmit");
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
  const published = path.join(root, target.slug);
  if (existsSync(published)) {
    if (lstatSync(published).isSymbolicLink()) throw new Error("symlink destination refused");
    clearReviewMarkers(published);
  }
  const staging = privateBoxDirectory(path.join(root, `.staging-${target.slug}-${process.pid}`));
  const directory = staging;
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
        cards?: {
          cardId: string; player: string | null; number: string | null; imageUrl: string | null;
          sourcePath: string; maskedPath: string; variant?: string | null;
          isPlayable?: boolean; blockedReason?: string | null; nameCheck?: "passed" | "failed" | "unknown";
        }[];
      };
      const rows = page.cards || [];
      if (rows.length === 0) break;
      for (const row of rows) {
        const name = cardJpegName(row.cardId);
        if (!name) throw new Error("card id is not a path segment");
        const sourcePath = assertContained(directory, path.join("source", name));
        const maskedPath = assertContained(directory, path.join("masked", name));
        await streamFile(`${base}${row.sourcePath}`, token, sourcePath);
        if (review) {
          try {
            await streamFile(`${base}${row.maskedPath}`, token, maskedPath);
          } catch (error) {
            rmSync(sourcePath, { force: true });
            rmSync(maskedPath, { force: true });
            throw error;
          }
        }
        const nameCheck = row.nameCheck === "passed" ? true : row.nameCheck === "failed" ? false : null;
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
          maskedPath: review ? maskedPath : null,
          nameCheckPassed: nameCheck,
          isPlayable: row.isPlayable,
          blockedReason: row.blockedReason ?? null,
          variant: row.variant ?? null,
          proposedCover: cards.length < 8,
        });
      }
      offset += rows.length;
      if (rows.length < 20) break;
    }
    const stored = await readStoredPool(base, setId, token);
    const priorText = readRegularFile(path.join(published, "original-submitted.csv"));
    const priorRows = priorText ? originalRowsFromCsv(priorText) : [];
    const currentWitness = sourceWitness(cards.map((card) => ({ id: card.heldId, sourceUrl: card.sourceUrl })), CURRENT_MASK_VERSION);
    let membershipSource: "database" | "file" | "initialized" | "discovery" = review ? "initialized" : "discovery";
    let mismatch = false;
    let witnessStatus: "matched" | "changed" | "uninitialized" = "uninitialized";
    let maskRevision: "matched" | "changed" | "uninitialized" = "uninitialized";
    if (stored) {
      membershipSource = "database";
      mismatch = !sameIds(stored.ids, cards.map((card) => card.heldId));
      witnessStatus = stored.sourceWitness === currentWitness ? "matched" : "changed";
      maskRevision = stored.maskVersion === CURRENT_MASK_VERSION ? "matched" : "changed";
      const priorMatches = priorRows.length > 0 && sameIds(stored.ids, priorRows.map((row) => row.heldId));
      const csv = priorMatches && priorText
        ? priorText
        : originalCsvForIds(stored.ids, cards);
      writeFileSync(assertContained(directory, "original-submitted.csv"), csv);
    } else if (priorText && priorRows.length > 0) {
      membershipSource = "file";
      mismatch = !sameIds(priorRows.map((row) => row.heldId), cards.map((card) => card.heldId));
      writeFileSync(assertContained(directory, "original-submitted.csv"), priorText);
      if (review) {
        const posted = await postPool(base, setId, token, priorRows.map((row) => ({ id: row.heldId, sourceUrl: row.sourceUrl })));
        if (!posted.ok && posted.code !== "witness_changed") {
          const winner = await readStoredPool(base, setId, token);
          if (!winner) throw new Error(posted.code);
          writeFileSync(assertContained(directory, "original-submitted.csv"), originalCsvForIds(winner.ids, cards));
          membershipSource = "database";
        }
      }
    } else if (review) {
      const posted = await postPool(base, setId, token, cards.map((card) => ({ id: card.heldId, sourceUrl: card.sourceUrl })));
      if (!posted.ok) {
        const winner = await readStoredPool(base, setId, token);
        if (!winner) throw new Error(posted.code);
        writeFileSync(assertContained(directory, "original-submitted.csv"), originalCsvForIds(winner.ids, cards));
        membershipSource = "database";
        mismatch = !sameIds(winner.ids, cards.map((card) => card.heldId));
      } else {
        witnessStatus = "matched";
        maskRevision = "matched";
      }
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
      membership: { source: membershipSource, mismatch, witness: witnessStatus, maskRevision },
    });
    const history = readResubmissions(published);
    const kinds: string[] = [];
    if (mismatch) kinds.push("membership");
    if (witnessStatus === "changed") kinds.push("witness");
    if (maskRevision === "changed") kinds.push("mask_revision");
    if (resubmit && review && kinds.length > 0 && stored) {
      history.push({
        at: new Date().toISOString(),
        kinds,
        replacesOriginal: false,
        maskVersion: CURRENT_MASK_VERSION,
        storedMaskVersion: stored.maskVersion,
        sourceWitness: currentWitness,
        storedSourceWitness: stored.sourceWitness,
        cardIds: canonicalMembership(cards.map((card) => card.heldId)).ids,
        storedCardIds: stored.ids,
      });
    }
    if (history.length > 0) {
      writeFileSync(assertContained(directory, "resubmissions.json"), JSON.stringify({ replacesOriginal: false, entries: history }, null, 2) + "\n");
    }
    if (!result.ready) clearReviewMarkers(directory);
    if (lstatSync(staging).isSymbolicLink()) throw new Error("symlink destination refused");
    if (existsSync(published)) {
      if (lstatSync(published).isSymbolicLink()) throw new Error("symlink destination refused");
      const previous = path.join(root, `.previous-${target.slug}-${process.pid}`);
      rmSync(previous, { recursive: true, force: true });
      renameSync(published, previous);
      renameSync(staging, published);
      rmSync(previous, { recursive: true, force: true });
    } else {
      renameSync(staging, published);
    }
    console.log(JSON.stringify({
      setId,
      rows: cards.length,
      reviewReady: result.ready,
      releaseApproval: false,
      packetMissing: result.reconciliation.packetMissing,
      membershipSource,
      membershipMismatch: mismatch,
      witnessStatus,
      maskRevision,
      replacesOriginal: false,
    }));
    if (review && !result.ready) process.exit(2);
  } catch (error) {
    clearReviewMarkers(directory);
    rmSync(directory, { recursive: true, force: true });
    console.error(error instanceof Error ? error.message : "export failed");
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1].includes("export-design-inbox")) {
  void main();
}
