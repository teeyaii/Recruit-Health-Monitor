# STEVE 2 — รายงาน Backend QA วันที่ 7 พ.ย. 2026

main ที่ตรวจ: `01696266938982749d1d412cc1a4f010ebd227cd`. ไม่ merge/deploy หรือแก้ Render secrets/production/clinical thresholds.

| งาน | สถานะ / หลักฐาน |
|---|---|
| PR80 case persistence | IMPLEMENTED / TESTED OFFLINE 282/282; CI backend,Docker,browser ผ่าน run42232477107 |
| PR84 restart replay + delivery | IMPLEMENTED / main+patch274/274; แพ็กเก็ตเก่าสิบช่องถูกปฏิเสธหลังrestart; ข้อมูลใหม่กลับครบ |
| PR85 profile persistence | IMPLEMENTED / ต่อจาก80,286/286; stage+compensation+receipt และ private-read503เมื่อไม่แน่นอน |
| รวม80+84+85+Claude81 | TESTED OFFLINE305/305,0fail/skip/TODO; รวมเฉพาะlocalbranch ไม่ mergeไปmain |
| Claude81 independentreview | 281/281existing testsผ่าน แต่3independent probesพบP2จริง; review5809421930 |
| AI backendcontract | เอกสารv1เสนอadapterอ่านอย่างเดียว; ยังไม่มีendpoint/modelcalls/productionprediction |
| Hardware | HARDWARE VERIFIED: ไม่มีในงานนี้; endurance60นาทีPENDING |

## Defects และผลแก้

1. Case close ACKlost: mainทำซ้ำได้ pendingในmemoryแต่closedหลังrestart. PR80เพิ่มreceiptและreconciliation; unknown outcomeไม่รายงานconfirmed. SIGKILLหลังremotecommit, compensationfailure, duplicate/version และautomaticescalationระหว่างcloseผ่าน.
2. Restart replay: watermarkหายเมื่อprocessเริ่มใหม่ ทำให้แพ็กเก็ตเดิมยังอายุ15sกลับaccepted10/10. PR84ปฏิเสธtimestamp<=boot+1000ms; heartbeatไม่ทำHRเก่าสด; freshstreamกลับครบ10.
3. Privateprofile ACKlost: PUT503/memoryweight72แต่restart80. PR85stageภายในqueue ชดเชยและระบุunknown/readbackพร้อมoperationId. ไม่แก้ค่าหรือเกณฑ์ทางคลินิกจริง.

## Isolation / safety / authorization

จำลองG01R01–R05และG02R06–R10: ล่มสลับgateway, หนึ่งเรือนเงียบเก้าเรือนสด, reconnectพร้อมกัน, wronggateway/replay/invalidtime, SSE reconnect/multipleviewers/logout/expiry. Gatewayonlineเป็นrequestliveness ไม่ใช่BPMfresh. Wearercutoff/previouswearer/history/profile/review isolation regressionsคงอยู่. Acknowledgementไม่ใช่caseclose; closeไม่ลบobservedEMERGENCYหรือให้medicalclearance. Viewer/commanderไม่เห็นprivateclinicaldetail; gatewayอ่านprivateไม่ได้. SSEเป็นsnapshot ไม่ใช่receiptว่ามนุษย์เห็นแล้ว.

## Claude coordination / blockers

ReviewPR81พบ3P2ก่อนintegration: cutoffequalityรับpointเดิม; existingReview.evidenceไม่ตรงautoEvidenceจริง; trendทั้งwindowถูกlabelด้วยphaseท้ายทำให้mixedtraining/restสื่อความหมายผิด. Codexไม่แก้Claude-ownedfiles. ต้องแก้และเพิ่มregressionโดยClaudeก่อนต่อเข้าระบบจริง. Moduleยังpure/disconnectedจึงไม่ใช่productionclinicaldefectที่เกิดแล้ว.

Issue82: CommanderQRtimeoutในCIเก่า; CI80ล่าสุดผ่านครบ จึงไม่เป็นfailureล่าสุด แต่ยังไม่มีrootcausefixที่ยืนยัน. LocalbrowserเคยBLOCKEDด้วยChromiumSIGABRT/ptrace; Dockerไม่มีในlocal ใช้GitHubCIเป็นหลักฐานเท่านั้น.

## Persistence boundary และงานต่อ

สถาปัตยกรรมเหมาะกับsingleprocess prototype: encryptedsecure snapshot + separateencryptedarchive, serializedlocalwriter. ไม่ใช่distributedtransaction/multiinstanceCAS/exactlyonce. HTTP503อาจเกิดหลังremotecommit; receipt/readbackอธิบายactualoutcomeไม่รับประกันrollback. Receiptเป็นrevisionล่าสุดไม่ใช่caseeventlogทั้งชีวิต. Automaticalertที่เกิดระหว่างtotalstorageoutageยังvolatileจนsaveสำเร็จ.

Issue83ยังPENDING: archiveDELETEก่อนsnapshotcommitอาจทำให้archiveหายแม้reassignmentล้ม; snapshotcompensationคืนrowsไม่ได้. ต้องออกแบบrecoverablecleanup/assignmentidentityพร้อมfaulttestsแยก ไม่แก้ด้วยสลับawaitอย่างเดียว. ไม่มีproductionarchiveถูกแตะในงานนี้.

ขั้นต่อไป: Claudeแก้3reviewfindings, ทบทวนPR80/84/85และcontract; วางแผนrecoverablearchivecleanup+caseeventhistoryและdurablealertoutboxตามfailurebudget. การmerge/deployต้องแยกอนุมัติ. AIadapterต้องผ่านauthorization/assignmentfences, missingdata/provenance, validatedautoEvidenceและcase/profilecertaintyก่อนใช้.

หมายเหตุtests: agentprofileparallelrunหนึ่งครั้งพบexistingautoHRtimer/failureflag race; isolated2/2,serial278/278และlatestprofile286/286รวม305/305ผ่าน. ไม่ซ่อนfailureด้วยTODO/SKIP. จำนวนชุดต่างฐานไม่ควรบวกเป็นจำนวนเทสต์ไม่ซ้ำ.
