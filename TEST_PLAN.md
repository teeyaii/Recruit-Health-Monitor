# Xiaomi Smart Band 10 BLE validation

## Scope
Android or iPhone Bluefy gateway, initially 1 then 2 then 3 Xiaomi Smart Band 10 devices. The iPhone Web BLE pilot is foreground-only. Standard BLE Heart Rate Service 0x180D, characteristic 0x2A37. No ANT+.

## Before testing
- Enable Heart Rate Broadcast / Share HR on each band.
- Grant Android Nearby Devices permission; enable Bluetooth and location if needed.
- Keep Mi Fitness out of the way if it competes for the BLE connection.
- Use test IDs R01/R02/R03; never store names or medical history in GitHub.

## Acceptance
1. Receive live heart rate from R01 for 10 minutes.
2. Connect R01 and R02 concurrently and verify both update independently.
3. Extend to R03 only after 2-device success.
4. Walk with devices for 60 minutes; record disconnects, last-reading age, reconnection behavior.
5. Check screen off, app backgrounding, and radio interference.
6. Export recordings only after a separate consent and privacy review.

## Known limitations
- Foreground reconnect is bounded to three attempts; a central dashboard is implemented. Background services/restoration and durable logging are deferred.
- The scan filter assumes the band advertises standard 0x180D. If not discoverable, broaden scan only after checking identity and permissions.
- A disconnected reading is not zero. Old values are invalid.
- This is NOT a clinical heat-stroke detector. Continue WBGT controls, hydration/rest, observation and emergency protocols.

## Software gate before BLE field tests
- CI must demonstrate distinct G01/G02 bearer authorization, server-side slot/device enforcement, viewer isolation, missing reading null, context write permission, failed-login throttling, duplicate-slot startup rejection and all 15 synthetic slots via five gateways.
- Simulate disconnect, stale reading, duplicate ownership and service restart. Volatile memory reset must not falsely mark missing measurements safe.
- **Preliminary physical Band 10 tests occurred outside STEVE on 26 Oct 2026:** nRF Connect independently read 63/65 BPM from two Band 10 devices and Bluefy received streaming HR from one. No two-band Bluefy run, authenticated STEVE end-to-end upload, screen-lock reliability or medically validated use has been confirmed. CI still uses invented fixtures only.

