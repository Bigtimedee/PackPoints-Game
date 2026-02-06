import Stripe from 'stripe';

let connectionSettings: any;
let cachedStripeConfigured: boolean | null = null;

async function fetchConnectorCredentials(environment: string): Promise<{ publishableKey: string; secretKey: string } | null> {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? 'repl ' + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? 'depl ' + process.env.WEB_REPL_RENEWAL
      : null;

  if (!xReplitToken || !hostname) {
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
    const settings = data.items?.[0];

    if (settings?.settings?.publishable && settings?.settings?.secret) {
      console.log(`[Stripe] Found credentials via connector (${environment})`);
      connectionSettings = settings;
      return {
        publishableKey: settings.settings.publishable,
        secretKey: settings.settings.secret,
      };
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

  throw new Error(`Stripe connection not found (tried ${isProduction ? 'production, development' : 'development'})`);
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
