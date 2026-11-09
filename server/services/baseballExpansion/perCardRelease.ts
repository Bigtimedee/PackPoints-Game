/**
 * Per-card release records for a missing expansion set.
 *
 * Source acceptance, exact-output approval, per-card serve clearance, and the
 * set manifest are separate writes. A render or a card count does not create
 * them. Dave's release rule is an explicit manifest of at least 35 fully
 * approved playable cards. Every other card stays held. The discovery
 * inventory is not a 95% release denominator and is not rewritten.
 *
 * 1991 Upper Deck is refused on every transition. Live sets never enter.
 */
import { createHash } from "crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../../db";
import {
  discoveryCohortMembers,
  discoveryCohorts,
  discoveryImportProvenance,
  discoverySourceStaging,
  gameSets,
  expansionOutputApprovals,
  expansionReleaseManifests,
  expansionReleaseMembers,
  expansionServeClearances,
  expansionSetClearanceAttempts,
  expansionSourceAcceptances,
  geometryProposals,
  playableCards,
} from "@shared/schema";
import { isMissingExpansionId } from "./registry";
import {
  measuredProposal,
  RECOGNIZED_GEOMETRY_VERSION,
  UD_1991_DISCOVERY,
} from "./discoveryCohort";

/** Expansion release floor. This does not change the public shelf floor of 5. */
export const EXPANSION_RELEASE_MIN_ELIGIBLE = 35;

/**
 * Compositor identity. e8eb93fc is the file that rendered the held samples.
 * 069e08e8 is the same compositeOpaquePlate after the import-gate predicate
 * widened. Any other blob, including a later compositor edit, fails closed.
 */
export const PER_CARD_RENDERER_IDS = [
  "renderMeasuredProposal@e8eb93fc37c87af1009074dd30615b0315812594",
  "renderMeasuredProposal@069e08e8391b1781005930a21ec524e4e5f2ba2b",
] as const;

const RENDERER_IDS = new Set<string>(PER_CARD_RENDERER_IDS);
const OUTPUT_IMAGE_MAX_BYTES = 2_000_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Dave, Nov 9 2026, 10:36 AM CST. Discovery-wide 95% is not this gate. */
export const EXPANSION_RELEASE_POLICY = {
  statement: "Release each set with at least 35 fully approved playable cards; keep all other cards held.",
  discoveryRateRequired: false as const,
  releasedMemberPassRate: 1 as const,
  minimumReleased: EXPANSION_RELEASE_MIN_ELIGIBLE,
  retainedDiscoveryExample: { label: "1986 Fleer recorded candidate inventory", count: 448 },
};

export type ReleaseRefusal =
  | "ud_stopped"
  | "not_expansion"
  | "evidence_required"
  | "not_importable"
  | "member_mismatch"
  | "set_mismatch"
  | "source_drift"
  | "acceptance_conflict"
  | "source_unaccepted"
  | "proposal_mismatch"
  | "polygon_rejected"
  | "renderer_mismatch"
  | "output_hash_mismatch"
  | "output_conflict"
  | "output_unapproved"
  | "serve_unbound"
  | "serve_conflict"
  | "card_unbound"
  | "below_expansion_minimum"
  | "membership_mismatch"
  | "release_version_mismatch"
  | "release_already_active"
  | "not_released"
  | "release_revoked";

type Recorded = { ok: true; id: string; unchanged: boolean };
type Refused = { ok: false; code: ReleaseRefusal };

function sha256Bytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function canonicalPolygon(pixels: readonly (readonly number[])[]): string {
  return JSON.stringify(pixels);
}

function actor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text.length < 1 || text.length > 80 || text.includes("://") || text.includes("/")) return null;
  return text;
}

function evidence(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text.length < 8 || text.length > 160 || text.includes("://") || /\s/.test(text)) return null;
  return text;
}

function asBuffer(value: unknown): Buffer | null {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  return null;
}

