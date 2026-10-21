# STEVE 1.0 — recruit profile and supervisor alert prototype

## Scope and verification boundary

A **simulation-only** profile editor and human-triggered observation alerts are included in the standalone GitHub Pages demo at /dashboard/index.html.

The public demo must never be used to enter real names, service numbers, diagnoses, medications, personnel records, actual height/weight tied to people, or genuine medical observations. It has no login, no server API, no storage and no persistence across page reloads. Profiles exist only in JavaScript memory for interactive UX evaluation. They are not shared with the separate Render LIVE backend.

## What the demonstration now supports

- Select R01–R15, type an invented code with the mandatory DEMO- prefix.
- Edit **fictional** weight (kg), height (cm), example underlying conditions and medical caution flag.
- Change the person assigned to a slot; old pulse data, historical simulated readings and alert observations are immediately invalidated.
- Simulate the supervisor reporting **dizziness/weakness/nausea**. An orange STOP AND ASSESS action appears; move to shade/cool area, ensure observation and medical review.
- Simulate **confusion/slurred speech/loss of consciousness/seizure**. A red EMERGENCY action appears; summon medical response and initiate the local emergency cooling protocol.
- Simulate a separate medically approved caution/watch flag. It prompts supervision, not diagnosis.
- Keep stale/disconnected BLE or server readings distinct from clinical observations. Missing readings are unknown, not a green healthy status.
- No arbitrary heart-rate threshold, BMI cutoff or an underlying diagnosis can independently mark someone SAFE, SICK or EMERGENCY.

The UI offers **in-page visual alerts only**, not background push notifications, sirens, SMS, or medically certified decision support. A missing alert is never evidence of safety.

## Clinical policy required before a real rollout

A unit medical officer / authorized occupational medicine lead must approve:
1. Who may see specific medical details versus a simple duty restriction. In the instructor dashboard prefer only operational status and approved limits.
2. Which observed symptoms require stop / clinical examination / emergency response.
3. How to use activity intensity, acclimatization, hydration status, rest, environmental WBGT and medications. A heart-rate value alone cannot diagnose heat illness.
4. Notification acknowledgement, human escalation, contact numbers, fallback when phones or gateways lose signal, and absence-of-readings procedure.
5. After a person moves from one R-slot to another or leaves a session, revoke the prior assignment, detach observations, audit who changed it and prevent stale/older messages from reappearing.
6. Storage / retention / deletion, identity mapping, health-data legal basis and access review before any real personnel records are processed.

CDC/NIOSH 2026: https://www.cdc.gov/niosh/heat-stress/recommendations/
CDC/NIOSH illness descriptions: https://www.cdc.gov/niosh/heat-stress/about/illnesses.html
OSHA observed-symptom action guidance: https://www.osha.gov/heat-exposure/illness-first-aid

## Live deployment protection

STEVE is currently hosted as a **public static Safari demo** plus a separate Render Free LIVE backend that has only anonymous slot provisioning. **Do not put actual health histories into the static demo or Render Free service**. Real longitudinal health information needs a privacy/authorization and security review, role-based medical visibility, encryption, purpose limits and an appropriate service agreement and reliability plan. The existing Render Free instance can sleep and is not a safety-critical monitoring system.

### Minimal future private schema (design only — no production health data)

- recruit_record_id: nonidentifying internal primary key
- slot_assignment: session_id, slot R01–R15, gateway G01–G05, effective_from, effective_to and change author
- profile_version: measurements, risk-review timestamp and approved restrictions; detailed diagnosis only within separate clinician permissions
- observation_event: symptom selected by a human, time, observer, subsequent action and outcome
- sensor_event: timestamp, device pseudonym and validity; do not infer human wellbeing from a stale sensor
- alert_event: event ID, rule/protocol version, reason, severity, acknowledgement and escalation
- audit_event: record changes and access to sensitive details

These are design targets, **not** existing GitHub/Render tables or storage.

## Hardware status

No physical Xiaomi Smart Band 10, Android Gateway, signed iPhone app or field medical alert validation was used. Existing CI tests verify synthetic JavaScript behavior, not actual clinical accuracy.