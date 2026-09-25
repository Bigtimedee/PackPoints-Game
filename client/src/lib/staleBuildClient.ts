import {
  BUILD_RELOAD_STORAGE_KEY,
  VERSION_CHECK_MIN_INTERVAL_MS,
  decideStaleReload,
  isChunkLoadErrorMessage,
  isGameSubmitRequest,
  shouldFetchBuildVersion,
  versionCheckUrl,
  type StaleReloadDecision,
  type StaleReloadTrigger,
  type VersionCheckReason,
} from "@shared/buildVersion";
import {
  getStaleBuildActivity,
  isStaleBuildSubmitting,
  noteSubmitDepth,
} from "./staleBuildActivity";

let lastFetchAt: number | null = null;
let lastServerBuildId: string | null = null;
let updatePending = false;
let chunkPending = false;
let inFlight: Promise<string | null> | null = null;
let guardsInstalled = false;
let fetchPatched = false;
let reloadStarted = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;

function embeddedBuildId(): string {
  const inlined = typeof __PACKPTS_BUILD_ID__ === "string" ? __PACKPTS_BUILD_ID__ : "";
  return inlined || "dev";
}

/** Test hook. Production callers never reset this. */
export function resetStaleBuildClientForTests(): void {
  lastFetchAt = null;
  lastServerBuildId = null;
  updatePending = false;
  chunkPending = false;
  inFlight = null;
  reloadStarted = false;
  if (pollTimer != null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function readGuard(): string | null {
  try {
    return sessionStorage.getItem(BUILD_RELOAD_STORAGE_KEY);
  } catch {
    return null;
  }
}

function currentPath(): string {
  return window.location.pathname;
}

async function fetchServerBuildId(now: number): Promise<string | null> {
  try {
    // Raw fetch, not React Query. The app QueryClient uses staleTime: Infinity,
    // refetchInterval: false, and refetchOnWindowFocus: false, which would freeze
    // a version query for the life of the tab. cache: 'no-store' skips the
    // browser HTTP cache; ?t= skips a CDN entry keyed on the bare URL.
    const res = await fetch(versionCheckUrl(now), {
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
    });
    if (!res.ok || res.status === 304) return null;
    const body = await res.json() as { buildId?: unknown };
    return typeof body.buildId === "string" && body.buildId ? body.buildId : null;
  } catch {
    return null;
  }
}

async function loadServerBuildId(reason: VersionCheckReason, now: number): Promise<string | null> {
  if (!shouldFetchBuildVersion({ reason, now, lastFetchAt }) && lastServerBuildId) {
    return lastServerBuildId;
  }
  if (inFlight) return inFlight;
  lastFetchAt = now;
  inFlight = fetchServerBuildId(now)
    .then((id) => {
      if (id) lastServerBuildId = id;
      return id ?? lastServerBuildId;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

function commitReload(decision: StaleReloadDecision): boolean {
  updatePending = decision.updatePending;
  chunkPending = decision.chunkPending;
  if (reloadStarted || !decision.reload || !decision.nextReloadedBuildIds) return false;
  try {
    sessionStorage.setItem(BUILD_RELOAD_STORAGE_KEY, decision.nextReloadedBuildIds);
  } catch {
    return false;
  }
  reloadStarted = true;
  window.location.reload();
  return true;
}

function decisionFor(trigger: StaleReloadTrigger, pathname: string, targetPath: string, serverBuildId: string | null): StaleReloadDecision {
  const activity = getStaleBuildActivity();
  return decideStaleReload({
    trigger,
    embeddedBuildId: embeddedBuildId(),
    serverBuildId,
    updatePending,
    pathname,
    targetPath,
    submitting: isStaleBuildSubmitting(),
    daily5Playing: activity.daily5Playing,
    inProgressCard: activity.inProgressCard,
    reloadedBuildIds: readGuard(),
    chunkPending: trigger === "chunk-error" || chunkPending,
  });
}

export async function checkStaleBuild(trigger: Exclude<StaleReloadTrigger, "chunk-error">, fromPath?: string): Promise<boolean> {
  const now = Date.now();
  const force = trigger === "navigation" || trigger === "safe-point";
  if (
    !force
    && !shouldFetchBuildVersion({ reason: trigger, now, lastFetchAt })
    && !updatePending
    && !chunkPending
    && !lastServerBuildId
  ) {
    return false;
  }
  // Capture play/submit before the await. Leaving a match unmounts the page
  // and clears its flag while the answer is still in flight.
  const submittingAtStart = isStaleBuildSubmitting();
  const activityAtStart = getStaleBuildActivity();
  const serverBuildId = await loadServerBuildId(trigger, now);
  const targetPath = currentPath();
  const pathname = trigger === "navigation" && fromPath ? fromPath : targetPath;
  const activityNow = getStaleBuildActivity();
  return commitReload(decideStaleReload({
    trigger,
    embeddedBuildId: embeddedBuildId(),
    serverBuildId,
    updatePending,
    pathname,
    targetPath,
    submitting: submittingAtStart || isStaleBuildSubmitting(),
    daily5Playing: activityAtStart.daily5Playing || activityNow.daily5Playing,
    inProgressCard: activityAtStart.inProgressCard || activityNow.inProgressCard,
    reloadedBuildIds: readGuard(),
    chunkPending,
  }));
}

/** Next Question or Game Complete. Reloads even while a card flag is still set. */
export function notifyStaleBuildSafePoint(): Promise<boolean> {
  return checkStaleBuild("safe-point");
}

export function reloadForChunkError(): void {
  chunkPending = true;
  commitReload(decisionFor("chunk-error", currentPath(), currentPath(), lastServerBuildId));
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method;
  if (typeof Request !== "undefined" && input instanceof Request) return input.method;
  return "GET";
}

function installFetchSubmitTracker(): void {
  if (fetchPatched) return;
  fetchPatched = true;
  const orig = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const track = isGameSubmitRequest(requestMethod(input, init), requestUrl(input));
    if (track) noteSubmitDepth(1);
    const pending = orig(input, init);
    if (!track) return pending;
    return pending.finally(() => noteSubmitDepth(-1));
  };
}

export function installStaleBuildGuards(): void {
  if (guardsInstalled || typeof window === "undefined") return;
  guardsInstalled = true;
  installFetchSubmitTracker();

  const wake = (trigger: "focus" | "visibility" | "online") => {
    void checkStaleBuild(trigger);
  };
  window.addEventListener("focus", () => wake("focus"));
  window.addEventListener("online", () => wake("online"));
  window.addEventListener("pageshow", () => wake("focus"));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") wake("visibility");
  });
  // Background tabs clamp or freeze timers. The listeners above run the check
  // when the tab is focused, shown, or back online, so a missed tick still lands.
  void checkStaleBuild("interval");
  pollTimer = setInterval(() => {
    void checkStaleBuild("interval");
  }, VERSION_CHECK_MIN_INTERVAL_MS);
  window.addEventListener("vite:preloadError", (event) => {
    event.preventDefault();
    reloadForChunkError();
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const message = reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "";
    if (!isChunkLoadErrorMessage(message)) return;
    event.preventDefault();
    reloadForChunkError();
  });
}

export function notifyStaleBuildRouteChange(fromPath: string, toPath: string): void {
  if (fromPath === toPath) return;
  void checkStaleBuild("navigation", fromPath);
}
