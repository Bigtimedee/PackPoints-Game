import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  DEFAULT_QA_RECEIPT_USERNAME,
  QA_RECEIPT_FIXTURES,
  QA_RECEIPT_LISTING_PREFIX,
  SeedReceiptFixturesError,
  qaReceiptChip,
  receiptFixtureUrl,
  seedReceiptFixturesWithStore,
  type ReceiptFixtureStore,
} from "../services/seedReceiptFixtures";

function createMemoryStore(existingUser?: { id: string; username: string }): {
  store: ReceiptFixtureStore;
  state: {
    intents: Map<string, { id: string; listingId: string; userId: string; status: string }>;
    credits: Map<string, { status: string; creditCents: number; packptsSpent: number }>;
    ledgers: Set<string>;
    rebateBalanceCents: number;
    grantBumps: number;
    walletEnsured: boolean;
  };
} {
  const intents = new Map<string, { id: string; listingId: string; userId: string; status: string }>();
  const credits = new Map<string, { status: string; creditCents: number; packptsSpent: number }>();
  const ledgers = new Set<string>();
  let nextId = 1;
  const state = {
    intents,
    credits,
    ledgers,
    rebateBalanceCents: 0,
    grantBumps: 0,
    walletEnsured: false,
  };

  const store: ReceiptFixtureStore = {
    async findUserByUsername(username) {
      if (!existingUser) return undefined;
      return existingUser.username.toLowerCase() === username.toLowerCase()
        ? { id: existingUser.id }
        : undefined;
    },
    async ensureWallet() {
      state.walletEnsured = true;
    },
    async findIntentId(userId, listingId) {
      const row = [...intents.values()].find(
        (intent) => intent.userId === userId && intent.listingId === listingId,
      );
      return row?.id ?? null;
    },
    async insertIntent(row) {
      const id = `intent-${nextId++}`;
      intents.set(id, {
        id,
        listingId: String(row.listingId),
        userId: String(row.userId),
        status: String(row.status),
      });
      return { id };
    },
    async updateIntent(id, row) {
      const existing = intents.get(id);
      if (!existing) throw new Error(`missing intent ${id}`);
      intents.set(id, {
        ...existing,
        status: String(row.status ?? existing.status),
        listingId: String(row.listingId ?? existing.listingId),
      });
    },
    async upsertCredit(row) {
      credits.set(row.purchaseIntentId, {
        status: row.status,
        creditCents: row.creditCents,
        packptsSpent: row.packptsSpent,
      });
    },
    async grantLedgerExists(idempotencyKey) {
      return ledgers.has(idempotencyKey);
    },
    async insertGrantAndBump(input) {
      if (ledgers.has(input.idempotencyKey)) return;
      ledgers.add(input.idempotencyKey);
      state.rebateBalanceCents += input.amountCents;
      state.grantBumps += 1;
    },
  };

  return { store, state };
}

describe("QA receipt fixture specs", () => {
  it("uses the qa-receipt- listing prefix and mixes ebay + goldin", () => {
    expect(QA_RECEIPT_FIXTURES.length).toBeGreaterThanOrEqual(4);
    expect(QA_RECEIPT_FIXTURES.every((spec) => spec.listingId.startsWith(QA_RECEIPT_LISTING_PREFIX))).toBe(true);
    const sources = new Set(QA_RECEIPT_FIXTURES.map((spec) => spec.source));
    expect(sources.has("ebay")).toBe(true);
    expect(sources.has("goldin")).toBe(true);
  });

  it("covers CREDIT_GRANTED, PURCHASE_CONFIRMED, CREATED→PENDING, APPROVED, DENIED", () => {
    const byStatus = Object.fromEntries(QA_RECEIPT_FIXTURES.map((spec) => [spec.status, spec]));
    expect(byStatus.CREDIT_GRANTED.creditCents).toBe(1250);
    expect(byStatus.CREDIT_GRANTED.packptsSpent).toBe(2500);
    expect(byStatus.CREDIT_GRANTED.grantMethod).toBe("USER_CONFIRM");
    expect(byStatus.CREDIT_GRANTED.grantRebate).toBe(true);

    expect(byStatus.PURCHASE_CONFIRMED.creditCents).toBeGreaterThanOrEqual(2500);
    expect(byStatus.PURCHASE_CONFIRMED.creditStatus).toBe("PENDING");
    expect(byStatus.PURCHASE_CONFIRMED.evidenceOrderId).toBeTruthy();

    expect(qaReceiptChip("CREATED")).toBe("PENDING");
    expect(qaReceiptChip(byStatus.CREATED.status)).toBe("PENDING");
    expect(qaReceiptChip("APPROVED")).toBe("APPROVED");
    expect(qaReceiptChip("DENIED")).toBe("DENIED");
    expect(byStatus.DENIED.deniedReason).toMatch(/QA fixture/i);
  });

  it("builds /redemptions/:id URLs", () => {
    expect(receiptFixtureUrl("abc-123")).toBe("/redemptions/abc-123");
  });
});

