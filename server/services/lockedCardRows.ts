/**
 * Answer-key card rows. Admin session only.
 * Public /sets pages use handlePublicSetDetail and never these payloads.
 */
import type { Express, Request, Response } from "express";
import { and, eq, sql } from "drizzle-orm";
import { maskedCardImageUrl } from "@shared/maskGeometry";
import {
  cardImageReports,
  cardSetCards,
  cardSets,
  catalogCards,
  playableCards,
  userOnboarding,
} from "@shared/schema";
import { isAuthenticated } from "../auth";
import { requireAdmin } from "../auth/requireAdmin";
import { db } from "../db";
import { storage } from "../storage";

export const ONBOARDING_REWARD_PTS = 50;

function noStore(res: Response) {
  res.set("Cache-Control", "private, no-store");
}

/** Masked image only. No player, number, variant, or raw scan. */
export function toPublicGuidedCard(card: { id: string } | null | undefined): { imageUrl: string } | null {
  if (!card?.id) return null;
  return { imageUrl: maskedCardImageUrl(card.id) };
}

async function handleCardReviewDiag(_req: Request, res: Response) {
  const steps: Record<string, unknown> = { v: 7 };
  try {
    await db.select({ now: sql<string>`now()` }).from(playableCards).limit(0);
    steps.dbConnected = true;

    const countResult = await db.select({ cnt: sql<number>`count(*)` }).from(playableCards);
    const playableCardsCount = Number(countResult[0]?.cnt ?? 0);
    steps.playableCardsCount = playableCardsCount;

    if (playableCardsCount > 0) {
      const [sample] = await db.select({
        id: playableCards.id,
        player: playableCards.player,
        status: playableCards.imageReviewStatus,
        isPlayable: playableCards.isPlayable,
        quarantine: playableCards.quarantineStatus,
      }).from(playableCards).limit(1);
      steps.sampleCard = sample;
    }

    const rptCount = await db.select({ cnt: sql<number>`count(*)` }).from(cardImageReports);
    steps.cardImageReportsCount = Number(rptCount[0]?.cnt ?? 0);

    noStore(res);
    res.json({ ok: true, steps });
  } catch (err: unknown) {
    const error = err as { message?: string; stack?: string };
    steps.error = error?.message;
    steps.stack = error?.stack?.slice(0, 500);
    res.status(500).json({ ok: false, steps });
  }
}

async function handleLegacyCardDump(_req: Request, res: Response) {
  try {
    const cards = await storage.getCards();
    noStore(res);
    res.json(cards);
  } catch (error) {
    console.error("Error getting cards:", error);
    res.status(500).json({ error: "Failed to get cards" });
  }
}

async function handlePlayableSetCards(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { random, limit = "20", offset = "0", player, number } = req.query;

    const conditions = [eq(playableCards.gameSetId, id)];

    if (player) {
      conditions.push(sql`${playableCards.player} ILIKE ${"%" + player + "%"}`);
    }

    if (number) {
      conditions.push(eq(playableCards.number, number as string));
    }

    const orderByClause = random === "1" || random === "true"
      ? sql`RANDOM()`
      : playableCards.player;

    const cards = await db
      .select()
      .from(playableCards)
      .where(and(...conditions))
      .orderBy(orderByClause)
      .limit(parseInt(limit as string, 10))
      .offset(parseInt(offset as string, 10));

    noStore(res);
    res.json(cards);
  } catch (error) {
    console.error("Error getting playable cards:", error);
    res.status(500).json({ error: "Failed to get playable cards" });
  }
}

async function handlePlayableCardByCardhedgeId(req: Request, res: Response) {
  try {
    const { cardhedgeCardId } = req.params;

    const [card] = await db
      .select()
      .from(playableCards)
      .where(eq(playableCards.cardhedgeCardId, cardhedgeCardId));

    if (!card) {
      return res.status(404).json({ error: "Card not found" });
    }

    noStore(res);
    res.json(card);
  } catch (error) {
    console.error("Error getting card:", error);
    res.status(500).json({ error: "Failed to get card" });
  }
}

async function handleCatalogSetCards(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = Math.min(parseInt(req.query.pageSize as string) || 50, 100);
    const offset = (page - 1) * pageSize;

    const [set] = await db.select()
      .from(cardSets)
      .where(and(eq(cardSets.id, id), eq(cardSets.isActive, true)))
      .limit(1);

    if (!set) {
      return res.status(404).json({ error: "Set not found or not active" });
    }

    const cards = await db.select({
      id: catalogCards.id,
      player: catalogCards.player,
      description: catalogCards.description,
      cardNumber: catalogCards.cardNumber,
      variant: catalogCards.variant,
      imageUrl: catalogCards.imageUrl,
    })
      .from(cardSetCards)
      .innerJoin(catalogCards, eq(cardSetCards.cardId, catalogCards.id))
      .where(eq(cardSetCards.setId, id))
      .limit(pageSize)
      .offset(offset);

    noStore(res);
    res.json({ cards });
  } catch (error) {
    console.error("Error getting set cards:", error);
    res.status(500).json({ error: "Failed to get set cards" });
  }
}

export async function handleOnboardingStart(req: Request, res: Response) {
  try {
    const session = req.session as { localUserId?: string } | undefined;
    const user = req.user as { claims?: { sub?: string } } | undefined;
    const userId = user?.claims?.sub || session?.localUserId;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    await db
      .insert(userOnboarding)
      .values({ userId })
      .onConflictDoNothing();

    const [card] = await db
      .select({ id: playableCards.id })
      .from(playableCards)
      .where(
        and(
          eq(playableCards.isPlayable, true),
          eq(playableCards.quarantineStatus, "OK"),
          eq(playableCards.imageFailureCount, 0),
        ),
      )
      .orderBy(sql`RANDOM()`)
      .limit(1);

    noStore(res);
    res.json({
      guidedCard: toPublicGuidedCard(card),
      rewardPts: ONBOARDING_REWARD_PTS,
      message: "Guess the player name to earn your first PackPTS!",
    });
  } catch (error) {
    console.error("[Onboarding] start error:", error);
    res.status(500).json({ error: "Failed to start onboarding" });
  }
}

/** Register after GET /api/cards/stats so that exact path is not captured. */
export function registerLockedCardRowRoutes(app: Express) {
  app.get("/api/diag/card-review-test", isAuthenticated, requireAdmin, (req, res) => {
    void handleCardReviewDiag(req, res);
  });
  app.get("/api/cards", isAuthenticated, requireAdmin, (req, res) => {
    void handleLegacyCardDump(req, res);
  });
  app.get("/api/playable-sets/:id/cards", isAuthenticated, requireAdmin, (req, res) => {
    void handlePlayableSetCards(req, res);
  });
  app.get("/api/cards/:cardhedgeCardId", isAuthenticated, requireAdmin, (req, res) => {
    void handlePlayableCardByCardhedgeId(req, res);
  });
  app.get("/api/card-sets/:id/cards", isAuthenticated, requireAdmin, (req, res) => {
    void handleCatalogSetCards(req, res);
  });
}
