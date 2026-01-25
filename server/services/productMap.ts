// Product mapping from store identifiers to internal SKUs
// This maps Apple App Store, Google Play, and web payment product IDs to our internal SKU system

export interface ProductMapping {
  internalSku: string;
  displayName: string;
  type: "CONSUMABLE" | "ENTITLEMENT" | "SUBSCRIPTION";
}

// Dynamic Stripe price ID mappings from environment variables
// Set these in your environment to map your actual Stripe price IDs to internal SKUs
// Example: STRIPE_PRICE_PACKPTS_500=price_1234abcd
const STRIPE_PRICE_PACKPTS_500 = process.env.STRIPE_PRICE_PACKPTS_500;
const STRIPE_PRICE_PACKPTS_1500 = process.env.STRIPE_PRICE_PACKPTS_1500;
const STRIPE_PRICE_PACKPTS_6000 = process.env.STRIPE_PRICE_PACKPTS_6000;
const STRIPE_PRICE_PRO_MONTHLY = process.env.STRIPE_PRICE_PRO_MONTHLY;
const STRIPE_PRICE_LEGEND_MODE = process.env.STRIPE_PRICE_LEGEND_MODE;

// Monthly PackPTS subscription price IDs
const STRIPE_PRICE_PACKPTS_MONTHLY_500 = process.env.STRIPE_PRICE_PACKPTS_MONTHLY_500;
const STRIPE_PRICE_PACKPTS_MONTHLY_2000 = process.env.STRIPE_PRICE_PACKPTS_MONTHLY_2000;
const STRIPE_PRICE_PACKPTS_MONTHLY_5000 = process.env.STRIPE_PRICE_PACKPTS_MONTHLY_5000;

