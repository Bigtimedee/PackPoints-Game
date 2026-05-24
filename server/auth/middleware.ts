import type { Express, RequestHandler } from "express";
import passport from "passport";
import { getSession } from "./session";

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());
  passport.serializeUser((user: Express.User, cb) => cb(null, user));
  passport.deserializeUser((user: Express.User, cb) => cb(null, user));
}

export const isAuthenticated: RequestHandler = (req, res, next) => {
  const session = req.session as any;
  if (session?.localUserId) {
    return next();
  }
  const user = req.user as any;
  if (req.isAuthenticated?.() && user?.claims?.sub) {
    return next();
  }
  return res.status(401).json({ message: "Unauthorized" });
};
