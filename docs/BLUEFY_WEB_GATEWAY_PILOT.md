# STEVE 1.0 — Bluefy Web BLE Gateway pilot (iPhone only)

## Observed on 26 October 2026
nRF Connect showed two simultaneously connected Xiaomi Smart Band 10 units (47FD, A746), with independent Heart Rate Service 180D / Characteristic 2A37 screenshots reading 63 and 65 BPM. Bluefy later received continuous heart-rate notifications (for example 06 35 through 06 39, decoded as 53–57 BPM).

Not yet verified: two simultaneous **Web Bluetooth** subscriptions within Bluefy, continuous ten-minute reception, end-to-end STEVE upload, screen lock/background reliability or medical suitability. Bluefy explicitly warns background Bluetooth may disconnect.

## Setup for operator-only test
1. Review/merge/test the Web BLE gateway code; manually deploy current STEVE Backend to an approved HTTPS host. Render Free may sleep and is not suitable for continuous monitoring.
2. Configure separate gateway and viewer secrets privately on the hosting service. Never publish secrets in screenshots, repositories or issues.
3. Privately configure two **anonymous** G01 slots: R01 -> pilot-band-01 and R02 -> pilot-band-02 (or other fictional opaque IDs), using STEVE_SLOT_MAP_JSON, and redeploy. These are slot bindings, not MAC addresses or personal identities.
4. Check HTTPS /health before testing. On the iPhone open the same HTTPS origin followed by /gateway **inside Bluefy**, not Safari.
5. Enable Share HR on both Band 10 units; disconnect them from nRF Connect and stop competing Bluetooth apps. Charge iPhone and keep Bluefy in the foreground.

## Run pilot
1. Select G01 and enter the **G01 Gateway token**, not the viewer/medic/trainer login; tap Load authorized slots.
2. Select R01, tap Connect and select the *physical* Band 10 intended for R01. Validate band-to-wearer assignment manually.
3. After R01 gets live notifications and Server acknowledged, select R02 and connect its different physical Band 10 without stopping R01.
4. Leave Bluefy visible for ten minutes; both slots should keep receiving distinct fresh BPM, and the same values should appear on the separate authenticated /live dashboard on **another device**.
5. Intentionally remove a wristband, go out of range, then switch to another app; confirm a disconnected or stale state is shown, never a false safe value.
6. For engineering results record only anonymous slots, duration, drops, error counts and latency. No real recruit identifiers or sensitive health data in public GitHub.

## Safety/technical constraints
- This is an experimental foreground-only Web Bluetooth bridge; background operation is deliberately disabled. It cannot be used as a lone training safety monitor.
- The page calls requestDevice from direct user interaction and subscribes to 180D/2A37, decoding 8/16-bit BPM.
- If supported sensor contact is reported lost, Gateway treats BPM as unknown (no data).
- Gateway Bearer token and opaque slot mappings are retrieved from the same HTTPS backend and held in page memory only; credentials are never hardcoded or stored in localStorage, cookies or URLs by this page.
- No stale packet replay: readings older than 15 seconds cannot be accepted. Disconnect or visibility loss clears local BPM and attempts a disconnect update; server TTL remains authoritative if the browser is suspended.
- Existing Render Free can sleep; this prototype is not clinically validated, does not detect heat stroke, and must not replace direct supervision, WBGT-based heat controls, hydration, rest or emergency medical protocols.

## Acceptance gate
- Production-mode backend tests and browser HR decoding fixtures pass in CI.
- Two Band 10 devices provide simultaneously fresh values in Bluefy for ten minutes and these values arrive in authenticated STEVE LIVE under separate authorized R-slots.
- Only after that, attempt three bands and a controlled 60-minute stability test.

## Bluefy diagnostics v2 — 27 October 2026

### Diagnosis and compatibility change
The old catch handler rendered only `error.message || "unknown"`, losing string,
native-object and empty rejection details. All BLE stages shared that catch, so
**the physical failing stage and the underlying Bluefy cause are not yet proven**.
Numeric UUIDs are valid Web Bluetooth input; changing their representation is a
compatibility candidate, not proof that numeric UUIDs caused the failure.

Compared with Google's notifications sample:
https://github.com/GoogleChrome/samples/blob/gh-pages/web-bluetooth/notifications.js

- Standard mode now uses `{filters:[{services:["heart_rate"]}]}` without redundant
  optionalServices, directly inside the click handler with no preceding await.
- Broad mode explicitly uses `{acceptAllDevices:true,optionalServices:["heart_rate"]}`.
  It still requires the user to select a device and verifies 180D and 2A37.
- Service/characteristic use standard names `heart_rate` / `heart_rate_measurement`.
- Like the sample, notifications start before the event listener is attached.
- The UI reports capability, chooser, selection, GATT, service, characteristic,
  subscription, reception and HTTPS acknowledgement separately.
- Native errors are classified using an allowlist plus a bounded numeric code.
  Raw messages, native objects, URLs and identifiers are deliberately not dumped.
  NotFoundError cannot distinguish chooser cancellation from no matching device.
- Existing CSP, authentication, slot enforcement and backend routes are unchanged.

### Physical assignment
Before selecting a device, enter its physical four-character name suffix for the
selected R-slot. The selected Bluetooth name/ID must contain that exact token.
A first successful subscription binds that Bluetooth ID to the R-slot in memory.
Duplicate IDs/suffixes across slots and reassignment of an existing slot are rejected.
Use Stop and clear to intentionally reset assignments. This is an operator-assisted
check, not hardware identity authentication. The server still enforces its opaque
provisioned IDs; it cannot independently attest the physical band. If Bluefy hides
the suffix, selection is rejected rather than guessed; report stage 3/9.

### Manual deployment only
No Render environment variables need to change. The repository Blueprint already
sets autoDeployTrigger: off. Commits for this fix also use [skip render].
Open https://dashboard.render.com and select the **existing** STEVE Live web service.
On Deploys choose Manual Deploy > Deploy a specific commit, paste the verified
merged main SHA from the PR, and select Deploy Commit. Wait for Live, then open the
existing HTTPS service URL with `/health` and `/gateway`. The gateway must display
**Bluefy diagnostics v2**. A specific-commit deployment disables Render auto-deploys.
Do not create another service or change secrets/slot maps.

### Next three operator steps
1. In Bluefy open the existing `/gateway`, verify diagnostics v2, authenticate G01
   with its existing credential, select R01 and enter the suffix of its physical band.
2. Use A. Standard Heart Rate Scan; select that band and wait for BPM plus
   `LIVE • Server acknowledged`. If it fails, record the stage and safe error;
   explicitly select B. Broad BLE Scan and press Connect again. Retry on a tile
   repeats that tile's original mode; the main button uses the newly selected mode.
3. Select R02, enter the other band's suffix and connect it without stopping R01.
   Keep this page visible for ten minutes. Both tiles must independently show fresh
   BPM and acknowledgements. Do not open /live in another tab on the same iPhone
   during collection: backgrounding the gateway deliberately stops BLE. If another
   device is available, use its authenticated /live view to observe the server.

Acceptance remains pending operator confirmation. Automated mocks cannot verify
Bluefy's native bridge, chooser behavior, device names or two physical BLE links.
If a step fails, report slot, mode and stage/error only; do not include credentials.
