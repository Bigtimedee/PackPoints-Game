import {
  BUILD_RELOAD_STORAGE_KEY,
  decideStaleReload,
  isChunkLoadErrorMessage,
  isGameSubmitRequest,
  shouldFetchBuildVersion,
  type StaleReloadDecision,
  type StaleReloadTrigger,
} from "@shared/buildVersion";
import {
  getStaleBuildActivity,
  isStaleBuildSubmitting,
  noteSubmitDepth,
} from "./staleBuildActivity";

let lastFetchAt: number | null = null;
let lastServerBuildId: string | null = null;
let updatePending = false;
let inFlight: Promise<string | null> | null = null;
let guardsInstalled = false;
let fetchPatched = false;
let reloadStarted = false;

function embeddedBuildId(): string {
  return __PACKPTS_BUILD_ID__ || "dev";
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

async function fetchServerBuildId(): Promise<string | null> {
  try {
    const res = await fetch("/api/version", { cache: "no-store", credentials: "same-origin" });
    if (!res.ok) return null;
    const body = await res.json() as { buildId?: unknown };
    return typeof body.buildId === "string" && body.buildId ? body.buildId : null;
  } catch {
    return null;
  }
}

async function loadServerBuildId(force: boolean, now: number): Promise<string | null> {
  const reason = force ? "navigation" : "focus";
  if (!shouldFetchBuildVersion({ reason, now, lastFetchAt }) && lastServerBuildId) {
    return lastServerBuildId;
  }
  if (inFlight) return inFlight;
  lastFetchAt = now;
  inFlight = fetchServerBuildId()
    .then((id) => {
      if (id) lastServerBuildId = id;
      return id ?? lastServerBuildId;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

function commitReload(decision: StaleReloadDecision): void {
  updatePending = decision.updatePending;
  if (reloadStarted || !decision.reload || !decision.nextReloadedBuildIds) return;
  try {
    sessionStorage.setItem(BUILD_RELOAD_STORAGE_KEY, decision.nextReloadedBuildIds);
  } catch {
    return;
  }
  reloadStarted = true;
  window.location.reload();
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
  });
}

export async function checkStaleBuild(trigger: Exclude<StaleReloadTrigger, "chunk-error">, fromPath?: string): Promise<void> {
  const now = Date.now();
  const force = trigger === "navigation";
  if (!force && !shouldFetchBuildVersion({ reason: trigger, now, lastFetchAt }) && !updatePending && !lastServerBuildId) {
    return;
  }
  // Capture play/submit before the await. Leaving a match unmounts the page
  // and clears its flag while the answer is still in flight.
  const submittingAtStart = isStaleBuildSubmitting();
  const activityAtStart = getStaleBuildActivity();
  const serverBuildId = await loadServerBuildId(force, now);
  const targetPath = currentPath();
  const pathname = trigger === "navigation" && fromPath ? fromPath : targetPath;
  const activityNow = getStaleBuildActivity();
  commitReload(decideStaleReload({
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
  }));
}

export function reloadForChunkError(): void {
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

  window.addEventListener("focus", () => {
    void checkStaleBuild("focus");
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void checkStaleBuild("visibility");
  });
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
