import session from "express-session";
import connectPg from "connect-pg-simple";

let sessionMiddlewareInstance: ReturnType<typeof session> | null = null;

export function getSession() {
  if (sessionMiddlewareInstance) {
    return sessionMiddlewareInstance;
  }

  console.log("[Session] Initializing session store...");
  console.log("[Session] DATABASE_URL configured:", !!process.env.DATABASE_URL);
  console.log("[Session] SESSION_SECRET configured:", !!process.env.SESSION_SECRET);

  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week
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

  const isDev = process.env.NODE_ENV === "development";
  sessionMiddlewareInstance = session({
    secret: process.env.SESSION_SECRET!,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      // In development (HTTP localhost) cookies must not require HTTPS.
      // In production the app is served over HTTPS via the upstream proxy.
      secure: !isDev,
      sameSite: isDev ? "lax" : "none",
      maxAge: sessionTtl,
    },
  });

  console.log("[Session] Session middleware initialized successfully");
  return sessionMiddlewareInstance;
}
