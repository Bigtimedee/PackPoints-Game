/**
 * Image Storage — Cloudflare R2 upload module
 *
 * Uploads a PNG buffer to R2 and returns a permanent public HTTPS URL.
 * Falls back gracefully (returns null) when R2 credentials are not configured,
 * allowing local dev to continue serving images from the static public/ folder.
 *
 * Required env vars:
 *   R2_ACCOUNT_ID       — Cloudflare account ID
 *   R2_ACCESS_KEY_ID    — R2 API token access key
 *   R2_SECRET_ACCESS_KEY — R2 API token secret
 *   R2_BUCKET_NAME      — R2 bucket name
 *   R2_PUBLIC_URL       — public base URL for the bucket (e.g. https://cdn.packpts.com)
 */

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { createLogger } from "./logger";

const logger = createLogger("ImageStorage");

function getR2Client(): S3Client | null {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) return null;

  return new S3Client({
    region: "auto",
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
  });
}

/**
 * Upload a PNG buffer to R2.
 * Returns the public HTTPS URL on success, or null if R2 is not configured.
 */
export async function uploadImageToStorage(
  buffer: Buffer,
  key: string,
): Promise<string | null> {
  const client = getR2Client();
  if (!client) {
    logger.warn("r2_not_configured", { message: "R2 credentials missing — skipping upload" });
    return null;
  }

  const bucket = process.env.R2_BUCKET_NAME;
  const publicUrl = process.env.R2_PUBLIC_URL?.replace(/\/$/, "");
  if (!bucket || !publicUrl) {
    logger.warn("r2_config_incomplete", { message: "R2_BUCKET_NAME or R2_PUBLIC_URL missing" });
    return null;
  }

  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: buffer,
    ContentType: "image/png",
    CacheControl: "public, max-age=31536000, immutable",
  }));

  const url = `${publicUrl}/${key}`;
  logger.info("image_uploaded", { key, url });
  return url;
}

/**
 * Returns true if R2 is fully configured and ready to use.
 */
export function isStorageConfigured(): boolean {
  return !!(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET_NAME &&
    process.env.R2_PUBLIC_URL
  );
}
