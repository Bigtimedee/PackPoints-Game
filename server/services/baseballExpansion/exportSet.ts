/**
 * Design inbox export for one set. Writes only under the directory the caller
 * passes. Player names and source URLs stay in that directory. This module
 * does not pin covers, deal Daily 5, or approve a set.
 *
 * REVIEW_READY means the review packet is complete. It is not a release.
 * Source-only mode writes discovery files and does not write REVIEW_READY.
 * A later smaller export does not replace the original submitted manifest.
 */
import { createHash } from "crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import path from "path";
import sharp from "sharp";
import {
  ENGINEERING_SET_MINIMUM,
  evaluatePoolHealth,
  sourceFailReasons,
  type PoolHealth,
} from "./health";
import type { ExpansionTarget } from "./registry";

export interface MaskFraction {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ExportProfile {
  explicit: boolean;
  profileId: string | null;
  side: "top" | "bottom" | "both" | null;
  regions: MaskFraction[] | null;
}

export interface ExportCardInput {
  heldId: string;
  player: string;
  cardNo: string;
  sourceUrl: string;
  width: number;
  height: number;
  sourceJpeg: Buffer | null;
  maskedJpeg: Buffer | null;
  sourcePath?: string | null;
  maskedPath?: string | null;
  blockedReason?: string | null;
  isPlayable?: boolean;
  nameCheckPassed: boolean | null;
  maskRefused?: boolean;
  variant?: string | null;
  proposedCover?: boolean;
}

export interface ExportResult {
  slug: string;
  directory: string;
  originalCount: number;
  originalCardIds: string[];
  health: PoolHealth;
  ready: boolean;
  profileExplicit: boolean;
  reconciliation: Record<string, unknown>;
}

const MANIFEST = "original-submitted.csv";
const POOL = "pool.csv";
const READY = "READY";

function csvCell(value: string | number): string {
  const text = String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function poolLine(card: { heldId: string; player: string; cardNo: string; sourceUrl: string; width: number; height: number }): string {
  return [card.heldId, card.player, card.cardNo, card.sourceUrl, card.width, card.height].map(csvCell).join(",");
}

const HEADER = "heldId,player,cardNo,sourceUrl,width,height";
const CARD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** UUID only. Rejects slashes, dot segments, and any other path text. */
export function cardJpegName(cardId: string): string | null {
  if (!CARD_ID.test(cardId)) return null;
  return `${cardId.toLowerCase()}.jpg`;
}

/** Walk every component with lstat. A symlink anywhere in the path is refused. */
export function assertContained(root: string, relativePath: string): string {
  const realRoot = realpathSync(root);
  const rel = path.relative(realRoot, path.resolve(realRoot, relativePath));
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("path escapes private root");
  let current = realRoot;
  for (const part of rel.split(path.sep)) {
    if (!part || part === "." || part === "..") throw new Error("path escapes private root");
    current = path.join(current, part);
    try {
      if (lstatSync(current).isSymbolicLink()) throw new Error("symlink refused");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return current;
      throw error;
    }
  }
  return current;
}

export function clearReviewMarkers(directory: string): void {
  for (const name of [READY, "REVIEW_READY"]) {
    const file = path.join(directory, name);
    if (existsSync(file)) rmSync(file, { force: true });
  }
}

export function reviewPacketMissing(directory: string, ids: readonly string[]): string[] {
  const missing: string[] = [];
  for (const name of ["profile.json", POOL, MANIFEST, "reconciliation.json", path.join("covers", "NOT_DAILY5.json")]) {
    if (!existsSync(path.join(directory, name))) missing.push(name);
  }
  const poolPath = path.join(directory, POOL);
  const manifestPath = path.join(directory, MANIFEST);
  if (existsSync(poolPath) && !readFileSync(poolPath, "utf8").startsWith(HEADER)) missing.push("pool.csv header");
  if (existsSync(poolPath) && existsSync(manifestPath)) {
    const poolIds = parsePool(readFileSync(poolPath, "utf8")).map((row) => row.heldId).sort();
    const manifestIds = parsePool(readFileSync(manifestPath, "utf8")).map((row) => row.heldId).sort();
    if (poolIds.join("\n") !== manifestIds.join("\n")) missing.push("pool/manifest membership");
  }
  for (const id of ids) {
    const file = cardJpegName(id);
    if (!file) { missing.push(`bad-id:${id}`); continue; }
    if (!existsSync(path.join(directory, "source", file))) missing.push(`source/${file}`);
    if (!existsSync(path.join(directory, "masked", file))) missing.push(`masked/${file}`);
  }
  return missing;
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === "\"" && line[i + 1] === "\"") { current += "\""; i += 1; continue; }
      if (ch === "\"") { quoted = false; continue; }
      current += ch;
      continue;
    }
    if (ch === "\"") { quoted = true; continue; }
    if (ch === ",") { cells.push(current); current = ""; continue; }
    current += ch;
  }
  cells.push(current);
  return cells;
}

