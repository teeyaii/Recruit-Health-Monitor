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

## Recovery v3 — engineering and physical acceptance

Confirmed code defects in v2:
- Closed cards were removed from `live`; foreground `controls()` did not refresh
  their retry buttons. A card painted while another connection was pending could
  remain disabled after that connection ended.
- The global connecting flag waited indefinitely for an unresolved native promise.
- Cleanup could not cancel a pending JS wait. A stale attempt's finalizer lacked
  ownership checks, making future recovery changes vulnerable to unlocking a newer attempt.

V3 retains closed card models separately, refreshes controls on foreground, gives
attempts ownership, and bounds chooser/GATT/discovery/subscription waits to 20 seconds.
Cleanup cancels JS waits, aborts uploads and removes listeners. The explicit lifecycle
is IDLE, CHOOSING, CONNECTING, SUBSCRIBING, LIVE, STALE, DISCONNECTED, RECOVERABLE or
ERROR; fresh sessions start without BPM or acknowledgement. LIVE BLE reception and
server acknowledgement remain separate fields. Errors and interruption remain NO DATA.

A native requestDevice dialog has no standard abort API. A JS timeout does NOT cancel
that dialog. The page keeps a separate chooser lock until its native promise settles,
preventing overlapping prompts. Close the dialog; if it remains unresolved, use
**รีเซ็ต BLE ของหน้านี้**. This explicitly disconnects all bands and reloads the page,
clearing the in-memory credential; authenticate G01 again. It does not reset iOS
Bluetooth or change Render. Ordinary per-slot reconnect leaves the other slot alone.

Mode C calls feature-detected getDevices and accepts only the exact previously bound
ID and physical suffix. If unsupported, rejected, or missing, it instructs a new
user tap on A/B; it never launches requestDevice after an asynchronous getDevices call.
There is no timer-driven chooser or automatic background restoration.

The native empty chooser / stage 2 NativeError is still unresolved. JavaScript cannot
force advertisements to appear or repair Bluefy's native bridge. Both individual
bands have operator-confirmed BPM and acknowledgements; simultaneous STEVE streams
and repeatable recovery are NOT yet physically verified. Background operation remains
unsupported; server TTL is authoritative if a disconnect upload cannot complete.

Manual deployment: existing Render service > Deploys > Manual Deploy > Deploy a
specific commit > paste merged SHA > Deploy Commit. No variable changes. Confirm
`Bluefy recovery v3` at the existing /gateway URL. Commits use [skip render].

Physical acceptance (iPhone only):
A. In Bluefy authenticate G01, connect R01 to its verified physical band; confirm
fresh BPM and Server acknowledged.
B. Connect R02 to its different band without stopping R01. Confirm independent values.
C. Keep gateway visible for ten minutes; both measurement and ack times must advance.
D. Background intentionally. On return, both must show NO DATA (server expires after
15 seconds if disconnect upload was suspended).
E. Press each card's reconnect. Mode C is available through the main selector if
supported; otherwise use A/B with a new tap. Reset page only for an unresolved chooser.
F. Repeat D/E three times. Record slot, mode, phase, duration, and failure text without
credentials. A JS state violation is a website defect; empty native prompts remain
unresolved browser behavior unless further evidence proves otherwise.

### Native iOS evaluation (not a replacement in this change)
The existing HeartRateCentral initializes CBCentralManager without a restoration
identifier; project.yml lacks UIBackgroundModes/bluetooth-central. Existing CI builds
an unsigned simulator target, not an installable signed iPhone app. GatewayUploadClient
already enforces HTTPS, rejects redirects, uses ephemeral sessions and bounds stale uploads.

For background requirements, extend the existing native project with bluetooth-central,
a stable CBCentralManagerOptionRestoreIdentifierKey, willRestoreState handling, secure
persisted slot bindings/Keychain credentials, peripheral delegate reattachment and fresh
subscription checks. Preserve per-peripheral isolation and server TTL. iOS controls
wake time; restoration does not guarantee continuous networking or recovery after
user force-quit. Two-band capacity must still be measured on the actual iPhone.

No personal Mac is necessary if a hosted macOS build signs using an authorized team's
certificates/profiles and distributes through TestFlight. TestFlight distribution needs
an Apple Developer Program team; the tester does not need their own paid membership.
Free Personal Team development is available via Xcode but profiles expire in seven days;
it is not the existing iPhone-only unsigned-CI installation path. Do not buy membership
until selecting a distribution team/method. Keep the web gateway for foreground tests.

