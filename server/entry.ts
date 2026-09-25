import express from "express";
import { createServer } from "http";
import { registerVersionRoute } from "./lib/versionRoute";
import { schemaGateMiddleware } from "./startup/schemaGate";
import { logBootPhase } from "./startup/bootPhase";
import { installGracefulShutdown } from "./startup/gracefulShutdown";
import { serveStatic } from "./static";

/**
 * Process entry. Binds the port before the rest of the server graph loads and
 * before pg_dump / drizzle-kit push. DB routes stay on the schema gate until
 * that push finishes. The volume still prevents overlap; this only shrinks
 * the window where nothing is listening.
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

let staticMounted = false;
if (process.env.NODE_ENV === "production") {
  serveStatic(app);
  staticMounted = true;
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
    .then(({ bootAfterListen }) => bootAfterListen(app, httpServer, { staticMounted }))
    .catch((err) => {
      console.error("[FATAL] Unhandled startup error — server is shutting down:", err);
      process.exit(1);
    });
});
