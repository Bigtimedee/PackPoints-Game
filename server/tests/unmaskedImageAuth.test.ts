/**
 * GET /api/images/card/:id is per player, not "someone has answered this card".
 * A cookieless request is denied even when the fingerprint header names the
 * guest who already submitted, and even when another session has the answer.
 */
import { createServer } from "http";
import type { AddressInfo } from "net";
import express from "express";
import type { Request } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const CARD = "579e675f-b5c1-4cd1-89c2-d052005ab2f8";
const OTHER = "020523ae-91aa-403b-b16b-87baa2344672";
const USER_A = "user-a";
const USER_B = "user-b";
const ADMIN = "user-admin";
const ANON_A = "anon-a";
const ANON_B = "anon-b";

type Kind = "solo" | "daily" | "match";

const state = {
  grants: [] as Array<{ kind: Kind; who: string; cardId: string }>,
  cookieAnon: null as string | null,
};

const database = vi.hoisted(() => ({
  execute: vi.fn(),
}));

const users = vi.hoisted(() => ({
  getUser: vi.fn(),
}));

const anon = vi.hoisted(() => ({
  fromCookie: vi.fn(),
  fromFingerprint: vi.fn(),
}));

vi.mock("../db", () => ({
  db: { execute: (...args: unknown[]) => database.execute(...args) },
  pool: {},
}));

vi.mock("../storage", () => ({
  storage: { getUser: (...args: unknown[]) => users.getUser(...args) },
}));

vi.mock("../services/anonIdentity", () => ({
  anonPlayerIdFromCookie: (...args: unknown[]) => anon.fromCookie(...args),
  resolveAnonPlayer: (...args: unknown[]) => anon.fromFingerprint(...args),
}));

import { handleCardIdUnmasked } from "../services/playImageHttp";
import { authorizeCardId } from "../services/playImageAccess";

function sqlText(query: { queryChunks?: unknown[] }): string {
  let text = "";
  for (const chunk of query?.queryChunks ?? []) {
    if (chunk && typeof chunk === "object" && "value" in chunk && Array.isArray((chunk as { value: unknown }).value)) {
      text += (chunk as { value: string[] }).value.join("");
    }
  }
  return text;
}

function sqlParams(query: { queryChunks?: unknown[] }): string[] {
  const params: string[] = [];
  for (const chunk of query?.queryChunks ?? []) {
    if (typeof chunk === "string") params.push(chunk);
  }
  return params;
}

function kindOf(text: string): Kind | null {
  if (text.includes("game_sessions")) return "solo";
  if (text.includes("daily_challenge") || text.includes("anon_daily_runs")) return "daily";
  if (text.includes("match_answers")) return "match";
  return null;
}

beforeEach(() => {
  state.grants = [];
  state.cookieAnon = null;
  database.execute.mockReset();
  database.execute.mockImplementation(async (query: { queryChunks?: unknown[] }) => {
    const text = sqlText(query);
    const params = sqlParams(query);
    const kind = kindOf(text);
    const who = params.find((value) => value === USER_A || value === USER_B || value === ANON_A || value === ANON_B);
    const cardId = params.find((value) => value === CARD || value === OTHER);
    if (!kind || !who || !cardId) return { rows: [] };
    const hit = state.grants.some((grant) => grant.kind === kind && grant.who === who && grant.cardId === cardId);
    return { rows: hit ? [{ ok: 1 }] : [] };
  });
  users.getUser.mockReset();
  users.getUser.mockImplementation(async (id: string) => ({ id, isAdmin: id === ADMIN }));
  anon.fromCookie.mockReset();
  anon.fromCookie.mockImplementation(async () => state.cookieAnon);
  anon.fromFingerprint.mockReset();
  anon.fromFingerprint.mockImplementation(async () => ({ id: ANON_A }));
});

function cacheOf(res: Response): string {
  return res.headers.get("cache-control") || "";
}

