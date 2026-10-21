# STEVE 1.0

**Smart Training & Exercise Vital-sign Evaluation** — foreground Android/iPhone BLE gateway prototype for 15 anonymous slots (R01–R15) and five gateways (G01–G05).

[Open the iPhone demonstration](https://teeyaii.github.io/Recruit-Health-Monitor/) · [Deploy LIVE backend on Render Free](docs/RENDER_FREE_SETUP.md) · [Phone setup](docs/MVP_SETUP.md) · [API](server/README.md) · [Hardware validation](TEST_PLAN.md)

The published demonstration uses **SIMULATED** data only. Its existing design is preserved. Open it in iPhone Safari and press **เริ่มจำลอง**. No app, band, or backend is required.

**New prototype:** the public iPhone demo now includes [editable fictional recruit profiles and operator-observed alert states](docs/PROFILE_ALERTS_MVP.md). Use invented DEMO- codes, simulated weights/heights/conditions and selected symptoms only. A change of occupant invalidates prior readings and alerts. This UI does **not** persist data, send push notifications, score medical risk automatically or alter the separate Render LIVE backend. Never type real recruit identifiers or health information into the public demo.

STEVE is not a clinically validated medical device or heat-injury detector. Missing measurements are unknown, never zero or evidence of safety.

## Implemented

- Android Kotlin and iOS CoreBluetooth: scan standard 180D devices, select one, explicitly assign a provisioned slot and opaque device ID, subscribe to 2A37 notifications, decode 8/16-bit BPM, and upload to HTTPS.
- Runtime gateway URL/G01–G05/credential configuration. Credentials and pairings are memory-only.
- Duplicate local slot/device rejection; server-side slot/device/gateway enforcement. Discovery order never identifies a recruit.
- Three controlled reconnect attempts per pairing session, explicit Retry, 12-second connection/subscription timeout. Foreground operation only: leaving the app disconnects devices.
- Bounded upload work, at most three attempts with original timestamps, stale queue expiry, and acknowledgement checking. No replay of offline history as fresh data.
- Live dashboard SSE updates, NO DATA / STALE / DISCONNECTED states, gateway connectivity, last measurement time, and manual WBGT.
- Backend drops duplicate/older timestamps and measurements older than 15 seconds. Disconnect events clear current BPM without falsifying the last measurement timestamp.
- Strict viewer/gateway credentials, runtime provisioning, in-memory data only.
- Synthetic HTTP → backend → SSE → dashboard integration test covering all 15 slots and five gateways, failures, recovery and incorrect assignments.
- GitHub Actions Android tests/debug APK artifact and hosted macOS iOS simulator build plus Swift packet/assignment fixtures.
- Root Dockerfile and optional Render Free Blueprint with generated per-Gateway secrets, production-mode startup integration tests and manual phone deployment guide. **No live backend has been deployed or account configured.**

## Verification boundaries

Native compilation and synthetic tests do not validate physical Bluetooth, Xiaomi firmware compatibility, background reliability, multi-band capacity, or medical suitability. The iOS simulator build is unsigned and cannot be installed on an iPhone. See [setup](docs/MVP_SETUP.md) for signing and hosting requirements.

CI includes previous native BLE compilation, synthetic end-to-end tests and Docker deployment checks. Native compilation is not proof of a physical Bluetooth connection. Check current GitHub Actions results for the latest commit.

## Synthetic backend demo

With Node.js 22 in a trusted temporary/cloud development environment:

```sh
export RECRUIT_MONITOR_TOKEN='choose-a-random-32-plus-character-test-secret'
export STEVE_DEMO_MODE=1
node server/index.js
```

Open `http://localhost:8080/live`, log in with that test secret, and use the simulation buttons. R03 and G03 loss are supported; Restore resumes updates. A remote server must use HTTPS. Do not put real data into this mode.

For the external five-gateway simulator, start the server with `STEVE_SYNTHETIC_MODE=1` and use the same development token to run `node server/simulate-five-gateways.js`. All its measurements are labeled SIMULATED. Synthetic-mode ingest rejects LIVE source packets; live servers reject SIMULATED packets.

Run `cd server && npm test`. No external packages are required by the backend.

## Continue from iPhone

1. Use the [public synthetic demo](https://teeyaii.github.io/Recruit-Health-Monitor/) now.
2. In GitHub → Actions, inspect **STEVE Android compile (no BLE device)** and **STEVE iOS simulator build (unsigned)**. Android runs include a debug APK artifact for later authorized Android testing.
3. For an opt-in free HTTPS backend, follow [the Render Free iPhone setup](docs/RENDER_FREE_SETUP.md), or choose an existing compatible container host. Render generates individual Gateway secrets; supply an anonymous slot map privately. No paid account is created by this project.
4. Supply Apple signing access through a trusted hosted macOS build service if native iPhone installation is needed. No personally owned Mac is required.
5. Validate one physical band, then multiple bands, before field use.

No third-party source has been copied. Compatibility sources are recorded in [BLE_COMPATIBILITY](docs/BLE_COMPATIBILITY.md).

