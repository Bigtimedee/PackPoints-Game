import type { Express } from "express";
import { authStorage } from "./storage";
import { collectGeo } from "../middleware/geoMiddleware";
import { authenticatedAccount } from "./sessionIdentity";

// Register auth-specific routes
export function registerAuthRoutes(app: Express): void {
  // Same session shapes as isAuthenticated. A workosUserId with no localUserId
  // is an unproven link challenge and is not a signed-in user.
  app.get("/api/auth/user", collectGeo, async (req: any, res) => {
    try {
      const user = await authenticatedAccount(req, (id) => authStorage.getUser(id));
      if (user) {
        void import("../services/growthStage1")
          .then(({ noteGrowthActivity }) => noteGrowthActivity(user.id))
          .catch(() => undefined);
        return res.json(user);
      }

      // 200 null, not 401. Guests hit this on every page; a 401 is a console error.
      return res.json(null);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });
}
