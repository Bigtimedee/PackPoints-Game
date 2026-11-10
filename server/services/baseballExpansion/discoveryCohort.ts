/**
 * Pre-import discovery cohort for one held set.
 * The original member rows are the denominator. A later scan is a revision.
 * An extra supplier id is an addition and is not part of that rate.
 * No image URL is stored. Staging keeps a hash of bytes the caller already has.
 */
import { createHash } from "crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import sharp from "sharp";
import {
  discoveryAdditions,
  discoveryCohortMembers,
  designPoolSubmissions,
  discoveryCohorts,
  discoveryImportProvenance,
  discoverySourceRevisions,
  discoverySourceStaging,
  geometryProposals,
  playableCards,
} from "@shared/schema";
import { db } from "../../db";
import { fetchImportImage, isApprovedSupplierImageHost, isPrivateAddress } from "../images/approvedImageFetch";
import { isThirdPartyPhotoHost, THIRD_PARTY_PHOTO_REASON } from "../cards/imageQuality";

export { fetchImportImage };
import { holdReviewUnlocks } from "./memberReview";
import { isProtectedLogoMember, PROTECTED_LOGO_CODE } from "./protectedIdentity";
import { expansionTargetById, isMissingExpansionId } from "./registry";

/** Full discovery file for 1991 Upper Deck. The file is not in this repo. Checklist length stays 800. */
export const UD_1991_DISCOVERY = {
  setId: "cd597562-5b8f-5517-aca0-38b04f443747",
  originalCount: 486,
  artifactSha256: "11bf0c4dd539aa61663d8db11cd6794542258ef560c8e09517df5a406f972922",
  /** Digest of the 486 canonical member records. A matching label is not this digest. */
  membershipSha256: "336a18397f2b2a6b9d88d03860399e72da33b53084ad714d63affc18edef6207",
} as const;

/** The only geometry version the renderer and the health report will treat as measured. */
export const RECOGNIZED_GEOMETRY_VERSION = "plate-polygon-v1";

const SHA = /^[a-f0-9]{64}$/;
const MEMBER_KEY = /^candidate-\d{4}\|[a-f0-9]{64}$/;
const DISPOSITIONS = new Set(["pass-candidate", "hold", "drop"]);

/**
 * The discovery inventory names this class drop-proposal. The table check
 * stores drop. Both words are that one class, and neither word can be imported.
 */
export function storedDisposition(value: string): "pass-candidate" | "hold" | "drop" | null {
  if (value === "drop-proposal") return "drop";
  if (DISPOSITIONS.has(value)) return value as "pass-candidate" | "hold" | "drop";
  return null;
}
export const ORIGINAL_COHORT_PASS_RATE = 0.95;

export interface CohortMemberInput {
  memberKey: string;
  ordinal: number;
  cardNumber: string;
  supplierId: string;
  originalSha256: string;
  originalWidth: number;
  originalHeight: number;
  originalBytes: number;
  disposition: "pass-candidate" | "hold" | "drop";
  routing: string;
}

export function discoveryPin(setId: string): { originalCount: number; artifactSha256: string; membershipSha256: string } | null {
  if (setId.toLowerCase() !== UD_1991_DISCOVERY.setId) return null;
  return {
    originalCount: UD_1991_DISCOVERY.originalCount,
    artifactSha256: UD_1991_DISCOVERY.artifactSha256,
    membershipSha256: UD_1991_DISCOVERY.membershipSha256,
  };
}

/** One JSON array per member. Field boundaries cannot be forged with a delimiter. */
export function canonicalMemberRecord(member: CohortMemberInput): string {
  return JSON.stringify([
    member.ordinal,
    member.memberKey,
    member.cardNumber,
    member.supplierId,
    member.originalSha256,
    member.originalWidth,
    member.originalHeight,
    member.originalBytes,
    member.disposition,
    member.routing,
  ]);
}

export function canonicalCardNumber(raw: string, checklistCount: number): string | null {
  if (!/^\d{1,4}$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > checklistCount) return null;
  return String(n);
}

export function membershipSha256(members: readonly CohortMemberInput[]): string {
  const lines = [...members]
    .sort((a, b) => a.ordinal - b.ordinal || a.memberKey.localeCompare(b.memberKey))
    .map((member) => canonicalMemberRecord(member));
  return createHash("sha256").update(lines.join("\n")).digest("hex");
}

function cleanToken(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.length > max || /\s/.test(text) || text.includes("://") || text.includes("/")) return null;
  return text;
}

function cleanInt(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) return null;
  return value;
}

