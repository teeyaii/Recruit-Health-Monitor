# Recruit Health Monitor

Private Android proof-of-concept for Xiaomi Smart Band 10 **Heart Rate Broadcast** (standard Bluetooth LE HR service). Goal: demonstrate **two bands on one Android phone** before attempting three or more.

## Current state
- Kotlin Android app with BLE scanner, GATT connections and live heart-rate parsing.
- Android debug APK build workflow committed; **successful build not yet confirmed**.
- Physical Xiaomi multi-band compatibility **not yet verified**.
- No server, centralized dashboard, durable recording or automatic reconnection yet.

## Build APK using GitHub Actions (no computer needed)
1. Open **Actions** tab.
2. Select **Android debug APK**.
3. Tap **Run workflow** and select `main`.
4. Wait for green success. If red, inspect **Build debug APK** logs.
5. Open the successful run, download artifact `recruit-hr-debug-apk`, unzip and install the APK on an **Android phone** (not iPhone).

## Test
1. On each Xiaomi Smart Band 10 enable **Share HR / Heart Rate Broadcast**.
2. On Android allow Nearby Devices and enable Bluetooth.
3. Tap **Scan for heart rate bands**.
4. Start with one band, then test two concurrently.
5. Verify both heart rates change independently. Test loss of signal and 60-minute movement.
6. See [TEST_PLAN.md](TEST_PLAN.md).

## Safety and privacy
**Not a medical device, heat illness detector, or emergency alert system.** Continue direct supervision, WBGT-based controls, rest, hydration and emergency procedures. Never interpret missing HR as zero. No real recruit personal/health data should be committed to this repository.

## Credits and source strategy
- [Heart-rate-comparison](https://github.com/xinxiangjueming/Heart-rate-comparison): architectural inspiration; no upstream source copied because no root LICENSE was confirmed.
- [xioami_heart_rate](https://github.com/Xianggeok/xioami_heart_rate): Xiaomi HR broadcast protocol reference (Apache-2.0; check notices before reuse).
- This Android prototype is independently authored, not a direct fork.
