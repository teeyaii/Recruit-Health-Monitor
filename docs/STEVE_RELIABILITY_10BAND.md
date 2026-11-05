# STEVE 1.0 — Reliability recovery and 10-band readiness

Status: **code and simulated tests only. No iPhone/Bluefy hardware verification of these changes yet.**
Baseline audited: `main` = Render live = `3d470236b9659e78b4f9e6177a7c0991379b766c`, Render auto-deploy off. Builds on PR #64.

## Root causes found in `dashboard/gateway.html` and `server/index.js`

| # | Symptom | Cause (evidence) | Fix |
|---|---|---|---|
| 1 | All watches drop when pairing a new one | `pagehide` called `suspend()` even while the native Bluefy chooser was open; `finishChooser()` also suspended if the page was hidden | From PR #64: chooser-aware `pagehide`/`finishChooser` |
| 2 | Healthy watch disconnected every ~20 s | Silent-stream watchdog forced a full GATT disconnect after 20 s of HR silence (Band 10 pauses HR briefly) | Two tiers: after 25 s, re-arm notifications on the **same** link; after 45 s, reconnect that slot only (max 2 per silence) |
| 3 | Broad Scan (B) "finds" the watch but always rejects it | UUID-only/`Xiaomi` names were quarantined only in mode D; A and B rejected them as "wrong suffix" | Standard, Broad and supervised scans all route an unverified generic device to the same off/on verification quarantine. Automatic modes never enroll unknown devices |
| 4 | Slow operator → "TimeoutError", must tap twice | Native chooser bounded at 20 s | Chooser 60 s; GATT steps 12 s, so one dead watch blocks recovery for at most about 25 s rather than minutes |
| 5 | Flapping watch reconnects forever | Disconnect-driven `recoverKnown` had no budget | Per-slot sliding budget: 6 automatic recoveries per 10 min, then "กดเชื่อมต่อใหม่". A manual tap resets it |
| 6 | Render restart/redeploy kills every BLE link and pairing | Gateway sessions are in memory; first 401 called `expireSession()` → stopped all watches, cleared bindings | On 401, BLE stays connected, uploads stop, and nothing shows as server-ACKed. A same-Gateway re-login resumes the existing streams without re-pairing |
| 7 | Replacement phone locked out for up to 10 h | Browser slot owner lasted until session expiry | Owner lease refreshed by each accepted packet; another session can take over after 120 s of silence. Two live phones still get 409 |
| 8 | G02 (R06–R10) had no usable buttons | UI hard-coded R03–R05 | Buttons/reserved cards come from the server's provisioned slots. Unknown suffixes are never invented; the operator reads them from the watch once |

Verified unchanged: EMERGENCY stays shown while stale/disconnected (`dashboard-status.test.js`), and missing BPM gives `unavailable`, never `normal`. Clinical thresholds, Medic Review, the archive and recovery shadow are not modified. The lock-screen/dim experiment remains removed (`web-gateway.test.js`).

## Automated evidence (simulated, not hardware)

- `server/bluefy-lifecycle.test.js`: four independent sessions, failed-watch isolation, chooser interruption, scan-mode consistency (A/B/D), no listener accumulation over 5 reconnects, bounded flapping budget, 401 → re-login resume, G02 R06–R10 provisioning.
- `server/ten-band-two-gateway.test.js`: real HTTP backend, G01 R01–R05 + G02 R06–R10 publishing concurrently (200 requests), latest BPM per slot, duplicate/older drop, cross-gateway and wrong-device rejection, 409 for a second live phone, stale isolation when G02 goes silent, takeover by a replacement phone, backend restart → 401 → re-login.
- `server/gateway-browser-smoke.cjs`: Chromium with mocked Web Bluetooth.

## Hardware tests still required (owner iPhone + Bluefy)

1. **Two watches regression** (R01 47FD + R02 A746): pair, both LIVE + ACK for 10 min.
2. **Pairing while live**: R01, R02 LIVE → pair R03 1121 → R01/R02 must stay LIVE (no reconnect).
3. **Broad scan B**: on a UUID-only entry, B must start the off/on check rather than an error.
4. **Silence**: turn off Share HR on R01 for 30 s → card NO DATA, other watches unaffected; turn on → resumes without the chooser.
5. **Out of range**: walk R02 away for about 1 min → NO DATA → returns → automatic reconnect.
6. **Backend restart**: Render "Restart service" during streaming → Gateway shows "เข้าใช้งานใหม่", watches stay connected; log in → LIVE + ACK, no re-pairing.
7. **Increment 3 → 4 → 5** watches on one iPhone, 10 min each, then 60 min at the highest stable count. Record drops per watch.
8. **Second phone G02** with R06–R10 only after step 7 passes.

Five watches per iPhone is **not** assumed stable until step 7 passes.

## Remaining blockers for 10-band operation

- Physical proof of 3–5 simultaneous Band 10 links on one iPhone/Bluefy (Issue #50).
- R05–R10 Band name suffixes are unknown: the owner must read them from the physical watches. Never guess.
- Render: G02 needs `STEVE_GATEWAY_TOKEN_G02` and R06–R10 in the slot map (`STEVE_SLOT_MAP_EXTRA_JSON` can only extend existing gateways, so G02 must be in `STEVE_SLOT_MAP_JSON`). Owner-managed secret change.
- Render Free can sleep or restart. Mitigated by (6), but not suitable as the sole live-operations host.
- iOS background BLE is not supported in Bluefy: screen must stay on with Bluefy in the foreground.
