# STEVE web / Render / Supabase API handoff

## Verified on 2026-10-27

- PR #33 merged as `86262a67ea8b0c5603b99fd873ce4285e2165b71`; its main backend workflow passed.
- Render `/health`, `/gateway`, `/live` returned HTTP 200. Unauthenticated `/api/operator/me` and `/api/roster` returned 401. This does not identify the deployed commit or prove persistence.
- Supabase project `qqzqcqfccowjyuvjibpm` was ACTIVE_HEALTHY. Migration `20261027074844` exists; the matching SQL is now versioned under `supabase/migrations/`.
- `public.steve_secure_state` has RLS enabled, no policies, no SELECT grant for anon/authenticated, and backend SELECT/INSERT/UPDATE privileges. Its snapshot row count was zero. No ciphertext or recruit records were retrieved.
- Security advisor: intentional INFO `rls_enabled_no_policy` for the backend-only table; performance advisor: no findings. See https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy .
- Render connector was not installed. Environment values, deployment revision, authorized live writes and restart recovery were not verified.

## Connection contract

Open the web app on the Render origin. All browser API requests are relative to that origin; no frontend Supabase key or separate cross-origin API base is needed.

| Route | Authentication | Contract |
| --- | --- | --- |
| `POST /api/login` | JSON `{token}` | Returns HttpOnly operator session cookie. Never store token in localStorage. |
| `GET /api/operator/me` | Operator cookie | Role, permissions, `durable` configuration flag. The flag alone is not write verification. |
| `GET /api/storage/status` | Operator cookie; Gateway forbidden | Metadata only: `configured`, `state`, `lastReadAt`, `lastWriteAt`. No project credentials, data or remote error body. |
| `GET /api/roster` | Operator cookie | Slots and `ephemeral` flag. |
| `PUT /api/roster/R01` | Operator cookie + same origin + JSON | `{version,code,restriction,observation}`; use current version. Successful configured-mode writes await encrypted storage. |
| `GET/PUT /api/private-profile/R01` | Trainer/medic cookie + configured storage | PUT `{version,weightKg,heightCm,conditions,confirmed:true}`. Unregistered slot: 409; disabled storage: 503; legacy Viewer/Gateway: 403. |
| `POST /api/gateway/session` | Gateway Bearer + browser origin | HttpOnly Gateway cookie; never a Supabase credential. |
| `GET /api/gateway/provision` | Gateway cookie/Bearer | Only that Gateway's anonymous device assignments. |
| `POST /api/ingest` | Gateway cookie/Bearer | `{gateway,readings:[{id,device_id,hr,timestamp}]}`; timestamp in epoch milliseconds, assigned device, fresh reading. Response `{accepted,received,request_id}`. Acceptance is live ingestion, not a per-reading database commit. |
| `GET /api/events` | Authenticated session | SSE live snapshot; not private profile data. |

Storage states: `disabled` (no config), `unverified` (configured but no completed read), `read-confirmed` (startup read/decryption succeeded, possibly empty), `write-confirmed` (a write succeeded in this process), `unavailable` (latest operation failed). Timestamps describe this process only, not continuous availability. `/health` remains a public liveness check. History checkpoints run every 30 seconds.

## Owner steps in Render

1. Preserve the current R01/R02 anonymous roster settings privately before restarting: RAM-only registrations do not automatically migrate. Keep existing Gateway tokens and `STEVE_SLOT_MAP_JSON` assignments.
2. In the existing service's **Environment**, add all three together:
   - `STEVE_SUPABASE_URL` = `https://qqzqcqfccowjyuvjibpm.supabase.co`
   - `STEVE_SUPABASE_SERVICE_ROLE_KEY` = private Supabase secret key (`sb_secret_...`, preferred) or legacy service-role JWT. Never use publishable/anon credentials.
   - `STEVE_DATA_ENCRYPTION_KEY` = independent securely generated 32 random bytes in standard Base64. Back it up securely; retain the same key across restarts. Do not replace it when ciphertext already exists.
3. Retain `NODE_ENV=production`, `COOKIE_SECURE=1`, `STEVE_VIEWER_TOKEN`, existing `STEVE_GATEWAY_TOKEN_G01` etc. (or the existing JSON token scheme), and `STEVE_SLOT_MAP_JSON`. Trainer and medic access requires both distinct 32+ character `STEVE_TRAINER_TOKEN` and `STEVE_MEDIC_TOKEN`.
4. After the PR is merged and CI passes, select the verified main commit in **Manual Deploy**. Blueprint auto-deploy is off. Do not paste secrets into this document, GitHub, chat, screenshots, URLs or browser scripts.
5. Log in, open `/api/storage/status` in the same browser: expect `read-confirmed`. Save authorized anonymous roster settings, then check for `write-confirmed` and a timestamp. Use a separate test environment for synthetic private-profile writes, not a real recruit slot.
6. Verify the encrypted row exists without opening/exporting its contents. Restart only after preserving any transient data, log in again, and verify the saved roster remains. State returns to `read-confirmed` until another write. If storage fails, do not claim persistence based on `/health` alone.

The automated integration test uses an isolated mock REST store with synthetic data to prove API encryption, role isolation and restart restoration. It is not evidence of a successful live Render-to-Supabase write or physical Band 10 stability.
