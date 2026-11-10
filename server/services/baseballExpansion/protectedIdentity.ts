/**
 * Design operational stop for one 1986 Fleer original.
 * PROTECTED_LOGO_UNDER_PAINT_LEFT_INTERFACE. This is not a user quote.
 * The frozen inventory disposition stays pass-candidate. Ordinal alone is
 * not a key: another set's ordinal 44 is a different card.
 */
export const PROTECTED_LOGO_CODE = "protected_logo_under_paint" as const;

export const PROTECTED_LOGO_MEMBER = {
  setId: "891b39b8-0058-5e55-9837-6e4830c55d32",
  memberKey: "candidate-0044|6e763c327a0c3575c2bbf874a897ed5d2b01c8feda26cac26c7d030b70973950",
  supplierId: "1691980749282x809901267645076700",
  sourceSha256: "6e763c327a0c3575c2bbf874a897ed5d2b01c8feda26cac26c7d030b70973950",
  width: 705,
  height: 1200,
  originalBytes: 174899,
} as const;

export function isProtectedLogoMember(member: {
  setId: string;
  memberKey: string;
  supplierId: string;
  originalSha256: string;
  originalWidth: number;
  originalHeight: number;
  originalBytes: number;
}): boolean {
  const stop = PROTECTED_LOGO_MEMBER;
  return member.setId.trim().toLowerCase() === stop.setId
    && member.memberKey === stop.memberKey
    && member.supplierId === stop.supplierId
    && member.originalSha256 === stop.sourceSha256
    && member.originalWidth === stop.width
    && member.originalHeight === stop.height
    && member.originalBytes === stop.originalBytes;
}
