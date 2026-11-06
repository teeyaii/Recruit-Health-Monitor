# Handoff: STEVE 1.0 → next phase (for planning)

> **Current update — 6 Nov 2026:** main/live baseline for this audit is `0169626` (#78/#79 included). Current owner test set is **5 watches R06–R10**, not a current ten-watch hardware validation. Earlier results below are historical. The owner skipped 60 minutes; do not restart that gate for offline development. See [Issue #76 audit](ISSUE_76_CASE_LIFECYCLE_QA.md) and [AI proposal awaiting approval](STEVE_AI_CLAUDE_PROPOSAL.md).


Date: 5 Nov 2026 · Repository: `teeyaii/Recruit-Health-Monitor` · Render service `steve-1-0-live-gateway` (auto-deploy **off**, manual deploys only).

Read this file first, then `docs/STEVE_RELIABILITY_10BAND.md` for root-cause detail and Issue #50 for the 10-band target.

## 1. Current state

| Item | Value |
|---|---|
| `main` = Render live | `97169b4` (PR #67), deployed 08:07 UTC |
| Rollback targets | `f2c1787` (#66), `ea0174b` (#65), `3d47023` (pre-reliability baseline) |
| Merged in this phase | #65 reliability + 10-band readiness (supersedes #64), #66 periodic reconnect + auto-reconnect after login, #67 no parked STALE + advertisement-first reconnect + chooser fallback |
| Closed | #64 (its content is in #65) |
| Open | Issue #50 (10 watches across 2 physical gateways) |
| CI | `test`, `dashboard-browser`, `docker-smoke` green on every merged PR. `npm test` = 191 tests |

## 2. Verified on hardware (owner-reported, iPhone + Bluefy, Xiaomi Smart Band 10)

- **4 watches on one iPhone (G01):** R01=47FD, R02=A746, R03=1121, R04=CD42.
- **Recover by themselves, no re-pairing:**
  - Share HR off/on for 30 s.
  - Watch carried out of range for about 3 min and back.
  - Render restart followed by re-login.
  - Page reload followed by login (remembered watches reconnect automatically).
- **Earlier baseline (27 Oct):** 2 watches with server ACK, foreground recovery, Dashboard LIVE / NO DATA.

## 3. NOT yet verified (do not assume)

- 5 watches on one iPhone (R05: physical suffix unknown).
- Endurance: 10-minute and 60-minute runs with drop counts per watch. No measured numbers exist yet.
- Field conditions: movement during training, body shielding, radio congestion.
- Second physical gateway G02 (R06–R10), and 5+5 streams at the same time on one backend.
- Whether Bluefy supports `watchAdvertisements` (the Gateway now displays this; nobody has recorded it yet).
- iOS background BLE: **not supported**. Bluefy must stay in the foreground with the screen on.

## 4. Architecture pointers

- `dashboard/gateway.html` holds the whole Bluefy Web BLE gateway in one file. Key parts:
  - `connectBand` (mode `standard` / `broad` / `supervised` / `auto` / `autoLookup` / `known`)
  - `recoverKnown`, `scheduleDueRecovery` (backoff 5/10/20/40/60 s, cap 20 per 10 min)
  - silent-stream repair (`SOFT_REPAIR_MS` 25 s re-subscribe, `HARD_REPAIR_MS` 45 s reconnect)
  - `waitForAdvertisement` (6 s, best effort)
  - `holdForServerLogin` (on 401, keep BLE and stop uploads)
  - `connectAllRemembered`; localStorage `steve.gateway.verified-devices.v1` stores only browser handle IDs, never tokens or BPM
- **Identity rule:** a device binds to a slot only after the name suffix matches, or after supervised Share HR off/on verification. Automatic paths never enroll unknown devices.
- `server/index.js`:
  - `/api/ingest` drops duplicate and older timestamps, rejects a cross-gateway slot or wrong `device_id`, and treats data older than 15 s as STALE.
  - Browser slot ownership is a 120 s lease (`STEVE_SLOT_LEASE_MS`); a second live phone gets 409.
  - Gateway sessions live in memory and are lost on restart; the client recovers by re-login.
- `server/contract.js`: `STEVE_SLOT_MAP_JSON` (+ `STEVE_SLOT_MAP_EXTRA_JSON`, which can only extend gateways that already exist) and per-gateway `STEVE_GATEWAY_TOKEN_G0x`.
- **Tests:**
  - `server/bluefy-lifecycle.test.js`: VM harness with fake Web Bluetooth and a fake clock.
  - `server/ten-band-two-gateway.test.js`: **SIMULATED** G01 R01–R05 + G02 R06–R10 over real HTTP.
  - `server/*-browser-smoke.cjs`: Playwright.
  - Run with `cd server && npm test`.

## 5. Hard constraints (keep)

- Never invent device identities. R05–R10 suffixes must be read from the physical watches by the owner.
- Do not change clinical thresholds, automatic alerts, Medic Review, the 7-day archive, recovery shadow, rest/training intervals or one-save reassignment.
- Missing BPM is never NORMAL, and an unresolved EMERGENCY never disappears on disconnect.
- No real identities or health data in GitHub. Secrets stay in Render and are owner-managed.
- No deploy of unverified high-risk BLE changes without the owner's approval. Keep a rollback target.
- Always label simulated results separately from hardware results.

## 6. Proposed next phases (for Codex to refine into a plan)

**Phase A: measure the current 4-watch baseline (no code changes)**
- 10-min and 60-min runs on G01 with 4 watches, and a short field movement test.
- Record per-watch drop count, recovery time, % time LIVE+ACK, and the "รายละเอียด" diagnostics line.
- Record the "ความสามารถเบราว์เซอร์" line (getDevices / watchAdvertisements).
- Acceptance: numbers recorded in `docs/STEVE_RELIABILITY_10BAND.md`.
- Optional helper: a small on-page session log (counts and timestamps only, no BPM history), exportable by the operator.

**Phase B: 5th watch on G01**
- Owner reads the R05 suffix from the watch and confirms R05 is in the G01 slot map.
- Pair with "เพิ่ม R05" (suffix entered once), then repeat Phase A with 5 watches.
- Acceptance: 60 min at 5 watches with no permanent loss. If it fails, record the stable maximum per iPhone and size the gateways from that number (Issue #50).

**Phase C: second gateway G02 (R06–R10)**
- Render (owner):
  - add `STEVE_GATEWAY_TOKEN_G02`;
  - add G02 with R06–R10 opaque IDs to `STEVE_SLOT_MAP_JSON` (EXTRA cannot add a new gateway);
  - manual deploy.
- Pair the second iPhone, then run 5+5 at the same time while watching the dashboard/Commander for wrong-wearer association, duplicates and stale values shown as LIVE.
- Acceptance: both gateways LIVE+ACK for 60 min, and correct STALE isolation when one phone is closed.

**Phase D: operational hardening (candidates)**
- Gateway battery/thermal guidance.
- Optional durable gateway sessions, so a Render restart needs no re-login.
- Commander-facing per-gateway health.
- A hosting plan beyond Render Free for live operations.

## 7. Known risks / open questions

- Render Free sleep and restarts: uploads pause until re-login (BLE survives).
- Bluefy-specific Web Bluetooth behaviour is undocumented. Every BLE change needs a hardware check on the owner's iPhone before it is relied on.
- `watchAdvertisements` support is unknown; the code falls back to connecting directly.
- 5 links per iPhone is unproven.
