/**
 * Puts each page's share title, description, and (when approved) image into
 * the HTML crawlers see. Set images also require a cleared set with a
 * registered mask profile. Image URLs always carry ?v=<build id>.
 */
import { holdReasonForIdentity } from "../config/heldSets";
import { getMaskProfile, profileIsRegistered } from "../masking/maskProfiles";
import { getServedBuildId } from "./servedBuildId";
import { resolveSharePng, shareImageApproved } from "./shareApproval";
import {
  PACKPTS_ORIGIN,
  shareImagePublicPath,
  sharePageForPath,
  withShareCacheBuster,
  type SharePage,
  type ShareSetPage,
} from "@shared/sharePreview";

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function readAttr(tag: string, name: string): string | null {
  const re = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(tag))) {
    if (match[1].toLowerCase() === name.toLowerCase()) return match[2] ?? match[3] ?? "";
  }
  return null;
}

function insertBeforeHeadClose(html: string, tag: string): string {
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `    ${tag}\n  </head>`);
  return `${html}\n${tag}\n`;
}

function replaceMeta(html: string, attr: "property" | "name", key: string, content: string): string {
  const nextTag = `<meta ${attr}="${escapeAttr(key)}" content="${escapeAttr(content)}" />`;
  let replaced = false;
  const next = html.replace(/<meta\b[^>]*>/gi, (tag) => {
    if (readAttr(tag, attr) !== key) return tag;
    if (replaced) return "";
    replaced = true;
    return nextTag;
  });
  if (replaced) return next;
  return insertBeforeHeadClose(next, nextTag);
}

export function setSharePageCleared(page: ShareSetPage): boolean {
  if (holdReasonForIdentity({
    id: page.setId,
    year: page.year,
    brand: page.brand,
    sport: page.sport,
    setName: page.setName,
    isActive: true,
    isUserCreated: false,
  })) return false;
  const profile = getMaskProfile(page.setName, page.setId);
  return profileIsRegistered(profile, page.setId);
}

/** Absolute image URL when this page may use its file as a share image. */
export function approvedShareImageUrl(page: SharePage, buildId: string): string | null {
  if (page.kind === "set" && !setSharePageCleared(page)) return null;
  const file = resolveSharePng(page.file);
  if (!file || !shareImageApproved(file.sha256)) return null;
  const bare = `${PACKPTS_ORIGIN}${shareImagePublicPath(page.file)}`;
  return withShareCacheBuster(bare, buildId);
}

export function applyShareCacheBuster(html: string, buildId: string): string {
  return html.replace(/<meta\b[^>]*>/gi, (tag) => {
    const isOg = readAttr(tag, "property") === "og:image";
    const isTw = readAttr(tag, "name") === "twitter:image";
    if (!isOg && !isTw) return tag;
    const content = readAttr(tag, "content");
    if (!content) return tag;
    const next = withShareCacheBuster(content, buildId);
    if (next === content) return tag;
    return tag.replace(/content\s*=\s*(?:"[^"]*"|'[^']*')/i, `content="${escapeAttr(next)}"`);
  });
}

export function applySharePreview(html: string, url: string, buildId = getServedBuildId()): string {
  const page = sharePageForPath(url);
  let next = html;
  if (page?.kind === "static") {
    next = replaceMeta(next, "property", "og:title", page.shareTitle);
    next = replaceMeta(next, "name", "twitter:title", page.shareTitle);
    next = replaceMeta(next, "property", "og:description", page.shareDescription);
    next = replaceMeta(next, "name", "twitter:description", page.shareDescription);
  }
  if (page) {
    const image = approvedShareImageUrl(page, buildId);
    if (image) {
      next = replaceMeta(next, "property", "og:image", image);
      next = replaceMeta(next, "name", "twitter:image", image);
      next = replaceMeta(next, "property", "og:image:width", "1200");
      next = replaceMeta(next, "property", "og:image:height", "630");
      next = replaceMeta(next, "property", "og:image:alt", page.alt);
    }
  }
  return applyShareCacheBuster(next, buildId);
}
