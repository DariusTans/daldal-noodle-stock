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
- [ ] Phase 1: domain layer TS + parity test
- [ ] Phase 2: Supabase schema + RLS
- [ ] Phase 3: API (/api/state, /api/action, evidence, import)
- [ ] Phase 4: React UI + Auth + demo mode
- [ ] Phase 5: Vercel deploy + CI

กฎธุรกิจที่ห้ามเปลี่ยนดูได้ที่ `legacy/docs/DEV_GUIDE.md`
