# ข้อเสนอ STEVE AI — งานออกแบบสำหรับ Claude (รอเจ้าของอนุมัติ)

6 Nov 2026. This is a proposal, not implementation or deployment authorization.

## Intended use

ช่วยเจ้าหน้าที่ทบทวนชีพจร/บริบทของผู้สวมกลุ่มเสี่ยงที่ถูกคัดเลือกให้ใช้นาฬิกาจำกัด ลดเวลารวบรวมข้อมูล และชี้ข้อมูลที่ยังขาด. ไม่ใช้ตัดสินความพร้อมฝึก อนุญาตกลับฝึก หรือตัดสิทธิ์/ลงโทษกำลังพล.

สัญญาณ HR สูง/ต่ำเพียงอย่างเดียวไม่จำเพาะต่อ heat illness: กิจกรรม สมรรถภาพ ไข้ ยา โรค และสัญญาณจากอุปกรณ์มีผล. ห้ามนำ occupational guideline threshold มาใส่ใน STEVE โดยอัตโนมัติ.

## Architecture proposal

1. Data contract จากข้อมูลที่ระบบมีจริง: wearer epoch/version, source time, accepted BPM summary, missing intervals, actual phase transitions, current case evidence, baseline/config status, context timestamp. Stop/abstain on identity mismatch, stale/inadequate evidence; distinguish no-data from no-risk.
2. Deterministic feature engine ใช้ numerical summaries/quality/recovery ที่มีแล้วก่อน; ห้ามให้ LLM คำนวณจากกราฟเอง ห้าม infer HRV/arrhythmia/core temperature จาก BPM stream. ข้อมูลนี้ไม่มี raw PPG/ECG หรือ validated core-temperature measurement.
3. AI explanation adapter (optional external model later): input minimal structured summary; output structured Thai explanation of measured findings, timestamps, missing context and suggested questions for staff. Each numeric claim maps to input field. May not invent diagnosis, percentage probability, personal threshold, or new clinical action.
4. Authorized trainer/medic review ใน panel เดิมเท่านั้น. Final risk group/clinical action by qualified staff. Commander gets existing authorized aggregate only. Existing automatic alert engine keeps running if AI/API fails.

## Output example (synthetic)

- ข้อเท็จจริง: ช่วงพักที่บันทึก 4 นาที median ช่วงแรก 128 → ช่วงหลัง 112 BPM
- ข้อมูลไม่ครบ: ไม่มี resting baseline ที่ยืนยัน; WBGT เก่า
- ข้อเสนอให้เจ้าหน้าที่ตรวจเพิ่ม: ยืนยันว่าพักจริงและตรวจอาการ/การสวม ก่อนตีความแนวโน้ม
- สถานะ: ข้อมูลประกอบการประเมิน ไม่ใช่คำตัดสินว่าปลอดภัยหรือกลุ่มเสี่ยงทางการแพทย์

ห้ามระบุว่าค่าเหล่านี้เป็นเกณฑ์ใหม่หรือผลจริงของผู้ใช้.

## Phases / separate approvals

A. Claude ทำ design/data inventory + offline synthetic evaluation fixtures เท่านั้น. Codex ตรวจ privacy/data correctness. ไม่เรียก API จริงหรือส่งข้อมูลสุขภาพออกนอกระบบ. Deliver focused design PR with cost/privacy/dependency options, no production activation.
B. เมื่ออนุมัติ: deterministic summaries + mock AI adapter แบบ disabled by default ใน private panel. Tests: no-data, artifact, out-of-range/context, wearer change, stale phase, prompt injection in notes, contradictory output, timeout; rejected output falls back to measured summaries.
C. เมื่อเลือก provider/budget/retention และได้รับอนุมัติส่งข้อมูล: limited private shadow pilot; record input/model/prompt versions and human evaluation without public identifiable logs. Compare with qualified staff assessments, evaluate missed concerns, false alarms, unsupported statements and subgroup performance; predefine acceptable metrics with staff before viewing results. Five watches is insufficient to train/validate a clinical risk prediction model.
D. Risk prioritization beyond descriptive summaries requires separately reviewed clinical protocol, reference measurements and representative labelled data, prospective validation. No personal risk probability or automatic deployment from preliminary pilot.

## Data gaps to resolve before building a predictor

Existing case record is latest per slot, WBGT latest-only, roster audit bounded, training phase cohort-level. Not longitudinal outcome labels or ground truth. Device reassignments require wearer isolation. Missing medication/medical facts must stay unknown, not inferred from name/rank/unit. Do not infer adherence, diagnosis or fitness from wearable silence.

## Claude / Codex ownership

Claude: AI design, isolated future analysis module/mock adapter, private-panel explanation UX only after phase approval, synthetic scenarios and evaluation document.
Codex: ingestion/persistence/alert engine, identity and privacy audit, independent tests; coordinate API contract before editing shared files. No background changes to #76 code.
Owner: approve phase, purpose, costs and data destination. Qualified healthcare staff: assess clinical protocol and interpretations. No existing AI provider connection is assumed.

## Sources (reviewed 6 Nov 2026)

- WHO guidance: https://www.who.int/news/item/18-01-2024-who-releases-ai-ethics-and-governance-guidance-for-large-multi-modal-models
- NIOSH heat standard, physiological-monitoring limitations (Table 9-1): https://www.cdc.gov/niosh/docs/2016-106/pdfs/2016-106.pdf

These support human oversight/data limitations, not clinical validation of STEVE or Band 10.