function scope(setId: string): "stopped" | "expansion" | "live" {
  if (setId.trim().toLowerCase() === UD_1991_DISCOVERY.setId) return "stopped";
  if (isMissingExpansionId(setId)) return "expansion";
  return "live";
}

async function memberByKey(memberKey: string) {
  const [member] = await db.select().from(discoveryCohortMembers).where(eq(discoveryCohortMembers.memberKey, memberKey)).limit(1);
  return member ?? null;
}

export async function recordSourceAcceptance(input: {
  setId: string;
  memberKey: string;
  sourceSha256: string;
  evidenceRef: string;
  acceptedBy: string;
}): Promise<Recorded | Refused> {
  const proof = evidence(input.evidenceRef);
  const who = actor(input.acceptedBy);
  if (!proof || !who) return { ok: false, code: "evidence_required" };
  if (scope(input.setId) === "stopped") return { ok: false, code: "ud_stopped" };
  if (scope(input.setId) !== "expansion") return { ok: false, code: "not_expansion" };
  const member = await memberByKey(input.memberKey);
  if (!member) return { ok: false, code: "member_mismatch" };
  if (member.setId !== input.setId) return { ok: false, code: "set_mismatch" };
  if (member.disposition !== "pass-candidate") return { ok: false, code: "not_importable" };
  const [staged] = await db.select().from(discoverySourceStaging).where(and(
    eq(discoverySourceStaging.setId, input.setId),
    eq(discoverySourceStaging.supplierId, member.supplierId),
  )).limit(1);
  const stagedBytes = staged ? asBuffer(staged.imageBytes) : null;
  if (!staged || !stagedBytes || sha256Bytes(stagedBytes) !== member.originalSha256 || staged.sha256 !== member.originalSha256) {
    return { ok: false, code: "source_drift" };
  }
  if (input.sourceSha256 !== member.originalSha256 || staged.width !== member.originalWidth || staged.height !== member.originalHeight || staged.bytes !== member.originalBytes) {
    return { ok: false, code: "source_drift" };
  }
  const [existing] = await db.select().from(expansionSourceAcceptances).where(eq(expansionSourceAcceptances.memberKey, member.memberKey)).limit(1);
  if (existing) {
    if (existing.sourceSha256 === member.originalSha256 && existing.evidenceRef === proof && existing.acceptedBy === who) {
      return { ok: true, id: existing.id, unchanged: true };
    }
    return { ok: false, code: "acceptance_conflict" };
  }
  const [row] = await db.insert(expansionSourceAcceptances).values({
    setId: input.setId,
    memberKey: member.memberKey,
    sourceSha256: member.originalSha256,
    evidenceRef: proof,
    acceptedBy: who,
  }).returning({ id: expansionSourceAcceptances.id });
  return { ok: true, id: row!.id, unchanged: false };
}

