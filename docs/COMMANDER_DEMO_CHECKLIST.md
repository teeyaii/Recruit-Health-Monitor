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

## High-risk cohort Dashboard — required before the single Render deploy

All actual Band wearers are already **high-risk enrolments**, not automatically WATCH or EMERGENCY. An operator must register each wearer in the private authenticated roster using an anonymous code before it contributes to cohort LIVE/NO DATA. For the physical two-Band pilot, register R01 and R02 without using real names or medical diagnoses. The dashboard shows **registered high-risk**, **LIVE registered**, **NO DATA registered**, **WATCH**, **EMERGENCY** and **not-yet-registered capacity** (out of 15). A live but unregistered Band is shown as **PENDING REGISTRATION**, not counted as an enrolled person. An unavailable roster shows unverified counts (—), not misleading 0 or 15 missing data.

WATCH / EMERGENCY are operator-confirmed escalation/observation indicators, independent of data transport. A lost HR stream never clears them, and a normal BPM never declares medical safety. Authorized trainers and medics may record non-identifying activity (training / resting / under assessment / not reported), restriction, observation, and acknowledge. Updates from another browser are pulled periodically without overwriting fields someone is typing; edits remain optimistic-version checked, and conflict requires Refresh before retry. Do not use raw names, diagnoses or actual patient records in Render Free.

**Critical persistence limitation:** Roster, acknowledgement and event log default to RAM; free container restart/deploy can erase them. Even an optional file inside a Render Free container is not reliably durable across deployment. Do not tell operators this is durable safety monitoring. Before presentation, use synthetic approved roster values and re-enter after deploying/restarting. Production monitoring requires reviewed external durable encrypted storage, access control and clinical procedures; this prototype does not provide these guarantees. WBGT readings are manual and also volatile. Do not add automatic medical risk scores.

Deploy only the final CI-validated merged SHA **once**, verify /health, /gateway (Gateway v8) and /live, then do the 10/60 minute physical dual-Band observation with actual loss/recovery notes. A successful GitHub CI is not a physical stability measurement.

## One-button cohort-wide training / hourly rest (post-Dashboard update)

For the supervised high-risk cohort, the instructor or medical operator now sets **one shared activity phase** from the authenticated /live page using two buttons: **กำลังฝึก (Training)** and **พักประจำชั่วโมง (Hourly rest)**. This is an explicitly operator-controlled phase, not a personal activity form, a scheduled timer, an automatic rest reminder or evidence that every recruit is medically cleared for training. The Dashboard displays the selected phase, time it began, and elapsed minutes. All logged-in displays retrieve the same backend state and refresh it periodically; an operator editing from an outdated screen receives an update conflict and the latest state.

The status **never resets or downgrades individual WATCH, EMERGENCY, no-training restrictions, signal loss, or medical assessment**. Person-level restrictions and observations remain separate. Older roster files may contain a legacy per-person activity field; it is not displayed or edited by the new UI for training/rest. Group phase actions are authenticated, same-origin checked, versioned and recorded to the existing role-based audit log without personal identifiers. Trainer and medical credentials retain equal rights.

The default Render Free setup stores the group phase and roster in RAM, so a backend restart can reset the phase to **not started**; re-select the actual operational phase after restart. Even an optional local file in an ephemeral Render container is not a durable operational record. Do not treat the phase as a medical sign-off or use it as a stand-alone safety control.

## Optional four-hour per-recruit heart-rate graph (LIVE-only)

The authenticated Dashboard now offers **ดูกราฟย้อนหลัง 4 ชั่วโมง** on each **registered, currently LIVE** recruit card (R01–R15). NO DATA, disconnected, paused, unregistered and stale slots do **not** have a graph button. Opening one chart loads that slot's past accepted BPM readings on demand. The browser renders just one selected graph at a time; when that slot loses live data or changes wearer, the panel closes. Neither a missing heartbeat nor a missing upload generates a fake graph point. The SVG trace is split at gaps greater than 15 seconds. Operators can view 30 minutes, 1 hour, 2 hours or 4 hours inside the maximum 4-hour window, with observed minimum/mean/maximum BPM.

The server keeps at most **2,880 timestamped BPM samples per R-slot** (one accepted sample per 5-second bucket, for a 4-hour rolling window), and allocates no history for slots that have never supplied valid enrolled LIVE BPM. Stored history is sparse during intermittent outages; old points can be kept temporarily within the rolling window for recovery without generating or showing a graph while NO DATA. Sampling starts after the feature is deployed and only while the server is running. It cannot recover pre-deployment data or fill sensor gaps.

The **กำลังทำการฝึก / พักประจำชั่วโมง** timeline is derived only from actual recorded operator phase changes; it is common to the group, not inferred per person. If a phase was never recorded, the chart does not invent it. On changing the wearer's anonymous code, the previous wearer's BPM history is deleted and queued samples measured before reassignment are rejected. Read access to history is restricted to authenticated trainer/medic/legacy viewer sessions; gateway-only access is rejected. Data is RAM-only, volatile after Render restart, and remains a presentation/observation aid rather than a clinical monitor.

For manual verification after the eventual **single** Render deployment: confirm R01 and R02 each show the button only when LIVE, R03 NO DATA never creates a chart, opening R01 does not load R02 graph, an interrupted connection removes the button and visible graph, gaps are blank, and changing wearer resets their history. Do not add real personal identifiers or claim 4 hours were physically tested without a recorded four-hour observation.
