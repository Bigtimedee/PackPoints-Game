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

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

// Serve static files from public folder (card images)
app.use(express.static("public"));

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
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  await storage.initialize();
  await matchService.initialize();
  
  // Verify email configuration
  await verifyEmailConfig();
  
  // Initialize Stripe connection
  try {
    const stripeConfigured = await initializeStripeConnection();
    if (stripeConfigured && process.env.DATABASE_URL) {
      console.log('Initializing Stripe schema...');
      await runMigrations({ 
        databaseUrl: process.env.DATABASE_URL,
        schema: 'stripe'
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
    },
  );
})();