export async function recordOutputApproval(input: {
  setId: string;
  memberKey: string;
  acceptanceId: string;
  proposalId: string;
  polygonPixels: number[][];
  polygonNormalized: number[][];
  rendererId: string;
  nativeBytes: Buffer;
  preview300Bytes: Buffer;
  nativeSha256: string;
  preview300Sha256: string;
  evidenceRef: string;
  approvedBy: string;
}): Promise<Recorded | Refused> {
  const proof = evidence(input.evidenceRef);
  const who = actor(input.approvedBy);
  if (!proof || !who) return { ok: false, code: "evidence_required" };
  if (scope(input.setId) === "stopped") return { ok: false, code: "ud_stopped" };
  if (scope(input.setId) !== "expansion") return { ok: false, code: "not_expansion" };
  const member = await memberByKey(input.memberKey);
  if (!member) return { ok: false, code: "member_mismatch" };
  if (member.setId !== input.setId) return { ok: false, code: "set_mismatch" };
  if (member.disposition !== "pass-candidate") return { ok: false, code: "not_importable" };
  const [acceptance] = await db.select().from(expansionSourceAcceptances).where(eq(expansionSourceAcceptances.id, input.acceptanceId)).limit(1);
  if (!acceptance || acceptance.memberKey !== member.memberKey || acceptance.setId !== input.setId || acceptance.sourceSha256 !== member.originalSha256) {
    return { ok: false, code: "source_unaccepted" };
  }
  const [proposal] = await db.select().from(geometryProposals).where(eq(geometryProposals.id, input.proposalId)).limit(1);
  if (!proposal || proposal.memberKey !== member.memberKey || proposal.setId !== input.setId || proposal.sourceSha256 !== member.originalSha256) {
    return { ok: false, code: "proposal_mismatch" };
  }
  const pixels = input.polygonPixels;
  const normalized = input.polygonNormalized;
  if (canonicalPolygon(proposal.polygonPixels ?? []) !== canonicalPolygon(pixels) || canonicalPolygon(proposal.polygonNormalized ?? []) !== canonicalPolygon(normalized)) {
    return { ok: false, code: "proposal_mismatch" };
  }
  if (!RENDERER_IDS.has(input.rendererId)) return { ok: false, code: "renderer_mismatch" };
  const usable = measuredProposal({
    setId: input.setId,
    supplierId: member.supplierId,
    sourceSha256: member.originalSha256,
    width: member.originalWidth,
    height: member.originalHeight,
    geometryVersion: RECOGNIZED_GEOMETRY_VERSION,
    polygonPixels: pixels,
    polygonNormalized: normalized,
  }, member);
  if (!usable || proposal.geometryVersion !== RECOGNIZED_GEOMETRY_VERSION) return { ok: false, code: "polygon_rejected" };
  if (input.nativeBytes.length < 1 || input.preview300Bytes.length < 1 || input.nativeBytes.length > OUTPUT_IMAGE_MAX_BYTES || input.preview300Bytes.length > OUTPUT_IMAGE_MAX_BYTES) {
    return { ok: false, code: "output_hash_mismatch" };
  }
  const nativeSha = sha256Bytes(input.nativeBytes);
  const previewSha = sha256Bytes(input.preview300Bytes);
  if (nativeSha !== input.nativeSha256 || previewSha !== input.preview300Sha256) return { ok: false, code: "output_hash_mismatch" };
  const polygonSha = sha256Bytes(Buffer.from(canonicalPolygon(pixels)));
  const [existing] = await db.select().from(expansionOutputApprovals).where(eq(expansionOutputApprovals.memberKey, member.memberKey)).limit(1);
  if (existing) {
    const same = existing.nativeSha256 === nativeSha && existing.preview300Sha256 === previewSha && existing.rendererId === input.rendererId && existing.polygonSha256 === polygonSha && existing.proposalId === proposal.id;
    if (same) return { ok: true, id: existing.id, unchanged: true };
    return { ok: false, code: "output_conflict" };
  }
  const [row] = await db.insert(expansionOutputApprovals).values({
    setId: input.setId,
    memberKey: member.memberKey,
    acceptanceId: acceptance.id,
    proposalId: proposal.id,
    sourceSha256: member.originalSha256,
    polygonCanonical: canonicalPolygon(pixels),
    polygonSha256: polygonSha,
    geometryVersion: RECOGNIZED_GEOMETRY_VERSION,
    rendererId: input.rendererId,
    nativeSha256: nativeSha,
    preview300Sha256: previewSha,
    nativeBytes: input.nativeBytes,
    preview300Bytes: input.preview300Bytes,
    evidenceRef: proof,
    approvedBy: who,
  }).returning({ id: expansionOutputApprovals.id });
  return { ok: true, id: row!.id, unchanged: false };
}

