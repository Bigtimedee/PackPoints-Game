/**
 * Later review of one original hold. Rows are inserted only.
 * The cohort disposition and the membership hash stay as first registered.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { discoveryCohortMembers, expansionMemberReviews } from "@shared/schema";
import { db } from "../../db";
import { isProtectedLogoMember, PROTECTED_LOGO_CODE } from "./protectedIdentity";
import { isMissingExpansionId } from "./registry";

const UD_1991_SET_ID = "cd597562-5b8f-5517-aca0-38b04f443747";

export type MemberReviewRefusal =
  | "ud_stopped"
  | "not_expansion"
  | "evidence_required"
  | "not_importable"
  | "member_mismatch"
  | "source_drift"
  | "review_conflict"
  | typeof PROTECTED_LOGO_CODE;

type MemberIdentity = {
  memberKey: string;
  setId: string;
  supplierId: string;
  originalSha256: string;
  originalWidth: number;
  originalHeight: number;
  originalBytes: number;
  disposition: string;
};

function actor(value: string): string | null {
  const text = value.trim();
  if (text.length < 1 || text.length > 80 || text.includes("://") || text.includes("/")) return null;
  return text;
}

function evidence(value: string): string | null {
  const text = value.trim();
  if (text.length < 8 || text.length > 160 || text.includes("://") || /\s/.test(text)) return null;
  return text;
}

function sameAttestation(row: {
  supplierId: string;
  sourceSha256: string;
  width: number;
  height: number;
  originalBytes: number;
  attestedDisposition: string;
  evidenceRef: string;
  reviewedBy: string;
}, input: {
  supplierId: string;
  sourceSha256: string;
  width: number;
  height: number;
  originalBytes: number;
  evidenceRef: string;
  reviewedBy: string;
}): boolean {
  return row.supplierId === input.supplierId
    && row.sourceSha256 === input.sourceSha256
    && row.width === input.width
    && row.height === input.height
    && row.originalBytes === input.originalBytes
    && row.attestedDisposition === "pass-candidate"
    && row.evidenceRef === input.evidenceRef
    && row.reviewedBy === input.reviewedBy;
}

function matchesMember(row: {
  setId: string;
  supplierId: string;
  sourceSha256: string;
  width: number;
  height: number;
  originalBytes: number;
  attestedDisposition: string;
}, member: MemberIdentity): boolean {
  return row.attestedDisposition === "pass-candidate"
    && row.setId === member.setId
    && row.supplierId === member.supplierId
    && row.sourceSha256 === member.originalSha256
    && row.width === member.originalWidth
    && row.height === member.originalHeight
    && row.originalBytes === member.originalBytes;
}

/** True only when the latest review attests this exact held original. */
export async function holdReviewUnlocks(member: MemberIdentity): Promise<boolean> {
  if (isProtectedLogoMember(member)) return false;
  if (member.disposition !== "hold") return false;
  const [latest] = await db.select().from(expansionMemberReviews).where(eq(expansionMemberReviews.memberKey, member.memberKey)).orderBy(desc(expansionMemberReviews.revision)).limit(1);
  return !!latest && matchesMember(latest, member);
}

export async function recordMemberReview(input: {
  setId: string;
  memberKey: string;
  supplierId: string;
  sourceSha256: string;
  width: number;
  height: number;
  originalBytes: number;
  evidenceRef: string;
  reviewedBy: string;
  expectedRevision: number;
}): Promise<{ ok: true; id: string; revision: number; unchanged: boolean } | { ok: false; code: MemberReviewRefusal }> {
  const proof = evidence(input.evidenceRef);
  const who = actor(input.reviewedBy);
  if (!proof || !who) return { ok: false, code: "evidence_required" };
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) return { ok: false, code: "review_conflict" };
  if (input.setId.trim().toLowerCase() === UD_1991_SET_ID) return { ok: false, code: "ud_stopped" };
  if (!isMissingExpansionId(input.setId)) return { ok: false, code: "not_expansion" };
  if (!Number.isInteger(input.width) || !Number.isInteger(input.height) || !Number.isInteger(input.originalBytes) || input.width < 1 || input.height < 1 || input.originalBytes < 1) {
    return { ok: false, code: "source_drift" };
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`member-review:${input.memberKey}`}))`);
    const [member] = await tx.select().from(discoveryCohortMembers).where(and(
      eq(discoveryCohortMembers.memberKey, input.memberKey),
      eq(discoveryCohortMembers.setId, input.setId),
    )).limit(1);
    if (!member) return { ok: false, code: "member_mismatch" };
    if (isProtectedLogoMember(member)) return { ok: false, code: PROTECTED_LOGO_CODE };
    if (member.disposition !== "hold") return { ok: false, code: "not_importable" };
    if (member.supplierId !== input.supplierId || member.originalSha256 !== input.sourceSha256 || member.originalWidth !== input.width || member.originalHeight !== input.height || member.originalBytes !== input.originalBytes) {
      return { ok: false, code: "source_drift" };
    }
    const [latest] = await tx.select().from(expansionMemberReviews).where(eq(expansionMemberReviews.memberKey, input.memberKey)).orderBy(desc(expansionMemberReviews.revision)).limit(1);
    if (latest && sameAttestation(latest, { ...input, evidenceRef: proof, reviewedBy: who })) {
      return { ok: true, id: latest.id, revision: latest.revision, unchanged: true };
    }
    if ((latest?.revision ?? 0) !== input.expectedRevision) return { ok: false, code: "review_conflict" };
    const [created] = await tx.insert(expansionMemberReviews).values({
      setId: input.setId,
      memberKey: input.memberKey,
      revision: input.expectedRevision + 1,
      supplierId: input.supplierId,
      sourceSha256: input.sourceSha256,
      width: input.width,
      height: input.height,
      originalBytes: input.originalBytes,
      attestedDisposition: "pass-candidate",
      evidenceRef: proof,
      reviewedBy: who,
    }).returning({ id: expansionMemberReviews.id, revision: expansionMemberReviews.revision });
    return { ok: true, id: created!.id, revision: created!.revision, unchanged: false };
  });
}
