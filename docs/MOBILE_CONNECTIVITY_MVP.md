# STEVE 1.0 — mobile Gateway connectivity milestone (NO hardware required)

## What this code does

Native Android/iOS now include **Test HTTPS Gateway (no BPM)**, which sends an authenticated empty Heart Rate ingest batch over HTTPS to the existing STEVE Render backend. It verifies the gateway credential and endpoint through the existing production API. It does **not** create a measurement, demonstrate BLE reception or prove a device has been provisioned.

The test has a longer one-shot network timeout than real BPM transmissions because a Render Free service can take around a minute to wake from sleep. **Real BPM uploads keep their 12-second freshness window** and must never be replayed as new data after a network outage.

The apps also include a second, manually invoked **Broad scan nearby BLE** option. Default scanning filters for the advertised Heart Rate Service UUID 180D; Broad Scan does not filter advertisements and can help display devices that do not advertise 180D. Discovering a device does not imply it supports notifications for the Bluetooth Heart Rate Measurement characteristic 2A37; the app still checks the GATT service and characteristic **after manual selection and assignment**.

## Preparation before one-band pilot

1. The Render LIVE HTTPS endpoint is currently https://steve-1-0-live-gateway.onrender.com and was reported Live. Always check current state first: https://steve-1-0-live-gateway.onrender.com/health must answer with ok:true. The existing Render instance is a Free development service, not continuous monitoring.
2. The Render Blueprint generates a separate secret for STEVE_GATEWAY_TOKEN_G01 through G05, plus a different viewer secret. **Use the gateway token with the corresponding native app, never the viewer token.** Do not share any secret in chat/screenshots.
3. Server provision map STEVE_SLOT_MAP_JSON currently needs an appropriate anonymous device ID for each intended slot. For a test only: G01 / R01 / demo-opaque-001 is the prepared example. Do not put MAC addresses, personal names or real medical records into public GitHub.
4. On Android, obtain the debug APK artifact from the GitHub Actions workflow named STEVE Android compile (no BLE device). Install only on an authorized test device.
5. On iPhone, native app still needs Apple Developer signing and an authorized installation method such as TestFlight. **Safari or the unsigned simulator build is not an installable BLE Gateway app.** The existing Safari Pages demo has no direct BLE support.

## Device-free functional checks (after installing a native app)

- Open the native app; enter the Render HTTPS **origin**, selected G01–G05 and that Gateway's credential. Tap Apply. On Android, the app now additionally fetches **only that Gateway\'s authorized anonymous slot IDs** from `GET /api/gateway/provision` and displays how many slots Render has configured. This requires updated Render code and a correct bearer secret; it is NOT Bluetooth pairing. If the existing Render service is still on an older commit, this returns HTTP 404 until manually redeployed.
- Tap **Test HTTPS Gateway (no BPM)**. Wait for a separate success/failure status. A cold Render Free host may take longer to respond; this probe makes one long attempt and transfers zero BPM.
- A successful probe confirms HTTPS connectivity and gateway credential only. On the separate STEVE LIVE Dashboard the gateway may briefly appear online, while all provisioned recruits must remain **NO DATA** until actual BLE readings arrive.
- On Android/iOS, test **Scan HR devices** (15 seconds). If no device appears and an approved test band is available, try **Broad scan nearby BLE**. Scanning without any BLE band available should naturally show no useful devices.
- On **Android**: tap **Reload authorized R-slots** if needed, then assign each *physical* band to a chosen authorized R-slot in STEVE; the app fills the matching anonymous ID automatically from Render. There is deliberately no manual fallback when provisioning cannot be authenticated. The selected R-slot is NOT automatically verified against the wearer: an operator must check the physical person + band separately. The app shows **assigned / BLE subscribed / fresh BPM** counts. For two bands the gateway\'s Render map must include BOTH R01 and R02; the example user-hosted map currently included R01 only. Update it privately (without using real identities), then re-fetch before assigning.\n- On **iOS**: still assign the exact operator-provisioned opaque slot/device ID manually in the signed native app. Verify 180D/2A37, then observe a LIVE BPM matching the selected slot. Start one band at a time.

## Acceptance tests that do not need real sensors

- Swift simulator compiles in GitHub Actions and Swift HR packet fixtures pass.
- Kotlin unit tests compile and Android debug APK artifact is produced by CI.
- Server strict-production integration checks that an empty G01 heartbeat returns accepted=0, G01 becomes online, R01 remains NO DATA, and a G02 token cannot act as G01.
- Server production integration now checks that G01 can see only its own authorized R01–R03 opaque IDs, G02 only R04, and a LIVE viewer cookie/unprivileged request cannot enumerate any Gateway mappings.
- Existing synthetic 5-Gateway/15-recruit API/SSE tests remain green, and public Safari simulation remains separate from LIVE.

## Deferred until physical equipment exists

Actual Xiaomi Smart Band 10 broadcasting compatibility, GATT notification frequency, battery behavior, number of simultaneous bands per phone, radio interference, device labels, background/phone-lock operation, session safety, and real-world reconnection timing **cannot** be established by CI. Do not claim they passed.

STEVE is currently a research/prototype gateway. Render Free can sleep and is unsuitable for continuous training safety response. Direct human supervision and established WBGT/medical procedures remain mandatory for any real training.
