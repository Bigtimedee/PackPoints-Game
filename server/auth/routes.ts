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
      if (req.session?.localUserId) {
        const user = await authStorage.getUser(req.session.localUserId);
        if (user) {
          void import("../services/growthStage1")
            .then(({ noteGrowthActivity }) => noteGrowthActivity(user.id))
            .catch(() => undefined);
          return res.json(user);
        }
      }

      if (req.session?.workosUserId) {
        const user = await authStorage.getUserByWorkosId(req.session.workosUserId);
        if (user) {
          void import("../services/growthStage1")
            .then(({ noteGrowthActivity }) => noteGrowthActivity(user.id))
            .catch(() => undefined);
          return res.json(user);
        }
      }

      // 200 null, not 401. Guests hit this on every page; a 401 is a console error.
      return res.json(null);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });
}
