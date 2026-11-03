/**
 * Share-asset allowlist. Same shape as server/assets/ig/APPROVED.json:
 * a JSON array of lowercase sha256 hex strings. One bad entry rejects the file.
 */
import { readFileSync } from "fs";
import path from "path";

export function defaultShareAllowlistPath(): string {
  return path.join(process.cwd(), "server", "assets", "share", "APPROVED.json");
}

export function readShareAllowlistFile(file: string): Set<string> {
  try {
    const raw = JSON.parse(readFileSync(file, "utf8"));
    if (!Array.isArray(raw)) return new Set();
    const set = new Set<string>();
    for (const item of raw) {
      if (typeof item !== "string" || !/^[a-f0-9]{64}$/i.test(item)) return new Set();
      set.add(item.toLowerCase());
    }
    return set;
  } catch {
    return new Set();
  }
}

let override: Set<string> | null = null;

export function setShareAllowlistForTests(next: Set<string> | null): void {
  override = next;
}

export function currentShareAllowlist(): Set<string> {
  if (override) return override;
  return readShareAllowlistFile(defaultShareAllowlistPath());
}
