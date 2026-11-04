# STEVE Phase 1 engineering audit — 2026-11-04

Starting main: `639a57f73dcff6049d05264a221a3ac86666843f` (no open PRs; latest main CI successful).

## Existing behavior retained

AutoHRMonitor already required confirmed wearer-specific limits at the API boundary, real accepted samples and training; used at least five samples spanning 30 seconds within a 60-second window, broke continuity after 15-second gaps, screened jumps, ignored duplicate/out-of-order timestamps, and latched repeated triggers. Those criteria are unchanged.

MedicReviews already deduplicated/escalated pending cases, retained cases on disconnect, retried failed persistence and reloaded encrypted cases. One-save roster reassignment already cleared BPM/history/profile/review/monitor state, blocked queued samples through a cutoff, serialized archive removal, and protected unresolved recorded emergencies. Private monitoring already sorted slots numerically and enforced read-only access.

## Confirmed gaps and changes

* Trigger sample count, interval and BPM were discarded before case persistence. Add a bounded, validated evidence structure to automatic creation/escalation; retain original evidence for unresolved events and support older cases without evidence.
* Alert panels lacked wearer-specific measured explanations. Add deterministic Thai details to existing live/commander panels, explicitly label BPM as **at alert time**, show the timestamp, next action and signal-screening limitation. Preserve separate current BPM/NO DATA. Output only allowlisted evidence, never notes, thresholds, conditions or medications.
* Ingest interpreted any explicit state except DISCONNECTED as connected if it contained a BPM. Reject explicit unknown/non-live states. Omitted state remains supported, as used by existing Gateway packets. No change to valid-signal medical sensitivity or escalation.

## Validation and boundaries

Baseline: 137/137 Node tests passed. Expanded suite: 140 tests, including exact evidence, four independent streams, legacy-case compatibility, escalation, persistence/restart/failure retry, disconnect retention, invalid states, reassignment clearing, private viewer evidence and permissions, and escaped UI copy. Existing tests cover thresholds, spikes, duplicates, archive, BLE lifecycle, and emergency protection.

Browser regression adds expandable alert details alongside WATCH, numerical ordering, mobile layout and stale telemetry. Local Playwright browser download unavailable; hosted CI browser job is required before merge. Engineering fixtures are not clinical or Xiaomi/iPhone hardware validation.

No new thresholds, diagnoses, automatic emergency class, auto-close/return-to-training, external LLM, credential/provisioning changes, production data deletion, or added operator workflow.

## Release / rollback

Merge only after hosted backend, browser and Docker checks pass on the PR head. Deployment must be verified separately; merge is not deployment evidence. Roll back code to the starting main commit if necessary. Evidence is additive; the old loader accepts the extra field, so no database migration or health-record deletion is required. Clinical threshold validation and real-device field validation remain outside this engineering release.
