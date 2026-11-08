# Baseball expansion — held prep

This deploy is a held-prep gate. It is not Design GREEN for any of the 16 missing sets. GREEN is a later full-pool release. No source pool is required to deploy or to run inventory and supplier preview.

Do not merge from this document. The parent coordinates the infra deploy separately from any set release. Boot already runs `pg_dump` and skips `drizzle-kit push --force` if that dump fails (`server/startup/bootSchema.ts`). The schema add is nullable `game_sets.canonical_identity` (partial unique index, existing rows stay null) and `design_pool_submissions` (id membership for a later GREEN, unused by this gate). No health table.

## What stays closed

All 16 proposed ids are `no_mask_profile`, absent from `CLEARED_SET_IDS`, and not design-approved. `POST /api/qa/sets/:id/design-approval` returns `409 held_prep_only` for them even if a profile exists. Public `/api/sets/:id`, `/api/sets/:id/covers/:slot`, `/api/game/start`, and `/api/play/m/` use that hold. `getMaskProfile(name, id)` does not use the 1989 Upper Deck 20% fallback. Daily 5 skips them with `expansion_not_enrolled` even when a caller ignores the hold flag. Evidence: `server/tests/baseballExpansion.hold.test.ts`.

## Staff routes

`COVER_QA_TOKEN` is the existing `X-QA-Token` header. It is not a query parameter, not a response field, and not written by these routes. CardHedge is called only inside the server process that already has `CARDHEDGE_API_KEY`. This repo does not contain either value.

```bash
HDR=(-H "X-QA-Token: $COVER_QA_TOKEN" -H "Content-Type: application/json")
```

Inventory, including inactive rows. No player names and no image URLs. Sport match is case-insensitive. Identity is `baseball|year|brand|product`, so Traded and Tiffany do not collide with the base set.

```bash
curl -sS "$BASE/api/qa/baseball-expansion/inventory" "${HDR[@]}"
```

Create is refused with `409 existing_identity` when that canonical key already exists, including an inactive row. The insert takes a transaction advisory lock and the unique index.

```bash
curl -sS -X POST "$BASE/api/qa/held-imports/<id>/create" "${HDR[@]}"
```

Existing fill sets (1987 Donruss, 1986 Topps, 1995 Upper Deck Basketball) still accept `{}` as a dry-run job (`202`) and `{ "dryRun": false }` as an insert job. The 16 missing ids do not. They return `400 explicit_mode_required` until the body is explicit.

Read-only supplier preview, before a verified base count:

```bash
curl -sS -X POST "$BASE/api/qa/sets/<id>/fill-missing" "${HDR[@]}" -d '{"supplierPreview":true}'
```

Discovery insert (held, unapproved, no number cap until `target.baseCount` is set in the registry):

```bash
curl -sS -X POST "$BASE/api/qa/sets/<id>/fill-missing" "${HDR[@]}" \
  -d '{"dryRun":false,"confirmImport":true,"details":true}'
```

`fillConfigFromTarget` copies `baseCount` and `baseCountProvenance` from the target. A data-only registry edit is what turns the cap on. A null count does not release the set.

Held discovery and verified import are different. With `baseCount` null, `confirmImport` reports `importMode: held_discovery` and has no upper number cap. The safe pilot is `supplierPreview`, then a reviewed count and provenance on the target, then `confirmImport`. That run reports `importMode: verified_cap` and refuses numbers above the count. Do not treat a discovery insert as the verified import.

## Box export

The server returns `400 box_exporter_required` for `POST /api/qa/baseball-expansion/:id/export` and writes no directory. On the box:

```bash
PACKPTS_BASE_URL="$BASE" COVER_QA_TOKEN="$COVER_QA_TOKEN" \
  npx tsx scripts/export-design-inbox.ts --set <id> --out /workspace/packpts-design/set-expansion-21/inbox
```

The script is the entrypoint. It deletes `REVIEW_READY` before downloading, streams each file with a 15MB cap, deletes a partial file on failure, and refuses a symlink or a `public` / `static` / `dist` / `masked-cards` path. Card ids that are not UUIDs are not used as filenames. It then calls `exportDesignSet`, which writes `profile.json`, `pool.csv` (`heldId,player,cardNo,sourceUrl,width,height`), paired `source/` and `masked/`, `covers/NOT_DAILY5.json`, `original-submitted.csv`, and `reconciliation.json`. `--review` writes `REVIEW_READY` only after that packet validates. The marker says `releaseApproval: false`. A failed rerun removes a stale marker. It is not GREEN. Run it on the box. Do not treat a file written on an agent VM as the Design copy.

`POST /api/qa/baseball-expansion/:id/original-pool` stores sorted card ids, the manifest hash, and a source witness. The insert reloads the winning row. A same-size different id list is `409 membership_mismatch`. The same ids with a different source witness are `409 witness_changed`. Ids that are not in that held set are `409 foreign_card`. The prep gate does not call it.

## Schema this deploy adds

This is not tables only.

- Nullable column `game_sets.canonical_identity`.
- Partial unique index `uq_game_sets_canonical_identity` where that column is not null. Existing rows stay null.
- Table `design_pool_submissions` for a later full-pool GREEN. The prep gate does not read it.

Boot writes a custom-format `pg_dump` before `drizzle-kit push --force` when `shared/schema.ts` changed, and skips the push if the dump fails or times out (`server/startup/bootSchema.ts`). Do not push by hand. `planCanonicalBackfill` reports keys and collisions and does not UPDATE historical rows.

## CI

The unit-test job is the gate. Playwright is `if: false`. The live SEO name-leak step exits 0 with a warning when `PACKPTS_QA_TOKEN` is unset, so a green workflow does not mean that live check ran. The offline surname fixture is the hard SEO gate.

Historical supplier note, not a new query: an October 10 read of 1986 Topps saw 804 distinct supplier rows and imported 636. Production has `CARDHEDGE_API_KEY` and `COVER_QA_TOKEN` configured. This environment does not copy them.
