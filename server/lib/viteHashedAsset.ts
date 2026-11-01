/**
 * Vite's default Rollup names are `[name]-[hash].[ext]`. The hash is 8
 * characters of base64url (Rollup `DEFAULT_HASH_SIZE`), and base64url includes
 * `-`, so the hash is the last 8 characters of the stem, not the final hyphen
 * segment. Files copied from `client/public/assets/` do not get that suffix.
 * `play-set-1080.png` and `post2-daily5-1080.png` must not match.
 */
const VITE_HASH = /^(?=.*[A-Z])(?=.*[a-z])[A-Za-z0-9_-]{8}$/;

export function isViteHashedAsset(filePath: string): boolean {
  const base = filePath.split(/[/\\]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return false;
  const ext = base.slice(dot + 1);
  if (!/^[A-Za-z0-9]+$/.test(ext)) return false;
  const stem = base.slice(0, dot);
  if (stem.length < 10 || stem[stem.length - 9] !== "-") return false;
  return VITE_HASH.test(stem.slice(-8));
}
