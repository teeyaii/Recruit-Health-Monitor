# STEVE 1.0 — deploy an HTTPS LIVE backend from iPhone

**Status:** Deployment configuration is committed and tested, but **no Render service has been created by ChatGPT**. The existing GitHub Pages URL remains a separate, browser-only SIMULATED demonstration. Do not use Render Free for continuous safety monitoring.

## One-tap prepared Blueprint

Open this public-repository shortcut from iPhone Safari:

**https://render.com/deploy?repo=https://github.com/teeyaii/Recruit-Health-Monitor**

1. Sign in to a Render account. Review the selected instance **plan: free**; do not select a paid plan.
2. Review render.yaml: one Docker web service in Singapore; autoDeployTrigger: off; no database; root Dockerfile, port 8080 and health check /health.
3. When Render asks for STEVE_SLOT_MAP_JSON, enter a **test-only, operator-approved** mapping. To begin with one fictional band slot, use:
   {"G01":{"R01":"demo-opaque-001"}}
   This is only a placeholder, not a person's identity or Bluetooth MAC address. The native Gateway must enter the same opaque ID when pairing that band. Later extend to more slots/Gateways and redeploy.
4. Render generates six distinct secrets: STEVE_VIEWER_TOKEN and STEVE_GATEWAY_TOKEN_G01 through STEVE_GATEWAY_TOKEN_G05. The backend accepts these individually; you do not need a JSON secret bundle.
5. Confirm the **free** plan and start deployment. Wait for Render to provide the real https://<your-service>.onrender.com origin. GET /health must return {"ok":true}. Open /live and sign in using the generated viewer secret copied privately from Render's Environment settings.
6. On an authorized test Android/iPhone native Gateway, enter that HTTPS origin, G01, the generated G01 credential and the same opaque ID for R01. Never paste secrets into chats, GitHub, tickets, browser URLs or screenshots. The Safari GitHub Pages demo does not upload BLE measurements.

The LIVE dashboard shows **NO DATA** until an authenticated Gateway supplies measurements. This is expected: production LIVE mode explicitly blocks SIMULATED packets.

## If no device is available yet

You can validate /health, viewer login and the empty 15-slot snapshot on the LIVE dashboard. The all-slots simulated HTTP/SSE integration tests remain in GitHub Actions. Do not fabricate values in production LIVE mode.

## Runtime limits and operational cautions

- NODE_ENV=production and COOKIE_SECURE=1 are configured; five credentials are generated. Slot map is supplied privately at deployment time.
- Server state is in memory only; restart or sleep clears readings and sessions, and devices must reconnect.
- Render Free web services may spin down after **15 minutes of inactivity** and require a warm-up request. This is **not suitable for uninterrupted training, life-safety or emergency monitoring**.
- One cloud instance is sufficient for a demonstration, not proof of multi-band BLE reliability, phone background operation, personal data authorization or medical suitability.
- Continue WBGT measurements, direct human supervision and established emergency procedures outside STEVE.
- If a Free Blueprint/service is not available in your account, stop and ask about alternatives; do not incur charges.
- To update STEVE_SLOT_MAP_JSON later, edit the environment setting in Render and manually redeploy. Blueprint sync: false prompts only during initial creation.
- After new GitHub commits, use Render's Manual Deploy; auto deployment is intentionally off.
- The GitHub Pages URL is a standalone offline SIMULATED web page and **not** a LIVE backend.

## Verification checklist

- Render confirms deployed HTTPS service; GET /health returns ok:true.
- Viewer login reaches /live showing NO DATA until a real gateway connects.
- The chosen G01 test slot uses a deliberately non-identifying opaque device ID.
- Native mobile app installation, real BLE compatibility, connection stability and human-led field testing remain pending.
