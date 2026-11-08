/**
 * Read-only checklist for the additive baseball-prep schema.
 * Boot backup retention in code is BOOT_BACKUP_KEEP (14 files). That is not
 * the 30 Oct 2026 decision of 7 daily backups. This module does not change it.
 */
export const REQUIRED_SCHEMA_OBJECTS = {
  column: { table: "game_sets", column: "canonical_identity" },
  index: "uq_game_sets_canonical_identity",
  table: "design_pool_submissions",
} as const;

export function missingRequiredObjects(live: {
  columns: { table: string; column: string }[];
  indexes: { name: string }[];
  tables: string[];
}): string[] {
  const missing: string[] = [];
  const hasColumn = live.columns.some((row) => row.table === REQUIRED_SCHEMA_OBJECTS.column.table && row.column === REQUIRED_SCHEMA_OBJECTS.column.column);
  if (!hasColumn) missing.push("missing_column:game_sets.canonical_identity");
  if (!live.indexes.some((row) => row.name === REQUIRED_SCHEMA_OBJECTS.index)) missing.push("missing_unique:uq_game_sets_canonical_identity");
  if (!live.tables.includes(REQUIRED_SCHEMA_OBJECTS.table)) missing.push("missing_table:design_pool_submissions");
  return missing;
}

/** No writes. Colliding canonical keys must be reviewed before any backfill. */
export function backupReadiness(input: {
  backupDirReadable: boolean;
  dumpBytes: number | null;
  freeBytes: number | null;
  minFreeBytes: number;
  collisionKeys: number;
}): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!input.backupDirReadable) reasons.push("backup_dir_unreadable");
  if (input.dumpBytes != null && input.dumpBytes <= 0) reasons.push("backup_empty");
  if (input.freeBytes != null && input.freeBytes < input.minFreeBytes) reasons.push("backup_volume_low");
  if (input.collisionKeys > 0) reasons.push("canonical_collisions");
  return { ok: reasons.length === 0, reasons };
}
