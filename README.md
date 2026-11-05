# DALDAL v1 — ระบบจัดการร้าน

Rebuild จาก prototype v0.8.1 เป็น **Vite + React 19 + TypeScript + Supabase** และ deploy บน **Vercel**

## โครงสร้าง
```
legacy/        prototype v0.8.1 เดิมทุกไบต์ (ห้ามแก้) ใช้เป็น oracle สำหรับ parity test
src/domain/    กฎธุรกิจ TS แบบ pure (แปลงจาก legacy/assets/*-core.js) ใช้ทั้ง client และ /api
src/app/       React UI
api/           Vercel Functions (server เป็นผู้ตัดสินกฎและสิทธิ์)
supabase/      SQL migrations
tests/         Vitest — tests/oracle.ts โหลด legacy core เพื่อเทียบผล
```

## คำสั่ง
```sh
npm install
npm run dev          # http://localhost:5173
npm test             # Vitest (domain + parity)
npm run typecheck
npm run build
npm run legacy:start # เปิด prototype เดิมที่ http://127.0.0.1:8785
npm run legacy:test  # unit tests เดิม
```
คัดลอก `.env.example` เป็น `.env.local` แล้วใส่ค่า Supabase

## สถานะตามแผน
- [x] Phase 0: git baseline, ย้ายของเดิมไป legacy/, scaffold, oracle test
- [x] Phase 1: domain layer TS + parity test (`src/domain`, 37 operations, เทียบ legacy ด้วย demo seed + fuzz 3,600 ขั้น + migration v1–6)
- [x] Phase 2: Supabase schema + RLS (`supabase/migrations`, ทดสอบใน PGlite: `npm run test:db`)
- [x] Phase 3: API บน Vercel Functions (`src/server`, `api/`) — ทดสอบ integration กับ migrations จริงใน PGlite
- [x] Phase 4: React UI 13 หน้า + login (Supabase) + โหมดทดลอง offline — E2E ด้วย Playwright (`npm run test:e2e`)
- [ ] Phase 5: Vercel deploy + CI

## Domain (`src/domain`)
- `import * as D from '@/domain'` — ทุกฟังก์ชันเป็น pure `(state, ...args) → state ใหม่` และ throw `DomainError` (ข้อความไทย)
- รูปแบบ state = JSON schemaVersion 6 เดียวกับ prototype → import backup เดิมได้ด้วย `D.migrate()`
- `D.withRuntime({ now, random }, fn)` ตรึงเวลาและ id (server/test)
- `tests/domain/parity.test.ts` เทียบกับ legacy ทุก operation, `tests/domain/rules.test.ts` กฎ 11 ข้อแบบอ่านง่าย

## Frontend (`src/app`)
- `npm run dev` → http://localhost:5173 · ถ้าไม่ได้ตั้ง `VITE_SUPABASE_*` แอปจะเปิด **โหมดทดลอง** อัตโนมัติ
- **โหมดทดลอง**: API ตัวเดียวกับ server (`createApp`) รันในแท็บนี้บน store ในหน่วยความจำที่บันทึกลง localStorage
  มีสมาชิกตัวอย่าง 3 คน สลับดูมุมมองเจ้าของ / ผู้จัดการ / พนักงานได้จากแถบด้านบน · เปิดหลายแท็บแล้วชนกันจะได้ 409 เหมือนของจริง
- **โหมด cloud**: login ด้วย Supabase (รหัสผ่าน หรือ magic link) แล้วเรียก `/api` บน Vercel
- หน้าจอ: งานวันนี้ · นับและยืนยัน · ยอดนับล่าสุด · เคลื่อนไหว/ตรวจครบ · เตือนซื้อ/เสนอซื้อ · จัดซื้อและอนุมัติ · ตรวจรับ ·
  ค่าใช้จ่าย · รายงาน · ตั้งค่าเกณฑ์ · ทะเบียนวัตถุดิบ · หน่วยนับ · สมาชิก/สำรองข้อมูล
- ฟอร์มไม่ตรวจกฎซ้ำฝั่ง client: ส่งให้ domain ตรวจแล้วแสดงข้อความ (422) · `useAction` จัดการ idempotency key, retry และ 409 ให้

