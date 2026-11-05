# Issue #74 — แก้ wearer cutoff ข้าม backend restart

หลักฐานทั้งหมด: **SIMULATED / CODE REVIEW** ไม่มีนาฬิกาจริง ไม่ใช่ hardware หรือ clinical validation

## ผลลัพธ์

แพ็กเก็ตของผู้สวมก่อนหน้า (`timestamp <= cutoff`) ถูกปฏิเสธต่อเนื่องหลัง restart แล้ว โดยบันทึก `reassignmentCutoffs` ลงใน encrypted state ก้อนเดียวกับ roster และข้อมูลส่วนตัวที่ต้องล้าง กู้ cutoff ก่อนเปิด HTTP listener ไม่เคย persist ค่า sentinel `MAX_SAFE_INTEGER`

ใช้ baseline main `c9373043c3e2ffe5f8e047643bf8ef20fe3a3b24` และต่อ branch จาก QA PR #73 `c52b0af41ac63310f52701c0abd5935c122b05e1` เพื่อใช้ executable reproducer เดิม PR นี้เป็น stacked fix บน #73; ไม่รวม UI ของ Claude และยังไม่ merge branch ใด

## การเปลี่ยนแปลง

- `server/index.js`: เพิ่ม durable cutoff, restore/migration, staged roster save, การกัน writes ราย slot และ compensating save
- `server/independent-backend-qa.test.js`: ถอด TODO/environment suppression ให้ assertion P1 เป็น mandatory; เพิ่ม fault injection, migration/race/rollback/archive tests
- `docs/ISSUE_71_INDEPENDENT_QA.md`: เพิ่มหมายเหตุว่าผล P1/TODO ในรายงานเดิมเป็น baseline ย้อนหลัง
- บันทึกฉบับนี้: ผลทดสอบ ข้อจำกัดและแผน rollback

ไม่เปลี่ยน clinical thresholds, Medic Review rules, recovery shadow, training policy, archive format/retention, secrets หรือไฟล์ของ Claude

## การบันทึกและ concurrency

1. ตรวจ request/version บน roster สำเนา ไม่เปลี่ยนผู้สวมที่ HTTP readers เห็นทันที
2. กัน ingest และ private/medic writes ของ slot ที่กำลังบันทึก (409 หรือ accepted=0 ตาม API เดิม); snapshot แสดง PAUSED/hr=null ระหว่างยังไม่ยืนยัน ช่องอื่นยัง ingest ได้
3. ล้าง archive ตาม semantics เดิม จากนั้นสร้าง snapshot ใหม่ที่มี **ผู้สวม + cutoff + history/profile/review ที่ล้างแล้ว**
4. บันทึกผ่าน write queue เดียวกับ writer อื่น เมื่อบันทึกสำเร็จจึง commit ใน memory และเผยแพร่ผู้สวมใหม่
5. Merge เฉพาะ slot และ audit event ไม่คืน roster ทั้งก้อนทับ group phase/slot อื่นที่เปลี่ยนระหว่างรอ และตรวจ code ซ้ำอีกครั้งเมื่อเข้าคิวทำงานจริง
6. ถ้าการบันทึกล้มเหลว จะตอบ 503 และคงผู้สวม/version/profile/history/review เดิม ทำ compensating save ในคิวเดิมเผื่อ remote commit สำเร็จแต่ ACK หาย
7. ถ้า compensating save ก็ยืนยันไม่ได้ จะกัน slot นั้นใน process จนผู้ใช้ reload แล้ว retry roster save สำเร็จ ถ้า restart จะอ่านสถานะที่ durable store มีจริง (อาจเก่าหรือใหม่ตามผล commit) โดยข้อมูลผู้สวมและ cutoff ยังมาจาก snapshot ก้อนเดียวกัน ไม่อ้างว่า request ที่ตอบ 503 สำเร็จ

Cutoff อย่างน้อยเท่ากับเวลาเปลี่ยนผู้สวมและ timestamp ล่าสุดที่เคยรับของ slot เพื่อไม่ลด watermark เมื่อ packet มี clock lead ที่ระบบอนุญาต ค่าขอบเขต `timestamp == cutoff` ถูกปฏิเสธด้วย

## Migration / compatibility

`reassignmentCutoffs` เป็น additive field ใน encrypted schema 1 เดิม ไม่ต้องเปลี่ยน SQL/schema หรือ credentials

- ถ้า stored snapshot ไม่มี map หรือขาด cutoff ของ slot ที่ลงทะเบียนแล้ว: ตั้ง cutoff เป็นเวลา boot + 1000 ms (ครอบคลุม client clock lead 1 วินาทีที่ ingest เดิมอนุญาต)
- บันทึก migration ก่อนเปิด listener: ถ้าบันทึกไม่ได้ boot จะไม่รับ ingest; เมื่อ storage กลับมาทำงาน restart สามารถลองใหม่ได้
- ค่าที่ <= cutoff จะถูกปฏิเสธ; stream ใหม่ที่ timestamp มากกว่า cutoff ทำงานได้เอง ไม่ต้องล้างข้อมูล ไม่ปิดช่องถาวร และ boot ถัดไปไม่ยืด cutoff ที่มีอยู่แล้ว
- ข้อมูล cutoff รูปแบบผิด, slot ไม่ถูกต้อง, negative/non-integer หรือ sentinel ทำให้ startup fail closed
- โหมด local roster file ที่ไม่ได้ใช้ encrypted store ใช้ boot boundary เดียวกันกับ registered slots; ไม่เพิ่ม plaintext health data ลงไฟล์
- โหมดใหม่ที่ยังไม่มี durable snapshot/ยังไม่มีผู้สวมไม่ถูกกักโดยไม่จำเป็น

