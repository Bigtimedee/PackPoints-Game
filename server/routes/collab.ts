import { Router, Response } from "express";
import { z } from "zod";
import { db } from "../db";
import { collaborationSessions, gameSets, playableCards, users } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";
import { broadcastToCollab, sendToUser } from "../websocket";

const router = Router();

function isAuthenticated(req: any, res: Response, next: Function) {
  const userId = req.user?.id || req.user?.claims?.sub || req.session?.localUserId;
  if (!userId) return res.status(401).json({ message: "Unauthorized" });
  if (!req.user) req.user = { id: userId };
  else if (!req.user.id) req.user.id = userId;
  next();
}

// POST /api/collab/create — host creates a session and gets back a shareable URL
router.post("/api/collab/create", isAuthenticated, async (req: any, res: Response) => {
  try {
    const hostUserId = req.user.id;
    const [session] = await db.insert(collaborationSessions).values({
      hostUserId,
      status: "waiting",
    }).returning();
    res.json({ id: session.id });
  } catch (err) {
    console.error("[Collab] POST /api/collab/create error:", err);
    res.status(500).json({ error: "Failed to create collab session" });
  }
});

// GET /api/collab/:id — fetch session state (public so guest can load the page before auth check)
router.get("/api/collab/:id", isAuthenticated, async (req: any, res: Response) => {
  try {
    const { id } = req.params;
    const [session] = await db.select().from(collaborationSessions).where(eq(collaborationSessions.id, id)).limit(1);
    if (!session) return res.status(404).json({ error: "Session not found" });

    // Fetch host + guest usernames
    const [host] = await db.select({ username: users.username }).from(users).where(eq(users.id, session.hostUserId)).limit(1);
    const guestUsername = session.guestUserId
      ? (await db.select({ username: users.username }).from(users).where(eq(users.id, session.guestUserId)).limit(1))[0]?.username ?? null
      : null;

    res.json({
      ...session,
      hostUsername: host?.username ?? null,
      guestUsername,
    });
  } catch (err) {
    console.error("[Collab] GET /api/collab/:id error:", err);
    res.status(500).json({ error: "Failed to get collab session" });
  }
});

// POST /api/collab/:id/join — guest joins the session
router.post("/api/collab/:id/join", isAuthenticated, async (req: any, res: Response) => {
  try {
    const { id } = req.params;
    const guestUserId = req.user.id;

    const [session] = await db.select().from(collaborationSessions).where(eq(collaborationSessions.id, id)).limit(1);
    if (!session) return res.status(404).json({ error: "Session not found" });
    if (session.status !== "waiting") return res.status(409).json({ error: "Session is not accepting guests" });
    if (session.hostUserId === guestUserId) return res.status(400).json({ error: "You are the host" });

    const [updated] = await db.update(collaborationSessions)
      .set({ guestUserId, status: "active" })
      .where(and(eq(collaborationSessions.id, id), eq(collaborationSessions.status, "waiting")))
      .returning();

    if (!updated) return res.status(409).json({ error: "Race condition — session was already joined" });

    const [guest] = await db.select({ username: users.username }).from(users).where(eq(users.id, guestUserId)).limit(1);
    broadcastToCollab(id, {
      type: "collab:guest_joined",
      payload: { guestUserId, guestUsername: guest?.username ?? null },
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("[Collab] POST /api/collab/:id/join error:", err);
    res.status(500).json({ error: "Failed to join session" });
  }
});

const nominateSchema = z.object({
  card: z.object({
    cardhedgeCardId: z.string(),
    playerName: z.string(),
    sport: z.string(),
    brand: z.string(),
    year: z.number().int(),
    imageUrl: z.string().optional(),
  }),
});

// POST /api/collab/:id/nominate — either player nominates a card for the other to approve
router.post("/api/collab/:id/nominate", isAuthenticated, async (req: any, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const parsed = nominateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const [session] = await db.select().from(collaborationSessions).where(eq(collaborationSessions.id, id)).limit(1);
    if (!session) return res.status(404).json({ error: "Session not found" });
    if (session.status !== "active") return res.status(409).json({ error: "Session is not active" });
    if (session.hostUserId !== userId && session.guestUserId !== userId) {
      return res.status(403).json({ error: "Not a member of this session" });
    }

    const nomination = { ...parsed.data.card, nominatedBy: userId, id: randomUUID() };
    const updatedCards = [...(session.nominatedCards as any[]), nomination];

    await db.update(collaborationSessions)
      .set({ nominatedCards: updatedCards })
      .where(eq(collaborationSessions.id, id));

    broadcastToCollab(id, { type: "collab:card_nominated", payload: nomination });
    res.json({ ok: true, nomination });
  } catch (err) {
    console.error("[Collab] POST /api/collab/:id/nominate error:", err);
    res.status(500).json({ error: "Failed to nominate card" });
  }
});

const approveSchema = z.object({ nominationId: z.string() });

// POST /api/collab/:id/approve — approves a card nominated by the OTHER player
router.post("/api/collab/:id/approve", isAuthenticated, async (req: any, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const parsed = approveSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const [session] = await db.select().from(collaborationSessions).where(eq(collaborationSessions.id, id)).limit(1);
    if (!session) return res.status(404).json({ error: "Session not found" });
    if (session.status !== "active") return res.status(409).json({ error: "Session is not active" });
    if (session.hostUserId !== userId && session.guestUserId !== userId) {
      return res.status(403).json({ error: "Not a member of this session" });
    }

    const nomination = (session.nominatedCards as any[]).find(c => c.id === parsed.data.nominationId);
    if (!nomination) return res.status(404).json({ error: "Nomination not found" });
    if (nomination.nominatedBy === userId) return res.status(400).json({ error: "Cannot approve your own nomination" });

    const alreadyApproved = (session.approvedCards as any[]).some(c => c.id === parsed.data.nominationId);
    if (alreadyApproved) return res.status(409).json({ error: "Already approved" });

    const updatedApproved = [...(session.approvedCards as any[]), nomination];
    await db.update(collaborationSessions)
      .set({ approvedCards: updatedApproved })
      .where(eq(collaborationSessions.id, id));

    broadcastToCollab(id, { type: "collab:card_approved", payload: { nominationId: parsed.data.nominationId, card: nomination } });
    res.json({ ok: true });
  } catch (err) {
    console.error("[Collab] POST /api/collab/:id/approve error:", err);
    res.status(500).json({ error: "Failed to approve card" });
  }
});

