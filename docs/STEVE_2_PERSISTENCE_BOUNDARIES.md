# STEVE 2 persistence boundary audit

Static source audit at main `0169626` plus PR #80 head `e3e0ea3`. This document adds no production behavior. The observations below are code-derived unless a separate executable test result is cited. No physical watch, production database, secret, or deployment was used.

## Confirmed ordering: archive deletion is not atomic with wearer save

`server/index.js:updateRosterSafely` awaits `archive.forget(slot)` before creating/saving the replacement secure-state snapshot. `server/rolling-archive.js:forget` clears pending slot entries, advances an in-memory generation and queues a remote DELETE of all rows for that slot. The later `durable.save(next)` writes a different storage resource. Its compensation writes the old runtime snapshot, not deleted archive rows.

Consequently, if archive DELETE succeeds and the following snapshot save fails, an operator can receive a failed reassignment while the old wearer remains active and the old encrypted archive has already been removed. DELETE committed with a lost acknowledgement can produce the same loss before the snapshot write is even attempted. The archive's in-process generation prevents some failed pending writes from being reinserted after forget, but does not restore deleted records or implement a cross-resource transaction.

This is a data-retention/operation-consistency finding, not evidence that a new wearer sees old-wearer data. Existing owner filtering, read fencing and reassignment cutoff are separate protections. A failed read or empty archive must not be represented as a complete clinical history.

Smallest follow-up issue: **Make wearer reassignment and archive cleanup recoverable across partial failure.** Add a local mock regression that seeds encrypted closed archive buckets; commit DELETE, fail state save, restart and inspect old wearer plus archive. Repeat DELETE-commit/ACK-loss, state-commit/ACK-loss, failed compensation and retry. Define desired retention semantics explicitly. Prefer a persisted assignment/cleanup intent and cleanup after confirmed assignment commit, with current-assignment filtering throughout; merely reversing two awaits is not a sufficient transaction or crash-recovery design. Require no cross-wearer samples, no false success, and deterministic restart reconciliation. Keep API/UI and clinical thresholds out of this issue.

## Reproduced defect: private-profile rollback is only in memory

`server/index.js` private-profile PUT updates the in-memory record, awaits `persistState()`, and on failure rolls back that record and marks history dirty. `server/durable-state.js:save` performs a remote upsert and treats a failed response as an error; a server commit can occur before response failure. Unlike PR #80's manual review compensation, this private-profile handler does not immediately compensate the remote snapshot in the same queued operation.

An isolated child-process reproduction on the inspected PR #80 head confirmed this defect. The mock persisted an encrypted changed profile and then threw an acknowledgement-loss error. PUT returned 503; a GET in the same process showed the rolled-back weight 72 kg and version 1. After terminating before the periodic save and restarting against the same mock snapshot, GET returned the unconfirmed weight 80 kg, changed condition note and version 2. The reproduction completed with 1/1 passing assertions (asserting the defective behavior); it is not a passing safety regression or evidence of a production occurrence.

The temporary test was derived from `server/storage-api.test.js`, replacing only the child-process mock fetch and scenario. No production network or data was used. Reproduction sequence: seed registered R01 and profile version 1; arm a mock flag that writes the snapshot before throwing; PUT profile version 1 with changed weight/conditions; assert 503 and runtime version 1; stop immediately, disarm flag and restart; assert restored version 2. The whole profile is persisted together, including baseline and review-threshold confirmation fields, but this reproducer changed only weight and conditions and makes no claim of tested threshold effects.

Smallest follow-up issue: **Reconcile unconfirmed private-profile writes across restart.** Turn this reproducer into a mandatory safety regression expecting the prior confirmed profile (or an explicit fail-closed reconciliation state) after restart. Cover failure before commit, committed-write/ACK-loss, compensation failure, later queued writes and retry. Use durable-operation reconciliation rather than relying on the dirty-state timer or assuming failed HTTP means failed commit. Keep production thresholds, UI and PR #80's case-lifecycle scope unchanged.

## Limits relevant to clinical interpretation

- Secure state and archive writes use separate requests. The local write queues do not establish database transactions, distributed locks, multi-instance ordering or compare-and-swap semantics.
- Archive pending samples and runtime connectivity are not durable. Ingest acceptance does not prove that every point reached encrypted archival storage before a process failure.
- Archive identity is slot plus normalized code; it is not a persistent assignment interval UUID. Normal reassignment deletes slot archive rows, but historical code reuse must not be used to assert longitudinal identity.
- SSE publishes current snapshots, including an initial snapshot on connection. It does not maintain a durable event queue, event acknowledgement or human delivery receipt. Reconnection and clinical acknowledgement are different events.
- Current trainer/medic private read routes authorize by role. They do not enforce an individual-patient assignment ACL. Commander output excludes private profile detail; a future AI adapter must preserve this boundary.
- Missing, stale or disconnected readings cannot establish normality. Current status projection suppresses live HR outside CONNECTED; a gateway heartbeat alone cannot make each wearer live.

PR #80 restart/case reconciliation is tracked independently by the parent implementation. These residual boundaries must not be described as fixed merely because its manual-review regression passes.


## Implementation follow-up — 7 Nov 2026

PR80 updated18c4831 adds case receipts and explicit uncertainty/readback reconciliation; its CI backend/Docker/browser allpass(run42232477107). Privateprofile fix now independently tested286/286 on the updated80base: staged writes, compensation, receipt/readback and private-read blocking. These recognize ambiguous outcomes rather than promise rollback that never committed. Archive cross-resource consistency remains tracked in Issue83. PR84 fixes preboot telemetry replay with bounded startupfloor; full main+patch274/274pass. Commander QR prior failure is tracked82; latest80CIpasses but that alone does not establish a rootcausefix.
