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

export type VersionCheckReason = "focus" | "visibility" | "online" | "interval" | "navigation" | "leave-results";

export function versionCheckUrl(now: number): string {
  return `/api/version?t=${now}`;
}

export function shouldFetchBuildVersion(input: {
  reason: VersionCheckReason;
  now: number;
  lastFetchAt: number | null;
  minIntervalMs?: number;
}): boolean {
  if (input.reason === "navigation" || input.reason === "leave-results") return true;
  if (input.lastFetchAt == null) return true;
  const min = input.minIntervalMs ?? VERSION_CHECK_MIN_INTERVAL_MS;
  return input.now - input.lastFetchAt >= min;
}

export function normalizeAppPath(path: string): string {
  const raw = path.split("?")[0]?.split("#")[0] || "/";
  if (raw.length > 1 && raw.endsWith("/")) return raw.slice(0, -1);
  return raw || "/";
}

export function playSurfaceFamily(pathname: string): "game" | "match" | "daily" | null {
  const path = normalizeAppPath(pathname);
  if (path === "/game" || path.startsWith("/game/")) return "game";
  if (path === "/match" || path.startsWith("/match/")) return "match";
  if (path === "/daily" || path === "/daily5" || path.startsWith("/daily/") || path.startsWith("/daily5/")) {
    return "daily";
  }
  return null;
}

/**
 * A session or its results are still on screen. The version poll must not reload.
 * Setup screens (no session yet) are not held.
 */
export function isActiveGameRoute(input: {
  pathname: string;
  daily5Playing: boolean;
  inProgressCard: boolean;
  holdPlay?: boolean;
}): boolean {
  if (input.holdPlay) return true;
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
  /** Session or results screen still mounted. */
  holdPlay?: boolean;
  /** Tab is in the background. A hidden tab may reload only when no session is up. */
  tabHidden?: boolean;
  reloadedBuildIds: string | null;
  chunkPending?: boolean;
  /** Set by the chunk-error probe. Omitted means the URL was not checked yet. */
  chunkProbe?: ChunkProbe | null;
  chunkBuildChanged?: boolean;
  chunkImportRetried?: boolean;
}

export type ChunkProbe = "missing" | "present" | "network";

export interface ChunkLoadInput {
  submitting: boolean;
  /** Session, results, or a 1v1 lobby that is not finished. */
  midSession: boolean;
  probe: ChunkProbe | null;
  buildChanged: boolean;
  alreadyReloaded: boolean;
  importRetried: boolean;
}

export type ChunkLoadAction = "reload" | "hold" | "retry-import" | "toast";

/**
 * A failed dynamic import reloads only when the chunk is gone (404) or the
 * server build id changed. A network error retries the import once, then a
 * toast. An in-flight answer submit always holds.
 */
export function decideChunkLoadFailure(input: ChunkLoadInput): ChunkLoadAction {
  if (input.submitting) return "hold";
  const gone = input.probe === "missing" || input.buildChanged;
  if (gone) {
    if (input.alreadyReloaded) return "hold";
    return "reload";
  }
  // A chunk that is still on the server, or a network blip, is not a deploy.
  // That includes mid-session: do not reload the live card.
  if (input.midSession && input.probe === "present" && input.importRetried) return "toast";
  if (input.importRetried) return "toast";
  return "retry-import";
}

export function chunkUrlFromLoadMessage(message: string): string | null {
  const match = message.match(/(\/assets\/[A-Za-z0-9._~/-]+\.js(?:\?[^)\s]*)?)/);
  if (match?.[1]) return match[1];
  const absolute = message.match(/https?:\/\/[^\s)'"]+/);
  return absolute?.[0] ?? null;
}

export interface StaleReloadDecision {
  updatePending: boolean;
  reload: boolean;
  reloadBuildId: string | null;
  nextReloadedBuildIds: string | null;
  chunkPending: boolean;
  retryImport: boolean;
  chunkToast: boolean;
}

