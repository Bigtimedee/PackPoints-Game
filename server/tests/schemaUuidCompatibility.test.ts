import { describe, expect, it } from "vitest";
import { columnTypeCompatible, compatibleLiveColumn, compareSchema, type LiveColumn } from "../startup/schemaProbe";

const uuidColumn: LiveColumn = {
  table: "admin_card_scan_jobs", column: "id", dataType: "uuid", udtName: "uuid",
  charMax: null, numericPrecision: null, numericScale: null,
};

describe("PostgreSQL built-in UUID schema compatibility", () => {
  it("accepts information_schema's built-in UUID representation", () => {
    expect(columnTypeCompatible("uuid", uuidColumn)).toBe(true);
    expect(columnTypeCompatible(" UUID ", { ...uuidColumn, dataType: "UUID", udtName: "UUID" })).toBe(true);
  });
  it("models UUID accurately in synthetic schema fixtures", () => {
    expect(compatibleLiveColumn(uuidColumn.table, uuidColumn.column, "uuid")).toEqual(uuidColumn);
  });
  it.each([
    { dataType: "text", udtName: "text" },
    { dataType: "character varying", udtName: "varchar" },
    { dataType: "USER-DEFINED", udtName: "uuid" },
    { dataType: "uuid", udtName: "text" },
  ])("does not loosen UUID matching for %j", (differentType) => {
    expect(columnTypeCompatible("uuid", { ...uuidColumn, ...differentType })).toBe(false);
  });
  it("preserves mismatch detection and custom enum matching", () => {
    const expected = { tables: [{ name: uuidColumn.table, columns: [{ name: "id", sqlType: "uuid" }], uniques: [] }] };
    expect(compareSchema(expected, { columns: [uuidColumn], indexes: [] }).ok).toBe(true);
    expect(compareSchema(expected, { columns: [{ ...uuidColumn, dataType: "text", udtName: "text" }], indexes: [] }).reason).toContain("type_mismatch");
    expect(columnTypeCompatible("scan_state", { ...uuidColumn, dataType: "USER-DEFINED", udtName: "scan_state" })).toBe(true);
  });
});
