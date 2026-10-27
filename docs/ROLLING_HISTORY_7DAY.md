# STEVE encrypted 7-day rolling HR archive (opt-in)

This is **not** the live 4-hour chart and is **not** a clinical monitoring guarantee.
It retains only accepted, authenticated actual heart-rate readings of registered
recruits, capped at one sample per approx. 7-second time bucket per slot.

## Architecture

- Existing bounded 4h/5s chart and encrypted operational snapshot stay unchanged.
- New `public.steve_hr_archive`: encrypted ciphertext per *slot, owner, UTC minute*.
- `owner` is a keyed HMAC pseudonym of the slot and current recruit code. Names,
  codes and BPM are never stored in cleartext in the archive database.
- Every 30 seconds, the server flushes only minute buckets closed for at least
  15 seconds. Unexpected exits can lose up to about 1–2 minutes of HR history.
- While the Render instance is running, cleanup occurs on startup and hourly:
  **DELETE where minute_ms < now - 7 days**. Archived reads independently filter
  to the last 7 days; no expired history is returned. When Render sleeps, the
  deletion job resumes at next startup — this is not an always-on database cron.
- New accepted HR samples do not appear during BLE disconnection, paused slots,
  unknown recruits or missing gateway packets. No interpolation.
- Reassignment deletes archive rows for the slot after queued writes and clears
  staged old readings. The live 4h chart's existing reassignment protection remains.

## Before enabling

1. Confirm that all three existing backend-only Supabase encryption settings are
   working. Check authenticated `/api/storage/status` for `write-confirmed`.
2. Apply and inspect `supabase/migrations/20261027165000_steve_hr_archive_7day.sql`
   in the owner-controlled Supabase project. Confirm RLS on and no anonymous or
   authenticated browser grants. Do **not** expose Supabase service credentials.
3. Add server-side Render environment `STEVE_ARCHIVE_ENABLED=1`, then manual
   deploy a green reviewed main commit. **Leave this off until the migration
   exists and the API's encrypted read/write path passes.**
4. Check authenticated `GET /api/archive/status`: initially read-confirmed,
   then write-confirmed after complete minutes of real accepted HR.
5. Trainer/medic only: `GET /api/archive/R01?hours=4`,
   `?hours=24`, or `?hours=168`. This is sensitive health data, so
   it is intentionally not available to gateway/legacy Viewer/presentation.
   It can be viewed even after the Band stops reporting, unlike the live-only
   4h chart.
6. Confirm the database size and free-plan limits after a 60-minute pilot,
   and test restart persistence. Do not claim data durability from `/health`.

## Limits / safety

- This is a one-process pilot. No concurrent Render replicas; an external durable
  queue/transactional event ingestion is needed before demanding lossless sampling.
- Cleanup is best-effort while awake; full strict TTL despite Render sleeping
  needs independently authorized database scheduling.
- The server never diagnoses illness, derives emergency status, or overrides
  manual WATCH/EMERGENCY. A disconnect does not indicate a healthy person.
- Secret encryption key rotation must plan migration; losing the key loses
  access to ciphertext. Implement a secure backup/recovery and data retention
  policy before use with identifiable health information.
- Never paste private recruit health data or service keys in GitHub issues,
  logs, browser URLs, public dashboard or support conversations.