export async function recordServeClearance(input: {
  setId: string;
  memberKey: string;
  outputApprovalId: string;
  evidenceRef: string;
  clearedBy: string;
}): Promise<Recorded | Refused> {
  const proof = evidence(input.evidenceRef);
  const who = actor(input.clearedBy);
  if (!proof || !who) return { ok: false, code: "evidence_required" };
  if (scope(input.setId) === "stopped") return { ok: false, code: "ud_stopped" };
  if (scope(input.setId) !== "expansion") return { ok: false, code: "not_expansion" };
  const member = await memberByKey(input.memberKey);
  if (!member) return { ok: false, code: "member_mismatch" };
  if (member.setId !== input.setId) return { ok: false, code: "set_mismatch" };
  if (member.disposition !== "pass-candidate") return { ok: false, code: "not_importable" };
  const [output] = await db.select().from(expansionOutputApprovals).where(eq(expansionOutputApprovals.id, input.outputApprovalId)).limit(1);
  if (!output || output.memberKey !== member.memberKey || output.setId !== input.setId) return { ok: false, code: "output_unapproved" };
  const native = asBuffer(output.nativeBytes);
  const preview = asBuffer(output.preview300Bytes);
  if (!native || !preview || sha256Bytes(native) !== output.nativeSha256 || sha256Bytes(preview) !== output.preview300Sha256) {
    return { ok: false, code: "output_hash_mismatch" };
  }
  if (!RENDERER_IDS.has(output.rendererId) || output.sourceSha256 !== member.originalSha256) return { ok: false, code: "renderer_mismatch" };
  const [existing] = await db.select().from(expansionServeClearances).where(eq(expansionServeClearances.memberKey, member.memberKey)).limit(1);
  if (existing) {
    if (existing.outputApprovalId === output.id && existing.evidenceRef === proof) return { ok: true, id: existing.id, unchanged: true };
    return { ok: false, code: "serve_conflict" };
  }
  const [row] = await db.insert(expansionServeClearances).values({
    setId: input.setId,
    memberKey: member.memberKey,
    outputApprovalId: output.id,
    evidenceRef: proof,
    clearedBy: who,
  }).returning({ id: expansionServeClearances.id });
  return { ok: true, id: row!.id, unchanged: false };
}

function bindingCode(input: {
  member: typeof discoveryCohortMembers.$inferSelect;
  playable: typeof playableCards.$inferSelect | null;
  provenance: typeof discoveryImportProvenance.$inferSelect | null;
  acceptance: typeof expansionSourceAcceptances.$inferSelect | null;
  output: typeof expansionOutputApprovals.$inferSelect | null;
  serve: typeof expansionServeClearances.$inferSelect | null;
}): ReleaseRefusal | null {
  const { member, playable, provenance, acceptance, output, serve } = input;
  if (member.disposition !== "pass-candidate") return "not_importable";
  if (!playable || playable.gameSetId !== member.setId || playable.isPlayable !== true || !playable.imageUrl?.startsWith("https://")) return "card_unbound";
  if (!provenance || provenance.playableCardId !== playable.id || provenance.sha256 !== member.originalSha256 || provenance.memberKey !== member.memberKey) return "card_unbound";
  if (!acceptance || acceptance.sourceSha256 !== member.originalSha256 || acceptance.memberKey !== member.memberKey) return "source_unaccepted";
  if (!output || output.memberKey !== member.memberKey || output.sourceSha256 !== member.originalSha256 || output.acceptanceId !== acceptance.id) return "output_unapproved";
  if (!RENDERER_IDS.has(output.rendererId) || output.geometryVersion !== RECOGNIZED_GEOMETRY_VERSION) return "renderer_mismatch";
  const native = asBuffer(output.nativeBytes);
  const preview = asBuffer(output.preview300Bytes);
  if (!native || !preview || sha256Bytes(native) !== output.nativeSha256 || sha256Bytes(preview) !== output.preview300Sha256) return "output_hash_mismatch";
  if (sha256Bytes(Buffer.from(output.polygonCanonical)) !== output.polygonSha256) return "polygon_rejected";
  let pixels: number[][] | null = null;
  try { pixels = JSON.parse(output.polygonCanonical) as number[][]; } catch { pixels = null; }
  if (!pixels || !measuredProposal({
    setId: member.setId,
    supplierId: member.supplierId,
    sourceSha256: member.originalSha256,
    width: member.originalWidth,
    height: member.originalHeight,
    geometryVersion: output.geometryVersion,
    polygonPixels: pixels,
    polygonNormalized: pixels.map(([x, y]) => [x / member.originalWidth, y / member.originalHeight]),
  }, member)) return "polygon_rejected";
  if (!serve || serve.outputApprovalId !== output.id || serve.memberKey !== member.memberKey) return "serve_unbound";
  return null;
}

