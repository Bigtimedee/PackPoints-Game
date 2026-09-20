/**
 * Ops/QA seeder for Design receipt re-QA.
 * Upserts live external_purchase_intent rows (listingId prefix qa-receipt-)
 * so /redemptions/:id can be checked for CREDIT_GRANTED, PURCHASE_CONFIRMED,
 * PENDING (CREATED → PENDING chip), APPROVED, and DENIED.
 *
 * Does not invent Design UI.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import {
  externalPurchaseIntent,
  rebateLedger,
  redemptionCredit,
  users,
  wallets,
} from "@shared/schema";
import { receiptChip, type ReceiptChipLabel } from "@shared/receiptContract";

export const DEFAULT_QA_RECEIPT_USERNAME = "designqa";
export const QA_RECEIPT_LISTING_PREFIX = "qa-receipt-";

export type QaReceiptIntentStatus =
  | "CREATED"
  | "APPROVED"
  | "DENIED"
  | "PURCHASE_CONFIRMED"
  | "CREDIT_GRANTED";

export interface QaReceiptFixtureSpec {
  key: string;
  listingId: string;
  status: QaReceiptIntentStatus;
  source: "ebay" | "goldin";
  listingTitle: string;
  listingUrl: string;
  priceCents: number;
  packptsSpent: number;
  creditCents: number;
  creditStatus: "PENDING" | "GRANTED" | null;
  grantMethod: "USER_CONFIRM" | null;
  evidenceOrderId: string | null;
  deniedReason: string | null;
  grantRebate: boolean;
}

export interface SeededReceiptIntent {
  id: string;
  status: QaReceiptIntentStatus;
  url: string;
}

export interface SeedReceiptFixturesResult {
  userId: string;
  intents: SeededReceiptIntent[];
}

export class SeedReceiptFixturesError extends Error {
  constructor(
    message: string,
    readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = "SeedReceiptFixturesError";
  }
}

export const QA_RECEIPT_FIXTURES: QaReceiptFixtureSpec[] = [
  {
    key: "granted",
    listingId: `${QA_RECEIPT_LISTING_PREFIX}granted`,
    status: "CREDIT_GRANTED",
    source: "goldin",
    listingTitle: "1987 Topps Barry Bonds Rookie PSA 8",
    listingUrl: "https://goldin.co/item/qa-receipt-granted",
    priceCents: 12_500,
    packptsSpent: 2500,
    creditCents: 1250,
    creditStatus: "GRANTED",
    grantMethod: "USER_CONFIRM",
    evidenceOrderId: "GLD-QA-88421",
    deniedReason: null,
    grantRebate: true,
  },
  {
    key: "confirmed",
    listingId: `${QA_RECEIPT_LISTING_PREFIX}confirmed`,
    status: "PURCHASE_CONFIRMED",
    source: "ebay",
    listingTitle: "1952 Topps Mickey Mantle PSA 4",
    listingUrl: "https://www.ebay.com/itm/qa-receipt-confirmed",
    priceCents: 35_000,
    packptsSpent: 9000,
    creditCents: 4500,
    creditStatus: "PENDING",
    grantMethod: null,
    evidenceOrderId: "EBAY-QA-25HOLD",
    deniedReason: null,
    grantRebate: false,
  },
  {
    key: "pending",
    listingId: `${QA_RECEIPT_LISTING_PREFIX}pending`,
    status: "CREATED",
    source: "ebay",
    listingTitle: "1986 Fleer Michael Jordan RC",
    listingUrl: "https://www.ebay.com/itm/qa-receipt-pending",
    priceCents: 8_500,
    packptsSpent: 0,
    creditCents: 0,
    creditStatus: null,
    grantMethod: null,
    evidenceOrderId: null,
    deniedReason: null,
    grantRebate: false,
  },
  {
    key: "approved",
    listingId: `${QA_RECEIPT_LISTING_PREFIX}approved`,
    status: "APPROVED",
    source: "goldin",
    listingTitle: "2003 Upper Deck LeBron James RC",
    listingUrl: "https://goldin.co/item/qa-receipt-approved",
    priceCents: 18_000,
    packptsSpent: 3600,
    creditCents: 1800,
    creditStatus: "PENDING",
    grantMethod: null,
    evidenceOrderId: null,
    deniedReason: null,
    grantRebate: false,
  },
  {
    key: "denied",
    listingId: `${QA_RECEIPT_LISTING_PREFIX}denied`,
    status: "DENIED",
    source: "ebay",
    listingTitle: "1989 Upper Deck Ken Griffey Jr. RC",
    listingUrl: "https://www.ebay.com/itm/qa-receipt-denied",
    priceCents: 9_500,
    packptsSpent: 1600,
    creditCents: 800,
    creditStatus: "PENDING",
    grantMethod: null,
    evidenceOrderId: "EBAY-QA-DENIED",
    deniedReason: "QA fixture: evidence did not match listing",
    grantRebate: false,
  },
];

export function qaReceiptChip(status: string): ReceiptChipLabel {
  return receiptChip(status).label;
}

export function receiptFixtureUrl(intentId: string): string {
  return `/redemptions/${intentId}`;
}

export interface ReceiptFixtureStore {
  findUserByUsername(username: string): Promise<{ id: string } | undefined>;
  ensureWallet(userId: string): Promise<void>;
  findIntentId(userId: string, listingId: string): Promise<string | null>;
  insertIntent(row: Record<string, unknown>): Promise<{ id: string }>;
  updateIntent(id: string, row: Record<string, unknown>): Promise<void>;
  upsertCredit(row: {
    purchaseIntentId: string;
    userId: string;
    packptsSpent: number;
    creditCents: number;
    status: "PENDING" | "GRANTED";
    grantMethod: string | null;
    grantedAt: Date | null;
    rebateLedgerId: string | null;
  }): Promise<void>;
  grantLedgerExists(idempotencyKey: string): Promise<boolean>;
  insertGrantAndBump(input: {
    userId: string;
    intentId: string;
    amountCents: number;
    idempotencyKey: string;
    note: string;
  }): Promise<void>;
}

function listingUrlFor(spec: QaReceiptFixtureSpec): string {
  return spec.listingUrl;
}

function intentValues(
  userId: string,
  spec: QaReceiptFixtureSpec,
  now: Date,
): Record<string, unknown> {
  const granted = spec.status === "CREDIT_GRANTED";
  return {
    userId,
    source: spec.source,
    listingId: spec.listingId,
    listingUrl: listingUrlFor(spec),
    listingTitle: spec.listingTitle,
    priceCents: spec.priceCents,
    currency: "usd",
    computedRmax: spec.packptsSpent,
    requestedRedeemPackpts: spec.packptsSpent,
    approvedRedeemPackpts: spec.packptsSpent,
    status: spec.status,
    grantMethod: spec.grantMethod,
    grantedAt: granted ? now : null,
    evidenceOrderId: spec.evidenceOrderId,
    evidenceNote: spec.evidenceOrderId ? "QA receipt fixture" : null,
    evidenceReceiptUrl: null,
    evidenceSubmittedAt: spec.evidenceOrderId ? now : null,
    deniedReason: spec.deniedReason,
    createdAt: now,
    updatedAt: now,
  };
}

export async function seedReceiptFixturesWithStore(
  store: ReceiptFixtureStore,
  opts: { username?: string; now?: Date } = {},
): Promise<SeedReceiptFixturesResult> {
  const username = (opts.username ?? DEFAULT_QA_RECEIPT_USERNAME).trim();
  if (!username) {
    throw new SeedReceiptFixturesError("username is required");
  }

  const user = await store.findUserByUsername(username);
  if (!user) {
    throw new SeedReceiptFixturesError(
      `User '${username}' not found. Create the account before seeding receipt fixtures.`,
      404,
    );
  }

  await store.ensureWallet(user.id);
  const now = opts.now ?? new Date();
  const intents: SeededReceiptIntent[] = [];

  for (const spec of QA_RECEIPT_FIXTURES) {
    const values = intentValues(user.id, spec, now);
    let intentId = await store.findIntentId(user.id, spec.listingId);
    if (intentId) {
      await store.updateIntent(intentId, values);
    } else {
      const inserted = await store.insertIntent(values);
      intentId = inserted.id;
    }

    if (spec.creditStatus) {
      await store.upsertCredit({
        purchaseIntentId: intentId,
        userId: user.id,
        packptsSpent: spec.packptsSpent,
        creditCents: spec.creditCents,
        status: spec.creditStatus,
        grantMethod: spec.grantMethod,
        grantedAt: spec.status === "CREDIT_GRANTED" ? now : null,
        rebateLedgerId: null,
      });
    }

    if (spec.grantRebate) {
      const idempotencyKey = `rebate-grant:${intentId}`;
      const already = await store.grantLedgerExists(idempotencyKey);
      if (!already) {
        await store.insertGrantAndBump({
          userId: user.id,
          intentId,
          amountCents: spec.creditCents,
          idempotencyKey,
          note: `QA receipt fixture GRANT (${spec.grantMethod ?? "USER_CONFIRM"}) ${spec.source} ${spec.listingId}`,
        });
      }
    }

    intents.push({
      id: intentId,
      status: spec.status,
      url: receiptFixtureUrl(intentId),
    });
  }

  return { userId: user.id, intents };
}

export function createDrizzleReceiptFixtureStore(
  database: typeof db = db,
): ReceiptFixtureStore {
  return {
    async findUserByUsername(username) {
      const [user] = await database
        .select({ id: users.id })
        .from(users)
        .where(sql`LOWER(${users.username}) = LOWER(${username})`)
        .limit(1);
      return user;
    },

    async ensureWallet(userId) {
      await database
        .insert(wallets)
        .values({
          userId,
          balance: 0,
          lifetimeEarned: 0,
          lifetimeSpent: 0,
          rebateBalanceCents: 0,
          status: "active",
        })
        .onConflictDoNothing();
    },

    async findIntentId(userId, listingId) {
      const [row] = await database
        .select({ id: externalPurchaseIntent.id })
        .from(externalPurchaseIntent)
        .where(
          and(
            eq(externalPurchaseIntent.userId, userId),
            eq(externalPurchaseIntent.listingId, listingId),
          ),
        )
        .limit(1);
      return row?.id ?? null;
    },

    async insertIntent(row) {
      const [inserted] = await database
        .insert(externalPurchaseIntent)
        .values(row as typeof externalPurchaseIntent.$inferInsert)
        .returning({ id: externalPurchaseIntent.id });
      if (!inserted) throw new Error("Failed to insert purchase intent");
      return inserted;
    },

    async updateIntent(id, row) {
      const { userId: _userId, listingId: _listingId, ...patch } = row as Record<string, unknown>;
      await database
        .update(externalPurchaseIntent)
        .set(patch)
        .where(eq(externalPurchaseIntent.id, id));
    },

    async upsertCredit(row) {
      const [existing] = await database
        .select({ id: redemptionCredit.id, rebateLedgerId: redemptionCredit.rebateLedgerId })
        .from(redemptionCredit)
        .where(eq(redemptionCredit.purchaseIntentId, row.purchaseIntentId))
        .limit(1);

      if (existing) {
        await database
          .update(redemptionCredit)
          .set({
            packptsSpent: row.packptsSpent,
            creditCents: row.creditCents,
            status: row.status,
            grantMethod: row.grantMethod,
            grantedAt: row.grantedAt,
          })
          .where(eq(redemptionCredit.id, existing.id));
        return;
      }

      await database.insert(redemptionCredit).values({
        purchaseIntentId: row.purchaseIntentId,
        userId: row.userId,
        packptsSpent: row.packptsSpent,
        creditCents: row.creditCents,
        status: row.status,
        grantMethod: row.grantMethod,
        grantedAt: row.grantedAt,
        rebateLedgerId: row.rebateLedgerId,
      });
    },

    async grantLedgerExists(idempotencyKey) {
      const [row] = await database
        .select({ id: rebateLedger.id })
        .from(rebateLedger)
        .where(eq(rebateLedger.idempotencyKey, idempotencyKey))
        .limit(1);
      return Boolean(row);
    },

    async insertGrantAndBump(input) {
      await database.transaction(async (tx) => {
        const [wallet] = await tx
          .select()
          .from(wallets)
          .where(eq(wallets.userId, input.userId))
          .for("update");
        if (!wallet) throw new Error("Wallet not found");

        const newBalance = (wallet.rebateBalanceCents ?? 0) + input.amountCents;
        const [ledger] = await tx
          .insert(rebateLedger)
          .values({
            userId: input.userId,
            amountCents: input.amountCents,
            balanceAfterCents: newBalance,
            type: "GRANT",
            purchaseIntentId: input.intentId,
            idempotencyKey: input.idempotencyKey,
            note: input.note,
          })
          .onConflictDoNothing()
          .returning({ id: rebateLedger.id });

        if (!ledger) return;

        await tx
          .update(wallets)
          .set({ rebateBalanceCents: newBalance, updatedAt: new Date() })
          .where(eq(wallets.id, wallet.id));

        await tx
          .update(redemptionCredit)
          .set({ rebateLedgerId: ledger.id })
          .where(eq(redemptionCredit.purchaseIntentId, input.intentId));
      });
    },
  };
}

export async function seedReceiptFixtures(
  opts: { username?: string; now?: Date } = {},
): Promise<SeedReceiptFixturesResult> {
  return seedReceiptFixturesWithStore(createDrizzleReceiptFixtureStore(), opts);
}
