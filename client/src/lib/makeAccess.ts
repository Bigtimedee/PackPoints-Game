/**
 * Product lock (2026-09-08): users never create cards.
 * Snap-to-Set `/make` stays in the repo (darked) for staff ops only.
 */

export const MAKE_STAFF_ONLY_PATH = "/make";
export const MAKE_PUBLIC_REDIRECT = "/sets";

/** Strings that must not appear as public CTAs / publish funnels. */
export const FORBIDDEN_PUBLIC_MAKE_COPY = [
  "make a set",
  "make another set",
  "snap yours on /make",
  "publish your pc",
  "photo your stack",
  "upload photos of your cards",
  "snap a set from the pc",
] as const;

export function canAccessMake(user: { isAdmin?: boolean | null } | null | undefined): boolean {
  return user?.isAdmin === true;
}

export function containsForbiddenPublicMakeCopy(text: string): boolean {
  const hay = text.toLowerCase();
  return FORBIDDEN_PUBLIC_MAKE_COPY.some((needle) => hay.includes(needle));
}
