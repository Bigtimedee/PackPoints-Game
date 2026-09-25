import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as schema from "@shared/schema";

/**
 * One round trip: every public column from information_schema, plus unique
 * indexes and primary keys from pg_catalog (unique indexes are not constraints,
 * so information_schema.table_constraints does not list them).
 */
export const SCHEMA_PROBE_SQL = `
SELECT json_build_object(
  'columns', COALESCE((
    SELECT json_agg(json_build_object(
      'table', c.table_name,
      'column', c.column_name,
      'dataType', c.data_type,
      'udtName', c.udt_name,
      'charMax', c.character_maximum_length,
      'numericPrecision', c.numeric_precision,
      'numericScale', c.numeric_scale
    ))
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
  ), '[]'::json),
  'indexes', COALESCE((
    SELECT json_agg(json_build_object(
      'table', t.relname,
      'name', i.relname,
      'unique', ix.indisunique,
      'primary', ix.indisprimary,
      'columns', (
        SELECT COALESCE(json_agg(a.attname ORDER BY k.ord), '[]'::json)
        FROM unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord)
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum AND k.attnum > 0
      )
    ))
    FROM pg_index ix
    JOIN pg_class t ON t.oid = ix.indrelid
    JOIN pg_class i ON i.oid = ix.indexrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND ix.indisunique
  ), '[]'::json)
) AS probe
`;

export interface LiveColumn {
  table: string;
  column: string;
  dataType: string;
  udtName: string;
  charMax: number | null;
  numericPrecision: number | null;
  numericScale: number | null;
}

export interface LiveIndex {
  table: string;
  name: string;
  unique: boolean;
  primary: boolean;
  columns: string[];
}

export interface LiveSchema {
  columns: LiveColumn[];
  indexes: LiveIndex[];
}

export interface ExpectedColumn {
  name: string;
  sqlType: string;
}

export interface ExpectedUnique {
  name: string;
  columns: string[];
  primary: boolean;
}

export interface ExpectedTable {
  name: string;
  columns: ExpectedColumn[];
  uniques: ExpectedUnique[];
}

export interface ExpectedSchema {
  tables: ExpectedTable[];
}

export interface SchemaVerifyResult {
  ok: boolean;
  reason: string;
}

const ISSUE_LIMIT = 8;

function columnNames(columns: ExpectedUnique["columns"]): string[] {
  return columns.filter((name) => name.length > 0);
}

/** Tables, columns, unique indexes, and primary keys declared in shared/schema.ts. */
export function expectedSchemaFromDrizzle(): ExpectedSchema {
  const tables: ExpectedTable[] = [];
  for (const value of Object.values(schema)) {
    if (!is(value, PgTable)) continue;
    const config = getTableConfig(value);
    if (config.schema && config.schema !== "public") continue;
    const columns = config.columns.map((column) => ({
      name: column.name,
      sqlType: column.getSQLType(),
    }));
    const uniques: ExpectedUnique[] = [];
    const inlinePk = config.columns.filter((column) => column.primary);
    if (inlinePk.length > 0) {
      uniques.push({
        name: `${config.name}_pkey`,
        columns: inlinePk.map((column) => column.name),
        primary: true,
      });
    }
    for (const pk of config.primaryKeys) {
      uniques.push({
        name: pk.getName(),
        columns: pk.columns.map((column) => column.name),
        primary: true,
      });
    }
    for (const column of config.columns) {
      if (!column.isUnique || !column.uniqueName) continue;
      uniques.push({
        name: column.uniqueName,
        columns: [column.name],
        primary: false,
      });
    }
    for (const constraint of config.uniqueConstraints) {
      const name = constraint.getName();
      if (!name) continue;
      uniques.push({
        name,
        columns: constraint.columns.map((column) => column.name),
        primary: false,
      });
    }
    for (const index of config.indexes) {
      if (!index.config.unique || !index.config.name) continue;
      const names: string[] = [];
      let expression = false;
      for (const column of index.config.columns) {
        if (column && typeof column === "object" && "name" in column && typeof column.name === "string") {
          names.push(column.name);
        } else {
          expression = true;
        }
      }
      if (expression) continue;
      uniques.push({ name: index.config.name, columns: names, primary: false });
    }
    tables.push({ name: config.name, columns, uniques });
  }
  tables.sort((a, b) => a.name.localeCompare(b.name));
  return { tables };
}

