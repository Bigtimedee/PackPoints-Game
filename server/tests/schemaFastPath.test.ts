import { afterEach, describe, expect, it, vi } from "vitest";
import { runSchemaGate } from "../startup/schemaBoot";
import {
  SCHEMA_PROBE_SQL,
  compareSchema,
  compatibleLiveColumn,
  expectedSchemaFromDrizzle,
  verifyLiveSchema,
  type ExpectedSchema,
  type LiveSchema,
  type SchemaVerifyResult,
} from "../startup/schemaProbe";

function liveFrom(expected: ExpectedSchema): LiveSchema {
  return {
    columns: expected.tables.flatMap((table) =>
      table.columns.map((column) => compatibleLiveColumn(table.name, column.name, column.sqlType))
    ),
    indexes: expected.tables.flatMap((table) =>
      table.uniques.map((unique) => ({
        table: table.name,
        name: unique.name,
        unique: true,
        primary: unique.primary,
        columns: unique.columns,
      }))
    ),
  };
}

const fixture: ExpectedSchema = {
  tables: [
    {
      name: "users",
      columns: [
        { name: "id", sqlType: "varchar" },
        { name: "email", sqlType: "text" },
      ],
      uniques: [
        { name: "users_pkey", columns: ["id"], primary: true },
        { name: "users_email_unique", columns: ["email"], primary: false },
      ],
    },
    {
      name: "sessions",
      columns: [{ name: "sid", sqlType: "varchar" }],
      uniques: [{ name: "sessions_pkey", columns: ["sid"], primary: true }],
    },
  ],
};

async function boot(verify: () => Promise<SchemaVerifyResult>, storedHash: string | null = "same") {
  const order: string[] = [];
  const result = await runSchemaGate({
    currentHash: "same",
    storedHash,
    verify,
    push: (mode) => {
      if (mode === "foreground") {
        order.push("push");
        return Promise.resolve({ pushed: true });
      }
      return new Promise((resolve) => {
        setTimeout(() => {
          order.push("push");
          resolve({ pushed: true });
        }, 30);
      });
    },
  });
  order.push("routes");
  return { order, result };
}

describe("fast schema gate", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("waits when a table or column is missing and opens early when the schema matches", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const matched = liveFrom(fixture);
    expect(compareSchema(fixture, matched).ok).toBe(true);
    const missingTable = compareSchema(fixture, {
      columns: matched.columns.filter((column) => column.table !== "sessions"),
      indexes: matched.indexes.filter((index) => index.table !== "sessions"),
    });
    const missingColumn = compareSchema(fixture, {
      ...matched,
      columns: matched.columns.filter((column) => !(column.table === "users" && column.column === "email")),
    });
    expect(missingTable.ok).toBe(false);
    expect(missingTable.reason).toContain("missing_table:sessions");
    expect(missingColumn.ok).toBe(false);
    expect(missingColumn.reason).toContain("missing_column:users.email");

    const waitedTable = await boot(async () => missingTable);
    expect(waitedTable.result.mode).toBe("fast_schema_fallback");
    expect(waitedTable.order).toEqual(["push", "routes"]);

    const waitedColumn = await boot(async () => missingColumn);
    expect(waitedColumn.result.mode).toBe("fast_schema_fallback");
    expect(waitedColumn.order).toEqual(["push", "routes"]);

    const early = await boot(async () => compareSchema(fixture, matched));
    expect(early.result.mode).toBe("fast_schema_ok");
    expect(early.order).toEqual(["routes"]);
    await early.result.background;
    expect(early.order).toEqual(["routes", "push"]);

    const logged = vi.mocked(console.log).mock.calls.map((args) => String(args[0])).join("\n");
    expect(logged).toContain("phase=fast_schema_ok");
    expect(logged).toContain("phase=fast_schema_fallback");
    expect(SCHEMA_PROBE_SQL).toContain("information_schema.columns");
  });

  it("falls back without probing when the schema hash differs", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    let probed = false;
    const result = await boot(async () => {
      probed = true;
      return { ok: true, reason: "" };
    }, "older");
    expect(probed).toBe(false);
    expect(result.result.mode).toBe("fast_schema_fallback");
    expect(result.order).toEqual(["push", "routes"]);
    const logged = vi.mocked(console.log).mock.calls.map((args) => String(args[0])).join("\n");
    expect(logged).toContain("reason=hash_mismatch");
  });

  it("treats the drizzle schema as matching only when every table and column is present", async () => {
    const expected = expectedSchemaFromDrizzle();
    expect(expected.tables.some((table) => table.name === "sessions")).toBe(true);
    expect(expected.tables.find((table) => table.name === "users")?.columns.some((column) => column.name === "email")).toBe(true);
    const live = liveFrom(expected);
    expect(compareSchema(expected, live).ok).toBe(true);
    const missingTable = compareSchema(expected, {
      columns: live.columns.filter((column) => column.table !== "sessions"),
      indexes: live.indexes.filter((index) => index.table !== "sessions"),
    });
    const missingColumn = compareSchema(expected, {
      columns: live.columns.filter((column) => !(column.table === "users" && column.column === "email")),
      indexes: live.indexes,
    });
    expect(missingTable.reason).toContain("missing_table:sessions");
    expect(missingColumn.reason).toContain("missing_column:users.email");
  });

  it("accepts the live database when it already matches shared/schema.ts", async () => {
    const result = await verifyLiveSchema();
    expect(result.ok, result.reason).toBe(true);
  });
});
