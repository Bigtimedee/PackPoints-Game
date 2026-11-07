/**
 * Social approval gate for link-preview images.
 * server/assets/share/APPROVED.json is a JSON array of sha256 hex hashes.
 * An image is used as og:image / twitter:image only when its file hash is in
 * that list. Design adds the hash after reviewing the file. The app never
 * writes this file.
 */
import { createHash } from "crypto";
import { existsSync, readFileSync, statSync } from "fs";
import path from "path";

export function shareApprovalPath(): string {
  return path.join(process.cwd(), "server", "assets", "share", "APPROVED.json");
}

export function readShareApproval(file = shareApprovalPath()): Set<string> {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((row): row is string => typeof row === "string" && /^[0-9a-f]{64}$/.test(row)));
  } catch {
    return new Set();
  }
}

const hashCache = new Map<string, { mtimeMs: number; size: number; sha: string }>();

export function sha256File(filePath: string): string | null {
  try {
    const st = statSync(filePath);
    const hit = hashCache.get(filePath);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.sha;
    const sha = createHash("sha256").update(readFileSync(filePath)).digest("hex");
    hashCache.set(filePath, { mtimeMs: st.mtimeMs, size: st.size, sha });
    return sha;
  } catch {
    return null;
  }
}

export function sharePngCandidates(file: string): string[] {
  const name = path.basename(file);
  return [
    path.join(process.cwd(), "client", "public", "og", "share", name),
    path.join(process.cwd(), "dist", "public", "og", "share", name),
  ];
}

export function resolveSharePng(file: string): { path: string; sha256: string } | null {
  for (const candidate of sharePngCandidates(file)) {
    if (!existsSync(candidate)) continue;
    const sha256 = sha256File(candidate);
    if (sha256) return { path: candidate, sha256 };
  }
  return null;
}

let allowOverride: Set<string> | null = null;

export function setShareApprovalForTests(next: Set<string> | null): void {
  allowOverride = next;
}

export function shareImageApproved(sha256: string | null | undefined, allow = allowOverride ?? readShareApproval()): boolean {
  return !!sha256 && allow.has(sha256);
}
