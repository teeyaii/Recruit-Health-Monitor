# STEVE Phase 2 — Recovery / Personal Pattern Shadow Research

Status: engineering research feature, **not a medical-alert rule**.

This additive feature uses existing accepted BPM samples from the in-memory/encrypted 4-hour history plus the group's existing **explicitly recorded** training-to-hourly-rest transition. No new user input, watch pairing, server store, model/API cost or collection of extra personal data is needed.

## What it computes
- Once the recorded rest phase has lasted at least four minutes, compare observed **median BPM** in the first two minutes with median BPM in minutes two to four.
- Report the **signed descriptive change** (late minus early), observed sample counts and timestamps.
- When an authorized private clinical profile has a **confirmed measured resting baseline**, show the late window's difference from that baseline, without using it for a risk verdict.
- Signal-quality heuristic: at least three readings across 30 seconds in each window, coverage of early and late parts of the four-minute interval, and no gap over 45 seconds or jump >=45 BPM within 15 seconds. These are **research data-availability rules, not clinical cutoffs**.
- If no training-to-rest transition exists, the cohort phase is changed, evidence is incomplete, or the data is inconsistent, respond with a neutral missing/quality status. Never interpolate or infer an unobserved activity.

## Scope and privacy
- Research is calculated on request at the **existing authenticated trainer/medic MEDIC REVIEW endpoint**, and is presented as a short Thai paragraph inside the **existing collapsed medical review panel**.
- Ordinary monitoring snapshots, commander/private read-only API, Gateway, and automatic sustained-HR rules **never receive or act on this result**.
- No shadow result opens, escalates, closes or acknowledges a MEDIC case. It never changes WATCH, EMERGENCY, thresholds, training clearance, or real-world advice.
- It has no persistence schema, no new retention policy and no database migration. Existing save-once wearer reassignment resets that slot's previous BPM/profile/history; the shadow output consequently stops using the old wearer's data.
- **Cohort rest state does not prove an individual actually stopped exercising.** Wrist PPG during exercise suffers motion artifacts; a descriptive trend cannot diagnose heat illness, assess readiness, or show that a person is safe.
- This is not a clinically validated heart-rate-recovery protocol. It is a hypothesis-generation and display tool only. Any future alert rule requires clinical supervision, validation and explicit owner authorization.

## Verification
- Unit tests cover observed trend, missing/unapproved baseline, invalid phase, incomplete interval, discontinuities/spikes, duplicate points and historical isolation.
- API integration tests use accepted mock Gateway packets, check clinician-only access, verify no new clinical cases or ordinary snapshot leakage, and confirm single-save reassignment clears prior readings.
- CI tests are **software tests only**, not a real Band 10, iPhone/Bluefy, or clinical validation. No change to existing field operating procedures.

## Rollback
Revert the feature commit/PR to remove the research property and the one display paragraph. No data migration or teardown is required; Phase 1 sustained-HR and cases remain unchanged.
