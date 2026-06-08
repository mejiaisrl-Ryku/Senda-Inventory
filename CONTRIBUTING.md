# Contributing to Senda Inventory

## Branch Model

```
main        ← production (protected, auto-deploys to prod via Railway/Vercel)
develop     ← integration branch — all feature work merges here first
feat/*      ← new features, branched from develop
fix/*       ← bug fixes, branched from develop
chore/*     ← tooling / deps / non-functional, branched from develop
docs/*      ← documentation only, branched from develop
refactor/*  ← code restructuring with no behavior change, branched from develop
hotfix/*    ← critical prod fixes ONLY — branch from main, PR into both main AND develop
```

**Rule:** Never push directly to `main` or `develop`. All changes go through a PR.

## Commit Convention (Conventional Commits)

Format: `<type>(<optional scope>): <short description>`

| Type | When to use |
|---|---|
| `feat` | New user-facing feature |
| `fix` | Bug fix |
| `chore` | Tooling, deps, CI, config |
| `docs` | Documentation only |
| `refactor` | Code restructuring, no behavior change |

Examples:
```
feat(orders): add batch scan accumulation
fix(auth): handle expired refresh token on /me route
chore: add GitHub Actions CI workflow
```

Keep the subject line under 72 characters. Use the body for *why*, not *what*.

## Release Process

1. All features for the release are merged into `develop` and CI is green.
2. Open a PR from `develop` → `main` titled `release: vX.Y.Z`.
3. Update `CHANGELOG.md` in that PR — move items from `[Unreleased]` to the new version heading.
4. Bump `version` in `frontend/package.json` and `backend/package.json`.
5. Merge the PR (squash or merge commit — keep linear history).
6. On `main`, create an annotated tag:
   ```bash
   git tag -a vX.Y.Z -m "Release vX.Y.Z"
   git push origin vX.Y.Z
   ```
7. Railway and Vercel auto-deploy from `main` — confirm deploy succeeds in both dashboards.

## Rollback Procedure

See [docs/runbook-rollback.md](docs/runbook-rollback.md) for the full step-by-step.

Short version: revert the merge commit → push → Railway/Vercel redeploy the previous state.

## Running Tests

```bash
# Backend — unit tests (no DB required, runs in CI)
cd backend && npm run test:unit

# Backend — all tests including integration (requires DATABASE_URL pointing to a real DB)
cd backend && npm test

# Frontend
cd frontend && npm test -- --watchAll=false
```

**Integration tests** (`auth.test.ts`, `products.test.ts`) hit a real PostgreSQL database.
Run them locally with a `.env` that has `DATABASE_URL` set. They are excluded from CI.

## CRA Build Warning

The frontend uses Create React App. When the `CI` environment variable is set to `true`
(which GitHub Actions does automatically), CRA promotes ESLint warnings to build errors.
CI runs the build with `CI=false` as a deliberate workaround. If you see warnings locally,
fix them — they will eventually become required.
