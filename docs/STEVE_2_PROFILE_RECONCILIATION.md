# Private profile reconciliation — offline QA

พบ lost-ACK defect บน main0169626: remote เปลี่ยน weight72→80/version1→2 แล้วตอบผิดพลาด; API503 และ memory กลับ72 แต่ restart โหลด80 โดยไม่มีหลักฐานอธิบายการเปลี่ยน. ใช้ encrypted local mock เท่านั้น ไม่มีข้อมูลจริงหรือการเปลี่ยน clinical thresholds.

แก้บนฐาน PR80: stage profile ใน writer queue, ตรวจ wearer/version ตอน execute, ไม่ให้ proposal เข้า runtime ก่อน save ยืนยัน, compensate current snapshot ก่อน writer ถัดไป, และบันทึก encrypted receipt ต่อ slot/revision. ถ้ายืนยันไม่ได้ GET private profile และ medical context ส่ง503 reconciliation_needed. หลัง restart ตรวจ receipt และแสดง readback_confirmed พร้อม operationId/outcome appliedหรือrolled_back. ไม่อ้าง503หมายถึงremoteไม่เปลี่ยนหรือexactly-once. successful writeอยู่หลังrestart; การเปลี่ยนผู้สวมล้างreceiptเดิม.

Mandatory tests: failbeforecommit; ACKlost+compensationsuccess; ACKlost+compensationfailure; concurrentqueuedwriters version guardและreadblocking. No TODO/SKIP. Full resultsอยู่ในPR. ผลบนฐานagent278testsมีparallelrunหนึ่งครั้งสะดุดexistingautoHR250mstimer/faultflag race; isolatedautoHRผ่าน2/2 และรันชุดรวมซ้ำบนฐานล่าสุดก่อนส่ง.

Compatibility: private APIsเพิ่ม persistence metadataและ503ระหว่างsaving/unknown. ไม่มีUI/SQL/threshold changes. ต้องอ่านใหม่หลัง503; เมื่อ recoveryยืนยันapplied ผู้มีสิทธิ์ต้องทบทวนข้อมูลจริง ไม่ตีความว่าrollbackแน่นอน. snapshot receiptsเป็นlastrevisionไม่ใช่fullauditlog. Rollbackด้วยrevertเสียprotectionนี้; PR80เป็นdependency.