export function originalRowsFromCsv(text: string): { heldId: string; sourceUrl: string }[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0).slice(1);
  return lines.map((line) => {
    const cells = parseCsvLine(line);
    return { heldId: (cells[0] ?? "").trim().toLowerCase(), sourceUrl: cells[3] ?? "" };
  }).filter((row) => row.heldId.length > 0);
}

/** Rows for ids that are not in this download stay on the manifest with empty source fields. */
export function originalCsvForIds(
  ids: readonly string[],
  cards: readonly { heldId: string; player: string; cardNo: string; sourceUrl: string; width: number; height: number }[],
): string {
  const byId = new Map(cards.map((card) => [card.heldId.toLowerCase(), card]));
  const lines = [HEADER];
  for (const id of ids) {
    const card = byId.get(id.toLowerCase());
    lines.push(card
      ? poolLine(card)
      : [id.toLowerCase(), "", "", "", 0, 0].map((value) => csvCell(value)).join(","));
  }
  return lines.join("\n") + "\n";
}

function parsePool(text: string): { heldId: string }[] {
  return originalRowsFromCsv(text).map((row) => ({ heldId: row.heldId }));
}

function hostOf(url: string): string {
  try { return new URL(url).host; } catch { return ""; }
}

async function jpegSize(buffer: Buffer, fallbackW: number, fallbackH: number): Promise<{ width: number; height: number }> {
  try {
    const meta = await sharp(buffer).metadata();
    if (meta.width && meta.height) return { width: meta.width, height: meta.height };
  } catch { /* measured size unknown */ }
  return { width: fallbackW, height: fallbackH };
}

