# STEVE 2: proposed internal read-only contract v1

Status: design only; no endpoint, model call, production integration, or new permission is implemented by this document. Source inspected: main `01696266938982749d1d412cc1a4f010ebd227cd` plus PR #80 updated head `18c48317adcac264b04f6bb4a6721e312485691e` and independent review of Claude PR #81 `6e7f399f1e04df85964b0c409ca3dfe9f8a3e321`.

## Purpose and boundary

A future server-side, pure read-only adapter may produce `steve.shadow-input.v1` for deterministic descriptive analysis of the **current wearer only**. It must not infer diagnosis, core temperature, HRV, arrhythmia, clinical clearance, or an individualized clinical threshold from BPM. No external model or data export is authorized by this proposal. Existing clinical thresholds and operator workflows remain authoritative.

Build an immutable copy inside an authenticated trainer/medic request. The current authorization model gives these roles access to all registered slots; it does not provide per-recruit assignment ACLs. Legacy viewer, gateway bearer/cookie, and commander-link access must not gain private context through this adapter. Authorization must be checked again when any deferred result is delivered, including after session expiry/revocation.

Do not assemble a clinical snapshot by joining browser calls: they can represent different wearer versions and different times. Do not add a production API until a concrete consumer, data minimization review, tests, and owner approval justify it.

## Proposed minimal envelope

All times below are UTC epoch milliseconds; absence is `null` or an explicitly empty collection, never a normal result or zero BPM. Field names below define a proposed DTO, not an existing wire schema.

| Field | Meaning and limits |
| --- | --- |
| `schema` | Literal `steve.shadow-input.v1`; reject unknown versions. |
| `generatedAt` | Server assembly time; does not prove sensor clock accuracy. |
| `requestId` | Random correlation identifier with no identity encoded. |
| `assignment` | Internal slot, opaque request-scoped assignment reference, captured roster version and persisted acceptance cutoff. Never expose recruit code, MAC/device suffix, name, owner HMAC, or credential to an explanation consumer. |
| `window` | Requested start/end, available start/end, sample count; enforce start strictly after current reassignment cutoff. |
| `live` | Existing state, latest accepted sample timestamp, age, gateway connectivity, and BPM only when CONNECTED. Gateway heartbeat alone is not a live sample. |
| `series` | Actual accepted timestamp/BPM pairs, source, storage origin (`runtime_history` or `persisted_archive`), selection/compaction metadata and fetched time. No filled, interpolated or invented values. |
| `quality` | Explicit `available`, `stale`, `missing`, `insufficient`, `source_unavailable`, or `identity_changed` plus factual reasons; engineering checks do not define clinical safety. |
| `phase` | Explicit cohort phase and relevant recorded transitions with timestamps; not an individual exercise or rest confirmation. |
| `review` | Current case status and scoped evidence; persistence certainty separately represented. A pending/closed case is not evidence of notification delivery, human acknowledgement, or medical clearance. |
| `context` | Default empty; authorized purpose-specific fields may include confirmed baseline BPM, age/BMI and latest recorded WBGT with timestamp, source and freshness. Missing/unconfirmed values stay null. |

`assignment` is internal processing context, not a stable longitudinal patient identifier. Current persisted cutoff is an acceptance boundary, not proof of the physical handoff time. Roster version changes on non-assignment edits too; it is a read fence, not a wearer epoch. Archive owner is derived from slot plus code and can repeat when that code returns to the slot. Do not claim an immutable assignment UUID or cross-assignment history exists today.

## Assembly rules

1. Verify trainer/medic authorization, registered wearer, storage requirements, and absence of blocked/uncertain roster writes. Capture code, slot, roster version and reassignment cutoff before asynchronous reads.
2. Read only the current code-scoped profile/review/archive and current assignment's accepted points. Filter every point against the captured cutoff. Never substitute another slot, earlier wearer, or a cached result to make a window appear complete.
3. Recheck authorization and the captured identity/version/cutoff after every asynchronous source has settled and before output. On mismatch return an explicit unavailable result and discard all assembled private content. Current archive and medic GET routes already fence roster version across their archive await; a future adapter must preserve this behavior.
4. Keep source failures visible. A source-unavailable result is different from an empty successful query. Persisted archive only contains flushed closed minute buckets, so its newest point can lag runtime history. Medic GET currently returns archive-selected points when archive reads succeed, but derives signal/recovery from runtime history; do not label both as a single identical dataset.
5. For v1 use one declared series source per analysis, or implement a tested timestamp deduplication and provenance policy before combining sources. Preserve actual retained samples: history uses a 5-second step, archive a 7-second step, and archive compaction selects extrema rather than raw full-rate data. A zero count does not establish that the wearer had no pulse.
6. Snapshot storage status is not a per-case commit receipt. Do not label a transition durable based on a later unrelated write. If reconciliation cannot establish case persistence certainty, abstain from interpreting its closure. PR #80 now exposes validated per-revision persistence receipts; use its explicit uncertainty/readback states, and require the equivalent profile state before interpreting private context.
7. The adapter accepts no write callback, network/model client, or mutable store reference. Output cannot update roster, profiles, thresholds, phases, cases or acknowledgement state. Downstream explanations must reference factual source times, distinguish missing data and abstain when identity or quality is insufficient.

## Private context minimization

Free-text medications/conditions, audit details and identifying codes are excluded by default. Their presence in a trainer/medic endpoint does not authorize export. If a later approved purpose requires notes, use a separately reviewed allowlist and treat text as untrusted data, never instructions. Do not log complete private envelopes. Never include storage keys, authentication cookies/tokens, commander links or encryption material.

WBGT is the latest operator-provided value, not a historical environmental series. Existing freshness is 30 minutes. Baseline requires operator confirmation; a null baseline must not be replaced by a population estimate. Existing configured review threshold may be described only if needed and with its provenance, never chosen or adjusted by analysis. Engineering signal gates in recovery-shadow are not clinical thresholds.

## Required implementation acceptance tests (proposed, not executed here)

- Reject gateway, legacy viewer, commander and unauthenticated requests; recheck expired/revoked sessions before delivery.
- Reassign during archive await: discard all old profile, case, series and context; repeat with blocked/uncertain reassignment and reused code.
- Preserve null/empty/unavailable distinctions; stale or disconnected BPM is not current HR; online gateway with silent slot remains missing/stale.
- Include no points at/before cutoff; never mix two wearers or gateways; record series origin and compaction.
- Missing baseline/WBGT and unavailable archive cause explicit partial data or abstention, never invented values or clearance.
- Freeze/clone returned objects and compare all source stores before/after adapter execution to prove read-only behavior.
- Verify strict schema/allowlist, no private text/identity/secrets in default output or logs, and no network/model call.
- Preserve pending case status through signal loss and uncertain persistence; validate against the separately reviewed restart reconciliation implementation.

These are follow-up acceptance criteria, not claims that a new adapter or hardware validation exists.


## PR #81 compatibility review — 7 Nov 2026

The pure module is not yet an implementation of this envelope and remains disconnected from production. Independent review5809421930 identified three reproducible P2 findings: cutoff equality accepts a point rejected by backend; existingReview.evidence mismatches real autoEvidence; whole-window trend is described using final phase despite mixed training/rest. Claude owns these fixes. Existing tests281/281pass do not cover these three failing independent probes. No clinical or hardware validation is implied.

Before adapter integration, require corrected cutoff/evidence/phase behavior, enum and primitive validation for review fields, immutable allowlisted output, authorization and assignment fences, explicit source/provenance and case/profile persistence certainty. Do not use arbitrary nested inputobjects as outputfields.