Primary sources:
- https://developer.apple.com/documentation/technotes/tn3115-bluetooth-state-restoration-app-relaunch-rules
- https://developer.apple.com/library/archive/documentation/NetworkingInternetWeb/Conceptual/CoreBluetooth_concepts/CoreBluetoothBackgroundProcessingForIOSApps/PerformingTasksWhileYourAppIsInTheBackground.html
- https://developer.apple.com/help/account/basics/about-your-developer-account

## Focused foreground auto-reconnect v4

Supersedes v3 manual-only foreground recovery and reload-based reset guidance.
Operator has now confirmed simultaneous R01/R02 readings with server acknowledgements;
physical automatic recovery is still unverified.

On background, clear BPM, abort uploads and detach subscriptions as before. Keep G01
credentials, provisioned mappings and successfully bound BluetoothDevice references only
in page memory. On foreground, try eligible slots sequentially, at most two attempts per
slot per recovery cycle: first the stored device handle (or feature-detected getDevices
if missing), then getDevices lookup by exact existing ID/suffix. Never call requestDevice
from automatic recovery. GATT/service/characteristic/notify waits retain the 20-second
bound. Failed slots show NO DATA / Manual action required and a user-gesture reconnect
button. Explicit operator disconnect disables restoration for that slot; logout clears
bindings and cancels recovery. No timer-based ongoing retries.

Soft BLE Reset now preserves auth/provisioning/bindings in the current page and restarts
eligible known devices. It does not reload or log out. A native chooser that never settles
cannot safely be cancelled from JS: close its UI first; if still stuck, a manual page reload
is the last resort and requires authentication again. The page never opens overlapping
native choosers. Browser reload, OS page eviction and force-quit lose memory; no automatic
recovery is promised in those cases or where Bluefy requires fresh user permission.

Deploy merged SHA manually to the existing Render service; verify `Bluefy auto-reconnect
v4`. Connect both physical bands, verify independent fresh BPM/acks, switch away then back,
and observe automatic reconnection. Repeat three times. Also verify manual Disconnect
stays disconnected, Soft Reset keeps G01, and native permission failure offers manual
recovery without automatically opening a chooser. Keep NO DATA during interruption.

## Optional battery v5 / final prototype verification

PRs 15–18 already provide the Tactical Dashboard, presentation mode and separate
health/telemetry states. This update preserves them and adds a small battery row.
Standard Battery Service 180F (`battery_service`) is requested as optional access;
Battery Level 2A19 (`battery_level`) is read only after HR notifications are active.
No proprietary Xiaomi protocol is used. Actual Band 10 exposure remains unverified.

Battery reads are non-blocking to the HR path, limited to once per five minutes,
with three-second bounds per GATT battery step. Unsupported/failed discovery disables
battery reads for that session; reconnect permits another capability check. Values
must be one byte in 0–100. Last valid readings expire after 15 minutes in Gateway,
server and Dashboard. UNKNOWN never means 0%. Cached percentages include their age;
they do not imply live HR or safe health. Reconnection starts a fresh local cache.

Optional ingest metadata is `battery: {percent: integer, timestamp: epoch_ms}` on an
otherwise valid HR reading. The server ignores invalid/missing battery metadata without
rejecting valid BPM, retains only a fresh prior battery for the same device/gateway,
and never updates battery through an unauthorized slot. Legacy gateways remain valid.
Battery metadata is delivered with the next HR upload, not a separate battery endpoint.
Existing authorized device handles may lack battery permission: UNKNOWN is expected
until an operator explicitly selects the device again with optional battery access.

Deployment: existing Render Docker/8080 health check /health, auto-deploy disabled.
No secrets, slot map, service, database or Event Log added. Deploy the merged SHA manually
unless an authenticated Render deployment tool is available. Build/CI success is not
proof that a Render deployment or physical BLE battery read succeeded.

Physical check: connect R01/47FD and R02/A746, verify independent fresh BPM and server
acknowledgements, then inspect battery (real 0–100% with age, or UNKNOWN). Run foreground
for ten minutes. Disconnect just one band; the other must keep updating. Reconnect,
soft-reset and repeat background/foreground three times. Background is unmonitored;
NO DATA is correct until fresh packets return. Verify WATCH and EMERGENCY remain visible
on signal loss and acknowledgement leaves EMERGENCY active. Check presentation mode on
phone and presentation display. Do not treat this research prototype as a medical device.
