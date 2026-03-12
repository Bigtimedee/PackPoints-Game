import { Request, Response, NextFunction } from "express";
import { quotaService, type UserTier } from "../services/quotaService";
import { tokenService } from "../services/tokenService";
import { storage } from "../storage";
import { TIER_CONFIG } from "@shared/schema";

declare module "express-session" {
  interface SessionData {
    userId?: string;
    guestSessionId?: string;
  }
}

export interface AuthenticatedRequest extends Request {
  userId?: string;
  userTier?: UserTier;
  isGuest?: boolean;
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const userId = (req as any).user?.id || req.session?.userId;
  
  if (!userId) {
    return res.status(401).json({ error: "Authentication required" });
  }
  
  req.userId = userId;
  req.isGuest = false;
  next();
}

export function allowGuest(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const userId = (req as any).user?.id || req.session?.userId;
  
  if (userId) {
    req.userId = userId;
    req.isGuest = false;
  } else {
    if (!req.session?.guestSessionId) {
      req.session!.guestSessionId = `guest_${Date.now()}_${require('crypto').randomBytes(8).toString('hex')}`;
    }
    req.userId = req.session.guestSessionId;
    req.isGuest = true;
  }
  
  next();
}

export function requireEntitlement(entitlementKey: string) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const userId = req.userId;
    
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    try {
      const hasEntitlement = await storage.hasEntitlement(userId, entitlementKey);
      
      if (!hasEntitlement) {
        return res.status(403).json({ 
          error: "Access denied",
          requiredEntitlement: entitlementKey,
          message: `This feature requires the ${entitlementKey} entitlement`,
        });
      }
      
      next();
    } catch (error) {
      console.error("Error checking entitlement:", error);
      res.status(500).json({ error: "Failed to check entitlement" });
    }
  };
}

export function requireModeAccess(mode: string) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const userId = req.userId;
    
    if (!userId || req.isGuest) {
      const freeModes = TIER_CONFIG.FREE.allowedModes;
      if (!freeModes.includes(mode)) {
        return res.status(401).json({ 
          error: "Authentication required",
          message: `Mode '${mode}' requires an account`,
        });
      }
      next();
      return;
    }

    try {
      const tier = await quotaService.getUserTier(userId);
      const config = TIER_CONFIG[tier];
      
      if (!config.allowedModes.includes(mode)) {
        const requiredTier = mode === "legend" ? "LEGEND" : "PRO";
        return res.status(403).json({ 
          error: "Upgrade required",
          currentTier: tier,
          requiredTier,
          message: `Mode '${mode}' requires ${requiredTier === "LEGEND" ? "Legend Pass" : "Pro subscription"}`,
        });
      }
      
      req.userTier = tier;
      next();
    } catch (error) {
      console.error("Error checking mode access:", error);
      res.status(500).json({ error: "Failed to check access" });
    }
  };
}

export function checkDailyQuota(mode: string) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const userId = req.userId;
    
    if (!userId || req.isGuest) {
      next();
      return;
    }

    try {
      const quotaCheck = await quotaService.checkQuota(userId, mode);
      
      if (!quotaCheck.allowed) {
        return res.status(429).json({ 
          error: "Quota exceeded",
          tier: quotaCheck.tier,
          dailyUsed: quotaCheck.dailyUsed,
          dailyLimit: quotaCheck.dailyLimit,
          reason: quotaCheck.reason,
          message: "Daily match limit reached. Upgrade to Pro for unlimited matches.",
        });
      }
      
      req.userTier = quotaCheck.tier;
      next();
    } catch (error) {
      console.error("Error checking quota:", error);
      res.status(500).json({ error: "Failed to check quota" });
    }
  };
}

export function checkHourlyLimit(mode: string) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const userId = req.userId;
    
    if (!userId || req.isGuest) {
      next();
      return;
    }

    try {
      const tier = req.userTier || await quotaService.getUserTier(userId);
      const hourlyLimit = TIER_CONFIG[tier].hourlyMatchLimit;
      const tokensInLastHour = await tokenService.countTokensInLastHour(userId);
      
      if (tokensInLastHour >= hourlyLimit) {
        return res.status(429).json({ 
          error: "Rate limited",
          hourlyUsed: tokensInLastHour,
          hourlyLimit,
          message: `Maximum ${hourlyLimit} matches per hour. Please wait before starting another match.`,
        });
      }
      
      next();
    } catch (error) {
      console.error("Error checking hourly limit:", error);
      res.status(500).json({ error: "Failed to check rate limit" });
    }
  };
}

export async function consumeDailyQuota(
  userId: string,
  mode: string,
  type: "start" | "complete"
): Promise<{ success: boolean; error?: string }> {
  try {
    if (type === "start") {
      const result = await quotaService.incrementMatchStarted(userId, mode);
      return { success: result.success, error: result.error };
    } else {
      const result = await quotaService.incrementMatchCompleted(userId, mode);
      return { success: result.success, error: result.error };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to consume quota",
    };
  }
}

export async function validateMatchToken(
  token: string,
  signature: string,
  userId: string
): Promise<{
  valid: boolean;
  matchToken?: any;
  error?: string;
}> {
  const result = await tokenService.validateToken(token, signature, userId);
  
  return {
    valid: result.success,
    matchToken: result.matchToken,
    error: result.error,
  };
}
