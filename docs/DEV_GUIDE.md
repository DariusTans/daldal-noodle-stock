# ข้อมูลสำหรับทีม Dev

## โครงสร้างและเส้นทาง
- index.html: shell + ลำดับโหลด scripts (ต้องรักษาลำดับ)
- core → counts-core → stock-core → buy-core → receive-core → expense-core → report-core → workflow-core: ขยายกฎเดิมเป็นชั้นตามรุ่น
- app.js: local persistence, route, ทะเบียน, backup/import
- *-ui.js / *.css: หน้าจอแต่ละกลุ่ม; ux-ui.js: การส่งต่อและ UX; demo-data.js/demo-mode.js: ข้อมูลจำลอง
- home: งานวันนี้; counting/latest/movements/alerts: สต็อก; buy/receiving: จัดซื้อ; expenses: บิล; dashboard: รายงาน; settings/ingredients/units/roles: ตั้งค่า
- งานวันนี้คำนวณจากสถานะเอกสารเดิม ไม่ได้มีฐานงานค้างซ้ำ

## Data contract
schemaVersion 6; key ข้อมูลจริงใน browser = daldal-operations-data; key demo = daldal-operations-demo-v1
ข้อมูลเก่ารุ่น1–5 migrate และเก็บสำรอง before-v6; ห้าม seed ทับข้อมูลเดิม
ดู field/validation จริงใน core files และ tests; ชุดนี้ไม่มี API หรือ SQL schema เพราะยังไม่มี backend
เงินเก็บ integer หน่วยย่อย 1/100; จำนวนรองรับทศนิยม3ตำแหน่ง; ปัดจำนวนชุดซื้อขึ้นให้พอความต้องการ
ข้อมูลหลักเชื่อม ingredient/unit → count round → movements/checks/policies → purchaseRequests → purchaseOrders → receipts → expenses
ข้อมูลทะเบียนที่เปลี่ยนต้องไม่ทำให้ snapshot ประวัติเปลี่ยนตาม
หลักฐานอยู่ใน state/ไฟล์สำรองเดิม ต้องวางแผน object storage และขนาดไฟล์เมื่อทำ backend
revision และการตรวจข้ามแท็บช่วยป้องกันเขียนทับใน browser ไม่ใช่ transaction ข้ามคน/เครื่อง

## กฎที่ห้ามเปลี่ยนโดยไม่ทบทวน
1. รอบนับ draft → review → confirmed; ส่งกลับแก้ได้ก่อนยืนยัน รอบยืนยันล็อก
2. ยอดคำนวณ = ฐานนับยืนยัน + การเคลื่อนไหวหลังฐานนั้น; referenceQty ใช้ยอดคำนวณได้เมื่อรับรองความครบ มิฉะนั้นใช้ยอดนับยืนยัน
3. มีรายการใหม่แล้วความครบเดิมหมดอายุ; เปิดรอบนับพักเคลื่อนไหว/เสนอซื้อ
4. เตือน referenceQty <= minimum; target > minimum; จำนวนเสนอ = target-referenceQty
5. เสนอซื้อ draft → ready → completed หรือ cancelled; ready ยังไม่ใช่อนุมัติซื้อ
6. ใบซื้อ draft/returned → pending → approved/cleared → ordered; rejected/cancelled ปิดใบ ผู้พิจารณาต้องตรงชื่อและบทบาทที่ตั้ง
7. ราคา/จำนวน/ต้นทาง/เกณฑ์เปลี่ยนต้องทบทวนและพิจารณาใหม่; markOrdered ไม่เพิ่มสต็อกและไม่ยืนยันค่าใช้จ่าย
8. ตรวจรับเพิ่ม stock เฉพาะ accepted ที่ยืนยันแล้วครั้งเดียว; รับบางส่วน/ไม่รับ/ติดตามปัญหาได้ ปิดรับต้องจัดการร่างและปัญหาค้าง
9. กลับรายการด้วยรายการหักล้าง ไม่ลบประวัติ; ห้ามรับซ้ำของที่นับรวมแล้ว
10. expense ร่าง/ส่งตรวจยังไม่รวมยอด; ยืนยันแล้วจึงนับ; ไม่เปลี่ยน stock; เก็บเหตุผลกรณีไม่มีหลักฐาน/สงสัยซ้ำ/ยกเลิก
11. Dashboard แยกยอดซื้อจากค่าใช้จ่าย ห้ามบวกรวมเป็นรายจ่ายซ้ำ; ไม่ใช่รายงานยอดขายหรือกำไร

## Demo / reset / backup
เปิดปกติหรือ ?data=demo#home: ชุดสมมติ 8 วัตถุดิบ, 6 หน่วย, ใบซื้อ4, ใบรับ2, บิล5; ยอดซื้อ530บาท / ค่าใช้จ่ายยืนยัน500บาท
demo-data.js สร้างข้อมูลที่เชื่อมกันตามกฎเดิม บันทึกต่อหลัง reload ไม่ seed ซ้ำทุกครั้ง
รีเซ็ตเฉพาะ Demo ใน DevTools ของ origin ทดสอบ: localStorage.removeItem('daldal-operations-demo-v1'); location.reload();
อย่า clear ทั้ง storage ของผู้ใช้ ก่อนย้าย origin หรือเปลี่ยนเครื่องให้ export JSON ผ่านเมนูบทบาท/สำรอง
Import เป็นการแทนที่ ไม่ใช่ merge ต้องสำรองก่อน; ZIP นี้ไม่บรรจุข้อมูลที่ผู้ใช้กรอกใน browser

## ลำดับพัฒนาต่อที่เสนอ (ต้องตกลง scope กับเจ้าของ)
P0: ยืนยัน workflow/ผู้พิจารณา/วงเงินกับร้าน และทดลอง UAT จากบทที่แนบ
P0: ออกแบบ backend + database + authentication + server-side authorization + attachment storage + audit + backup/restore
P0: ย้ายกฎสำคัญไป server; ใช้ transaction, idempotency, concurrency control โดยเฉพาะรับสินค้า/ยืนยันบิล; ตรวจ migration กับข้อมูลสำรองแยก
P1: เชื่อม frontend ผ่าน API คงรหัสอ้างอิงและสถานะ; ทดสอบหลายคน/หลายเครื่องจริง และการกู้ข้อมูล
P1: ปรับ UX จากผลทดลองจริง
P2: AI/OCR เสนอข้อมูลให้คนตรวจ หลังยืนยัน scope; ยังไม่ได้เชื่อมในรุ่นนี้
ไม่มีบัญชีจริง การจ่ายเงิน ส่งคำสั่งซื้ออัตโนมัติ POS/หัก stock จากยอดขาย หรือระบบบัญชีจริงในชุดส่งต่อ

## ขอบเขตการรับงาน
ทำต่อจาก code นี้; อย่าตีความการซ่อนปุ่มหรือ role selector ว่าเป็น security
หลักฐานผ่าน automated tests ไม่เท่ากับทีมร้านผ่าน UAT; deployment และสิทธิ์เข้าถึงต้องตกลงกับเจ้าของ ไม่ได้โอนบัญชี hosting ใน ZIP
