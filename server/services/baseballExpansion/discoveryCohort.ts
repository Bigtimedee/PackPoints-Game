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
  discoveryImportProvenance,
  discoverySourceRevisions,
  discoverySourceStaging,
  geometryProposals,
} from "@shared/schema";
import { db } from "../../db";
import { withSourceFetchTimeout } from "../images/sourceFetch";
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
}): Promise<{ ok: true; unchanged: boolean; originalCount: number; membershipSha256: string } | { ok: false; code: "not_held" | "partial_cohort" | "artifact_mismatch" | "membership_mismatch" }> {
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
}): Promise<{ ok: true; unchanged: boolean; countsTowardOriginal: false } | { ok: false; code: "invalid_addition" | "number_claimed" | "already_member" | "no_cohort" }> {
  if (!validSha(input.sha256) || !/^\d{1,4}$/.test(input.cardNumber) || input.width < 1 || input.height < 1 || input.bytes < 1) {
    return { ok: false, code: "invalid_addition" };
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`addition:${input.setId}`}))`);
    const [cohort] = await tx.select({ setId: discoveryCohorts.setId }).from(discoveryCohorts).where(eq(discoveryCohorts.setId, input.setId)).limit(1);
    if (!cohort) return { ok: false, code: "no_cohort" };
    const members = await tx.select({ supplierId: discoveryCohortMembers.supplierId, cardNumber: discoveryCohortMembers.cardNumber })
      .from(discoveryCohortMembers).where(eq(discoveryCohortMembers.setId, input.setId));
    if (members.some((member) => member.supplierId === input.supplierId)) return { ok: false, code: "already_member" };
    if (members.some((member) => member.cardNumber === input.cardNumber)) return { ok: false, code: "number_claimed" };
    const prior = await tx.select().from(discoveryAdditions).where(eq(discoveryAdditions.setId, input.setId));
    const same = prior.find((row) => row.supplierId === input.supplierId);
    if (same && same.cardNumber === input.cardNumber && same.sha256 === input.sha256) return { ok: true, unchanged: true, countsTowardOriginal: false };
    if (prior.some((row) => row.cardNumber === input.cardNumber)) return { ok: false, code: "number_claimed" };
    await tx.insert(discoveryAdditions).values(input);
    return { ok: true, unchanged: false, countsTowardOriginal: false };
  });
}

export async function stageExactSource(setId: string, supplierId: string, bytes: Buffer): Promise<
  { ok: true; sha256: string; importable: false } | { ok: false; code: "unregistered_source" | "source_drift" | "not_importable" }
> {
  const [member] = await db.select().from(discoveryCohortMembers).where(and(
    eq(discoveryCohortMembers.setId, setId),
    eq(discoveryCohortMembers.supplierId, supplierId),
  )).limit(1);
  if (!member) return { ok: false, code: "unregistered_source" };
  if (member.disposition !== "pass-candidate") return { ok: false, code: "not_importable" };
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
    if (member.disposition !== "pass-candidate") return "not_importable";
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
  { ok: true; memberKey: string; sha256: string } | { ok: false; code: "exact_source_required" | "unregistered_source" | "not_importable" | "number_mismatch" | "source_not_staged" | "source_drift" }
> {
  const gate = await loadExactSourceGate(setId);
  const reason = gate(supplierId, cardNumber);
  if (reason) return { ok: false, code: reason as "exact_source_required" | "unregistered_source" | "not_importable" | "number_mismatch" | "source_not_staged" | "source_drift" };
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

export async function bindImportedCard(input: { setId: string; memberKey: string; supplierId: string; playableCardId: string; sha256: string; byteLength: number }): Promise<void> {
  await db.update(discoveryCohortMembers).set({ playableCardId: input.playableCardId }).where(and(
    eq(discoveryCohortMembers.memberKey, input.memberKey),
    eq(discoveryCohortMembers.setId, input.setId),
  ));
  await db.insert(discoveryImportProvenance).values({
    playableCardId: input.playableCardId,
    setId: input.setId,
    memberKey: input.memberKey,
    supplierId: input.supplierId,
    sha256: input.sha256,
    byteLength: input.byteLength,
    sourceAccepted: false,
    opaqueQaPassed: false,
  }).onConflictDoNothing();
}

export async function readBoundSourceBytes(cardId: string): Promise<Buffer | null> {
  const [row] = await db.select({ supplierId: discoveryImportProvenance.supplierId, setId: discoveryImportProvenance.setId, sha256: discoveryImportProvenance.sha256 })
    .from(discoveryImportProvenance).where(eq(discoveryImportProvenance.playableCardId, cardId)).limit(1);
  if (!row) return null;
  const [stage] = await db.select({ imageBytes: discoverySourceStaging.imageBytes, sha256: discoverySourceStaging.sha256 }).from(discoverySourceStaging).where(and(
    eq(discoverySourceStaging.setId, row.setId),
    eq(discoverySourceStaging.supplierId, row.supplierId),
  )).limit(1);
  if (!stage || stage.sha256 !== row.sha256) return null;
  return stage.imageBytes;
}

export async function fetchImportImage(url: string): Promise<Buffer | null> {
  if (!url.startsWith("https://")) return null;
  let host = "";
  try { host = new URL(url).hostname.toLowerCase(); } catch { return null; }
  if (host === "localhost" || host.endsWith(".local") || host === "127.0.0.1" || host === "::1") return null;
  try {
    return await withSourceFetchTimeout(async (signal) => {
      const response = await fetch(url, { signal, redirect: "manual", headers: { "User-Agent": "PackPTS/1.0" } });
      if (!response.ok || response.status >= 300) return null;
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length < 1 || bytes.length > 2_000_000) return null;
      return bytes;
    }, 10_000);
  } catch {
    return null;
  }
}

export async function cohortGuardsImport(setId: string): Promise<boolean> {
  if (setId.toLowerCase() === UD_1991_DISCOVERY.setId) return true;
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

export async function registerGeometryProposal(input: GeometryProposalInput): Promise<{ ok: true; approval: false; usable: boolean } | { ok: false; code: "unknown_member" | "wrong_hash" | "wrong_dimensions" | "wrong_supplier" | "unknown_version" | "unmeasured" }> {
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
  return { ok: true, approval: false, usable: !unmeasuredRecord };
}

/** Opaque fill of the supplied polygon only. The rest of the image is unchanged. */
export async function renderOpaqueNameplate(jpeg: Buffer, polygon: readonly (readonly number[])[]): Promise<{ native: Buffer; maskedPreview: Buffer; originalPreview: Buffer }> {
  const meta = await sharp(jpeg).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (width < 1 || height < 1 || polygon.length < 3 || !polygon.every((pair) => pair.length === 2 && pair.every((part) => Number.isFinite(part)))) throw new Error("unmeasured");
  const points = polygon.map((pair) => `${pair[0]},${pair[1]}`).join(" ");
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><polygon points="${points}" fill="#c4a574"/></svg>`;
  const native = await sharp(jpeg).composite([{ input: Buffer.from(svg) }]).jpeg().toBuffer();
  const maskedPreview = await sharp(native).resize({ width: 300, withoutEnlargement: true }).jpeg().toBuffer();
  const originalPreview = await sharp(jpeg).resize({ width: 300, withoutEnlargement: true }).jpeg().toBuffer();
  return { native, maskedPreview, originalPreview };
}
