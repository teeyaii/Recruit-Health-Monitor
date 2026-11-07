# STEVE 2 — restart replay and delivery QA

ฐาน main `01696266938982749d1d412cc1a4f010ebd227cd`. TESTED OFFLINE เท่านั้น ไม่มี hardware/production validation.

พบ defect: watermark ของแต่ละช่องอยู่ใน memory; หลัง restart แพ็กเก็ตเก่าที่อายุยังไม่เกิน 15 วินาทีถูก accepted ทั้ง 10 ช่อง. แก้ด้วย startup timestamp floor = boot + 1000ms (ครอบคลุม clock lead ที่อนุญาตเดิม). ปฏิเสธ timestamp <= floor; ข้อมูลใหม่ผ่านตามปกติหลังขอบเขต. ไม่เปลี่ยน wearer cutoff, TTL หรือ clinical thresholds. ผลข้างเคียงที่ตั้งใจ: ช่วงเริ่ม process แรกประมาณหนึ่งวินาทียังไม่รับ sample; Gateway ใช้ accepted acknowledgment ตามเดิม.

Regression เพิ่ม: G01/G02 ล่มสลับกัน, หนึ่งเรือนเงียบเก้าเรือนสด, reconnect พร้อมกันสิบเรือน, replay หลัง restart, heartbeat ไม่คืน HR เก่า, SSE reconnect/หลาย viewer/logout/session expiry และปฏิเสธสิทธิ์ Gateway. Fixture เดิมรอผ่าน boot floor โดยไม่ลด assertions.

ผลบน main + patch: npm --prefix server test ผ่าน 274/274, 0 fail/skip/TODO. บนฐาน PR80 เดิม agent ทดสอบ280/280. ไม่ใช้จำนวนสองชุดบวกกัน. GitHub CI ใหม่ดูผลใน PR. ไม่แก้ UI/BLE ของ Claude.

ข้อจำกัด: boot floor ไม่ใช่ persisted per-packet ledger และไม่รับรองข้อมูล timestamp ปลอมจาก credential ที่ถูกขโมย. Host clock ที่ถอยหลังต้องจัดการ operational clock sync; ระบบนี้ยังเป็น single process. SSE เป็น current snapshot ไม่มี human delivery receipt. Rollback ด้วย revert จะคืนช่องโหว่ replay; ไม่มี SQL migration.


7 Nov integration update: PR84 now stacks on PR80 to resolve the shared QA-fixture conflict in advance; owner should integrate80 first then retarget84. Backend waits until startup floor has elapsed before listening/health-ready, so first valid notifications after readiness are accepted. This fixes the first browser CI run timeout at Gateway smoke line34 caused by immediate one-shot notifications inside quarantine. Real-clock fixtures need no extra sleeps; fake clocks explicitly advance1001ms. No Claude browser files changed. Full stacked suite prior readiness adjustment288/288; final CI/result recorded inPR.
