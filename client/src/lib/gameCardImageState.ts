import { isPlaceholderUrl } from "./placeholderImageDetect";

/**
 * Image overlay state for one URL.
 * A successful replacement must clear a previous error. Placeholder URLs stay failed.
 */
export function nextGameCardImageState(
  imageUrl: string,
  imageReady: boolean,
): { imageError: boolean; imageLoaded: boolean } {
  if (imageUrl && isPlaceholderUrl(imageUrl)) {
    return { imageError: true, imageLoaded: false };
  }
  return { imageError: false, imageLoaded: imageReady };
}

/**
 * Remount when the dealt masked URL changes (same question index, new card).
 * Reveal swaps `img src` without a new key — the masked URL stays the identity.
 */
export function gameCardMountKey(
  sessionId: string,
  index: number,
  maskedImageUrl: string,
  extras: Array<string | number> = [],
): string {
  return [sessionId, String(index), ...extras.map(String), maskedImageUrl].join("-");
}
