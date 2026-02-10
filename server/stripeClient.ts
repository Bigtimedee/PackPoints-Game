import Stripe from 'stripe';

const PROD_HOSTS = ["packpts.com", "www.packpts.com"];

let connectionSettings: any;
let cachedStripeConfigured: boolean | null = null;
let credentialSource: string = 'none';
let cachedStripeMode: "live" | "test" | null = null;
let cachedCredentials: { publishableKey: string; secretKey: string } | null = null;

export function getStripeMode(host?: string): "live" | "test" {
  const cleanHost = host?.split(":")[0]?.toLowerCase();
  if (cleanHost && PROD_HOSTS.includes(cleanHost)) {
    return "live";
  }
  const appEnv = process.env.APP_ENV?.toLowerCase();
  if (appEnv === "production") {
    return "live";
  }
  const isReplitDeployment = process.env.REPLIT_DEPLOYMENT === '1';
  if (isReplitDeployment) {
    return "live";
  }
  return "test";
}

export function isProductionHost(host?: string): boolean {
  const cleanHost = host?.split(":")[0]?.toLowerCase();
  return !!cleanHost && PROD_HOSTS.includes(cleanHost);
}

function maskKey(key: string): string {
  if (key.length <= 12) return key.substring(0, 7) + "...";
  return key.substring(0, 12) + "****";
}

async function fetchConnectorCredentials(environment: string): Promise<{ publishableKey: string; secretKey: string } | null> {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? 'repl ' + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? 'depl ' + process.env.WEB_REPL_RENEWAL
      : null;

  console.log(`[Stripe] Attempting connector (${environment}): hostname=${hostname ? 'set' : 'unset'}, token=${xReplitToken ? xReplitToken.substring(0, 8) + '...' : 'unset'}, REPL_IDENTITY=${process.env.REPL_IDENTITY ? 'set' : 'unset'}, WEB_REPL_RENEWAL=${process.env.WEB_REPL_RENEWAL ? 'set' : 'unset'}, REPLIT_DEPLOYMENT=${process.env.REPLIT_DEPLOYMENT || 'unset'}`);

  if (!xReplitToken || !hostname) {
    console.log(`[Stripe] Skipping connector (${environment}): missing ${!xReplitToken ? 'token' : 'hostname'}`);
    return null;
  }

  try {
    const url = new URL(`https://${hostname}/api/v2/connection`);
    url.searchParams.set('include_secrets', 'true');
    url.searchParams.set('connector_names', 'stripe');
    url.searchParams.set('environment', environment);

    const response = await fetch(url.toString(), {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    });

    const data = await response.json();
    console.log(`[Stripe] Connector response (${environment}): status=${response.status}, items=${data.items?.length || 0}`);
    
    const settings = data.items?.[0];

    if (settings?.settings?.publishable && settings?.settings?.secret) {
      const keyPrefix = settings.settings.secret.substring(0, 7);
      console.log(`[Stripe] Found credentials via connector (${environment}), key prefix: ${keyPrefix}...`);
      connectionSettings = settings;
      credentialSource = `connector-${environment}`;
      return {
        publishableKey: settings.settings.publishable,
        secretKey: settings.settings.secret,
      };
    } else {
      console.log(`[Stripe] Connector (${environment}) returned item but missing keys. Has publishable: ${!!settings?.settings?.publishable}, Has secret: ${!!settings?.settings?.secret}`);
    }
  } catch (err) {
    console.log(`[Stripe] Connector fetch failed for ${environment}:`, (err as Error).message);
  }

  return null;
}