export function columnTypeCompatible(sqlType: string, live: LiveColumn): boolean {
  const t = sqlType.trim().toLowerCase();
  const data = live.dataType.toLowerCase();
  const udt = live.udtName.toLowerCase();
  const varchar = t.match(/^varchar(?:\((\d+)\))?$/);
  if (varchar) {
    if (data !== "character varying" && udt !== "varchar") return false;
    const len = varchar[1] ? Number(varchar[1]) : null;
    return (live.charMax ?? null) === len;
  }
  if (t === "text") return data === "text" || udt === "text";
  if (t === "text[]") return data === "array" && udt === "_text";
  if (t === "integer" || t === "serial") return data === "integer" || udt === "int4";
  if (t === "bigint" || t === "bigserial") return data === "bigint" || udt === "int8";
  if (t === "boolean") return data === "boolean" || udt === "bool";
  if (t === "timestamp") return data === "timestamp without time zone" || udt === "timestamp";
  if (t === "timestamp with time zone") return data === "timestamp with time zone" || udt === "timestamptz";
  if (t === "date") return data === "date" || udt === "date";
  if (t === "jsonb") return udt === "jsonb";
  if (t === "json") return udt === "json" && data !== "jsonb";
  if (t === "real") return data === "real" || udt === "float4";
  if (t === "double precision") return data === "double precision" || udt === "float8";
  if (t === "bytea") return data === "bytea" || udt === "bytea";
  const numeric = t.match(/^numeric(?:\((\d+)\s*,\s*(\d+)\))?$/);
  if (numeric) {
    if (data !== "numeric" && udt !== "numeric") return false;
    if (!numeric[1]) return live.numericPrecision == null;
    return live.numericPrecision === Number(numeric[1]) && live.numericScale === Number(numeric[2]);
  }
  return data === "user-defined" && udt === t;
}

/** What information_schema returns after drizzle creates this column. Test helper. */
export function compatibleLiveColumn(table: string, column: string, sqlType: string): LiveColumn {
  const t = sqlType.trim().toLowerCase();
  const base = {
    table,
    column,
    dataType: "USER-DEFINED",
    udtName: t,
    charMax: null as number | null,
    numericPrecision: null as number | null,
    numericScale: null as number | null,
  };
  const varchar = t.match(/^varchar(?:\((\d+)\))?$/);
  if (varchar) {
    return { ...base, dataType: "character varying", udtName: "varchar", charMax: varchar[1] ? Number(varchar[1]) : null };
  }
  if (t === "text") return { ...base, dataType: "text", udtName: "text" };
  if (t === "text[]") return { ...base, dataType: "ARRAY", udtName: "_text" };
  if (t === "integer" || t === "serial") return { ...base, dataType: "integer", udtName: "int4" };
  if (t === "bigint" || t === "bigserial") return { ...base, dataType: "bigint", udtName: "int8" };
  if (t === "boolean") return { ...base, dataType: "boolean", udtName: "bool" };
  if (t === "timestamp") return { ...base, dataType: "timestamp without time zone", udtName: "timestamp" };
  if (t === "timestamp with time zone") return { ...base, dataType: "timestamp with time zone", udtName: "timestamptz" };
  if (t === "date") return { ...base, dataType: "date", udtName: "date" };
  if (t === "jsonb") return { ...base, dataType: "jsonb", udtName: "jsonb" };
  if (t === "json") return { ...base, dataType: "json", udtName: "json" };
  if (t === "real") return { ...base, dataType: "real", udtName: "float4" };
  if (t === "double precision") return { ...base, dataType: "double precision", udtName: "float8" };
  if (t === "bytea") return { ...base, dataType: "bytea", udtName: "bytea" };
  const numeric = t.match(/^numeric(?:\((\d+)\s*,\s*(\d+)\))?$/);
  if (numeric) {
    return {
      ...base,
      dataType: "numeric",
      udtName: "numeric",
      numericPrecision: numeric[1] ? Number(numeric[1]) : null,
      numericScale: numeric[2] ? Number(numeric[2]) : null,
    };
  }
  return base;
}

