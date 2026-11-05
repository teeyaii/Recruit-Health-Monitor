# Issue #71 — Independent Backend Reliability & Safety QA

> รายงานนี้เก็บผล baseline ของ PR #73 ไว้เป็นหลักฐานย้อนหลัง บน branch แก้ Issue #74 เทสต์ P1 ถูกเปลี่ยนเป็น mandatory แล้ว ดูผลปัจจุบันและ rollback plan ใน `ISSUE_74_WEARER_CUTOFF_FIX.md`

หลักฐานทั้งหมดเป็น **SIMULATED / CODE REVIEW**; **REAL HARDWARE: NOT PERFORMED**.
ไม่ใช่การรับรองทางคลินิกหรือหลักฐานผ่าน soak 60 นาที

## ขอบเขตที่ตรวจ

- main: `c9373043c3e2ffe5f8e047643bf8ef20fe3a3b24`
- Claude PR #72: `10e4de91762936d59d667e53f95a5152b4d3acc2` (worktree แยก)
- ตรวจ `index.js`, `contract.js`, `auto-hr-monitor.js`, `medic-review.js`, roster, durable state, gateway sessions และเทสต์เดิม
- เปลี่ยนเฉพาะ backend test ใหม่และบันทึก QA นี้ ไม่แก้ UI, logger/tests ของ Claude, production code, threshold หรือ secret
- ไม่ merge/deploy/restart Render และไม่ติดต่อฐานข้อมูลจริง

## ผลทดสอบ

Runtime ในงานนี้: Node v24.22.1 (CI เดิมใช้ Node 22)

| ชุด | ผล | ประเภทหลักฐาน |
|---|---|---|
| main เดิม `cd server && npm test` | 201 pass, 0 fail | SIMULATED |
| QA ใหม่ `node --test server/independent-backend-qa.test.js` | 8 pass + 1 known-defect TODO ที่ assertion ล้มจริง | SIMULATED |
| main + QA ทั้งชุด | 209 pass, 0 unexpected fail, 1 TODO; รวม 210 tests | SIMULATED |
| เปิด strict reproducer ด้านล่าง | exit 1; expected accepted=0 แต่ actual=1 | SIMULATED, พบ defect |
| PR #72 เดิม `cd server && npm test` | 214 pass, 0 fail | SIMULATED |
| PR #72 GitHub Actions run 42038610860 | completed / success ตาม API | CI ที่ตรวจสถานะ |
| browser/Docker smoke ในเครื่อง QA นี้ | ไม่ได้รัน; Docker ไม่มีใน runtime นี้ | NOT PERFORMED |
| นาฬิกาจริง/Bluefy/iPhone และ soak 60 นาที | PENDING | REAL HARDWARE NOT PERFORMED |

**TODO ไม่ได้แปลว่าผ่าน safety gate**: เฉพาะ assertion ของ defect ที่รู้แล้วถูกติด TODO เพื่อให้ QA-only PR แสดงบั๊กโดยไม่แก้ production code นอกขอบเขต ส่วน setup/HTTP/persistence อยู่ใน parent test ปกติและล้ม CI ได้ หากแก้ defect แล้วต้องถอด TODO เพื่อป้องกัน regression

### ความครอบคลุมใหม่

