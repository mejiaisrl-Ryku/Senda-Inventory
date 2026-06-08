# Runbook: Roll Back Production

**When to use:** A merge to `main` deployed something broken and you need to restore the previous working state immediately.

---

## 1. Identify the bad merge commit

```bash
git log --oneline main | head -10
```

Note the merge commit SHA — call it `<BAD_SHA>`.

---

## 2. Revert the merge commit (do NOT `git reset` on a shared branch)

```bash
git checkout main
git pull origin main
git revert -m 1 <BAD_SHA> -n        # -m 1 = keep mainline parent; -n = no auto-commit
git commit -m "revert: roll back <BAD_SHA> — <brief reason>"
git push origin main
```

This creates a new commit that undoes the bad changes. Railway and Vercel will detect the push and redeploy automatically.

---

## 3. Confirm the redeploy succeeded

- **Railway:** Dashboard → Deployments tab — wait for the new deploy to go green. Check the backend health endpoint.
- **Vercel:** Dashboard → Deployments — confirm the latest build succeeded and the correct commit SHA is live.

Test the critical path: login → view inventory → place/receive an order.

---

## 4. Re-tag if you rolled back a versioned release

If the broken deploy was tagged (e.g. `v1.2.0`), delete the remote tag and retag the current good HEAD:

```bash
git tag -d v1.2.0                          # delete local
git push origin :refs/tags/v1.2.0          # delete remote
git tag -a v1.2.0 -m "Release v1.2.0 (redeployed after rollback)"
git push origin v1.2.0
```

---

## 5. Roll back a Railway database migration

> **Only needed if the bad deploy ran `prisma migrate deploy` and the schema change is incompatible with the reverted code.**

### Option A — The migration added a nullable column (safe to leave)
Leave the column in place. The reverted code ignores it. No action needed.

### Option B — The migration is destructive (dropped column, changed type)
You must restore from backup before the reverted code can work.

```bash
# 1. Put the app in maintenance mode (disable Railway service or set an env var your
#    middleware checks to return 503) to stop writes during restore.

# 2. Restore the Railway PostgreSQL backup:
#    Railway Dashboard → your Postgres service → Backups
#    → select the snapshot taken before the bad deploy → Restore.
#    Railway will restore in-place; the database URL does not change.

# 3. Re-enable the service. The reverted backend code is now compatible with the
#    restored schema.

# 4. Mark the failed migration as rolled back in the shadow database if you use
#    prisma migrate (not prisma db push):
#      railway run npx prisma migrate resolve --rolled-back <migration_name>
```

### Preventing this in the future
- Always take an explicit Railway backup before any deploy that includes a migration.
- Prefer additive migrations (add nullable columns, new tables) over destructive ones.
- Test migrations against a staging database before merging to `main`.

---

## 6. Communicate

Notify team in the relevant channel:
- What broke, when it was detected, what was reverted.
- Whether any data was affected.
- ETA for a proper fix going through `develop` → PR → `main`.
