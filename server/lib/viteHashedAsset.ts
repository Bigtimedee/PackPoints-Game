/**
 * Vite's default Rollup names are `[name]-[hash].[ext]`. The hash is the
 * final hyphen segment: 8 characters of base64url (Rollup `DEFAULT_HASH_SIZE`).
 * Files copied from `client/public/assets/` do not get that suffix.
 * `play-set-1080.png` and `CAPTIONS.md` must not match.
 */
const VITE_HASH_SEGMENT = /^(?=.*[A-Za-z])[A-Za-z0-9_]{8}\.[A-Za-z0-9]+$/;

export function isViteHashedAsset(filePath: string): boolean {
  const base = filePath.split(/[/\\]/).pop() ?? "";
  const hyphen = base.lastIndexOf("-");
  if (hyphen <= 0) return false;
  return VITE_HASH_SEGMENT.test(base.slice(hyphen + 1));
}
