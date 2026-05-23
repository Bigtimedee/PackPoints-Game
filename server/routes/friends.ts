import { Router, Request, Response } from "express";
import { friendshipService } from "../services/friends/friendshipService";
import { friendMatchInviteService } from "../services/friends/friendMatchInviteService";
import { z } from "zod";

const router = Router();

function isAuthenticated(req: any, res: Response, next: Function) {
  // Support both Replit OAuth (req.user.claims.sub) and local-login
  // (req.session.localUserId). Without this, local-login users 401 on
  // every friend endpoint even though they are correctly authenticated.
  const userId = req.user?.id || req.user?.claims?.sub || req.session?.localUserId;
  if (!userId) {
    return res.status(401).json({
      error: "Unauthorized",
      debug_v: "battles-auth-fix-v2",
    });
  }
  if (!req.user) req.user = { id: userId };
  else if (!req.user.id) req.user.id = userId;
  next();
}

router.get("/api/users/search", isAuthenticated, async (req: any, res: Response) => {
  try {
    const handlePrefix = req.query.handlePrefix as string;
    
    if (!handlePrefix || handlePrefix.length < 3) {
      return res.status(400).json({ error: "Handle prefix must be at least 3 characters" });
    }
    
    const users = await friendshipService.searchUsersByUsername(handlePrefix, req.user.id);
    res.json({ users });
  } catch (error) {
    console.error("User search error:", error);
    res.status(500).json({ error: "Failed to search users" });
  }
});

router.get("/api/friends", isAuthenticated, async (req: any, res: Response) => {
  try {
    const userId = req.user.id;
    const [accepted, pending] = await Promise.all([
      friendshipService.getAcceptedFriends(userId),
      friendshipService.getPendingFriendRequests(userId),
    ]);
    
    res.json({ 
      accepted, 
      pendingIncoming: pending.incoming, 
      pendingOutgoing: pending.outgoing 
    });
  } catch (error) {
    console.error("Get friends error:", error);
    res.status(500).json({ error: "Failed to get friends" });
  }
});

const friendRequestSchema = z.object({
  toUserId: z.string().min(1),
});

router.post("/api/friends/request", isAuthenticated, async (req: any, res: Response) => {
  try {
    const parsed = friendRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request body" });
    }
    
    const result = await friendshipService.sendFriendRequest(req.user.id, parsed.data.toUserId);
    
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    
    res.json({ success: true, friendship: result.friendship });
  } catch (error) {
    console.error("Friend request error:", error);
    res.status(500).json({ error: "Failed to send friend request" });
  }
});

const friendRespondSchema = z.object({
  friendshipId: z.string().min(1),
  action: z.enum(["ACCEPT", "DECLINE", "BLOCK"]),
});

router.post("/api/friends/respond", isAuthenticated, async (req: any, res: Response) => {
  try {
    const parsed = friendRespondSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request body" });
    }
    
    const { friendshipId, action } = parsed.data;
    let result;
    
    if (action === "ACCEPT") {
      result = await friendshipService.acceptFriendRequest(friendshipId, req.user.id);
    } else if (action === "DECLINE") {
      result = await friendshipService.declineFriendRequest(friendshipId, req.user.id);
    } else if (action === "BLOCK") {
      const friendship = await friendshipService.getFriendshipById(friendshipId);
      if (friendship && (friendship.userLow === req.user.id || friendship.userHigh === req.user.id)) {
        const otherId = friendship.userLow === req.user.id ? friendship.userHigh : friendship.userLow;
        result = await friendshipService.blockUser(req.user.id, otherId);
      } else {
        result = { success: false, error: "Friendship not found" };
      }
    }
    
    if (!result?.success) {
      return res.status(400).json({ error: result?.error || "Failed to respond" });
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error("Friend respond error:", error);
    res.status(500).json({ error: "Failed to respond to friend request" });
  }
});

router.delete("/api/friends/:friendId", isAuthenticated, async (req: any, res: Response) => {
  try {
    const result = await friendshipService.removeFriend(req.user.id, req.params.friendId);
    
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error("Remove friend error:", error);
    res.status(500).json({ error: "Failed to remove friend" });
  }
});

const matchInviteSchema = z.object({
  toUserId: z.string().min(1),
  bucket: z.string().optional().default("ANY"),
});

router.post("/api/matches/friends/invite", isAuthenticated, async (req: any, res: Response) => {
  try {
    const parsed = matchInviteSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request body" });
    }
    
    const result = await friendMatchInviteService.createFriendMatchInvite(
      req.user.id,
      parsed.data.toUserId,
      parsed.data.bucket
    );
    
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    
    res.json({ 
      success: true, 
      inviteId: result.invite?.id,
      expiresAt: result.invite?.expiresAt,
    });
  } catch (error) {
    console.error("Match invite error:", error);
    res.status(500).json({ error: "Failed to create match invite" });
  }
});

const cancelInviteSchema = z.object({
  inviteId: z.string().min(1),
});

router.post("/api/matches/friends/cancel", isAuthenticated, async (req: any, res: Response) => {
  try {
    const parsed = cancelInviteSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request body" });
    }
    
    const result = await friendMatchInviteService.cancelFriendMatchInvite(
      parsed.data.inviteId,
      req.user.id
    );
    
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error("Cancel invite error:", error);
    res.status(500).json({ error: "Failed to cancel invite" });
  }
});

const respondInviteSchema = z.object({
  inviteId: z.string().min(1),
  action: z.enum(["ACCEPT", "DECLINE"]),
});

router.post("/api/matches/friends/respond", isAuthenticated, async (req: any, res: Response) => {
  try {
    const parsed = respondInviteSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request body" });
    }
    
    const result = await friendMatchInviteService.respondToFriendMatchInvite(
      parsed.data.inviteId,
      req.user.id,
      parsed.data.action
    );
    
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    
    res.json({ 
      success: true, 
      matchId: result.matchId,
      lobbyId: result.lobbyId,
    });
  } catch (error) {
    console.error("Respond invite error:", error);
    res.status(500).json({ error: "Failed to respond to invite" });
  }
});

router.get("/api/matches/friends/inbox", isAuthenticated, async (req: any, res: Response) => {
  try {
    const [incoming, outgoing] = await Promise.all([
      friendMatchInviteService.getIncomingInvites(req.user.id),
      friendMatchInviteService.getOutgoingInvites(req.user.id),
    ]);
    
    res.json({ incoming, outgoing });
  } catch (error) {
    console.error("Get inbox error:", error);
    res.status(500).json({ error: "Failed to get invites" });
  }
});

export default router;
