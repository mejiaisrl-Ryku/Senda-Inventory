# Sprint 1: OAuth Foundation

## Overview

Restaurants connect their Toast account to Kyru via OAuth 2.0. Tokens are stored
encrypted and auto-refresh when needed.

## What It Does

1. **Initiate OAuth** → `/api/toast/connect`
   - Returns authorization URL
   - User redirected to Toast login

2. **Handle Callback** → `/api/toast/callback`
   - Exchanges auth code for access token
   - Stores token (encrypted) in database
   - Redirects user to dashboard

3. **Check Status** → `/api/toast/status`
   - Returns connection status
   - Auto-refreshes token if expired
   - Used by frontend to show "Connected" / "Not Connected"

4. **Disconnect** → `/api/toast/disconnect`
   - Removes Toast connection
   - Clears stored tokens

## Files

| File | Purpose |
|------|---------|
| `backend/src/lib/toast-client.ts` | OAuth client (getAuthorizationUrl, exchangeCodeForToken, refreshAccessToken) |
| `backend/src/lib/encryption.ts` | AES-256-GCM token encryption/decryption |
| `backend/src/lib/toast-state.ts` | CSRF state store (Redis or in-memory fallback) |
| `backend/src/routes/toast.ts` | All Toast endpoints |
| `backend/prisma/schema.prisma` | ToastConnection model |
| `frontend/src/components/ToastConnectButton.tsx` | Connect UI (popup flow) |
| `backend/src/__tests__/toast.test.ts` | 6 tests |

## Security

- CSRF protection via OAuth state parameter (15-min TTL, single-use)
- AES-256-GCM encryption for all stored tokens (`iv:tag:ciphertext` hex format)
- Tokens never logged or exposed in responses
- Auto-refresh prevents expired token accumulation

## Tests (6/6 passing)

1. `POST /connect` returns auth URL
2. `GET /callback` with valid code stores encrypted token
3. `GET /callback` with invalid state rejects (CSRF protection)
4. `GET /status` when not connected returns `{connected: false}`
5. `GET /status` when connected returns `{connected: true, expiresAt}`
6. `GET /status` with expired token auto-refreshes silently
