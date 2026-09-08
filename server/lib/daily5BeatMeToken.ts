import { createHmac, timingSafeEqual } from "crypto";
import {
  getPackptsDayKey,
  isPackptsDayKey,
} from "@shared/packptsDay";

const TOKEN_VERSION = 1;
const NAME_MAX = 20;

export const BEAT_ME_UTM = {
  utm_source: "share",
  utm_medium: "beatme",
  utm_campaign: "daily5",
} as const;

export type BeatMeTokenPayload = {
  v: number;
  s: number;
  d: string;
  n?: string;
  u?: string;
};

export type BeatMeResolveResult =
  | {
      status: "active";
      puzzleDay: string;
      today: string;
      correctCount: number;
      displayName?: string;
      challengerUserId?: string;
    }
  | {
      status: "stale";
      puzzleDay: string;
      today: string;
      correctCount: number;
      displayName?: string;
    }
  | { status: "invalid" };

function signingSecret(): string {
  return process.env.SECRET_SALT || process.env.GROWTH_AGENT_SECRET_SALT || "packpts-daily5-default-salt-change-me";
}

function b64urlEncode(buf: Buffer | string): string {
  const raw = typeof buf === "string" ? Buffer.from(buf, "utf8") : buf;
  return raw.toString("base64url");
}

function signPayload(encodedPayload: string): string {
  return createHmac("sha256", signingSecret()).update(encodedPayload).digest("base64url");
}

export function sanitizeBeatMeName(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const cleaned = raw.trim().replace(/[^a-zA-Z0-9_]/g, "").slice(0, NAME_MAX);
  return cleaned || undefined;
}

export function parseBeatMeCorrectCount(raw: unknown): number | undefined {
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0 && raw <= 5) return raw;
  if (typeof raw === "string" && /^(0|1|2|3|4|5)$/.test(raw.trim())) return Number(raw.trim());
  return undefined;
}

export function signBeatMeToken(input: {
  correctCount: number;
  puzzleDay: string;
  displayName?: string;
  userId?: string;
}): string {
  const s = parseBeatMeCorrectCount(input.correctCount);
  if (s === undefined) throw new Error("Beat-me score must be a real 0–5 session count");
  if (!isPackptsDayKey(input.puzzleDay)) throw new Error("Beat-me puzzle_day must be a CT day key");

  const payload: BeatMeTokenPayload = {
    v: TOKEN_VERSION,
    s,
    d: input.puzzleDay,
  };
  const n = sanitizeBeatMeName(input.displayName);
  if (n) payload.n = n;
  if (input.userId) payload.u = input.userId;

  const encoded = b64urlEncode(JSON.stringify(payload));
  return `v1.${encoded}.${signPayload(encoded)}`;
}

export function verifyBeatMeToken(token: unknown): BeatMeTokenPayload | null {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  const [, encoded, sig] = parts;
  if (!encoded || !sig) return null;
  const expected = signPayload(encoded);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as BeatMeTokenPayload;
    if (payload.v !== TOKEN_VERSION) return null;
    const s = parseBeatMeCorrectCount(payload.s);
    if (s === undefined || !isPackptsDayKey(payload.d)) return null;
    return {
      v: TOKEN_VERSION,
      s,
      d: payload.d,
      n: sanitizeBeatMeName(payload.n),
      u: typeof payload.u === "string" && payload.u ? payload.u : undefined,
    };
  } catch {
    return null;
  }
}

export function resolveBeatMeToken(
  token: unknown,
  today: string = getPackptsDayKey(),
): BeatMeResolveResult {
  const payload = verifyBeatMeToken(token);
  if (!payload) return { status: "invalid" };
  const base = {
    puzzleDay: payload.d,
    today,
    correctCount: payload.s,
    displayName: payload.n,
  };
  if (payload.d !== today) {
    return { status: "stale", ...base };
  }
  return {
    status: "active",
    ...base,
    challengerUserId: payload.u,
  };
}

export function buildBeatMePath(token: string): string {
  const params = new URLSearchParams({
    ...BEAT_ME_UTM,
    challenge: token,
  });
  return `/daily?${params.toString()}`;
}

export function buildBeatMeUrl(token: string, origin = "https://packpts.com"): string {
  return `${origin}${buildBeatMePath(token)}`;
}