async function boundRows(setId: string) {
  return db.select({
    member: discoveryCohortMembers,
    playable: playableCards,
    provenance: discoveryImportProvenance,
    acceptance: expansionSourceAcceptances,
    output: expansionOutputApprovals,
    serve: expansionServeClearances,
  }).from(discoveryCohortMembers)
    .leftJoin(playableCards, eq(playableCards.id, discoveryCohortMembers.playableCardId))
    .leftJoin(discoveryImportProvenance, eq(discoveryImportProvenance.memberKey, discoveryCohortMembers.memberKey))
    .leftJoin(expansionSourceAcceptances, eq(expansionSourceAcceptances.memberKey, discoveryCohortMembers.memberKey))
    .leftJoin(expansionOutputApprovals, eq(expansionOutputApprovals.memberKey, discoveryCohortMembers.memberKey))
    .leftJoin(expansionServeClearances, eq(expansionServeClearances.memberKey, discoveryCohortMembers.memberKey))
    .where(eq(discoveryCohortMembers.setId, setId));
}

export async function countExpansionGameplayEligible(setId: string): Promise<number> {
  if (scope(setId) !== "expansion") return 0;
  const rows = await boundRows(setId);
  return rows.filter((row) => bindingCode(row) == null).length;
}

export async function inspectBoundServe(cardId: string): Promise<{ kind: "bound_held"; bytes: Buffer } | { kind: "refused"; code: ReleaseRefusal }> {
  if (!UUID.test(cardId)) return { kind: "refused", code: "card_unbound" };
  const [card] = await db.select().from(playableCards).where(eq(playableCards.id, cardId)).limit(1);
  if (!card?.gameSetId) return { kind: "refused", code: "card_unbound" };
  if (scope(card.gameSetId) === "stopped") return { kind: "refused", code: "ud_stopped" };
  if (scope(card.gameSetId) !== "expansion") return { kind: "refused", code: "not_expansion" };
  const [provenance] = await db.select().from(discoveryImportProvenance).where(eq(discoveryImportProvenance.playableCardId, cardId)).limit(1);
  if (!provenance) return { kind: "refused", code: "card_unbound" };
  const member = await memberByKey(provenance.memberKey);
  if (member && member.setId !== card.gameSetId) return { kind: "refused", code: "set_mismatch" };
  if (!member) return { kind: "refused", code: "member_mismatch" };
  const [acceptance] = await db.select().from(expansionSourceAcceptances).where(eq(expansionSourceAcceptances.memberKey, member.memberKey)).limit(1);
  const [output] = await db.select().from(expansionOutputApprovals).where(eq(expansionOutputApprovals.memberKey, member.memberKey)).limit(1);
  const [serve] = await db.select().from(expansionServeClearances).where(eq(expansionServeClearances.memberKey, member.memberKey)).limit(1);
  const code = bindingCode({ member, playable: card, provenance, acceptance: acceptance ?? null, output: output ?? null, serve: serve ?? null });
  if (code) return { kind: "refused", code };
  return { kind: "bound_held", bytes: asBuffer(output!.nativeBytes)! };
}

