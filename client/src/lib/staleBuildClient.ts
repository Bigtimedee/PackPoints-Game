import {
  BUILD_RELOAD_STORAGE_KEY,
  VERSION_CHECK_MIN_INTERVAL_MS,
  chunkUrlFromLoadMessage,
  decideStaleReload,
  isChunkLoadErrorMessage,
  isGameSubmitRequest,
  isUpdatePending,
  shouldFetchBuildVersion,
  versionCheckUrl,
  type ChunkProbe,
  type StaleReloadDecision,
  type StaleReloadTrigger,
  type VersionCheckReason,
} from "@shared/buildVersion";
import { toast } from "../hooks/use-toast";
import {
  getStaleBuildActivity,
  isStaleBuildSubmitting,
  noteSubmitDepth,
} from "./staleBuildActivity";
import { isTransientHttpStatus, TRANSIENT_RETRY_MS } from "./transientLoad";

let lastFetchAt: number | null = null;
let lastServerBuildId: string | null = null;
let updatePending = false;
let chunkPending = false;
let inFlight: Promise<string | null> | null = null;
let guardsInstalled = false;
let fetchPatched = false;
let reloadStarted = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let chunkImportRetried = false;
let chunkImporter: (url: string) => Promise<unknown> = (url) => import(/* @vite-ignore */ url);

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
  chunkImportRetried = false;
  chunkImporter = (url) => import(/* @vite-ignore */ url);
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

export function chunkLoadFailureNotice(): { title: string; description: string; variant: "destructive" } {
  return {
    title: "Couldn't load that screen",
    description: "Check your connection and try again.",
    variant: "destructive",
  };
}

export function setChunkImporterForTests(importer: ((url: string) => Promise<unknown>) | null): void {
  chunkImporter = importer ?? ((url) => import(/* @vite-ignore */ url));
}

async function fetchServerBuildIdOnce(now: number): Promise<{ id: string | null; retry: boolean }> {
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
    if (isTransientHttpStatus(res.status)) return { id: null, retry: true };
    if (!res.ok || res.status === 304) return { id: null, retry: false };
    const body = await res.json() as { buildId?: unknown };
    const id = typeof body.buildId === "string" && body.buildId ? body.buildId : null;
    return { id, retry: false };
  } catch {
    return { id: null, retry: true };
  }
}

async function fetchServerBuildId(now: number): Promise<string | null> {
  const first = await fetchServerBuildIdOnce(now);
  if (first.id || !first.retry) return first.id;
  await new Promise((resolve) => setTimeout(resolve, TRANSIENT_RETRY_MS));
  const second = await fetchServerBuildIdOnce(Date.now());
  return second.id;
}

async function probeChunk(url: string): Promise<ChunkProbe> {
  try {
    let res = await fetch(url, { method: "HEAD", cache: "no-store" });
    if (res.status === 405 || res.status === 501) {
      res = await fetch(url, { cache: "no-store" });
    }
    if (res.status === 404) return "missing";
    if (isTransientHttpStatus(res.status)) return "network";
    if (res.ok) return "present";
    return "network";
  } catch {
    return "network";
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

export async function checkStaleBuild(trigger: Exclude<StaleReloadTrigger, "chunk-error">, fromPath?: string): Promise<boolean> {
  const now = Date.now();
  const force = trigger === "navigation" || trigger === "leave-results";
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
    holdPlay: activityAtStart.holdPlay || activityNow.holdPlay,
    tabHidden: document.visibilityState === "hidden",
    reloadedBuildIds: readGuard(),
    chunkPending,
  }));
}

/** Player left Game Complete via Play Again. Does not run between questions. */
export function notifyLeavingResults(): Promise<boolean> {
  return checkStaleBuild("leave-results");
}

export async function recoverChunkLoadError(message: string): Promise<boolean> {
  const activity = getStaleBuildActivity();
  const submitting = isStaleBuildSubmitting();
  const url = chunkUrlFromLoadMessage(message);
  const probe: ChunkProbe | null = submitting ? null : (url ? await probeChunk(url) : "network");
  let serverBuildId = lastServerBuildId;
  let buildChanged = false;
  if (!submitting && probe !== "missing") {
    serverBuildId = await fetchServerBuildId(Date.now());
    buildChanged = isUpdatePending(embeddedBuildId(), serverBuildId);
  }
  const decision = decideStaleReload({
    trigger: "chunk-error",
    embeddedBuildId: embeddedBuildId(),
    serverBuildId,
    updatePending,
    pathname: currentPath(),
    targetPath: currentPath(),
    submitting,
    daily5Playing: activity.daily5Playing,
    inProgressCard: activity.inProgressCard,
    holdPlay: activity.holdPlay,
    tabHidden: typeof document !== "undefined" && document.visibilityState === "hidden",
    reloadedBuildIds: readGuard(),
    chunkPending: true,
    chunkProbe: probe,
    chunkBuildChanged: buildChanged,
    chunkImportRetried: chunkImportRetried,
  });
  if (decision.reload) {
    chunkPending = true;
    return commitReload(decision);
  }
  if (decision.retryImport && !chunkImportRetried) {
    chunkImportRetried = true;
    if (url) {
      const bust = url.includes("?") ? `${url}&retry=1` : `${url}?retry=1`;
      try {
        await chunkImporter(bust);
        return false;
      } catch {
        toast(chunkLoadFailureNotice());
        return false;
      }
    }
  }
  if (decision.chunkToast || decision.retryImport) {
    toast(chunkLoadFailureNotice());
  }
  return false;
}

export function reloadForChunkError(): Promise<boolean> {
  return recoverChunkLoadError("Failed to fetch dynamically imported module: /assets/missing-chunk.js");
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
    // Hidden and idle is a reload point. Hidden during a session is not;
    // decideStaleReload holds while a session or results screen is up.
    wake("visibility");
  });
  // Background tabs clamp or freeze timers. The listeners above run the check
  // when the tab is focused, shown, or back online, so a missed tick still lands.
  void checkStaleBuild("interval");
  pollTimer = setInterval(() => {
    void checkStaleBuild("interval");
  }, VERSION_CHECK_MIN_INTERVAL_MS);
  window.addEventListener("vite:preloadError", (event) => {
    event.preventDefault();
    void recoverChunkLoadError(event.payload.message);
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const message = reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "";
    if (!isChunkLoadErrorMessage(message)) return;
    event.preventDefault();
    void recoverChunkLoadError(message);
  });
}

export function notifyStaleBuildRouteChange(fromPath: string, toPath: string): void {
  if (fromPath === toPath) return;
  void checkStaleBuild("navigation", fromPath);
}
