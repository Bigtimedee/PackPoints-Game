import type { Request, RequestHandler } from "express";
import type { GameSession } from "@shared/schema";

/** Server-authenticated identity proves ownership. IDs/fingerprints are not
 * permission. Reading must never claim or migrate a guest round. */
export function ownsStoredRound(req: Request, round: GameSession): boolean {
  const identity = req as Request & { user?: Express.User & { claims?: { sub?: string } }; session: Request["session"] & { guestId?: string } };
  const localId = identity.session?.localUserId;
  const passportId = req.isAuthenticated?.() ? identity.user?.claims?.sub : undefined;
  if (localId && passportId && localId !== passportId) return false;
  const userId = localId || passportId;
  if (round.userId) return !!userId && round.userId === userId;
  return !userId && !!round.guestSessionId && identity.session?.guestId === round.guestSessionId;
}
export function createGameSessionReadHandler(deps: {
  getGameSession: (id: string) => Promise<GameSession | undefined>;
  sanitize: (round: GameSession) => unknown;
}): RequestHandler {
  return async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    try {
      const round = await deps.getGameSession(req.params.id);
      if (!round) { res.status(404).json({ error: "Round not found" }); return; }
      if (!ownsStoredRound(req, round)) { res.status(403).json({ error: "Round access denied" }); return; }
      if (round.status === "expired") { res.status(410).json({ error: "Round expired" }); return; }
      res.json(deps.sanitize(round));
    } catch (error) {
      console.error("Error getting session:", error);
      res.status(500).json({ error: "Failed to get session" });
    }
  };
}

/** Solo report ownership only; null leaves public/non-Solo reports unchanged. */
export function createSoloRoundOwnershipGuard(deps: {
  getGameSession: (id: string) => Promise<GameSession | undefined>;
  getSessionId: (req: Request) => string | null;
}): RequestHandler {
  return async (req, res, next) => {
    try {
      const id = deps.getSessionId(req);
      if (id === null) { next(); return; }
      const round = await deps.getGameSession(id);
      if (!round) { res.status(404).json({ error: "Session not found" }); return; }
      if (!ownsStoredRound(req, round)) { res.status(403).json({ error: "Round access denied" }); return; }
      next();
    } catch (error) {
      console.error("Error checking Solo report ownership:", error);
      res.status(500).json({ error: "Failed to check round access" });
    }
  };
}
