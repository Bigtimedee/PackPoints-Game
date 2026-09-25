import type { Request, Response } from "express";
import path from "path";
import fs from "fs";
import { getCachedImageUrl, getOrValidateCardImage, getSourceUrlForCard, markImageBad } from "./images/imageGate";
import { withSourceFetchTimeout } from "./images/sourceFetch";
import { normalizeImageUrl } from "./cards/imageQuality";
import { acceptWarmMaskedFile, getMaskedImagePath, isMaskBakeTimeout, orientUnmaskedScan, peekWarmMaskedFilename, takeCoverageRefusal } from "../masking/maskingService";
import { maybeWriteWarmOkSidecar } from "../startup/warmSidecarBackfill";
import { CURRENT_MASK_VERSION } from "../masking/maskProfiles";
import { setUnmaskedHeaders } from "./playImageHttp";

function setUnmaskedResponseHeaders(res: Response, contentType: string): void {
  setUnmaskedHeaders(res);
  res.removeHeader("X-Card-Id");
  res.removeHeader("x-card-id");
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Security-Policy", "default-src 'none'; img-src 'self'");
  res.setHeader("X-Content-Type-Options", "nosniff");
}

function endUnmasked(res: Response, body?: Buffer): void {
  if (res.req?.method === "HEAD" || body === undefined) {
    res.end();
    return;
  }
  res.setHeader("Content-Length", String(body.length));
  res.end(body);
}

/** Original scan. Caller must already have authorized this card. */
export async function sendUnmaskedCard(res: Response, cardId: string): Promise<void> {
  try {
    let sourceUrl = await getCachedImageUrl(cardId);
    if (!sourceUrl) sourceUrl = await getSourceUrlForCard(cardId);
    if (!sourceUrl) {
      setUnmaskedHeaders(res);
      res.status(404).json({ error: "Card image not found" });
      return;
    }

    const normalized = normalizeImageUrl(sourceUrl);
    if (!normalized) {
      setUnmaskedHeaders(res);
      res.status(404).json({ error: "Invalid image URL" });
      return;
    }

    const validation = await getOrValidateCardImage(cardId, normalized);
    if (validation.status !== "ok") {
      setUnmaskedHeaders(res);
      res.status(404).json({ error: "Image not available" });
      return;
    }

    const fetched = await withSourceFetchTimeout(async (signal) => {
      const response = await fetch(normalized, {
        signal,
        redirect: "follow",
        headers: { "User-Agent": "PackPTS/1.0 ImageProxy" },
      });
      if (!response.ok) return { kind: "status" as const, status: response.status };
      const contentType = response.headers.get("content-type") || "image/jpeg";
      if (!contentType.toLowerCase().startsWith("image/")) return { kind: "type" as const, contentType };
      return { kind: "ok" as const, contentType, bytes: Buffer.from(await response.arrayBuffer()) };
    }, 10_000);

    if (fetched.kind === "status") {
      await markImageBad(cardId, `proxy_fetch_failed:${fetched.status}`);
      setUnmaskedHeaders(res);
      res.status(502).json({ error: "Failed to fetch image" });
      return;
    }

    if (fetched.kind === "type") {
      await markImageBad(cardId, `invalid_content_type:${fetched.contentType}`);
      setUnmaskedHeaders(res);
      res.status(502).json({ error: "Invalid content type" });
      return;
    }

    const oriented = await orientUnmaskedScan(cardId, fetched.bytes);
    setUnmaskedResponseHeaders(res, fetched.contentType);
    endUnmasked(res, oriented);
  } catch (error: any) {
    setUnmaskedHeaders(res);
    if (error?.name === "AbortError") {
      res.status(504).json({ error: "Image fetch timed out" });
      return;
    }
    console.error(`[ImageProxy] Error for card ${cardId}:`, error);
    res.status(500).json({ error: "Failed to proxy image" });
  }
}

/** Baked name-cover JPEG. Cacheable. Does not echo the card id. */
export async function sendMaskedCard(req: Request, res: Response, cardId: string): Promise<void> {
  const started = Date.now();
  if (!cardId || cardId.length > 100) {
    res.status(400).json({ error: "Invalid card ID" });
    return;
  }

  try {
    const warmName = peekWarmMaskedFilename(cardId);
    const warmOk = warmName ? await acceptWarmMaskedFile(cardId, warmName) : false;
    const maskedPath = warmOk && warmName ? warmName : await getMaskedImagePath(cardId);
    const cacheStatus = warmName ? "hit" : "miss";

    if (!maskedPath) {
      const refused = takeCoverageRefusal(cardId);
      if (refused) {
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-Mask-Coverage", "fail");
        res.status(422).json({
          error: "Playable mask refused",
          code: "mask_name_uncovered",
          reason: refused,
        });
        return;
      }
      res.status(404).json({ error: "Unable to generate masked image" });
      return;
    }

    const filePath = path.join(process.cwd(), "data", "masked-cards", maskedPath);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: "Masked image not found" });
      return;
    }

    await maybeWriteWarmOkSidecar(cardId, maskedPath);

    const etagMatch = maskedPath.match(/_(v[\d.]+(?:_r\d+)?)\.jpg$/);
    const etag = `"${etagMatch?.[1] ?? CURRENT_MASK_VERSION}"`;
    if (req.headers["if-none-match"] === etag) {
      res.setHeader("ETag", etag);
      res.setHeader("X-Mask-Cache", cacheStatus);
      res.status(304).end();
      return;
    }

    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
    res.setHeader("ETag", etag);
    res.setHeader("X-Mask-Version", CURRENT_MASK_VERSION);
    res.setHeader("X-Mask-Cache", cacheStatus);
    res.setHeader("Server-Timing", `mask;dur=${Date.now() - started};desc="${cacheStatus}"`);
    res.setHeader("Content-Security-Policy", "default-src 'none'");
    res.setHeader("X-Content-Type-Options", "nosniff");
    fs.createReadStream(filePath).pipe(res);
  } catch (error) {
    if (isMaskBakeTimeout(error)) {
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("Retry-After", "5");
      res.status(503).json({ error: "Masked image temporarily unavailable" });
      return;
    }
    console.error("[MaskedImage] Error serving masked image:", error);
    res.status(500).json({ error: "Server error" });
  }
}
