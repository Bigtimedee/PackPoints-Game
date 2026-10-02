/**
 * COVER_QA_TOKEN gates Design's cover review routes.
 * Unset or blank means the feature is off. The header is compared in constant time.
 * Query strings are never a token source.
 */
import { timingSafeEqual } from "crypto";

export function coverQaToken(): string {
  return (process.env.COVER_QA_TOKEN ?? "").trim();
}

export function coverQaEnabled(): boolean {
  return coverQaToken().length > 0;
}

export function coverQaHeaderMatches(header: string | undefined): boolean {
  const expected = coverQaToken();
  if (!expected || header == null) return false;
  const left = Buffer.from(header);
  const right = Buffer.from(expected);
  const length = Math.max(left.length, right.length, 1);
  const a = Buffer.alloc(length);
  const b = Buffer.alloc(length);
  left.copy(a);
  right.copy(b);
  return left.length === right.length && timingSafeEqual(a, b);
}
