/**
 * PackPTS receipt contract — Design lock 2026-09-20.
 * Hero chip = external_purchase_intent.status. Never invent UNDER_REVIEW.
 */

export const RECEIPT_COLORS = {
  canvas: "#0b0f16",
  ink: "#F0F2F5",
  muted: "#8F96A3",
  gold: "#F5C518",
  green: "#22C55E",
  blue: "#2B6CEE",
  deny: "#EF4444",
  surface: "#161B24",
} as const;

export const RECEIPT_COPY = {
  eyebrow: "PACKPTS RECEIPT",
  postPurchaseRebate: "Post-purchase rebate",
  partnerCheckoutUnchanged: "Partner checkout unchanged",
  partnerPrice: "Partner price",
  packptsReceipt: "PackPTS receipt",
  usdGranted: "USD credit granted to PackPTS wallet",
  creditPendingReview: "Credit pending review",
  confirmToUnlock: "Confirm purchase to unlock rebate",
  awaitingPurchase: "Awaiting partner purchase",
  packptsReserved: "PackPTS reserved",
} as const;

export const RECEIPT_BANNED_PHRASES = [
  "UNDER_REVIEW",
  "PackPoints",
  "Pack Points",
  "Discount at checkout",
  "discount at checkout",
  "eBay gift card",
  "Goldin gift card",
  "eBay Gift Card",
  "Goldin Gift Card",
  "Price reduced",
  "price reduced",
  "discounted price",
  "you paid less at checkout",
  "limited rebate spots",
] as const;

export type ReceiptIntentStatus =
  | "CREATED"
  | "APPROVED"
  | "DENIED"
  | "PURCHASE_CONFIRMED"
  | "CREDIT_GRANTED"
  | "CANCELED";

/** Statuses shown on GET /api/marketplace/redemption/receipts (`/redemptions` list). CREATED → PENDING chip. */
export const RECEIPT_LIST_STATUSES: readonly ReceiptIntentStatus[] = [
  "CREATED",
  "APPROVED",
  "PURCHASE_CONFIRMED",
  "CREDIT_GRANTED",
  "CANCELED",
  "DENIED",
];

export type ReceiptChipLabel =
  | "PENDING"
  | "APPROVED"
  | "PURCHASE_CONFIRMED"
  | "CREDIT_GRANTED"
  | "DENIED"
  | "CANCELED";

export type ReceiptGrantMethod = "EPN_POSTBACK" | "USER_CONFIRM" | "ADMIN_GRANT";

export interface ReceiptChip {
  label: ReceiptChipLabel;
  color: string;
  helper: string;
}

export const GRANT_METHOD_LABELS: Record<ReceiptGrantMethod, string> = {
  EPN_POSTBACK: "Affiliate confirm",
  USER_CONFIRM: "You confirmed",
  ADMIN_GRANT: "PackPTS review",
};

export function partnerLabel(source: string): string {
  return source === "goldin" ? "Goldin" : "eBay";
}

