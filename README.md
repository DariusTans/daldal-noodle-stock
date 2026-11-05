# DALDAL — Developer Handover

Product v0.8.1 • ชุดส่งต่อ 2 พฤศจิกายน 2026

## เริ่มต้น
เป็น frontend prototype แบบ HTML/CSS/JavaScript ไม่ต้อง build และยังไม่มี backend
1. ติดตั้ง Node.js 20 ขึ้นไป
2. เปิด terminal ที่โฟลเดอร์นี้แล้วรัน `npm start`
3. เปิด http://127.0.0.1:8785/ จะมีข้อมูล Demo พร้อมทดลองทุกหน้า
4. เปิด `?data=workspace#home` สำหรับข้อมูลของฉัน (แยกจาก Demo)

การเปิด UI ไม่ต้อง npm install; dependency ใช้เฉพาะทดสอบ browser

## ทดสอบ
```sh
npm install
npx playwright install chromium
npm test
# เปิด npm start ในอีก terminal ก่อน:
npm run test:browser
npm run test:journey
```
ใช้ Chromium ที่ Playwright จัดการโดยค่าเริ่มต้น หรือกำหนด CHROME_PATH เป็น Chrome ในเครื่อง
รันทีละชุดเพื่อไม่ให้ไฟล์ test-output ชนกัน Browser tests สร้าง context แยกจาก profile ผู้ใช้
Journey ทดสอบข้อมูลตั้งต้นผ่าน UI; ตั้ง JOURNEY_MOBILE=1 เมื่อต้องการเส้นทางมือถือเต็ม

## อ่านต่อ
- docs/DEV_GUIDE.md: โครงสร้าง กฎข้อมูล และสิ่งที่ต้องพัฒนาต่อ
- docs/VERIFICATION.md: ผลตรวจชุดส่งต่อครั้งนี้
- docs/original/FLOW_GUIDE.md: วิธีใช้งานแต่ละ Flow
- docs/original/UAT_SCRIPT.md: บททดสอบทีมร้าน (ยังไม่อ้างว่าทดลองผ่าน)
- docs/original/STATUS.md: สถานะ 10 Feature
- docs/original/HANDOFF.md: รายละเอียดกฎสะสมตามรุ่น ให้ใช้หัวข้อล่าสุดร่วมด้วย

index.html และ assets/ เป็น source จริงตรงกับ Product เดิมทุกไบต์
ปรับเฉพาะ test harness ให้ใช้ npm Playwright, CHROME_PATH และ test-output แทน path เฉพาะเครื่อง
ไม่มีสไลด์ เอกสารธุรกิจ ไฟล์ deployment credentials หรือข้อมูลจาก browser ผู้ใช้ในชุดนี้
เอกสาร original เป็นบันทึกย้อนหลัง บางข้อความอ้าง path/การ deploy เดิมซึ่งไม่ได้แนบมาด้วย

## ส่งขึ้นเว็บ
อัปโหลดเฉพาะ index.html และ assets/ ไปยัง static hosting ที่ทีมได้รับอนุญาต ตั้ง HTTPS และสิทธิ์ตามที่เจ้าของกำหนด
ไม่ต้องเผยแพร่ tests, docs, test-output หรือข้อมูลสำรอง การส่งชุดนี้ไม่เปลี่ยน Site เดิม
ระบบปัจจุบันไม่พร้อมถือเป็นระบบ production ที่บังคับสิทธิ์หรือใช้ร่วมกันหลายเครื่อง
