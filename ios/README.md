# iOS STEVE gateway

The SwiftUI app scans standard BLE Heart Rate Service 180D, lists devices without auto-connecting, and requires explicit R-slot/opaque-device-ID assignment before subscribing to 2A37. It uploads via the shared HTTPS contract, with bounded retry/reconnection and stale-state display.

GitHub Actions generates the project with XcodeGen, executes parser/assignment fixtures, and compiles on a hosted macOS runner. This is an **unsigned simulator build**, not an installable iPhone app and not a Bluetooth test.

For phone setup and the signing path without a personally owned Mac, see [MVP_SETUP](../docs/MVP_SETUP.md). The runtime URL, gateway credential and pairings are held only in memory. Stop/clear and re-enter them after app restart. Keep the app foreground; background collection/restoration is deferred.

