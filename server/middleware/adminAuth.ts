import type { Request, Response, NextFunction } from "express";

export function requireAdminAuth(req: Request, res: Response, next: NextFunction) {
  const adminApiKey = process.env.ADMIN_API_KEY;
  
  if (!adminApiKey) {
    console.warn("ADMIN_API_KEY not configured - admin endpoints disabled");
    return res.status(503).json({ 
      error: "Admin endpoints not configured",
      message: "Please set ADMIN_API_KEY environment variable"
    });
  }
  
  const providedKey = req.headers["x-admin-key"] || req.headers["authorization"]?.replace("Bearer ", "");
  
  if (!providedKey) {
    return res.status(401).json({ 
      error: "Unauthorized",
      message: "Admin API key required. Provide via X-Admin-Key header."
    });
  }
  
  if (providedKey !== adminApiKey) {
    return res.status(403).json({ 
      error: "Forbidden",
      message: "Invalid admin API key"
    });
  }
  
  next();
}
