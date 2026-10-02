/**
 * Operator switch for public /sets cover images.
 * On only when SETS_COVERS_DISABLED is "1" or "true". Anything else is off.
 */
export function setsCoversDisabled(raw: string | undefined = process.env.SETS_COVERS_DISABLED): boolean {
  const value = (raw ?? "").trim().toLowerCase();
  return value === "1" || value === "true";
}
