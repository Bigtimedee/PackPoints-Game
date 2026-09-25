import fs from "fs";
import path from "path";
import express from "express";
import { createServer } from "http";
import { registerVersionRoute } from "./lib/versionRoute";
import { schemaGateMiddleware } from "./startup/schemaGate";
import { logBootPhase } from "./startup/bootPhase";
import { installGracefulShutdown } from "./startup/gracefulShutdown";
import { mountSchemaWindowSpa } from "./static";

/**
 * Process entry. Binds the port before the rest of the server graph loads and
 * before pg_dump / drizzle-kit push. During that window this process serves
 * `/api/version`, a warm masked JPEG, and SPA HTML for client routes. Server
 * routes outside `/api` return 503 until `bootAfterListen` registers them and
 * mounts the static catch-all last. The volume still prevents overlap; this
 * only shrinks the window where nothing is listening.
 */
const required = ["DATABASE_URL", "SESSION_SECRET"].filter((key) => !process.env[key]);
if (required.length > 0) {
  console.error(`[Startup] FATAL: Missing required environment variables: ${required.join(", ")}`);
  process.exit(1);
}

const app = express();
const httpServer = createServer(app);

registerVersionRoute(app);
app.use(schemaGateMiddleware);

if (process.env.NODE_ENV === "production") {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }
  mountSchemaWindowSpa(app, distPath);
}

installGracefulShutdown({
  server: httpServer,
  closePool: async () => {
    const { pool } = await import("./db");
    await pool.end();
  },
});

const port = parseInt(process.env.PORT || "5000", 10);
httpServer.on("error", (err: NodeJS.ErrnoException) => {
  console.error(`[FATAL] HTTP server error (${err.code}):`, err.message);
  process.exit(1);
});

httpServer.listen({ port, host: "0.0.0.0" }, () => {
  logBootPhase("listen", { port });
  console.log(`[Startup] listening on ${port} before schema`);
  import("./index")
    .then(({ bootAfterListen }) => bootAfterListen(app, httpServer))
    .catch((err) => {
      console.error("[FATAL] Unhandled startup error — server is shutting down:", err);
      process.exit(1);
    });
});
