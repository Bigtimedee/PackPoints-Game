# Baseball base-set expansion runbook

Preparation only. This does not merge, deploy, import, set Railway variables, or clear a set.

Verified public catalog on 2026-11-08 from `GET https://packpts.com/api/sets` (eligible `cardCount` only):

| Set | Id | Eligible |
| --- | --- | --- |
| 1986 Topps Baseball | `2b77043a-6583-4d79-b59d-d2ab20291a17` | 555 |
| 1987 Topps Baseball | `37fd025d-2ae1-4c92-b8ad-133375d0c722` | 501 |
| 1988 Topps Baseball | `affd57b8-2b1d-4ea3-9f51-1530d8088e5c` | 506 |
| 1989 Topps Baseball | `352b33d1-c110-4e09-b641-8e3c02a94442` | 297 |
| 1987 Donruss Baseball | `3ff8de8d-d6f3-4e3a-bd46-1eadb0c787e4` | 23 |

The other sixteen targets are not in that public index. Absence there does not mean the database has no inactive row.

## Blockers before any insert

- CardHedge was not queried from the preparation environment. No API key was present, and no checklist size was invented. The sixteen missing configs have `baseCount: null`. `confirmImport` returns `409 base_count_unverified` and inserts nothing.
- Supplier preview is allowed only after this code is running in an environment that already has the CardHedge credential. Use it to record distinct base numbers, image presence, and variant counts. Put a verified `baseCount` in code in a later review. Do not paste player lists into the repo.
- Inactive ids must be read with the inventory call below before create. A name collision returns `409 existing_identity` and does not insert a second set.

## Why 1987 Donruss shows 23

Public `cardCount` is the deal-eligible count, not the imported count. The set is cleared, and its cards still need a `source = qa` row in `card_review_approvals` before they deal. The 2026-10-03 note in project context recorded 361 imported of 660, with gaps for missing images and excluded cards. This change did not re-count those rows. The additive fill path still inserts only missing base cards and does not update an approved row or write an approval.

## Auth

Every `/api/qa/` call uses the existing `COVER_QA_TOKEN` in the `X-QA-Token` header. A query-string token is ignored. Do not print the token. These routes are not public and do not return source URLs or player names in the inventory or export job payloads. The Design inbox files do contain them and must stay out of git.

```bash
BASE=https://packpts.com
HDR=(-H "X-QA-Token: $COVER_QA_TOKEN" -H "Content-Type: application/json")
```

## 1. Check inactive and active ids

```bash
curl -sS "$BASE/api/qa/baseball-expansion/inventory" "${HDR[@]}"
```

Each of the 21 entries includes `setId`, `role`, `existing`, and `collisions`. `collisions` lists other baseball rows from 1986–1991 with the same year, brand, and a colliding set name, including inactive rows. Card counts are included. Player names and image URLs are not.

If `collisions` is non-empty, do not create. Keep the historical id. Creating the proposed id is refused with `409`.

Proposed ids are UUID v5 of `baseball|<year>|<brand>|<set name>` under namespace `8f3c1a0e-7b21-4d5a-9e66-0c1b2a3d4e5f`. They are used only when inventory shows no collision and no row with that id.

## 2. Create a held set

Only after inventory is clean:

```bash
curl -sS -X POST "$BASE/api/qa/held-imports/<proposed-id>/create" "${HDR[@]}"
```

The row is active and integrated, with no mask profile and no clearance. Expect `holdReason` `no_mask_profile`. Repeat calls are idempotent. This does not import cards, pin covers, or approve anything.

## 3. Preview, then import

Default preview does not start a job and does not call CardHedge:

```bash
curl -sS -X POST "$BASE/api/qa/sets/<set-id>/fill-missing" "${HDR[@]}" -d '{}'
```

Read-only supplier preview (no inserts):

```bash
curl -sS -X POST "$BASE/api/qa/sets/<set-id>/fill-missing" "${HDR[@]}" -d '{"supplierPreview":true,"details":true}'
```

Poll `GET /api/qa/sets/<set-id>/fill-missing/<jobId>` with the same header. A truncated page cap or a null base count sets `insertBlocked` and inserts nothing. A supplier error fails the job before insert. Re-running a successful import inserts nothing for rows that already exist.

