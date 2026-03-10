import { Router, Request, Response } from "express";
import { db } from "../db";
import { referralLinks, referralAttributions, shareEvents, users, contentAssets } from "@shared/schema";
import { eq, and, sql, desc, gte } from "drizzle-orm";
import crypto from "crypto";

const router = Router();

function generateShortCode(): string {
  return crypto.randomBytes(5).toString("base64url").slice(0, 8);
}

function isAuthenticated(req: Request): boolean {
  return !!(req.session as any)?.localUserId || !!(req.session as any)?.userId;
}

function getUserId(req: Request): string | null {
  return (req.session as any)?.localUserId || (req.session as any)?.userId || null;
}

router.post("/api/referrals/create", async (req: Request, res: Response) => {
  try {
    if (!isAuthenticated(req)) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const userId = getUserId(req)!;
    const { purpose, destinationPath } = req.body;

    if (!purpose || !destinationPath) {
      return res.status(400).json({ message: "purpose and destinationPath are required" });
    }

    const validPurposes = ["INVITE", "DAILY5_CHALLENGE", "SCORE_SHARE"];
    if (!validPurposes.includes(purpose)) {
      return res.status(400).json({ message: "Invalid purpose" });
    }

    let code = generateShortCode();
    let attempts = 0;
    while (attempts < 5) {
      const existing = await db.select({ id: referralLinks.id })
        .from(referralLinks)
        .where(eq(referralLinks.code, code))
        .limit(1);
      if (existing.length === 0) break;
      code = generateShortCode();
      attempts++;
    }

    const [link] = await db.insert(referralLinks).values({
      code,
      createdByUserId: userId,
      purpose: purpose as any,
      destinationPath,
      isActive: true,
    }).returning();

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const url = `${baseUrl}/r/${link.code}`;

    return res.json({ id: link.id, code: link.code, url });
  } catch (err: any) {
    console.error("[Referral] Create error:", err?.message);
    return res.status(500).json({ message: "Failed to create referral link" });
  }
});

router.get("/r/:code", async (req: Request, res: Response) => {
  try {
    const { code } = req.params;

    const [link] = await db.select()
      .from(referralLinks)
      .where(and(eq(referralLinks.code, code), eq(referralLinks.isActive, true)))
      .limit(1);

    if (!link) {
      return res.redirect("/");
    }

    if (link.expiresAt && new Date(link.expiresAt) < new Date()) {
      return res.redirect("/");
    }

    await db.update(referralLinks)
      .set({ clickCount: sql`${referralLinks.clickCount} + 1` })
      .where(eq(referralLinks.id, link.id));

    const destination = link.destinationPath.includes("?")
      ? `${link.destinationPath}&ref=${code}`
      : `${link.destinationPath}?ref=${code}`;

    return res.redirect(destination);
  } catch (err: any) {
    console.error("[Referral] Redirect error:", err?.message);
    return res.redirect("/");
  }
});

router.post("/api/referrals/attribute", async (req: Request, res: Response) => {
  try {
    if (!isAuthenticated(req)) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const userId = getUserId(req)!;
    const { refCode, eventType } = req.body;

    if (!refCode || !eventType) {
      return res.status(400).json({ message: "refCode and eventType required" });
    }

    const validEvents = ["SIGNUP", "FIRST_MATCH", "FIRST_PURCHASE"];
    if (!validEvents.includes(eventType)) {
      return res.status(400).json({ message: "Invalid event type" });
    }

    const [link] = await db.select()
      .from(referralLinks)
      .where(and(eq(referralLinks.code, refCode), eq(referralLinks.isActive, true)))
      .limit(1);

    if (!link) {
      return res.json({ attributed: false, reason: "Link not found" });
    }

    if (link.createdByUserId === userId) {
      return res.json({ attributed: false, reason: "Cannot self-refer" });
    }

    try {
      await db.insert(referralAttributions).values({
        referralLinkId: link.id,
        invitedUserId: userId,
        eventType: eventType as any,
      });

      if (eventType === "FIRST_MATCH") {
        import("../services/referralRewards").then(({ grantReferralBonus }) => {
          grantReferralBonus(userId, "FIRST_MATCH").catch(err =>
            console.error("[Referral] Bonus grant error:", err?.message)
          );
        }).catch(() => {});
      }

      if (eventType === "SIGNUP") {
        import("../services/referralRewards").then(({ grantReferralWelcomeBonus }) => {
          grantReferralWelcomeBonus(userId, link.id).catch(err =>
            console.error("[Referral] Welcome bonus grant error:", err?.message)
          );
        }).catch(() => {});
      }

      return res.json({ attributed: true });
    } catch (err: any) {
      if (err?.message?.includes("uq_referral_attribution") || err?.code === "23505") {
        return res.json({ attributed: false, reason: "Already attributed" });
      }
      throw err;
    }
  } catch (err: any) {
    console.error("[Referral] Attribution error:", err?.message);
    return res.status(500).json({ message: "Attribution failed" });
  }
});

