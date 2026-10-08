import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { consumeDaily5AuthReturn, rememberDaily5AuthReturn, DAILY5_AUTH_RETURN_KEY as KEY, DAILY5_AUTH_RETURN_TTL_MS as TTL } from "../daily5AuthReturn";
import { captureFirstTouch, startWorkosAuth } from "../attribution";
class MemoryStore {
  data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
}
const NOW = 10000000;
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("Daily5 auth return", () => {
  it.each(["/daily5", "/daily"])("returns %s to Daily5 once", (route) => {
    const s = new MemoryStore();
    rememberDaily5AuthReturn(route, "", s, NOW);
    expect(consumeDaily5AuthReturn(s, NOW + 1)).toBe("/daily5");
    expect(consumeDaily5AuthReturn(s, NOW + 2)).toBe("/");
  });
  it("preserves Beat-me query data without accepting a redirect target", () => {
    const s = new MemoryStore();
    const search = "?challenge=signed-game-token&utm_medium=beatme&next=https://example.org";
    rememberDaily5AuthReturn("/daily", search, s, NOW);
    expect(consumeDaily5AuthReturn(s, NOW)).toBe(`/daily5${search}`);
  });
  it.each(["/", "/auth", "/sets", "/admin", "https://example.org/daily5", "//example.org/daily5", "/daily5/", "/daily5evil"])("keeps %s on the old home fallback and clears stale intent", (route) => {
    const s = new MemoryStore();
    rememberDaily5AuthReturn("/daily5", "", s, NOW);
    rememberDaily5AuthReturn(route, "", s, NOW + 1);
    expect(consumeDaily5AuthReturn(s, NOW + 2)).toBe("/");
  });
  it("expires at 30 minutes, not before", () => {
    const s = new MemoryStore();
    rememberDaily5AuthReturn("/daily5", "", s, NOW);
    expect(consumeDaily5AuthReturn(s, NOW + TTL - 1)).toBe("/daily5");
    rememberDaily5AuthReturn("/daily5", "", s, NOW);
    expect(consumeDaily5AuthReturn(s, NOW + TTL)).toBe("/");
    expect(s.getItem(KEY)).toBeNull();
  });
  it.each(["not json", "null", '{"v":2,"ts":10000000,"search":""}', '{"v":1,"ts":"10000000","search":""}', '{"v":1,"ts":10000001,"search":""}', '{"v":1,"ts":10000000,"search":"//example.org"}'])("rejects and removes invalid record %s", (raw) => {
    const s = new MemoryStore(); s.setItem(KEY, raw);
    expect(consumeDaily5AuthReturn(s, NOW)).toBe("/"); expect(s.getItem(KEY)).toBeNull();
  });
  it.each(["?x=1#hash", "?x=1\n", "x=1", "?" + "a".repeat(4096)])("rejects unsafe/oversized query %s", (search) => {
    const s = new MemoryStore(); rememberDaily5AuthReturn("/daily5", search, s, NOW);
    expect(consumeDaily5AuthReturn(s, NOW)).toBe("/");
  });
  it("handles absent or throwing storage without interrupting auth", () => {
    const s = { getItem() { throw Error("blocked"); }, setItem() { throw Error("blocked"); }, removeItem() { throw Error("blocked"); } };
    expect(() => rememberDaily5AuthReturn("/daily5", "", s, NOW)).not.toThrow();
    expect(consumeDaily5AuthReturn(s, NOW)).toBe("/");
    expect(consumeDaily5AuthReturn(null, NOW)).toBe("/");
    vi.stubGlobal("window", { get sessionStorage() { throw Error("blocked getter"); } });
    expect(() => rememberDaily5AuthReturn("/daily5")).not.toThrow();
    expect(consumeDaily5AuthReturn()).toBe("/");
  });
  it("does not navigate if one-use removal fails", () => {
    const s = new MemoryStore(); rememberDaily5AuthReturn("/daily5", "", s, NOW);
    s.removeItem = () => { throw Error("blocked"); };
    expect(consumeDaily5AuthReturn(s, NOW)).toBe("/");
  });
  it("actual WorkOS start saves context but still stashes attribution before leaving", async () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW);
    const session = new MemoryStore(), local = new MemoryStore();
    const location = { pathname: "/daily", search: "?challenge=test-token", host: "packpts.com", href: "" };
    vi.stubGlobal("window", { location, sessionStorage: session, localStorage: local });
    captureFirstTouch({ pathname: "/daily", search: "?utm_source=collector", host: "packpts.com", referrer: "", local, session, now: NOW });
    let resolve!: (value: Response) => void;
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) => new Promise<Response>((r) => { resolve = r; }));
    vi.stubGlobal("fetch", fetchMock);
    const starting = startWorkosAuth();
    expect(session.getItem(KEY)).not.toBeNull();
    expect(location.href).toBe("");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/auth/attribution");
    resolve(new Response(null, { status: 204 })); await starting;
    expect(location.href).toBe("/api/auth/workos/start");
    expect(consumeDaily5AuthReturn()).toBe("/daily5?challenge=test-token");
  });
  it("wires consumption inside the authenticated navigation timer; retains auth error path", () => {
    const src = readFileSync(new URL("../../pages/auth-success.tsx", import.meta.url), "utf8");
    expect(src).toMatch(/if \(user\)\s*\{[\s\S]*?setTimeout\(\(\) => \{\s*setLocation\(consumeDaily5AuthReturn\(\)\);\s*\}, 1500\)/);
    expect(src).toContain("return () => clearTimeout(timer)");
    expect(src).toContain('setLocation("/auth?error=session_failed")');
    expect(src.match(/consumeDaily5AuthReturn\(\)/g)).toHaveLength(1);
  });
});
