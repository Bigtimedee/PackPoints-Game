import Stripe from 'stripe';

let connectionSettings: any;
let cachedStripeConfigured: boolean | null = null;
let credentialSource: string = 'none';

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

async function getCredentials() {
  const isProduction = process.env.REPLIT_DEPLOYMENT === '1';
  const primaryEnv = isProduction ? 'production' : 'development';

  let creds = await fetchConnectorCredentials(primaryEnv);
  if (creds) return creds;

  if (isProduction) {
    console.log('[Stripe] Production credentials not found, falling back to development connector');
    creds = await fetchConnectorCredentials('development');
    if (creds) return creds;
  }

  const envSecret = process.env.STRIPE_SECRET_KEY;
  const envPublishable = process.env.STRIPE_PUBLISHABLE_KEY;
  if (envSecret && envPublishable) {
    console.log(`[Stripe] Found credentials via environment variables, key prefix: ${envSecret.substring(0, 7)}...`);
    credentialSource = 'env-vars';
    return { publishableKey: envPublishable, secretKey: envSecret };
  }

  if (envSecret) {
    console.log(`[Stripe] Found STRIPE_SECRET_KEY but missing STRIPE_PUBLISHABLE_KEY`);
  }
  if (envPublishable) {
    console.log(`[Stripe] Found STRIPE_PUBLISHABLE_KEY but missing STRIPE_SECRET_KEY`);
  }

  throw new Error(`Stripe connection not found (tried: connector ${isProduction ? 'production+development' : 'development'}, env vars). REPLIT_DEPLOYMENT=${process.env.REPLIT_DEPLOYMENT}, CONNECTORS_HOSTNAME=${process.env.REPLIT_CONNECTORS_HOSTNAME ? 'set' : 'unset'}`);
}

export function getStripeCredentialSource(): string {
  return credentialSource;
}

export function getStripeDiagnostics(): Record<string, any> {
  return {
    configured: cachedStripeConfigured,
    credentialSource,
    isProduction: process.env.REPLIT_DEPLOYMENT === '1',
    hasConnectorHostname: !!process.env.REPLIT_CONNECTORS_HOSTNAME,
    hasReplIdentity: !!process.env.REPL_IDENTITY,
    hasWebReplRenewal: !!process.env.WEB_REPL_RENEWAL,
    hasEnvSecretKey: !!process.env.STRIPE_SECRET_KEY,
    hasEnvPublishableKey: !!process.env.STRIPE_PUBLISHABLE_KEY,
  };
}

export async function getStripeClient(): Promise<Stripe> {
  const { secretKey } = await getCredentials();

  return new Stripe(secretKey, {
    apiVersion: '2025-08-27.basil' as any,
  });
}

export async function getStripePublishableKey(): Promise<string> {
  const { publishableKey } = await getCredentials();
  return publishableKey;
}

export async function getStripeSecretKey(): Promise<string> {
  const { secretKey } = await getCredentials();
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
  cachedStripeConfigured = await isStripeConfiguredAsync();
  if (cachedStripeConfigured) {
    console.log('Stripe connection verified successfully');
  } else {
    console.log('Stripe connection not configured');
  }
  return cachedStripeConfigured;
}

let stripeSync: any = null;

export async function getStripeSync() {
  if (!stripeSync) {
    const { StripeSync } = await import('stripe-replit-sync');
    const secretKey = await getStripeSecretKey();

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