export function parseCohortMembers(raw: unknown, checklistCount: number): CohortMemberInput[] | null {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 2000) return null;
  const members: CohortMemberInput[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const row = item as Record<string, unknown>;
    const memberKey = cleanToken(row.memberKey, 90);
    const supplierId = cleanToken(row.supplierId, 80);
    const routing = cleanToken(row.routing, 80);
    const sha = cleanToken(row.originalSha256, 64);
    const cardNumberRaw = cleanToken(row.cardNumber, 4);
    const ordinal = cleanInt(row.ordinal, 1, 5000);
    const width = cleanInt(row.originalWidth, 1, 10000);
    const height = cleanInt(row.originalHeight, 1, 10000);
    const bytes = cleanInt(row.originalBytes, 1, 20_000_000);
    const dispositionRaw = cleanToken(row.disposition, 40);
    const disposition = dispositionRaw ? storedDisposition(dispositionRaw) : null;
    if (!memberKey || !MEMBER_KEY.test(memberKey) || !supplierId || !routing || !sha || !SHA.test(sha)) return null;
    const cardNumber = cardNumberRaw ? canonicalCardNumber(cardNumberRaw, checklistCount) : null;
    if (!cardNumber || ordinal == null || width == null || height == null || bytes == null) return null;
    if (!disposition) return null;
    if (memberKey.split("|")[1] !== sha) return null;
    const number = Number(cardNumber);
    if (number < 1 || number > checklistCount) return null;
    if (seen.has(memberKey) || seen.has(`s:${supplierId}`) || seen.has(`n:${cardNumber}`) || seen.has(`o:${ordinal}`)) return null;
    seen.add(memberKey); seen.add(`s:${supplierId}`); seen.add(`n:${cardNumber}`); seen.add(`o:${ordinal}`);
    members.push({
      memberKey, ordinal, cardNumber, supplierId, originalSha256: sha,
      originalWidth: width, originalHeight: height, originalBytes: bytes,
      disposition, routing,
    });
  }
  return members;
}

export interface CohortHealthMember {
  disposition: string;
  playableCardId: string | null;
  importedSha256: string | null;
  originalSha256: string;
  sourceAccepted: boolean;
  opaqueQaPassed: boolean;
  geometryMeasured: boolean;
  /** Bytes were staged. This is not a review pass. */
  staged: boolean;
}

/** A staged hash is not a pass. Held, dropped, unimported, and unmeasured members stay non-passes. */
export function evaluateCohortHealth(input: {
  members: readonly CohortHealthMember[];
  additions: number;
  requiredCount: number | null;
}) {
  const originalCount = input.members.length;
  let passCount = 0;
  let stagedDiscoveryCount = 0;
  for (const member of input.members) {
    if (member.staged) stagedDiscoveryCount += 1;
    const individualPass = member.disposition === "pass-candidate"
      && member.playableCardId != null
      && member.importedSha256 === member.originalSha256
      && member.sourceAccepted === true
      && member.opaqueQaPassed === true
      && member.geometryMeasured === true;
    if (individualPass) passCount += 1;
  }
  const partial = input.requiredCount != null && originalCount !== input.requiredCount;
  const originalRate = originalCount === 0 ? null : passCount / originalCount;
  const qualifying = !partial && originalRate != null && originalRate >= ORIGINAL_COHORT_PASS_RATE;
  return {
    originalCount,
    passCount,
    nonPassCount: originalCount - passCount,
    stagedDiscoveryCount,
    originalRate,
    additions: input.additions,
    additionsIncludedInRate: false as const,
    partial,
    qualifying,
    reviewReady: qualifying,
    releaseAuthorized: false as const,
    sourceValidated: false as const,
  };
}

