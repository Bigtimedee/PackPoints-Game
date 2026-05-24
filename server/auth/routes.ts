import type { Express } from "express";
import { authStorage } from "./storage";
import { collectGeo } from "../middleware/geoMiddleware";

// Register auth-specific routes
export function registerAuthRoutes(app: Express): void {
  // Return the currently authenticated user, resolving across the supported
  // session shapes (local-login sets session.localUserId; WorkOS sets
  // session.workosUserId).
  app.get("/api/auth/user", collectGeo, async (req: any, res) => {
    try {
      console.log("[Auth Debug] /api/auth/user called", {
        isAuthenticated: req.isAuthenticated?.() ?? false,
        hasUser: !!req.user,
        hasSession: !!req.session,
        sessionId: req.sessionID ? req.sessionID.substring(0, 8) + "..." : null,
        localUserId: req.session?.localUserId ? "set" : "not set",
        workosUserId: req.session?.workosUserId ? "set" : "not set",
      });

      if (req.session?.localUserId) {
        const user = await authStorage.getUser(req.session.localUserId);
        if (user) {
          return res.json(user);
        }
      }

      if (req.session?.workosUserId) {
        const user = await authStorage.getUserByWorkosId(req.session.workosUserId);
        if (user) {
          return res.json(user);
        }
      }

      return res.status(401).json({ message: "Unauthorized" });
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });
}
