# Daily operations UX (Gateway + Live)

Baseline: `main` 4498a08 (merged #72, #73, #75). Coordination: Codex owns backend under #76. This change touches **only** `dashboard/gateway.html`, `dashboard/live.html`, UI tests and docs.
Evidence: SIMULATED (mocked Web Bluetooth, mocked HTTP). Hardware checks are listed at the end.

## Problems found in the audit (with evidence)

| # | Where | Evidence | Fix |
|---|---|---|---|
| 1 | Gateway | Three different ACK definitions. With 5 watches LIVE, readiness showed **5/5 confirmed**, cards showed "รอ Server ACK" and the header showed "รับแล้ว 2 เรือน" (`docs/ux/gateway-g02-before.png`) | The card indicator and the header now use the readiness/logger definition `slotCategory` (fresh BLE ≤ 15 s plus an ACK ≤ 15 s with no newer failure). All three agree |
| 2 | Gateway | After pairing, 5 extra "เชื่อม Rxx" buttons stayed on the daily screen | Pairing controls (quick/extra buttons, pairing guide, advanced scan/Soft Reset) are now inside **＋ จับคู่นาฬิกาใหม่ / เปลี่ยนเรือน** |
| 3 | Gateway | The "R10 — ตรวจเรือนจริง" guidance and "รอสัญญาณหัวใจใหม่" stayed visible after everything was LIVE+ACK | Cleared when every provisioned slot is LIVE+ACK; status then reads "ทุกเรือนส่งข้อมูลและเซิร์ฟเวอร์ยืนยันแล้ว" |
| 4 | Gateway | A large "ตัดการเชื่อมต่อ Rxx" button sat on every card, easy to tap by mistake | Moved into the card's "รายละเอียด". It still works (existing test) |
| 5 | Gateway | Readiness said "รอ/ไม่มี ACK" for every server problem, and the panel disappeared on 401 | Each row now names the cause, and only offers an action that can fix it (see table below) |
| 6 | Live | Roster/resolve/Medic close called `r.json()` on error, so a non-JSON 502 showed a parser error. 409 showed raw English. No "กำลังบันทึก" feedback; WBGT could be submitted twice | One `mutationFailure()` gives Thai messages per cause, says "ยังไม่ได้บันทึก", never retries a write, and tolerates HTML error pages. Save states and in-flight guards are added |
| 7 | Live | A slow private-profile save could apply R06's new version after the operator switched to R07 | The result is applied only if the same wearer is still selected |
| 8 | Live | The only way to a pending automatic case was: pick the slot in the roster dropdown, then open the Medic panel | A **เปิดรายการรอประเมิน** button on that card and in the automatic-alert list selects the slot and opens the existing Medic Review panel. It appears only when that panel is already permitted (trainer/medic with private profiles enabled) |

### Gateway readiness: cause, text and action
| Cause (observed) | Text | Action |
|---|---|---|
| Fresh BLE + fresh ACK | LIVE • เซิร์ฟเวอร์ยืนยันแล้ว | none |
| BLE fresh, no fresh ACK (503 / network / pending) | มีข้อมูลจากนาฬิกา แต่เซิร์ฟเวอร์ยังไม่ยืนยัน • ไม่ต้องจับคู่ใหม่, plus the cause when known | none (not a pairing problem) |
| Subscribed, no new BPM | เชื่อมอยู่ แต่ไม่มีข้อมูลใหม่ • ตรวจ Share HR และการสวม | เชื่อมใหม่ (existing quick-connect path) |
| Link down | นาฬิกาหลุด, plus "จะลองเชื่อมเองใน N วิ" or "ต้องกดเชื่อมใหม่" | เชื่อมใหม่ |
| 401 (Render restart / expiry) | ต้องเข้าใช้งานใหม่ • นาฬิกายังเชื่อมอยู่ ไม่ต้องจับคู่ใหม่ | login form (same Gateway) |
| 409 (slot owned elsewhere) | ช่องนี้ถูกใช้จากอีกเครื่อง • ออกจากระบบเครื่องเดิมก่อน | none |
| Not provisioned | ยังไม่ได้ตั้งค่าในเซิร์ฟเวอร์ • ติดต่อผู้ดูแล | none |

The text never guesses: anything not observed stays generic.

## Kept as is (not rebuilt)
- One connect-all button, the readiness panel, the reliability logger (optional, folded), remembered bindings/suffixes, automatic reconnect, backoff, watchdog, BLE listeners, pairing validation.
- Live cards, their order (R01–R15, stable), EMERGENCY banner prominence, automatic-alert panel, history graph, Medic Review panel and its permission, training/rest (already had 409 handling and a busy guard), and the separation of acknowledgement from case close. A note under the close button now states that closing ≠ permission to return to training.
- Commander: unchanged.
- No API changes and no backend files touched.

## Tests (SIMULATED)
- `server/daily-ux.test.js` (17):
  - G02 scope; pairing panel open on first use and folded on daily use;
  - folding the panel does not touch BLE; one ACK definition, with old ACKs never shown as confirmed;
  - 503, 401, 409 and drop causes and their actions; guidance cleanup; disconnect moved into details;
  - `mutationFailure` per status (including an HTML 502); roster 409 with a single write, latest data loaded and typed values kept;
  - network failure; slow private-profile save vs switching wearer; WBGT double submit and failure;
  - Medic close 409; Medic shortcut permission and EMERGENCY unchanged; no private fields added to Commander or the export.
- `npm test`: 258/258. The browser smokes (dashboard, gateway, commander) pass at 390 px with no overflow.
- Screenshots: `docs/ux/gateway-g02-before.png` and `docs/ux/gateway-g02-after.png` (SIMULATED G02 with 5 mocked watches, 390 px).

## Rollback
Revert the PR. Only UI files changed. No stored data or format changes; remembered pairings are untouched.

## Owner checks on real R06–R10 (after release approval)
1. Log in to G02 on the iPhone. Pairing should be **folded**, the 5 remembered watches should reconnect by themselves, and readiness should reach **พร้อมส่งข้อมูล 5/5**. The card text and the header (รับแล้ว 5 เรือน) must agree.
2. Turn off Share HR on one watch: that row should read "เชื่อมอยู่ แต่ไม่มีข้อมูลใหม่" or "นาฬิกาหลุด", and the others should show no buttons.
3. Turn off Wi-Fi/cellular for about 20 s: rows should read "เซิร์ฟเวอร์ยังไม่ยืนยัน • ไม่ต้องจับคู่ใหม่" with no pairing button. They should recover when the network returns.
4. On Live, as trainer/medic: a pending automatic case should show **เปิดรายการรอประเมิน**, which opens that wearer's Medic panel.
Simulation does not replace these checks.
