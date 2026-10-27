# STEVE 1.0 — pre-presentation audit, 27 October 2026

Scope: repository engineering review, isolated synthetic HTTP/storage/BLE mocks and existing automated tests. No production deployment, medical records, secrets, device mappings or Supabase schema changes. No physical iPhone/Bluefy retest performed by this audit. Existing user-confirmed two-band field tests are not a validation of clinical accuracy.

Baseline main: `870be3f5f0bb3e158cd27e9552951eda481067fc`. Baseline 116 Node tests passed. GitHub backend workflow [40509916186](https://github.com/teeyaii/Recruit-Health-Monitor/actions/runs/40509916186) completed successfully. No open issues/PRs were returned at initial recovery.

## Findings and small fixes

| Severity | Evidence / consequence | Action |
|---|---|---|
| P1 | Gateway bearer could GET full snapshot/events, including automatic review flags belonging to other slots. Ingest also disclosed case creation count and clinical storage error text. | Viewer session required in strict mode; remove case details from Gateway response. Preserve ingest/provision and isolated legacy development contract. |
| P1 | Existing SSE clients remained subscribed after viewer session logout/expiry. | Revalidate session before every publication; close revoked streams. Tests exercise logout and expiry with an isolated clock. |
| P1 | Auto alert publication waited for remote persistence, potentially delaying urgent visibility. | Publish accepted measurements/precautionary alert before awaiting storage. Mark failed save for retry without needing another reading. |
| P1 | Pending manually opened review suppressed automatic pause/check banner because openedBy was not system. | Escalate same pending ticket using an encrypted boolean and increment its version; preserve original author, reason, notes, timestamp; no duplicate ticket. |
| P2 | AutoHRMonitor reset its confirmation/latch on duplicate or older timestamps. HTTP filtering masked this at the normal entry point. | Ignore replay/out-of-order inputs without changing existing state. |
| P1 | Checkbox was described as clinician verification; no individual approver identity, credentials, activity scope, expiry or approval reference is verified. | Explicit MONITORING NOT CONFIGURED / clinical-approval-unverified wording; distinguish experimental operator configuration. Clinical approval remains a release blocker; existing trigger policy is not silently changed. |

No P0 exploit was confirmed in the inspected paths. This is not an exhaustive penetration-test certification.

## Important unresolved engineering findings — production hold

1. **P1 concurrent mutation/rollback:** private-profile and Medic Review PUT handlers snapshot and restore the whole store when remote save fails. Another request or automatic case may modify that store while the first awaits persistence; restoring the old whole-store snapshot can discard that newer work. `writeQueue` serializes saves, not transactions. Roster and group phase also mutate memory before durable acknowledgement. Requires transaction-level regression tests and a focused concurrency fix, not a blanket claim that optimistic version fields solve it.
2. **P1 reassignment during await:** request handlers capture wearer code before reading an asynchronous request body or archive query. Roster replacement can interleave. Reassignment cutoff is set after `archive.forget()`; failure/delay creates an avoidable acceptance window. Ordinary sequential replacement tests pass, but concurrent replacement is not certified.
3. **P1 alert recovery:** a successfully persisted pending case survives restart. A process killed before any successful save can lose a case. There is no independent durable incident queue. AutoHR latch itself is memory-only; reconnect, long gap or restart can rearm after a human closes a case. No change to clinical rearming policy was made.
4. **P1 clinical approval:** trainer and medic deliberately have equal existing permissions and shared role credentials. Role is not personal/professional identity. Checkbox alone must not be represented as approval. A proper attributable approval workflow requires professional governance before operational reliance.
5. **P2 close semantics:** authorized role can close a review with an empty note; no separate assessment evidence/acknowledgement requirement. Closing never changes roster restriction or grants medical clearance, but the banner disappears. Clinical workflow owner must define the evidence required to close and resume.
6. **P2 quality observability:** sudden-jump heuristic resets confirmation and returns check_sensor internally, but does not expose a persistent sensor-quality advisory to the commander. Do not imply a missing alert means reliable/normal physiology. Adding a new alert policy requires clinical review.
7. **P2 retention/availability:** archive deletion runs on boot and hourly while service is awake, not independently in the database. Retention may exceed seven days during shutdown; pending minute buckets can be lost on restart. In-memory retries can accumulate during extended archive outage. Live Supabase grants/RLS and Render settings were not inspected; SQL files show RLS and service-role-only access but are not evidence of deployed configuration.

These findings are recorded rather than rushed into a broad architectural change immediately before the presentation. Do not treat this patch as full live-operation approval.

## Clinical principles and evidence

| Topic | Implementation and interpretation | What still needs validation |
|---|---|---|
| Resting HR | Private measured baseline; descriptive comparison restricted to recorded hourly rest with a waiting interval. | Repeatable measurement protocol, day-to-day variation, posture, illness, hydration, individual context. A resting baseline is not an exercise intervention limit. |
| Exercise HR | Individual operator-entered threshold, no generic default. | Activity intensity, fitness, heat, medication and clinician-defined intervention plan. Exercise tachycardia alone is not a diagnosis. |
| Recovery | Trend chart and descriptive recent average. | No validated timed HR-recovery protocol or fitness/return-to-training decision. NIOSH recovery procedures cannot be transferred to arbitrary PPG windows. |
| Heat / WBGT | Manually entered WBGT with stale indication; no direct core-temperature measurement. | Local workload, clothing, environment, rest and hydration protocol. HR alone cannot establish or exclude heat stroke. |
| Acclimatization | No automatic acclimatization model. | NIOSH recommends gradual exposure over 7–14 days; individual response differs. Not inferred from a single HR baseline. |
| Medication | Protected text context, not an automatic dose/threshold rule. | Clinician medication review. CDC identifies several classes affecting heat tolerance; do not infer safety from lower HR or change medication automatically. |
| Optical PPG | Accepted BPM and a sudden-jump heuristic. | Published accuracy varies by device/exercise. No retrieved study validates Xiaomi Band 10 with this exact activity/Bluefy pipeline. Compare to an appropriate reference under intended movements. |
| Missing data | Server freshness 15 s, stale/disconnected yields null BPM; UI shows NO DATA. | Real phone/background/sleep/network failure drills; missing values are never reassuring. |
| Human response | Severe observed symptoms have independent EMERGENCY workflow and SOP direction. | Do not wait for HR confirmation to respond to severe symptoms. Only appropriate personnel assess and decide resumption. |

The five-sample / 30-second confirmation, 15-second continuity gap, 45-BPM jump heuristic, 60-second below-limit rearming and 60–220 input range are **unvalidated engineering parameters**, not clinical standards. There is temporal rearming but no separate BPM hysteresis band. Threshold equality counts above-limit. Repeated motion artefacts can reset/delay confirmation; a sustained artefact can still trigger. No sensitivity, specificity or validated clinical risk score is claimed. This patch does not alter these numeric rules.

Sources reviewed (27 October 2026):

- [CDC/NIOSH 2016 heat criteria](https://www.cdc.gov/niosh/docs/2016-106/pdfs/2016-106.pdf): physiological monitoring is contextual and does not make this implementation validated.
- [NIOSH acclimatization](https://www.cdc.gov/niosh/heat-stress/recommendations/acclimatization.html).
- [OSHA heat technical manual](https://www.osha.gov/otm/section-3-health-hazards/chapter-4): retrieved search evidence; direct page returned 403 during review. Environmental/workload controls and medical monitoring belong in a broader heat program.
- [CDC medications guidance](https://www.cdc.gov/heat-health/hcp/clinical-guidance/heat-and-medications-guidance-for-clinicians.html).
- [ACSM exertional heat illness consensus, 2021](https://pubmed.ncbi.nlm.nih.gov/34524191/): recognition, management and return to activity are clinical questions; this prototype does not implement that consensus as a validated algorithm.
- [Gillinov et al., 2017, variable accuracy during exercise](https://pubmed.ncbi.nlm.nih.gov/28709155/): optical-monitor agreement varied by exercise; the studied devices were not Xiaomi Band 10.

## Verification boundaries

All injected readings, storage failures, fake-clock changes and incidents use local TEST ONLY fixtures and mock Supabase; none are sent to Render or a real Supabase project. Existing tests cover BLE disconnect/reconnect, hidden document, expired/revoked Gateway sessions, two independent slot connections, stale data, encryption integrity, protected endpoints, roster changes and all six archive ranges (15 min, 30 min, 1 h, 4 h, 8 h, 7 d). New tests cover viewer-only APIs, no case detail in Gateway replies, replay handling, manual-case escalation, storage failure/retry/restart, R01/R02 isolation and existing SSE revocation/expiry.

Browser smoke includes explicit foreground audio activation; it cannot certify audible output on an actual iPhone. Local Chromium download was unavailable; Docker was not installed. Applicable GitHub CI must pass on the exact PR head before merging. Production Render Blueprint states `autoDeployTrigger: off`; commits use `[skip render]`. No deploy request is authorized by this audit.

## Presentation on 28 October 2026

1. Explain concept: Band → foreground Gateway → backend → commander dashboard; show R01/R02 separately using the already-tested equipment.
2. Keep phone charged, Bluefy foreground and screen awake. Activate foreground sound explicitly and physically verify it on the actual phone/speaker.
3. Demonstrate LIVE then one-band disconnection → NO DATA while the other stays independent. Do not stress participants to manufacture high HR.
4. Show six history ranges only where real stored samples exist; gaps are gaps, not invented readings. Use commander view with private health panels closed.
5. Demonstrate an automatic incident only on an isolated TEST ONLY setup or recorded test; never lower production thresholds or generate a real operational emergency for show.
6. Say: “ระบบต้นแบบช่วยรวมข้อมูลและเตือนให้เจ้าหน้าที่ตรวจผู้สวม ไม่วินิจฉัยโรค ไม่รับรองว่าปลอดภัย และไม่อนุญาตกลับฝึกอัตโนมัติ”. Explain the approval and continuous-monitoring limitations honestly.
7. Use existing SOP and direct observation regardless of dashboard HR. Freeze known-working production for tomorrow; postpone live safety reliance and production release until unresolved P1 items and physical/clinical validation are closed.