function asNumber(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function liveSchemaFromProbe(payload: unknown): LiveSchema {
  const body = typeof payload === "string" ? JSON.parse(payload) as { columns?: unknown; indexes?: unknown } : payload as { columns?: unknown; indexes?: unknown } | null;
  const columns = Array.isArray(body?.columns) ? body.columns : [];
  const indexes = Array.isArray(body?.indexes) ? body.indexes : [];
  return {
    columns: columns.map((row) => {
      const item = row as Record<string, unknown>;
      return {
        table: String(item.table ?? ""),
        column: String(item.column ?? ""),
        dataType: String(item.dataType ?? ""),
        udtName: String(item.udtName ?? ""),
        charMax: asNumber(item.charMax),
        numericPrecision: asNumber(item.numericPrecision),
        numericScale: asNumber(item.numericScale),
      };
    }),
    indexes: indexes.map((row) => {
      const item = row as Record<string, unknown>;
      const cols = Array.isArray(item.columns) ? item.columns.map((name) => String(name)) : [];
      return {
        table: String(item.table ?? ""),
        name: String(item.name ?? ""),
        unique: item.unique === true,
        primary: item.primary === true,
        columns: cols,
      };
    }),
  };
}

export function compareSchema(expected: ExpectedSchema, live: LiveSchema): SchemaVerifyResult {
  const issues: string[] = [];
  const columnsByTable = new Map<string, Map<string, LiveColumn>>();
  for (const column of live.columns) {
    let table = columnsByTable.get(column.table);
    if (!table) {
      table = new Map();
      columnsByTable.set(column.table, table);
    }
    table.set(column.column, column);
  }
  const push = (issue: string) => {
    if (issues.length < ISSUE_LIMIT) issues.push(issue);
  };
  for (const table of expected.tables) {
    const liveColumns = columnsByTable.get(table.name);
    if (!liveColumns || liveColumns.size === 0) {
      push(`missing_table:${table.name}`);
      continue;
    }
    for (const column of table.columns) {
      const found = liveColumns.get(column.name);
      if (!found) {
        push(`missing_column:${table.name}.${column.name}`);
        continue;
      }
      if (!columnTypeCompatible(column.sqlType, found)) {
        push(`type_mismatch:${table.name}.${column.name}`);
      }
    }
    for (const unique of table.uniques) {
      const columns = columnNames(unique.columns);
      const found = live.indexes.some((index) =>
        index.table === table.name
        && index.unique
        && index.name === unique.name
        && index.columns.length === columns.length
        && index.columns.every((name, i) => name === columns[i])
      );
      if (!found) push(`missing_unique:${unique.name}`);
    }
  }
  if (issues.length === 0) return { ok: true, reason: "" };
  return { ok: false, reason: issues.join(",") };
}

export async function verifyLiveSchema(query?: (sql: string) => Promise<unknown>): Promise<SchemaVerifyResult> {
  const run = query ?? (async (sql: string) => {
    const { pool } = await import("../db");
    const result = await pool.query(sql);
    return result.rows[0]?.probe;
  });
  const payload = await run(SCHEMA_PROBE_SQL);
  return compareSchema(expectedSchemaFromDrizzle(), liveSchemaFromProbe(payload));
}