export async function createDiscoveryCohort(input: {
  setId: string;
  artifactSha256: string;
  members: CohortMemberInput[];
}): Promise<{ ok: true; unchanged: boolean; originalCount: number; membershipSha256: string } | { ok: false; code: "not_held" | "partial_cohort" | "artifact_mismatch" | "membership_mismatch" | "legacy_membership_exists" }> {
  if (!isMissingExpansionId(input.setId)) return { ok: false, code: "not_held" };
  const target = expansionTargetById(input.setId);
  if (!target?.baseCount) return { ok: false, code: "not_held" };
  const pin = discoveryPin(input.setId);
  if (pin && input.members.length !== pin.originalCount) return { ok: false, code: "partial_cohort" };
  if (!SHA.test(input.artifactSha256)) return { ok: false, code: "artifact_mismatch" };
  const membershipHash = membershipSha256(input.members);
  if (pin && input.artifactSha256 !== pin.artifactSha256) return { ok: false, code: "artifact_mismatch" };
  if (pin && membershipHash !== pin.membershipSha256) return { ok: false, code: "membership_mismatch" };
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`set-membership:${input.setId}`}))`);
    const [legacy] = await tx.select({ setId: designPoolSubmissions.setId }).from(designPoolSubmissions).where(eq(designPoolSubmissions.setId, input.setId)).limit(1);
    if (legacy) return { ok: false, code: "legacy_membership_exists" };
    const [existing] = await tx.select().from(discoveryCohorts).where(eq(discoveryCohorts.setId, input.setId)).limit(1);
    if (existing) {
      if (existing.artifactSha256 === input.artifactSha256 && existing.membershipSha256 === membershipHash) {
        return { ok: true, unchanged: true, originalCount: existing.originalCount, membershipSha256: membershipHash };
      }
      return { ok: false, code: "membership_mismatch" };
    }
    await tx.insert(discoveryCohorts).values({
      setId: input.setId,
      artifactSha256: input.artifactSha256,
      membershipSha256: membershipHash,
      originalCount: input.members.length,
      checklistCount: target.baseCount!,
    });
    await tx.insert(discoveryCohortMembers).values(input.members.map((member) => ({
      ...member,
      setId: input.setId,
    })));
    return { ok: true, unchanged: false, originalCount: input.members.length, membershipSha256: membershipHash };
  });
}

export async function readDiscoveryCohort(setId: string) {
  const [cohort] = await db.select().from(discoveryCohorts).where(eq(discoveryCohorts.setId, setId)).limit(1);
  if (!cohort) return null;
  const members = await db.select().from(discoveryCohortMembers).where(eq(discoveryCohortMembers.setId, setId));
  const revisions = members.length === 0 ? [] : await db.select().from(discoverySourceRevisions).where(inArray(discoverySourceRevisions.memberKey, members.map((member) => member.memberKey)));
  const additions = await db.select().from(discoveryAdditions).where(eq(discoveryAdditions.setId, setId));
  const staging = await db.select().from(discoverySourceStaging).where(eq(discoverySourceStaging.setId, setId));
  const geometry = await db.select().from(geometryProposals).where(eq(geometryProposals.setId, setId));
  const revisionCount = new Map<string, number>();
  for (const revision of revisions) {
    if (!members.some((member) => member.memberKey === revision.memberKey)) continue;
    revisionCount.set(revision.memberKey, (revisionCount.get(revision.memberKey) ?? 0) + 1);
  }
  const staged = new Map(staging.map((row) => [row.supplierId, row]));
  const provenance = members.length === 0 ? [] : await db.select().from(discoveryImportProvenance).where(eq(discoveryImportProvenance.setId, setId));
  const byMember = new Map(provenance.map((row) => [row.memberKey, row]));
  const health = evaluateCohortHealth({
    members: members.map((member) => {
      const stage = staged.get(member.supplierId);
      const imported = byMember.get(member.memberKey);
      const stagedOk = !!stage && stage.sha256 === member.originalSha256 && stage.imageBytes.length === member.originalBytes;
      return {
        disposition: member.disposition,
        playableCardId: member.playableCardId,
        importedSha256: imported?.sha256 ?? null,
        originalSha256: member.originalSha256,
        sourceAccepted: imported?.sourceAccepted === true,
        opaqueQaPassed: imported?.opaqueQaPassed === true,
        geometryMeasured: geometry.some((row) => row.memberKey === member.memberKey && measuredProposal(row, member)),
        staged: stagedOk,
      };
    }),
    additions: additions.length,
    requiredCount: discoveryPin(setId)?.originalCount ?? null,
  });
  return {
    setId,
    artifactSha256: cohort.artifactSha256,
    membershipSha256: cohort.membershipSha256,
    checklistCount: cohort.checklistCount,
    releaseAuthorized: false as const,
    sourceValidated: false as const,
    members: members.map((member) => ({
      memberKey: member.memberKey,
      ordinal: member.ordinal,
      cardNumber: member.cardNumber,
      supplierId: member.supplierId,
      originalSha256: member.originalSha256,
      originalWidth: member.originalWidth,
      originalHeight: member.originalHeight,
      originalBytes: member.originalBytes,
      disposition: member.disposition,
      routing: member.routing,
      playableCardId: member.playableCardId,
      revisions: revisionCount.get(member.memberKey) ?? 0,
    })),
    health,
  };
}

function finitePair(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2 && value.every((part) => typeof part === "number" && Number.isFinite(part));
}

/** One predicate for registration, the health report, and the renderer. */
export function measuredProposal(
  proposal: { geometryVersion: string | null; polygonPixels: number[][] | null; polygonNormalized: number[][] | null; sourceSha256: string; width: number; height: number; supplierId: string; setId: string },
  member: { originalSha256: string; originalWidth: number; originalHeight: number; supplierId: string; setId: string },
): boolean {
  if (proposal.setId !== member.setId || proposal.supplierId !== member.supplierId) return false;
  if (proposal.sourceSha256 !== member.originalSha256) return false;
  if (proposal.width !== member.originalWidth || proposal.height !== member.originalHeight) return false;
  if (proposal.geometryVersion !== RECOGNIZED_GEOMETRY_VERSION) return false;
  const pixels = proposal.polygonPixels;
  const normalized = proposal.polygonNormalized;
  if (!pixels || !normalized || pixels.length < 3 || pixels.length !== normalized.length) return false;
  if (!pixels.every(finitePair) || !normalized.every(finitePair)) return false;
  let area = 0;
  for (let i = 0; i < pixels.length; i += 1) {
    const [x, y] = pixels[i]!;
    const [nx, ny] = normalized[i]!;
    const next = pixels[(i + 1) % pixels.length]!;
    if (x < 0 || y < 0 || x > proposal.width || y > proposal.height) return false;
    if (nx < 0 || ny < 0 || nx > 1 || ny > 1) return false;
    if (Math.abs(x / proposal.width - nx) > 0.02 || Math.abs(y / proposal.height - ny) > 0.02) return false;
    area += x * next[1] - next[0] * y;
  }
  return Math.abs(area) > 1;
}

function validSha(value: string): boolean {
  return SHA.test(value);
}

export async function appendSourceRevision(input: {
  setId: string;
  memberKey: string;
  sha256: string;
  width: number;
  height: number;
  bytes: number;
  parentSha256: string;
}): Promise<{ ok: true; revision: number; unchanged: boolean; replacedOriginal: false; importEffect: "none" } | { ok: false; code: "invalid_revision" | "unknown_member" | "parent_mismatch" | "revision_conflict" }> {
  if (!validSha(input.sha256) || !validSha(input.parentSha256) || input.width < 1 || input.height < 1 || input.bytes < 1 || input.width > 10000 || input.height > 10000 || input.bytes > 20_000_000) {
    return { ok: false, code: "invalid_revision" };
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`revision:${input.memberKey}`}))`);
    const [member] = await tx.select().from(discoveryCohortMembers).where(and(
      eq(discoveryCohortMembers.memberKey, input.memberKey),
      eq(discoveryCohortMembers.setId, input.setId),
    )).limit(1);
    if (!member) return { ok: false, code: "unknown_member" };
    const prior = await tx.select().from(discoverySourceRevisions).where(eq(discoverySourceRevisions.memberKey, input.memberKey));
    const same = prior.find((row) => row.sha256 === input.sha256);
    if (same) {
      if (same.parentSha256 === input.parentSha256 && same.width === input.width && same.height === input.height && same.bytes === input.bytes) {
        return { ok: true, revision: same.revision, unchanged: true, replacedOriginal: false, importEffect: "none" };
      }
      return { ok: false, code: "revision_conflict" };
    }
    const latest = prior.sort((a, b) => a.revision - b.revision).at(-1);
    const parent = latest?.sha256 ?? member.originalSha256;
    if (input.parentSha256 !== parent) return { ok: false, code: "parent_mismatch" };
    if (input.sha256 === member.originalSha256) return { ok: false, code: "revision_conflict" };
    const revision = (latest?.revision ?? 0) + 1;
    await tx.insert(discoverySourceRevisions).values({
      memberKey: input.memberKey, revision, sha256: input.sha256, width: input.width, height: input.height, bytes: input.bytes, parentSha256: input.parentSha256,
    });
    return { ok: true, revision, unchanged: false, replacedOriginal: false, importEffect: "none" };
  });
}