export async function expansionSetIsCleared(setId: string): Promise<boolean> {
  const [row] = await db.select({ id: expansionReleaseManifests.id }).from(expansionReleaseManifests).where(and(
    eq(expansionReleaseManifests.setId, setId),
    isNull(expansionReleaseManifests.revokedAt),
  )).limit(1);
  return Boolean(row);
}

export async function activeExpansionReleaseSetIds(): Promise<string[]> {
  const rows = await db.select({ setId: expansionReleaseManifests.setId }).from(expansionReleaseManifests).where(isNull(expansionReleaseManifests.revokedAt));
  return rows.map((row) => row.setId);
}

export function applyExpansionServe(input: {
  scope: "live" | "expansion" | "stopped";
  boundBytes: Buffer | null;
  refuseCode: ReleaseRefusal | null;
  releasedMember: boolean;
}): { action: "passthrough" } | { action: "refuse"; code: string } | { action: "serve"; bytes: Buffer } {
  if (input.scope === "live") return { action: "passthrough" };
  if (input.scope === "stopped") return { action: "refuse", code: "ud_stopped" };
  if (!input.boundBytes || input.refuseCode) return { action: "refuse", code: input.refuseCode ?? "card_unbound" };
  if (!input.releasedMember) return { action: "refuse", code: "not_released" };
  return { action: "serve", bytes: input.boundBytes };
}

export async function expansionServeFacts(cardId: string): Promise<{
  scope: "live" | "expansion" | "stopped";
  boundBytes: Buffer | null;
  refuseCode: ReleaseRefusal | null;
  releasedMember: boolean;
}> {
  if (!UUID.test(cardId)) return { scope: "live", boundBytes: null, refuseCode: null, releasedMember: false };
  const [card] = await db.select({ gameSetId: playableCards.gameSetId }).from(playableCards).where(eq(playableCards.id, cardId)).limit(1);
  if (!card?.gameSetId || scope(card.gameSetId) === "live") return { scope: "live", boundBytes: null, refuseCode: null, releasedMember: false };
  if (scope(card.gameSetId) === "stopped") return { scope: "stopped", boundBytes: null, refuseCode: "ud_stopped", releasedMember: false };
  const inspected = await inspectBoundServe(cardId);
  if (inspected.kind === "refused") return { scope: "expansion", boundBytes: null, refuseCode: inspected.code, releasedMember: false };
  const releasedMember = await releasedMemberBytes(cardId, inspected.bytes);
  if (!releasedMember) return { scope: "expansion", boundBytes: null, refuseCode: "not_released", releasedMember: false };
  return { scope: "expansion", boundBytes: inspected.bytes, refuseCode: null, releasedMember: true };
}

async function releasedMemberBytes(cardId: string, bytes: Buffer): Promise<boolean> {
  const [row] = await db.select({
    nativeSha256: expansionReleaseMembers.nativeSha256,
    preview300Sha256: expansionReleaseMembers.preview300Sha256,
    polygonSha256: expansionReleaseMembers.polygonSha256,
    rendererId: expansionReleaseMembers.rendererId,
    sourceSha256: expansionReleaseMembers.sourceSha256,
  }).from(expansionReleaseMembers)
    .innerJoin(expansionReleaseManifests, eq(expansionReleaseManifests.id, expansionReleaseMembers.manifestId))
    .innerJoin(discoveryCohortMembers, eq(discoveryCohortMembers.memberKey, expansionReleaseMembers.memberKey))
    .where(and(
      eq(discoveryCohortMembers.playableCardId, cardId),
      isNull(expansionReleaseManifests.revokedAt),
    )).limit(1);
  if (!row || !RENDERER_IDS.has(row.rendererId)) return false;
  return sha256Bytes(bytes) === row.nativeSha256;
}

function releasedListSha(memberKeys: readonly string[]): string {
  return sha256Bytes(Buffer.from([...memberKeys].sort().join("\n")));
}