// Build dynamic store product map
function buildStoreProductMap(): Record<string, ProductMapping> {
  const map: Record<string, ProductMapping> = {
    // Apple App Store product IDs
    "com.packpoints.packpts500": {
      internalSku: "PACKPTS_500",
      displayName: "500 PackPTS",
      type: "CONSUMABLE",
    },
    "com.packpoints.packpts1500": {
      internalSku: "PACKPTS_1500",
      displayName: "1,500 PackPTS",
      type: "CONSUMABLE",
    },
    "com.packpoints.packpts6000": {
      internalSku: "PACKPTS_6000",
      displayName: "6,000 PackPTS",
      type: "CONSUMABLE",
    },
    "com.packpoints.packpts15000": {
      internalSku: "PACKPTS_15000",
      displayName: "15,000 PackPTS",
      type: "CONSUMABLE",
    },
    "com.packpoints.pro_monthly": {
      internalSku: "PRO_MONTHLY",
      displayName: "Pro Monthly",
      type: "SUBSCRIPTION",
    },
    "com.packpoints.legend_mode": {
      internalSku: "LEGEND_MODE_PASS",
      displayName: "Legend Mode Pass",
      type: "ENTITLEMENT",
    },

    // Google Play product IDs
    "packpts_500": {
      internalSku: "PACKPTS_500",
      displayName: "500 PackPTS",
      type: "CONSUMABLE",
    },
    "packpts_1500": {
      internalSku: "PACKPTS_1500",
      displayName: "1,500 PackPTS",
      type: "CONSUMABLE",
    },
    "packpts_6000": {
      internalSku: "PACKPTS_6000",
      displayName: "6,000 PackPTS",
      type: "CONSUMABLE",
    },
    "packpts_15000": {
      internalSku: "PACKPTS_15000",
      displayName: "15,000 PackPTS",
      type: "CONSUMABLE",
    },
    "pro_monthly": {
      internalSku: "PRO_MONTHLY",
      displayName: "Pro Monthly",
      type: "SUBSCRIPTION",
    },
    "legend_mode_pass": {
      internalSku: "LEGEND_MODE_PASS",
      displayName: "Legend Mode Pass",
      type: "ENTITLEMENT",
    },

    // Monthly PackPTS subscription products
    "com.packpoints.packpts_monthly_500": {
      internalSku: "PACKPTS_MONTHLY_500",
      displayName: "Starter Pack (500 PackPTS/month)",
      type: "SUBSCRIPTION",
    },
    "com.packpoints.packpts_monthly_2000": {
      internalSku: "PACKPTS_MONTHLY_2000",
      displayName: "Collector Pack (2,000 PackPTS/month)",
      type: "SUBSCRIPTION",
    },
    "com.packpoints.packpts_monthly_5000": {
      internalSku: "PACKPTS_MONTHLY_5000",
      displayName: "Legend Pack (5,000 PackPTS/month)",
      type: "SUBSCRIPTION",
    },
    "packpts_monthly_500": {
      internalSku: "PACKPTS_MONTHLY_500",
      displayName: "Starter Pack (500 PackPTS/month)",
      type: "SUBSCRIPTION",
    },
    "packpts_monthly_2000": {
      internalSku: "PACKPTS_MONTHLY_2000",
      displayName: "Collector Pack (2,000 PackPTS/month)",
      type: "SUBSCRIPTION",
    },
    "packpts_monthly_5000": {
      internalSku: "PACKPTS_MONTHLY_5000",
      displayName: "Legend Pack (5,000 PackPTS/month)",
      type: "SUBSCRIPTION",
    },

    // Static Stripe/Web payment product IDs (fallback patterns)
    "price_packpts_500": {
      internalSku: "PACKPTS_500",
      displayName: "500 PackPTS",
      type: "CONSUMABLE",
    },
    "price_packpts_1500": {
      internalSku: "PACKPTS_1500",
      displayName: "1,500 PackPTS",
      type: "CONSUMABLE",
    },
    "price_packpts_6000": {
      internalSku: "PACKPTS_6000",
      displayName: "6,000 PackPTS",
      type: "CONSUMABLE",
    },
    "price_packpts_15000": {
      internalSku: "PACKPTS_15000",
      displayName: "15,000 PackPTS",
      type: "CONSUMABLE",
    },
    "price_pro_monthly": {
      internalSku: "PRO_MONTHLY",
      displayName: "Pro Monthly",
      type: "SUBSCRIPTION",
    },
    "price_legend_mode": {
      internalSku: "LEGEND_MODE_PASS",
      displayName: "Legend Mode Pass",
      type: "ENTITLEMENT",
    },
    
    // Monthly PackPTS subscription fallback patterns
    "price_packpts_monthly_500": {
      internalSku: "PACKPTS_MONTHLY_500",
      displayName: "Starter Pack (500 PackPTS/month)",
      type: "SUBSCRIPTION",
    },
    "price_packpts_monthly_2000": {
      internalSku: "PACKPTS_MONTHLY_2000",
      displayName: "Collector Pack (2,000 PackPTS/month)",
      type: "SUBSCRIPTION",
    },
    "price_packpts_monthly_5000": {
      internalSku: "PACKPTS_MONTHLY_5000",
      displayName: "Legend Pack (5,000 PackPTS/month)",
      type: "SUBSCRIPTION",
    },
  };

  // Add dynamic Stripe price IDs from environment variables
  if (STRIPE_PRICE_PACKPTS_500) {
    map[STRIPE_PRICE_PACKPTS_500] = {
      internalSku: "PACKPTS_500",
      displayName: "500 PackPTS",
      type: "CONSUMABLE",
    };
  }
  if (STRIPE_PRICE_PACKPTS_1500) {
    map[STRIPE_PRICE_PACKPTS_1500] = {
      internalSku: "PACKPTS_1500",
      displayName: "1,500 PackPTS",
      type: "CONSUMABLE",
    };
  }
  if (STRIPE_PRICE_PACKPTS_6000) {
    map[STRIPE_PRICE_PACKPTS_6000] = {
      internalSku: "PACKPTS_6000",
      displayName: "6,000 PackPTS",
      type: "CONSUMABLE",
    };
  }
  if (STRIPE_PRICE_PRO_MONTHLY) {
    map[STRIPE_PRICE_PRO_MONTHLY] = {
      internalSku: "PRO_MONTHLY",
      displayName: "Pro Monthly",
      type: "SUBSCRIPTION",
    };
  }
  if (STRIPE_PRICE_LEGEND_MODE) {
    map[STRIPE_PRICE_LEGEND_MODE] = {
      internalSku: "LEGEND_MODE_PASS",
      displayName: "Legend Mode Pass",
      type: "ENTITLEMENT",
    };
  }

  // Monthly PackPTS subscription dynamic mappings
  if (STRIPE_PRICE_PACKPTS_MONTHLY_500) {
    map[STRIPE_PRICE_PACKPTS_MONTHLY_500] = {
      internalSku: "PACKPTS_MONTHLY_500",
      displayName: "Starter Pack (500 PackPTS/month)",
      type: "SUBSCRIPTION",
    };
  }
  if (STRIPE_PRICE_PACKPTS_MONTHLY_2000) {
    map[STRIPE_PRICE_PACKPTS_MONTHLY_2000] = {
      internalSku: "PACKPTS_MONTHLY_2000",
      displayName: "Collector Pack (2,000 PackPTS/month)",
      type: "SUBSCRIPTION",
    };
  }
  if (STRIPE_PRICE_PACKPTS_MONTHLY_5000) {
    map[STRIPE_PRICE_PACKPTS_MONTHLY_5000] = {
      internalSku: "PACKPTS_MONTHLY_5000",
      displayName: "Legend Pack (5,000 PackPTS/month)",
      type: "SUBSCRIPTION",
    };
  }

  return map;
}

// Lazy-initialize the store product map
let _storeProductMap: Record<string, ProductMapping> | null = null;
function getStoreProductMap(): Record<string, ProductMapping> {
  if (!_storeProductMap) {
    _storeProductMap = buildStoreProductMap();
  }
  return _storeProductMap;
}

