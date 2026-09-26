import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { shouldReconnectWebSocket, websocketCloseErrorToast, WS_GOING_AWAY_CODE } from "../wsClose";

const hookSrc = readFileSync(new URL("../../hooks/useWebSocket.ts", import.meta.url), "utf8");

describe("websocket close 1001", () => {
  it("reconnects on 1001 when the session still wants a socket", () => {
    expect(WS_GOING_AWAY_CODE).toBe(1001);
    expect(shouldReconnectWebSocket(1001, true)).toBe(true);
    expect(shouldReconnectWebSocket(1006, true)).toBe(true);
  });

  it("does not reconnect after the player disconnects", () => {
    expect(shouldReconnectWebSocket(1001, false)).toBe(false);
    expect(shouldReconnectWebSocket(1000, false)).toBe(false);
  });

  it("does not produce an error toast for 1001", () => {
    expect(websocketCloseErrorToast(1001)).toBeNull();
  });

  it("the client hook uses that decision and does not toast", () => {
    expect(hookSrc).toContain("shouldReconnectWebSocket(code, allowReconnect)");
    expect(hookSrc).toContain("websocketCloseErrorToast(code)");
    expect(hookSrc).not.toContain("toast(");
  });
});
