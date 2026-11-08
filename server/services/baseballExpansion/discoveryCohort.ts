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
  discoveryCohorts,
  discoverySourceRevisions,
  discoverySourceStaging,
  geometryProposals,
} from "@shared/schema";
import { db } from "../../db";
import { expansionTargetById, isMissingExpansionId } from "./registry";

/** Full discovery file for 1991 Upper Deck. The file is not in this repo. Checklist length stays 800. */
export const UD_1991_DISCOVERY = {
  setId: "cd597562-5b8f-5517-aca0-38b04f443747",
  originalCount: 486,
  artifactSha256: "11bf0c4dd539aa61663d8db11cd6794542258ef560c8e09517df5a406f972922",
} as const;

const SHA = /^[a-f0-9]{64}$/;
const MEMBER_KEY = /^candidate-\d{4}\|[a-f0-9]{64}$/;
const DISPOSITIONS = new Set(["pass-candidate", "hold", "drop"]);
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

export function discoveryPin(setId: string): { originalCount: number; artifactSha256: string } | null {
  if (setId.toLowerCase() !== UD_1991_DISCOVERY.setId) return null;
  return { originalCount: UD_1991_DISCOVERY.originalCount, artifactSha256: UD_1991_DISCOVERY.artifactSha256 };
}

export function membershipSha256(members: readonly CohortMemberInput[]): string {
  const lines = [...members]
    .sort((a, b) => a.ordinal - b.ordinal || a.memberKey.localeCompare(b.memberKey))
    .map((member) => [
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
    ].join("|"));
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
    const cardNumber = cleanToken(row.cardNumber, 4);
    const ordinal = cleanInt(row.ordinal, 1, 5000);
    const width = cleanInt(row.originalWidth, 1, 10000);
    const height = cleanInt(row.originalHeight, 1, 10000);
    const bytes = cleanInt(row.originalBytes, 1, 20_000_000);
    const disposition = cleanToken(row.disposition, 40);
    if (!memberKey || !MEMBER_KEY.test(memberKey) || !supplierId || !routing || !sha || !SHA.test(sha)) return null;
    if (!cardNumber || !/^\d{1,4}$/.test(cardNumber) || ordinal == null || width == null || height == null || bytes == null) return null;
    if (!disposition || !DISPOSITIONS.has(disposition)) return null;
    if (memberKey.split("|")[1] !== sha) return null;
    const number = Number(cardNumber);
    if (number < 1 || number > checklistCount) return null;
    if (seen.has(memberKey) || seen.has(`s:${supplierId}`) || seen.has(`n:${cardNumber}`) || seen.has(`o:${ordinal}`)) return null;
    seen.add(memberKey); seen.add(`s:${supplierId}`); seen.add(`n:${cardNumber}`); seen.add(`o:${ordinal}`);
    members.push({
      memberKey, ordinal, cardNumber, supplierId, originalSha256: sha,
      originalWidth: width, originalHeight: height, originalBytes: bytes,
      disposition: disposition as CohortMemberInput["disposition"], routing,
    });
  }
  return members;
}

export function evaluateCohortHealth(input: {
  members: readonly { disposition: string; sourceVerified: boolean; geometryMeasured: boolean }[];
  additions: number;
  requiredCount: number | null;
}) {
  const originalCount = input.members.length;
  let passCount = 0;
  let geometryReady = 0;
  for (const member of input.members) {
    const sourcePass = member.disposition === "pass-candidate" && member.sourceVerified;
    if (sourcePass) passCount += 1;
    if (sourcePass && member.geometryMeasured) geometryReady += 1;
  }
  const partial = input.requiredCount != null && originalCount !== input.requiredCount;
  const originalRate = originalCount === 0 ? null : passCount / originalCount;
  const qualifying = !partial && originalRate != null && originalRate >= ORIGINAL_COHORT_PASS_RATE && passCount === originalCount;
  return {
    originalCount,
    passCount,
    nonPassCount: originalCount - passCount,
    originalRate: qualifying || originalRate == null ? originalRate : originalRate,
    additions: input.additions,
    additionsIncludedInRate: false as const,
    partial,
    qualifying,
    reviewReady: qualifying && geometryReady === passCount && passCount === originalCount && originalCount > 0,
    releaseAuthorized: false as const,
    sourceValidated: false as const,
  };
}

