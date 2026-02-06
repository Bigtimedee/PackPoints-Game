# PackPTS Card/Set Mutation Forensic Analysis

## Root Cause of "Autonomous Pruning"

The sets shrinking automatically (e.g., 1987 Topps from ~700 to ~440 cards) was caused by **two scheduled background processes** that automatically set `isPlayable=false` without admin approval:

### PRIMARY CULPRIT: `server/services/imageValidation.ts`
- **Function**: `validatePlayableCardImages()` and `runFullValidation()`
- **Invocation**: Automatic, runs every 6 hours via `startValidationJob()` (lines 500-519)
- **Problem Code**: Lines 220-231 and 240-251
  - When placeholder detected: immediately sets `isPlayable: false, blockedReason: "placeholder_image"`
  - When validation fails 2+ times: sets `isPlayable: false, blockedReason: "image_validation_failed"`
- **FIXED**: Now only updates quarantine fields, never `isPlayable`

### SECONDARY CULPRIT: `server/services/cardPoolRefresh.ts`
- **Function**: `runCardPoolRefreshJob()`
- **Invocation**: Automatic, runs every 12 hours via interval in server/index.ts
- **Problem Code**: Lines 130-146
  - Attempts to revalidate excluded cards but increments failure count
  - Can prevent cards from ever recovering
- **FIXED**: Now only updates quarantine fields

---

## All Card/Set Mutation Paths (Audit)

### DESTRUCTIVE OPERATIONS (now gated with operation_source)

| File | Function | Invocation | Action | Fixed |
|------|----------|------------|--------|-------|
| `server/services/imageValidation.ts:220-231` | validatePlayableCardImages | AUTO (6h) | Sets `isPlayable=false` for placeholders | ✅ |
| `server/services/imageValidation.ts:240-251` | validatePlayableCardImages | AUTO (6h) | Sets `isPlayable=false` after 2 failures | ✅ |
| `server/services/imageValidation.ts:331-344` | validateBaseballCardImages | AUTO (6h) | Sets `imageVerified=false` | ✅ |
| `server/services/imageValidation.ts:461-470` | revalidateCard | ADMIN | Sets `isPlayable` based on result | ✅ |
| `server/services/cardPoolRefresh.ts:137-144` | runCardPoolRefreshJob | AUTO (12h) | Increments failure count, sets blockedReason | ✅ |
| `server/storage.ts:flagCardForImageFailure` | flagCardForImageFailure | CLIENT | Was setting `isPlayable=false` after 2 image failures | ✅ (Fixed: now only logs, never excludes) |
| `server/services/cardImageRefresh.ts:180` | getFreshImageUrl | AUTO | Was setting `isPlayable=false` on player mismatch | ✅ (Fixed: now sets quarantine fields only) |
| `server/routes.ts:6787` | /api/admin/playable-sets/:id/purge-reimport | ADMIN | Deletes all cards, reimports | ✅ (Admin-only) |
| `server/scripts/verifyAllCards.ts:97` | verifyAllCards | ADMIN script | Sets `contentVerified` | ✅ (Admin-only) |

### BACKDOOR PRUNE MECHANISM (FIXED)

The `image_failure_count < 2` filter appeared in ALL gameplay and count queries. Even though `isPlayable` was protected by the mutation guard, incrementing `image_failure_count` to 2+ had the same effect of removing cards from gameplay. This filter has been removed from all queries:
- `server/storage.ts:getRandomCardsFromSet()` - main gameplay query
- `server/storage.ts` - replacement card queries (same set + fallback set)
- `server/routes.ts:/api/admin/game-sets` - admin count display
- `server/routes.ts:/api/playable-sets` - public dropdown count
- `server/routes.ts:/api/admin/game-sets/:id/diagnose` - diagnostic count
- `server/routes.ts:/api/admin/game-sets/repair` - repair count
- `server/routes.ts:purge-reimport` - forensic count

### NON-DESTRUCTIVE OPERATIONS (allowed for SYSTEM)

| File | Function | Action |
|------|----------|--------|
| `server/routes.ts:5775-5786` | /api/admin/cards/:id/verify | Updates `contentVerified` (admin panel button) |
| `server/storage.ts:526+` | getRandomCardsFromSet | Only reads, filters by `contentVerified IS NULL OR true` |

---

## Operation Source Enforcement

All card mutations must now include an `operation_source`:
- `ADMIN_MANUAL` - Admin explicitly triggered action
- `SYSTEM_NON_DESTRUCTIVE` - Background job, can only update quarantine fields
- `CARDHEDGE_CONFIRMED` - CardHedge API confirmed card is gone (still requires admin approval to delete)

### Guard Function
`server/services/mutationGuard.ts:assertMutationAllowed()`

Enforced at:
1. All validation functions in imageValidation.ts
2. All refresh functions in cardPoolRefresh.ts
3. Purge/reimport endpoint
4. Card verification endpoint
5. Any future card mutation

---

## Kill Switch

Environment variable: `DISABLE_AUTOMATED_SET_MUTATIONS=true`

When enabled:
- Background tasks skip all card mutations
- Only admin-triggered operations are allowed
- Audit log entries are still written (marked as "SKIPPED_KILL_SWITCH")

---

## Quarantine Flow (New)

Instead of setting `isPlayable=false`, background processes now:

1. Increment `validationFailCount`
2. Update `lastValidation*` fields with evidence
3. Set `quarantineStatus`:
   - `OK` → `SUSPECT_TRANSIENT` (1-4 failures)
   - `SUSPECT_TRANSIENT` → `SUSPECT_PERSISTENT` (5+ failures, some transient)
   - `SUSPECT_PERSISTENT` → `QUARANTINED_ADMIN_REVIEW` (5+ failures, confirmed non-transient)
4. Set `proposedUnplayable=true` only when CardHedge confirms removal

Admin must click "Apply Proposed Changes" to actually set `isPlayable=false`.

---

## Audit Log

Table: `set_audit_log`

Every mutation writes:
- Before/after card counts
- Operation source and actor
- Evidence (CardHedge response metadata)
- Reason for mutation

Query to find suspicious autonomous changes:
```sql
SELECT * FROM set_audit_log 
WHERE operation_source != 'ADMIN_MANUAL' 
AND delta_playable < 0
ORDER BY created_at DESC;
```
