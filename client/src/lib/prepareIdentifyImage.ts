/**
 * Client-side image prep for Snap-to-Set identify uploads.
 * HEIC/HEIF → JPEG, EXIF orientation applied, longest edge stepped down
 * until the JPEG is ≤ 5MB (Design MAKE_FLOW.md §4).
 */

export const IDENTIFY_MAX_BYTES = 5 * 1024 * 1024;
export const IDENTIFY_START_MAX_EDGE = 2048;
export const IDENTIFY_MIN_MAX_EDGE = 640;
export const IDENTIFY_JPEG_QUALITY = 0.85;
export const IDENTIFY_MIN_JPEG_QUALITY = 0.5;

export function isHeicLike(file: File): boolean {
  const type = (file.type || "").toLowerCase();
  const name = (file.name || "").toLowerCase();
  return (
    type.includes("heic") ||
    type.includes("heif") ||
    name.endsWith(".heic") ||
    name.endsWith(".heif")
  );
}

/** Pure helper: next encode params when the current blob is over budget. */
export function nextEncodeParams(
  maxEdge: number,
  quality: number,
  blobBytes: number,
  maxBytes: number = IDENTIFY_MAX_BYTES,
): { maxEdge: number; quality: number; done: boolean } {
  if (blobBytes <= maxBytes) {
    return { maxEdge, quality, done: true };
  }
  if (maxEdge > IDENTIFY_MIN_MAX_EDGE) {
    const nextEdge = Math.max(IDENTIFY_MIN_MAX_EDGE, Math.floor(maxEdge * 0.75));
    return { maxEdge: nextEdge, quality, done: false };
  }
  if (quality > IDENTIFY_MIN_JPEG_QUALITY) {
    const nextQ = Math.max(IDENTIFY_MIN_JPEG_QUALITY, Math.round((quality - 0.1) * 100) / 100);
    return { maxEdge, quality: nextQ, done: false };
  }
  return { maxEdge, quality, done: true };
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read image"));
    reader.readAsDataURL(blob);
  });
}

async function heicToJpegBlob(file: File): Promise<Blob> {
  // Dynamic import keeps the HEIC decoder out of the initial /make chunk
  // for users who never pick iOS library photos.
  type Heic2AnyFn = (opts: {
    blob: Blob;
    toType: string;
    quality: number;
  }) => Promise<Blob | Blob[]>;
  const mod = (await import("heic2any")) as unknown as { default?: Heic2AnyFn } | Heic2AnyFn;
  const heic2any: Heic2AnyFn =
    typeof mod === "function" ? mod : (mod.default as Heic2AnyFn);
  const result = await heic2any({
    blob: file,
    toType: "image/jpeg",
    quality: IDENTIFY_JPEG_QUALITY,
  });
  return Array.isArray(result) ? result[0] : result;
}

async function loadBitmap(blob: Blob): Promise<ImageBitmap> {
  // imageOrientation: from-image applies EXIF so cards aren't sideways into identify
  return createImageBitmap(blob, { imageOrientation: "from-image" } as ImageBitmapOptions);
}

function encodeJpeg(
  bitmap: ImageBitmap,
  maxEdge: number,
  quality: number,
): Promise<Blob> {
  const longest = Math.max(bitmap.width, bitmap.height);
  const scale = longest > maxEdge ? maxEdge / longest : 1;
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return Promise.reject(new Error("Couldn't prepare that photo"));
  }
  ctx.drawImage(bitmap, 0, 0, w, h);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Couldn't encode that photo as JPEG"))),
      "image/jpeg",
      quality,
    );
  });
}

export interface PreparedIdentifyImage {
  base64: string;
  mimeType: "image/jpeg";
  byteLength: number;
  width: number;
  height: number;
}

/**
 * Normalize a picked still (incl. HEIC) to JPEG base64 ≤ 5MB for /api/sets/identify-card.
 */
export async function prepareIdentifyImage(file: File): Promise<PreparedIdentifyImage> {
  let source: Blob = file;

  if (isHeicLike(file)) {
    try {
      source = await heicToJpegBlob(file);
    } catch {
      throw new Error("Couldn't read that photo — try exporting as JPEG");
    }
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await loadBitmap(source);
  } catch {
    throw new Error("Couldn't read that photo — try exporting as JPEG");
  }

  try {
    let maxEdge = IDENTIFY_START_MAX_EDGE;
    let quality = IDENTIFY_JPEG_QUALITY;
    let blob = await encodeJpeg(bitmap, maxEdge, quality);

    // Cap iterations so a pathological encoder can't spin forever
    for (let i = 0; i < 12; i++) {
      const next = nextEncodeParams(maxEdge, quality, blob.size);
      if (next.done) break;
      maxEdge = next.maxEdge;
      quality = next.quality;
      blob = await encodeJpeg(bitmap, maxEdge, quality);
    }

    if (blob.size > IDENTIFY_MAX_BYTES) {
      throw new Error("Photo is still too large after resize. Try a smaller image.");
    }

    const longest = Math.max(bitmap.width, bitmap.height);
    const scale = longest > maxEdge ? maxEdge / longest : 1;

    return {
      base64: await blobToBase64(blob),
      mimeType: "image/jpeg",
      byteLength: blob.size,
      width: Math.max(1, Math.round(bitmap.width * scale)),
      height: Math.max(1, Math.round(bitmap.height * scale)),
    };
  } finally {
    bitmap.close();
  }
}
