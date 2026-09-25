import crypto from "crypto";
import { readFileSync } from "fs";
import http from "http";
import net from "net";
import type { AddressInfo } from "net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { DRAIN_TIMEOUT_MS, installGracefulShutdown } from "../startup/gracefulShutdown";
import { addShutdownHook, resetShutdownHooksForTests } from "../startup/shutdownHooks";
import {
  beginWebSocketShutdown,
  isAcceptingWebSocketUpgrades,
  registerWebSocketServer,
  resetWebSocketShutdownForTests,
  WS_SHUTDOWN_GRACE_MS,
} from "../startup/websocketShutdown";

const websocketSrc = readFileSync(new URL("../websocket.ts", import.meta.url), "utf8");

describe("websocket shutdown", () => {
  const stops: Array<() => void> = [];
  const servers: http.Server[] = [];

  afterEach(async () => {
    for (const stop of stops) stop();
    stops.length = 0;
    resetShutdownHooksForTests();
    resetWebSocketShutdownForTests();
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
      if (!server.listening) {
        resolve();
        return;
      }
      server.closeAllConnections?.();
      server.close(() => resolve());
    })));
  });

  it("wires the live upgrade path into the SIGTERM close", () => {
    expect(websocketSrc).toContain("isAcceptingWebSocketUpgrades()");
    expect(websocketSrc).toContain("beginWebSocketShutdown()");
    expect(websocketSrc).toContain("isWebSocketShuttingDown()");
    expect(websocketSrc).toContain("addShutdownHook(");
    const upgrade = websocketSrc.slice(websocketSrc.indexOf('httpServer.on("upgrade"'));
    expect(upgrade.indexOf("isAcceptingWebSocketUpgrades()")).toBeLessThan(upgrade.indexOf("handleUpgrade"));
    expect(DRAIN_TIMEOUT_MS).toBe(5_000);
    expect(WS_SHUTDOWN_GRACE_MS).toBe(500);
  });

  it("exits well before the 5s cap when a websocket client is open", async () => {
    const { server, port } = await listen(servers);
    const exit = vi.fn();
    const closeCodes: number[] = [];
    addShutdownHook(() => beginWebSocketShutdown());
    stops.push(installGracefulShutdown({
      server,
      closePool: async () => {},
      exit,
      signals: ["SIGUSR2"],
    }));

    const client = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    client.on("close", (code) => closeCodes.push(code));
    await opened(client);

    const started = Date.now();
    process.emit("SIGUSR2");
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0), { timeout: 2_000 });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(closeCodes).toEqual([1001]);
    client.terminate();
  });

  it("still finishes an in-flight HTTP response", async () => {
    const { server, port } = await listen(servers);
    const exit = vi.fn();
    addShutdownHook(() => beginWebSocketShutdown());
    stops.push(installGracefulShutdown({
      server,
      closePool: async () => {},
      exit,
      signals: ["SIGUSR2"],
    }));

    const client = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await opened(client);

    const body = request(port, "/slow?delay=700");
    await new Promise((resolve) => server.once("request", () => resolve(undefined)));
    const started = Date.now();
    process.emit("SIGUSR2");

    const response = await body;
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0), { timeout: 2_000 });
    const elapsed = Date.now() - started;
    expect(response).toEqual({ status: 200, body: "done" });
    expect(elapsed).toBeGreaterThanOrEqual(600);
    expect(elapsed).toBeLessThan(2_000);
    client.terminate();
  });

  it("terminates a client that ignores the close frame and still exits before the cap", async () => {
    const { server, port } = await listen(servers);
    const exit = vi.fn();
    addShutdownHook(() => beginWebSocketShutdown());
    stops.push(installGracefulShutdown({
      server,
      closePool: async () => {},
      exit,
      signals: ["SIGUSR2"],
    }));

    const sock = await rawUpgrade(port);
    const started = Date.now();
    process.emit("SIGUSR2");
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0), { timeout: 2_000 });
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(WS_SHUTDOWN_GRACE_MS - 50);
    expect(elapsed).toBeLessThan(2_000);
    sock.destroy();
  });

  it("rejects a new upgrade after shutdown starts", async () => {
    const { port, wss } = await listen(servers);
    beginWebSocketShutdown();
    expect(isAcceptingWebSocketUpgrades()).toBe(false);
    const client = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const failed = await new Promise<boolean>((resolve) => {
      client.on("open", () => resolve(false));
      client.on("error", () => resolve(true));
      client.on("close", () => resolve(true));
    });
    expect(failed).toBe(true);
    expect(wss.clients.size).toBe(0);
  });
});

async function listen(servers: http.Server[]): Promise<{ server: http.Server; port: number; wss: WebSocketServer }> {
  const wss = new WebSocketServer({ noServer: true });
  const server = http.createServer((req, res) => {
    const delay = Number(new URL(req.url ?? "/", "http://127.0.0.1").searchParams.get("delay") ?? "0");
    setTimeout(() => {
      if (res.writableEnded) return;
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("done");
    }, delay);
  });
  server.on("upgrade", (req, socket, head) => {
    if (!isAcceptingWebSocketUpgrades()) {
      socket.destroy();
      return;
    }
    if (req.url !== "/ws" && !req.url?.startsWith("/ws?")) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });
  registerWebSocketServer(wss);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  servers.push(server);
  return { server, port: (server.address() as AddressInfo).port, wss };
}

function opened(client: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    client.once("open", () => resolve());
    client.once("error", reject);
  });
}

function request(port: number, path: string): Promise<{ status: number; body: string } | { error: string }> {
  return new Promise((resolve) => {
    const req = http.get({
      hostname: "127.0.0.1",
      port,
      path,
      agent: new http.Agent({ keepAlive: false }),
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({
        status: res.statusCode ?? 0,
        body: Buffer.concat(chunks).toString(),
      }));
    });
    req.on("error", (err) => resolve({ error: err.message }));
  });
}

function rawUpgrade(port: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, "127.0.0.1");
    const key = crypto.randomBytes(16).toString("base64");
    const chunks: Buffer[] = [];
    sock.on("error", reject);
    sock.once("connect", () => {
      sock.write(
        `GET /ws HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
      );
    });
    sock.on("data", (chunk) => {
      chunks.push(chunk);
      if (Buffer.concat(chunks).includes("\r\n\r\n")) resolve(sock);
    });
  });
}