export async function exportDesignSet(input: {
  target: ExpansionTarget;
  profile: ExportProfile;
  cards: ExportCardInput[];
  directory: string;
  /** source = discovery files only. review = may write REVIEW_READY. Never a release. */
  mode?: "source" | "review";
  engineeringMinimum?: number;
  /** Set by the box entrypoint. Omitted by direct callers. */
  membership?: {
    source: "database" | "file" | "initialized" | "discovery";
    mismatch: boolean;
    witness: "matched" | "changed" | "uninitialized";
    maskRevision: "matched" | "changed" | "uninitialized";
  };
}): Promise<ExportResult> {
  const directory = input.directory;
  mkdirSync(path.join(directory, "source"), { recursive: true });
  mkdirSync(path.join(directory, "masked"), { recursive: true });
  mkdirSync(path.join(directory, "masked-300"), { recursive: true });
  mkdirSync(path.join(directory, "covers"), { recursive: true });
  clearReviewMarkers(directory);

  const manifestPath = path.join(directory, MANIFEST);
  let originalIds: string[];
  if (existsSync(manifestPath)) {
    originalIds = parsePool(readFileSync(manifestPath, "utf8")).map((row) => row.heldId);
  } else if (input.mode === "source") {
    originalIds = input.cards.map((card) => card.heldId);
  } else {
    originalIds = input.cards.map((card) => card.heldId);
    const body = [HEADER, ...input.cards.map(poolLine)].join("\n") + "\n";
    writeFileSync(manifestPath, body);
  }
  const byId = new Map(input.cards.map((card) => [card.heldId, card]));
  const measured = new Map<string, { width: number; height: number; reasons: string[] }>();
  let sourceFiles = 0;
  let maskedFiles = 0;
  const hosts = new Set<string>();
  for (const id of originalIds) {
    const card = byId.get(id);
    if (!card) {
      measured.set(id, { width: 0, height: 0, reasons: ["dropped_from_resubmit"] });
      continue;
    }
    const fileName = cardJpegName(id);
    let width = card.width;
    let height = card.height;
    const sourceFile = fileName ? path.join(directory, "source", fileName) : "";
    if (fileName && card.sourceJpeg && card.sourceJpeg.length > 0) {
      writeFileSync(sourceFile, card.sourceJpeg);
    } else if (fileName && card.sourcePath && existsSync(card.sourcePath) && path.resolve(card.sourcePath) !== path.resolve(sourceFile)) {
      writeFileSync(sourceFile, readFileSync(card.sourcePath));
    }
    if (fileName && existsSync(sourceFile)) {
      const size = await jpegSize(readFileSync(sourceFile), width, height);
      width = size.width;
      height = size.height;
      sourceFiles += 1;
    }
    let hasMasked = false;
    const maskedFile = fileName ? path.join(directory, "masked", fileName) : "";
    if (fileName && card.maskedJpeg && card.maskedJpeg.length > 0) {
      writeFileSync(maskedFile, card.maskedJpeg);
    } else if (fileName && card.maskedPath && existsSync(card.maskedPath) && path.resolve(card.maskedPath) !== path.resolve(maskedFile)) {
      writeFileSync(maskedFile, readFileSync(card.maskedPath));
    }
    if (fileName && existsSync(maskedFile)) {
      const size = await jpegSize(readFileSync(maskedFile), width, height);
      if (!(width > 0)) width = size.width;
      if (!(height > 0)) height = size.height;
      const preview = await sharp(maskedFile).resize({ width: 300, withoutEnlargement: false }).jpeg().toBuffer();
      writeFileSync(path.join(directory, "masked-300", fileName), preview);
      maskedFiles += 1;
      hasMasked = true;
    }
    const host = hostOf(card.sourceUrl);
    if (host) hosts.add(host);
    measured.set(id, {
      width,
      height,
      reasons: sourceFailReasons({
        width,
        height,
        blockedReason: card.blockedReason,
        isPlayable: card.isPlayable,
        hasSource: Boolean(fileName && existsSync(sourceFile)),
        hasMasked,
        nameCheckPassed: card.nameCheckPassed,
        maskRefused: card.maskRefused,
        variant: card.variant,
      }),
    });
  }

  const poolCards = originalIds.map((id) => byId.get(id)).filter((card): card is ExportCardInput => Boolean(card));
  writeFileSync(path.join(directory, POOL), [HEADER, ...poolCards.map((card) => {
    const size = measured.get(card.heldId);
    return poolLine({ ...card, width: size?.width ?? card.width, height: size?.height ?? card.height });
  })].join("\n") + "\n");

  const results = originalIds.map((id) => {
    const reasons = measured.get(id)?.reasons ?? ["missing"];
    const unknown = reasons.includes("name_check_unknown");
    const hard = reasons.filter((reason) => reason !== "name_check_unknown");
    return { cardId: id, passed: !unknown && hard.length === 0, findingsComplete: !unknown };
  });
  const originalSet = new Set(originalIds);
  for (const card of input.cards) {
    if (!originalSet.has(card.heldId)) results.push({ cardId: card.heldId, passed: false, findingsComplete: true });
  }
  const health = evaluatePoolHealth({
    originalCardIds: originalIds,
    results,
    engineeringMinimum: input.engineeringMinimum,
  });
  const profile = input.profile.explicit && input.profile.regions && input.profile.regions.length > 0 && input.profile.side
    ? input.profile
    : { explicit: false, profileId: null, side: null, regions: null };
  const filesComplete = originalIds.every((id) => {
    const name = cardJpegName(id);
    if (!name) return false;
    return existsSync(path.join(directory, "source", name))
      && existsSync(path.join(directory, "masked", name))
      && existsSync(path.join(directory, "masked-300", name));
  });
  const paired = filesComplete && profile.explicit && health.originalCount === originalIds.length && originalIds.length > 0;
  const reviewReady = input.mode !== "source" && paired;

  writeFileSync(path.join(directory, "profile.json"), JSON.stringify({
    setId: input.target.id,
    slug: input.target.slug,
    sport: input.target.identity.sport,
    year: input.target.identity.year,
    brand: input.target.identity.brand,
    setName: input.target.identity.setName,
    explicit: profile.explicit,
    profileId: profile.profileId,
    side: profile.side,
    regions: profile.regions,
  }, null, 2) + "\n");

  const coverIds = reviewReady
    ? poolCards.filter((card) => card.proposedCover && (measured.get(card.heldId)?.reasons.length ?? 1) === 0).map((card) => card.heldId)
    : [];
  for (const id of coverIds) {
    const name = cardJpegName(id);
    const card = byId.get(id);
    if (!name) continue;
    if (card?.maskedJpeg) writeFileSync(path.join(directory, "covers", name), card.maskedJpeg);
    else {
      const maskedFile = path.join(directory, "masked", name);
      if (existsSync(maskedFile)) writeFileSync(path.join(directory, "covers", name), readFileSync(maskedFile));
    }
  }
  writeFileSync(path.join(directory, "covers", "NOT_DAILY5.json"), JSON.stringify({
    dealDaily5: false,
    pinned: false,
    approved: false,
    cardIds: coverIds,
  }, null, 2) + "\n");

  const manifestSha = existsSync(manifestPath)
    ? createHash("sha256").update(readFileSync(manifestPath)).digest("hex")
    : null;
  const reconciliation = {
    setId: input.target.id,
    slug: input.target.slug,
    originalCount: health.originalCount,
    currentRows: poolCards.length,
    droppedFromOriginal: originalIds.filter((id) => !byId.has(id)),
    addedAfterSubmission: health.addedAfterSubmission,
    passedCount: health.passedCount,
    failedCount: health.failedCount,
    failedCardIds: health.failedCardIds,
    originalPassRate: health.originalPassRate,
    releasedCount: health.releasedCount,
    releasedPassRate: health.releasedPassRate,
    threshold: health.threshold,
    engineeringMinimum: health.engineeringMinimum ?? ENGINEERING_SET_MINIMUM,
    verdict: health.verdict,
    cherryPickAllowed: false,
    releaseAuthorized: false,
    reviewReady: false,
    packetMissing: [] as string[],
    profileExplicit: profile.explicit,
    filesComplete,
    sourceFiles,
    maskedFiles,
    sourceHosts: [...hosts].sort(),
    dimensionsFromJpeg: true,
    manifestSha256: manifestSha,
    dealDaily5: false,
    pinnedCovers: false,
    coverApproved: false,
    findingsComplete: health.findingsComplete,
    thresholdClaimed: health.thresholdClaimed,
    membershipSource: input.membership?.source ?? (existsSync(manifestPath) ? "file" : input.mode === "source" ? "discovery" : "initialized"),
    membershipMismatch: input.membership?.mismatch ?? false,
    witnessStatus: input.membership?.witness ?? "uninitialized",
    maskRevision: input.membership?.maskRevision ?? "uninitialized",
  };
  const packetMissing = reviewReady ? reviewPacketMissing(directory, originalIds).filter((name) => name !== "reconciliation.json") : ["source-only"];
  const packetReady = reviewReady && packetMissing.length === 0;
  reconciliation.reviewReady = packetReady;
  reconciliation.packetMissing = packetMissing;
  writeFileSync(path.join(directory, "reconciliation.json"), JSON.stringify(reconciliation, null, 2) + "\n");
  clearReviewMarkers(directory);
  if (packetReady) {
    writeFileSync(path.join(directory, "REVIEW_READY"), JSON.stringify({
      setId: input.target.id,
      slug: input.target.slug,
      originalCount: health.originalCount,
      reviewReady: true,
      releaseApproval: false,
      designCleared: false,
      manifestSha256: manifestSha,
    }) + "\n");
  }
  return {
    slug: input.target.slug,
    directory,
    originalCount: health.originalCount,
    originalCardIds: originalIds,
    health,
    ready: packetReady,
    profileExplicit: profile.explicit,
    reconciliation,
  };
}

export function designInboxDirectory(root: string, slug: string): string {
  if (!root.trim() || root.includes("\0") || slug.includes("/") || slug.includes("..")) {
    throw new Error("inbox path refused");
  }
  return path.resolve(root, slug);
}
