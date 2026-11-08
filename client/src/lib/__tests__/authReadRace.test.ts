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
    vi.stubGlobal("fetch", () => new Promise<Response>((resolve) => {
      release = resolve;
    }));
    const signal = new AbortController().signal;
    const stale = authUserQueryFn(client)({ signal } as never);
    await afterPasswordResetSuccess(client);
    expect(currentAuthReadEpoch()).toBe(1);
    release(jsonResponse(FIXTURE_ADMIN));
    expect(await stale).toBeNull();
    expect(client.getQueryData(AUTH_USER_QUERY_KEY)).toBeNull();

    vi.stubGlobal("fetch", async () => jsonResponse(FIXTURE_ADMIN));
    const fresh = await authUserQueryFn(client)({ signal: new AbortController().signal } as never);
    expect(fresh).toMatchObject({ id: "fixture-admin", isAdmin: true });
    expect(client.getQueryData(AUTH_USER_QUERY_KEY)).toBeNull();
    client.setQueryData(AUTH_USER_QUERY_KEY, fresh);
    expect(client.getQueryData<{ id: string }>(AUTH_USER_QUERY_KEY)?.id).toBe("fixture-admin");
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
});
