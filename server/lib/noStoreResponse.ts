/**
 * Responses that must not be reused from a browser cache, a 304, or the
 * Railway edge. `private` and `no-store` are the directives the edge treats
 * as uncacheable. Conditional validators are stripped so Express cannot
 * answer If-None-Match / If-Modified-Since with an empty 304.
 */

import type { Request, Response } from "express";

export const NO_STORE_CACHE_CONTROL = "private, no-store, no-cache, must-revalidate";
export const ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable";

export function applyNoStoreHeaders(res: Response): void {
  res.setHeader("Cache-Control", NO_STORE_CACHE_CONTROL);
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("CDN-Cache-Control", "no-store");
  res.setHeader("Surrogate-Control", "no-store");
  res.removeHeader("ETag");
  res.removeHeader("Last-Modified");
}

export function stripConditionalValidators(req: Request): void {
  delete req.headers["if-none-match"];
  delete req.headers["if-modified-since"];
}

/** Full 200 body. Does not go through res.json / res.sendFile, which emit ETags. */
export function sendNoStoreBody(req: Request, res: Response, body: string, contentType: string): void {
  stripConditionalValidators(req);
  applyNoStoreHeaders(res);
  res.status(200);
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Length", Buffer.byteLength(body));
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  res.end(body);
}
