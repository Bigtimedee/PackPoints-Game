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

`fillConfigFromTarget` copies `baseCount` and `baseCountProvenance` from the target. A data-only registry edit is what turns the cap on. The cap does not release the set.

All 16 missing targets now have a published checklist length. `confirmImport` reports `importMode: verified_cap` and refuses a number above that length. The length is the flagship base checklist, including numbered subsets. It is not the count of supplier candidates and not the count of cards the game will deal. All-Stars, highlights, checklists, and unusable photos stay out under the existing classifier and variant gate. A supplier row whose variant is not Base, including a 1990 Topps Salute row for checklist numbers 2–5, is `not_base` before the classifier runs. The classifier has no Salute rule. That gate is unchanged.

| Set | Id | Checklist |
| --- | --- | --- |
| 1990 Topps | `97456b32-7b68-56fe-971a-1c821e2b09c4` | 792 |
| 1991 Topps | `14f17bb7-a697-5080-9ec5-381c6d7e15ce` | 792 |
| 1986–1990 Fleer | see registry | 660 |
| 1991 Fleer | `49e656e0-3762-5113-82b5-1480f1c77541` | 720 |
| 1986, 1988, 1989 Donruss | see registry | 660 |
| 1990 Donruss | `64130c7a-6b1a-533c-9575-1089f7adfdce` | 716 |
| 1991 Donruss | `e4f4a86e-3908-5e93-af8f-fd8462c25d97` | 770 |
| 1989–1991 Upper Deck | see registry | 800, high series included, Final Edition excluded |

Provenance on each row is the BaseballCardPedia base checklist opened Nov 8, 2026. Supplier previews are complete and inserted nothing. Candidate totals, which are not these caps: 1990 Topps 305, 1991 Topps 317, Fleer 1986–1991 448, 21, 145, 267, 429, 55, Donruss 1986 and 1988–1991 142, 267, 364, 512, 413, Upper Deck 1989–1991 122, 462, 486. That is 4,755 candidates. Profiles stay unregistered, public routes stay 404, and Daily 5 stays blocked.

A held insert does not validate the scan. The job report sets `sourceValidated` false. The fill job does not download a scan. Passing the checklist cap only means the printed number is in range. `rejectCardIds` is not a positive allowlist: a different supplier id for the same number can still be claimed.

Known-bad scans stay in the private box inventory. Pass their supplier ids on the existing fill call as `rejectCardIds`. Do not commit those ids, file hashes, or image URLs. A preview with that field shows the reduced candidate list and still inserts nothing. The same field on `confirmImport` skips those ids with `reviewed_source_reject` and leaves the checklist number open. The other rows still land held for card review. Nothing in that call approves a card, a profile, or the set.

```bash
curl -sS -X POST "$BASE/api/qa/sets/<id>/fill-missing" "${HDR[@]}" \
  -d '{"dryRun":false,"confirmImport":true,"details":true,"rejectCardIds":["<supplier-id>"]}'
```

`rejectCardIds` accepts up to 2,000 opaque ids and refuses a value that contains `://` or `/`. After a held import, public set, cover, game-start, and play-mask routes still 404. A short side under 600 is flagged later by the Design packet. A tall scan or a front-and-back composite is not. Those stay on the private reject list until Design accepts a replacement source. Do not stretch, crop, or deal them.

Held discovery remains the path only when `baseCount` is null. These sixteen are no longer on that path.

## 1991 Upper Deck discovery cohort

Set `cd597562-5b8f-5517-aca0-38b04f443747` stays held. Its checklist cap is 800. The discovery cohort is a separate 486-member denominator. A 150-candidate list or a 22-sample pack is not that cohort and cannot become it: the create call requires 486 members and artifact SHA `11bf0c4dd539aa61663d8db11cd6794542258ef560c8e09517df5a406f972922`. The private member file is not in this repo. This deploy does not submit it.

`POST /api/qa/baseball-expansion/:id/discovery-cohort` with `X-QA-Token` stores supplier ids, hashes, and dimensions. It does not accept an image URL. The same body a second time is unchanged. A different body is `409 membership_mismatch` and does not replace the first rows. Revisions append under the original member. Additions do not enter the original rate. A playable id may stay null.

Before any insert, `POST .../discovery-cohort/stage` with `supplierId` and `imageBase64` stores those bytes when they match a pass-candidate member. Holds and drops are `not_importable`. A hash or dimension mismatch is `source_drift` and is not stored. `confirmImport` downloads the candidate URL from an approved supplier host, with a streaming size cap, and writes the card, the member link, and the provenance row in one transaction. It inserts only when those bytes equal the staged bytes. A later change at that URL does not insert, and a guarded card with a missing bind is not fetched. The mask bake uses the stored bytes and does not return a warm file after that URL changes. The public play route stays 404. A legacy design-pool row blocks a later cohort for the same set. Another supplier id for the same number is `unregistered_source`. No cohort yet means `exact_source_required` and no insert. The denylist does not replace this gate. A staged or imported pass-candidate is not a review pass: source acceptance and opaque QA stay false, and `reviewReady` stays false while any original member is unimported, held, dropped, or unmeasured. Revisions are an audit append only. They do not authorize a replacement import. The create call also requires the canonical membership digest `336a18397f2b2a6b9d88d03860399e72da33b53084ad714d63affc18edef6207`. Repeating the artifact SHA with a different body is `membership_mismatch`.

