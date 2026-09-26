/** A full download can be a JPEG even when a range probe stored a bad cache row. */
export function scanLooksLikeImage(contentType: string, bytes: Buffer): boolean {
  const type = contentType.toLowerCase();
  if (type.startsWith("image/") && bytes.length > 0) return true;
  if (bytes.length < 12) return false;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return true;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return true;
  if (bytes.toString("ascii", 0, 4) === "GIF8") return true;
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return true;
  return false;
}

export function scanResponseContentType(contentType: string, bytes: Buffer): string {
  if (contentType.toLowerCase().startsWith("image/")) return contentType;
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes.length >= 6 && bytes.toString("ascii", 0, 4) === "GIF8") return "image/gif";
  if (bytes.length >= 12 && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return "image/jpeg";
}