const publishSchema = z.object({
  setName: z.string().min(1).max(60),
  makerNote: z.string().max(140).optional(),
});

// POST /api/collab/:id/publish — host publishes approved cards as a real game set
router.post("/api/collab/:id/publish", isAuthenticated, async (req: any, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const parsed = publishSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const [session] = await db.select().from(collaborationSessions).where(eq(collaborationSessions.id, id)).limit(1);
    if (!session) return res.status(404).json({ error: "Session not found" });
    if (session.status !== "active") return res.status(409).json({ error: "Session is not active" });
    if (session.hostUserId !== userId) return res.status(403).json({ error: "Only the host can publish" });

    const approved = session.approvedCards as any[];
    if (approved.length < 5) return res.status(400).json({ error: "Need at least 5 approved cards to publish" });

    const firstCard = approved[0];
    const [newSet] = await db.insert(gameSets).values({
      sport: firstCard.sport || "baseball",
      brand: firstCard.brand || "Unknown",
      year: firstCard.year || new Date().getFullYear(),
      setName: parsed.data.setName,
      isUserCreated: true,
      createdByUserId: session.hostUserId,
      coCreatorUserId: session.guestUserId ?? null,
      makerNote: parsed.data.makerNote ?? null,
    }).returning();

    const cardRows = approved.map((card: any) => ({
      gameSetId: newSet.id,
      cardhedgeCardId: `snap2set:${randomUUID()}`,
      player: card.playerName,
      set: parsed.data.setName,
      description: `${card.year || newSet.year} ${card.brand || newSet.brand} — ${card.playerName}`,
      imageUrl: card.imageUrl ?? null,
      // category must match the set's sport or getRandomCardsFromSet filters the card out
      category: newSet.sport,
      isPlayable: true,
    }));
    await db.insert(playableCards).values(cardRows);

    await db.update(collaborationSessions)
      .set({ status: "published", publishedSetId: newSet.id, setName: parsed.data.setName, makerNote: parsed.data.makerNote ?? null })
      .where(eq(collaborationSessions.id, id));

    broadcastToCollab(id, { type: "collab:published", payload: { setId: newSet.id, setName: parsed.data.setName } });
    res.json({ setId: newSet.id });
  } catch (err) {
    console.error("[Collab] POST /api/collab/:id/publish error:", err);
    res.status(500).json({ error: "Failed to publish collab set" });
  }
});

export default router;