export function formatUsdCents(cents: number): string {
  const value = (Number(cents) || 0) / 100;
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function formatWalletHeader(rebateBalanceCents: number): string {
  return `Wallet ${formatUsdCents(rebateBalanceCents)}`;
}

export function formatHeroAmount(creditCents: number, status: string): string {
  const usd = formatUsdCents(creditCents);
  return status === "CREDIT_GRANTED" ? `+${usd}` : usd;
}

export function formatPackptsSpent(packpts: number): string {
  return `${(Number(packpts) || 0).toLocaleString("en-US")} PackPTS`;
}

export function truncateIntentId(intentId: string): string {
  return intentId.replace(/-/g, "").slice(0, 8);
}

export function formatReceiptDate(value: string | Date | null | undefined): string {
  if (!value) return "";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export function grantMethodLabel(method: string | null | undefined): string {
  if (!method) return "";
  if (method in GRANT_METHOD_LABELS) {
    return GRANT_METHOD_LABELS[method as ReceiptGrantMethod];
  }
  return "";
}

export function receiptChip(status: string): ReceiptChip {
  switch (status) {
    case "APPROVED":
      return {
        label: "APPROVED",
        color: RECEIPT_COLORS.blue,
        helper: RECEIPT_COPY.confirmToUnlock,
      };
    case "PURCHASE_CONFIRMED":
      return {
        label: "PURCHASE_CONFIRMED",
        color: RECEIPT_COLORS.gold,
        helper: RECEIPT_COPY.creditPendingReview,
      };
    case "CREDIT_GRANTED":
      return {
        label: "CREDIT_GRANTED",
        color: RECEIPT_COLORS.green,
        helper: RECEIPT_COPY.usdGranted,
      };
    case "DENIED":
      return {
        label: "DENIED",
        color: RECEIPT_COLORS.deny,
        helper: "",
      };
    case "CANCELED":
      return {
        label: "CANCELED",
        color: RECEIPT_COLORS.muted,
        helper: "",
      };
    default:
      return {
        label: "PENDING",
        color: RECEIPT_COLORS.muted,
        helper: RECEIPT_COPY.awaitingPurchase,
      };
  }
}

export function containsBannedReceiptCopy(text: string): string[] {
  return RECEIPT_BANNED_PHRASES.filter((phrase) => text.includes(phrase));
}

export interface ReceiptPlaqueInput {
  intentId: string;
  source: "ebay" | "goldin" | string;
  listingId: string;
  listingTitle: string | null;
  listingUrl: string;
  priceCents: number;
  packptsSpent: number;
  creditCents: number;
  status: string;
  grantMethod: string | null;
  grantedAt: string | Date | null;
  createdAt: string | Date | null;
  evidenceOrderId: string | null;
  evidenceNote: string | null;
  evidenceReceiptUrl: string | null;
  deniedReason: string | null;
  rebateBalanceCents: number;
}

export interface ReceiptPlaqueView {
  intentId: string;
  source: string;
  partner: string;
  listingId: string;
  listingTitle: string;
  listingUrl: string;
  priceCents: number;
  partnerPrice: string;
  packptsSpent: number;
  packptsSpentLabel: string;
  creditCents: number;
  heroAmount: string;
  status: string;
  grantMethod: string | null;
  grantMethodLabel: string;
  grantedAt: string | null;
  grantedAtLabel: string;
  createdAt: string | null;
  createdAtLabel: string;
  rebateBalanceCents: number;
  walletHeader: string;
  chip: ReceiptChip;
  subline: string;
  helper: string;
  evidenceLabel: string;
  deniedReason: string | null;
  footerCta: string;
}

function isoOrNull(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

export function buildReceiptPlaqueView(input: ReceiptPlaqueInput): ReceiptPlaqueView {
  const chip = receiptChip(input.status);
  const granted = input.status === "CREDIT_GRANTED";
  const helper = input.status === "DENIED" && input.deniedReason
    ? input.deniedReason
    : chip.helper;

  const sublineParts: string[] = [RECEIPT_COPY.postPurchaseRebate];
  if (input.status === "APPROVED" || input.status === "PURCHASE_CONFIRMED" || chip.label === "PENDING") {
    sublineParts.push(RECEIPT_COPY.partnerCheckoutUnchanged);
  }

  const evidenceBits: string[] = [];
  if (input.evidenceOrderId) evidenceBits.push(`Order ${input.evidenceOrderId}`);
  else if (input.evidenceNote) evidenceBits.push(input.evidenceNote);
  if (input.evidenceOrderId || input.evidenceNote || input.evidenceReceiptUrl) {
    if (input.status !== "CREDIT_GRANTED") evidenceBits.push("user attested");
  }

  return {
    intentId: input.intentId,
    source: input.source,
    partner: partnerLabel(input.source),
    listingId: input.listingId,
    listingTitle: input.listingTitle?.trim() || `${partnerLabel(input.source)} listing ${input.listingId}`,
    listingUrl: input.listingUrl,
    priceCents: input.priceCents,
    partnerPrice: formatUsdCents(input.priceCents),
    packptsSpent: input.packptsSpent,
    packptsSpentLabel: formatPackptsSpent(input.packptsSpent),
    creditCents: input.creditCents,
    heroAmount: formatHeroAmount(input.creditCents, input.status),
    status: input.status,
    grantMethod: granted ? input.grantMethod : null,
    grantMethodLabel: granted ? grantMethodLabel(input.grantMethod) : "",
    grantedAt: granted ? isoOrNull(input.grantedAt) : null,
    grantedAtLabel: granted ? formatReceiptDate(input.grantedAt) : "",
    createdAt: isoOrNull(input.createdAt),
    createdAtLabel: formatReceiptDate(input.createdAt),
    rebateBalanceCents: input.rebateBalanceCents,
    walletHeader: formatWalletHeader(input.rebateBalanceCents),
    chip,
    subline: sublineParts.join(" · "),
    helper,
    evidenceLabel: evidenceBits.join(" · "),
    deniedReason: input.deniedReason,
    footerCta: `packpts.com/redemptions/${input.intentId}`,
  };
}
