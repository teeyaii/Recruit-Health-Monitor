# STEVE MVP setup from a phone

## Demonstrate immediately on iPhone

Open https://teeyaii.github.io/Recruit-Health-Monitor/ in Safari. Press **เริ่มจำลอง** and verify 15/15 slots and 5/5 gateways. Use R03 loss, G03 loss, Restore, and Stop. Wait more than 15 seconds after a loss to see STALE. The page is entirely SIMULATED. Safari → Share → Add to Home Screen is optional.

## Live backend hosting (not yet deployed)

Use an existing container host that supports HTTPS and long-lived HTTP/SSE connections. The repository includes a root Dockerfile and .dockerignore. Build from repository root, expose port 8080, set health check /health, keep one instance, and disable proxy buffering on /api/events. No database or additional package installation is needed. Container image build has not been executed locally; backend behavior is tested separately.

In that host's private environment/secret settings configure:
- NODE_ENV=production
- COOKIE_SECURE=1
- STEVE_VIEWER_TOKEN, a unique random secret of at least 32 characters
- STEVE_GATEWAY_TOKENS_JSON, five different secrets associated with G01–G05
- STEVE_SLOT_MAP_JSON, the explicit device assignment map

Use R01–R03 on G01, R04–R06 on G02, R07–R09 on G03, R10–R12 on G04 and R13–R15 on G05 for the initial demonstration. Assign each a different random opaque device ID (4–64 letters/digits/underscore/hyphen). Copy those IDs into the gateway UI. Server and gateway must agree exactly; the app cannot override another gateway's slots.

Do not place credentials or real mappings in GitHub commits, issues, URLs or screenshots. No account has been configured and no paid service has been enabled. A hosting account/selected endpoint is the external requirement for remote LIVE testing.

Open https://YOUR-HOST/live on iPhone and sign in using the separate viewer credential. The static GitHub Pages URL remains DEMO only.

## Android

In GitHub → Actions → **STEVE Android compile (no BLE device)**, open a successful run and download **steve-android-debug-apk**. Unzip it and transfer the APK to the authorized test Android phone; allow installation only for that file/source as appropriate to your device policy. It is a debug build, not a store release.

1. Enter HTTPS server origin (no path/query), choose G01–G05, paste that gateway's credential, Apply.
2. Grant Bluetooth/Nearby Devices permission; older Android also requires location permission.
3. Scan; select the actual physical device using the locally displayed name/identifier.
4. Assign its R-slot and the opaque ID already provisioned on the backend; confirm.
5. Check CONNECTED, fresh BPM, and Server acknowledged. Verify the matching dashboard slot.
6. Stop/clear before changing gateways. Re-enter configuration after restart.

## Native iPhone installation — signing required

You do not need to own a Mac. A hosted macOS/Xcode build runner can build this existing project. The current GitHub workflow proves simulator compilation only.

To install through TestFlight, an authorized Apple Developer team must supply access to App Store Connect, register a unique bundle identifier, and create signing/distribution credentials and an app record. This may require an existing paid membership; no purchase or enrollment has been made here.

On the hosted runner:
1. Run XcodeGen in ios/ as the existing workflow does.
2. Set the registered PRODUCT_BUNDLE_IDENTIFIER and DEVELOPMENT_TEAM. Override the project's CODE_SIGNING_ALLOWED=NO for the device archive only.
3. Import the team's distribution certificate/private key into an ephemeral keychain and install the matching provisioning profile through the host's secret facility.
4. Archive for generic/platform=iOS with signing enabled, export with the team's App Store Connect export options, and upload through authorized App Store Connect credentials.
5. After Apple's processing and any required testing review, invite the authorized tester; install TestFlight on iPhone and accept the invitation.

Signing identities, profiles, team access, and Apple processing are external requirements. Do not commit signing material. An unsigned simulator .app cannot be installed on an iPhone. Alternative registered-device distribution still requires valid signing/provisioning and an authorized installation channel.

After installation the same configuration/scan/assignment workflow applies. iOS Bluetooth permission is requested by CoreBluetooth. Keep the app open; leaving the foreground disconnects devices and requires Retry when returning.

## Limits to verify with hardware

Start with one band, then two, then three per gateway. Check identity, correct slot routing, radio loss and recovery, phone lock/background, range and interference. No physical band, signed iPhone installation or multi-device reliability test has been performed. Runtime assignments intentionally do not persist; after process termination, explicitly pair again.

The reconnect budget is three attempts per pairing session; tap Retry to begin another controlled attempt. Uploads retry at most three times, expire after 12 seconds, and retain the original timestamp. Unavailable measurements are unknown, never zero.

## Software evidence

- Backend tests include five distinct gateway credentials and all 15 slot mappings.
- The HTTP/SSE/dashboard test verifies independent values, device loss, gateway loss, stale cutoff, recovery, duplicate/old/future timestamps, wrong mappings, synthetic labels and logout clearing.
- Kotlin and Swift fixtures cover UINT8/UINT16 packets, malformed packets, unavailable sensor contact and assignment conflicts.
- Android APK and iOS simulator builds run in GitHub Actions.
- Published demo verified HTTP 200 and 15/15 in a narrow browser viewport; actual iPhone Safari remains a manual check.
