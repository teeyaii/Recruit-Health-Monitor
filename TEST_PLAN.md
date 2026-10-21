# Xiaomi Smart Band 10 BLE validation

## Scope
Android 1 phone, initially 1 then 2 then 3 Xiaomi Smart Band 10 devices. Standard BLE Heart Rate Service 0x180D, characteristic 0x2A37. No ANT+.

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
- This prototype does not implement automatic reconnect, background foreground-service monitoring, durable logging, or central dashboard.
- The scan filter assumes the band advertises standard 0x180D. If not discoverable, broaden scan only after checking identity and permissions.
- A disconnected reading is not zero. Old values are invalid.
- This is NOT a clinical heat-stroke detector. Continue WBGT controls, hydration/rest, observation and emergency protocols.
