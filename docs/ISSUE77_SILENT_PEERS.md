# Issue #77: G02 R06 streams, R07–R10 connected but silent

Owner report (6 Nov 2026, real watches): only R06 delivered data; R07–R10 looked connected with no data until Bluetooth and the app were restarted. The SHA and the order of actions at the time are unknown.

## Proven vs not proven

| Claim | Status |
|---|---|
| The page could issue GATT operations (stop/startNotifications) for several slots **at the same time** during silent-link repair | **Proven in simulation** (baseline: 3 concurrent ops; `server/silent-peers.test.js` test 2) |
| The readiness view could not tell "connected but never received data" from other no-data states | **Proven** (baseline fails test 8) |
| Concurrent GATT ops are the real cause on Bluefy/iOS | **NOT proven.** It is a plausible hypothesis only, because the shared Bluetooth stack may serialize badly. It needs the owner's hardware check |
| "BLE ready resets the retry budget, so pacing is ineffective" (lead in the issue) | **Not demonstrated.** Baseline pacing in the simulation was identical to the fix (gaps 46→106 s). The code was still changed so that "ready" no longer counts as recovery |
| A server failure (401/503/network) starts a Bluetooth repair | **Not reproduced.** Baseline already passed; kept as a regression test |

## Changes (`dashboard/gateway.html` only)

1. **`bleExclusive()`** is a FIFO queue. All page-issued GATT operations (connect, service, characteristic, start/stopNotifications) run one at a time, and each is bounded at 12 s. A hung operation releases the queue at its timeout, so one watch cannot starve the others. Queued work for a closed or replaced session is dropped. The native chooser is not queued, because it needs the user gesture.
2. **Re-subscribe** has an in-flight marker per slot. It is never started during connect-all or recovery, or while that slot already has a repair running. The tier-1 re-subscribe (same device, same characteristic, no identity change) now also applies to a paired but not-yet-verified link. The tier-2 reconnect still requires a verified binding.
3. **"Ready" counts as BLE setup only.** The failure history is reset by the first valid HR sample, not by `ready`.
4. **Connect-all is refused while automatic recovery is running,** so two loops never compete.
5. **Readiness detail** now shows "ยังไม่เคยได้รับข้อมูลหลังเชื่อม" or "กำลังสมัครรับข้อมูลใหม่" for silent links. Server problems keep "เซิร์ฟเวอร์ยังไม่ยืนยัน • ไม่ต้องจับคู่ใหม่".

Unchanged: pairing and identity validation, remembered bindings, backoff values, the watchdog thresholds (25 s / 45 s), G01 support, the server, and clinical logic.

## Regression evidence (SIMULATED, mocked Web Bluetooth)

`server/silent-peers.test.js`, before → after the fix:

| # | Test | Baseline `be23c09` | Fix |
|---|---|---|---|
| 1 | Reproducer: R06 streams, R07–R10 ready but silent | reproduces | reproduces (scenario) |
| 2 | No overlapping GATT ops | **FAIL (3 at once)** | pass (≤1) |
| 3 | Peers recover one by one; R06 stays fresh and ACKed and is never re-subscribed | pass | pass |
| 4 | A hung R07 does not block R08–R10 | pass | pass |
| 5 | A never-delivering link is bounded and increasingly spaced | pass | pass |
| 6 | 401/503/network with fresh BLE → no BLE operations | pass | pass |
| 7 | Connect-all refused during recovery | pass | pass |
| 8 | Readiness says "never received data" | **FAIL** | pass |
| 9 | All five silent, staggered first HR → all recover, serialized | — | pass |
| 10 | Disconnect during re-subscribe; one listener; one upload per sample | — | pass |

Full suite: 268/268. Browser smokes (dashboard, gateway, commander) pass.

## Limits
- This cannot prove a fix on real iOS/Bluefy. If the OS Bluetooth stack itself is wedged, a Bluetooth or app restart may still be needed. That should now be the exception and must not be the normal workflow.
- Rollback: revert the PR. No data or storage format changes.

## Owner check (after a separately approved deploy), using the already-paired R06–R10
1. Open Gateway in Bluefy and log in to G02. Do **not** toggle Bluetooth or restart the app.
2. Wait up to about 2 minutes. Readiness should reach **พร้อมส่งข้อมูล 5/5**. A watch that is still silent shows "ยังไม่เคยได้รับข้อมูลหลังเชื่อม" or "กำลังสมัครรับข้อมูลใหม่"; it should then recover by itself while R06 stays LIVE.
3. If one watch stays silent after about 2 minutes, tap its row's **เชื่อมใหม่**, still without restarting Bluetooth. Note which watch it was and what "รายละเอียด" shows.
4. Repeat on the next morning start-up, since that is when the fault was reported.