export async function recordDiscoveryAddition(input: {
  setId: string;
  supplierId: string;
  cardNumber: string;
  sha256: string;
  width: number;
  height: number;
  bytes: number;
}): Promise<{ ok: true; unchanged: boolean; countsTowardOriginal: false } | { ok: false; code: "invalid_addition" | "number_claimed" | "already_member" | "no_cohort" | "addition_conflict" | "supplier_conflict" }> {
  if (!validSha(input.sha256) || !/^\d{1,4}$/.test(input.cardNumber) || input.width < 1 || input.height < 1 || input.bytes < 1) {
    return { ok: false, code: "invalid_addition" };
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`addition:${input.setId}`}))`);
    const [cohort] = await tx.select({ setId: discoveryCohorts.setId, checklistCount: discoveryCohorts.checklistCount }).from(discoveryCohorts).where(eq(discoveryCohorts.setId, input.setId)).limit(1);
    if (!cohort) return { ok: false, code: "no_cohort" };
    const number = canonicalCardNumber(input.cardNumber, cohort.checklistCount);
    if (!number) return { ok: false, code: "invalid_addition" };
    const members = await tx.select({ supplierId: discoveryCohortMembers.supplierId, cardNumber: discoveryCohortMembers.cardNumber })
      .from(discoveryCohortMembers).where(eq(discoveryCohortMembers.setId, input.setId));
    if (members.some((member) => member.supplierId === input.supplierId)) return { ok: false, code: "already_member" };
    if (members.some((member) => String(Number(member.cardNumber)) === number)) return { ok: false, code: "number_claimed" };
    const prior = await tx.select().from(discoveryAdditions).where(eq(discoveryAdditions.setId, input.setId));
    const same = prior.find((row) => row.supplierId === input.supplierId);
    if (same) {
      if (same.cardNumber === number && same.sha256 === input.sha256 && same.width === input.width && same.height === input.height && same.bytes === input.bytes) {
        return { ok: true, unchanged: true, countsTowardOriginal: false };
      }
      return { ok: false, code: same.cardNumber === number ? "addition_conflict" : "supplier_conflict" };
    }
    if (prior.some((row) => String(Number(row.cardNumber)) === number) || members.some((member) => String(Number(member.cardNumber)) === number)) {
      return { ok: false, code: "number_claimed" };
    }
    input = { ...input, cardNumber: number };
    await tx.insert(discoveryAdditions).values(input);
    return { ok: true, unchanged: false, countsTowardOriginal: false };
  });
}

export async function stageExactSource(setId: string, supplierId: string, bytes: Buffer): Promise<
  { ok: true; sha256: string; importable: false } | { ok: false; code: "unregistered_source" | "source_drift" | "not_importable" | typeof PROTECTED_LOGO_CODE }
> {
  const [member] = await db.select().from(discoveryCohortMembers).where(and(
    eq(discoveryCohortMembers.setId, setId),
    eq(discoveryCohortMembers.supplierId, supplierId),
  )).limit(1);
  if (!member) return { ok: false, code: "unregistered_source" };
  if (isProtectedLogoMember(member)) return { ok: false, code: PROTECTED_LOGO_CODE };
  if (member.disposition !== "pass-candidate" && !await holdReviewUnlocks(member)) return { ok: false, code: "not_importable" };
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  let width = 0;
  let height = 0;
  try {
    const meta = await sharp(bytes).metadata();
    width = meta.width ?? 0;
    height = meta.height ?? 0;
  } catch {
    return { ok: false, code: "source_drift" };
  }
  if (sha256 !== member.originalSha256 || width !== member.originalWidth || height !== member.originalHeight || bytes.length !== member.originalBytes) {
    return { ok: false, code: "source_drift" };
  }
  await db.insert(discoverySourceStaging).values({
    setId, supplierId, sha256, width, height, bytes: bytes.length, imageBytes: bytes,
  }).onConflictDoUpdate({
    target: [discoverySourceStaging.setId, discoverySourceStaging.supplierId],
    set: { sha256, width, height, bytes: bytes.length, imageBytes: bytes, stagedAt: new Date() },
  });
  return { ok: true, sha256, importable: false };
}

/** Allowlisted https pointer. This does not download the URL. */
export function supplierImagePointer(value: string): string | null {
  let parsed: URL;
  try { parsed = new URL(value); } catch { return null; }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
  const host = parsed.hostname.toLowerCase();
  if (!isApprovedSupplierImageHost(host) || isPrivateAddress(host)) return null;
  if (value.length > 500 || /\s/.test(value)) return null;
  return parsed.toString();
}

/**
 * Insert the staged bytes that already match the member hash.
 * A live supplier body is not read. A different encoding of the same pixels
 * stays source_drift on the download path and is not written here.
 */
export async function importBoundStagedSource(input: {
  setId: string;
  supplierId: string;
  imageUrl: string;
  player: string;
  variant?: string | null;
  category?: string | null;
}): Promise<{ ok: true; id: string; unchanged: boolean; sha256: string } | { ok: false; code: string }> {
  if (input.setId.trim().toLowerCase() === UD_1991_DISCOVERY.setId) return { ok: false, code: "ud_stopped" };
  if (!isMissingExpansionId(input.setId)) return { ok: false, code: "not_expansion" };
  const pointer = supplierImagePointer(input.imageUrl);
  const player = input.player.trim();
  if (!pointer || player.length < 1 || player.length > 120 || player.includes("://")) return { ok: false, code: "evidence_required" };
  const [member] = await db.select().from(discoveryCohortMembers).where(and(
    eq(discoveryCohortMembers.setId, input.setId),
    eq(discoveryCohortMembers.supplierId, input.supplierId),
  )).limit(1);
  if (!member) return { ok: false, code: "unregistered_source" };
  if (isProtectedLogoMember(member)) return { ok: false, code: PROTECTED_LOGO_CODE };
  if (member.disposition !== "pass-candidate" && !await holdReviewUnlocks(member)) return { ok: false, code: "not_importable" };
  const [stage] = await db.select().from(discoverySourceStaging).where(and(
    eq(discoverySourceStaging.setId, input.setId),
    eq(discoverySourceStaging.supplierId, input.supplierId),
  )).limit(1);
  const bytes = stage?.imageBytes ? asBuffer(stage.imageBytes) : null;
  if (!stage || !bytes) return { ok: false, code: "source_not_staged" };
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== member.originalSha256 || sha256 !== stage.sha256 || bytes.length !== member.originalBytes || stage.width !== member.originalWidth || stage.height !== member.originalHeight || stage.bytes !== member.originalBytes) {
    return { ok: false, code: "source_drift" };
  }
  const saved = await insertGuardedPlayable({
    setId: input.setId,
    supplierId: input.supplierId,
    cardNumber: member.cardNumber,
    downloaded: bytes,
    values: {
      description: null,
      player,
      set: null,
      number: member.cardNumber,
      variant: input.variant ?? "Base",
      imageUrl: pointer,
      category: input.category ?? "Baseball",
      rookie: null,
      isPlayable: !isThirdPartyPhotoHost(pointer),
      blockedReason: isThirdPartyPhotoHost(pointer) ? THIRD_PARTY_PHOTO_REASON : null,
    },
  });
  if (!saved.ok) return saved;
  return { ...saved, sha256 };
}

export async function loadExactSourceGate(setId: string): Promise<(supplierId: string, cardNumber: string | null) => string | null> {
  const [cohort] = await db.select({ setId: discoveryCohorts.setId }).from(discoveryCohorts).where(eq(discoveryCohorts.setId, setId)).limit(1);
  if (!cohort) {
    if (isMissingExpansionId(setId)) return () => "exact_source_required";
    return () => null;
  }
  const members = await db.select().from(discoveryCohortMembers).where(eq(discoveryCohortMembers.setId, setId));
  const staging = await db.select().from(discoverySourceStaging).where(eq(discoverySourceStaging.setId, setId));
  const unlocked = new Set<string>();
  for (const member of members) {
    if (await holdReviewUnlocks(member)) unlocked.add(member.memberKey);
  }
  const bySupplier = new Map(members.map((member) => [member.supplierId, member]));
  const staged = new Map(staging.map((row) => [row.supplierId, row]));
  return (supplierId, cardNumber) => {
    const member = bySupplier.get(supplierId);
    if (!member) return "unregistered_source";
    if (isProtectedLogoMember(member)) return PROTECTED_LOGO_CODE;
    if (member.disposition !== "pass-candidate" && !unlocked.has(member.memberKey)) return "not_importable";
    if (cardNumber && member.cardNumber !== cardNumber) return "number_mismatch";
    const stage = staged.get(supplierId);
    if (!stage || !stage.imageBytes) return "source_not_staged";
    if (stage.sha256 !== member.originalSha256 || stage.width !== member.originalWidth || stage.height !== member.originalHeight || stage.bytes !== member.originalBytes) {
      return "source_drift";
    }
    return null;
  };
}

/** Download the current supplier bytes and require them to equal the staged image. A revision row does not authorize this. */
export async function verifyImportBytes(setId: string, supplierId: string, cardNumber: string | null, downloaded: Buffer | null): Promise<
  { ok: true; memberKey: string; sha256: string } | { ok: false; code: "exact_source_required" | "unregistered_source" | "not_importable" | "number_mismatch" | "source_not_staged" | "source_drift" | typeof PROTECTED_LOGO_CODE }
> {
  const gate = await loadExactSourceGate(setId);
  const reason = gate(supplierId, cardNumber);
  if (reason) return { ok: false, code: reason as "exact_source_required" | "unregistered_source" | "not_importable" | "number_mismatch" | "source_not_staged" | "source_drift" | typeof PROTECTED_LOGO_CODE };
  const [stage] = await db.select().from(discoverySourceStaging).where(and(
    eq(discoverySourceStaging.setId, setId),
    eq(discoverySourceStaging.supplierId, supplierId),
  )).limit(1);
  if (!stage?.imageBytes || !downloaded || !stage.imageBytes.equals(downloaded)) return { ok: false, code: "source_drift" };
  const sha256 = createHash("sha256").update(downloaded).digest("hex");
  if (sha256 !== stage.sha256) return { ok: false, code: "source_drift" };
  const [member] = await db.select({ memberKey: discoveryCohortMembers.memberKey }).from(discoveryCohortMembers).where(and(
    eq(discoveryCohortMembers.setId, setId),
    eq(discoveryCohortMembers.supplierId, supplierId),
  )).limit(1);
  if (!member) return { ok: false, code: "unregistered_source" };
  return { ok: true, memberKey: member.memberKey, sha256 };
}

export type BoundSourceState =
  | { kind: "legacy" }
  | { kind: "bound"; bytes: Buffer; sha256: string }
  | { kind: "refused" };

function asBuffer(value: Buffer | Uint8Array): Buffer {
  return Buffer.isBuffer(value) ? value : Buffer.from(value);
}

/** Legacy cards have no cohort. A cohort card with a missing or mismatched bind is refused, not fetched. */
const CARD_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function readBoundSourceState(cardId: string): Promise<BoundSourceState> {
  if (!CARD_UUID.test(cardId)) return { kind: "legacy" };
  const [card] = await db.select({
    gameSetId: playableCards.gameSetId,
    cardhedgeCardId: playableCards.cardhedgeCardId,
  }).from(playableCards).where(eq(playableCards.id, cardId)).limit(1);
  if (!card?.gameSetId) return { kind: "legacy" };
  const [cohort] = await db.select({ setId: discoveryCohorts.setId }).from(discoveryCohorts).where(eq(discoveryCohorts.setId, card.gameSetId)).limit(1);
  if (!cohort) return { kind: "legacy" };
  const [prov] = await db.select().from(discoveryImportProvenance).where(eq(discoveryImportProvenance.playableCardId, cardId)).limit(1);
  if (!prov || prov.supplierId !== card.cardhedgeCardId) return { kind: "refused" };
  const [member] = await db.select().from(discoveryCohortMembers).where(eq(discoveryCohortMembers.memberKey, prov.memberKey)).limit(1);
  if (member && isProtectedLogoMember(member)) return { kind: "refused" };
  const [stage] = await db.select().from(discoverySourceStaging).where(and(
    eq(discoverySourceStaging.setId, prov.setId),
    eq(discoverySourceStaging.supplierId, prov.supplierId),
  )).limit(1);
  if (!stage?.imageBytes) return { kind: "refused" };
  const bytes = asBuffer(stage.imageBytes);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== prov.sha256 || sha256 !== stage.sha256) return { kind: "refused" };
  return { kind: "bound", bytes, sha256 };
}

export async function insertGuardedPlayable(input: {
  setId: string;
  supplierId: string;
  cardNumber: string | null;
  downloaded: Buffer | null;
  values: {
    description: string | null;
    player: string;
    set: string | null;
    number: string | null;
    variant: string | null;
    imageUrl: string;
    category: string | null;
    rookie: boolean | null;
    isPlayable: boolean;
    blockedReason: string | null;
  };
  failBeforeProvenance?: boolean;
}): Promise<{ ok: true; id: string; unchanged: boolean } | { ok: false; code: string }> {
  const verdict = await verifyImportBytes(input.setId, input.supplierId, input.cardNumber, input.downloaded);
  if (!verdict.ok || !input.downloaded) return { ok: false, code: verdict.ok ? "source_drift" : verdict.code };
  const sha256 = verdict.sha256;
  try {
    return await db.transaction(async (tx) => {
      const [existing] = await tx.select({ id: playableCards.id }).from(playableCards).where(eq(playableCards.cardhedgeCardId, input.supplierId)).limit(1);
      if (existing) {
        const [prov] = await tx.select().from(discoveryImportProvenance).where(eq(discoveryImportProvenance.playableCardId, existing.id)).limit(1);
        if (prov?.sha256 === sha256) return { ok: true, id: existing.id, unchanged: true };
        if (!prov) {
          await tx.update(discoveryCohortMembers).set({ playableCardId: existing.id }).where(eq(discoveryCohortMembers.memberKey, verdict.memberKey));
          await tx.insert(discoveryImportProvenance).values({
            playableCardId: existing.id, setId: input.setId, memberKey: verdict.memberKey, supplierId: input.supplierId,
            sha256, byteLength: input.downloaded!.length, sourceAccepted: false, opaqueQaPassed: false,
          });
          return { ok: true, id: existing.id, unchanged: false };
        }
        return { ok: false, code: "source_drift" };
      }
      const [row] = await tx.insert(playableCards).values({
        gameSetId: input.setId,
        cardhedgeCardId: input.supplierId,
        ...input.values,
      }).returning({ id: playableCards.id });
      if (!row) return { ok: false, code: "source_drift" };
      if (input.failBeforeProvenance) throw new Error("injected-bind-failure");
      await tx.update(discoveryCohortMembers).set({ playableCardId: row.id }).where(eq(discoveryCohortMembers.memberKey, verdict.memberKey));
      await tx.insert(discoveryImportProvenance).values({
        playableCardId: row.id, setId: input.setId, memberKey: verdict.memberKey, supplierId: input.supplierId,
        sha256, byteLength: input.downloaded!.length, sourceAccepted: false, opaqueQaPassed: false,
      });
      return { ok: true, id: row.id, unchanged: false };
    });
  } catch (error) {
    if (error instanceof Error && error.message === "injected-bind-failure") throw error;
    return { ok: false, code: "source_drift" };
  }
}

export async function cohortGuardsImport(setId: string): Promise<boolean> {
  if (isMissingExpansionId(setId)) return true;
  const [cohort] = await db.select({ setId: discoveryCohorts.setId }).from(discoveryCohorts).where(eq(discoveryCohorts.setId, setId)).limit(1);
  return Boolean(cohort);
}

export interface GeometryProposalInput {
  setId: string;
  memberKey: string;
  supplierId: string;
  sourceSha256: string;
  width: number;
  height: number;
  geometryVersion: string | null;
  polygonPixels: number[][] | null;
  polygonNormalized: number[][] | null;
}

export function geometryUsable(input: GeometryProposalInput, member: { originalSha256: string; originalWidth: number; originalHeight: number; supplierId: string; setId: string }): { ok: true } | { ok: false; code: "wrong_hash" | "wrong_dimensions" | "wrong_supplier" | "unmeasured" | "unknown_version" } {
  if (input.supplierId !== member.supplierId || input.setId !== member.setId) return { ok: false, code: "wrong_supplier" };
  if (input.sourceSha256 !== member.originalSha256) return { ok: false, code: "wrong_hash" };
  if (input.width !== member.originalWidth || input.height !== member.originalHeight) return { ok: false, code: "wrong_dimensions" };
  if (input.geometryVersion !== RECOGNIZED_GEOMETRY_VERSION) return { ok: false, code: "unknown_version" };
  if (!measuredProposal({ ...input, polygonPixels: input.polygonPixels, polygonNormalized: input.polygonNormalized }, member)) return { ok: false, code: "unmeasured" };
  return { ok: true };
}

export async function registerGeometryProposal(input: GeometryProposalInput): Promise<{ ok: true; id: string; approval: false; usable: boolean } | { ok: false; code: "unknown_member" | "wrong_hash" | "wrong_dimensions" | "wrong_supplier" | "unknown_version" | "unmeasured" }> {
  const [member] = await db.select().from(discoveryCohortMembers).where(and(
    eq(discoveryCohortMembers.memberKey, input.memberKey),
    eq(discoveryCohortMembers.setId, input.setId),
  )).limit(1);
  if (!member) return { ok: false, code: "unknown_member" };
  if (input.supplierId !== member.supplierId) return { ok: false, code: "wrong_supplier" };
  if (input.sourceSha256 !== member.originalSha256) return { ok: false, code: "wrong_hash" };
  if (input.width !== member.originalWidth || input.height !== member.originalHeight) return { ok: false, code: "wrong_dimensions" };
  const unmeasuredRecord = input.geometryVersion == null && input.polygonPixels == null && input.polygonNormalized == null;
  if (!unmeasuredRecord) {
    const usable = geometryUsable(input, member);
    if (!usable.ok) return usable;
  }
  const [row] = await db.insert(geometryProposals).values({
    setId: input.setId,
    memberKey: input.memberKey,
    supplierId: input.supplierId,
    sourceSha256: input.sourceSha256,
    width: input.width,
    height: input.height,
    geometryVersion: input.geometryVersion,
    polygonPixels: input.polygonPixels,
    polygonNormalized: input.polygonNormalized,
    approval: false,
  }).returning({ id: geometryProposals.id });
  return { ok: true, id: row!.id, approval: false, usable: !unmeasuredRecord };
}

export interface ListedGeometryProposal {
  id: string;
  memberKey: string;
  supplierId: string;
  sourceSha256: string;
  width: number;
  height: number;
  geometryVersion: string | null;
  polygonPixels: number[][] | null;
  polygonNormalized: number[][] | null;
  usable: boolean;
  approval: false;
  createdAt: string;
}

/** Read the ids already stored. This does not approve a profile or clear a set. */
export async function listGeometryProposals(setId: string, memberKey?: string): Promise<
  { ok: true; releaseAuthorized: false; approval: false; proposals: ListedGeometryProposal[] }
  | { ok: false; code: "ud_stopped" | "not_expansion" }
> {
  if (setId.trim().toLowerCase() === UD_1991_DISCOVERY.setId) return { ok: false, code: "ud_stopped" };
  if (!isMissingExpansionId(setId)) return { ok: false, code: "not_expansion" };
  const members = await db.select().from(discoveryCohortMembers).where(eq(discoveryCohortMembers.setId, setId));
  const byKey = new Map(members.map((member) => [member.memberKey, member]));
  const rows = await db.select().from(geometryProposals).where(memberKey
    ? and(eq(geometryProposals.setId, setId), eq(geometryProposals.memberKey, memberKey))
    : eq(geometryProposals.setId, setId),
  ).orderBy(geometryProposals.createdAt);
  return {
    ok: true,
    releaseAuthorized: false,
    approval: false,
    proposals: rows.map((row) => {
      const member = byKey.get(row.memberKey);
      const usable = member ? measuredProposal({
        setId: row.setId,
        supplierId: row.supplierId,
        sourceSha256: row.sourceSha256,
        width: row.width,
        height: row.height,
        geometryVersion: row.geometryVersion,
        polygonPixels: row.polygonPixels,
        polygonNormalized: row.polygonNormalized,
      }, member) : false;
      return {
        id: row.id,
        memberKey: row.memberKey,
        supplierId: row.supplierId,
        sourceSha256: row.sourceSha256,
        width: row.width,
        height: row.height,
        geometryVersion: row.geometryVersion,
        polygonPixels: row.polygonPixels,
        polygonNormalized: row.polygonNormalized,
        usable,
        approval: false,
        createdAt: row.createdAt.toISOString(),
      };
    }),
  };
}

async function compositeOpaquePlate(jpeg: Buffer, polygon: readonly (readonly number[])[]): Promise<{ native: Buffer; maskedPreview: Buffer; originalPreview: Buffer }> {
  const meta = await sharp(jpeg).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const points = polygon.map((pair) => `${pair[0]},${pair[1]}`).join(" ");
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><polygon points="${points}" fill="#c4a574"/></svg>`;
  const native = await sharp(jpeg).composite([{ input: Buffer.from(svg) }]).jpeg().toBuffer();
  const maskedPreview = await sharp(native).resize({ width: 300, withoutEnlargement: true }).jpeg().toBuffer();
  const originalPreview = await sharp(jpeg).resize({ width: 300, withoutEnlargement: true }).jpeg().toBuffer();
  return { native, maskedPreview, originalPreview };
}