## หลักฐานทดสอบ

Runtime local: Node v24.22.1; CI ของ repository ใช้ Node 22

| รายการ | ผล |
|---|---|
| Strict reproducer บน PR #73 ก่อนแก้ | exit 1; actual accepted=1 แทน expected=0 |
| Strict reproducer หลังแก้ | 2/2 pass (parent + assertion), exit 0 ไม่มี TODO |
| Independent backend QA ที่ขยายแล้ว | 24/24 pass |
| ทุกเทสต์ของ branch แก้ไข | **225/225 pass**, 0 fail, 0 skip, 0 TODO |
| ทดสอบร่วมกับ Claude PR #72 head `45d1a311d6c28a179337dcefa65bf2b99ab6ceb4` | **241/241 pass**, 0 fail, 0 skip, 0 TODO |

ทดสอบร่วมโดย checkout PR #72 แยก worktree แล้ววางเฉพาะ `server/index.js` กับ backend QA test จาก fix นี้ ไม่แก้ไฟล์ UI/logger ของ Claude ไม่ทำ merge

คำสั่งจาก repository root:

```sh
STEVE_QA_ENFORCE_KNOWN_DEFECTS=1 node --test \
  --test-name-pattern='previous-wearer replay' server/independent-backend-qa.test.js
node --test server/independent-backend-qa.test.js
npm --prefix server test
```

ตัวแปร strict เดิมใส่ได้เพื่อเทียบคำสั่งเดิม แต่ไม่มีผลต่อการ suppress test แล้ว; assertion บังคับผ่านเสมอ

ครอบคลุม:

- regression เดิม: sample ผู้สวมเก่าก่อน/หลัง restart ต้อง accepted=0; sample ใหม่ต้อง accepted=1
- 10 simulated slots / 2 gateways, TTL 15s, owner lease 120s, stale/duplicate/invalid/source spoof/authorization เดิมครบ
- durable write ล้มก่อน commit และ commit แล้ว ACK หาย: 503, ไม่แสดงผู้สวมใหม่, compensating save คืน state เดิม
- rollback ล้มซ้ำ: slot ที่ไม่แน่ใจหยุดรับ แต่ G02 ยังทำงาน; retry สำเร็จจึงรับใหม่
- remote commit สำเร็จแต่ ACK/rollback ล้ม แล้ว restart: โหลดผู้สวมใหม่พร้อม cutoff ที่เข้าคู่กันและยังปฏิเสธ sample เก่า
- held write: snapshot ไม่เผยผู้สวมใหม่, same-slot roster/private/review race ถูกปฏิเสธ, peer slot และ group phase ไม่ถูกทับ
- concurrent duplicate wearer code ไม่ถูกลงสองช่อง
- legacy missing/partial map, malformed map, migration save failure, restart โดยไม่ขยาย cutoff ซ้ำ
- old profile/automatic pending case/history ถูกแยกหลังเปลี่ยนผู้สวม; ข้อมูลใหม่ไม่สืบทอด alert เดิม
- archive เปิดใช้งานใน fixture: old persisted/pending points ถูกล้างตามเดิม; replay หลัง restart ไม่สร้าง archive ของคนใหม่; archive ใหม่มีเฉพาะ sample ใหม่

Harness ใช้ synthetic identities/BPM และ credentials สุ่มในหน่วยความจำ, encrypted state จริงแต่ mock transport ลง temporary files เท่านั้น; ไม่มีคำขอไป Supabase/Render จริง ไม่ใช้ production data

## ข้อจำกัดที่ยังต้องรู้

- **Archive DELETE และ encrypted state save เป็นคนละคำสั่ง/คนละตารางตามระบบเดิม** หากล้าง archive สำเร็จแล้ว state save ล้ม การชดเชยคืน roster/profile/4-hour history/review ได้ แต่ไม่สามารถกู้ archive rows ที่ถูกลบแล้วได้ PR นี้ไม่อ้างว่าเป็น distributed transaction หรือย้อนคืน archive ได้ และไม่เปลี่ยนนโยบายล้าง archive เดิม
- ระบบยังใช้ clock/timestamp contract เดิมและ single-process writer; ไม่เพิ่ม wearer generation ใน packet หรือแก้เรื่อง arbitrary clock spoofing/multi-instance ownership
- ครอบคลุมการป้องกันแพ็กเก็ตที่เกิดก่อน cutoff ไม่ใช่การพิสูจน์ว่านาฬิกาถูกย้ายให้ผู้สวมถูกคนจริง ต้องให้คนตรวจการสวม
- Green CI ไม่ยืนยัน BLE/iPhone/Bluefy; hardware validation ยัง NOT PERFORMED

## Rollback / release gate

- ยังไม่ merge/deploy/restart/เปลี่ยน secrets/production state; owner เป็นผู้ตัดสินใจ release ภายหลัง
- PR #73 เป็น dependency ของ fix นี้ ถ้า #73 ถูกรวมภายหลัง ให้ retarget fix ไป main และรัน CI ใหม่ก่อนพิจารณา release; PR #72 อยู่คนละไฟล์และทดสอบ compatibility แล้ว
- Additive field ไม่ต้อง rollback SQL/schema และควรเก็บ cutoff ไว้ ไม่ลบทิ้งเพื่อแก้อาการ
- **ไม่ควร downgrade กลับโค้ดที่มี P1 ขณะยังอนุญาต reassignment** ถ้าจำเป็นต้องย้อน release ให้เจ้าของกำหนดช่วงหยุด ingest/reassignment, เก็บ backup ที่ได้รับอนุญาต และตรวจแผน replay guard ก่อนกลับมาใช้ ไม่ถือว่า `git revert` เพียงอย่างเดียวทำให้ระบบปลอดภัย
