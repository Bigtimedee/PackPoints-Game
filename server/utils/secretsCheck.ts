/**
 * Production secret enforcement.
 * Fails fast if required secrets are absent or left at known dev defaults.
 * In development, logs loud warnings instead of exiting.
 */

const KNOWN_DEFAULTS: Record<string, string> = {
  IP_HASH_SALT: "default-ip-salt-change-in-production",
  DEVICE_HASH_SALT: "default-device-salt-change-in-production",
  FOUNDERS_PASS_PEPPER: "default-pepper-change-in-production",
  JWT_SECRET: "packpoints-dev-secret-change-me-in-production-2026",
  // daily5 salt — either env var satisfies the check
  _DAILY5_SALT_CHECK: "packpts-daily5-default-salt-change-me",
};

function isProductionEnv(): boolean {
  return (
    process.env.NODE_ENV === "production" ||
    process.env.APP_ENV === "production"
  );
}

export function enforceProductionSecrets(): void {
  const isProd = isProductionEnv();
  const errors: string[] = [];
  const warnings: string[] = [];

  function flag(msg: string) {
    if (isProd) errors.push(msg);
    else warnings.push(msg);
  }

  // --- Hash salts that must not be default strings ---
  for (const [key, defaultVal] of Object.entries(KNOWN_DEFAULTS)) {
    if (key === "_DAILY5_SALT_CHECK") continue; // handled separately below
    const val = process.env[key];
    if (!val || val === defaultVal) {
      flag(
        `${key} is ${val ? "set to the known development default" : "not set"} — ` +
          `set a unique value in Railway Variables`
      );
    }
  }

  // --- Daily-5 salt (either SECRET_SALT or GROWTH_AGENT_SECRET_SALT) ---
  const daily5Salt =
    process.env.SECRET_SALT || process.env.GROWTH_AGENT_SECRET_SALT;
  if (
    !daily5Salt ||
    daily5Salt === KNOWN_DEFAULTS._DAILY5_SALT_CHECK
  ) {
    flag(
      `SECRET_SALT (or GROWTH_AGENT_SECRET_SALT) is ${daily5Salt ? "set to the known development default" : "not set"} — ` +
        `set a unique value in Railway Variables`
    );
  }

  // --- SESSION_SECRET must be present (already fatal in validateEnvironment,
  //     but also verify it's not an obvious placeholder) ---
  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret) {
    flag("SESSION_SECRET is not set — sessions cannot be signed");
  } else if (sessionSecret.length < 32) {
    flag(
      "SESSION_SECRET is too short (< 32 chars) — use `openssl rand -hex 32`"
    );
  }

  // --- Stripe: at least one live key pair must be configured in prod ---
  const hasStripeSecret = !!(
    process.env.STRIPE_secret || process.env.STRIPE_SECRET_KEY
  );
  const hasWebhookSecret = !!(
    process.env.STRIPE_WEBHOOK_SECRET_LIVE ||
    process.env.STRIPE_WEBHOOK_SECRET_TEST ||
    process.env.STRIPE_WEBHOOK_SECRET
  );

  if (!hasStripeSecret) {
    flag(
      "No Stripe secret key found (STRIPE_secret or STRIPE_SECRET_KEY) — payment processing will fail"
    );
  }
  if (!hasWebhookSecret) {
    flag(
      "No Stripe webhook secret found (STRIPE_WEBHOOK_SECRET_LIVE or STRIPE_WEBHOOK_SECRET) — webhook signature verification will fail"
    );
  }

  // --- Report ---
  if (errors.length > 0) {
    console.error(
      "[Startup] FATAL: Production secret check failed. Fix the following before deploying:"
    );
    for (const e of errors) {
      console.error(`  [Startup]   ✗ ${e}`);
    }
    process.exit(1);
  }

  if (warnings.length > 0) {
    console.warn(
      "[Startup] WARNING: Running with development secret defaults. Set these in Railway Variables before going to production:"
    );
    for (const w of warnings) {
      console.warn(`  [Startup]   ⚠  ${w}`);
    }
  }

  if (isProd) {
    console.log("[Startup] Production secret check passed.");
  }
}
