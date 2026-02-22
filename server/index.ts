import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { storage } from "./storage";
import { setupWebSocket } from "./websocket";
import { matchService } from "./services/matchService";
import { setupAuth, registerAuthRoutes } from "./replit_integrations/auth";
import { verifyEmailConfig } from "./services/emailService";
import { registerWorkosRoutes } from "./services/workosAuth";
import { initializeStripeConnection, getStripeSync } from "./stripeClient";
import { runMigrations } from "stripe-replit-sync";
import { seedPackageGuardrailConfig } from "./services/store/packageGuardrailService";
import { seedRewardPolicy } from "./services/rewardEngine";
import { requestIdMiddleware, structuredRequestLogger } from "./middleware/requestLogger";

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
  await storage.initialize();
  await matchService.initialize();
  
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
  await verifyEmailConfig();
  
  // Initialize Stripe connection
  try {
    const stripeConfigured = await initializeStripeConnection();
    if (stripeConfigured && process.env.DATABASE_URL) {
      console.log('Initializing Stripe schema...');
      await runMigrations({ 
        databaseUrl: process.env.DATABASE_URL
      });
      console.log('Stripe schema ready');
      
      // Get StripeSync instance and set up managed webhook
      const stripeSync = await getStripeSync();
      const replitDomain = process.env.REPLIT_DOMAINS?.split(',')[0];
      if (replitDomain) {
        console.log('Setting up managed webhook...');
        const webhookBaseUrl = `https://${replitDomain}`;
        try {
          const webhookResult = await stripeSync.findOrCreateManagedWebhook(
            `${webhookBaseUrl}/webhooks/purchases`
          );
          console.log('Webhook configured:', webhookResult?.webhook?.url || 'configured');
        } catch (webhookError) {
          console.log('Webhook setup error:', webhookError instanceof Error ? webhookError.message : 'Unknown');
        }
      } else {
        console.log('Skipping webhook setup: REPLIT_DOMAINS not configured');
      }
      
      // Sync all existing Stripe data in background
      console.log('Syncing Stripe data...');
      stripeSync.syncBackfill()
        .then(() => console.log('Stripe data synced'))
        .catch((err: any) => console.error('Error syncing Stripe data:', err));
    }
  } catch (error) {
    console.log('Stripe initialization skipped:', error instanceof Error ? error.message : 'Unknown error');
  }
  
  // Setup Replit Auth (BEFORE registering other routes)
  await setupAuth(app);
  registerAuthRoutes(app);
  registerWorkosRoutes(app);
  
  setupWebSocket(httpServer);
  await registerRoutes(httpServer, app);

  // Start the risk pipeline job worker
  if (process.env.RISK_PIPELINE_ENABLED !== "false") {
    const { startRiskJobWorker } = await import("./services/risk/jobQueue");
    startRiskJobWorker();
  }
  
  // Start the image validation job (runs every 6 hours)
  if (process.env.IMAGE_VALIDATION_ENABLED !== "false") {
    const { startValidationJob } = await import("./services/imageValidation");
    startValidationJob();
  }

  // Start the card pool refresh job (runs every 12 hours to revalidate excluded cards)
  if (process.env.CARD_POOL_REFRESH_ENABLED !== "false") {
    const { runCardPoolRefreshJob } = await import("./services/cardPoolRefresh");
    console.log("[CardPoolRefresh] Starting scheduled refresh job (every 12 hours)");
    
    // Run initial refresh after 5 minutes to allow system to stabilize
    setTimeout(() => {
      runCardPoolRefreshJob().catch(err => {
        console.error("[CardPoolRefresh] Initial refresh failed:", err);
      });
    }, 5 * 60 * 1000);

    // Run every 12 hours
    setInterval(() => {
      runCardPoolRefreshJob().catch(err => {
        console.error("[CardPoolRefresh] Scheduled refresh failed:", err);
      });
    }, 12 * 60 * 60 * 1000);
  }

  {
    const { cleanupStaleGameSessions } = await import("./services/staleGameSessionCleanup");
    console.log("[GameSessionCleanup] Starting scheduled stale game session cleanup (every 1 hour)");
    setTimeout(() => {
      cleanupStaleGameSessions().catch(err => {
        console.error("[GameSessionCleanup] Initial cleanup failed:", err);
      });
    }, 30 * 1000);
    setInterval(() => {
      cleanupStaleGameSessions().catch(err => {
        console.error("[GameSessionCleanup] Scheduled cleanup failed:", err);
      });
    }, 60 * 60 * 1000);
  }

  if (process.env.STALE_REDEMPTION_CLEANUP_ENABLED !== "false") {
    const { runStaleRedemptionCleanup } = await import("./services/staleRedemptionCleanup");
    console.log("[StaleCleanup] Starting scheduled stale redemption cleanup (every 1 hour)");

    setTimeout(() => {
      runStaleRedemptionCleanup().catch(err => {
        console.error("[StaleCleanup] Initial cleanup failed:", err);
      });
    }, 2 * 60 * 1000);

    setInterval(() => {
      runStaleRedemptionCleanup().catch(err => {
        console.error("[StaleCleanup] Scheduled cleanup failed:", err);
      });
    }, 60 * 60 * 1000);
  }

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
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
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
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

        try {
          const { initGrowthAgent } = await import("./services/growth");
          await initGrowthAgent();
        } catch (err) {
          console.error("[GrowthAgent] Failed to initialize:", err);
        }

        try {
          const { verifyFFmpeg, isVideoFactoryEnabled, isFFmpegAvailable } = await import("./videoFactory");
          if (isVideoFactoryEnabled()) {
            verifyFFmpeg();
            if (isFFmpegAvailable()) {
              console.log("[VideoFactory] Enabled and ready");
            } else {
              console.warn("[VideoFactory] DEGRADED: Enabled but FFmpeg not found - video rendering will be unavailable");
            }
          } else {
            console.log("[VideoFactory] Disabled (set VIDEO_FACTORY_ENABLED=true to enable)");
          }
        } catch (err) {
          console.error("[VideoFactory] Init check failed:", err);
        }
      })();
    },
  );
})();
