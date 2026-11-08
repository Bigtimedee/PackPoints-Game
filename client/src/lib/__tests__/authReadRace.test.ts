/**
 * Mounted admin shell: a late /api/auth/user body from before a 401 must not
 * put the admin back, and a hidden->visible refetch joins that race.
 * Accounts here are fixtures, not production users.
 * @vitest-environment jsdom
 */
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@radix-ui/react-tooltip";
import { Router, Route, Switch } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { ThemeProvider } from "@/components/theme-provider";
import { Header } from "@/components/header";
import "@/components/header-signed-in";
import AdminDashboard from "@/pages/admin/dashboard";
import AdminLogin from "@/pages/admin/login";
import ResetPassword from "@/pages/reset-password";
import {
  AUTH_USER_QUERY_KEY,
  authUserQueryFn,
  bumpAuthReadEpoch,
  currentAuthReadEpoch,
  resetAuthReadEpochForTests,
} from "../authRead";
import { afterPasswordResetSuccess } from "../adminSessionRecovery";
import { getQueryFn } from "../queryClient";

const FIXTURE_ADMIN = {
  id: "fixture-admin",
  isAdmin: true,
  email: "fixture-admin@example.test",
  firstName: "Fixture",
  username: "fixture_admin",
  points: 111,
  profileImageUrl: null,
  generation: 1,
};

const FIXTURE_PLAYER = {
  id: "fixture-player",
  isAdmin: false,
  email: "fixture-player@example.test",
  firstName: "Other",
  username: "fixture_player",
  points: 40,
  profileImageUrl: null,
};

const DASHBOARD = {
  overview: {
    totalUsers: 4,
    registeredUsersNonStaff: 4,
    staffUsers: 1,
    botUsers: 0,
    allUserRows: 5,
    totalPoints: 151,
    totalGames: 9,
    avgAccuracy: 40,
    activeSubscriptions: 1,
    newSignups: 2,
    newSignupsNonStaff: 2,
    newSignupsAllRows: 2,
  },
  topPlayers: [],
  mostActive: [],
};

const WALLET = {
  wallet: { availablePts: 111, balance: 111, debtPts: 0 },
  riskState: { status: "NORMAL" },
  recentTransactions: [],
};

const DAILY = {
  dayDate: "2026-01-01",
  cardsAnswered: 3,
  matchesCompleted: 0,
  capCards: 200,
  resetInMs: 3_600_000,
};

type Pending = { url: string; resolve: (response: Response) => void };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function abortError(): Error {
  const error = new Error("aborted");
  error.name = "AbortError";
  return error;
}

describe("auth read epoch", () => {
  afterEach(() => {
    resetAuthReadEpochForTests();
    vi.unstubAllGlobals();
  });

  it("a late admin body started before the clear does not replace null, and a later read can", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let release!: (response: Response) => void;
    let calls = 0;
    vi.stubGlobal("fetch", () => {
      calls += 1;
      if (calls === 1) {
        return new Promise<Response>((resolve) => {
          release = resolve;
        });
      }
      return Promise.resolve(jsonResponse(null));
    });
    const signal = new AbortController().signal;
    const stale = authUserQueryFn(client)({ signal } as never);
    const settled = afterPasswordResetSuccess(client);
    expect(currentAuthReadEpoch()).toBe(1);
    release(jsonResponse(FIXTURE_ADMIN));
    expect(await stale).toBeNull();
    expect(await settled).toBeNull();
    expect(client.getQueryData(AUTH_USER_QUERY_KEY)).toBeNull();

    vi.stubGlobal("fetch", async () => jsonResponse({ ...FIXTURE_ADMIN, generation: 2 }));
    const fresh = await authUserQueryFn(client)({ signal: new AbortController().signal } as never);
    expect(fresh).toMatchObject({ id: "fixture-admin", isAdmin: true, generation: 2 });
    expect(bumpAuthReadEpoch()).toBe(2);
  });
});

