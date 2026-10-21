# iOS gateway proof-of-concept

Swift CoreBluetooth source prototype. The code scans for standard BLE Heart Rate Service (0x180D), connects, discovers measurement characteristic (0x2A37), and receives notifications. No Xiaomi hardware has been tested.

To run on an iPhone, create an iOS SwiftUI app in Xcode, add `HeartRateCentral.swift` to the target, set `NSBluetoothAlwaysUsageDescription` in Info.plist, and call `start()` from the UI. iOS app signing/build requires a macOS/Xcode environment or compatible hosted build service; GitHub alone does not install an iOS app onto a phone.

This is **not** an operational gateway yet: no pairing/identity map, backend upload, reconnect, background restoration, or verified multi-band limit. A single iPhone cannot validate multiple Xiaomi bands without the bands.
