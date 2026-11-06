# Issue #76 — Case lifecycle QA

Baseline: main `01696266938982749d1d412cc1a4f010ebd227cd`, 6 Nov 2026.
หลักฐาน SIMULATED / CODE REVIEW เท่านั้น ไม่มี production writes, Render access, BLE หรือข้อมูลจริงในงานนี้

## Verified defect and focused fix

พบ lost-ACK defect จาก HTTP regression ที่รันจริง: เปิด pending case → remote save ปิดเคสสำเร็จแต่ตอบ 503 → memory rollback เป็น pending → restart → closed กลับมา. Baseline assertion expected pending / actual closed.

แก้ review mutation failure ให้ rollback แบบ version/wearer-aware และ compensating save อยู่ภายใน writeQueue เดียวกัน ก่อนปล่อย writer ถัดไป ไม่เพิ่มสถานะเคส/เปลี่ยน thresholds. เก็บ HTTP 503 เมื่อไม่ยืนยัน เพื่อให้ผู้ใช้ reload ก่อน retry. `historyDirty` ทำให้มี retry snapshot ต่อเมื่อ storage กลับมา.

อัปเดต recovery: stage การเปลี่ยนเคสภายใน writer queue ก่อนเขียน ไม่เผยแพร่ close ก่อนยืนยัน; snapshot เข้ารหัสมี receipt ต่อ slot/revision พร้อม operationId และ applied/rolled_back. ถ้า ACK หายและ compensation ล้ม GET/PUT ส่ง 503 พร้อม persistence.state=reconciliation_needed และ snapshot มี reviewPersistencePending. หลัง restart ตรวจ receipt กับผู้สวม/version/status ก่อนเปิด server และคืน readback_confirmed. จึงตรวจได้ว่า remote รับ operation ใดจริง แม้ HTTP เดิมล้มเหลว; ไม่อ้างว่า 503 แปลว่าไม่เคย commit. successful close ยังอยู่หลัง restart. Automatic escalation ที่มาระหว่างรอ write ไม่ถูก close ทับ.

Compatibility: case status none/pending/closed คงเดิม; เพิ่ม private persistence metadata และ public boolean เท่านั้น. Claude ควรแสดงให้ reload เมื่อ 503; readback_confirmed เป็นหลักฐานอ่าน snapshot กลับ ไม่ใช่ human acknowledgement หรือ medical clearance. Receipt เก็บเฉพาะ revision ล่าสุด ไม่ใช่ audit history ทุกเคส. Legacy snapshot ไม่มี receipt ยังโหลดได้; receipt ผิดรูปแบบหยุด startup.

ขอบเขต: single-process writer queue ไม่ใช่ distributed transaction/CAS หรือ exactly-once. ถ้า storage ทั้งหมดใช้ไม่ได้ automatic alert ใหม่ยังไม่ durable จน save สำเร็จ; process crash อาจสูญเสีย evidence ใหม่นั้น. Archive กับ snapshot แยกธุรกรรม ติดตาม #83. ไม่มี SQL migration; rollback ไป code เก่าจะเสียการตรวจ receipt และกลับมี defect เดิม.

## Regression coverage

เพิ่ม mandatory tests: close lost ACK ข้าม restart; request/close fail-before และ fail-after, durable version restore และ retry, duplicate command 409; real handler with synthetic transport for automatic open/dedup/close/latch/rearm ตามกฎเดิม; roster acknowledgement ไม่ปิด case และ close ไม่ลบอาการ EMERGENCY; pending อยู่หลัง disconnect/stale/restart.

Existing tests ครอบคลุม delayed bodies/private writes/reassignment, #75 durable cutoff/compensation, viewer/commander/private authorization, wrong gateway, 10 slots/2 gateways, synthetic alert suppression และ browser flows ของ Claude. ไม่เปลี่ยน UI tests.

## Lifecycle contract preserved

- Review statuses: none → pending → closed. request/close ต้อง trainer หรือ medic และ version ล่าสุด
- Roster symptom acknowledgement เป็นคนละอย่างกับ close review. Close ไม่รับรองกลับไปฝึก
- Automatic escalation ใช้เคส pending เดิม ไม่ทับ note. Latch/rearm เป็นไปตาม AutoHRMonitor เดิม ไม่เพิ่ม clinical rule
- NO DATA ไม่ใช่ NORMAL; snapshot หลัง restart ไม่แสดง BPM เก่า
- Pending count มี aggregate endpoint; profile/reason/note/shadow อยู่หลัง trainer/medic permissions

## Inventory for after-training reports / future AI

| Data | Actual source / limitation |
| --- | --- |
| Fresh BPM / gateway freshness | recruits/lastByGateway ใน memory; reset on restart, TTL 15s |
| 4-hour HR | PulseHistory + encrypted operational snapshot; sampled, not continuous waveform |
| 7-day HR | RollingArchive encrypted per wearer/minute, optional configured; missing samples not imputed |
| Training/rest | Roster group phase + bounded audit (250 events); actual transitions only; cohort state does not prove individual rest |
| Current/last review | MedicReviews.records[slot] one record per slot, overwritten by next case; NOT a complete case-history log |
| Symptom/restriction | Operator-entered roster; acknowledgement differs from medical clearance |
| Health context | PrivateProfiles age, weight, height/BMI, conditions/medications, confirmed baseline and personal limit; not every slot has complete data |
| WBGT | Latest conditions reading, stale after 30 min; no complete historic heat series |
| Recovery | Existing request-time shadow features on explicit training→rest; descriptive, not validated risk |
| Connection reliability | Browser-local opt-in logger; no raw BPM, only observed intervals; not server-wide or proof of 60-min pass |

ดังนั้นรายงานหลังฝึกทำ sample/training summaries ได้ตามข้อมูลที่มี แต่ยังอ้างประวัติทุกเคส/heat exposure ของแต่ละคนตลอดวันไม่ได้ ต้องออกแบบ storage เพิ่มแยกก่อน ไม่แต่งย้อนหลัง.

## Owner status / release boundary

ชุดทดลองปัจจุบัน FIVE watches R06–R10; ผู้ใช้ยืนยันหลังปิดเปิด Bluetooth/app ส่งได้ครบ. บางรอบเริ่มต้น connected-silent อยู่ใน #77/#79; hardware result หลัง fix ยังต้องยืนยัน. ประวัติ earlier G01/G02 online ไม่เท่ากับ current 10-watch test. 60-min owner skipped, ไม่ใช่ผ่าน.

Rollback code: revert focused PR restores prior behavior including lost-ACK defect. No SQL migration or UI changes. ไม่ merge/deploy ในงาน #76. ผลทดสอบเต็มและ CI ให้ดู PR.


## 6 Nov 2026 recovery verification

Original main reproducer FAIL: expected pending, actual closed after ACK loss/restart. New ambiguity tests FAIL on old PR80 (missing persistence metadata), then PASS after fix. Mandatory coverage includes request/close unknown outcome, duplicate/version ordering, SIGKILL immediately after remote commit, malformed receipts, concurrent automatic escalation during close. Full suite result is recorded in updated PR body. Browser CI prior head: backend/Docker pass; Commander QR selector timeout tracked #82. Local browser unavailable (Chromium SIGABRT/ptrace); Docker unavailable locally. No hardware validation.

Current scope follows the owner's STEVE 2.0 execution order: 10-watch/2-gateway offline pilot; historical five-watch reports above are not a current hardware certification. AI backend contract work is authorized offline; no external model or production prediction authorized.
