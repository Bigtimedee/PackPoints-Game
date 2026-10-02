import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { afterAll, describe, expect, it } from "vitest";
import type { Response } from "express";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { cardImageCache, gameSets, playableCards } from "@shared/schema";
import { db } from "../db";
import { sendUnmaskedCard } from "../services/playImageSend";

describe("unmasked reveal recovers a playable scan", () => {
  const servers: Server[] = [];
  const cardIds: string[] = [];
  const setIds: string[] = [];

  afterAll(async () => {
    await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
    for (const id of cardIds) {
      await db.delete(cardImageCache).where(eq(cardImageCache.cardId, id));
      await db.delete(playableCards).where(eq(playableCards.id, id));
    }
    for (const id of setIds) {
      await db.delete(gameSets).where(eq(gameSets.id, id));
    }
  });

  it("serves the real scan when the cached validation was marked bad", async () => {
    const jpeg = await sharp({
      create: { width: 8, height: 12, channels: 3, background: { r: 180, g: 40, b: 40 } },
    }).jpeg().toBuffer();
    const server = createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "image/jpeg" });
      res.end(jpeg);
    });
    servers.push(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = (server.address() as { port: number }).port;
    const setId = randomUUID();
    const cardId = randomUUID();
    setIds.push(setId);
    cardIds.push(cardId);
    const imageUrl = `http://127.0.0.1:${port}/scan.jpg`;
    await db.insert(gameSets).values({
      id: setId,
      sport: "football",
      brand: "Topps",
      year: 1994,
      setName: "1994 Topps Football",
    });
    await db.insert(playableCards).values({
      id: cardId,
      gameSetId: setId,
      cardhedgeCardId: `reveal-scan:${cardId}`,
      player: "Ken Phelps",
      imageUrl,
      category: "football",
    });
    await db.insert(cardImageCache).values({
      cardId,
      sourceUrl: imageUrl,
      normalizedUrl: imageUrl,
      proxiedPath: `/api/images/card/${cardId}`,
      status: "bad",
    });

    const chunks: Buffer[] = [];
    let status = 0;
    let body: unknown = null;
    const headers: Record<string, string> = {};
    const res = {
      req: { method: "GET", headers: {} as Record<string, string> },
      setHeader(name: string, value: string) { headers[name.toLowerCase()] = value; },
      removeHeader() {},
      status(code: number) { status = code; return this; },
      json(payload: unknown) { body = payload; return this; },
      end(payload?: Buffer) { if (payload) chunks.push(payload); },
    };
    await sendUnmaskedCard(res as unknown as Response, cardId);
    expect(body).toBeNull();
    expect(status).toBe(0);
    expect(headers["content-type"]).toBe("image/jpeg");
    expect(Buffer.concat(chunks).length).toBeGreaterThan(0);

    const [cache] = await db.select().from(cardImageCache).where(eq(cardImageCache.cardId, cardId));
    expect(cache.status).toBe("ok");
  });
});
