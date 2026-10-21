# STEVE 1.0 — Equal Trainer / Medical Operator Access

## Scope and capabilities

Protected LIVE dashboard at /live now includes an operational R01–R15 roster. Trainer and medical operator have IDENTICAL permissions: view slots; edit anonymous codes, duty restrictions and observed symptoms; acknowledge observations; replace an occupant; confirm a physical reassignment; and view nonidentifying audit entries.

Production config uses two different secrets named STEVE_TRAINER_TOKEN and STEVE_MEDIC_TOKEN, 32+ characters each. Login returns a role-labeled operator session; audit records role, slot, action and time, NOT names or diagnoses. The existing STEVE_VIEWER_TOKEN remains a fully capable legacy operator login for backwards compatibility: don't use a shared login when role accountability is important. These are shared role credentials, not per-person accounts. Gateway-only tokens cannot read or write the roster.

## Anonymous data ONLY

Allowed fields: R01–R15, invented uppercase code 4–24 chars, restriction (none/watch/no_training), manually observed category (none/dizzy_weak_nausea/confusion_collapse_seizure), human acknowledgement, revision, pause flag and timestamp. They are NOT a diagnosis or risk score. Never enter real names, service numbers, dates of birth, medications, diagnoses or health histories on Render Free or the public GitHub Pages demo.

RAM is the default storage; a page refresh preserves edits while the same server stays running, but a server restart or Free Render sleep/recycle can erase them. Optional STEVE_ROSTER_FILE points to an atomic private JSON file (0600 mode) for development persistence on a separately provisioned private mounted volume. Render Free does NOT provide durable volume storage. This file option does not replace encrypted medical data storage, backups or privacy/legal review.

## How to activate the two logins on existing Render Free

The GitHub repository's render.yaml now includes generated trainer and medical secrets for NEW Blueprint deployments only. Existing Render service auto-deploy remains OFF. A merged GitHub commit does not update the currently running service.

1. Open the service's Environment in Render. Add two DIFFERENT private 32+ character secrets: STEVE_TRAINER_TOKEN and STEVE_MEDIC_TOKEN. Avoid sharing them in chat, screenshots, public docs or URLs.
2. Manually deploy the new main version, after both secrets exist. If only one operator secret is configured, the server deliberately refuses to start. Make sure /health returns ok:true.
3. On /live log in with either trainer or medic secret. Both accounts have the SAME create/update, replacement, acknowledge, context-write and audit permissions.
4. Enter only fictional/pseudonymous codes (e.g. DEMO-R01). Check edit, cross-role revision conflict handling, audit attribution and replacement isolation.
5. Replace stops that slot from accepting new BLE readings and clears the previous BPM. Verify the new physical wearer, band, app-assigned slot and Render slot/device map; only then check the confirmation box and Resume. Resume confirmation is a human assertion, not proof of wearer identity.

## API behavior

All operator roster URLs require the login cookie. Gateway bearer credentials are insufficient.

- GET /api/operator/me: current role and same permissions
- GET /api/roster: 15 slots and ephemeral storage flag
- PUT /api/roster/R01: body { "version": 0, "code": "DEMO-R01", "restriction": "watch", "observation": "none" }
- POST /api/roster/R01/replace: { "version": 1, "code": "DEMO-R01B" }
- POST /api/roster/R01/resume: { "version": 2, "confirmed": true }
- POST /api/roster/R01/acknowledge: { "version": 1 } when a symptom has been recorded
- GET /api/roster/audit: last 100 nonidentifying audit events

Writes validate data shape, code uniqueness, optimistic revision and same-origin browser use. A change in occupant code requires Replace (not an ordinary edit), to prevent old readings being mistaken as the next person's. Reassignment PAUSES BLE ingestion until operator confirmation.

## Limitations

The new action banners show manually chosen observed symptoms, NOT an automated clinical diagnosis or medically validated alarm. A missing alert does not mean safe. Render Free may suspend operation, lacks durable disk and should not be relied upon for continuous health/safety monitoring. Actual records, specific clinician restrictions, backup, retention/erasure, personnel-account identity, 24/7 monitoring and hardware verification remain future deployment gates requiring a suitable infrastructure and approved clinical procedures.
