/** Component/effect harness, no live auth, DOM or network. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  effects: [] as Array<() => void | (() => void)>,
  query: { data: null as null | { id: string; username: string; email: string }, isLoading: false, error: null as Error | null },
  navigate: vi.fn(), invalidate: vi.fn(),
}));
vi.mock("react", async (load) => ({ ...await load<typeof import("react")>(), useEffect: (fn: () => void | (() => void)) => { mocks.effects.push(fn); } }));
vi.mock("wouter", () => ({ useLocation: () => ["/auth/success", mocks.navigate] }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => mocks.query }));
vi.mock("@/lib/queryClient", () => ({ queryClient: { invalidateQueries: mocks.invalidate } }));
import AuthSuccess from "../../pages/auth-success";
import { rememberDaily5AuthReturn, consumeDaily5AuthReturn } from "../daily5AuthReturn";
class Store {
  data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(10000000);
  vi.stubGlobal("window", { sessionStorage: new Store() });
  mocks.effects.length = 0; mocks.navigate.mockClear(); mocks.invalidate.mockClear();
  mocks.query.data = { id: "local-fixture", username: "Collector", email: "fixture@example.invalid" };
  mocks.query.error = null;
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("AuthSuccess destination effects", () => {
  it("returns authenticated Daily5 to its query after the existing delay", () => {
    rememberDaily5AuthReturn("/daily", "?challenge=test-token");
    AuthSuccess(); mocks.effects[0]();
    vi.advanceTimersByTime(1499); expect(mocks.navigate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); expect(mocks.navigate).toHaveBeenCalledWith("/daily5?challenge=test-token");
    expect(consumeDaily5AuthReturn()).toBe("/");
    expect(mocks.invalidate).toHaveBeenCalledWith({ queryKey: ["/api/auth/user"] });
  });
  it("retains intent through an effect cleanup/re-setup (StrictMode pattern)", () => {
    rememberDaily5AuthReturn("/daily5");
    AuthSuccess(); const cleanup = mocks.effects[0](); if (cleanup) cleanup();
    mocks.effects[0](); vi.advanceTimersByTime(1500);
    expect(mocks.navigate).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith("/daily5");
  });
  it("keeps the original home destination for other auth starts", () => {
    rememberDaily5AuthReturn("/auth");
    AuthSuccess(); mocks.effects[0](); vi.advanceTimersByTime(1500);
    expect(mocks.navigate).toHaveBeenCalledWith("/");
  });
  it("does not consume intent before authenticated user evidence; keeps error redirect", () => {
    rememberDaily5AuthReturn("/daily5"); mocks.query.data = null; mocks.query.error = Error("fixture failure");
    AuthSuccess(); mocks.effects[0](); mocks.effects[1](); vi.advanceTimersByTime(2000);
    expect(mocks.navigate).toHaveBeenCalledWith("/auth?error=session_failed");
    expect(consumeDaily5AuthReturn()).toBe("/daily5");
  });
});
