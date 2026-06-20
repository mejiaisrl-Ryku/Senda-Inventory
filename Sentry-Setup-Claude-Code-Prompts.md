# Sentry Installation — Claude Code Prompts
## Stack: React - Node.js - TypeScript - Prisma/PostgreSQL
### Project: kyru-advisory | Generated: June 17, 2026

---

> **How to use:** Open Claude Code in your project folder and paste each prompt in order.
> Replace placeholder values (YOUR_ORG_SLUG, YOUR_NODE_DSN_HERE, etc.) before pasting.
> Your React DSN is already filled in.

---

## PROMPT 1 — Project Audit (Run This First)

```
Please audit my project structure and tell me:

1. Is this a monorepo or are the frontend and backend in separate folders? If separate, what are the folder names?
2. What is the entry point file for the React frontend? (e.g., src/main.tsx, src/index.tsx)
3. What is the entry point file for the Node.js backend? (e.g., src/server.ts, src/index.ts, src/app.ts)
4. Is Express.js being used in the backend? If so, where is the Express app instance created and where are the routes defined?
5. Where is the PrismaClient instantiated? (e.g., src/lib/prisma.ts, src/db.ts)
6. Does a .env file already exist in the frontend? In the backend? What variables are already in them?
7. Does a .gitignore exist? Does it already include .env?
8. What package manager is being used — npm, yarn, or pnpm?

Do not make any changes yet. Just report back what you find.
```

---

## PROMPT 2 — React Frontend Sentry Setup

> YOUR REACT DSN (from kyru-advisory.sentry.io onboarding):
> https://0cc88b3440f04fc2f52bd02850b35e00@o4511580984115200.ingest.us.sentry.io/4511581029466112

```
Set up Sentry error monitoring for the React frontend of this project.

STACK: React, TypeScript, Vite (or CRA if detected)
SENTRY DSN: https://0cc88b3440f04fc2f52bd02850b35e00@o4511580984115200.ingest.us.sentry.io/4511581029466112

Steps to complete:

1. Install the Sentry React SDK:
   npm install --save @sentry/react

2. Create a new file at src/sentry.ts with:
   - Import * as Sentry from "@sentry/react"
   - Call Sentry.init() with:
     - dsn: import.meta.env.VITE_SENTRY_DSN  (read from env, never hardcoded)
     - environment: import.meta.env.MODE
     - tracesSampleRate: 1.0
     - dataCollection block with userInfo and httpBodies commented out but visible

3. In the frontend .env file (create if needed), add:
   VITE_SENTRY_DSN=https://0cc88b3440f04fc2f52bd02850b35e00@o4511580984115200.ingest.us.sentry.io/4511581029466112

4. In the frontend .gitignore (create if needed), make sure .env is listed.

5. In the React entry point file (main.tsx or index.tsx), add import "./sentry" as the very FIRST line.

6. Add Sentry.ErrorBoundary wrapper around <App /> with a fallback showing "Something went wrong".

7. Show me a summary of every file created or modified.

Do not add Session Replay or Performance Tracing yet — just Error Monitoring.
```

---

## PROMPT 3 — Node.js Backend Sentry Setup

> Get your Node.js DSN: kyru-advisory.sentry.io -> Projects -> New Project -> Node.js
> Replace YOUR_NODE_DSN_HERE below.

```
Set up Sentry error monitoring for the Node.js backend of this project.

STACK: Node.js, TypeScript, Express.js
SENTRY DSN: YOUR_NODE_DSN_HERE

Steps to complete:

1. Install the Sentry Node SDK:
   npm install --save @sentry/node

2. Create a new file at src/instrument.ts with:
   - Import * as Sentry from "@sentry/node"
   - Sentry.init() with dsn: process.env.SENTRY_DSN, environment: process.env.NODE_ENV or "development", tracesSampleRate: 1.0

3. In the backend .env file (create if needed), add:
   SENTRY_DSN=YOUR_NODE_DSN_HERE
   NODE_ENV=development

4. In the backend .gitignore, make sure .env is listed.

5. In the backend entry point (server.ts, index.ts, or app.ts), add import "./instrument" as the VERY FIRST line before all other imports.

6. Add Sentry.setupExpressErrorHandler(app) AFTER all routes but BEFORE any custom error handler.

7. Show me a summary of every file created or modified.
```

