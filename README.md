# STEVE 1.0

**Smart Training & Exercise Vital-sign Evaluation** — prototype hybrid Android/iPhone gateway and centralized heart-rate dashboard for 15 pseudonymous recruit slots (R01–R15) and five gateways (G01–G05).

> STEVE 1.0 is a software prototype, **not** a medical device or heat-injury detector. Never treat missing measurements as zero or as evidence of safety. Continue direct human observation, WBGT/heat controls, rest, hydration and emergency procedures.

## Current verified scope
- Node.js authenticated ingest API, 15-slot snapshots, SSE dashboard, five-gateway status and duplicate active-slot guard. Backend GitHub Actions tests passed on 21 October 2026.
- Android BLE HR reader prototype; Android APK compiled previously, but no Xiaomi hardware validation.
- iOS CoreBluetooth Swift reader prototype; **not yet built or installed**.
- Gateway simulator and browser demo are synthetic; no real band or production deployment verified.
- **Not implemented yet:** native Android/iOS upload to backend, secure provisioning per gateway, device-to-slot mapping, durable history, tested reconnect/background operation and real-world field validation.

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
