# STEVE AI Shadow Analysis: deterministic foundation

Audited `main`: `01696266938982749d1d412cc1a4f010ebd227cd` (6 Nov 2026). Codex PR #80 is open and owns `server/index.js` and the case lifecycle; this work does not touch those files. Codex's design proposal `docs/STEVE_AI_CLAUDE_PROPOSAL.md` lives in #80 (not yet on main); this implementation follows its phase A/B boundaries.

Status: **IMPLEMENTED** as an internal module with **SIMULATED** tests only. It is not connected to any endpoint or screen. There is no hardware or clinical validation.

## 1. Feature inventory (audit)

| Area | Status | Where / evidence |
|---|---|---|
| Fresh BPM, 15 s TTL, NO DATA ≠ NORMAL | ALREADY IMPLEMENTED | `server/index.js` snapshot, `dashboard/live.html`, `dashboard-status.test.js` |
| Wearer boundary / no old-wearer data | ALREADY IMPLEMENTED | #75 durable cutoff, `ISSUE_74_WEARER_CUTOFF_FIX.md`, independent QA tests |
| 4-h history, 7-day encrypted archive | ALREADY IMPLEMENTED | `pulse-history.js`, `rolling-archive.js` |
| Automatic personal-limit advisory → pending Medic Review | ALREADY IMPLEMENTED | `auto-hr-monitor.js`, `medic-review.js` |
| Recovery shadow (training → rest) | ALREADY IMPLEMENTED (descriptive) | `recovery-shadow.js`, reused here |
| Training/rest/no-training timeline | ALREADY IMPLEMENTED (cohort-level) | `roster.js` group phase, `training-summary.js` |
| Gateway serialized GATT recovery, silent-peer diagnosis | IMPLEMENTED, NEEDS HARDWARE VALIDATION | #79, `silent-peers.test.js` |
| Data-quality layer (gaps, coverage, duplicates, order, jumps, wearer boundary) | **MISSING → implemented here** | `server/shadow-analysis.js` |
| Trend features (median, IQR, robust slope, limit duration, baseline delta) | **MISSING → implemented here** | same |
| Thai explanation built from structured evidence | **MISSING → implemented here** | same |
| WBGT provenance (measured vs estimated) | **MISSING → validation only** | `validateWbgtContext` |
| Case-lifecycle states beyond none/pending/closed | MISSING. Needs a backend contract | Section 6 (Codex handoff) |
| HRV, core temperature, heat illness/arrhythmia detection | NOT POSSIBLE / UNSAFE | No PPG/ECG/RR intervals, only averaged BPM |
| ML risk model | NOT WORTH DEVELOPING NOW | No labelled outcomes; 5–10 watches; synthetic data cannot validate |
| 60-minute endurance | PENDING (owner skipped) | Not passed |

## 2. What the module does (`server/shadow-analysis.js`)
- **C1 Quality.** It counts rejected samples by reason: shape, range, future, outside window, previous wearer, duplicate and out-of-order. It measures gaps longer than 45 s and coverage (5-s buckets ÷ window), flags implausible jumps (≥ 45 BPM within 15 s) and staleness (> 15 s). Its status is one of `valid`, `insufficient`, `suspicious`, `no_data` or `different_wearer`. It never imputes, interpolates or smooths.
- **C2 Features.** These are computed only when the data allows: median, IQR (spread, **not HRV**), and the Theil-Sen trend in BPM/min. The trend is computed **only for the current recorded phase segment** (since the last transition inside the window, exposed as `trendScope`), only for `valid` data, and only when that segment spans ≥ 3 min. A training rise followed by a rest fall is therefore never reported as "rising during rest". It also gives the time continuously at or above the **existing clinician-confirmed personal limit** (null if none). It also gives the difference from a confirmed baseline (null if none) and per-phase sample counts and medians from the recorded transitions.
- **Recovery.** It reuses `describeRecoveryShadow` unchanged.
- **C3 Explanation.** A Thai sentence list is built only from these fields. It always ends with "ยังไม่สามารถสรุปภาวะทางการแพทย์…ไม่ใช่การวินิจฉัยหรือการอนุญาตให้ฝึก". Missing information is listed in Thai, and SIMULATED inputs are labelled.
- **Constants.** Every constant is reused from existing modules (25–240 BPM, 15 s, 45 s, 45 BPM/15 s, 5 s, 30 min WBGT). The only additions are presentation rules for describing data (≥ 12 samples, ≥ 50% coverage, ≥ 3 min span, a change ≥ 5 BPM before calling a trend rising or falling). **No clinical threshold was added or changed.**

