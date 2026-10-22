import { Router, Request, Response } from "express";
import { db } from "../db";
import { referralLinks, referralAttributions, shareEvents, users, contentAssets, type ContentAsset } from "@shared/schema";
import { anonPlayerIdFromCookie } from "../services/anonIdentity";
import { getOrCreateGuestInvite, guestInvitePreview, redeemGuestInvite } from "../services/guestInvites";
import { eq, and, sql, desc, gte } from "drizzle-orm";
import crypto from "crypto";

const router = Router();

function generateShortCode(): string {
  return crypto.randomBytes(5).toString("base64url").slice(0, 8);
}

function isAuthenticated(req: Request): boolean {
  return !!(req.user as any)?.claims?.sub
    || !!(req.session as any)?.localUserId
    || !!(req.session as any)?.userId;
}

function getUserId(req: Request): string | null {
  return (req.user as any)?.claims?.sub
    || (req.session as any)?.localUserId
    || (req.session as any)?.userId
    || null;
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

const INVITE_SURFACES = new Set(["game_complete", "wallet", "share_card", "friends", "faq", "points", "daily5"]);
/** Where the invite link was shared from. Unknown values collapse to "link". */
export function inviteSurface(raw: unknown): string {
  return typeof raw === "string" && INVITE_SURFACES.has(raw) ? raw : "link";
}

/** Canonical public origin for links we hand out. */
function publicBase(req: Request): string {
  const host = req.get("host") || "packpts.com";
  if (/(^|\.)packpts\.com$/i.test(host)) return "https://packpts.com";
  return `${(req as any).protocol}://${host}`;
}

/** The user's stable INVITE link (one per user, reused). */
export async function getOrCreateInviteCode(userId: string): Promise<string> {
  const [existing] = await db.select({ code: referralLinks.code }).from(referralLinks)
    .where(and(eq(referralLinks.createdByUserId, userId), eq(referralLinks.purpose, "INVITE"), eq(referralLinks.isActive, true)))
    .orderBy(desc(referralLinks.createdAt)).limit(1);
  if (existing) return existing.code;
  let code = generateShortCode();
  for (let i = 0; i < 5; i++) {
    const clash = await db.select({ id: referralLinks.id }).from(referralLinks).where(eq(referralLinks.code, code)).limit(1);
    if (clash.length === 0) break;
    code = generateShortCode();
  }
  await db.insert(referralLinks).values({ code, createdByUserId: userId, purpose: "INVITE", destinationPath: "/", isActive: true });
  return code;
}

export const INVITE_SHARE_LINE = "Name the player on the cards you grew up with. Play free with my link:";

router.get("/api/referrals/preview", async (req: Request, res: Response) => {
  const code = typeof req.query.code === "string" ? req.query.code : "";
  if (!/^[A-Za-z0-9_-]{4,20}$/.test(code)) {
    return res.status(400).json({ error: "Invalid code" });
  }
  try {
    const preview = await guestInvitePreview(code);
    if (!preview) return res.status(404).json({ error: "Invite not found" });
    return res.json(preview);
  } catch (err: any) {
    console.error("[Referral] preview error:", err?.message);
    return res.status(500).json({ error: "Failed to load invite" });
  }
});

router.get("/api/referrals/offer", async (req: Request, res: Response) => {
  try {
    const { referralOfferFor } = await import("../services/referralProgram");
    const userId = isAuthenticated(req) ? getUserId(req) : null;
    const offer = await referralOfferFor(userId);
    if (!userId) {
      const anonId = await anonPlayerIdFromCookie(req);
      if (!anonId) return res.json(offer);
      const guest = await getOrCreateGuestInvite(anonId);
      if (!guest) return res.json(offer);
      const base = publicBase(req);
      return res.json({ ...offer, code: guest.code, url: `${base}/r/${guest.code}`, shareLine: INVITE_SHARE_LINE });
    }
    const code = await getOrCreateInviteCode(userId);
    const base = publicBase(req);
    return res.json({ ...offer, code, url: `${base}/r/${code}`, shareLine: INVITE_SHARE_LINE });
  } catch (err: any) {
    console.error("[Referral] offer error:", err?.message);
    return res.status(500).json({ message: "Failed to load invite offer" });
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
      const preview = await guestInvitePreview(code);
      if (!preview) return res.redirect("/");
      const refParam = encodeURIComponent(code);
      const surface = inviteSurface(req.query.s);
      return res.redirect(`/daily5?ref=${refParam}&utm_source=invite&utm_medium=share&utm_content=${surface}`);
    }

    if (link.expiresAt && new Date(link.expiresAt) < new Date()) {
      return res.redirect("/");
    }

    await db.update(referralLinks)
      .set({ clickCount: sql`${referralLinks.clickCount} + 1` })
      .where(eq(referralLinks.id, link.id));

    // Same-site paths only, so a stored destination can never redirect off-site.
    const rawPath = typeof link.destinationPath === "string" ? link.destinationPath : "/";
    const safePath = rawPath.startsWith("/") && !rawPath.startsWith("//") && !rawPath.includes("\\")
      ? rawPath
      : "/";
    const refParam = encodeURIComponent(link.code);
    let destination = safePath.includes("?")
      ? `${safePath}&ref=${refParam}`
      : `${safePath}?ref=${refParam}`;
    if (link.purpose === "INVITE") {
      const surface = inviteSurface(req.query.s);
      destination += `&utm_source=invite&utm_medium=share&utm_content=${surface}`;
      const { recordInviteClick } = await import("../services/funnel");
      recordInviteClick(req, res, link.code, surface);
    }

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
    // FIRST_MATCH pays the inviter, so only the server may record it, when it
    // sees a real completed game (referralProgram.onRegisteredGameComplete).
    if (eventType === "FIRST_MATCH") {
      return res.status(403).json({ attributed: false, reason: "First game is detected by the server" });
    }

    const [link] = await db.select()
      .from(referralLinks)
      .where(and(eq(referralLinks.code, refCode), eq(referralLinks.isActive, true)))
      .limit(1);

    if (!link) {
      const { riskCtxFrom } = await import("../lib/signupAttribution");
      const pending = await redeemGuestInvite(refCode, userId, await riskCtxFrom(req));
      if (pending === "pending") return res.json({ attributed: true, pending: true });
      return res.json({ attributed: false, reason: "Link not found" });
    }

    if (link.createdByUserId === userId) {
      return res.json({ attributed: false, reason: "Cannot self-refer" });
    }

    // A SIGNUP attribution only makes sense for a brand new account; an old
    // account claiming one later would just be farming the welcome bonus.
    if (eventType === "SIGNUP") {
      const [u] = await db.select({ createdAt: users.createdAt }).from(users).where(eq(users.id, userId)).limit(1);
      if (!u?.createdAt || Date.now() - new Date(u.createdAt).getTime() > 24 * 60 * 60 * 1000) {
        return res.json({ attributed: false, reason: "Account is not new" });
      }
    }

    try {
      await db.insert(referralAttributions).values({
        referralLinkId: link.id,
        invitedUserId: userId,
        eventType: eventType as any,
      });

      if (eventType === "SIGNUP") {
        // Same fraud rules, hold and clawback as the first-game reward.
        const { evaluateWelcomeBonus } = await import("../services/referralProgram");
        const { riskCtxFrom } = await import("../lib/signupAttribution");
        await evaluateWelcomeBonus(userId, link.id, await riskCtxFrom(req));
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

    // Calculate ambassador tier based on total successful signups
    const { calculateAmbassadorTier } = await import("../services/referralRewards");
    const tier = calculateAmbassadorTier(signups);

    // Get an invite-type link for the referral link URL
    const inviteLink = links.find(l => l.purpose === "INVITE") || links[0] || null;
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const referralLink = inviteLink
      ? `${baseUrl}/r/${inviteLink.code}`
      : null;

    return res.json({
      totalLinks: links.length,
      totalClicks,
      signups,
      firstMatches,
      tier,
      referralLink,
    });
  } catch (err: any) {
    console.error("[Referral] Stats error:", err?.message);
    return res.status(500).json({ message: "Failed to get referral stats" });
  }
});

router.get("/api/referrals/leaderboard", async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);

    // Count SIGNUP attributions per referrer via referral_links join
    const rows = await db.execute(
      sql`
        SELECT
          u.id,
          u.username,
          rl.code AS referral_code,
          COUNT(ra.id)::int AS referral_count,
          RANK() OVER (ORDER BY COUNT(ra.id) DESC)::int AS rank
        FROM users u
        JOIN referral_links rl ON rl.created_by_user_id = u.id
        LEFT JOIN referral_attributions ra
          ON ra.referral_link_id = rl.id
          AND ra.event_type = 'SIGNUP'
        GROUP BY u.id, u.username, rl.code
        HAVING COUNT(ra.id) > 0
        ORDER BY referral_count DESC
        LIMIT ${limit}
      `
    );

    return res.json({ leaderboard: rows.rows });
  } catch (err: any) {
    console.error("[Referral] Leaderboard error:", err?.message);
    return res.status(500).json({ message: "Failed to get referral leaderboard" });
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

async function repairAssets(assets: ContentAsset[]) {
  const { ensureAssetImage } = await import("../contentFactory/index");
  const repaired = [];
  for (const asset of assets) {
    try {
      repaired.push(await ensureAssetImage(asset));
    } catch (err: any) {
      console.error("[ContentAssets] Repair failed:", err?.message);
      repaired.push(asset);
    }
  }
  return repaired;
}

router.get("/api/content-assets/latest", async (req: Request, res: Response) => {
  try {
    if (!isAuthenticated(req)) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const userId = getUserId(req)!;
    const { matchId, challengeId, setId } = req.query;

    let sourceEventId: string | undefined;
    if (typeof matchId === "string" && matchId) sourceEventId = `match_${matchId}`;
    if (typeof challengeId === "string" && challengeId) sourceEventId = `daily5_${challengeId}`;
    if (typeof setId === "string" && setId) sourceEventId = `maker_set_${setId}`;

    if (sourceEventId) {
      const assets = await db.select()
        .from(contentAssets)
        .where(and(
          eq(contentAssets.userId, userId),
          eq(contentAssets.sourceEventId, sourceEventId),
        ))
        .orderBy(desc(contentAssets.createdAt))
        .limit(5);
      return res.json({ assets: await repairAssets(assets) });
    }

    const assets = await db.select()
      .from(contentAssets)
      .where(eq(contentAssets.userId, userId))
      .orderBy(desc(contentAssets.createdAt))
      .limit(10);

    return res.json({ assets: await repairAssets(assets) });
  } catch (err: any) {
    console.error("[ContentAssets] Error:", err?.message);
    return res.status(500).json({ message: "Failed to get content assets" });
  }
});

router.post("/api/content-assets/retry", async (req: Request, res: Response) => {
  try {
    if (!isAuthenticated(req)) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const userId = getUserId(req)!;
    const { matchId, challengeId, setId } = req.body || {};

    let sourceEventId: string | undefined;
    if (typeof matchId === "string" && matchId) sourceEventId = `match_${matchId}`;
    if (typeof challengeId === "string" && challengeId) sourceEventId = `daily5_${challengeId}`;
    if (typeof setId === "string" && setId) sourceEventId = `maker_set_${setId}`;
    if (!sourceEventId) {
      return res.status(400).json({ message: "matchId, challengeId, or setId is required" });
    }

    const [asset] = await db.select()
      .from(contentAssets)
      .where(and(
        eq(contentAssets.userId, userId),
        eq(contentAssets.sourceEventId, sourceEventId),
      ))
      .orderBy(desc(contentAssets.createdAt))
      .limit(1);

    if (!asset) {
      return res.status(404).json({ message: "No share image to retry" });
    }

    const { ensureAssetImage } = await import("../contentFactory/index");
    const ready = await ensureAssetImage(asset, { force: true });
    const imageUrl = (ready.metadata as { imageUrl?: string } | null)?.imageUrl;
    if (!imageUrl) {
      return res.status(500).json({ message: "Score card generation failed" });
    }
    return res.json({ asset: ready });
  } catch (err: any) {
    console.error("[ContentAssets] Retry error:", err?.message);
    return res.status(500).json({ message: "Failed to regenerate score card" });
  }
});

// POST /api/share/generate - create a referral link + return share asset copy
// Combines link creation + share text in one call for the viral loop
router.post("/api/share/generate", async (req: Request, res: Response) => {
  try {
    if (!isAuthenticated(req)) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const userId = getUserId(req)!;
    const { purpose = "INVITE", context } = req.body || {};

    const code = await getOrCreateInviteCode(userId);

    const surface = inviteSurface(typeof context === "string" ? context : "friends");
    const referralUrl = `${publicBase(req)}/r/${code}?s=${surface}`;

    // One line everywhere (REFERRAL_SPEC.md). No dollar figures.
    const line = `${INVITE_SHARE_LINE} ${referralUrl}`;
    const shareText = { twitter: line, general: line, sms: line };

    return res.json({
      code,
      referralUrl,
      shareText,
      context: context || null,
    });
  } catch (err: any) {
    console.error("[Share] generate error:", err?.message);
    return res.status(500).json({ message: "Failed to generate share link" });
  }
});

export default router;