async function withGate() {
  const app = express();
  app.use((req, _res, next) => {
    const user = req.header("x-test-user");
    const guest = req.header("x-test-guest");
    const cookieAnon = req.header("x-test-anon");
    (req as Request & { session?: { localUserId?: string; guestId?: string } }).session = {};
    if (user) (req as Request & { session: { localUserId?: string } }).session.localUserId = user;
    if (guest) (req as Request & { session: { guestId?: string } }).session.guestId = guest;
    state.cookieAnon = cookieAnon || null;
    next();
  });
  app.get("/api/images/card/:cardId", (req, res) => {
    void handleCardIdUnmasked(req, res, {
      authorizeCardId: (request, cardId) => authorizeCardId(request, res, cardId),
      resolveReveal: async () => ({ ok: false, reason: "bad" }),
      resolveMask: async () => null,
      sendUnmasked: async (response) => {
        response.status(200).type("image/jpeg").end(Buffer.from("jpeg-bytes"));
      },
      sendMasked: async (_request, response) => {
        response.status(200).end("masked");
      },
    });
  });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

function expectPrivate(res: Response) {
  expect(cacheOf(res)).toContain("private");
  expect(cacheOf(res)).toContain("no-store");
  expect(res.headers.get("cdn-cache-control")).toBe("no-store");
  expect(res.headers.get("surrogate-control")).toBe("no-store");
  expect(res.headers.get("vary")).toContain("Cookie");
  expect(res.headers.get("x-card-id")).toBeNull();
}

describe("unmasked card id authorization", () => {
  it("returns 403 with no cookies even after another player answered, and does not trust the fingerprint", async () => {
    state.grants.push({ kind: "daily", who: ANON_A, cardId: CARD });
    state.grants.push({ kind: "solo", who: USER_A, cardId: CARD });
    const gate = await withGate();
    try {
      const anonRes = await fetch(`${gate.base}/api/images/card/${CARD}`, {
        headers: { "x-packpts-fp": "shared-browser-fingerprint" },
      });
      expect(anonRes.status).toBe(403);
      expectPrivate(anonRes);
      expect(anon.fromFingerprint).not.toHaveBeenCalled();
      expect(database.execute).not.toHaveBeenCalled();

      const bare = await fetch(`${gate.base}/api/images/card/${CARD}`);
      expect(bare.status).toBe(403);
      expectPrivate(bare);
    } finally {
      await gate.close();
    }
  });

  it("returns 403 for another session after this card was answered, and 200 only for the session that submitted", async () => {
    const gate = await withGate();
    try {
      const before = await fetch(`${gate.base}/api/images/card/${CARD}`, {
        headers: { "x-test-user": USER_A },
      });
      expect(before.status).toBe(403);
      expectPrivate(before);

      state.grants.push({ kind: "solo", who: USER_A, cardId: CARD });

      const owner = await fetch(`${gate.base}/api/images/card/${CARD}`, {
        headers: { "x-test-user": USER_A },
      });
      expect(owner.status).toBe(200);
      expect(owner.headers.get("content-type")).toContain("image/jpeg");
      expectPrivate(owner);
      expect(Buffer.from(await owner.arrayBuffer()).toString()).toBe("jpeg-bytes");

      const otherSession = await fetch(`${gate.base}/api/images/card/${CARD}`, {
        headers: { "x-test-user": USER_B },
      });
      expect(otherSession.status).toBe(403);
      expectPrivate(otherSession);

      const otherCard = await fetch(`${gate.base}/api/images/card/${OTHER}`, {
        headers: { "x-test-user": USER_A },
      });
      expect(otherCard.status).toBe(403);
    } finally {
      await gate.close();
    }
  });

  it("keeps a shared Daily 5 card per player", async () => {
    state.grants.push({ kind: "daily", who: USER_A, cardId: CARD });
    state.grants.push({ kind: "daily", who: ANON_A, cardId: CARD });
    const gate = await withGate();
    try {
      const playerA = await fetch(`${gate.base}/api/images/card/${CARD}`, {
        headers: { "x-test-user": USER_A },
      });
      expect(playerA.status).toBe(200);

      const playerB = await fetch(`${gate.base}/api/images/card/${CARD}`, {
        headers: { "x-test-user": USER_B },
      });
      expect(playerB.status).toBe(403);

      const guestA = await fetch(`${gate.base}/api/images/card/${CARD}`, {
        headers: { "x-test-anon": ANON_A },
      });
      expect(guestA.status).toBe(200);

      const guestB = await fetch(`${gate.base}/api/images/card/${CARD}`, {
        headers: { "x-test-anon": ANON_B },
      });
      expect(guestB.status).toBe(403);

      const guestSession = await fetch(`${gate.base}/api/images/card/${CARD}`, {
        headers: { "x-test-guest": ANON_B },
      });
      expect(guestSession.status).toBe(403);
    } finally {
      await gate.close();
    }
  });

  it("returns 200 for an admin and for the 1v1 player who submitted, not their opponent", async () => {
    state.grants.push({ kind: "match", who: USER_A, cardId: CARD });
    const gate = await withGate();
    try {
      const admin = await fetch(`${gate.base}/api/images/card/${CARD}`, {
        headers: { "x-test-user": ADMIN },
      });
      expect(admin.status).toBe(200);
      expectPrivate(admin);

      const opponent = await fetch(`${gate.base}/api/images/card/${OTHER}`, {
        headers: { "x-test-user": ADMIN },
      });
      expect(opponent.status).toBe(200);

      const answered = await fetch(`${gate.base}/api/images/card/${CARD}`, {
        headers: { "x-test-user": USER_A },
      });
      expect(answered.status).toBe(200);

      const waiting = await fetch(`${gate.base}/api/images/card/${CARD}`, {
        headers: { "x-test-user": USER_B },
      });
      expect(waiting.status).toBe(403);
    } finally {
      await gate.close();
    }
  });
});
