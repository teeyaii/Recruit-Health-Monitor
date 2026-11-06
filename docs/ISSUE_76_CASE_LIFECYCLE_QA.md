# Issue #76 — Case lifecycle QA

Baseline: main `01696266938982749d1d412cc1a4f010ebd227cd`, 6 Nov 2026.
หลักฐาน SIMULATED / CODE REVIEW เท่านั้น ไม่มี production writes, Render access, BLE หรือข้อมูลจริงในงานนี้

## Verified defect and focused fix

พบ lost-ACK defect จาก HTTP regression ที่รันจริง: เปิด pending case → remote save ปิดเคสสำเร็จแต่ตอบ 503 → memory rollback เป็น pending → restart → closed กลับมา. Baseline assertion expected pending / actual closed.

แก้ review mutation failure ให้ rollback แบบ version/wearer-aware และ compensating save อยู่ภายใน writeQueue เดียวกัน ก่อนปล่อย writer ถัดไป ไม่เพิ่มสถานะเคส/เปลี่ยน thresholds. เก็บ HTTP 503 เมื่อไม่ยืนยัน เพื่อให้ผู้ใช้ reload ก่อน retry. `historyDirty` ทำให้มี retry snapshot ต่อเมื่อ storage กลับมา.

ข้อจำกัด: remote save และ HTTP acknowledgement ไม่ใช่ distributed transaction. ถ้า compensation ก็ล้มและ process ตายก่อน retry remote อาจยังมีการปิดเคสเดิมที่ commit สำเร็จแล้ว; HTTP 503 ไม่รับรองว่า remote ไม่ได้เปลี่ยน ต้อง reload/ตรวจ durable state เมื่อกลับมา. PR นี้พิสูจน์การชดเชยเมื่อ store รับ write ถัดไปได้ ไม่อ้าง exactly-once หรือ durable rollback ขณะ store ใช้ไม่ได้ถาวร. ไม่ทำ schema redesign โดยไม่มี approval.

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
