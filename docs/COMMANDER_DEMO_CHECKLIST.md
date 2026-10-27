# STEVE 1.0 — commander demonstration checklist

## Accepted, do not reset

Owner report dated 27 October 2026: all six physical Gateway v8 acceptance checks PASS on iPhone / Bluefy 2.01 / Xiaomi Smart Band 10 x2 (R01 47FD, R02 A746). Fresh simultaneous BPM, foreground auto reconnect, Soft Reset credential retention, reload within two-hour HttpOnly session, and Dashboard LIVE / NO DATA were accepted on main `cddfad8c5ea0b572fcc5449c595a032b3e375f17` after PR #22. Automated CI is separate evidence. Earlier pilot sections are historical, not outstanding failures.

## Before the demonstration

- Use the existing HTTPS Render service, Bluefy `/gateway` on the collection phone, and authenticated `/live` on a separate display/device. Keep Bluefy foreground and the screen unlocked. Close competing BLE clients. Use anonymous demonstration slots only.
- Verify the existing service is awake with `/health`, and the page shows Gateway v8. Ensure a fresh login leaves enough of the absolute two-hour session for the demonstration. Server restart/deploy invalidates sessions.
- Leave Render credentials, G01/R01/R02 mappings and auto-deploy settings unchanged. Battery collection/UI stays absent. Do not expand to more bands for this demonstration.
- Check WATCH / EMERGENCY demonstration flags on the presentation display. Another operator's edits require the display's Refresh button: roster flags are not live-synchronized by the BPM stream. Do not edit flags on another device during presentation without refreshing the display.
- Default roster storage is RAM only: WATCH, EMERGENCY and acknowledgements survive browser reload and BLE loss while the backend lives, but not backend restart/deploy. Re-enter only approved synthetic demo flags after a restart. Acknowledgement alone does not clear EMERGENCY. Do not add a database for this demo.

## Remaining measured physical tests

These are new duration measurements, not repeats of the six accepted functional checks. No completed duration result is currently recorded in the repository.

1. Run both existing bands together for **10 minutes in foreground**. Observe fresh BPM and server acknowledgement on both slots and the separate LIVE dashboard. Record actual start/end time, per-slot dropout count and longest gap, recovery time, and observed upload/display delay. Report measurement resolution; do not invent millisecond precision from manual observation.
2. If acceptable for the demonstration, run the same two-band setup for **60 minutes in foreground**, recording the same measurements plus any manual intervention. No third band is required. Record each result as PASS/FAIL with evidence and the exact deployed SHA; missing measurement is NOT TESTED.

A pass requires no slot crossover, no stale value displayed as LIVE beyond the 15-second data timeout (allow the next UI refresh), no hidden upload failure, and recovery to fresh independent readings. Record all actual interruptions; the owner decides whether observed availability is sufficient for the demonstration. Neither run establishes background or medical reliability.

## During interruption

- NO DATA means unknown. Do not treat it as a safe heart rate. Keep direct human supervision and the existing medical/WBGT procedures separate from this prototype.
- An HTTPS/upload failure is distinct from BLE reception. Check the network/service first; do not change tokens or remap bands. Fresh acknowledged samples should recover automatically when connectivity returns; old readings must not replay.
- If a band remains unavailable, use its reconnect control; use Soft Reset only if needed. An unresolved native chooser must be dismissed by the operator. Session expiration/restart requires login; it is not a BLE defect.
- If a live demonstration cannot continue, clearly label any switch to the separate SIMULATED Pages demo. Never present simulated data as a physical result.

## Release and closeout

Merge only the reviewed PR head with all applicable CI jobs green. Record the resulting **full merged main SHA** and verify its push CI before deployment. On the existing Render service choose Manual Deploy > Deploy a specific commit, paste that exact SHA, then verify `/health` and Gateway v8. A GitHub merge is not a deployment; do not claim Render success without actual access/evidence. No secrets or slot-map changes.

Record: deployed SHA, operator, device/browser versions, run duration, per-slot gaps/recovery, observed delay, manual interventions and outcome. Keep credentials and personal health information out of the record. Log out both pages when finished; if offline, reconnect and retry logout to revoke the server session.
