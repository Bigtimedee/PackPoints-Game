import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import {
  PASSWORD_RESET_LOGIN_HREF,
  adminLoginDestination,
  afterPasswordResetSuccess,
  bindAuthResume,
  classifyDashboardFailure,
  shouldRefetchAuthOnResume,
} from "../adminSessionRecovery";

describe("classifyDashboardFailure", () => {
  it("treats 401 as a dead session and 403 as a non-admin", () => {
    expect(classifyDashboardFailure({ status: 401, message: '401: {"message":"Unauthorized"}' })).toBe("session-ended");
    expect(classifyDashboardFailure({ message: '401: {"message":"Unauthorized"}' })).toBe("session-ended");
    expect(classifyDashboardFailure({ status: 403, message: '403: {"message":"Admin access required"}' })).toBe("not-admin");
    expect(classifyDashboardFailure({ message: '403: {"message":"Admin access required"}' })).toBe("not-admin");
  });

  it("keeps timeouts and server errors as data failures", () => {
    expect(classifyDashboardFailure({ status: 500, message: "Failed to get dashboard stats" })).toBe("data-error");
    expect(classifyDashboardFailure({ message: "Request timed out. Please try again." })).toBe("data-error");
    expect(classifyDashboardFailure({ message: "Failed to fetch" })).toBe("data-error");
    expect(classifyDashboardFailure(null)).toBe("data-error");
  });
});

describe("stale admin shell", () => {
  it("does not send a cached admin to the dashboard until a fresh user is an admin", () => {
    expect(adminLoginDestination(null)).toBeNull();
    expect(adminLoginDestination(undefined)).toBeNull();
    expect(adminLoginDestination({ isAdmin: false })).toBeNull();
    expect(adminLoginDestination({ isAdmin: true })).toBe("/admin/dashboard");
  });

  it("drops the cached user after a successful reset and logs in with a full page load", () => {
    const calls: string[] = [];
    afterPasswordResetSuccess({
      setUser: (user) => {
        expect(user).toBeNull();
        calls.push("user");
      },
      dropDashboard: () => calls.push("dashboard"),
    });
    expect(calls).toEqual(["user", "dashboard"]);
    expect(PASSWORD_RESET_LOGIN_HREF).toBe("/admin");
  });
});

describe("embedded browser resume", () => {
  it("refetches auth when a frozen page is restored or the webview becomes visible again", () => {
    expect(shouldRefetchAuthOnResume({ type: "pageshow", persisted: true })).toBe(true);
    expect(shouldRefetchAuthOnResume({ type: "pageshow", persisted: false })).toBe(false);
    expect(shouldRefetchAuthOnResume({ type: "visibilitychange", visibilityState: "visible", wasHidden: true })).toBe(true);
    expect(shouldRefetchAuthOnResume({ type: "visibilitychange", visibilityState: "visible", wasHidden: false })).toBe(false);
    expect(shouldRefetchAuthOnResume({ type: "visibilitychange", visibilityState: "hidden", wasHidden: false })).toBe(false);

    let hidden = false;
    const listeners = new Map<string, (event?: { persisted?: boolean }) => void>();
    const docListeners = new Map<string, () => void>();
    const target = {
      addEventListener: (type: string, listener: (event?: { persisted?: boolean }) => void) => {
        listeners.set(type, listener);
      },
      removeEventListener: (type: string) => {
        listeners.delete(type);
      },
      document: {
        get visibilityState() {
          return hidden ? "hidden" : "visible";
        },
        addEventListener: (type: string, listener: () => void) => {
          docListeners.set(type, listener);
        },
        removeEventListener: (type: string) => {
          docListeners.delete(type);
        },
      },
    };
    const calls: string[] = [];
    const stop = bindAuthResume(target, () => calls.push("refetch"));
    listeners.get("pageshow")?.({ persisted: false });
    expect(calls).toEqual([]);
    listeners.get("pageshow")?.({ persisted: true });
    hidden = true;
    docListeners.get("visibilitychange")?.();
    hidden = false;
    docListeners.get("visibilitychange")?.();
    expect(calls).toEqual(["refetch", "refetch"]);
    stop();
    listeners.get("pageshow")?.({ persisted: true });
    expect(calls).toEqual(["refetch", "refetch"]);
  });
});

describe("admin shell wiring", () => {
  const login = readFileSync(new URL("../../pages/admin/login.tsx", import.meta.url), "utf8");
  const reset = readFileSync(new URL("../../pages/reset-password.tsx", import.meta.url), "utf8");
  const auth = readFileSync(new URL("../../hooks/use-auth.ts", import.meta.url), "utf8");

  it("confirms the session before the admin login redirect and fully loads after reset", () => {
    expect(login).toContain("adminLoginDestination(result.data ?? null)");
    expect(login).not.toContain("if (!isLoading && isAuthenticated && user?.isAdmin)");
    const buttonAt = reset.indexOf("button-go-to-login");
    const button = reset.slice(buttonAt - 180, buttonAt + 220);
    expect(button).toContain("window.location.assign(PASSWORD_RESET_LOGIN_HREF)");
    expect(button).not.toContain("href=");
    expect(reset).toContain("afterPasswordResetSuccess");
    expect(auth).toContain("bindAuthResume");
  });
});
