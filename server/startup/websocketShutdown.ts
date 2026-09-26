import { WebSocket, type WebSocketServer } from "ws";

/** RFC 6455 1001 Going Away. Sent on SIGTERM so clients reconnect instead of erroring. */
export const WS_GOING_AWAY_CODE = 1001;

/** How long a client may take to answer the close frame before the socket is destroyed. */
export const WS_SHUTDOWN_GRACE_MS = 500;

let acceptingUpgrades = true;
let shuttingDown = false;
let activeWss: WebSocketServer | null = null;
let onBeforeClose: (() => void) | null = null;
let graceTimer: ReturnType<typeof setTimeout> | null = null;

export function isAcceptingWebSocketUpgrades(): boolean {
  return acceptingUpgrades;
}

export function isWebSocketShuttingDown(): boolean {
  return shuttingDown;
}

export function registerWebSocketServer(wss: WebSocketServer, cleanup?: () => void): void {
  activeWss = wss;
  onBeforeClose = cleanup ?? null;
  acceptingUpgrades = true;
  shuttingDown = false;
}

export function resetWebSocketShutdownForTests(): void {
  if (graceTimer) clearTimeout(graceTimer);
  graceTimer = null;
  acceptingUpgrades = true;
  shuttingDown = false;
  activeWss = null;
  onBeforeClose = null;
}

/**
 * Stop upgrades, close every client with 1001, then destroy anything still
 * open. Synchronous until the grace timer: shutdown hooks after this one still
 * run before server.close() waits on the sockets.
 */
export function beginWebSocketShutdown(graceMs = WS_SHUTDOWN_GRACE_MS): void {
  if (shuttingDown) return;
  shuttingDown = true;
  acceptingUpgrades = false;

  try {
    onBeforeClose?.();
  } catch (err) {
    console.error("[Shutdown] websocket cleanup failed:", err instanceof Error ? err.message : err);
  }

  const wss = activeWss;
  if (!wss) return;

  for (const client of wss.clients) {
    try {
      if (client.readyState === WebSocket.OPEN) {
        client.close(WS_GOING_AWAY_CODE, "going away");
      } else if (client.readyState === WebSocket.CONNECTING) {
        client.terminate();
      }
    } catch (err) {
      console.error("[Shutdown] websocket close failed:", err instanceof Error ? err.message : err);
    }
  }

  graceTimer = setTimeout(() => {
    graceTimer = null;
    for (const client of wss.clients) {
      if (client.readyState !== WebSocket.CLOSED) {
        try {
          client.terminate();
        } catch (err) {
          console.error("[Shutdown] websocket terminate failed:", err instanceof Error ? err.message : err);
        }
      }
    }
    try {
      wss.close();
    } catch (err) {
      console.error("[Shutdown] websocket server close failed:", err instanceof Error ? err.message : err);
    }
  }, graceMs);
}
