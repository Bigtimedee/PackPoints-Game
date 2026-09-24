/**
 * Stale-tab deploy check. Pure helpers shared by the Vite build, the
 * /api/version handler, and the client reload guard. No I/O.
 */

export const VERSION_CHECK_MIN_INTERVAL_MS = 60_000;
export const BUILD_RELOAD_STORAGE_KEY = "packpts_reloaded_build_ids";
export const BUILD_ID_META_NAME = "packpts-build-id";

const BUILD_ID_PATTERN = /^[A-Za-z0-9._-]{1,80}$/;

export function sanitizeBuildId(value: string | null | undefined): string {
  const cleaned = value?.trim() ?? "";
  return BUILD_ID_PATTERN.test(cleaned) ? cleaned : "";
}

/** Railway sha, then git sha, then a build-time timestamp. */
export function pickBuildId(sources: {
  explicit?: string | null;
  railwaySha?: string | null;
  gitSha?: string | null;
  now?: number;
}): string {
  const explicit = sanitizeBuildId(sources.explicit);
  if (explicit) return explicit;
  const railway = sanitizeBuildId(sources.railwaySha);
  if (railway) return railway;
  const git = sanitizeBuildId(sources.gitSha);
  if (git) return git;
  return `t${sources.now ?? 0}`;
}

