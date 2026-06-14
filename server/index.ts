import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { storage } from "./storage";
import { setupWebSocket } from "./websocket";
import { matchService } from "./services/matchService";
import { setupAuth, registerAuthRoutes } from "./auth";
import { verifyEmailConfig } from "./services/emailService";
import { registerWorkosRoutes } from "./services/workosAuth";
import { initializeStripeConnection } from "./stripeClient";
import { seedPackageGuardrailConfig } from "./services/store/packageGuardrailService";
import { seedRewardPolicy } from "./services/rewardEngine";
import { requestIdMiddleware, structuredRequestLogger } from "./middleware/requestLogger";
import { errorMonitor } from './services/errorMonitor';
import { validateStripeEnvVars } from "./services/productMap";

// --- Environment validation ---
function validateEnvironment() {
  const REQUIRED = ['DATABASE_URL', 'SESSION_SECRET'];
  const RECOMMENDED = [
    { key: 'STRIPE_SECRET_KEY', feature: 'Stripe payments' },
    { key: 'STRIPE_WEBHOOK_SECRET', feature: 'Stripe webhooks' },
    { key: 'WORKOS_API_KEY', feature: 'WorkOS auth' },
    { key: 'OPENAI_API_KEY', feature: 'AI content generation' },
  ];

  const missing: string[] = [];
  for (const key of REQUIRED) {
    if (!process.env[key]) missing.push(key);
  }

  if (missing.length > 0) {
    console.error(`[Startup] FATAL: Missing required environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }

  for (const { key, feature } of RECOMMENDED) {
    if (!process.env[key]) {
      console.warn(`[Startup] WARNING: ${key} not set — ${feature} will be unavailable`);
    }
  }

  console.log('[Startup] Environment validation passed.');
}

validateEnvironment();
validateStripeEnvVars();

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use((req, res, next) => {
  if (req.path.startsWith('/webhooks/')) {
    return next();
  }
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })(req, res, next);
});

app.use(express.urlencoded({ extended: false }));

// --- CORS Middleware (native, no external package required) ---
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:5000', 'http://localhost:3000'];

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-Id, X-Idempotency-Key');
  }
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  next();
});

app.use(requestIdMiddleware);
app.use(structuredRequestLogger);

// Serve static files from public folder (card images)
app.use(express.static("public"));

const PII_KEYS = new Set(['email', 'emailAddress', 'password', 'phone', 'phoneNumber', 'ssn', 'address', 'firstName', 'lastName', 'first_name', 'last_name']);

function sanitizeForLog(obj: any, depth = 0): any {
  if (depth > 5 || obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return obj;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) {
    if (obj.length > 5) return `[Array(${obj.length})]`;
    return obj.map(item => sanitizeForLog(item, depth + 1));
  }
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (PII_KEYS.has(key)) {
      result[key] = '[REDACTED]';
    } else {
      result[key] = sanitizeForLog(value, depth + 1);
    }
  }
  return result;
}

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        const safeBody = sanitizeForLog(capturedJsonResponse);
        logLine += ` :: ${JSON.stringify(safeBody)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  try {
    await storage.initialize();
  } catch (err) {
    console.error("[Startup] storage.initialize() failed:", err);
    // Non-fatal: app can still serve requests without pre-loaded card data
  }

  try {
    await matchService.initialize();
  } catch (err) {
    console.error("[Startup] matchService.initialize() failed:", err);
    // Non-fatal: match service will re-initialize on first use
  }
  
  // Seed package guardrail configuration
  try {
    await seedPackageGuardrailConfig();
  } catch (error) {
    console.log('[PackageGuardrails] Seed failed:', error instanceof Error ? error.message : 'Unknown');
  }
  
  // Seed reward policy for gameplay
  try {
    await seedRewardPolicy();
  } catch (error) {
    console.log('[RewardEngine] Seed failed:', error instanceof Error ? error.message : 'Unknown');
  }
  
  // Verify email configuration
  try {
    await verifyEmailConfig();
  } catch (err) {
    console.error("[Startup] verifyEmailConfig() failed (non-fatal):", err);
  }

  // Initialize Stripe connection
  try {
    const stripeConfigured = await initializeStripeConnection();
    if (stripeConfigured) {
      console.log('[Stripe] Connection initialized successfully');
    }
  } catch (error) {
    console.log('Stripe initialization skipped:', error instanceof Error ? error.message : 'Unknown error');
  }
  
  // Setup Auth (session middleware + passport — BEFORE registering other routes)
  try {
    await setupAuth(app);
  } catch (err) {
    console.error("[Startup] setupAuth() failed (non-fatal):", err);
  }
  registerAuthRoutes(app);
  registerWorkosRoutes(app);
  
  // Register OpenAPI docs (dev only or when SHOW_API_DOCS=true)
  const { registerOpenApiRoute } = await import('./openapi');
  registerOpenApiRoute(app);

  // Sync publishing queue to Notion (every 15 minutes, if configured)
  if (process.env.NOTION_API_KEY && process.env.NOTION_DATABASE_ID) {
    const { syncPendingToNotion } = await import('./services/notionService');
    const { scheduleRecurringJob: scheduleJob } = await import('./jobs/pgJobQueue');
    scheduleJob(
      'notion_sync',
      async () => { await syncPendingToNotion(); },
      15 * 60 * 1000,
      true
    );
    console.log('[Notion] Sync job scheduled (every 15 minutes)');
  } else {
    console.log('[Notion] Skipping sync job — NOTION_API_KEY or NOTION_DATABASE_ID not set');
  }

  setupWebSocket(httpServer);
  console.log("[Startup] Registering routes...");
  await registerRoutes(httpServer, app);
  console.log("[Startup] Routes registered successfully");

  // Start the risk pipeline job worker
  if (process.env.RISK_PIPELINE_ENABLED !== "false") {
    const { startRiskJobWorker } = await import("./services/risk/jobQueue");
    startRiskJobWorker();
  }
  
  // Initialize persistent job queue
  const { scheduleRecurringJob } = await import('./jobs/pgJobQueue');

  // Start the image validation job (runs every 6 hours)
  if (process.env.IMAGE_VALIDATION_ENABLED !== "false") {
    const { startValidationJob } = await import("./services/imageValidation");
    startValidationJob();
  }

  // Start the card pool refresh job (runs every 12 hours to revalidate excluded cards)
  // Now wrapped in persistent job queue for crash-resistant, retry-safe execution
  if (process.env.CARD_POOL_REFRESH_ENABLED !== "false") {
    const { runCardPoolRefreshJob } = await import("./services/cardPoolRefresh");
    console.log("[CardPoolRefresh] Registering with persistent job queue (every 12 hours)");
    scheduleRecurringJob(
      'card_pool_refresh',
      async () => { await runCardPoolRefreshJob(); },
      12 * 60 * 60 * 1000,
      true // run after 5-min delay via runImmediately flag
    );
  }

  {
    const { cleanupStaleGameSessions } = await import("./services/staleGameSessionCleanup");
    console.log("[GameSessionCleanup] Registering with persistent job queue (every 1 hour)");
    scheduleRecurringJob(
      'stale_game_session_cleanup',
      async () => { await cleanupStaleGameSessions(); },
      60 * 60 * 1000,
      true
    );
  }

  {
    const { cleanupStaleLobbiesAndMatches } = await import("./services/staleMatchCleanup");
    console.log("[MatchCleanup] Registering with persistent job queue (every 1 hour)");
    scheduleRecurringJob(
      'stale_match_cleanup',
      async () => { await cleanupStaleLobbiesAndMatches(); },
      60 * 60 * 1000,
      true
    );
  }

  if (process.env.STALE_REDEMPTION_CLEANUP_ENABLED !== "false") {
    const { runStaleRedemptionCleanup } = await import("./services/staleRedemptionCleanup");
    console.log("[StaleCleanup] Registering with persistent job queue (every 1 hour)");
    scheduleRecurringJob(
      'stale_redemption_cleanup',
      async () => { await runStaleRedemptionCleanup(); },
      60 * 60 * 1000,
      true
    );
  }

  if (process.env.EXPIRATION_ENABLED !== "false") {
    const { expirationEngine } = await import("./services/expirationEngine");
    const runHourUTC = parseInt(process.env.EXPIRATION_RUN_HOUR_UTC || "6", 10);
    console.log(`[Expiration] Registering with persistent job queue (daily at ${runHourUTC}:00 UTC; hourly check)`);
    scheduleRecurringJob(
      'packpts_expiration',
      async () => {
        const now = new Date();
        if (now.getUTCHours() !== runHourUTC) return;
        const result = await expirationEngine.runExpirationJob(false);
        const errSuffix = result.errors.length > 0 ? `, errors=${result.errors.length}` : '';
        console.log(`[Expiration] Date-based run complete: buckets=${result.expiredBuckets}, points=${result.totalPointsExpired}${errSuffix}`);
        if (result.errors.length > 0) {
          for (const err of result.errors.slice(0, 5)) {
            console.error(`[Expiration] error: ${err}`);
          }
        }
      },
      60 * 60 * 1000,
      false
    );
  }

  // Weekly newsletter (Sundays at 10am UTC = 36 hours of weekly cycle check)
  // Using daily check pattern to avoid relying on exact 7-day timing
  if (process.env.NEWSLETTER_ENABLED === 'true') {
    const { sendWeeklyNewsletter } = await import('./services/newsletterService');
    const { scheduleRecurringJob: scheduleNewsletterJob } = await import('./jobs/pgJobQueue');

    const checkAndSendNewsletter = async () => {
      const now = new Date();
      // Only send on Sundays at hour 10 UTC
      if (now.getUTCDay() === 0 && now.getUTCHours() === 10) {
        await sendWeeklyNewsletter();
      }
    };

    scheduleNewsletterJob(
      'weekly_newsletter',
      checkAndSendNewsletter,
      60 * 60 * 1000, // Check every hour
      false
    );
    console.log('[Newsletter] Weekly newsletter job scheduled');
  }

  app.use(errorMonitor.expressErrorHandler());
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    console.error('[Error]', err);
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.on("error", (err: NodeJS.ErrnoException) => {
    console.error(`[FATAL] HTTP server error (${err.code}):`, err.message);
    process.exit(1);
  });
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
    },
    () => {
      log(`serving on port ${port}`);

      (async () => {
        try {
          const { backfillProgressForFinishedMatches } = await import("./services/progress/dailyProgress");
          const result = await backfillProgressForFinishedMatches();
          if (result.matchesProcessed > 0) {
            console.log(`[StartupBackfill] Backfilled ${result.matchesProcessed} matches, skipped ${result.matchesSkipped}, errors: ${result.errors.length}`);
          }
        } catch (err) {
          console.error("[StartupBackfill] Progress backfill failed:", err);
        }

        try {
          const { backfillUncreditedWalletPoints } = await import("./services/rewards/dailyGameplayBase");
          const walletResult = await backfillUncreditedWalletPoints();
          if (walletResult.totalPointsCredited > 0) {
            console.log(`[StartupBackfill] Wallet backfill: ${walletResult.totalPointsCredited} pts credited to ${walletResult.details.length} user-days, ${walletResult.errors.length} errors`);
          }
        } catch (err) {
          console.error("[StartupBackfill] Wallet backfill failed:", err);
        }

        try {
          const { backfillPointsAwardsToWallet } = await import("./services/rewards/dailyGameplayBase");
          const awardsResult = await backfillPointsAwardsToWallet();
          if (awardsResult.totalPointsCredited > 0) {
            console.log(`[StartupBackfill] Points awards backfill: ${awardsResult.totalPointsCredited} pts credited to ${awardsResult.usersProcessed} users, ${awardsResult.errors.length} errors`);
          }
        } catch (err) {
          console.error("[StartupBackfill] Points awards backfill failed:", err);
        }

        try {
          const { startWebhookRetryWorker } = await import("./services/webhookRetryWorker");
          startWebhookRetryWorker();
        } catch (err) {
          console.error("[WebhookRetryWorker] Failed to start:", err);
        }

        if (process.env.SOCIAL_MEDIA_AGENT_ENABLED === "true") {
          try {
            const { initSocialMediaAgent } = await import("./services/socialMedia");
            await initSocialMediaAgent();
          } catch (err) {
            console.error("[SocialMediaAgent] Failed to initialize:", err);
          }
        }

        try {
          const { startRetentionEmailLoops } = await import("./services/retentionEmails");
          startRetentionEmailLoops();
        } catch (err) {
          console.error("[RetentionEmails] Failed to start loops:", err);
        }


      })().catch((err) => {
        console.error("[StartupBackfill] Unhandled error in post-listen initialization:", err);
      });
    },
  );
})().catch((err) => {
  console.error("[FATAL] Unhandled startup error — server is shutting down:", err);
  process.exit(1);
});