describe("mounted admin shell", () => {
  let root: Root | null = null;
  const pending: Pending[] = [];

  beforeEach(() => {
    resetAuthReadEpochForTests();
    pending.length = 0;
    document.body.innerHTML = "<div id='root'></div>";
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    });
    (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/wallet")) return Promise.resolve(jsonResponse(WALLET));
      if (url.includes("/api/progress/daily")) return Promise.resolve(jsonResponse(DAILY));
      if (url.includes("/api/streak")) return Promise.resolve(jsonResponse({ currentDays: 0, longestDays: 0, lastActiveLocalDate: null, status: "ok", freezesAvailable: 0, todayClaimed: false, nextReward: 0, nextMilestone: null, timeUntilReset: 0, recentDays: [] }));
      return new Promise<Response>((resolve, reject) => {
        const entry: Pending = { url, resolve };
        pending.push(entry);
        init?.signal?.addEventListener("abort", () => {
          reject(abortError());
        });
      });
    });
  });

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
      root = null;
    }
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    resetAuthReadEpochForTests();
  });

  function take(match: string): Pending {
    const index = pending.findIndex((entry) => entry.url.includes(match));
    if (index < 0) throw new Error(`no pending ${match}; have ${pending.map((entry) => entry.url).join(",")}`);
    return pending.splice(index, 1)[0];
  }

  async function settle() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  function text(): string {
    return document.body.textContent ?? "";
  }

  it("401 plus a hidden-to-visible refetch does not restore the admin or loop", async () => {
    const location = memoryLocation({ path: "/admin/dashboard", record: true });
    const client = new QueryClient({
      defaultOptions: {
        queries: {
          queryFn: getQueryFn({ on401: "throw" }),
          retry: false,
          staleTime: Infinity,
          refetchOnWindowFocus: false,
        },
      },
    });
    const shell: ReactNode = createElement(QueryClientProvider, { client },
      createElement(ThemeProvider, { defaultTheme: "light" },
        createElement(TooltipProvider, { delayDuration: 0 },
          createElement(Router, { hook: location.hook },
            createElement(Header),
            createElement(Switch, null,
              createElement(Route, { path: "/admin/dashboard", component: AdminDashboard }),
              createElement(Route, { path: "/admin", component: AdminLogin }),
            ),
          ),
        ),
      ),
    );

    await act(async () => {
      root = createRoot(document.getElementById("root")!);
      root.render(shell);
    });
    await settle();
    const errors: string[] = [];
    const consoleError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
      consoleError(...args);
    };
    take("/api/auth/user").resolve(jsonResponse(FIXTURE_ADMIN));
    for (let i = 0; i < 30 && !document.querySelector("[data-testid='button-user-menu']"); i++) await settle();
    console.error = consoleError;
    if (!document.querySelector("[data-testid='button-user-menu']")) {
      throw new Error(`cache=${JSON.stringify(client.getQueryData(AUTH_USER_QUERY_KEY))} errors=${errors.join(" || ")} tail=${document.body.innerHTML.slice(-500)}`);
    }

    const state = { value: "visible" };
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state.value });
    state.value = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    state.value = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    await settle();
    const lateAuth = take("/api/auth/user");

    take("/api/admin/dashboard").resolve(jsonResponse({ message: "Unauthorized" }, 401));
    await settle();
    await settle();

    lateAuth.resolve(jsonResponse(FIXTURE_ADMIN));
    await settle();
    await settle();

    const loginRead = pending.find((entry) => entry.url.includes("/api/auth/user"));
    if (loginRead) loginRead.resolve(jsonResponse(null));
    await settle();
    await settle();

    expect(document.querySelector("[data-testid='button-user-menu']")).toBeNull();
    expect(document.querySelector("[data-testid='input-admin-username']")).toBeTruthy();
    expect(text()).not.toContain("Failed to load dashboard data.");
    expect(location.history.filter((path) => path === "/admin/dashboard").length).toBe(1);
    expect(client.getQueryData(AUTH_USER_QUERY_KEY)).toBeNull();

    const followed = pending.filter((entry) => entry.url.includes("/api/admin/dashboard"));
    expect(followed).toHaveLength(0);
  });

  function setInput(selector: string, value: string) {
    const input = document.querySelector(selector) as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  async function mount(path: string) {
    const location = memoryLocation({ path, record: true });
    const client = new QueryClient({
      defaultOptions: {
        queries: {
          queryFn: getQueryFn({ on401: "throw" }),
          retry: false,
          staleTime: Infinity,
          refetchOnWindowFocus: false,
        },
      },
    });
    const routes = [
      createElement(Route, { key: "dash", path: "/admin/dashboard", component: AdminDashboard }),
      createElement(Route, { key: "login", path: "/admin", component: AdminLogin }),
      createElement(Route, { key: "reset", path: "/reset-password", component: ResetPassword }),
    ];
    await act(async () => {
      root = createRoot(document.getElementById("root")!);
      root.render(createElement(QueryClientProvider, { client },
        createElement(ThemeProvider, { defaultTheme: "light" },
          createElement(TooltipProvider, { delayDuration: 0 },
            createElement(Router, { hook: location.hook },
              createElement(Header),
              createElement(Switch, null, ...routes),
            ),
          ),
        ),
      ));
    });
    await settle();
    return { location, client };
  }

  it("expiry then a fresh login opens the dashboard with the new auth read", async () => {
    const { location, client } = await mount("/admin/dashboard");
    take("/api/auth/user").resolve(jsonResponse(FIXTURE_ADMIN));
    for (let i = 0; i < 30 && !document.querySelector("[data-testid='button-user-menu']"); i++) await settle();
    expect(document.querySelector("[data-testid='button-user-menu']")).toBeTruthy();
    const epochBeforeExpiry = currentAuthReadEpoch();

    take("/api/admin/dashboard").resolve(jsonResponse({ message: "Unauthorized" }, 401));
    await settle();
    await settle();
    const loginRead = pending.find((entry) => entry.url.includes("/api/auth/user"));
    loginRead?.resolve(jsonResponse(null));
    for (let i = 0; i < 20 && !document.querySelector("[data-testid='input-admin-username']"); i++) await settle();
    expect(client.getQueryData(AUTH_USER_QUERY_KEY)).toBeNull();
    expect(currentAuthReadEpoch()).toBeGreaterThan(epochBeforeExpiry);
    const epochAtLogin = currentAuthReadEpoch();

    setInput("[data-testid='input-admin-username']", "fixture-admin@example.test");
    setInput("[data-testid='input-admin-password']", "fixture-pass-1");
    await act(async () => {
      (document.querySelector("[data-testid='button-admin-login-submit']") as HTMLButtonElement).click();
    });
    await settle();
    take("/api/auth/local-login").resolve(jsonResponse({ success: true, user: { id: "fixture-admin", username: "fixture_admin", points: 111, gamesPlayed: 0 } }));
    await settle();
    for (let i = 0; i < 5 && !pending.some((entry) => entry.url.includes("/api/admin/dashboard")); i++) {
      const auth = pending.find((entry) => entry.url.includes("/api/auth/user"));
      if (!auth) { await settle(); continue; }
      auth.resolve(jsonResponse({ ...FIXTURE_ADMIN, generation: 2 }));
      pending.splice(pending.indexOf(auth), 1);
      await settle();
    }
    take("/api/admin/dashboard").resolve(jsonResponse(DASHBOARD));
    for (let i = 0; i < 30 && !document.querySelector("[data-testid='text-admin-dashboard-title']"); i++) await settle();

    expect(location.history.at(-1)).toBe("/admin/dashboard");
    expect(document.querySelector("[data-testid='button-user-menu']")).toBeTruthy();
    expect(document.body.textContent).toContain("151");
    expect(client.getQueryData<{ generation: number; id: string }>(AUTH_USER_QUERY_KEY)).toMatchObject({
      id: "fixture-admin",
      generation: 2,
    });
    expect(currentAuthReadEpoch()).toBe(epochAtLogin);
  });

  async function submitReset(account: unknown) {
    window.history.pushState(null, "", "/reset-password?token=fixture-token");
    const mounted = await mount("/reset-password");
    take("/api/auth/user").resolve(jsonResponse(account));
    take("/api/auth/validate-reset-token").resolve(jsonResponse({ valid: true }));
    for (let i = 0; i < 20 && !document.querySelector("[data-testid='input-new-password']"); i++) await settle();
    setInput("[data-testid='input-new-password']", "fixture-pass-1");
    setInput("[data-testid='input-confirm-password']", "fixture-pass-1");
    await act(async () => {
      (document.querySelector("[data-testid='button-reset-submit']") as HTMLButtonElement).click();
    });
    await settle();
    await act(async () => {
      take("/api/auth/reset-password").resolve(jsonResponse({ success: true, message: "Password has been reset successfully" }));
    });
    await settle();
    return mounted;
  }

  it("a same-account reset signs out, and the next login is not stuck null", async () => {
    const { location, client } = await submitReset(FIXTURE_ADMIN);
    for (let i = 0; i < 10 && pending.some((entry) => entry.url.includes("/api/auth/user")); i++) {
      take("/api/auth/user").resolve(jsonResponse(null));
      await settle();
    }
    for (let i = 0; i < 20 && !document.body.textContent?.includes("Password Reset"); i++) await settle();
    expect(client.getQueryData(AUTH_USER_QUERY_KEY)).toBeNull();
    expect(document.querySelector("[data-testid='button-user-menu']")).toBeNull();
    expect(document.body.textContent).toContain("Password Reset");

    await act(async () => {
      location.navigate("/admin");
    });
    await settle();
    const signedOutRead = pending.find((entry) => entry.url.includes("/api/auth/user"));
    signedOutRead?.resolve(jsonResponse(null));
    for (let i = 0; i < 20 && !document.querySelector("[data-testid='input-admin-username']"); i++) await settle();
    setInput("[data-testid='input-admin-username']", "fixture-admin@example.test");
    setInput("[data-testid='input-admin-password']", "fixture-pass-1");
    await act(async () => {
      (document.querySelector("[data-testid='button-admin-login-submit']") as HTMLButtonElement).click();
    });
    await settle();
    take("/api/auth/local-login").resolve(jsonResponse({ success: true, user: { id: "fixture-admin", username: "fixture_admin", points: 111, gamesPlayed: 0 } }));
    await settle();
    for (let i = 0; i < 5 && !pending.some((entry) => entry.url.includes("/api/admin/dashboard")); i++) {
      const auth = pending.find((entry) => entry.url.includes("/api/auth/user"));
      if (!auth) { await settle(); continue; }
      auth.resolve(jsonResponse({ ...FIXTURE_ADMIN, generation: 2 }));
      pending.splice(pending.indexOf(auth), 1);
      await settle();
    }
    take("/api/admin/dashboard").resolve(jsonResponse(DASHBOARD));
    for (let i = 0; i < 30 && !document.querySelector("[data-testid='text-admin-dashboard-title']"); i++) await settle();
    expect(location.history.at(-1)).toBe("/admin/dashboard");
    expect(client.getQueryData<{ generation: number }>(AUTH_USER_QUERY_KEY)?.generation).toBe(2);
    expect(document.querySelector("[data-testid='button-user-menu']")).toBeTruthy();
  });

  it("a cross-account reset keeps the other account in the cache", async () => {
    const { client } = await submitReset(FIXTURE_PLAYER);
    await act(async () => {
      take("/api/auth/user").resolve(jsonResponse(FIXTURE_PLAYER));
    });
    for (let i = 0; i < 30 && !document.querySelector("[data-testid='button-user-menu']"); i++) await settle();
    expect(client.getQueryData(AUTH_USER_QUERY_KEY)).toMatchObject({ id: "fixture-player", isAdmin: false });
    expect(document.querySelector("[data-testid='button-user-menu']")).toBeTruthy();
    expect(document.body.textContent).toContain("Password Reset");
  });
});
