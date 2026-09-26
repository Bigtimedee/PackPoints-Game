import type { NextFunction, Request, Response } from "express";
import { storage } from "../storage";

// Session admin gate. 401 when logged out, 403 when the user is not an admin.
export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const user = req.user as { claims?: { sub?: string } } | undefined;
  const session = req.session as { localUserId?: string } | undefined;
  const userId = user?.claims?.sub || session?.localUserId;

  if (!userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const dbUser = await storage.getUser(userId);
  if (!dbUser?.isAdmin) {
    return res.status(403).json({ message: "Admin access required" });
  }

  next();
}
