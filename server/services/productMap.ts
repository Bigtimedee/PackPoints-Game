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
export const PRODUCT_DEFINITIONS = {
  PACKPTS_500: {
    name: "500 PackPTS",
    type: "CONSUMABLE" as const,
    packptsGrant: 500,
    priceUsd: 499, // $4.99
  },
  PACKPTS_1500: {
    name: "1,500 PackPTS",
    type: "CONSUMABLE" as const,
    packptsGrant: 1500,
    priceUsd: 999, // $9.99
  },
  PACKPTS_6000: {
    name: "6,000 PackPTS",
    type: "CONSUMABLE" as const,
    packptsGrant: 6000,
    priceUsd: 2999, // $29.99
  },
  PRO_MONTHLY: {
    name: "Pro Monthly",
    type: "SUBSCRIPTION" as const,
    entitlementKey: "pro",
    durationDays: 30,
    priceUsd: 999, // $9.99/month
  },
  LEGEND_MODE_PASS: {
    name: "Legend Mode Pass",
    type: "ENTITLEMENT" as const,
    entitlementKey: "legend_mode",
    priceUsd: 499, // $4.99 one-time
  },
} as const;

export type InternalSku = keyof typeof PRODUCT_DEFINITIONS;