async function getCredentials(host?: string) {
  const mode = getStripeMode(host);

  const envSecretProd = process.env.STRIPE_secret;
  const envPublishableProd = process.env.STRIPE_publishable;

  const envSecretTest = process.env.STRIPE_SECRET_KEY_TEST;
  const envPublishableTest = process.env.STRIPE_PUBLISHABLE_KEY_TEST;

  const envSecret = process.env.STRIPE_SECRET_KEY;
  const envPublishable = process.env.STRIPE_PUBLISHABLE_KEY;

  if (mode === "live") {
    if (envSecretProd && envPublishableProd) {
      validateKeyPrefix(envSecretProd, "sk_live_", "STRIPE_secret");
      validateKeyPrefix(envPublishableProd, "pk_live_", "STRIPE_publishable");
      console.log(`[Stripe] Using LIVE env vars (STRIPE_secret/STRIPE_publishable), key: ${maskKey(envSecretProd)}`);
      credentialSource = 'env-vars-live';
      return { publishableKey: envPublishableProd, secretKey: envSecretProd };
    }

    if (envSecret && envPublishable) {
      validateKeyPrefix(envSecret, "sk_live_", "STRIPE_SECRET_KEY (live mode)");
      validateKeyPrefix(envPublishable, "pk_live_", "STRIPE_PUBLISHABLE_KEY (live mode)");
      console.log(`[Stripe] Using LIVE credentials from generic env vars, key: ${maskKey(envSecret)}`);
      credentialSource = 'env-vars';
      return { publishableKey: envPublishable, secretKey: envSecret };
    }

    const creds = await fetchConnectorCredentials('production');
    if (creds) {
      validateKeyPrefix(creds.secretKey, "sk_live_", "Connector production credentials");
      validateKeyPrefix(creds.publishableKey, "pk_live_", "Connector production publishable key");
      return creds;
    }

    throw new Error(
      `[Stripe] FATAL: Live mode required but no LIVE Stripe credentials found. ` +
      `Set STRIPE_secret and STRIPE_publishable, or configure the Stripe connector for production. ` +
      `Will NOT fall back to test keys in production.`
    );
  }

  if (envSecretTest && envPublishableTest) {
    validateKeyPrefix(envSecretTest, "sk_test_", "STRIPE_SECRET_KEY_TEST");
    validateKeyPrefix(envPublishableTest, "pk_test_", "STRIPE_PUBLISHABLE_KEY_TEST");
    console.log(`[Stripe] Using TEST env vars, key: ${maskKey(envSecretTest)}`);
    credentialSource = 'env-vars-test';
    return { publishableKey: envPublishableTest, secretKey: envSecretTest };
  }

  if (envSecret && envPublishable) {
    validateKeyPrefix(envSecret, "sk_test_", "STRIPE_SECRET_KEY (test mode — must be a test key)");
    validateKeyPrefix(envPublishable, "pk_test_", "STRIPE_PUBLISHABLE_KEY (test mode — must be a test key)");
    console.log(`[Stripe] Using generic env vars (test mode), key: ${maskKey(envSecret)}`);
    credentialSource = 'env-vars';
    return { publishableKey: envPublishable, secretKey: envSecret };
  }

  const creds = await fetchConnectorCredentials('development');
  if (creds) {
    validateKeyPrefix(creds.secretKey, "sk_test_", "Connector development credentials (test mode)");
    return creds;
  }

  throw new Error(`Stripe connection not found (tried: env vars, connector development). REPLIT_DEPLOYMENT=${process.env.REPLIT_DEPLOYMENT}, CONNECTORS_HOSTNAME=${process.env.REPLIT_CONNECTORS_HOSTNAME ? 'set' : 'unset'}`);
}

function validateKeyPrefix(key: string, expectedPrefix: string, label: string) {
  if (!key.startsWith(expectedPrefix)) {
    throw new Error(
      `[Stripe] FATAL: ${label} has prefix "${key.substring(0, 8)}..." but expected "${expectedPrefix}". ` +
      `Refusing to proceed — this prevents using test keys in production or vice versa.`
    );
  }
}

export function assertLiveModeForHost(host: string | undefined) {
  if (!host) return;
  const cleanHost = host.split(":")[0]?.toLowerCase();
  if (PROD_HOSTS.includes(cleanHost)) {
    const mode = getStripeMode(host);
    if (mode !== "live") {
      throw new Error(
        `[Stripe] BLOCKED: Production host "${cleanHost}" requires LIVE mode but resolved to "${mode}". ` +
        `Checkout sessions CANNOT be created with test keys on production.`
      );
    }
  }
}

export function getStripeCredentialSource(): string {
  return credentialSource;
}

export function getWebhookSecret(host?: string): string | null {
  const mode = getStripeMode(host);

  if (mode === "live") {
    const secret = process.env.STRIPE_WEBHOOK_SECRET_LIVE || process.env.STRIPE_WEBHOOK_SECRET;
    if (secret && secret.startsWith("whsec_")) return secret;
    return null;
  }

  const secret = process.env.STRIPE_WEBHOOK_SECRET_TEST || process.env.STRIPE_WEBHOOK_SECRET;
  if (secret && secret.startsWith("whsec_")) return secret;
  return null;
}