async function writeClearanceAttempt(input: {
  setId: string;
  eligibleCount: number;
  discoveryCount: number;
  code: string;
  evidenceRef: string;
  attemptedBy: string;
}): Promise<void> {
  const [game] = await db.select({ id: gameSets.id }).from(gameSets).where(eq(gameSets.id, input.setId)).limit(1);
  if (!game) return;
  await db.insert(expansionSetClearanceAttempts).values(input);
}

export async function recordExpansionRelease(input: {
  setId: string;
  memberKeys: readonly string[];
  version: number;
  evidenceRef: string;
  clearedBy: string;
  discoveryMembershipSha256: string;
}): Promise<{ ok: true; manifestId: string; version: number; memberCount: number; releasedMembershipSha256: string } | { ok: false; code: ReleaseRefusal; eligibleCount: number; discoveryCount: number }> {
  const proof = evidence(input.evidenceRef);
  const who = actor(input.clearedBy);
  if (!proof || !who) return { ok: false, code: "evidence_required", eligibleCount: 0, discoveryCount: 0 };
  if (scope(input.setId) === "stopped") return { ok: false, code: "ud_stopped", eligibleCount: 0, discoveryCount: 0 };
  if (scope(input.setId) !== "expansion") return { ok: false, code: "not_expansion", eligibleCount: 0, discoveryCount: 0 };
  const [cohort] = await db.select().from(discoveryCohorts).where(eq(discoveryCohorts.setId, input.setId)).limit(1);
  const discoveryCount = cohort?.originalCount ?? 0;
  const unique = [...new Set(input.memberKeys)];
  if (unique.length !== input.memberKeys.length || unique.length < EXPANSION_RELEASE_MIN_ELIGIBLE) {
    await writeClearanceAttempt({ setId: input.setId, eligibleCount: unique.length, discoveryCount, code: "below_expansion_minimum", evidenceRef: proof, attemptedBy: who });
    return { ok: false, code: "below_expansion_minimum", eligibleCount: unique.length, discoveryCount };
  }
  if (!cohort || input.discoveryMembershipSha256 !== cohort.membershipSha256) {
    await writeClearanceAttempt({ setId: input.setId, eligibleCount: unique.length, discoveryCount, code: "membership_mismatch", evidenceRef: proof, attemptedBy: who });
    return { ok: false, code: "membership_mismatch", eligibleCount: unique.length, discoveryCount };
  }
  const [active] = await db.select({ id: expansionReleaseManifests.id }).from(expansionReleaseManifests).where(and(
    eq(expansionReleaseManifests.setId, input.setId),
    isNull(expansionReleaseManifests.revokedAt),
  )).limit(1);
  if (active) return { ok: false, code: "release_already_active", eligibleCount: unique.length, discoveryCount };
  const [latest] = await db.select({ version: expansionReleaseManifests.version }).from(expansionReleaseManifests).where(eq(expansionReleaseManifests.setId, input.setId)).orderBy(desc(expansionReleaseManifests.version)).limit(1);
  const nextVersion = (latest?.version ?? 0) + 1;
  if (!Number.isInteger(input.version) || input.version !== nextVersion) {
    await writeClearanceAttempt({ setId: input.setId, eligibleCount: unique.length, discoveryCount, code: "release_version_mismatch", evidenceRef: proof, attemptedBy: who });
    return { ok: false, code: "release_version_mismatch", eligibleCount: unique.length, discoveryCount };
  }
  const rows = await boundRows(input.setId);
  const byKey = new Map(rows.map((row) => [row.member.memberKey, row]));
  const approved = [];
  for (const key of unique) {
    const row = byKey.get(key);
    if (!row) {
      await writeClearanceAttempt({ setId: input.setId, eligibleCount: unique.length, discoveryCount, code: "member_mismatch", evidenceRef: proof, attemptedBy: who });
      return { ok: false, code: "member_mismatch", eligibleCount: unique.length, discoveryCount };
    }
    const code = bindingCode(row);
    if (code || !row.output) {
      const refusal = code ?? "output_unapproved";
      await writeClearanceAttempt({ setId: input.setId, eligibleCount: unique.length, discoveryCount, code: refusal, evidenceRef: proof, attemptedBy: who });
      return { ok: false, code: refusal, eligibleCount: unique.length, discoveryCount };
    }
    const [proposal] = await db.select({ memberKey: geometryProposals.memberKey, polygonPixels: geometryProposals.polygonPixels }).from(geometryProposals).where(eq(geometryProposals.id, row.output.proposalId)).limit(1);
    if (!proposal || proposal.memberKey !== row.member.memberKey || canonicalPolygon(proposal.polygonPixels ?? []) !== row.output.polygonCanonical) {
      await writeClearanceAttempt({ setId: input.setId, eligibleCount: unique.length, discoveryCount, code: "proposal_mismatch", evidenceRef: proof, attemptedBy: who });
      return { ok: false, code: "proposal_mismatch", eligibleCount: unique.length, discoveryCount };
    }
    approved.push(row);
  }
  const releasedMembershipSha256 = releasedListSha(unique);
  const manifest = await db.transaction(async (tx) => {
    const [created] = await tx.insert(expansionReleaseManifests).values({
      setId: input.setId,
      version: input.version,
      evidenceRef: proof,
      clearedBy: who,
      memberCount: unique.length,
      releasedMembershipSha256,
      discoveryMembershipSha256: cohort.membershipSha256,
    }).returning({ id: expansionReleaseManifests.id });
    await tx.insert(expansionReleaseMembers).values(approved.map((row) => ({
      manifestId: created!.id,
      memberKey: row.member.memberKey,
      setId: input.setId,
      sourceSha256: row.output!.sourceSha256,
      nativeSha256: row.output!.nativeSha256,
      preview300Sha256: row.output!.preview300Sha256,
      polygonSha256: row.output!.polygonSha256,
      rendererId: row.output!.rendererId,
      proposalId: row.output!.proposalId,
    })));
    await tx.insert(expansionSetClearanceAttempts).values({
      setId: input.setId,
      eligibleCount: unique.length,
      discoveryCount,
      code: "released",
      evidenceRef: proof,
      attemptedBy: who,
    });
    return created!;
  });
  return { ok: true, manifestId: manifest.id, version: input.version, memberCount: unique.length, releasedMembershipSha256 };
}

