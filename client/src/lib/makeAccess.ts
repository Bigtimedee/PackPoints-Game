/**
 * Product lock: users never create cards.
 * `/make` is catalog-match Snap-to-Set — open to non-staff.
 * Auth is required before the file picker, not before the page.
 */

export const MAKE_PATH = "/make";

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

export function canAccessMake(_user?: { isAdmin?: boolean | null } | null): boolean {
  return true;
}

export function containsForbiddenPublicMakeCopy(text: string): boolean {
  const hay = text.toLowerCase();
  return FORBIDDEN_PUBLIC_MAKE_COPY.some((needle) => hay.includes(needle));
}
