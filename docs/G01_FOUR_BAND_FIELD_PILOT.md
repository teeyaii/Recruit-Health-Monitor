# STEVE 2.0 — four Xiaomi Smart Band 10 devices on one iPhone / Bluefy G01

## Operational status (4 November 2026)
- Owner has four physical Band 10 devices and reports they are paired/connected via iPhone Bluetooth.
- **Bluetooth settings pairing is not evidence of four live Heart Rate notifications**. G01 must separately select and subscribe to each physical Band via Web Bluetooth.
- The previous physically accepted baseline was two simultaneous Band 10 units on one iPhone / Bluefy 2.01: R01=47FD, R02=A746.
- R03 and R04 are a **four-band physical pilot, not an achieved result** until device-specific fresh BPM and backend acknowledgement are confirmed. Do not claim 4/4 passed from mock tests.
- A single G01 can be provisioned with R01–R04 in the backend; no software-imposed two-band cap exists. BLE concurrency limits and reliability are hardware/runtime dependent.
- The R03/R04 historical presentation preview is **synthetic** and must never be confused with live data.

## Before connecting physical R03/R04
1. Ensure owner-authorized test setting; **do not use live safety monitoring of real recruits for the trial**. Use test volunteers, not personal health identifiers.
2. In Render, securely inspect the current `STEVE_SLOT_MAP_JSON` in the private environment. **Keep the original R01/R02 device IDs exactly unchanged**, along with other existing mappings; append two new unique opaque IDs under `G01` for R03 and R04, e.g., `trial_g01_r03` and `trial_g01_r04`. These are server-side aliases, not MAC addresses, personnel IDs or physical suffixes.
3. Do not paste keys, mappings with real identifiers or credentials into GitHub/chat. Any environment change may restart Render, briefly disconnect both working Bands, and reset RAM-only state. Back up transient configuration privately and perform only during an authorized test window.
4. Deploy a reviewed green main commit manually after the desired slot map is configured; the Render service has `autoDeployTrigger: off`. Verify `/gateway` shows the new optional R03/R04 controls after logging in to G01. If they are absent, do **not** bypass authorization: verify the current server provisioning.
5. If optional 7-day chart history is required, anonymous R03/R04 roster entries must be registered and real durable storage verified; unregistered devices may still ingest LIVE but are not saved in the archive. Do not overwrite earlier demo roster data casually: reassignment can remove existing history. No medical approval or automatic emergency detection is implied.

## Pair and prove 4/4
1. Keep Bluefy in the foreground, iPhone unlocked and charged. Disable the experimental lock-screen mode for the first 4-band concurrency test. Open the **Render-hosted** HTTPS `/gateway` page (not GitHub Pages SIMULATED demo).
2. Ensure **Share Heart Rate** is enabled on **each** Band 10 and competing BLE clients are not holding the HR-sharing connection.
3. Authenticate **G01** as Gateway. Connect **R01 (47FD)** and **R02 (A746)** as usual until both show fresh BPM plus `Server acknowledged`.
4. Tap **เพิ่ม R03**, enter **four hexadecimal characters at the end of the physical third Band's advertised name** in the expanded form, then tap `เชื่อมต่อ Band 10`. Choose the matching watch in the native chooser; do not accidentally choose R01/R02. Wait for `LIVE • Server acknowledged` while the first two stay LIVE.
5. Repeat for **R04** using the **different** fourth watch's suffix. Ensure G01 shows `LIVE BANDS 4 เรือน` and `SERVER ACK รับแล้ว 4 เรือน`. The server must show four distinct slots; each must have a fresh timestamp (<=15 seconds) and verified independent HR stream. A static Bluetooth connection indication is insufficient.
6. Run 10 minutes and then, if stable, 60 minutes with screen on and Bluefy foreground. Record network failures, BLE drops, stale >15 s, reconnection, wrong binding attempts, phone/band model, battery, charging, and coexistence with other nearby radios.
7. **Only after 4/4 foreground passes**, try the separate opt-in **ล็อกจอ** experiment for 60 seconds and observe STEVE Dashboard from another device. If fresh data stops, return to dim-screen fallback. If locked app suspends, that is a platform/runtime limit, not a device-count proof.

