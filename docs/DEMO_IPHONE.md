# STEVE 1.0 — iPhone demo (10-day MVP)

## Ready to demonstrate now

Verified 21 October 2026: https://teeyaii.github.io/Recruit-Health-Monitor/ responds HTTP 200 and runs the 15-slot demonstration. The repository is currently public. The publication instructions below describe the existing optional workflow, not an outstanding prerequisite.

The single-file static demo lives in **dashboard/index.html**. It runs in mobile Safari without a companion app.

- Shows 15 anonymous simulated slots R01–R15 with three slots per G01–G05.
- Start, stop, drop R03, drop G03 (R07–R09), restore and reset.
- 15-second stale cutoff: missing measurements display unknown, never zero.
- Synthetic WBGT entry with a 30-minute age indicator and fake-data CSV.
- Fictional R01–R15 profile editing (sample code, height, weight, example condition); operator-observed symptoms create clearly labeled amber/red actions in the same page. Reassigning a slot invalidates the prior person's readings and alerts.
- Absolutely no real Bluetooth, live API traffic, credentials or real health records.

The static demo is only a UI prototype, **not a clinical heat-injury detector**.

## How online updates are published

The existing public GitHub Pages URL is https://teeyaii.github.io/Recruit-Health-Monitor/.

Changes to the **fictional static dashboard only** automatically run both offline behavior tests on pull requests; after merging to main, the Pages workflow republishes **only** dashboard/index.html. The user does not need to push a Deploy button each time. The separate Render LIVE server is never redeployed by this Pages workflow.

GitHub Actions also permits a manual workflow_dispatch run when needed. GitHub Pages website visibility is public. **Never enter real recruit identifiers, weight/height, health diagnoses, medications or medical observations into the public Pages demo.** The editor intentionally keeps fictional values only in page memory; reloading the page resets them.

See [profile and observation alert prototype](PROFILE_ALERTS_MVP.md). Actual medical record storage, access controls and alert delivery are separate future tasks, not included here.

## Tests and current limitations

Run **cd server && npm test**. The automated static-demo test executes the inline script in a mocked browser to verify start/stop, drop/restore, gateway counts and WBGT. Other CI checks cover server integration and compile unsigned Android and iOS simulator targets.

The static demo does **not** deliver native BLE-to-server uploading, real multi-device pairing, actual field testing, hardware stability, clinical alert validation or persistent profiles. It is separate from the hosted Render LIVE backend, which currently has no real BLE feed.

## Next high-value engineering milestone

The native selection/assignment/uploader integration is implemented in PR #3. See [current setup and blockers](MVP_SETUP.md). Next: choose the live HTTPS host, supply Apple signing access if needed, and validate one authorized physical band. CI alone does not establish physical BLE readiness.

