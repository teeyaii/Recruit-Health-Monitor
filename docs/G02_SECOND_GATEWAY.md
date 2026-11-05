# G02: second physical gateway for R06–R10 (Phase C, Issue #50)

Baseline: G01 runs R01–R05 on one iPhone/Bluefy, 15 minutes stable (owner report). The 60-minute test was skipped.

## Server authorization: no existing key is read or rewritten

`server/contract.js` accepts a **gateway-named** additive key, `STEVE_SLOT_MAP_EXTRA_G02_JSON`:

- It may contain **only** G02. If G02 is not yet in the base map, this key may introduce it.
- G02 must already have a credential (`STEVE_GATEWAY_TOKEN_G02`), otherwise startup fails.
- No R-slot or alias may repeat across any map (base, R03/R04 extra, R05 extra, G02). A collision makes the server refuse to start, and Render keeps the previous deploy live.
- Other extra keys still cannot introduce a gateway.

Value used (anonymous server aliases; not watch suffixes, MACs or personal IDs):

```json
{"G02":{"R06":"trial_g02_r06_20261105","R07":"trial_g02_r07_20261105","R08":"trial_g02_r08_20261105","R09":"trial_g02_r09_20261105","R10":"trial_g02_r10_20261105"}}
```

To roll back, delete only `STEVE_SLOT_MAP_EXTRA_G02_JSON` and redeploy. G01 is unaffected.

## Owner-only items (Claude cannot do these)

1. **G02 credential.** In Render → Environment, confirm `STEVE_GATEWAY_TOKEN_G02` exists. `render.yaml` generates it. Copy it only into the second iPhone and never paste it into chat or GitHub. If it is missing, create a random value of at least 32 characters, unique from every other token, then redeploy.
2. **Watch suffixes.** Read the last 4 characters of each R06–R10 watch's Bluetooth name from the watch itself, and label the watches.
3. **Pairing on the second iPhone.** The steps are below.

## Pairing on the second iPhone (Bluefy)

1. Set Auto-Lock to Never, charge the phone, and open `https://steve-1-0-live-gateway.onrender.com/gateway` in Bluefy.
2. Choose **G02**, enter the G02 code, and tap เข้าใช้งาน. The phone should show **เพิ่ม R06 … เพิ่ม R10** and must not show R01–R05.
3. Pair one watch at a time, with Share HR on only for the watch being paired:
   - tap **เพิ่ม R06**;
   - type its 4-character suffix and tap **เชื่อมต่อ Band 10**;
   - pick the entry with that suffix;
   - wait for **LIVE • Server acknowledged**, then repeat for R07–R10.
   - If the chooser shows only a UUID or "Xiaomi", follow the on-card Share HR off/on check.
4. Keep G01 streaming R01–R05 the whole time. On `/live` all 10 should show LIVE with the correct wearer per slot.

## Acceptance checks (5+5)

- 10 LIVE + ACK at the same time, with no BPM appearing under the wrong slot.
- Close Bluefy on G02: R06–R10 become STALE/NO DATA within about 15 s, and R01–R05 stay LIVE. Reopen and log in: R06–R10 reconnect by themselves.
- A second phone logged into G01 or G02 cannot take over live slots (409). It can only take over after the first phone has been silent for 120 s.
- Run 15 minutes, then 60 minutes if time allows. Record drops per watch from each card's "รายละเอียด".
