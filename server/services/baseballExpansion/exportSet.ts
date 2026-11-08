/**
 * Design inbox export for one set. Writes only under the directory the caller
 * passes. Player names and source URLs stay in that directory. This module
 * does not pin covers, deal Daily 5, or approve a set.
 *
 * READY is written last, and only when the explicit profile, the 1:1 files,
 * and the original-pool health gate all succeed. A later smaller export does
 * not replace the original submitted manifest.
 */
import { createHash } from "crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "fs";
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
  blockedReason?: string | null;
  isPlayable?: boolean;
  nameCheckPassed: boolean;
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

function parsePool(text: string): { heldId: string }[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  return lines.slice(1).map((line) => ({ heldId: line.split(",")[0]!.replace(/^"|"$/g, "") }));
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
  engineeringMinimum?: number;
}): Promise<ExportResult> {
  const directory = input.directory;
  mkdirSync(path.join(directory, "source"), { recursive: true });
  mkdirSync(path.join(directory, "masked"), { recursive: true });
  mkdirSync(path.join(directory, "masked-300"), { recursive: true });
  mkdirSync(path.join(directory, "covers"), { recursive: true });
  if (existsSync(path.join(directory, READY))) rmSync(path.join(directory, READY));

  const manifestPath = path.join(directory, MANIFEST);
  let originalIds: string[];
  if (existsSync(manifestPath)) {
    originalIds = parsePool(readFileSync(manifestPath, "utf8")).map((row) => row.heldId);
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
    let width = card.width;
    let height = card.height;
    if (card.sourceJpeg && card.sourceJpeg.length > 0) {
      const size = await jpegSize(card.sourceJpeg, width, height);
      width = size.width;
      height = size.height;
      writeFileSync(path.join(directory, "source", `${id}.jpg`), card.sourceJpeg);
      sourceFiles += 1;
    }
    let hasMasked = false;
    if (card.maskedJpeg && card.maskedJpeg.length > 0) {
      const size = await jpegSize(card.maskedJpeg, width, height);
      if (!(width > 0)) width = size.width;
      if (!(height > 0)) height = size.height;
      writeFileSync(path.join(directory, "masked", `${id}.jpg`), card.maskedJpeg);
      const preview = await sharp(card.maskedJpeg).resize({ width: 300, withoutEnlargement: false }).jpeg().toBuffer();
      writeFileSync(path.join(directory, "masked-300", `${id}.jpg`), preview);
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
        hasSource: Boolean(card.sourceJpeg && card.sourceJpeg.length > 0),
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

  const results = originalIds.map((id) => ({
    cardId: id,
    passed: (measured.get(id)?.reasons.length ?? 1) === 0,
  }));
  const health = evaluatePoolHealth({
    originalCardIds: originalIds,
    results,
    engineeringMinimum: input.engineeringMinimum,
  });
  const profile = input.profile.explicit && input.profile.regions && input.profile.regions.length > 0 && input.profile.side
    ? input.profile
    : { explicit: false, profileId: null, side: null, regions: null };
  if (!profile.explicit && health.verdict === "pass") {
    health.verdict = "incomplete";
    health.releaseAuthorized = false;
    health.releasedCount = 0;
    health.releasedPassCount = 0;
  }
  const filesComplete = originalIds.every((id) => {
    const card = byId.get(id);
    return Boolean(card?.sourceJpeg?.length) && Boolean(card?.maskedJpeg?.length)
      && existsSync(path.join(directory, "source", `${id}.jpg`))
      && existsSync(path.join(directory, "masked", `${id}.jpg`))
      && existsSync(path.join(directory, "masked-300", `${id}.jpg`));
  });
  const ready = health.releaseAuthorized && profile.explicit && filesComplete && health.originalCount === originalIds.length;

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

  const coverIds = ready
    ? poolCards.filter((card) => card.proposedCover && (measured.get(card.heldId)?.reasons.length ?? 1) === 0).map((card) => card.heldId)
    : [];
  for (const id of coverIds) {
    const card = byId.get(id);
    if (card?.maskedJpeg) writeFileSync(path.join(directory, "covers", `${id}.jpg`), card.maskedJpeg);
  }
  writeFileSync(path.join(directory, "covers", "NOT_DAILY5.json"), JSON.stringify({
    dealDaily5: false,
    pinned: false,
    cardIds: coverIds,
  }, null, 2) + "\n");

  const manifestSha = createHash("sha256").update(readFileSync(manifestPath)).digest("hex");
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
    releaseAuthorized: health.releaseAuthorized,
    profileExplicit: profile.explicit,
    filesComplete,
    sourceFiles,
    maskedFiles,
    sourceHosts: [...hosts].sort(),
    dimensionsFromJpeg: true,
    manifestSha256: manifestSha,
    dealDaily5: false,
    pinnedCovers: false,
  };
  writeFileSync(path.join(directory, "reconciliation.json"), JSON.stringify(reconciliation, null, 2) + "\n");
  if (ready) {
    writeFileSync(path.join(directory, READY), JSON.stringify({
      setId: input.target.id,
      slug: input.target.slug,
      originalCount: health.originalCount,
      releasedCount: health.releasedCount,
      manifestSha256: manifestSha,
    }) + "\n");
  }
  return {
    slug: input.target.slug,
    directory,
    originalCount: health.originalCount,
    originalCardIds: originalIds,
    health,
    ready,
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