export async function revokeExpansionRelease(input: {
  setId: string;
  version: number;
  evidenceRef: string;
  revokedBy: string;
}): Promise<{ ok: true; unchanged: boolean } | { ok: false; code: ReleaseRefusal }> {
  const proof = evidence(input.evidenceRef);
  const who = actor(input.revokedBy);
  if (!proof || !who) return { ok: false, code: "evidence_required" };
  if (scope(input.setId) === "stopped") return { ok: false, code: "ud_stopped" };
  if (scope(input.setId) !== "expansion") return { ok: false, code: "not_expansion" };
  const [row] = await db.select().from(expansionReleaseManifests).where(and(
    eq(expansionReleaseManifests.setId, input.setId),
    eq(expansionReleaseManifests.version, input.version),
  )).limit(1);
  if (!row) return { ok: false, code: "release_version_mismatch" };
  if (row.revokedAt) return { ok: true, unchanged: true };
  await db.update(expansionReleaseManifests).set({
    revokedAt: new Date(),
    revokedBy: who,
    revocationEvidenceRef: proof,
  }).where(eq(expansionReleaseManifests.id, row.id));
  await writeClearanceAttempt({
    setId: input.setId,
    eligibleCount: row.memberCount,
    discoveryCount: 0,
    code: "release_revoked",
    evidenceRef: proof,
    attemptedBy: who,
  });
  return { ok: true, unchanged: false };
}
