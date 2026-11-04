# STEVE P0 — private commander read-only Dashboard (owner-approved, 4 Nov 2026)

## Objective
Let the commander open a **private** link or scan a locally generated QR without entering any password. The commander sees only live R-slot/BPM, LIVE vs NO DATA, WATCH, EMERGENCY, automatic PAUSE/CHECK, group training state, a pending Medic count, and gateway connectivity.

**No direct public patient telemetry.** The public `/commander` HTML has no health values until an operator-issued capability is exchanged for a scoped session. A private link is a bearer credential: anyone who obtains it may see anonymized slot telemetry until expiry or revocation. Do not share it publicly or include it in screenshots.

## Operator workflow
1. In the original STEVE `/live`, authenticate with an authorized trainer/medic or existing operator credential.
2. Open the **จอผู้บังคับบัญชา • เปิดดูอย่างเดียว** panel.
3. Tap **สร้างลิงก์ส่วนตัวใหม่**. A 256-bit random capability valid for 7 days is created; only its SHA-256 digest is saved in the existing encrypted Supabase snapshot. Generating another link invalidates the previous one and all prior commander sessions.
4. Tap **คัดลอกลิงก์** or **แชร์ผ่าน iPhone**, or display the **self-hosted/offline QR** in the operator panel for another authorized device to scan. Do not use a third-party QR generator that receives the private URL.
5. The viewer opens `/commander#view=...`. The secret is kept in the URL **fragment**, never sent via ordinary URL query/referrer, and exchanged via same-origin POST for an HttpOnly SameSite=Strict cookie scoped to `/api/commander/`. The browser removes the fragment from its address bar after reading it.
6. The commander page receives filtered data from only `/api/commander/snapshot`. There are no edit forms, incident log fields, registration actions, or health profile access. Server-supplied timestamps are checked for freshness; readings >15 seconds old are NO DATA.
7. To revoke, the operator taps **ยกเลิกลิงก์เดิม**. Existing commander cookies become invalid. Operator may create a replacement link.

**Expiration:** The link expires after seven days. Commander cookies expire after eight hours or at link expiry (whichever first). Reopening the *original shared link* can reauthorize while valid; a bookmark of the fragment-free page alone cannot. Operators regenerate links as needed.

## Security and persistence
- New commander authority and operator authority are independent. `steve_command` cookie does not authenticate `/api/roster`, `/api/training`, `/api/context`, `/api/medic-reviews`, `/api/ingest`, `/api/private-profile`, or Gateway provisioning.
- Private data never appears in read-only payloads: wearer names, custom roster codes, medications, medical conditions, BMI, personal history, and device IDs are excluded.
- Read-only link issuance and revocation **fail closed** (HTTP 503) unless encrypted Supabase persistent state is configured and writing succeeds. Production cannot enable test-only ephemeral issuance; `STEVE_TEST_EPHEMERAL_COMMANDER` is effective only when `NODE_ENV=test`.
- The link secret itself is **not** persisted, so after refreshing the operator page it must be recovered from the copy that was shared; if lost, generate a new link.
- Do not paste links with fragments into chat or repository issues. Never load third-party scripts on the commander page.
- All links are invalidated if revoked, replaced, or expired. Browser sessions do not survive a Render process restart, but an unexpired private link can reauthenticate because its digest is encrypted and persisted.
- Render Free may spin down with inactivity or be briefly unavailable during deployments; this is a prototype and not a sole real-time recruit safety monitor.

## Existing flows preserved
- `/gateway` Bluefy G01/R01–R04 BLE, provisioning, data ingestion, and acknowledgment are unchanged.
- `/live` retains operator registration, essential private health information for monitoring, automatic screening, WATCH/EMERGENCY presentation, activity phase buttons, WBGT, graphs, and medical review summaries.
- Remove **manual symptom/incident entry**, `รับทราบเหตุ` button and manual MEDIC reason/note/request forms from the ordinary operator UI.
- A prior manual EMERGENCY/WATCH symptom already in the roster does not disappear automatically when incident forms are removed. Authorized operator may use a single **สิ้นสุดสถานะเหตุเดิม หลังเจ้าหน้าที่ประเมินแล้ว** action for that specific legacy observation after clinical review, with a confirmation dialog, optimistic concurrency check and normal roster audit. No note entry, new incident creation or automatic medical-case clearing occurs. It remains hidden for ordinary slots with no legacy observation. Historical observations and previously opened reviews remain in storage, and existing API format remains backward compatible. A single authorized **close after assessment** action remains for unresolved medical reviews: the trainer/medical responder must assess first, not fill in forms during an emergency.
- No new AI model is deployed, no diagnostic medical claims or validated automatic return-to-training decisions are made, and no Native iOS/background BLE changes are included.

## Validation checklist before deploying
- CI: backend API authorization and revocation, SHA-only state unit tests, browser commander mobile rendering, offline QR creation, Docker production smoke.
- Verify the running Render service still has encrypted Supabase persistence; the operator creation endpoint returns 503 if it does not.
- Deploy only the reviewed commit from main during an authorized test window; preserve existing env vars and BLE slot map unchanged. An update briefly restarts services, so do not deploy during real training/safety monitoring.
- Authenticated operator creates a link and scans QR on a **different** device. Confirm four R slots show only anonymized IDs and fresh BPM when real Band notifications arrive.
- Check private viewer cannot PUT/POST updates, retrieve health profiles or inspect roster codes.
- Operator revokes the link; commander should lose access on next refresh. Regenerate and retest. No secrets should appear in screenshots or logs.
- If the URL opens but share creation returns 503, do **not** turn off persistence gating or make metrics public. Verify the existing encrypted state configuration privately and retry.