---

## PROMPT 4 — Prisma Integration

```
Add Sentry monitoring to the Prisma database layer of this project.

Requirements:

1. Find the file where PrismaClient is instantiated.

2. Add a Prisma query event listener:
   - Listens to the "query" event
   - If duration > 1000ms: Sentry breadcrumb with category: "db.query", level: "warning", message: query string, data: duration
   - If duration > 3000ms: Also Sentry.captureMessage() with level "warning" — "Slow Prisma query detected"

3. Initialize PrismaClient with log: ["query", "error", "warn"]

4. Keep the same export style already in the file.

5. Show me a diff of exactly what changed.
```

---

## PROMPT 5 — Verification and Testing

```
Help me verify that Sentry is working correctly for both React frontend and Node.js backend.

1. FRONTEND — Create src/components/SentryTestButton.tsx:
   - Button labeled "Test Sentry (remove me)"
   - onClick: throw new Error("Sentry React test — working!")
   - Comment at top: // TEMPORARY — Remove after confirming Sentry works

2. BACKEND — Add temporary route GET /sentry-test:
   - Throws new Error("Sentry Node.js test — working!")
   - Comment: // TEMPORARY — Remove after confirming Sentry works

3. Import and render <SentryTestButton /> in App.tsx with a temporary comment.

4. Tell me:
   - The URL to hit to test the backend route
   - What I should see in the Sentry dashboard
   - How to find the errors at kyru-advisory.sentry.io
```

---

## PROMPT 6 — Cleanup (After Tests Pass)

```
Sentry is confirmed working. Please clean up all temporary test code:

1. Delete src/components/SentryTestButton.tsx
2. Remove the import and usage of <SentryTestButton /> from App.tsx
3. Remove the GET /sentry-test route from the Express backend
4. Confirm no other temporary Sentry test code remains anywhere

Show me the final list of Sentry-related files that remain permanently.
```

---

## PROMPT 7 — Get Sentry Auth Token (Manual Browser Step)

> Do this manually before running Prompts 8 and 9:
>
> 1. Go to kyru-advisory.sentry.io -> Settings -> Auth Tokens
> 2. Click Create New Token
> 3. Name it: ci-deploy-token
> 4. Select scopes: project:releases and org:read
> 5. Copy the token
>
> Add to:
> - Local backend .env: SENTRY_AUTH_TOKEN=your_token
> - GitHub: Settings -> Secrets -> Actions -> New secret -> SENTRY_AUTH_TOKEN

---

## PROMPT 8 — Source Maps (Real TypeScript Line Numbers)

> Replace before pasting:
> - YOUR_ORG_SLUG (likely: kyru-advisory)
> - YOUR_REACT_PROJECT_SLUG (your React project name in Sentry)
> - YOUR_NODE_PROJECT_SLUG (your Node.js project name in Sentry)

```
Set up Sentry source maps uploading for React frontend and Node.js backend.

SENTRY ORG SLUG: YOUR_ORG_SLUG
SENTRY REACT PROJECT SLUG: YOUR_REACT_PROJECT_SLUG
SENTRY NODE PROJECT SLUG: YOUR_NODE_PROJECT_SLUG

===== PART A: REACT FRONTEND (Vite) =====

1. Install: npm install --save-dev @sentry/vite-plugin

2. Modify vite.config.ts:
   - Import sentryVitePlugin from "@sentry/vite-plugin"
   - Add to plugins: sentryVitePlugin({ org, project, authToken: process.env.SENTRY_AUTH_TOKEN, sourcemaps: { assets: "./**" }, release: { name: process.env.VITE_APP_VERSION || "dev" } })
   - Add build: { sourcemap: true }
   - Only activate plugin when SENTRY_AUTH_TOKEN is present

3. Add to frontend .env: SENTRY_AUTH_TOKEN= (blank) and VITE_APP_VERSION=1.0.0

4. Update src/sentry.ts to include: release: import.meta.env.VITE_APP_VERSION

===== PART B: NODE.JS BACKEND =====

1. Install: npm install --save-dev @sentry/cli

2. In tsconfig.json add: "sourceMap": true and "inlineSources": true

3. Create scripts/upload-sourcemaps.ts using @sentry/cli to upload maps from dist/ folder

4. Add to backend package.json: "postbuild": "ts-node scripts/upload-sourcemaps.ts"

5. Update src/instrument.ts: release: process.env.npm_package_version

===== FINAL CHECKS =====

6. Tell me: commands to test the upload, what success looks like, and how to verify in Sentry dashboard.

Show summary of every file created or modified.
```