- 10 streams: G01 R01–R05 / G02 R06–R10 ผ่าน HTTP handlers จริงใน child process
- ไม่ใช้ค่าระยะ lease ที่ลดลง: ตรวจค่า default **120000 ms** ที่ขอบเขตและ +1 ms
- TTL **15000 ms** ที่ขอบเขตและ +1 ms; G02 หายขณะ G01 ทำงาน; ฟื้นหนึ่ง slot ไม่ชุบ peers
- wrong device, cross-gateway slot/body, repeated slot ใน batch, duplicate/older/too-old/future timestamp, invalid BPM/state
- 401, 403, 409, session หมดอายุ, disconnect ต่ออายุ owner lease, takeover, logout และ reconnect
- EMERGENCY/pending manual case ยังอยู่หลัง disconnect/stale/restart; ไม่มี BPM หลัง restart จนได้ข้อมูลใหม่
- private-profile/review ปิดกับ anonymous/viewer/Gateway/Commander; trainer และ medic เข้าถึงได้ตาม contract ปัจจุบัน ไม่อ้างว่า medic-only
- synthetic mode + 10 คนที่ตั้งค่า monitoring ใน fixture + training ไม่สร้าง auto case; source ปลอมถูกปฏิเสธ
- การเปลี่ยนผู้สวมกันข้อมูลเก่าได้ก่อน restart; เพิ่ม reproducer ข้าม restart
- suite เดิมยังครอบคลุม automatic pending case, persistence failure, delayed writes ระหว่าง reassignment และ authorization

Harness สร้าง credentials สุ่มในหน่วยความจำ, ใช้ synthetic identities/BPM, clock เฉพาะ child, temp files และ encrypted DurableState จริง แต่ mock transport ไป local file เท่านั้น `fetch` ใน child ปฏิเสธปลายทางอื่น ไม่มีการเรียกบริการ Supabase จริง ไม่มีการเขียน threshold ของระบบจริง

## P1 — ต้องแก้ก่อนถือว่า wearer isolation ผ่านหลัง restart

**พบจริงบน main:** `reassignmentCutoff` อยู่ใน Map ของ process เท่านั้น ไม่อยู่ใน `stateSnapshot()` และไม่ถูก restore ใน `boot()`; eventAt/dedup watermark ของ live readings ก็ไม่ถูกเก็บข้าม restart

ขั้นตอนทำซ้ำ (clock จำลอง เดินหน้าเป็นลำดับ):

1. ลงทะเบียน R01 เป็น QA_R01 และรับ sample ที่ T+1
2. เปลี่ยน R01 เป็น QA_NEW ที่ T+2; BPM ถูกล้างและส่ง sample T+1 ซ้ำได้ accepted=0
3. restart child โดยโหลด encrypted state เดิม; login Gateway ใหม่
4. ส่ง sample T+1 เดิมอีกครั้ง ซึ่งยังอยู่ในช่วงอายุ 15 วินาที
5. **actual accepted=1; expected accepted=0** — ข้อมูลผู้สวมก่อนหน้าเข้าช่องของผู้สวมใหม่ได้

```sh
STEVE_QA_ENFORCE_KNOWN_DEFECTS=1 node --test \
  --test-name-pattern='previous-wearer replay' server/independent-backend-qa.test.js
```

คำสั่งนี้ต้องเป็นสีแดงบน baseline ดังกล่าว (หนึ่ง assertion ล้มและ parent รายงาน subtest failure ไม่ใช่สอง defect)

**ขอบเขต follow-up fix PR ที่เล็กที่สุด:** เก็บ per-slot wearer cutoff แบบ durable พร้อม roster mutation ใน transaction/state snapshot เดียวกัน และโหลดก่อนเปิด ingest; คงเงื่อนไข `timestamp <= cutoff` และย้าย TODO เป็นเทสต์บังคับผ่าน เพิ่มทดสอบ storage failure/rollback และ compatibility กับ state เก่าที่ไม่มี cutoff (พิจารณา fail-closed quarantine เท่ากับ accepted age window เมื่อไม่สามารถกู้ cutoff ได้) ไม่ใช้เวลาปรับ roster ทั่วไปเป็น wearer cutoff เพราะจะทิ้งข้อมูลดีโดยไม่จำเป็น ไม่จำเป็นต้องแก้ threshold/alert engine/UI

นี่เป็นข้อเสนอ fix ที่พิสูจน์เหตุผลแล้ว **ยังไม่ได้ implement หรือเปิด production-fix PR** ตามข้อกำหนดให้ QA เปลี่ยนเฉพาะ tests/notes

## Gateway online != slot LIVE (ไม่ใช่ clinical defect)