export function readBuildIdFromIndexHtml(html: string): string | null {
  const tag = html.match(/<meta\b[^>]*\bname=["']packpts-build-id["'][^>]*>/i);
  if (!tag) return null;
  const content = tag[0].match(/\bcontent=["']([^"']*)["']/i);
  const id = sanitizeBuildId(content?.[1]);
  return id || null;
}

export function upsertBuildIdMeta(html: string, buildId: string): string {
  const id = sanitizeBuildId(buildId) || "unknown";
  const tag = `<meta name="${BUILD_ID_META_NAME}" content="${id}" />`;
  if (/<meta\b[^>]*\bname=["']packpts-build-id["'][^>]*>/i.test(html)) {
    return html.replace(/<meta\b[^>]*\bname=["']packpts-build-id["'][^>]*>/i, tag);
  }
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `    ${tag}\n  </head>`);
  }
  return `${tag}\n${html}`;
}

/** Prefer the id written into the served index.html so the API matches the bundle. */
export function selectServedBuildId(fromHtml: string | null | undefined, fallback: string): string {
  const htmlId = sanitizeBuildId(fromHtml);
  if (htmlId) return htmlId;
  return sanitizeBuildId(fallback) || "unknown";
}

export function isUpdatePending(
  embeddedBuildId: string | null | undefined,
  serverBuildId: string | null | undefined,
): boolean {
  const embedded = sanitizeBuildId(embeddedBuildId);
  const server = sanitizeBuildId(serverBuildId);
  if (!embedded || !server) return false;
  return embedded !== server;
}

export function shouldFetchBuildVersion(input: {
  reason: "focus" | "visibility" | "navigation";
  now: number;
  lastFetchAt: number | null;
  minIntervalMs?: number;
}): boolean {
  if (input.reason === "navigation") return true;
  if (input.lastFetchAt == null) return true;
  const min = input.minIntervalMs ?? VERSION_CHECK_MIN_INTERVAL_MS;
  return input.now - input.lastFetchAt >= min;
}

export function normalizeAppPath(path: string): string {
  const raw = path.split("?")[0]?.split("#")[0] || "/";
  if (raw.length > 1 && raw.endsWith("/")) return raw.slice(0, -1);
  return raw || "/";
}

export function isGamePath(pathname: string): boolean {
  const path = normalizeAppPath(pathname);
  return path === "/game" || path.startsWith("/game/");
}

export function isMatchPath(pathname: string): boolean {
  const path = normalizeAppPath(pathname);
  return path === "/match" || path.startsWith("/match/");
}

export function isDaily5Path(pathname: string): boolean {
  const path = normalizeAppPath(pathname);
  return path === "/daily" || path === "/daily5" || path.startsWith("/daily/") || path.startsWith("/daily5/");
}

/**
 * Routes where a focus reload would interrupt a live card.
 * /game/* (including /game/solo) and /match/* are always live game routes.
 * Daily 5 is live only while a card is in play.
 */
export function isActiveGameRoute(input: {
  pathname: string;
  daily5Playing: boolean;
  inProgressCard: boolean;
}): boolean {
  if (input.inProgressCard) return true;
  if (isGamePath(input.pathname) || isMatchPath(input.pathname)) return true;
  if (input.daily5Playing) return true;
  return false;
}

export function hasReloadedForBuild(stored: string | null | undefined, buildId: string): boolean {
  const id = sanitizeBuildId(buildId) || buildId;
  if (!stored || !id) return false;
  return stored.split(",").filter(Boolean).includes(id);
}

export function rememberReloadedBuild(stored: string | null | undefined, buildId: string): string {
  const id = sanitizeBuildId(buildId) || buildId;
  const ids = (stored ?? "").split(",").filter(Boolean);
  if (!ids.includes(id)) ids.push(id);
  return ids.slice(-8).join(",");
}

export function chunkReloadGuardId(embeddedBuildId: string): string {
  const id = sanitizeBuildId(embeddedBuildId) || "unknown";
  return `chunk:${id}`;
}

export type StaleReloadTrigger = "focus" | "visibility" | "navigation" | "chunk-error";

export interface StaleReloadInput {
  trigger: StaleReloadTrigger;
  embeddedBuildId: string;
  serverBuildId: string | null;
  updatePending: boolean;
  /** Path before a navigation; current path for focus and chunk errors. */
  pathname: string;
  /** Path after a navigation; current path otherwise. */
  targetPath: string;
  submitting: boolean;
  daily5Playing: boolean;
  inProgressCard: boolean;
  reloadedBuildIds: string | null;
}

export interface StaleReloadDecision {
  updatePending: boolean;
  reload: boolean;
  reloadBuildId: string | null;
  nextReloadedBuildIds: string | null;
}

export function decideStaleReload(input: StaleReloadInput): StaleReloadDecision {
  const pending = input.updatePending || isUpdatePending(input.embeddedBuildId, input.serverBuildId);
  const hold: StaleReloadDecision = {
    updatePending: pending,
    reload: false,
    reloadBuildId: null,
    nextReloadedBuildIds: null,
  };

  if (input.trigger === "chunk-error") {
    const guardId = chunkReloadGuardId(input.embeddedBuildId);
    if (input.submitting || hasReloadedForBuild(input.reloadedBuildIds, guardId)) {
      return { ...hold, updatePending: pending };
    }
    return {
      updatePending: pending,
      reload: true,
      reloadBuildId: guardId,
      nextReloadedBuildIds: rememberReloadedBuild(input.reloadedBuildIds, guardId),
    };
  }

  if (!pending || input.submitting) return hold;

  const serverId = sanitizeBuildId(input.serverBuildId);
  if (!serverId || hasReloadedForBuild(input.reloadedBuildIds, serverId)) return hold;

  if (input.trigger === "focus" || input.trigger === "visibility") {
    if (isActiveGameRoute(input)) return hold;
    return {
      updatePending: true,
      reload: true,
      reloadBuildId: serverId,
      nextReloadedBuildIds: rememberReloadedBuild(input.reloadedBuildIds, serverId),
    };
  }

  if (input.trigger === "navigation") {
    if (normalizeAppPath(input.pathname) === normalizeAppPath(input.targetPath)) return hold;
    return {
      updatePending: true,
      reload: true,
      reloadBuildId: serverId,
      nextReloadedBuildIds: rememberReloadedBuild(input.reloadedBuildIds, serverId),
    };
  }

  return hold;
}

export function isGameSubmitRequest(method: string, url: string): boolean {
  if (method.toUpperCase() !== "POST") return false;
  let path = url;
  try {
    path = new URL(url, "http://localhost").pathname;
  } catch {
    path = url.split("?")[0] ?? url;
  }
  return path === "/api/game/answer"
    || path === "/api/daily5/answer"
    || path === "/api/daily5/finish"
    || /^\/api\/matches\/[^/]+\/answer$/.test(path);
}

export function isChunkLoadErrorMessage(message: string): boolean {
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i.test(message);
}
