import session from "express-session";
import connectPg from "connect-pg-simple";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 1 week

/**
 * First-party SPA on packpts.com (host-only cookies; www → apex).
 * WorkOS / TikTok OAuth callbacks are top-level GET navigations to apex, which
 * send SameSite=Lax cookies. SameSite=None is not required for that flow and
 * would allow credentialed cross-site POSTs against cookie-auth /api/*.
 */
export function getSessionCookieOptions(): {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  maxAge: number;
} {
  const isDev = process.env.NODE_ENV === "development";
  return {
    httpOnly: true,
    // HTTP localhost must not require HTTPS; production is HTTPS via the proxy.
    secure: !isDev,
    sameSite: "lax",
    maxAge: SESSION_TTL_MS,
  };
}

let sessionMiddlewareInstance: ReturnType<typeof session> | null = null;

export function getSession() {
  if (sessionMiddlewareInstance) {
    return sessionMiddlewareInstance;
  }

  console.log("[Session] Initializing session store...");
  console.log("[Session] DATABASE_URL configured:", !!process.env.DATABASE_URL);
  console.log("[Session] SESSION_SECRET configured:", !!process.env.SESSION_SECRET);

  const sessionTtl = SESSION_TTL_MS;
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: true,
    ttl: sessionTtl,
    tableName: "sessions",
    errorLog: (error: Error) => {
      console.error("[Session] PostgreSQL session store error:", error.message);
      console.error("[Session] Error stack:", error.stack);
    },
  });

  sessionStore.on('error', (error: Error) => {
    console.error("[Session] Session store connection error:", error.message);
  });

  sessionMiddlewareInstance = session({
    secret: process.env.SESSION_SECRET!,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: getSessionCookieOptions(),
  });

  console.log("[Session] Session middleware initialized successfully");
  return sessionMiddlewareInstance;
}
