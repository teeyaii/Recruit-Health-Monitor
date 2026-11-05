# R05: fifth watch on G01 (Phase B, Issue #50)

Status: code and **simulated** tests only. Not yet verified on iPhone/Bluefy hardware. Baseline before this change: 4 watches on G01, with a 15-minute owner field test. The 60-minute endurance test was **skipped, not passed**.

## Why R05 was missing

1. **Configuration (primary).** The Gateway only offers a connect control for slots that the server authorizes for that Gateway (`/api/gateway/provision`, built from `STEVE_SLOT_MAP_JSON` plus `STEVE_SLOT_MAP_EXTRA_JSON`). The R03/R04 pilot added only R03 and R04 to G01 (`docs/G01_FOUR_BAND_FIELD_PILOT.md`), so R05 has never been provisioned on Render. The Gateway therefore correctly refuses to connect it, and the backend would reject its packets anyway (`slotIsAuthorized`).
2. **UI (secondary regression from #65).** Before #65, an unauthorized R05 at least showed a "รออนุญาตช่อง" card. #65 switched to provisioning-driven cards and hid unprovisioned slots entirely, so the operator saw R01–R04 with no hint that R05 existed.

## What this change does (`dashboard/gateway.html`)

- **Planned layout for display only.** G01 = R01–R05 and G02 = R06–R10. A planned slot that the server has not provisioned for **this** Gateway is shown as **"R05 • ยังไม่ได้ตั้งค่า"** with NO DATA and the required owner action. It has no connect control and cannot open the chooser or upload. G02 never shows G01 slots.
- **When R05 is provisioned** it appears as the fifth control, **เพิ่ม R05**. The operator types the 4-character suffix read from the physical watch, once. The Broad scan plus identity quarantine is preset, which is the same path as the R01–R04 quick buttons:
  - a named Band must match the suffix;
  - a UUID-only entry must pass the Share HR off/on check before any upload.
- **Suffix conflict check.** A suffix already owned by R01–R04 (or by any other bound slot) is rejected before the chooser opens. Duplicate or wrong watches are still rejected after selection.
- **After verification**, the existing safe store (`steve.gateway.verified-devices.v1`: browser handle ID, suffix and opaque assignment; never tokens or BPM) remembers R05:
  - the button becomes **เชื่อม R05 · XXXX**;
  - R05 joins **เชื่อมทุกเรือนที่จำไว้ (n/5)**;
  - after reload or login it reconnects automatically, with the same backoff and per-slot isolation as R01–R04.

The server needs no code change. Authorization stays in the slot map.

## Required Render change

R05 is authorized through a **separate** additive key, so no existing secret-bearing key is read or rewritten:

```
STEVE_SLOT_MAP_EXTRA_R05_JSON = {"G01":{"R05":"trial_g01_r05_20261105"}}
```

- `server/contract.js` accepts additional keys named `STEVE_SLOT_MAP_EXTRA_<NAME>_JSON`. They pass the same strict validation as `STEVE_SLOT_MAP_EXTRA_JSON`:
  - they may only extend gateways that already exist;
  - no duplicate R-slot or alias is allowed across all maps;
  - the server refuses to start if a rule is broken, and Render then keeps the previous deploy live.
- `trial_g01_r05_20261105` is an anonymous server alias. It is not the watch suffix, a MAC address or a person's ID.
- `STEVE_SLOT_MAP_JSON`, `STEVE_SLOT_MAP_EXTRA_JSON` (R03/R04) and every token stay untouched.
- To roll back, delete only `STEVE_SLOT_MAP_EXTRA_R05_JSON` and redeploy.
- Optional: register an anonymous R05 roster entry in the dashboard if 7-day history is wanted. Unregistered slots still show LIVE but are not archived.

## Connecting the fifth watch in Bluefy (after deploy)

1. Open `/gateway` in Bluefy and log in to G01. R01–R04 reconnect by themselves. Check that **เพิ่ม R05** is now shown instead of "R05 • ยังไม่ได้ตั้งค่า".
2. Read the 4 characters at the end of the fifth watch's Bluetooth name on the watch itself. Turn **Share HR** on for that watch.
3. Tap **เพิ่ม R05**, type the 4 characters, then tap **เชื่อมต่อ Band 10**. In the chooser, pick the entry ending with those characters; never pick R01–R04.
   - If the chooser shows only a UUID or "Xiaomi", follow the on-card **off/on check**: Share HR off, wait 15 s, on, then confirm. Nothing is sent before that.
4. Wait for **LIVE • Server acknowledged** on R05 while R01–R04 stay LIVE. The connect-all button should now show **(5/5)**.
5. Repeat the earlier checks for R05: Share HR off/on, walk out of range and back, reload. Then run the 60-minute 5-watch endurance test and record the drops per watch from each card's "รายละเอียด".
