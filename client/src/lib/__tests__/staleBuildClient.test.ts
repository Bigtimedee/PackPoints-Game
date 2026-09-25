/**
 * Version poll: a new build id reloads, a live question waits for the next
 * safe point, and one tab reloads at most once per build id.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUILD_RELOAD_STORAGE_KEY } from "@shared/buildVersion";
import { resetStaleBuildActivity, setStaleBuildActivity } from "../staleBuildActivity";
import {
  checkStaleBuild,
  notifyStaleBuildSafePoint,
  reloadForChunkError,
  resetStaleBuildClientForTests,
} from "../staleBuildClient";

const store = new Map<string, string>();
const reload = vi.fn();

function installDom(pathname: string) {
  (globalThis as { __PACKPTS_BUILD_ID__?: string }).__PACKPTS_BUILD_ID__ = "aaa";
  Object.assign(globalThis, {
    window: {
      location: { pathname, reload },
      addEventListener: () => undefined,
    },
    document: {
      visibilityState: "visible",
      addEventListener: () => undefined,
    },
    sessionStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    },
  });
}

function versionResponse(buildId: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ buildId }),
  };
}

beforeEach(() => {
  store.clear();
  reload.mockClear();
  resetStaleBuildActivity();
  resetStaleBuildClientForTests();
  installDom("/");
});

afterEach(() => {
  resetStaleBuildClientForTests();
  resetStaleBuildActivity();
  vi.unstubAllGlobals();
});

describe("version check", () => {
  it("detects a new build id and reloads with a cache-busted no-store fetch", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(String(url)).toMatch(/^\/api\/version\?t=\d+$/);
      expect(init?.cache).toBe("no-store");
      return versionResponse("bbb");
    });
    vi.stubGlobal("fetch", fetchMock);

    expect(await checkStaleBuild("interval")).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(store.get(BUILD_RELOAD_STORAGE_KEY)).toContain("bbb");
  });

  it("does not reload again for the same build id after the tab comes back", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => versionResponse("bbb")));
    expect(await checkStaleBuild("interval")).toBe(true);

    resetStaleBuildClientForTests();
    installDom("/");
    reload.mockClear();

    expect(await checkStaleBuild("focus")).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("defers a mid-question mismatch until Next Question or Game Complete", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => versionResponse("bbb")));
    installDom("/game/solo");
    setStaleBuildActivity({ inProgressCard: true });

    expect(await checkStaleBuild("interval")).toBe(false);
    expect(reload).not.toHaveBeenCalled();

    expect(await notifyStaleBuildSafePoint()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("keeps an in-flight answer when the safe point arrives during submit", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => versionResponse("bbb")));
    installDom("/game/solo");
    setStaleBuildActivity({ inProgressCard: true, pageSubmitting: true });

    expect(await notifyStaleBuildSafePoint()).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads a chunk-load failure immediately, and once, outside a question", () => {
    reloadForChunkError();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(store.get(BUILD_RELOAD_STORAGE_KEY)).toContain("chunk:aaa");

    resetStaleBuildClientForTests();
    installDom("/");
    reload.mockClear();
    reloadForChunkError();
    expect(reload).not.toHaveBeenCalled();
  });

  it("defers a chunk-load failure during a question to the safe point", async () => {
    installDom("/game/solo");
    setStaleBuildActivity({ inProgressCard: true });
    reloadForChunkError();
    expect(reload).not.toHaveBeenCalled();

    vi.stubGlobal("fetch", vi.fn(async () => versionResponse("aaa")));
    expect(await notifyStaleBuildSafePoint()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(store.get(BUILD_RELOAD_STORAGE_KEY)).toContain("chunk:aaa");
  });
});
