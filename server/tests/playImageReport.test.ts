import { createServer } from "http";
import type { AddressInfo } from "net";
import { readFileSync } from "fs";
import express from "express";
import { describe, expect, it } from "vitest";
import { maskToken } from "../services/playImageToken";
import { handlePlayImageReport, pickReportedCardId } from "../services/playImageReport";

const SESSION = "b1a522c9-6e66-43c1-a9bb-b97d32f21fd7";
const ORIGINAL = "card-landscape";
const REPLACEMENT = "card-portrait";
const routesSrc = readFileSync(new URL("../routes.ts", import.meta.url), "utf8");

describe("pickReportedCardId", () => {
  it("keeps a replaced card's mask token on the original, not the replacement", () => {
    const token = maskToken("solo", SESSION, 1, ORIGINAL);
    expect(pickReportedCardId({
      scope: "solo",
      sessionId: SESSION,
      index: 1,
      token,
      currentCardId: REPLACEMENT,
      priorCardIds: [ORIGINAL],
    })).toBe(ORIGINAL);
  });

  it("uses the current card when the token matches it or is omitted", () => {
    const token = maskToken("solo", SESSION, 1, REPLACEMENT);
    expect(pickReportedCardId({
      scope: "solo",
      sessionId: SESSION,
      index: 1,
      token,
      currentCardId: REPLACEMENT,
      priorCardIds: [ORIGINAL],
    })).toBe(REPLACEMENT);
    expect(pickReportedCardId({
      scope: "solo",
      sessionId: SESSION,
      index: 1,
      currentCardId: REPLACEMENT,
      priorCardIds: [ORIGINAL],
    })).toBe(REPLACEMENT);
  });

  it("rejects a token that names neither card", () => {
    expect(pickReportedCardId({
      scope: "solo",
      sessionId: SESSION,
      index: 1,
      token: maskToken("solo", SESSION, 1, "someone-else"),
      currentCardId: REPLACEMENT,
      priorCardIds: [ORIGINAL],
    })).toBeNull();
  });
});

describe("POST /api/play/report", () => {
  it("accepts a bad-image report with no card id and does not echo one", async () => {
    const token = maskToken("solo", SESSION, 1, ORIGINAL);
    let submitted: string | null = null;
    const app = express();
    app.use(express.json());
    app.post("/api/play/report", (req, res) => {
      void handlePlayImageReport(req, res, {
        resolveCard: async (scope, sessionId, index, reportToken) => pickReportedCardId({
          scope,
          sessionId,
          index,
          token: reportToken,
          currentCardId: REPLACEMENT,
          priorCardIds: [ORIGINAL],
        }),
        submit: async (request, response, cardId) => {
          submitted = cardId;
          expect(request.body.cardId).toBeUndefined();
          expect(request.body.questionIndex).toBeUndefined();
          expect(request.body.reason).toBe("bad_image");
          response.json({ success: true, reportId: "report-1" });
        },
      });
    });
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const port = (server.address() as AddressInfo).port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/play/report`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scope: "solo",
          sessionId: SESSION,
          questionIndex: 1,
          reason: "bad_image",
          token,
          cardId: "client-supplied-id",
          autoDetected: true,
          detectionReason: "abnormal_aspect_ratio",
        }),
      });
      const text = await res.text();
      expect(res.status).toBe(200);
      expect(text).toContain("\"success\":true");
      expect(text).not.toContain(ORIGINAL);
      expect(text).not.toContain(REPLACEMENT);
      expect(text).not.toContain("client-supplied-id");
      expect(submitted).toBe(ORIGINAL);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    }
  });

  it("is wired to the server resolver", () => {
    expect(routesSrc).toContain('app.post("/api/play/report"');
    expect(routesSrc).toContain("resolveReportedCardId");
  });
});