`lastByGateway.set(body.gateway,now)` ทำงานหลังตรวจ batch แม้ accepted=0 รวม empty batch ดังนั้น authenticated G02 ที่ส่ง empty batch ขณะที่ R06–R10 เก่าเกิน TTL จะเป็น online แต่ทุก slot ยัง STALE/hr=null ถูกต้อง เทสต์ใหม่ยืนยันทั้งสองด้าน

ให้ตีความ online ว่า backend ได้รับคำขอจาก Gateway ไม่ใช่หลักฐานว่าสายนาฬิกาทั้งห้ารับข้อมูล และไม่ใช่ medical clearance ภาพหน้าจอ online เพียงอย่างเดียวพิสูจน์ hardware ingestion ไม่ได้

## Independent review ของ PR #72

รีวิว commit ข้างต้นและส่ง review แบบ COMMENT พร้อม inline findings (review id 5786326401); คำแนะนำให้แก้ metric correctness ก่อนยอมรับ logger เป็นหลักฐาน soak

1. **P2:** `sessionTick` ให้ observed=min(dt,2500) แม้ไม่มี tick 60 วินาที เกิด observed=2.5s / notObserved=57.5s / coverage=100% จาก observation เดียว ขัดกับนิยามที่ให้ reload/suspended time เป็น NOT_OBSERVED ควรไม่ให้เครดิต interval ที่ไม่มี observation ต่อเนื่อง
2. **P2:** hidden tick คืนค่าก่อนตั้ง `dropCrossedGap`; ลำดับ LIVE_ACK@101000 → DISCONNECTED@102000 → hidden@112000 → LIVE_ACK@113000 ได้ recovery=11s แต่ recoveriesCrossingGap=0 ควร mark outstanding drop ก่อน early return
3. **เพิ่มเติม:** CSV ไม่มี definitions/observationBoundaries แบบ JSON ทั้งที่เอกสารระบุทุก export มี ควรทำให้ CSV อธิบาย coverage/drop/recovery และ sampling limitations ได้เอง

ตัวทำซ้ำ read-only จาก worktree PR #72 (ไม่เปลี่ยนไฟล์ของ Claude):

```sh
node --input-type=module <<'JS'
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const html=readFileSync('dashboard/gateway.html','utf8');
const code=html.slice(html.indexOf('const SLOT_CATEGORIES='),html.indexOf('let sessionLog=null;'));
const c=vm.createContext({});
vm.runInContext(code+';globalThis.api={sessionCreate,sessionTick,sessionSummary}',c);
const {sessionCreate:create,sessionTick:tick,sessionSummary:sum}=c.api;
const log=create('SIMULATED','G01',['R01'],100000);
tick(log,101000,{R01:'LIVE_ACK'});
tick(log,102000,{R01:'DISCONNECTED'});
tick(log,112000,{R01:'DISCONNECTED'},{visible:false});
tick(log,113000,{R01:'LIVE_ACK'});
console.log(sum(log).slots[0]);
const gap=create('SIMULATED','G01',['R01'],100000);
tick(gap,160000,{R01:'LIVE_ACK'});
console.log(sum(gap));
JS
```

CODE REVIEW privacy: เส้นทาง export ปกติ whitelist เฉพาะ metrics/slot/gateway; ไม่พบ BPM, identity, device ID หรือ token ใน output ปกติ และไม่พบส่ง logger ไป server ใน diff; ข้อความ readiness แยก connectivity ออกจาก medical clearance ไม่ใช่การรับรอง privacy ทุกสภาพแวดล้อม

## Gate / rollback

- QA-only PR: ไม่มีผลต่อ runtime; rollback ด้วย revert tests/notes เท่านั้น
- ไม่ใช้ผล npm exit 0 กลบ known P1 หรือถือว่า clinical/hardware validation ผ่าน
- คงการทดสอบนาฬิกาจริง 10 เรือน / 2 Gateway และ 60-minute observation เป็น PENDING
- ไม่ merge/deploy ไม่เปลี่ยน secret/clinical threshold ไม่แก้ไฟล์ของ #70
