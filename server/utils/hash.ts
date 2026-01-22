import { createHash } from "crypto";

const IP_HASH_SALT = process.env.IP_HASH_SALT || "default-ip-salt-change-in-production";
const DEVICE_HASH_SALT = process.env.DEVICE_HASH_SALT || "default-device-salt-change-in-production";

export function hashIp(ip: string): string {
  if (!ip) return "";
  return createHash("sha256")
    .update(IP_HASH_SALT + ip)
    .digest("hex");
}

export function hashDeviceId(deviceId: string): string {
  if (!deviceId) return "";
  return createHash("sha256")
    .update(DEVICE_HASH_SALT + deviceId)
    .digest("hex");
}

export function deriveDeviceIdFromRequest(
  clientDeviceId: string | undefined,
  userAgent: string | undefined,
  ipHash: string | undefined
): { deviceId: string; isStable: boolean } {
  if (clientDeviceId) {
    return {
      deviceId: hashDeviceId(clientDeviceId),
      isStable: true,
    };
  }
  
  const fallback = (userAgent || "unknown") + (ipHash || "");
  if (!fallback || fallback === "unknown") {
    console.warn("[RiskPipeline] Unable to derive stable device ID - no client device ID, user agent, or IP");
  }
  
  return {
    deviceId: createHash("sha256")
      .update(DEVICE_HASH_SALT + fallback)
      .digest("hex"),
    isStable: false,
  };
}

export function extractIpCountry(req: { headers?: Record<string, string | string[] | undefined> }): string | null {
  if (!req.headers) return null;
  
  const country = req.headers["cf-ipcountry"] || 
                  req.headers["x-country-code"] || 
                  req.headers["x-vercel-ip-country"];
  
  if (Array.isArray(country)) {
    return country[0] || null;
  }
  
  return country || null;
}

export function extractClientIp(req: { 
  headers?: Record<string, string | string[] | undefined>;
  ip?: string;
  socket?: { remoteAddress?: string };
}): string | null {
  if (!req) return null;
  
  const forwardedFor = req.headers?.["x-forwarded-for"];
  if (forwardedFor) {
    const ip = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor.split(",")[0];
    return ip?.trim() || null;
  }
  
  const realIp = req.headers?.["x-real-ip"];
  if (realIp) {
    return Array.isArray(realIp) ? realIp[0] : realIp;
  }
  
  return req.ip || req.socket?.remoteAddress || null;
}

export function extractDeviceIdFromRequest(req: {
  headers?: Record<string, string | string[] | undefined>;
}): string | undefined {
  if (!req.headers) return undefined;
  
  const deviceId = req.headers["x-device-id"];
  if (Array.isArray(deviceId)) {
    return deviceId[0];
  }
  return deviceId;
}