### Example output (synthetic)
```
ข้อมูลจำลอง (SIMULATED) ไม่ใช่การวัดจริง • ข้อมูลต่อเนื่องเพียงพอสำหรับอธิบายแนวโน้ม (ครอบคลุม 93.6% ของ 30 นาที, 337 ค่า)
• แนวโน้มชีพจรสูงขึ้นต่อเนื่อง (1.2 BPM/นาที ตลอด 29.9 นาที) ระหว่างฝึก • median ทั้งช่วงวิเคราะห์ 131 BPM
• อยู่ที่หรือสูงกว่าเกณฑ์ส่วนบุคคลที่เจ้าหน้าที่ตั้งไว้ต่อเนื่องนานสุด 7 นาที
• ข้อมูลที่ยังขาด: ไม่มี HRV (BPM เฉลี่ยใช้คำนวณไม่ได้), ยังไม่มี baseline ที่ยืนยัน, WBGT เก่ากว่า 30 นาที
• ยังไม่สามารถสรุปภาวะทางการแพทย์จากชีพจรอย่างเดียวได้ • ข้อมูลประกอบการพิจารณาของเจ้าหน้าที่เท่านั้น ไม่ใช่การวินิจฉัยหรือการอนุญาตให้ฝึก
```
The structured output also carries `clinicalEffect:"none"`, `mode:"shadow_research_only"`, quality counts, gaps and features. It does not carry raw samples, wearer codes, notes or profile fields.

- **Wearer boundary.** Samples at or before the reassignment cutoff are excluded, the same strictly-after rule as ingestion (`server/index.js`).
- **Alert context.** It reads the persisted `autoEvidence` (validated with `validAutoEvidence` from `medic-review.js`); invalid or invented evidence fields are ignored.

## 3. Safety properties (tested)
The output is pure, deterministic and frozen, and the module never mutates its inputs. Its output contains no NORMAL/WATCH/EMERGENCY, no diagnosis wording and no "safe/return to training".

Running it alongside `AutoHRMonitor` yields byte-identical alert decisions. Existing review evidence is echoed (rule, times, count) but never re-scored, and notes, reasons, codes and profile data are dropped.

The module has no I/O, no `fetch` and no environment access, and its only import is `recovery-shadow.js`. It is not imported by `server/index.js`.

## 4. Architecture comparison (C4)

| | A. Deterministic signal processing + templated explanation | B. Statistical anomaly detection | C. LLM explanation of approved structured evidence |
|---|---|---|---|
| Explainability | Every number traceable to inputs | Moderate (scores need context) | Fluent, but risk of unsupported claims |
| Clinical safety | Highest; cannot invent | Needs validated baselines; false-alarm risk | Needs output validation, prompt-injection defence |
| False alarms | None by design: describes, never alerts | Depends on validation data we do not have | Inherits from inputs, plus wording errors |
| Data needs | Works now on existing BPM | Large labelled real-world sets per person | Structured summaries only |
| Privacy | All in-process | In-process | Health data leaves the system unless self-hosted |
| Cost / ops | ~0, no dependency | Low compute, high validation effort | Paid API or GPU hosting; keys, retention, monitoring |
| Render/Supabase fit | Native Node, no new service | Feasible | External service or heavy hosting |
| Maintainability | Small, unit-tested | Model drift and recalibration | Model and prompt versioning, evaluation harness |

