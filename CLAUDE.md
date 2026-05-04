# CLAUDE.md

## Project: PackPoints (packpts.com)

### Deployment — Railway

- **Project**: `marvelous-freedom` on Railway
- **Production auto-deploy**: every `git push` to `main` triggers a Railway build and deploy. No extra steps needed — commit + push = shipped.
- **Railway CLI**: installed at `/opt/homebrew/bin/railway`, already linked and authenticated. Run `railway status` to confirm.
- **Production DATABASE_URL**: injected by Railway at runtime. To get it locally: `railway run printenv DATABASE_URL`

### Running DB migrations against production

`psql` is not in PATH on this machine. Use the full path. `railway run` doesn't resolve the file correctly either. The working approach:

```bash
# 1. Get the public DB URL from the Postgres service (not the app service)
railway variables --service Postgres --json | python3 -c "import sys,json; print(json.load(sys.stdin)['DATABASE_PUBLIC_URL'])"

# 2. Run the migration
/opt/homebrew/Cellar/libpq/18.1_1/bin/psql "<DATABASE_PUBLIC_URL>" -f migrations/<filename>.sql
```

Or for a drizzle-kit schema push (syncs entire schema to match shared/schema.ts):
```bash
railway variables --service Postgres --json | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['DATABASE_PUBLIC_URL'])" | xargs -I{} sh -c 'DATABASE_URL="{}" npm run db:push'
```

**Always run migrations immediately after pushing code that references new columns.** The app will 500 on any UPDATE/SELECT that touches a column not yet in the production DB.

---

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