export async function createDiscoveryCohort(input: {
  setId: string;
  artifactSha256: string;
  members: CohortMemberInput[];
}): Promise<{ ok: true; unchanged: boolean; originalCount: number; membershipSha256: string } | { ok: false; code: "not_held" | "partial_cohort" | "artifact_mismatch" | "membership_mismatch" }> {
  if (!isMissingExpansionId(input.setId)) return { ok: false, code: "not_held" };
  const target = expansionTargetById(input.setId);
  if (!target?.baseCount) return { ok: false, code: "not_held" };
  const pin = discoveryPin(input.setId);
  if (pin && input.members.length !== pin.originalCount) return { ok: false, code: "partial_cohort" };
  if (pin && input.artifactSha256 !== pin.artifactSha256) return { ok: false, code: "artifact_mismatch" };
  if (!SHA.test(input.artifactSha256)) return { ok: false, code: "artifact_mismatch" };
  const membershipHash = membershipSha256(input.members);
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`discovery:${input.setId}`}))`);
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
  const measured = new Set(geometry.filter((row) => proposalMeasured(row)).map((row) => row.memberKey));
  const health = evaluateCohortHealth({
    members: members.map((member) => {
      const stage = staged.get(member.supplierId);
      const sourceVerified = !!stage && stage.sha256 === member.originalSha256 && stage.width === member.originalWidth && stage.height === member.originalHeight && stage.bytes === member.originalBytes;
      return { disposition: member.disposition, sourceVerified, geometryMeasured: measured.has(member.memberKey) };
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

function proposalMeasured(row: { geometryVersion: string | null; polygonPixels: number[][] | null; sourceSha256: string; width: number; height: number; memberKey: string }): boolean {
  return Boolean(row.geometryVersion && row.polygonPixels && row.polygonPixels.length >= 3);
}

export async function appendSourceRevision(input: {
  setId: string;
  memberKey: string;
  sha256: string;
  width: number;
  height: number;
  bytes: number;
  parentSha256: string;
}): Promise<{ ok: true; revision: number; replacedOriginal: false } | { ok: false; code: "unknown_member" | "parent_mismatch" | "same_bytes" }> {
  const [member] = await db.select().from(discoveryCohortMembers).where(and(
    eq(discoveryCohortMembers.memberKey, input.memberKey),
    eq(discoveryCohortMembers.setId, input.setId),
  )).limit(1);
  if (!member) return { ok: false, code: "unknown_member" };
  const prior = await db.select().from(discoverySourceRevisions).where(eq(discoverySourceRevisions.memberKey, input.memberKey));
  const latest = prior.sort((a, b) => a.revision - b.revision).at(-1);
  const parent = latest?.sha256 ?? member.originalSha256;
  if (input.parentSha256 !== parent) return { ok: false, code: "parent_mismatch" };
  if (input.sha256 === member.originalSha256 || prior.some((row) => row.sha256 === input.sha256)) return { ok: false, code: "same_bytes" };
  const revision = (latest?.revision ?? 0) + 1;
  await db.insert(discoverySourceRevisions).values({
    memberKey: input.memberKey,
    revision,
    sha256: input.sha256,
    width: input.width,
    height: input.height,
    bytes: input.bytes,
    parentSha256: input.parentSha256,
  });
  return { ok: true, revision, replacedOriginal: false };
}

export async function recordDiscoveryAddition(input: {
  setId: string;
  supplierId: string;
  cardNumber: string;
  sha256: string;
  width: number;
  height: number;
  bytes: number;
}): Promise<{ ok: true; countsTowardOriginal: false } | { ok: false; code: "number_claimed" | "already_member" | "no_cohort" }> {
  const [cohort] = await db.select({ setId: discoveryCohorts.setId }).from(discoveryCohorts).where(eq(discoveryCohorts.setId, input.setId)).limit(1);
  if (!cohort) return { ok: false, code: "no_cohort" };
  const members = await db.select({ supplierId: discoveryCohortMembers.supplierId, cardNumber: discoveryCohortMembers.cardNumber })
    .from(discoveryCohortMembers).where(eq(discoveryCohortMembers.setId, input.setId));
  if (members.some((member) => member.supplierId === input.supplierId)) return { ok: false, code: "already_member" };
  if (members.some((member) => member.cardNumber === input.cardNumber)) return { ok: false, code: "number_claimed" };
  await db.insert(discoveryAdditions).values(input);
  return { ok: true, countsTowardOriginal: false };
}

export async function stageExactSource(setId: string, supplierId: string, bytes: Buffer): Promise<
  { ok: true; sha256: string } | { ok: false; code: "unregistered_source" | "source_drift" }
> {
  const [member] = await db.select().from(discoveryCohortMembers).where(and(
    eq(discoveryCohortMembers.setId, setId),
    eq(discoveryCohortMembers.supplierId, supplierId),
  )).limit(1);
  if (!member) return { ok: false, code: "unregistered_source" };
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
    setId, supplierId, sha256, width, height, bytes: bytes.length,
  }).onConflictDoNothing();
  return { ok: true, sha256 };
}

export async function loadExactSourceGate(setId: string): Promise<(supplierId: string, cardNumber: string | null) => string | null> {
  const [cohort] = await db.select({ setId: discoveryCohorts.setId }).from(discoveryCohorts).where(eq(discoveryCohorts.setId, setId)).limit(1);
  if (!cohort) {
    if (setId.toLowerCase() === UD_1991_DISCOVERY.setId) return () => "exact_source_required";
    return () => null;
  }
  const members = await db.select().from(discoveryCohortMembers).where(eq(discoveryCohortMembers.setId, setId));
  const staging = await db.select().from(discoverySourceStaging).where(eq(discoverySourceStaging.setId, setId));
  const bySupplier = new Map(members.map((member) => [member.supplierId, member]));
  const staged = new Map(staging.map((row) => [row.supplierId, row]));
  return (supplierId, cardNumber) => {
    const member = bySupplier.get(supplierId);
    if (!member) return "unregistered_source";
    if (cardNumber && member.cardNumber !== cardNumber) return "number_mismatch";
    const stage = staged.get(supplierId);
    if (!stage) return "source_not_staged";
    if (stage.sha256 !== member.originalSha256 || stage.width !== member.originalWidth || stage.height !== member.originalHeight || stage.bytes !== member.originalBytes) {
      return "source_drift";
    }
    return null;
  };
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
  if (!input.polygonPixels || input.polygonPixels.length < 3 || !input.polygonNormalized || input.polygonNormalized.length < 3) return { ok: false, code: "unmeasured" };
  if (!input.geometryVersion) return { ok: false, code: "unknown_version" };
  return { ok: true };
}

export async function registerGeometryProposal(input: GeometryProposalInput): Promise<{ ok: true; approval: false; usable: boolean } | { ok: false; code: "unknown_member" | "wrong_hash" | "wrong_dimensions" | "wrong_supplier" }> {
  const [member] = await db.select().from(discoveryCohortMembers).where(and(
    eq(discoveryCohortMembers.memberKey, input.memberKey),
    eq(discoveryCohortMembers.setId, input.setId),
  )).limit(1);
  if (!member) return { ok: false, code: "unknown_member" };
  if (input.supplierId !== member.supplierId) return { ok: false, code: "wrong_supplier" };
  if (input.sourceSha256 !== member.originalSha256) return { ok: false, code: "wrong_hash" };
  if (input.width !== member.originalWidth || input.height !== member.originalHeight) return { ok: false, code: "wrong_dimensions" };
  await db.insert(geometryProposals).values({
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
  });
  const usable = geometryUsable(input, member).ok === true;
  return { ok: true, approval: false, usable };
}

/** Opaque fill of the supplied polygon only. The rest of the image is unchanged. */
export async function renderOpaqueNameplate(jpeg: Buffer, polygon: readonly (readonly number[])[]): Promise<{ native: Buffer; maskedPreview: Buffer; originalPreview: Buffer }> {
  const meta = await sharp(jpeg).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (width < 1 || height < 1 || polygon.length < 3) throw new Error("unmeasured");
  const points = polygon.map((pair) => `${pair[0]},${pair[1]}`).join(" ");
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><polygon points="${points}" fill="#c4a574"/></svg>`;
  const native = await sharp(jpeg).composite([{ input: Buffer.from(svg) }]).jpeg().toBuffer();
  const maskedPreview = await sharp(native).resize({ width: 300, withoutEnlargement: true }).jpeg().toBuffer();
  const originalPreview = await sharp(jpeg).resize({ width: 300, withoutEnlargement: true }).jpeg().toBuffer();
  return { native, maskedPreview, originalPreview };
}