Insert, only after a verified base count is in code and inventory is clean:

```bash
curl -sS -X POST "$BASE/api/qa/sets/<set-id>/fill-missing" "${HDR[@]}" \
  -d '{"dryRun":false,"confirmImport":true,"details":true}'
```

For 1987 Donruss the base count is already 660. New rows stay unapproved. Approved rows and pinned covers are not updated. Do not run this until the parent authorizes that phase.

`POST /api/qa/sets/<set-id>/fill-missing/prepare` with explicit card ids bakes only new unreviewed cards. An unprofiled expansion id refuses the bake (`unprofiled_expansion_set`) instead of painting the default band.

## 4. Bake and export for Design

Set `PACKPTS_DESIGN_INBOX` on the box to `/workspace/packpts-design/set-expansion-21/inbox`. This repository does not set that variable. Each set writes `<inbox>/<slug>/` and can finish on its own.

```bash
curl -sS -X POST "$BASE/api/qa/baseball-expansion/<set-id>/export" "${HDR[@]}" -d '{"write":true}'
```

Optional `coverIds` is up to eight card ids. Those files are proposed masked picks only. `covers/NOT_DAILY5.json` says `dealDaily5: false` and `pinned: false`. Nothing is pinned and Daily 5 is unchanged.

Without `write: true` the call returns 200 and writes nothing. Without the inbox variable, `write: true` returns `409 inbox_unconfigured`.

The directory holds:

- `profile.json` — explicit regions as x/y/w/h fractions and `side`, or `explicit: false` when no measured profile exists
- `pool.csv` — `heldId,player,cardNo,sourceUrl,width,height`
- `original-submitted.csv` — the first pool, never replaced by a later smaller export
- `source/<heldId>.jpg` and `masked/<heldId>.jpg` — full pool, 1:1
- `masked-300/<heldId>.jpg` — the same masked file at 300px wide for the name-plate check
- `reconciliation.json` — original count, pass/drop, hosts, manifest sha256
- `READY` — only when the profile is explicit, every original card has source and masked files, at least 95% of that original count pass, and every released card passes

`design_pool_submissions` stores the first card-id list and count. Later exports do not shrink it. `design_pool_health_checks` appends the verdict. Both tables are created by the boot `drizzle-kit push --force` because they are in `shared/schema.ts`.

## 5. Design gate

Denominator is the original submitted count, including cards that later fail. Failed cards are excluded. Released cards must be 100% clean (`name_check_missing`, a refusal, a short side under 600px, a slab, a third-party host, a non-base variant, or a blocked reason is a failure). Under 95% means fix the mask or the source and resubmit the same manifest. Do not clear a subset.

A registered profile does not clear the set. For a missing expansion id, `POST /api/qa/sets/<set-id>/design-approval` with `{"approve":true,"approvedBy":"..."}` stays `409` until a measured profile exists and the latest health row is `pass` with released count at least `PUBLIC_SET_MIN_ELIGIBLE_CARDS` (5). This code does not call that route.

There is no fallback profile for an unprofiled expansion id. The existing 1989 Upper Deck 20% name match is not approval and is not used for `eb88c57e-cbd5-5d4b-a223-37b8fa8f99c2`. 1988 Topps stays on `1988-topps-diagonal-reviewed-v1`. Mask version is unchanged.

## 6. Public play and Daily 5

Until Design records that pass, the set is held and is omitted from public sets, deals, covers, and Daily 5. After that approval, the sixteen ids are still skipped by Daily 5 (`expansion_not_enrolled`) so a large new set cannot take the calendar or the legacy most-cards pick. Enrolling one id is a separate reviewed change to `isDaily5ExpansionBlocked` after Design's full-pool GREEN for that id. Do not add the id to `CLEARED_SET_IDS` in the same change as the import.

## Not done in this change

No live import, no Railway variable write, no merge, no deploy, no Design clearance, no measured mask geometry for the sixteen, and no CardHedge coverage counts. Those remain blocked until the parent runs the authorized phase on a successful deploy.
