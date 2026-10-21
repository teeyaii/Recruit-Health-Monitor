# STEVE 1.0 — iPhone demo (10-day MVP)

## Ready to demonstrate now

Verified 21 October 2026: https://teeyaii.github.io/Recruit-Health-Monitor/ responds HTTP 200 and runs the 15-slot demonstration. The repository is currently public. The publication instructions below describe the existing optional workflow, not an outstanding prerequisite.

The single-file static demo lives in **dashboard/index.html**. It runs in mobile Safari without a companion app.

- Shows 15 anonymous simulated slots R01–R15 with three slots per G01–G05.
- Start, stop, drop R03, drop G03 (R07–R09), restore and reset.
- 15-second stale cutoff: missing measurements display unknown, never zero.
- Synthetic WBGT entry with a 30-minute age indicator and fake-data CSV.
- Absolutely no real Bluetooth, live API traffic, credentials or real health records.

The static demo is only a UI prototype, **not a clinical heat-injury detector**.

## Publish the demo from iPhone, manually (optional)

1. Open your repository **teeyaii/Recruit-Health-Monitor** in Safari.
2. In **Settings → Pages**, select **GitHub Actions** for Build and deployment / Source. Pages support on a private repository depends on your GitHub plan. A published Pages site may be publicly viewable even though its repo is private.
3. In **Actions**, choose **Publish STEVE iPhone standalone demo** and tap **Run workflow** on main.
4. Once the deployment job reports success, use the real published URL shown in the GitHub Actions deployment result (do not guess a URL before deploying).
5. Open that address in iPhone Safari and optionally tap Share → Add to Home Screen.
6. Press **เริ่มจำลอง** and verify 15/15. Press **ตัดสัญญาณ R03**, then after 15 seconds verify 14/15. Press **ตัด Gateway G03** and check 11/15 after 15 seconds. Restore and stop.

**Important privacy distinction:** this publication packages only the standalone synthetic HTML file, but the resulting site may be public. Do not publish confidential assets or real recruit data there. The repository remains private unless the owner changes that explicitly.

If GitHub Pages is unavailable for a private repo, use another *static* host that supports a private source repository and upload **only dashboard/index.html**. This project does not include a verified live hosted URL or a deployment to a third-party account.

## Tests and current limitations

Run **cd server && npm test**. The automated static-demo test executes the inline script in a mocked browser to verify start/stop, drop/restore, gateway counts and WBGT. Other CI checks cover server integration and compile unsigned Android and iOS simulator targets.

The static demo does **not** deliver native BLE-to-server uploading, real multi-device pairing, actual field testing, hardware stability, medical alerts, or a deployed live backend. Those are separate tasks after the iPhone demo.

## Next high-value engineering milestone

The native selection/assignment/uploader integration is implemented in PR #3. See [current setup and blockers](MVP_SETUP.md). Next: choose the live HTTPS host, supply Apple signing access if needed, and validate one authorized physical band. CI alone does not establish physical BLE readiness.

