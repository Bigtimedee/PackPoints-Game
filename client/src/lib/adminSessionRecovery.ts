/**
 * Admin dashboard auth recovery.
 * A 401 is a dead session, not missing stats. A 403 is a signed-in non-admin.
 * Anything else is a real load failure and must stay visible.
 */

export type DashboardFailure = "session-ended" | "not-admin" | "data-error";

export function classifyDashboardFailure(error: { status?: number; message?: string } | null | undefined): DashboardFailure {
  if (!error) return "data-error";
  if (error.status === 401) return "session-ended";
  if (error.status === 403) return "not-admin";
  const message = error.message ?? "";
  if (/^401\b/.test(message) && /unauthorized/i.test(message)) return "session-ended";
  if (/^403\b/.test(message) && /admin access required/i.test(message)) return "not-admin";
  return "data-error";
}

/** Where the admin login page may send a user after a fresh /api/auth/user read. */
export function adminLoginDestination(user: { isAdmin?: boolean } | null | undefined): "/admin/dashboard" | null {
  return user?.isAdmin === true ? "/admin/dashboard" : null;
}

export const PASSWORD_RESET_LOGIN_HREF = "/admin";

/** Drop the signed-in cache after the reset response. The login navigation is a full load. */
export function afterPasswordResetSuccess(cache: {
  setUser: (user: null) => void;
  dropDashboard: () => void;
}): void {
  cache.setUser(null);
  cache.dropDashboard();
}

export function shouldRefetchAuthOnResume(event: {
  type: "pageshow" | "visibilitychange";
  persisted?: boolean;
  visibilityState?: string;
  wasHidden?: boolean;
}): boolean {
  if (event.type === "pageshow") return event.persisted === true;
  if (event.type === "visibilitychange") return event.visibilityState === "visible" && event.wasHidden === true;
  return false;
}

type ResumeTarget = {
  addEventListener: (type: string, listener: (event?: { persisted?: boolean }) => void) => void;
  removeEventListener: (type: string, listener: (event?: { persisted?: boolean }) => void) => void;
  document: {
    visibilityState: string;
    addEventListener: (type: string, listener: () => void) => void;
    removeEventListener: (type: string, listener: () => void) => void;
  };
};

/** Refetch auth when an embedded browser restores a frozen page or returns from background. */
export function bindAuthResume(target: ResumeTarget, refetch: () => void): () => void {
  let hidden = target.document.visibilityState === "hidden";
  const onPageShow = (event?: { persisted?: boolean }) => {
    if (shouldRefetchAuthOnResume({ type: "pageshow", persisted: event?.persisted === true })) refetch();
  };
  const onVisibility = () => {
    const visibilityState = target.document.visibilityState;
    if (shouldRefetchAuthOnResume({ type: "visibilitychange", visibilityState, wasHidden: hidden })) refetch();
    hidden = visibilityState === "hidden";
  };
  target.addEventListener("pageshow", onPageShow);
  target.document.addEventListener("visibilitychange", onVisibility);
  return () => {
    target.removeEventListener("pageshow", onPageShow);
    target.document.removeEventListener("visibilitychange", onVisibility);
  };
}
