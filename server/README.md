# Recruit Health Monitor — experimental backend

Node.js 20+; no third-party dependencies. It provides an authenticated JSON ingest endpoint, an authenticated snapshot, and a server-sent-events stream. It keeps only latest values in RAM (restart clears state). It is **not production-ready** and is **not a medical alert system**.

## Local launch

```sh
export RECRUIT_MONITOR_TOKEN='replace-with-a-long-random-secret-at-least-24-characters'
cd server
npm start
```

Use HTTPS termination and restricted network access before any deployment. Do not commit tokens or real recruit data. The single shared bearer token is a prototype only; per-gateway credentials, role-based viewer access, rate limiting, audit logging, and durable storage are still required.

POST `/api/ingest` with `Authorization: Bearer <token>` and JSON:

```json
{"gateway":"G01","readings":[{"id":"R01","hr":92,"timestamp":1792560000000}]}
```

`timestamp` must be epoch milliseconds within the last 60 seconds. Each request supports up to five readings. Gateways G01–G03 are accepted. Duplicate or older timestamps are ignored. Missing/stale values become null after 15 seconds. `GET /api/snapshot` and `GET /api/events` use the same authorization header. Browser EventSource cannot supply Authorization headers, so an authenticated browser-facing gateway or session mechanism must be added before wiring the web dashboard.

The existing dashboard is still an offline **simulation**, not connected to this backend. This backend has not been deployed or integration-tested with an Android device.
