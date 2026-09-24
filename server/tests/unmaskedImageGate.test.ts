import { createServer } from "http";
import type { AddressInfo } from "net";
import express from "express";
import { describe, expect, it } from "vitest";
import { handleCardIdUnmasked, handleRevealToken, type PlayImageDeps } from "../services/playImageHttp";
import {
  classifyRevealToken,
  maskedPlayPath,
  revealPlayPath,
} from "../services/playImageToken";
import { sanitizeQuestionForClient } from "../utils/questionSanitizer";
import type { GameQuestion } from "@shared/schema";

const CARD_A = "020523ae-91aa-403b-b16b-87baa2344672";
const CARD_B = "11111111-2222-4333-8444-555555555555";
const SESSION = "sess-gate-1";

function question(cardId: string): GameQuestion {
  return {
    card: {
      id: cardId,
      playerName: "Nolan Ryan",
      team: "Angels",
      position: "P",
      year: 1968,
      setName: "Topps",
      cardNumber: "177",
      imageUrl: `/api/cards/${cardId}/masked-image?v=v4.4`,
      popularity: 80,
      imageVerified: true,
      lastImageCheck: null,
      imageFailureCount: 0,
      imageLastError: null,
      isPlayable: true,
      quarantineStatus: "OK",
      imageReviewStatus: "unreviewed",
      reportCount: 0,
      blockedReason: null,
      updatedAt: null,
    },
    options: ["Nolan Ryan", "Tom Seaver", "Bob Gibson", "Sandy Koufax"],
    correctAnswer: "Nolan Ryan",
    pointValue: 120,
  };
}

async function withGate(state: { answered: Set<string>; admin: boolean }) {
  const app = express();
  const deps: PlayImageDeps = {
    authorizeCardId: async (_req, cardId) => {
      if (state.admin) return "admin";
      if (state.answered.has(cardId)) return "answered";
      return "denied";
    },
    resolveReveal: async (_req, scope, sessionId, index, exp, token) => {
      if (scope !== "solo" || sessionId !== SESSION || index !== 0) return { ok: false, reason: "bad" };
      const status = classifyRevealToken({
        scope,
        sessionId,
        index,
        cardId: CARD_A,
        exp,
        binder: SESSION,
        token,
        otherCardId: CARD_B,
      });
      if (status !== "valid") return { ok: false, reason: status };
      if (!state.answered.has(CARD_A)) return { ok: false, reason: "unanswered" };
      return { ok: true, cardId: CARD_A };
    },
    resolveMask: async () => null,
    sendUnmasked: async (res) => {
      res.status(200).type("image/jpeg").send(Buffer.from("jpeg-bytes"));
    },
    sendMasked: async (_req, res) => {
      res.status(200).type("image/jpeg").send(Buffer.from("masked"));
    },
  };
  app.get("/api/images/card/:cardId", (req, res) => handleCardIdUnmasked(req, res, deps));
  app.get("/api/play/r/:scope/:sessionId/:index/:exp/:token", (req, res) => handleRevealToken(req, res, deps));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve())),
  };
}

function cacheOf(res: Response): string {
  return res.headers.get("cache-control") || "";
}

