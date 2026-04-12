/**
 * svgHelpers.ts
 *
 * Shared utilities for SVG frame generation.
 */

/** Escape characters that are unsafe in SVG text content. */
export function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Word-wrap `text` into lines of at most `maxChars` characters each.
 * Splits on spaces and preserves existing newlines.
 */
export function wrapLines(text: string, maxChars: number): string[] {
  const result: string[] = [];
  for (const paragraph of text.split(/\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let current = "";
    for (const word of words) {
      if (!current) {
        current = word;
      } else if (current.length + 1 + word.length <= maxChars) {
        current += " " + word;
      } else {
        result.push(current);
        current = word;
      }
    }
    if (current) result.push(current);
  }
  return result.length > 0 ? result : [""];
}
