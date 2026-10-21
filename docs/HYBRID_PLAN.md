# Hybrid gateway implementation plan

## Fixed scope
- 15 anonymous recruit slots R01–R15, up to five gateways G01–G05.
- Any mix of Android and iOS gateways; each gateway speaks the same JSON API.
- Per-phone BLE concurrency is **unknown** and must be measured, not inferred from Bluetooth version.
- Browser dashboard can run on iPhone independently of gateway hardware.
- Never store names, medical histories, BLE MAC addresses, or live health data in GitHub.

## Implementable before buying devices
1. Standardize wire contract and fixtures for 5 gateways.
2. Add native iOS CoreBluetooth proof-of-concept for service 0x180D and characteristic 0x2A37.
3. Build cloud CI and a mock five-gateway load test.
4. Improve Android device-to-recruit mapping and reconnection; test with mock events.
5. Replace shared token with separate gateway and viewer credentials before using real health data.
6. Add data retention, HTTPS, operational runbooks and outage warnings.
7. Verify dashboard under expired/stale/missing data, duplicate IDs and gateway disconnects.

## Hardware validation gates
- Xiaomi Smart Band 10 HR share enabled and visible to CoreBluetooth / Android BLE.
- Test 1, 2, 3, 4, 5+ simultaneous bands per phone; record model, OS, scan visibility, notification rate, disconnections, battery, screen locked/background.
- Verify BLE device identity remains stable, or implement explicit human pairing workflow.
- Field tests include range, interference, heat, charging and fail-safe stale indicators.
- Do not declare medical suitability; continue WBGT monitoring and human supervision.

## Open-source references (research only; no third-party code copied)
- https://github.com/Tnze/miband-heart-rate — Xiaomi Band 10 broadcast logic, check LICENSE before reuse.
- https://github.com/Xianggeok/xioami_heart_rate — Apache-2.0 project, MIT-origin HR reader.
- https://github.com/AnatoliiChub/HRAM — MIT Kotlin Multiplatform architecture, iOS/Android.
- https://github.com/burakyalti/realtime-heart-rate-monitor — MIT Android/backend/SSE pattern.
- https://github.com/VishnuMavawala/BLE-Connection-Flow — MIT Swift CoreBluetooth lifecycle.

Decision: implement a small native Swift BLE gateway rather than port an entire unrelated app. Preserve upstream notices if actual source is later copied.
