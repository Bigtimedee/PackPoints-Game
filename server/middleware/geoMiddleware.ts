import { Request, Response, NextFunction } from "express";
import { geoService } from "../services/geoService";

export async function collectGeo(req: Request, res: Response, next: NextFunction) {
  try {
    const user = req.user as any;
    const session = req.session as any;
    
    const userId = user?.claims?.sub || session?.localUserId;
    const sessionId = session?.id || req.sessionID;
    
    let ip = req.ip || req.socket.remoteAddress || "";
    const forwardedFor = req.headers["x-forwarded-for"];
    if (forwardedFor) {
      ip = (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor).split(",")[0].trim();
    }
    
    const timezone = req.headers["x-client-timezone"] as string | undefined;
    const userAgent = req.headers["user-agent"];
    
    const ipHash = geoService.hashIp(ip);
    const geoData = await geoService.resolveGeo(ip);
    
    const existingSameRegion = await geoService.checkRecentSameRegion(ipHash, geoData.region);
    const confidence = geoService.computeConfidence(geoData, timezone, existingSameRegion);
    
    await geoService.upsertGeoSession({
      userId,
      sessionId,
      ipHash,
      userAgent,
      timezone,
      country: geoData.country,
      region: geoData.region,
      asn: geoData.asn,
      carrierName: geoData.carrierName,
      isVpn: geoData.isVpn,
      source: "http",
      geoConfidence: confidence,
    });
    
  } catch (error) {
    console.error("[GeoMiddleware] Error collecting geo:", error);
  }
  
  next();
}

export async function collectGeoWs(
  userId: string | undefined,
  sessionId: string | undefined,
  ip: string,
  userAgent?: string,
  timezone?: string
): Promise<void> {
  try {
    const ipHash = geoService.hashIp(ip);
    const geoData = await geoService.resolveGeo(ip);
    
    const existingSameRegion = await geoService.checkRecentSameRegion(ipHash, geoData.region);
    const confidence = geoService.computeConfidence(geoData, timezone, existingSameRegion);
    
    await geoService.upsertGeoSession({
      userId,
      sessionId,
      ipHash,
      userAgent,
      timezone,
      country: geoData.country,
      region: geoData.region,
      asn: geoData.asn,
      carrierName: geoData.carrierName,
      isVpn: geoData.isVpn,
      source: "ws",
      geoConfidence: confidence,
    });
    
  } catch (error) {
    console.error("[GeoMiddleware] Error collecting geo for WS:", error);
  }
}