## Troubleshooting and stop conditions
- **R03/R04 not in menu:** backend did not provision them for G01. Do not modify secrets in source code or send real tokens in messages.
- **Empty chooser:** iPhone Bluetooth Settings pairing is not enough. Confirm active Share HR and try A Standard Heart Rate Scan, then B Broad BLE Scan.
- **Duplicate device or suffix:** do not swap assignment behind the same slot; use the correct physical watch and proper wearer mapping.
- **SERVER REJECTED, accepted!=1:** verify authorized G01 slot and matching opaque device ID, timestamp freshness, and whether roster slot is paused.
- **NO DATA >15s:** never reinterpret stale data as safe or healthy. If the test is being conducted near actual training, supervisors must rely on direct observation and established medical SOP independently.
- **Do not unpair/reformat existing two Band 10 units as a first troubleshooting step.** No 4-band physical success has yet been claimed.

## Success criteria
Four distinct physical Band 10 devices, one iPhone/Bluefy page, G01 authorized R01–R04 slots, four independent fresh BPM streams and server acknowledgments, >=10 min continuous foreground observation with no identity cross-over or false LIVE; record 60-min stability separately. Hardware tests must be reported by the operator.

## Optional no-overwrite Render provisioning (4 November 2026)
For existing working LIVE configurations where the integration **cannot read the current secret-bearing `STEVE_SLOT_MAP_JSON`**, do **not** replace the base JSON with guessed R01/R02 mappings. Instead, the backend accepts one optional additional variable:

```json
{"G01":{"R03":"trial_g01_r03_20261104","R04":"trial_g01_r04_20261104"}}
```

Set this as `STEVE_SLOT_MAP_EXTRA_JSON` on the **same** existing Render service. These strings are server-internal, unique, anonymous device aliases; they are neither Bluetooth MAC addresses nor four-character physical suffixes. Existing gateway cookies and bearer secrets remain untouched. The server validates every original and extra mapping together, fails startup on duplicate R-slot or device aliases, forbids extra-only gateways and refuses extra mapping without an original base mapping. Do not override or remove the base `STEVE_SLOT_MAP_JSON`. Never replace all Render environment variables.

The expected authorized G01 slots after redeploy are R01, R02, R03, R04. The Bluefy UI receives the aliases through authenticated provisioning. First check R01/R02 independently and ensure the backend reports fresh Server ACK for R03/R04 before attempting prolonged use. If an environment update creates an unhealthy deploy, revert only the new optional `STEVE_SLOT_MAP_EXTRA_JSON` key; the original base configuration must remain unchanged.

No change to real profiles, roster, historical measurements or clinical alerting is implied. A Render Free restart may temporarily interrupt real BLE telemetry or volatile state.

## iPhone / Bluefy field acceptance

ทดสอบนอกช่วงเฝ้าระวัง เปิดหน้า Gateway ค้างไว้และเปิด Share HR ที่เรือนเป้าหมาย กดปุ่มของช่อง ตรวจชื่อที่ลงท้ายตามปุ่ม หากรายการว่างให้ลองสแกน B หากมีเพียงรหัสยาวให้ยกเลิก แม้เปิด Share HR ทีละเรือนก็ยังอาจพบอุปกรณ์ใกล้เคียงได้ ห้ามเดาจากลำดับหรือ BPM

รอให้แต่ละช่องแสดง BPM สดและ Server ACK จนครบสี่ช่อง หยุดเฉพาะ R03 ตรวจว่าอีกสามช่องยังส่งข้อมูลต่อ จากนั้นเชื่อม R03 และรอ ACK ใหม่ ทดสอบยกเลิก chooser, ขาดเครือข่าย, กลับจากพื้นหลังและโหลดหน้าใหม่แยกกัน หลังโหลดใหม่ให้แตะเลือกชื่อเรือนอีกครั้ง เมื่อขาดข้อมูลต้องเห็น NO DATA

ทดลองต่อเนื่อง 10 นาที แล้ว 60 นาที บันทึกเวอร์ชัน iOS/Bluefy จำนวนช่องที่ได้ ACK และระยะขาดข้อมูลแยกรายช่อง หยุดทดสอบเมื่อมีการผูกผิดช่องหรือแสดงข้อมูลเก่าเป็น LIVE ห้ามบันทึกรหัสอุปกรณ์หรือข้อมูลผู้สวมใส่ในรายงาน