function passiveVersionTrigger(trigger: StaleReloadTrigger): boolean {
  return trigger === "focus" || trigger === "visibility" || trigger === "online" || trigger === "interval";
}

function holdDecision(pending: boolean, chunkPending: boolean, extra?: { retryImport?: boolean; chunkToast?: boolean }): StaleReloadDecision {
  return {
    updatePending: pending,
    reload: false,
    reloadBuildId: null,
    nextReloadedBuildIds: null,
    chunkPending,
    retryImport: extra?.retryImport === true,
    chunkToast: extra?.chunkToast === true,
  };
}

function reloadDecision(pending: boolean, guardId: string, stored: string | null): StaleReloadDecision {
  return {
    updatePending: pending,
    reload: true,
    reloadBuildId: guardId,
    nextReloadedBuildIds: rememberReloadedBuild(stored, guardId),
    chunkPending: false,
    retryImport: false,
    chunkToast: false,
  };
}

function leavesPlaySession(from: string, to: string): boolean {
  if (normalizeAppPath(from) === normalizeAppPath(to)) return false;
  const fromFamily = playSurfaceFamily(from);
  if (!fromFamily) return true;
  return fromFamily !== playSurfaceFamily(to);
}

export function decideStaleReload(input: StaleReloadInput): StaleReloadDecision {
  const pending = input.updatePending || isUpdatePending(input.embeddedBuildId, input.serverBuildId);
  const chunkGuard = chunkReloadGuardId(input.embeddedBuildId);
  const chunkAlready = hasReloadedForBuild(input.reloadedBuildIds, chunkGuard);
  const sessionUp = isActiveGameRoute(input);

  // Reload a failed dynamic import only when that chunk 404s or the build id
  // changed. Network errors retry the import once. A submit in flight holds.
  if (input.trigger === "chunk-error") {
    const changedId = input.chunkBuildChanged ? sanitizeBuildId(input.serverBuildId) : "";
    const action = decideChunkLoadFailure({
      submitting: input.submitting,
      midSession: sessionUp,
      probe: input.chunkProbe ?? null,
      buildChanged: input.chunkBuildChanged === true && changedId.length > 0,
      alreadyReloaded: changedId
        ? hasReloadedForBuild(input.reloadedBuildIds, changedId)
        : chunkAlready,
      importRetried: input.chunkImportRetried === true,
    });
    if (action === "reload") {
      const changedId = input.chunkBuildChanged ? sanitizeBuildId(input.serverBuildId) : "";
      const guard = changedId || chunkGuard;
      if (hasReloadedForBuild(input.reloadedBuildIds, guard)) return holdDecision(pending, false);
      return reloadDecision(pending, guard, input.reloadedBuildIds);
    }
    if (action === "retry-import") return holdDecision(pending, true, { retryImport: true });
    if (action === "toast") return holdDecision(pending, false, { chunkToast: true });
    return holdDecision(pending, false);
  }

  if (!pending || input.submitting) return holdDecision(pending, false);

  const serverId = sanitizeBuildId(input.serverBuildId);
  if (!serverId || hasReloadedForBuild(input.reloadedBuildIds, serverId)) {
    return holdDecision(pending, false);
  }

  if (passiveVersionTrigger(input.trigger)) {
    if (sessionUp) return holdDecision(true, false);
    return reloadDecision(true, serverId, input.reloadedBuildIds);
  }

  // Play Again leaves the results screen without a route change.
  // Mid-question and between cards are not this trigger.
  if (input.trigger === "leave-results") {
    if (input.inProgressCard || input.daily5Playing) return holdDecision(true, false);
    return reloadDecision(true, serverId, input.reloadedBuildIds);
  }

  if (input.trigger === "navigation") {
    if (!leavesPlaySession(input.pathname, input.targetPath)) return holdDecision(true, false);
    return reloadDecision(true, serverId, input.reloadedBuildIds);
  }

  return holdDecision(pending, false);
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