/** The only render entry. The raw compositor stays private. */
export async function renderMeasuredProposal(input: {
  jpeg: Buffer;
  proposal: GeometryProposalInput;
  member: { originalSha256: string; originalWidth: number; originalHeight: number; supplierId: string; setId: string };
}): Promise<{ ok: true; native: Buffer; maskedPreview: Buffer; originalPreview: Buffer; approval: false } | { ok: false; code: "wrong_hash" | "wrong_dimensions" | "wrong_supplier" | "unmeasured" | "unknown_version" }> {
  const sha256 = createHash("sha256").update(input.jpeg).digest("hex");
  if (sha256 !== input.proposal.sourceSha256 || sha256 !== input.member.originalSha256) return { ok: false, code: "wrong_hash" };
  const meta = await sharp(input.jpeg).metadata();
  if (meta.width !== input.proposal.width || meta.height !== input.proposal.height || meta.width !== input.member.originalWidth || meta.height !== input.member.originalHeight) {
    return { ok: false, code: "wrong_dimensions" };
  }
  const gate = geometryUsable(input.proposal, input.member);
  if (!gate.ok) return gate;
  const drawn = await compositeOpaquePlate(input.jpeg, input.proposal.polygonPixels ?? []);
  return { ok: true, ...drawn, approval: false };
}