## UUID-only Bluefy native picker — guided safe flow (5 November 2026)

When Bluefy lists UUID-shaped entries rather than the physical suffix, the web page **cannot change the native chooser's labels or expose the full list to JavaScript**. The R01–R04 quick buttons now automatically select supervised Broad enrollment for new devices, so the operator does not have to find Scan D in advanced settings.

1. **Before tapping the quick button**, isolate the physical target band, reduce competing nearby BLE advertisements, and keep other bands out of range when practical. Merely turning off Share HR on other bands may not remove them from Bluefy's chooser. Never identify a watch by UUID order or by an unrelated heartbeat.
2. Tap R01=47FD, R02=A746, R03=1121, or R04=CD42. If a specific advertised device name visibly matches the suffix, it is checked as before. If the selected JavaScript name is empty, `Xiaomi`, or UUID-shaped, STEVE enters a **quarantined physical off/on check**. The selected watch is not yet authorized for ingestion.
3. To complete quarantine, observe a fresh local HR notification, **turn off Share HR on that exact physical band**, tap the on-screen check button, and wait at least 15 seconds without notifications. Tap to continue, **turn Share HR on for the same band**, wait for a fresh notification, and explicitly confirm the physical identity. Only subsequent readings may upload; require fresh `Server acknowledged`.
4. If the operator cannot confidently isolate which physical watch matches the selected entry, **cancel/stop the session; do not confirm**. Off/on signal correspondence is a useful operational check, not cryptographic proof of hardware identity.
5. For a verified same-page band, the quick reconnect first reuses the saved in-memory handle, preventing unnecessary rescans. Reload/new phone requires independent identity verification and native user-gesture pairing. Foreground, unlocked iPhone remains required in ordinary use.

Test wrong-device choices, cancelled chooser, GATT disconnect during quarantine, other active bands' independent live streams, and 10-minute/60-minute uninterrupted field operation before any production merge. Do not use this as a validated medical safety alarm.


## One-tap connect all remembered watches (5 November 2026)

The Gateway now shows **เชื่อมทุกเรือนที่จำไว้ (N/M)**. For G01, owner-confirmed physical suffixes are R01=47FD, R02=A746, R03=1121, R04=CD42. R05 has no assumed suffix; it must be entered and physically verified on first enrollment, and the server must provision R05.

**First enrollment:** Tap each R-slot once, select the correct device in Bluefy, and finish the named-suffix check or supervised physical Share HR off/on verification when the native chooser shows only UUIDs. Wait for new BPM and Server acknowledged. Only verified browser handle IDs, suffix and matching server-side anonymous slot alias are recorded in origin-local browser storage. No Gateway secrets, HR samples or patient identifiers are saved. Records persist after Gateway logout but are not synced to another phone.

**Subsequent uses:** While the Bluefy page stays open, press **เชื่อมทุกเรือนที่จำไว้** to reconnect verified watches using in-memory handles. After page reload, the Gateway restores slot aliases and uses navigator.bluetooth.getDevices() to retrieve previously permitted exact handles. If the browser supports it and permissions persist, the button connects all available verified watches *sequentially*, then they stream concurrently. Missing watches are reported by R-slot and others remain connected. Require fresh BPM + server ACK for LIVE.

**Platform limitation:** Some Bluefy releases / iOS permission situations do not support getDevices() or may revoke permissions. The page cannot silently grant Bluetooth access or infer which UUID belongs to which watch. If a handle is missing or changed, report that the one R-slot requires manual pairing; never choose another by row order. The user may need to update Bluefy to a release supporting getDevices. Only the same HTTPS origin and phone can reuse permissions.

**Acceptance:** Validate (a) 4-watch reconnect from one button in a single page, (b) reload with granted devices where getDevices exists, (c) R05 only if provisioned and physically verified, (d) 10/60-min continuous HR + ACK, (e) no false LIVE or cross-slot identity, (f) single-slot dropout leaves healthy peers live. Keep Bluefy foreground and iPhone awake.