## Database (`supabase/`)
| ตาราง | ใช้ทำอะไร | client (authenticated) |
|---|---|---|
| `shops`, `shop_members` | ร้าน / สมาชิก + บทบาท owner·manager·staff + `display_name` | อ่านได้เฉพาะร้านตัวเอง |
| `shop_state` | เอกสาร domain v6 (jsonb) + `revision` | **ไม่มีสิทธิ์** — อ่านผ่าน `/api/state` ที่กรองข้อมูลการเงินตามบทบาท |
| `audit_log` | ทุก action (append-only, แก้/ลบไม่ได้) | owner/manager อ่านได้ |
| `idempotency_keys` | กันกดซ้ำ / retry | ไม่มีสิทธิ์ |
| `evidence` + bucket `evidence` (private) | ไฟล์บิล/หลักฐาน `<shop_id>/<id>` | owner/manager อ่านได้ |

การเขียนทุกอย่างทำผ่าน `/api` ด้วย service role เท่านั้น:
`commit_shop_action()` = ตรวจสมาชิก+บทบาท → compare-and-swap ด้วย `revision` (ชน = `conflict`) → audit → idempotency ใน transaction เดียว;
`bootstrap_shop()` สร้างร้าน + owner + state เริ่มต้น

```sh
npm run test:db    # migrations + RLS ใน PGlite (ไม่ต้องใช้ Docker)
npm run db:start   # Supabase local (ต้องเปิด Docker Desktop)
npm run db:reset   # ล้างและรัน migrations ใหม่
npm run db:types   # gen types → src/db/database.generated.ts (เทียบกับ database.types.ts)
npm run db:push    # ส่ง migrations ขึ้นโปรเจกต์ที่ link แล้ว (supabase link --project-ref ...)
```

## API (`api/` → `src/server`)
ทุก request ส่ง `Authorization: Bearer <Supabase access token>`; ผลลัพธ์เป็น JSON (CSV สำหรับ report แบบมี `kind`)

| Endpoint | ใช้ทำอะไร |
|---|---|
| `GET /api/me` | ร้านที่ผู้ใช้เป็นสมาชิก + บทบาท |
| `POST /api/shops` | สร้างร้าน `{ name, displayName, template: blank\|starter\|demo }` ผู้สร้างเป็น owner |
| `GET /api/state?shop=` | state + revision (staff ได้แบบตัดข้อมูลการเงิน `redacted: true`) |
| `POST /api/action` | `{ shopId, type, payload, baseRevision, idempotencyKey }` — ดูรายการ type ใน `src/server/actions.ts` |
| `GET /api/report?shop=&from=&to=[&kind=]` | รายงานตามบทบาท / CSV |
| `POST /api/evidence` → PUT ไฟล์ด้วย signed upload | ขออัปโหลดบิล แล้วส่ง `evidenceId` ใน `saveExpense` (server ตรวจขนาด/sha-256/ชนิดไฟล์ก่อนแนบ) |
| `GET /api/evidence?shop=&id=` | ลิงก์ดาวน์โหลดอายุ 60 วินาที (owner/manager) |
| `POST /api/import` | owner นำเข้า backup ของ prototype (รุ่น 1–6) แทนข้อมูลปัจจุบัน |
| `GET/POST/PATCH /api/members` | ดู / เชิญด้วยอีเมล / เปลี่ยนบทบาทหรือพักสมาชิก (owner) |

หลักการ: ชื่อและบทบาทผู้ทำรายการมาจาก `shop_members` เสมอ (payload ใส่ `person` ไม่ได้);
ผู้อนุมัติ/ผู้ตรวจบิลเลือกด้วย `userId` ของสมาชิก; สถานะ `400` ข้อมูลผิดรูป · `401` ยังไม่ login · `403` ไม่มีสิทธิ์ ·
`409` revision ชน (โหลดใหม่แล้วทำซ้ำ) · `422` ผิดกฎธุรกิจ (ข้อความไทยจาก domain)

```sh
npm test            # domain + db + api
npm run check:api   # คอมไพล์ api/ แบบ Node ESM (เหมือน Vercel) แล้วเรียก handler จริง
```

กฎธุรกิจที่ห้ามเปลี่ยนดูได้ที่ `legacy/docs/DEV_GUIDE.md`