describe("unmasked card image gate", () => {
  it("returns 403 with private, no-store for anonymous callers and unanswered cards", async () => {
    const gate = await withGate({ answered: new Set(), admin: false });
    try {
      const anon = await fetch(`${gate.base}/api/images/card/${CARD_A}`);
      expect(anon.status).toBe(403);
      expect(cacheOf(anon)).toContain("private");
      expect(cacheOf(anon)).toContain("no-store");
      expect(anon.headers.get("x-card-id")).toBeNull();

      const other = await fetch(`${gate.base}/api/images/card/${CARD_B}`);
      expect(other.status).toBe(403);
      expect(cacheOf(other)).toContain("no-store");
      expect(other.headers.get("x-card-id")).toBeNull();
    } finally {
      await gate.close();
    }
  });

  it("returns 200 with private, no-store after the card was answered in the caller session", async () => {
    const gate = await withGate({ answered: new Set([CARD_A]), admin: false });
    try {
      const allowed = await fetch(`${gate.base}/api/images/card/${CARD_A}`);
      expect(allowed.status).toBe(200);
      expect(allowed.headers.get("content-type")).toContain("image/jpeg");
      expect(cacheOf(allowed)).toContain("private");
      expect(cacheOf(allowed)).toContain("no-store");
      expect(allowed.headers.get("x-card-id")).toBeNull();
      expect(Buffer.from(await allowed.arrayBuffer()).toString()).toBe("jpeg-bytes");

      const notThisCard = await fetch(`${gate.base}/api/images/card/${CARD_B}`);
      expect(notThisCard.status).toBe(403);
    } finally {
      await gate.close();
    }
  });

  it("accepts a valid reveal token and rejects expired, tampered, and other-card tokens", async () => {
    const gate = await withGate({ answered: new Set([CARD_A]), admin: false });
    try {
      const now = Math.floor(Date.now() / 1000);
      const validPath = revealPlayPath({
        scope: "solo",
        sessionId: SESSION,
        index: 0,
        cardId: CARD_A,
        binder: SESSION,
        exp: now + 60,
      });
      const valid = await fetch(`${gate.base}${validPath}`);
      expect(valid.status).toBe(200);
      expect(cacheOf(valid)).toContain("private");
      expect(cacheOf(valid)).toContain("no-store");
      expect(valid.headers.get("x-card-id")).toBeNull();

      const expiredPath = revealPlayPath({
        scope: "solo",
        sessionId: SESSION,
        index: 0,
        cardId: CARD_A,
        binder: SESSION,
        exp: now - 30,
      });
      const expired = await fetch(`${gate.base}${expiredPath}`);
      expect(expired.status).toBe(403);
      expect(cacheOf(expired)).toContain("no-store");

      const tamperedPath = `${validPath.slice(0, -1)}${validPath.endsWith("a") ? "b" : "a"}`;
      const tampered = await fetch(`${gate.base}${tamperedPath}`);
      expect(tampered.status).toBe(403);

      const otherPath = revealPlayPath({
        scope: "solo",
        sessionId: SESSION,
        index: 0,
        cardId: CARD_B,
        binder: SESSION,
        exp: now + 60,
      });
      const other = await fetch(`${gate.base}${otherPath}`);
      expect(other.status).toBe(403);
      expect(classifyRevealToken({
        scope: "solo",
        sessionId: SESSION,
        index: 0,
        cardId: CARD_A,
        exp: now + 60,
        binder: SESSION,
        token: otherPath.split("/").pop() || "",
        otherCardId: CARD_B,
      })).toBe("other-card");
    } finally {
      await gate.close();
    }
  });

  it("question payload and masked URL contain no raw card id or correct-answer marker", () => {
    const sanitized = sanitizeQuestionForClient(question(CARD_A), {
      scope: "solo",
      sessionId: SESSION,
      index: 0,
    });
    const wire = JSON.stringify(sanitized);
    expect(wire).not.toContain(CARD_A);
    expect(sanitized.options).toContain("Nolan Ryan");
    expect(sanitized.card).not.toHaveProperty("playerName");
    expect(sanitized).not.toHaveProperty("correctAnswer");
    expect(wire).not.toContain("isCorrect");
    expect(wire).not.toContain("177");
    expect(wire).not.toContain("Angels");
    expect(wire).not.toContain("1968");
    expect(sanitized.card.imageUrl).toBe(maskedPlayPath({
      scope: "solo",
      sessionId: SESSION,
      index: 0,
      cardId: CARD_A,
    }));
    expect(sanitized.card.imageUrl).not.toContain(CARD_A);
    expect(sanitized.card.imageUrl).not.toContain("/api/images/card/");
    expect(sanitized.card).not.toHaveProperty("revealUrl");
  });
});