// Lookup functions
export function getInternalSku(storeProductId: string): string | null {
  return getStoreProductMap()[storeProductId]?.internalSku ?? null;
}

export function getProductMapping(storeProductId: string): ProductMapping | null {
  return getStoreProductMap()[storeProductId] ?? null;
}

export function isValidStoreProduct(storeProductId: string): boolean {
  return storeProductId in getStoreProductMap();
}

// Get all store product IDs for a given internal SKU
export function getStoreProductIds(internalSku: string): string[] {
  return Object.entries(getStoreProductMap())
    .filter(([_, mapping]) => mapping.internalSku === internalSku)
    .map(([storeId]) => storeId);
}

// Internal SKU definitions with PackPTS amounts
// Updated to new guardrail-compliant pricing: ~3,000 pts/$ at 200 microusd per point
export const PRODUCT_DEFINITIONS = {
  PACKPTS_15000: {
    name: "Starter Pack",
    type: "CONSUMABLE" as const,
    packptsGrant: 15000,
    priceUsd: 499, // $4.99
    description: "Starter bundle - great for trying out the game",
  },
  PACKPTS_45000: {
    name: "Value Pack",
    type: "CONSUMABLE" as const,
    packptsGrant: 45000,
    priceUsd: 1499, // $14.99 - Best value
    description: "Most popular - best value for regular players",
  },
  PACKPTS_80000: {
    name: "Premium Pack",
    type: "CONSUMABLE" as const,
    packptsGrant: 80000,
    priceUsd: 2499, // $24.99
    description: "Power pack - for serious collectors",
  },
  PRO_MONTHLY: {
    name: "Pro Monthly",
    type: "SUBSCRIPTION" as const,
    entitlementKey: "pro",
    durationDays: 30,
    priceUsd: 999, // $9.99/month
    description: "Unlock all game modes and 1.5x multiplier",
  },
  LEGEND_MODE_PASS: {
    name: "Legend Mode Pass",
    type: "ENTITLEMENT" as const,
    entitlementKey: "legend_mode",
    priceUsd: 499, // $4.99 one-time
    description: "Permanent access to Legend Mode",
  },
  
  // Monthly PackPTS subscription packages
  PACKPTS_MONTHLY_500: {
    name: "Starter Pack",
    type: "SUBSCRIPTION" as const,
    packptsGrant: 500,
    priceUsd: 499, // $4.99/month
    billingInterval: "month" as const,
    description: "500 PackPTS credited every month - perfect for casual players",
  },
  PACKPTS_MONTHLY_2000: {
    name: "Collector Pack",
    type: "SUBSCRIPTION" as const,
    packptsGrant: 2000,
    priceUsd: 1499, // $14.99/month
    billingInterval: "month" as const,
    description: "2,000 PackPTS credited every month - best value for regular players",
  },
  PACKPTS_MONTHLY_5000: {
    name: "Legend Pack",
    type: "SUBSCRIPTION" as const,
    packptsGrant: 5000,
    priceUsd: 2999, // $29.99/month
    billingInterval: "month" as const,
    description: "5,000 PackPTS credited every month - for serious collectors",
  },
} as const;

// PackPTS bundle SKUs for store page filtering (one-time purchases)
export const PACKPTS_BUNDLE_SKUS = ["PACKPTS_15000", "PACKPTS_45000", "PACKPTS_80000"] as const;
export type PackPtsBundleSku = typeof PACKPTS_BUNDLE_SKUS[number];

// Monthly PackPTS subscription SKUs
export const PACKPTS_MONTHLY_SKUS = ["PACKPTS_MONTHLY_500", "PACKPTS_MONTHLY_2000", "PACKPTS_MONTHLY_5000"] as const;
export type PackPtsMonthlySku = typeof PACKPTS_MONTHLY_SKUS[number];

export type InternalSku = keyof typeof PRODUCT_DEFINITIONS;

// Helper to check if a subscription grants PackPTS (vs entitlements)
export function isPackPtsSubscription(sku: string): boolean {
  return PACKPTS_MONTHLY_SKUS.includes(sku as PackPtsMonthlySku);
}

// Get subscription product info
export function getSubscriptionProducts() {
  return PACKPTS_MONTHLY_SKUS.map(sku => {
    const product = PRODUCT_DEFINITIONS[sku];
    const priceUsd = product.priceUsd / 100;
    return {
      sku,
      name: product.name,
      packptsGrant: product.packptsGrant,
      priceUsd: product.priceUsd,
      description: product.description,
      formattedPrice: `$${priceUsd.toFixed(2)}/month`,
      valuePerDollar: Math.round(product.packptsGrant / priceUsd),
      isBestValue: sku === "PACKPTS_MONTHLY_2000",
    };
  });
}
