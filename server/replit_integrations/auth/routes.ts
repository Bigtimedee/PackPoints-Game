import type { Express } from "express";
import { authStorage } from "./storage";
import * as client from "openid-client";
import memoize from "memoizee";

const getOidcConfig = memoize(
  async () => {
    return await client.discovery(
      new URL(process.env.ISSUER_URL ?? "https://replit.com/oidc"),
      process.env.REPL_ID!
    );
  },
  { maxAge: 3600 * 1000 }
);

// Register auth-specific routes
export function registerAuthRoutes(app: Express): void {
  // Get current authenticated user (checks both Replit Auth and local auth)
  app.get("/api/auth/user", async (req: any, res) => {
    try {
      // First check for Replit Auth user
      if (req.isAuthenticated() && req.user?.claims?.sub) {
        const user = req.user;
        const now = Math.floor(Date.now() / 1000);
        
        // Check if token needs refresh
        if (user.expires_at && now > user.expires_at && user.refresh_token) {
          try {
            const config = await getOidcConfig();
            const tokenResponse = await client.refreshTokenGrant(config, user.refresh_token);
            user.claims = tokenResponse.claims();
            user.access_token = tokenResponse.access_token;
            user.refresh_token = tokenResponse.refresh_token;
            user.expires_at = user.claims?.exp;
          } catch (refreshError) {
            // Token refresh failed, user needs to re-authenticate
            return res.status(401).json({ message: "Unauthorized" });
          }
        }
        
        const userId = req.user.claims.sub;
        const dbUser = await authStorage.getUser(userId);
        if (dbUser) {
          return res.json(dbUser);
        }
      }
      
      // Then check for local auth user
      if (req.session?.localUserId) {
        const user = await authStorage.getUser(req.session.localUserId);
        if (user) {
          return res.json(user);
        }
      }
      
      // No authenticated user found
      return res.status(401).json({ message: "Unauthorized" });
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });
}
