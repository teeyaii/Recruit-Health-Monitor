# Gateway session reliability logger + technical readiness (Issue #70)

Status: **software only, SIMULATED with mocked Web Bluetooth.** No physical watches were used. 60-minute real-hardware validation: **PENDING**.

## 1. Technical readiness panel (`dashboard/gateway.html`)

The panel sits under the single **เชื่อมทุกเรือนที่จำไว้** button and lists every planned or provisioned slot of the logged-in Gateway only (G01: R01–R05, G02: R06–R10, plus any R11–R15 provisioned). Each row shows:

| State | Meaning |
|---|---|
| LIVE • Server ACK | BLE BPM ≤ 15 s old **and** a server ACK for a measurement ≤ 15 s old, with no newer upload failure |
| LIVE จากนาฬิกา • รอ/ไม่มี Server ACK | BLE is fine, but the server has not acknowledged (network, Render or session problem) |
| เชื่อมอยู่ แต่ไม่มีข้อมูลใหม่ (NO DATA) | link is subscribed, but no BPM for over 15 s |
| ยังไม่เชื่อม / หลุด (NO DATA) | no subscribed link |
| ยังไม่ได้ตั้งค่าในเซิร์ฟเวอร์ | the slot is planned but not provisioned; there is no action |

- **Summary:** "พร้อมส่งข้อมูล x/N", where N is the number of provisioned slots.
- **It is labelled as connectivity only.** It is **not medical clearance and not "safe to train".**
- **Per-row "เชื่อมใหม่" / "เพิ่ม Rxx"** reuses the existing quick-connect / enrollment path. Pairing and identity rules are unchanged.
- **Rows are built once and updated in place,** so a tap is never lost to a re-render.

## 2. Session reliability logger

The logger lives in the folded panel **บันทึกความเสถียรของรอบทดสอบ**.

- **Labelling:**
  - The operator must pick a label before starting: **SIMULATED** or **HARDWARE_OBSERVED**.
  - HARDWARE_OBSERVED also requires ticking a box confirming that a person is with the real watches for the whole session.
  - The label is locked while recording.
- **Sampling:** once per second, while the page is visible, each slot is classified as `LIVE_ACK`, `LIVE_NO_ACK`, `BLE_NO_DATA` or `DISCONNECTED`.
- **NOT_OBSERVED time** (page hidden, suspended, reloading, or more than 2.5 s between ticks) is excluded and counted separately. It is never treated as success or failure.
- **Per slot, the logger records:**
  - seconds in each state and `coveragePct` (`null` if the slot was never observed);
  - observed drops, recoveries with median and max duration, and recoveries spanning a gap (`crossedGap`);
  - whether the slot was still down at the end, and time to first `LIVE_ACK`;
  - BLE disconnect events (counted even when the reconnect was faster than the 1 s sampling);
  - automatic and manual connect attempts, server ACK failures, and 409 ownership conflicts.
- **Per session:** label, Gateway ID, start/end time, elapsed / observed / not-observed seconds, gaps, and authorized vs unauthorized Gateway seconds.
- **Export:**
  - JSON or CSV, through a download, plus a read-only text box to copy from, because Bluefy may block downloads.
  - Every export carries `hardwareSixtyMinuteValidation: "PENDING"`, the definitions and the observation boundaries.
- **Persistence:**
  - The running log is kept in this browser's localStorage (`steve.gateway.session-log.v1`) so a reload does not lose it.
  - The reload gap is recorded as NOT_OBSERVED.

### Privacy checklist (enforced by tests)
- [x] No BPM or heart-rate values, wearer names or codes, opaque device aliases, watch suffixes, BLE IDs or tokens in exports or in storage.
- [x] Only slot IDs (R01–R15), the Gateway ID (G01–G05), timestamps and connection categories are stored.
- [x] Nothing is uploaded. Data leaves the phone only when the operator exports or copies it.
- [x] The logger does not change uploads: ingest payloads are identical with and without logging (tested).

## 3. Tests (all SIMULATED)

- **`server/gateway-session-logger.test.js`:**
  - state categories, including an old ACK, a failed upload, a server rejection and a pairing quarantine;
  - gap and hidden accounting, drops and recoveries, crossed gaps and unrecovered slots;
  - export privacy;
  - 5 mocked G01 watches, with R03 drop and automatic reconnect while peers stay untouched;
  - a multi-second drop with measured recovery;
  - a server ACK outage classified as LIVE_NO_ACK;
  - the HARDWARE_OBSERVED confirmation rule;
  - a reload during a session;
  - readiness rows, the stale state and retry without the chooser;
  - two gateways G01 + G02 each limited to their own slots;
  - identical uploads with and without the logger.
- **`server/gateway-browser-smoke.cjs`:** Chromium check of the readiness rows, the logger start/stop/export and anonymity, with no horizontal overflow at 390 px.

## 4. Risks and rollback

- **UI only.** No server, clinical, Medic Review, alert, archive or roster code is touched.
- **localStorage can be cleared by the browser.** If so, the in-progress log is lost, but pairing is not affected.
- **Rollback:** revert the PR. Stored logs are inert data under a separate key.

## 5. Field soak procedure (HARDWARE, to be done by a person)

1. On each gateway phone (G01, then G02), log in and wait until the readiness panel shows **พร้อมส่งข้อมูล 5/5**.
2. Open **บันทึกความเสถียรของรอบทดสอบ**, choose **HARDWARE_OBSERVED**, tick the confirmation, then tap **เริ่มบันทึก**. Keep Bluefy in the foreground with Auto-Lock set to Never.
3. Run for 60 minutes. Note any deliberate events (walk-outs, Render restart) with their times.
4. Tap **หยุดบันทึก**, then **ส่งออก JSON**. If the download is blocked, copy the text box.
5. Attach both JSON files to Issue #50 and review `coveragePct`, `drops`, `recoveryMaxSeconds`, `notObservedSeconds` and `serverAckFailures` per slot. Only after this review may the 60-minute validation move from PENDING.
