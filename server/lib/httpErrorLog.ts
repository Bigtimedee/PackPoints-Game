/**
 * Missing Vite chunks 404 from express.static. Logging the Error object prints
 * an ENOENT stack for every stale tab. Those are one line.
 */
export function isAssetNotFound(
  err: { status?: number; statusCode?: number; code?: string } | null | undefined,
  urlPath: string,
): boolean {
  if (!urlPath.startsWith("/assets")) return false;
  const status = err?.status || err?.statusCode;
  return status === 404 || err?.code === "ENOENT";
}

export function assetNotFoundLine(method: string, urlPath: string): string {
  const pathOnly = urlPath.split("?")[0] || urlPath;
  return `[Static] 404 ${method || "GET"} ${pathOnly}`;
}

export function logServerError(
  err: { status?: number; statusCode?: number; code?: string; message?: string },
  req?: { method?: string; originalUrl?: string; path?: string },
): void {
  const url = req?.originalUrl || req?.path || "";
  if (isAssetNotFound(err, url.split("?")[0] || url)) {
    console.log(assetNotFoundLine(req?.method || "GET", url));
    return;
  }
  console.error("[Error]", err);
}