router.get("/api/referrals/my-stats", async (req: Request, res: Response) => {
  try {
    if (!isAuthenticated(req)) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const userId = getUserId(req)!;

    const links = await db.select()
      .from(referralLinks)
      .where(eq(referralLinks.createdByUserId, userId))
      .orderBy(desc(referralLinks.createdAt));

    const totalClicks = links.reduce((sum, l) => sum + l.clickCount, 0);

    const attributions = await db.select()
      .from(referralAttributions)
      .innerJoin(referralLinks, eq(referralAttributions.referralLinkId, referralLinks.id))
      .where(eq(referralLinks.createdByUserId, userId));

    const signups = attributions.filter(a => a.referral_attributions.eventType === "SIGNUP").length;
    const firstMatches = attributions.filter(a => a.referral_attributions.eventType === "FIRST_MATCH").length;

    return res.json({
      totalLinks: links.length,
      totalClicks,
      signups,
      firstMatches,
    });
  } catch (err: any) {
    console.error("[Referral] Stats error:", err?.message);
    return res.status(500).json({ message: "Failed to get referral stats" });
  }
});

router.post("/api/share-events", async (req: Request, res: Response) => {
  try {
    if (!isAuthenticated(req)) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const userId = getUserId(req)!;
    const { shareType, target, contentAssetId, shareLinkId } = req.body;

    const validShareTypes = ["SCORE_CARD", "LEADERBOARD_CARD", "STREAK_CARD", "CHALLENGE_INVITE"];
    const validTargets = ["TIKTOK", "INSTAGRAM", "X", "DISCORD", "COPY_LINK", "NATIVE_SHARE"];

    if (!validShareTypes.includes(shareType) || !validTargets.includes(target)) {
      return res.status(400).json({ message: "Invalid shareType or target" });
    }

    const today = new Date().toISOString().slice(0, 10);
    const todayStart = new Date(today + "T00:00:00Z");
    const [countResult] = await db.select({ count: sql<number>`count(*)` })
      .from(shareEvents)
      .where(and(
        eq(shareEvents.userId, userId),
        sql`${shareEvents.createdAt} >= ${todayStart}`
      ));

    if ((countResult?.count || 0) >= 10) {
      return res.json({ logged: false, reason: "Daily share limit reached (10/day)" });
    }

    await db.insert(shareEvents).values({
      userId,
      shareType: shareType as any,
      target: target as any,
      contentAssetId,
      shareLinkId,
    });

    return res.json({ logged: true });
  } catch (err: any) {
    console.error("[ShareEvent] Error:", err?.message);
    return res.status(500).json({ message: "Failed to log share event" });
  }
});

router.get("/api/content-assets/latest", async (req: Request, res: Response) => {
  try {
    if (!isAuthenticated(req)) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const userId = getUserId(req)!;
    const { matchId, challengeId } = req.query;

    let sourceEventId: string | undefined;
    if (matchId) sourceEventId = `match_${matchId}`;
    if (challengeId) sourceEventId = `daily5_${challengeId}`;

    if (sourceEventId) {
      const assets = await db.select()
        .from(contentAssets)
        .where(and(
          eq(contentAssets.userId, userId),
          eq(contentAssets.sourceEventId, sourceEventId),
        ))
        .orderBy(desc(contentAssets.createdAt))
        .limit(5);
      return res.json({ assets });
    }

    const assets = await db.select()
      .from(contentAssets)
      .where(eq(contentAssets.userId, userId))
      .orderBy(desc(contentAssets.createdAt))
      .limit(10);

    return res.json({ assets });
  } catch (err: any) {
    console.error("[ContentAssets] Error:", err?.message);
    return res.status(500).json({ message: "Failed to get content assets" });
  }
});

export default router;
