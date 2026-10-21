# STEVE backend contract

Node.js 22; no third-party packages. Latest measurements only in volatile memory (maximum 15 slots), no historical database.

## Runtime configuration

For LIVE/production provide all of:

- `NODE_ENV=production`
- `COOKIE_SECURE=1`, behind HTTPS termination
- `STEVE_VIEWER_TOKEN`: 32+ character secret
- `STEVE_GATEWAY_TOKENS_JSON`: JSON mapping G01–G05 to distinct 32+ character secrets
- Alternatively, individually supplied `STEVE_GATEWAY_TOKEN_G01` through `STEVE_GATEWAY_TOKEN_G05`: each 32+ characters and unique (Render Blueprint generates these). Do not combine individual credentials with the JSON bundle.
- `STEVE_SLOT_MAP_JSON`: JSON mapping gateways to slot → opaque-device-ID bindings

A schematic mapping is `{"G01":{"R01":"opaque-device-01"}}`. Runtime IDs are 4–64 alphanumeric/underscore/hyphen characters; use opaque IDs, never names or Bluetooth addresses. Slots and device IDs must be globally unique. Strict mode fails closed without a map. Tokens belong in the hosting service's secret settings, never source or public screenshots.

## Gateway API

`POST /api/ingest`, `Authorization: Bearer <gateway credential>`:

```json
{"gateway":"G01","readings":[{"id":"R01","device_id":"opaque-device-01","hr":83,"timestamp":1792587600000}]}
```

The timestamp above is schematic: send the actual measurement time as integer Unix milliseconds. Allowed BPM: 25–240; at most 15 items per batch. A reading more than 15 seconds old or over 1 second in the future is rejected. The server retains an event high-water mark per slot so retries/older events cannot restore disconnected data.

A disconnect/contact-loss event uses the same slot and device ID with `"state":"DISCONNECTED"` instead of HR and the actual event timestamp. This immediately clears current BPM and preserves the previous measurement timestamp. An empty readings array is a gateway heartbeat; it never refreshes individual measurements.

HTTP 200 includes `accepted` and `received`. A rejected item does **not** become successful merely because HTTP is 200. Clients display rejection and wait for new measurements. Malformed/unauthorized items are not stored. Strict mode enforces gateway identity and the provisioned device/slot map.

## Viewer API

`POST /api/login {"token":"..."}` sets an HttpOnly SameSite=Strict session cookie. The viewer cannot ingest. `GET /api/snapshot` and `GET /api/events` return 15 slots with BPM (null when unavailable), last measurement timestamp, state, gateway, gatewayOnline and source. `GET /api/gateways` returns five gateway states. Data older than 15 seconds becomes STALE even if heartbeats continue.

`POST /api/context {"wbgtC":29.5}` is viewer-only manual WBGT; `GET /api/context` marks it stale after 30 minutes. No clinical risk scoring.

`/live` is the live dashboard. Disconnect/logout clears cached rows. The standalone Pages demo is independent.

## Synthetic mode

Only in a non-production test environment:
- `RECRUIT_MONITOR_TOKEN`: shared test credential (legacy compatibility, never production).
- `STEVE_DEMO_MODE=1`: viewer start/stop/drop/drop-gateway/restore controls.
- `STEVE_SYNTHETIC_MODE=1`: external simulator ingest, without operator demo controls.

Synthetic ingest requires top-level `"source":"SIMULATED"`; live servers reject that source. Synthetic settings are disabled in production. Tests use invented fixtures only.

`npm test` includes a real HTTP/SSE integration test executing the actual dashboard script in a DOM harness; this is not a physical browser or BLE device test.


## Optional Render Free one-tap provisioning

See [Render Free setup](../docs/RENDER_FREE_SETUP.md) and root [render.yaml](../render.yaml). A manually approved Render deployment creates a Docker LIVE backend with six generated secrets, then prompts for the anonymous slot-map JSON. The repository and ChatGPT do not automatically deploy to an external account; the resulting Free service may sleep and is not intended for continuous human health/safety monitoring.