**Recommendation: A now** (implemented). B only after months of real, consented, labelled data, with clinical outcome references and a prospectively agreed evaluation protocol. Five to ten watches is not enough. C is optional later, with only the structured output above as input, every numeric claim checked against fields, and fallback to the deterministic text. It needs separate privacy, security, clinical and owner approval, a chosen provider and data-destination agreement. **No external AI call, key or provider is used or assumed.**

## 5. Remaining medical / data limits
- Band 10 delivers averaged BPM through standard HR notifications. There are no RR intervals, PPG or ECG, so no HRV, arrhythmia or rhythm analysis is possible.
- There is no core temperature or hydration data. WBGT is a single manual reading (latest only), with no per-person exposure history.
- Training phase is **cohort-level**; it does not prove an individual rested.
- Medic Review keeps the latest record per slot only, not a full case history (see the #80 inventory). There are no outcome labels.
- A confirmed baseline and personal limit exist only where staff entered them.

## 6. Handoffs to Codex (backend contracts; not implemented here)
**D. Alert-to-action states.** The API exposes the review status `none|pending|closed`, `openedBy`, `version`, `evidence`, plus the roster `acknowledged` flag (for the observed symptom, a separate concept). The frontend already shows "รอเจ้าหน้าที่ประเมิน / ประเมินแล้ว" and, since #78, notes that close ≠ return to training.
- The requested distinctions "acknowledged (case) / awaiting assessment / assessment recorded" **do not exist** in the API. The frontend must not invent them.
- Proposal: an append-only case event log `{caseId, at, actor, type: opened|acknowledged|assessment_recorded|closed, version}`, with acknowledgement explicitly not resolving the case and close explicitly not meaning clearance. This needs Codex design, migration and tests.

**E. WBGT data contract.** Proposed reading:
```json
{"wbgtC": 30.5, "measuredAt": 1794000000000, "source": "measured_device|manual entry|weather_estimate",
 "provenance": {"instrument": "optional model", "enteredBy": "trainer|medic"},
 "location": "group or field label", "phase": "training|hourly_rest|no_training"}
```
Keep a history (append-only, bounded, encrypted like the archive), and never promote `weather_estimate` to a measured value. `validateWbgtContext()` already implements the read-side rule offline. Do not add heat-stress thresholds without clinical sign-off.

## 7. Workstream A/B audit result (no new PR)
I checked the ten Gateway criteria against #79 and the existing tests; all are covered:
- 1–3 and 5–6: `silent-peers.test.js`
- 4 (one upload per sample): `silent-peers.test.js` test 10
- 7: `silent-peers.test.js` test 6, `daily-ux.test.js`
- 8: `daily-ux.test.js`, `gateway-session-logger.test.js`
- 9: `ten-band-two-gateway.test.js`, `gateway-session.test.js`
- 10: the readiness detail from #79

No evidence-backed defect remained, so there is no Gateway follow-up PR.
- Open hardware question: `watchAdvertisements` runs outside the GATT queue. It is a listen-only operation, and there is no evidence it conflicts; check it on Bluefy.
- Daily-operations UX was delivered in #78. I found no new verified usability defect, so there is no cosmetic PR.

## 8. Integration requirements (for the future adapter; Codex review #81)
This module is **not yet a versioned backend contract consumer**. Before any endpoint calls it, the adapter (Codex-owned, under existing trainer/medic permissions) must:
- pass only the **current** wearer's data, with `wearerSince` set to the durable reassignment cutoff;
- check the roster revision before and after reading, and return 409 if the wearer changed, like the existing review routes;
- read from confirmed persisted state (history, review and profile), and refuse or label the analysis when storage freshness is unknown;
- pin `SHADOW_VERSION` in the response and never pass free-text notes, reasons or profile fields.

## 9. Next phase
1. Owner: hardware check of #79 on R06–R10 at morning start-up.
2. With owner approval, expose `analyzeShadow` read-only inside the existing trainer/medic Medic panel (Codex adds a GET endpoint under existing permissions; Claude adds the UI), labelled "งานวิจัย • ไม่ใช่คำวินิจฉัย".
3. Codex: case event log and WBGT history contracts.
4. Clinical staff: review the wording and decide whether any descriptor is useful before wider use.