---

## PROMPT 9 — GitHub Actions CI/CD Integration

> Same placeholder replacements as Prompt 8.

```
Set up Sentry release tracking and deployment notifications in GitHub Actions.

SENTRY ORG SLUG: YOUR_ORG_SLUG
SENTRY REACT PROJECT SLUG: YOUR_REACT_PROJECT_SLUG
SENTRY NODE PROJECT SLUG: YOUR_NODE_PROJECT_SLUG

===== PART A: CHECK EXISTING CI/CD =====

Look in .github/workflows/ and report what files exist and what they do. No changes yet.

===== PART B: DEPLOY WORKFLOW =====

1. Add to env block: SENTRY_AUTH_TOKEN: ${{ secrets.SENTRY_AUTH_TOKEN }}

2. Add step after build, before deploy:
   - name: Create Sentry Release
     uses: getsentry/action-release@v1
     env:
       SENTRY_AUTH_TOKEN: ${{ secrets.SENTRY_AUTH_TOKEN }}
       SENTRY_ORG: YOUR_ORG_SLUG
     with:
       environment: production
       projects: YOUR_REACT_PROJECT_SLUG YOUR_NODE_PROJECT_SLUG
       version: ${{ github.sha }}

3. If no deploy workflow exists, create .github/workflows/sentry-release.yml that:
   - Triggers on push to main
   - Runs on ubuntu-latest
   - Uses actions/checkout@v4 with fetch-depth: 0
   - Installs, builds, uploads source maps, creates release, marks deployed to production

===== PART C: ENVIRONMENT-AWARE CONFIG =====

4. Update src/sentry.ts: dev = tracesSampleRate:1.0 + debug:true, prod = tracesSampleRate:0.1
5. Update src/instrument.ts: same pattern

===== PART D: GITHUB SECRETS CHECKLIST =====

6. List every required GitHub secret with: exact name, where to get the value, required/optional.

Show complete content of all new or modified files.
```

---

## PROMPT 10 — Final Health Check (Run Last)

```
Do a final audit of all Sentry config across this entire project.

For each item respond with: OK, Warning, or Issue Found (with fix):

1. SECURITY — Any DSNs or Auth Tokens hardcoded in .ts/.tsx/.js/.jsx files?
2. ENV FILES — Both frontend and backend .env have required Sentry vars? All .env gitignored?
3. INITIALIZATION ORDER — Sentry import is first import in main.tsx AND server entry file?
4. ERROR HANDLERS — setupExpressErrorHandler(app) present, after routes, before custom handlers?
5. SOURCE MAPS — sourceMap:true in vite.config.ts and tsconfig.json?
6. RELEASE CONSISTENCY — Same release name in sentry.ts, instrument.ts, and GitHub Actions?
7. SAMPLE RATES — Environment-aware rates (1.0 dev, 0.1 prod)?
8. TEST CODE — Any leftover SentryTestButton or /sentry-test route?
```

---

## Quick Reference — Prompt Order

| # | Prompt | When |
|---|---|---|
| 1 | Project Audit | First — always |
| 2 | React Frontend | After 1 |
| 3 | Node.js Backend | After 1 |
| 4 | Prisma Integration | After 3 |
| 5 | Verification | After 2 + 3 |
| 6 | Cleanup | After tests pass |
| 7 | Get Auth Token | Manual, before 8+9 |
| 8 | Source Maps | After 6 |
| 9 | GitHub Actions CI/CD | After 8 |
| 10 | Final Health Check | Last — always |

---

## Your Sentry Details

- Sentry Dashboard: https://kyru-advisory.sentry.io
- React DSN: https://0cc88b3440f04fc2f52bd02850b35e00@o4511580984115200.ingest.us.sentry.io/4511581029466112
- Node.js DSN: Get from dashboard when you create the backend project
- Org Slug: kyru-advisory (verify in Settings URL)
- Auth Token: Get from Settings -> Auth Tokens (see Prompt 7)