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

export type VersionCheckReason = "focus" | "visibility" | "online" | "interval" | "navigation" | "safe-point";

export function versionCheckUrl(now: number): string {
  return `/api/version?t=${now}`;
}

export function shouldFetchBuildVersion(input: {
  reason: VersionCheckReason;
  now: number;
  lastFetchAt: number | null;
  minIntervalMs?: number;
}): boolean {
  if (input.reason === "navigation" || input.reason === "safe-point") return true;
  if (input.lastFetchAt == null) return true;
  const min = input.minIntervalMs ?? VERSION_CHECK_MIN_INTERVAL_MS;
  return input.now - input.lastFetchAt >= min;
}

export function normalizeAppPath(path: string): string {
  const raw = path.split("?")[0]?.split("#")[0] || "/";
  if (raw.length > 1 && raw.endsWith("/")) return raw.slice(0, -1);
  return raw || "/";
}

/**
 * A question is on screen. The version poll must not reload here.
 * The game route itself is not enough: card-count setup and Game Complete are safe.
 */
export function isActiveGameRoute(input: {
  pathname: string;
  daily5Playing: boolean;
  inProgressCard: boolean;
}): boolean {
  if (input.inProgressCard) return true;
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

export type StaleReloadTrigger = VersionCheckReason | "chunk-error";

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
  /** A chunk-load reload was deferred until the next safe point. */
  chunkPending?: boolean;
}

export interface StaleReloadDecision {
  updatePending: boolean;
  reload: boolean;
  reloadBuildId: string | null;
  nextReloadedBuildIds: string | null;
  chunkPending: boolean;
}

function passiveVersionTrigger(trigger: StaleReloadTrigger): boolean {
  return trigger === "focus" || trigger === "visibility" || trigger === "online" || trigger === "interval";
}

function holdDecision(pending: boolean, chunkPending: boolean): StaleReloadDecision {
  return {
    updatePending: pending,
    reload: false,
    reloadBuildId: null,
    nextReloadedBuildIds: null,
    chunkPending,
  };
}

function reloadDecision(pending: boolean, guardId: string, stored: string | null): StaleReloadDecision {
  return {
    updatePending: pending,
    reload: true,
    reloadBuildId: guardId,
    nextReloadedBuildIds: rememberReloadedBuild(stored, guardId),
    chunkPending: false,
  };
}

export function decideStaleReload(input: StaleReloadInput): StaleReloadDecision {
  const pending = input.updatePending || isUpdatePending(input.embeddedBuildId, input.serverBuildId);
  const chunkGuard = chunkReloadGuardId(input.embeddedBuildId);
  const chunkAlready = hasReloadedForBuild(input.reloadedBuildIds, chunkGuard);
  const chunkPending = Boolean(input.chunkPending) && !chunkAlready;
  const questionLive = input.submitting || input.inProgressCard || input.daily5Playing;

  if (input.trigger === "chunk-error") {
    if (chunkAlready) return holdDecision(pending, false);
    if (questionLive) return holdDecision(true, true);
    return reloadDecision(pending, chunkGuard, input.reloadedBuildIds);
  }

  if (chunkPending && !input.submitting) {
    const samePath = normalizeAppPath(input.pathname) === normalizeAppPath(input.targetPath);
    const boundary = input.trigger === "safe-point" || (input.trigger === "navigation" && !samePath);
    const idle = passiveVersionTrigger(input.trigger) && !isActiveGameRoute(input);
    if (boundary || idle) return reloadDecision(true, chunkGuard, input.reloadedBuildIds);
  }

  if (!pending || input.submitting) return holdDecision(pending, chunkPending);

  const serverId = sanitizeBuildId(input.serverBuildId);
  if (!serverId || hasReloadedForBuild(input.reloadedBuildIds, serverId)) {
    return holdDecision(pending, chunkPending);
  }

  if (passiveVersionTrigger(input.trigger)) {
    if (isActiveGameRoute(input)) return holdDecision(true, chunkPending);
    return reloadDecision(true, serverId, input.reloadedBuildIds);
  }

  if (input.trigger === "safe-point") {
    return reloadDecision(true, serverId, input.reloadedBuildIds);
  }

  if (input.trigger === "navigation") {
    if (normalizeAppPath(input.pathname) === normalizeAppPath(input.targetPath)) {
      return holdDecision(true, chunkPending);
    }
    return reloadDecision(true, serverId, input.reloadedBuildIds);
  }

  return holdDecision(pending, chunkPending);
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