describe("seedReceiptFixturesWithStore", () => {
  it("fails clearly when the username is missing", async () => {
    const { store } = createMemoryStore();
    await expect(seedReceiptFixturesWithStore(store, { username: "designqa" })).rejects.toMatchObject({
      name: "SeedReceiptFixturesError",
      statusCode: 404,
      message: expect.stringContaining("designqa"),
    } as Partial<SeedReceiptFixturesError>);
  });

  it("upserts fixtures and grants rebate only once", async () => {
    const { store, state } = createMemoryStore({ id: "user-designqa", username: "designqa" });
    const first = await seedReceiptFixturesWithStore(store, { username: DEFAULT_QA_RECEIPT_USERNAME });

    expect(first.userId).toBe("user-designqa");
    expect(state.walletEnsured).toBe(true);
    expect(first.intents).toHaveLength(QA_RECEIPT_FIXTURES.length);
    expect(first.intents.map((intent) => intent.status)).toEqual(
      QA_RECEIPT_FIXTURES.map((spec) => spec.status),
    );
    expect(first.intents.every((intent) => intent.url === `/redemptions/${intent.id}`)).toBe(true);

    const granted = first.intents.find((intent) => intent.status === "CREDIT_GRANTED");
    expect(granted).toBeTruthy();
    expect(state.credits.get(granted!.id)?.creditCents).toBe(1250);
    expect(state.credits.get(granted!.id)?.status).toBe("GRANTED");
    expect(state.rebateBalanceCents).toBe(1250);
    expect(state.grantBumps).toBe(1);

    const confirmed = first.intents.find((intent) => intent.status === "PURCHASE_CONFIRMED");
    expect(state.credits.get(confirmed!.id)?.status).toBe("PENDING");
    expect(state.credits.get(confirmed!.id)?.creditCents).toBe(4500);

    const pending = first.intents.find((intent) => intent.status === "CREATED");
    expect(state.credits.has(pending!.id)).toBe(false);

    const second = await seedReceiptFixturesWithStore(store);
    expect(second.intents.map((intent) => intent.id)).toEqual(first.intents.map((intent) => intent.id));
    expect(state.rebateBalanceCents).toBe(1250);
    expect(state.grantBumps).toBe(1);
  });
});

describe("POST /api/admin/qa/seed-receipt-fixtures", () => {
  it("is registered behind isAuthenticated + requireAdmin", () => {
    const routesPath = join(dirname(fileURLToPath(import.meta.url)), "../routes/admin.routes.ts");
    const src = readFileSync(routesPath, "utf8");
    const marker = 'app.post("/api/admin/qa/seed-receipt-fixtures"';
    const start = src.indexOf(marker);
    expect(start).toBeGreaterThan(-1);
    const handler = src.slice(start, start + 900);
    expect(handler).toContain("isAuthenticated, requireAdmin");
    expect(handler).toContain("seedReceiptFixtures");
    expect(handler).toContain("SeedReceiptFixturesError");
  });
});