export function getStripeDiagnostics(): Record<string, any> {
  const mode = cachedStripeMode || getStripeMode();
  return {
    configured: cachedStripeConfigured,
    credentialSource,
    mode,
    isProduction: process.env.REPLIT_DEPLOYMENT === '1',
    appEnv: process.env.APP_ENV || 'not set',
    hasConnectorHostname: !!process.env.REPLIT_CONNECTORS_HOSTNAME,
    hasReplIdentity: !!process.env.REPL_IDENTITY,
    hasWebReplRenewal: !!process.env.WEB_REPL_RENEWAL,
    hasEnvSecretKey: !!process.env.STRIPE_SECRET_KEY,
    hasEnvPublishableKey: !!process.env.STRIPE_PUBLISHABLE_KEY,
    hasStripeSecret: !!process.env.STRIPE_secret,
    hasStripePublishable: !!process.env.STRIPE_publishable,
    hasEnvSecretKeyTest: !!process.env.STRIPE_SECRET_KEY_TEST,
    hasWebhookSecretLive: !!process.env.STRIPE_WEBHOOK_SECRET_LIVE,
    hasWebhookSecretTest: !!process.env.STRIPE_WEBHOOK_SECRET_TEST,
    hasWebhookSecret: !!process.env.STRIPE_WEBHOOK_SECRET,
    webhookVerificationMethod: getWebhookSecret() ? "direct" : "stripeSync",
  };
}

export async function getStripeClient(host?: string): Promise<Stripe> {
  const { secretKey } = await getCredentials(host);

  return new Stripe(secretKey, {
    apiVersion: '2025-08-27.basil' as any,
  });
}

export async function getStripePublishableKey(host?: string): Promise<string> {
  const { publishableKey } = await getCredentials(host);
  return publishableKey;
}

export async function getStripeSecretKey(host?: string): Promise<string> {
  const { secretKey } = await getCredentials(host);
  return secretKey;
}

export async function isStripeConfiguredAsync(): Promise<boolean> {
  if (cachedStripeConfigured === true) {
    return true;
  }
  
  try {
    await getCredentials();
    cachedStripeConfigured = true;
    return true;
  } catch (err) {
    console.log('[Stripe] Configuration check failed:', (err as Error).message);
    return false;
  }
}

export function isStripeConfiguredSync(): boolean {
  return cachedStripeConfigured === true;
}

export async function initializeStripeConnection(): Promise<boolean> {
  const mode = getStripeMode();
  cachedStripeMode = mode;

  console.log(`[Stripe] ========================================`);
  console.log(`[Stripe] Stripe mode active: ${mode.toUpperCase()}`);
  console.log(`[Stripe] APP_ENV: ${process.env.APP_ENV || 'not set'}`);
  console.log(`[Stripe] REPLIT_DEPLOYMENT: ${process.env.REPLIT_DEPLOYMENT || 'not set'}`);
  console.log(`[Stripe] ========================================`);

  cachedStripeConfigured = await isStripeConfiguredAsync();
  if (cachedStripeConfigured) {
    const creds = await getCredentials();
    cachedCredentials = creds;
    console.log(`[Stripe] Connection verified - Mode: ${mode.toUpperCase()}, Key prefix: ${maskKey(creds.secretKey)}, Source: ${credentialSource}`);
    
    const whSecret = getWebhookSecret();
    console.log(`[Stripe] Webhook secret: ${whSecret ? "configured (direct verification)" : "NOT SET (using stripeSync fallback)"}`);
    
    if (mode === "live") {
      console.log(`[Stripe] LIVE STRIPE ENABLED - Production payments active`);
      if (!whSecret) {
        console.warn(`[Stripe] WARNING: No STRIPE_WEBHOOK_SECRET_LIVE set. Webhook verification will use stripeSync managed secret. Set STRIPE_WEBHOOK_SECRET_LIVE for direct Stripe Dashboard webhooks.`);
      }
    } else {
      console.log(`[Stripe] TEST STRIPE ENABLED - Sandbox/test mode active`);
    }
  } else {
    console.log('Stripe connection not configured');
    if (mode === "live") {
      console.error(`[Stripe] CRITICAL: Live mode required but Stripe is NOT configured. Payments will be blocked.`);
    }
  }
  return cachedStripeConfigured;
}

let stripeSync: any = null;

export async function getStripeSync(host?: string) {
  if (!stripeSync) {
    const { StripeSync } = await import('stripe-replit-sync');
    const secretKey = await getStripeSecretKey(host);

    stripeSync = new StripeSync({
      poolConfig: {
        connectionString: process.env.DATABASE_URL!,
        max: 2,
      },
      stripeSecretKey: secretKey,
    });
  }
  return stripeSync;
}

export async function getStripeConfig(host?: string): Promise<{ mode: "live" | "test"; publishableKey: string }> {
  const mode = getStripeMode(host);
  const publishableKey = await getStripePublishableKey(host);
  return { mode, publishableKey };
}
