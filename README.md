# STEVE 1.0

**Smart Training & Exercise Vital-sign Evaluation** — prototype hybrid Android/iPhone gateway and centralized heart-rate dashboard for 15 pseudonymous recruit slots (R01–R15) and five gateways (G01–G05).

> STEVE 1.0 is a software prototype, **not** a medical device or heat-injury detector. Never treat missing measurements as zero or as evidence of safety. Continue direct human observation, WBGT/heat controls, rest, hydration and emergency procedures.

## Current verified scope
- Node.js authenticated ingest API, 15-slot snapshots, SSE dashboard, five-gateway status and duplicate active-slot guard. Backend GitHub Actions tests passed on 21 October 2026.
- Android BLE HR reader prototype; Android APK compiled previously, but no Xiaomi hardware validation.
- iOS CoreBluetooth Swift reader prototype; **not yet built or installed**.
- Gateway simulator and browser demo are synthetic; no real band or production deployment verified.
- **Implemented in this branch (source only):** separate gateway/viewer credentials, runtime slot/device provisioning validation, bounded login sessions and throttling, manual WBGT context (not a medical alarm), and standalone Android/iOS HTTPS upload helpers. Native BLE readers are **not wired** to these helpers and no hardware/production deployment has been verified.
- **Not implemented yet:** native pairing UI, BLE-to-upload wiring, production key distribution, durable history, tested reconnect/background operation and real-world field validation.

## Quick start on a computer or cloud runner
```sh
cd server
RECRUIT_MONITOR_TOKEN=replace-with-a-random-32-plus-character-secret npm start
```
Open `http://localhost:8080/live` and log in with the token. This localhost example is **only for isolated development**; use HTTPS, distinct gateway/viewer credentials, secure cookie, rate limits and retention policy before deployment with real data.

In another terminal run `RECRUIT_MONITOR_TOKEN=... node server/simulate-five-gateways.js` from repository root. Never commit credentials.

## Project files
- [Hybrid plan](docs/HYBRID_PLAN.md)
- [iOS prototype](ios/README.md)
- [Android source](android/app/src/main/java/org/recruit/monitor/MainActivity.kt)
- [Live dashboard](dashboard/live.html)
- [Simulation](server/simulate-five-gateways.js)
- [Field test plan](TEST_PLAN.md)

No third-party code has been copied into STEVE 1.0; external repositories are credited as architectural references in the hybrid plan.


## Secure synthetic integration protocol (development / test)

The authenticated contract is \`POST /api/ingest\` with a per-gateway bearer credential, for example:

\`\`\`json
{"gateway":"G01","readings":[{"id":"R01","device_id":"synthetic-device-01","hr":83,"timestamp":1792587600000}]}
\`\`\`

\`timestamp\` must be an up-to-date Unix **milliseconds** timestamp; the example above is schematic, not a live measurement. The server rejects stale/future or implausible values and never turns missing data into 0. \`device_id\` is a random, opaque local pairing ID, **not** a recruit name or a MAC address. Provision unique devices and slots separately. The approved pairing relationship is set on the server; clients cannot self-assign an arbitrary slot.

Strict mode (required for \`NODE_ENV=production\`) reads secrets from runtime environment only:

- \`STEVE_VIEWER_TOKEN\`: secret for Dashboard login, 32+ characters.
- \`STEVE_GATEWAY_TOKENS_JSON\`: e.g. \`{"G01":"<separate-32-plus-character-random-secret>"}\`. Each Gateway has a **different** credential.
- \`STEVE_SLOT_MAP_JSON\`: e.g. \`{"G01":{"R01":"synthetic-device-01"}}\`. Must contain unique slots and device IDs.
- \`COOKIE_SECURE=1\`: required in production. Deploy behind HTTPS/TLS termination and restrict ingress.
- \`NODE_ENV=production\`: fails closed without all the above.

For standalone **synthetic** developer tests only, \`RECRUIT_MONITOR_TOKEN\` enables legacy shared-token mode; never deploy it in production or use it for personnel data.

The Dashboard viewer cookie cannot write to ingest. Gateways cannot edit operator context. \`POST /api/context\` is viewer-only and accepts \`{"wbgtC":29.5}\` as **manually measured** WBGT in Celsius. \`GET /api/context\` reports missing or stale after 30 minutes; this does not assess heat injury. All data is kept only in volatile server memory and disappears on restart. No medical names, BLE identifiers, identifiable assignments or secrets may be committed.

Android \`GatewayUploader.kt\` and iOS \`GatewayUploadClient.swift\` are **unconnected transport building blocks** until an operator pairing UI and signed mobile builds exist. They intentionally do not store credentials or upload without explicit runtime setup. Continue direct human supervision, WBGT procedures and emergency protocols.

Run synthetic checks with \`cd server && npm test\`; the GitHub workflow also runs the simulated 5-gateway / 15-slot smoke test. Hardware BLE, signed iOS app, lock-screen resilience and clinical safety are **not** covered by CI.


## 10-day demonstrator: STEVE operator live simulation

**MVP focus:** show G01–G05 delivering fake BPM to 15 anonymous R-slots on a mobile-friendly dashboard. Hardware pairing, medical alarm logic and operational security hardening are later gates.

With Node.js 22+ in a trusted development environment:

\`\`\`sh
cd server
RECRUIT_MONITOR_TOKEN=demo-only-long-random-token-not-for-production STEVE_DEMO_MODE=1 npm start
\`\`\`

Open \`http://localhost:8080/live\`, sign in with the same demo-only token, then use:
- **เริ่มจำลอง 15 นาย** to inject explicitly labeled fake measurements for R01–R15.
- **จำลองสัญญาณ R03 ขาด** to freeze R03, which must become stale after 15 seconds while the other slots continue.
- **คืนสัญญาณ R03** to resume the stream.
- **หยุดจำลอง** to end updates; all old readings must become stale.
- Enter a manually measured WBGT via the dashboard when testing operator workflow (use synthetic values for demos).

Enable \`STEVE_DEMO_MODE=1\` only in an isolated test environment; demo commands are disabled under \`NODE_ENV=production\`. An iPhone can view the dashboard **after** a server is hosted over a reachable HTTPS URL. This repository does not supply a live hosted URL. A standalone synthetic-only HTML demo also exists at \`dashboard/index.html\`.

Before showing with actual wearables: complete mobile app-to-API wiring, human-confirmed pairing, physical BLE reconnection/range tests, and separate handling and consent for real data. **No actual BLE or real medical measurements were used for the demo or CI.**