Geometry proposals are private rows. `approval` cannot be true. A null version or a null polygon is stored as unmeasured and cannot be used. A wrong hash or wrong dimensions is refused. A proposal does not clear a hold and does not register a mask profile. Public set, cover, game-start, play-mask, and Daily 5 routes stay closed.

## Box export

The server returns `400 box_exporter_required` for `POST /api/qa/baseball-expansion/:id/export` and writes no directory. On the box:

```bash
PACKPTS_BASE_URL="$BASE" COVER_QA_TOKEN="$COVER_QA_TOKEN" \
  npx tsx scripts/export-design-inbox.ts --set <id> --out /workspace/packpts-design/set-expansion-21/inbox
```

The script is the entrypoint. `--out` is a trusted private directory. The script refuses a symlink or a `public` / `static` / `dist` / `masked-cards` path. That is not a proof against a hostile writer racing the process. It deletes `REVIEW_READY` before downloading, streams each file with a 15MB cap, and deletes a partial file on failure. Card ids that are not UUIDs are not used as filenames. It then calls `exportDesignSet`, which writes `profile.json`, `pool.csv` (`heldId,player,cardNo,sourceUrl,width,height`), paired `source/` and `masked/` when `--review` is set, `covers/NOT_DAILY5.json`, and `reconciliation.json`.

The first `--review` stores the original id list once, in `original-submitted.csv` and in `design_pool_submissions` when that route accepts it. A later run reads that row. The id list and its hash are the membership. A matching count is not. The same count with different ids stays the first list. A different source witness or mask revision does not replace it. `--resubmit` appends `resubmissions.json` and sets `replacesOriginal` false. Source-only discovery does not create the original list. `--review` writes `REVIEW_READY` only after the packet validates. The marker says `releaseApproval: false`. A failed rerun removes a stale marker and does not delete the stored original list. It is not GREEN. Run it on the box. Do not treat a file written on an agent VM as the Design copy.

`POST /api/qa/baseball-expansion/:id/original-pool` stores sorted card ids, the manifest hash, and a source witness. The insert reloads the winning row. A same-size different id list is `409 membership_mismatch`. The same ids with a different source witness are `409 witness_changed`. Ids that are not in that held set are `409 foreign_card`. The prep gate does not call it.

## Schema this deploy adds

This is not tables only.

- Nullable column `game_sets.canonical_identity`.
- Partial unique index `uq_game_sets_canonical_identity` where that column is not null. Existing rows stay null.
- Table `design_pool_submissions` for the original id list. The hold gate does not read it. The box exporter reads it when the row exists and does not replace that row.

Boot still uses the live backup code from `5ffc9de`: a custom-format `pg_dump` before `drizzle-kit push --force` when the schema hash changed, and the push is skipped if that dump fails. `BOOT_BACKUP_KEEP` is 14 files. That is not the 30 Oct 2026 decision of 7 daily backups, and this change does not rewrite retention. A foreground push that does not apply now refuses to open routes (`schema_not_ready`). The fast path still opens only after the catalog probe matches `shared/schema.ts`, which includes the new column, partial unique index, and `design_pool_submissions`. Do not push by hand. `planCanonicalBackfill` is a read-only collision report. This deploy does not DELETE or UPDATE historical rows.

Exact additive DDL, and nothing else:

- `ALTER TABLE game_sets ADD COLUMN canonical_identity text` (nullable).
- `CREATE UNIQUE INDEX uq_game_sets_canonical_identity ON game_sets (canonical_identity) WHERE canonical_identity IS NOT NULL`.
- `CREATE TABLE design_pool_submissions` (set id, count, manifest hash, card ids, mask version, source witness, submitted at).

Boot does not run a separate preflight. Nothing in this repo calls one automatically. Before an operator applies that DDL by hand, they run these reads themselves. This repository does not run them.

```sql
SELECT column_name FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'game_sets' AND column_name = 'canonical_identity';
SELECT indexname FROM pg_indexes WHERE indexname = 'uq_game_sets_canonical_identity';
SELECT to_regclass('public.design_pool_submissions');
```

Confirm the backup directory on the volume is readable and the newest dump file is non-empty. `planCanonicalBackfill` is a read-only collision report an operator can run in a shell; boot does not call it. No production action is taken from this repository.

## CI

The unit-test job is the gate. Playwright is `if: false`. The live SEO name-leak step exits 0 with a warning when `PACKPTS_QA_TOKEN` is unset, so a green workflow does not mean that live check ran. The offline surname fixture is the hard SEO gate.

Historical supplier note, not a new query: an October 10 read of 1986 Topps saw 804 distinct supplier rows and imported 636. Production has `CARDHEDGE_API_KEY` and `COVER_QA_TOKEN` configured. This environment does not copy them.
