/**
 * Add UTM tags to a PackPTS brand link (GTM audit: every brand link the app
 * emits carries utm_source, utm_medium and utm_campaign). Existing utm_* values
 * win, non-PackPTS links and unparseable strings are returned unchanged.
 */
export interface UtmTags { source: string; medium: string; campaign: string; content?: string }

export function withUtm(url: string, tags: UtmTags): string {
  let u: URL;
  try { u = new URL(url); } catch { return url; }
  if (!/(^|\.)packpts\.com$/i.test(u.hostname)) return url;
  const set = (k: string, v: string | undefined) => { if (v && !u.searchParams.has(k)) u.searchParams.set(k, v); };
  set("utm_source", tags.source);
  set("utm_medium", tags.medium);
  set("utm_campaign", tags.campaign);
  set("utm_content", tags.content);
  return u.toString();
}
