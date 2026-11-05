# DALDAL v1 — ภาพรวมระบบ

แผนภาพทั้งหมดเขียนด้วย Mermaid (GitHub แสดงเป็นภาพให้อัตโนมัติ) แก้ไขตามโค้ดได้ในไฟล์นี้

1. [ภาพรวมการ deploy](#1-ภาพรวมการ-deploy)
2. [ชั้นของโค้ด](#2-ชั้นของโค้ด)
3. [ลำดับการทำรายการ (action)](#3-ลำดับการทำรายการ-action)
4. [อัปโหลดไฟล์บิล](#4-อัปโหลดไฟล์บิล)
5. [flow ธุรกิจของร้าน](#5-flow-ธุรกิจของร้าน)
6. [สถานะเอกสาร](#6-สถานะเอกสาร)
7. [ฐานข้อมูล](#7-ฐานข้อมูล)
8. [สิทธิ์ตามบทบาท](#8-สิทธิ์ตามบทบาท)
9. [การทดสอบ](#9-การทดสอบ)

---

## 1. ภาพรวมการ deploy

```mermaid
flowchart TB
  subgraph Browser["เบราว์เซอร์ (มือถือ / คอม)"]
    direction LR
    SPA["React SPA<br/>src/app"]
    Demo["โหมดทดลอง<br/>API ตัวเดียวกันรันในแท็บ + localStorage"]
    SPA -. "ไม่มี Supabase / กดทดลอง" .-> Demo
  end

  CDN["Vercel · Static CDN<br/>dist/ (Vite build)"]
  API["Vercel · Functions<br/>api/*.ts → src/server"]
  classDef vercel fill:#f5f5f4,stroke:#44403c
  class CDN,API vercel

  subgraph Supabase
    direction LR
    Auth["Auth<br/>อีเมล + รหัสผ่าน / magic link"]
    DB[("Postgres<br/>RLS + RPC")]
    Store[("Storage<br/>bucket evidence (private)")]
  end

  SPA -- "1 โหลดหน้าเว็บ" --> CDN
  SPA -- "2 login → access token" --> Auth
  SPA == "3 fetch /api/* + Bearer token" ==> API
  SPA -. "4 PUT ไฟล์บิลด้วย signed URL" .-> Store

  API -- "ตรวจ token" --> Auth
  API == "service role: อ่าน state · commit_shop_action()" ==> DB
  API -- "ออก signed URL · ตรวจไฟล์" --> Store
```

- client **ไม่เขียนฐานข้อมูลตรง** การเปลี่ยนข้อมูลทุกอย่างผ่าน `/api` ซึ่งใช้ service role
- client อ่านได้ตรงเฉพาะร้านของตัวเอง, รายชื่อสมาชิก และ (owner/manager) audit กับไฟล์หลักฐาน ผ่าน RLS
- โหมดทดลองไม่ต่ออินเทอร์เน็ต ใช้ `createApp` ตัวเดียวกับ server ต่อกับ store ในหน่วยความจำ

## 2. ชั้นของโค้ด

```mermaid
flowchart TB
  subgraph UI["src/app — React"]
    Pages["pages/*<br/>13 หน้า + login / เลือกร้าน"]
    State["state.tsx<br/>useShop · useAction · TanStack Query"]
    Client["lib/api.ts<br/>ApiClient (สัญญา /api)"]
    Pages --> State --> Client
  end

  Client -- "Transport" --> Cloud["lib/cloud-backend.ts<br/>fetch + Supabase Auth"]
  Client -- "Transport" --> DemoB["lib/demo-backend.ts<br/>createApp ในแท็บ"]

  subgraph Server["src/server — framework-agnostic (Request → Response)"]
    App["app.ts<br/>router · auth · 409 · idempotency"]
    Actions["actions.ts<br/>37 คำสั่ง + zod<br/>ชื่อ/บทบาทผู้ทำมาจาก shop_members"]
    View["view.ts<br/>กรองข้อมูลการเงินสำหรับ staff"]
    Ports["ports.ts<br/>Repo · Storage · Auth · Directory"]
    App --> Actions
    App --> View
    App --> Ports
  end

  Cloud -- "HTTPS" --> Vercel["api/*.ts → vercel.ts"] --> App
  DemoB --> App

  Ports --> SupaImpl["supabase.ts<br/>(production)"]
  Ports --> MemImpl["memory.ts<br/>(โหมดทดลอง)"]
  Ports --> PgImpl["tests/api/harness.ts<br/>(PGlite ในเทสต์)"]

  subgraph Domain["src/domain — กฎธุรกิจ (pure TypeScript)"]
    Ops["37 operations<br/>(state, ...args) → state ใหม่"]
    Validate["validate · migrate v1–6"]
    Queries["stockRows · report · workflowTasks"]
  end

  Actions --> Ops
  View --> Queries
  Pages -- "แสดงผล / คำนวณ" --> Queries
  Ops --> Validate

  Legacy["legacy/assets/*-core.js<br/>prototype v0.8.1 (oracle)"] -. "parity test" .- Ops
```

- `src/domain` ไม่รู้จัก React, HTTP หรือฐานข้อมูล ใช้ได้ทั้งในเบราว์เซอร์และบน server
- server เป็นผู้ตัดสินกฎจริง ส่วน client ใช้ domain เพื่อแสดงผล (ยอดคงเหลือ, งานวันนี้, ข้อควรตรวจ)
- `ports.ts` ทำให้ใช้โค้ด API ชุดเดียวกันได้สามที่: Supabase จริง, โหมดทดลอง และเทสต์

## 3. ลำดับการทำรายการ (action)

ตัวอย่าง: ผู้จัดการยืนยันรับสินค้า

```mermaid
sequenceDiagram
  autonumber
  actor M as ผู้จัดการ
  participant UI as React (useAction)
  participant API as /api/action
  participant D as src/domain
  participant DB as Postgres

  M->>UI: กด "ยืนยันรับเข้าสต็อก"
  UI->>API: POST {shopId, type: confirmReceipt, payload,<br/>baseRevision: 41, idempotencyKey: uuid}
  API->>API: ตรวจ token → userId
  API->>DB: shop_members (role, display_name)
  API->>DB: idempotency_keys มี key นี้แล้ว?
  alt เคยทำแล้ว (retry)
    API-->>UI: 200 {replayed: true, state}
  else รายการใหม่
    API->>DB: shop_state (revision, data)
    alt revision ไม่ตรง 41
      API-->>UI: 409 conflict
      UI->>UI: แจ้งเตือน + โหลดข้อมูลล่าสุด
    else revision ตรง
      API->>D: confirmReceipt(state, id, {person: display_name}, role)
      alt ผิดกฎ
        D-->>API: DomainError("ยอดนับอ้างอิงเปลี่ยน …")
        API-->>UI: 422 ข้อความไทยจาก domain
      else ผ่านกฎ
        D-->>API: state ใหม่ (revision 42)
        API->>DB: commit_shop_action() — transaction เดียว
        Note over DB: ตรวจสมาชิก+บทบาท<br/>UPDATE … WHERE revision = 41<br/>INSERT audit_log<br/>INSERT idempotency_keys
        DB-->>API: committed / conflict
        API-->>UI: 200 state (กรองตามบทบาท)
      end
    end
  end
```

| สถานะ | ความหมาย | หน้าจอทำอะไร |
|---|---|---|
| 200 | สำเร็จ (หรือ `replayed` / `unchanged`) | อัปเดต cache แสดง toast |
| 400 | payload ผิดรูป (เช่นแนบ `person` มาเอง) | แสดงข้อความในฟอร์ม |
| 401 / 403 | ยังไม่ login / ไม่มีสิทธิ์ | ไปหน้า login / แจ้งเตือน |
| 409 | คนอื่นแก้ข้อมูลไปก่อน | โหลดใหม่ ให้ผู้ใช้กดอีกครั้ง |
| 422 | ผิดกฎธุรกิจ | แสดงข้อความไทยจาก domain |

## 4. อัปโหลดไฟล์บิล

```mermaid
sequenceDiagram
  autonumber
  actor M as ผู้จัดการ
  participant UI as React
  participant API as /api
  participant S as Storage (evidence)
  participant DB as Postgres

  M->>UI: เลือกไฟล์ bill.png
  UI->>UI: คำนวณ sha-256 ในเบราว์เซอร์
  UI->>API: POST /api/evidence {name, type, size, sha256}
  API->>DB: มีไฟล์ hash นี้ที่ตรวจแล้ว?
  alt มีแล้ว
    API-->>UI: {evidenceId, upload: null}
  else ยังไม่มี
    API->>DB: INSERT evidence (path = shop_id/evidence_id)
    API->>S: createSignedUploadUrl
    API-->>UI: {evidenceId, upload: token}
    UI->>S: PUT ไฟล์ตรงไป Storage (ไม่ผ่าน Vercel)
  end
  UI->>API: POST /api/action saveExpense {evidenceId, …}
  API->>S: อ่านไฟล์ที่อัปโหลด
  API->>API: ตรวจขนาด · sha-256 · magic bytes
  API->>DB: evidence.verified_at = now()
  API->>DB: commit (attachment = {evidenceId, path, hash, …})
  API-->>UI: 200
  Note over UI,S: ดูไฟล์: GET /api/evidence → signed URL อายุ 60 วินาที (owner/manager)
```

## 5. flow ธุรกิจของร้าน

```mermaid
flowchart TB
  subgraph Master["ทะเบียน"]
    direction LR
    U["หน่วยนับ"] --- I["วัตถุดิบ"]
  end

  subgraph Stock["สต็อก"]
    direction LR
    C["รอบนับ<br/>ร่าง → ส่งตรวจ → ยืนยัน"]
    L["ยอดคำนวณ<br/>= ยอดนับ + เคลื่อนไหว"]
    K["ตรวจความครบ<br/>(ผู้จัดการรับรอง)"]
    R["ยอดอ้างอิง"]
    P["จุดเตือน / เป้าหมาย"]
    C --> L --> K --> R
    C -- "ยังไม่ตรวจครบ: ใช้ยอดนับ" --> R
    P --> A{"ยอดอ้างอิง<br/>≤ จุดเตือน?"}
    R --> A
  end

  subgraph Buy["จัดซื้อ"]
    direction LR
    Q["เสนอซื้อ<br/>จำนวน = เป้าหมาย − ยอดอ้างอิง"]
    O["ใบจัดซื้อ<br/>เทียบราคา · เลือกแหล่ง"]
    AP["ผู้อนุมัติ<br/>(ชื่อ + บทบาทตรงเกณฑ์)"]
    PO["บันทึกซื้อแล้ว<br/>ยังไม่เพิ่มสต็อก"]
    Q --> O --> AP --> PO
  end

  subgraph Recv["ตรวจรับ"]
    direction LR
    RD["ร่างใบรับ (พนักงาน)"]
    RC["ยืนยันรับ (ผู้จัดการ)<br/>+สต็อกครั้งเดียว"]
    CL["ปิดงานรับ"]
    RD --> RC --> CL
  end

  subgraph Fin["การเงิน"]
    direction LR
    E["บิล / ค่าใช้จ่าย<br/>+ไฟล์หลักฐาน"]
    ER["ผู้ตรวจบิล"]
    E --> ER
  end

  Rep["รายงาน<br/>ยอดซื้อ ≠ ค่าใช้จ่าย<br/>(ห้ามบวกรวม)"]

  I --> C
  A -- "ใช่" --> Q
  PO --> RD
  RC -- "เคลื่อนไหว: รับเข้า" --> L
  PO -. "อ้างอิงใบซื้อ" .-> E
  CL --> Q
  PO --> Rep
  ER -- "ยืนยันแล้วจึงนับ" --> Rep
  R --> Rep
```

## 6. สถานะเอกสาร

```mermaid
stateDiagram-v2
  direction LR
  state "รอบนับ" as Count {
    state "ร่าง (draft)" as c_draft
    state "รอตรวจ (review)" as c_review
    state "ยืนยันแล้ว (confirmed)" as c_confirmed
    state "ยกเลิก (cancelled)" as c_cancelled
    [*] --> c_draft: เปิดรอบ
    c_draft --> c_review: ส่งตรวจ
    c_review --> c_draft: ส่งกลับ
    c_review --> c_confirmed: ยืนยัน (ล็อก)
    c_draft --> c_cancelled: ยกเลิก
    c_review --> c_cancelled: ยกเลิก
  }
```

```mermaid
stateDiagram-v2
  direction LR
  state "ใบจัดซื้อ" as Order {
    [*] --> draft: เปิดจากเสนอซื้อ (ready)
    draft --> pending: ส่งพิจารณา
    returned --> pending: ส่งใหม่
    pending --> returned: ส่งกลับ
    pending --> approved: อนุมัติ (เกินเกณฑ์)
    pending --> cleared: ผ่าน (ไม่เข้าเกณฑ์วงเงิน)
    pending --> rejected: ไม่อนุมัติ
    approved --> ordered: บันทึกซื้อ
    cleared --> ordered: บันทึกซื้อ
    pending --> draft: ถอนกลับ
    approved --> draft: ถอนกลับ
    cleared --> draft: ถอนกลับ
    draft --> cancelled
    returned --> cancelled
    pending --> cancelled
    approved --> cancelled
    cleared --> cancelled
    ordered --> [*]: ติดตามต่อที่ตรวจรับ
  }
```

```mermaid
stateDiagram-v2
  direction LR
  state "ใบรับ" as Receipt {
    state "ร่างรับ (draft)" as r_draft
    state "ยืนยันรับ (confirmed)" as r_confirmed
    state "ยกเลิก (cancelled)" as r_cancelled
    state "ยกเลิก+กลับรายการ (void)" as r_void
    [*] --> r_draft: พนักงานร่าง
    r_draft --> r_confirmed: ผู้จัดการยืนยัน (+สต็อก)
    r_draft --> r_cancelled: ยกเลิก
    r_confirmed --> r_void: ยกเลิก (บันทึกกลับรายการ −สต็อก)
  }
  state "ค่าใช้จ่าย" as Expense {
    state "ร่าง (draft)" as e_draft
    state "รอตรวจ (pending)" as e_pending
    state "ส่งกลับ (returned)" as e_returned
    state "ยืนยันแล้ว (confirmed)" as e_confirmed
    state "ยกเลิก (cancelled)" as e_cancelled
    [*] --> e_draft: บันทึกร่าง
    e_draft --> e_pending: ส่งตรวจ
    e_returned --> e_pending: ส่งใหม่
    e_pending --> e_returned: ส่งกลับ
    e_pending --> e_confirmed: ผู้ตรวจยืนยัน (นับยอด)
    e_draft --> e_cancelled
    e_pending --> e_cancelled
    e_returned --> e_cancelled
    e_confirmed --> e_cancelled: เฉพาะเจ้าของ
  }
```

## 7. ฐานข้อมูล

```mermaid
erDiagram
  AUTH_USERS ||--o{ SHOP_MEMBERS : "เป็นสมาชิก"
  SHOPS ||--o{ SHOP_MEMBERS : "มี"
  SHOPS ||--|| SHOP_STATE : "เอกสารร้าน"
  SHOPS ||--o{ AUDIT_LOG : "ประวัติ"
  SHOPS ||--o{ IDEMPOTENCY_KEYS : "กันทำซ้ำ"
  SHOPS ||--o{ EVIDENCE : "ไฟล์หลักฐาน"
  EVIDENCE ||--|| STORAGE_OBJECT : "shop_id/evidence_id"

  SHOPS {
    uuid id PK
    text name
  }
  SHOP_MEMBERS {
    uuid shop_id PK
    uuid user_id PK
    member_role role "owner | manager | staff"
    text display_name "ไม่ซ้ำในร้าน"
    bool active
  }
  SHOP_STATE {
    uuid shop_id PK
    bigint revision "ตรงกับ data.revision"
    jsonb data "domain schemaVersion 6"
  }
  AUDIT_LOG {
    bigint id PK
    uuid actor_id
    member_role actor_role
    text action
    jsonb payload
    bigint revision_before
    bigint revision_after
  }
  IDEMPOTENCY_KEYS {
    uuid shop_id PK
    text key PK
    bigint revision_after
  }
  EVIDENCE {
    uuid id PK
    text object_path "unique"
    text sha256 "unique ต่อร้าน"
    text mime
    int size_bytes "≤ 5 MB"
    timestamptz verified_at
  }
```

| ตาราง | client อ่าน | client เขียน |
|---|---|---|
| `shops`, `shop_members` | ร้านของตัวเอง | ไม่ได้ |
| `shop_state` | **ไม่ได้** (อ่านผ่าน `/api/state` ที่กรองตามบทบาท) | ไม่ได้ |
| `audit_log` | owner / manager | ไม่ได้ (append-only) |
| `evidence`, bucket `evidence` | owner / manager | ไม่ได้ (signed upload ผ่าน `/api`) |
| `idempotency_keys` | ไม่ได้ | ไม่ได้ |

เอกสารร้านทั้งก้อนเก็บใน `shop_state.data` (jsonb) รูปแบบเดียวกับ prototype ทำให้นำเข้า backup เดิมได้ทันที
ถ้าภายหลังต้องทำรายงานหนักหรือ query ข้ามร้าน ค่อยแยกเป็นตารางย่อยทีละโดเมน

## 8. สิทธิ์ตามบทบาท

```mermaid
flowchart LR
  subgraph Staff["พนักงาน"]
    s1["นับสต็อก / ส่งตรวจ"]
    s2["บันทึกรับเข้า · เบิกใช้ · ของเสีย"]
    s3["เสนอซื้อ"]
    s4["ร่างใบรับ"]
  end
  subgraph Manager["ผู้จัดการ (+ทุกอย่างของพนักงาน)"]
    m1["ยืนยันรอบนับ · ปรับยอด · กลับรายการ"]
    m2["ตรวจความครบ · จุดเตือน · ตรวจเสนอซื้อ"]
    m3["ใบจัดซื้อ · บันทึกซื้อ"]
    m4["ยืนยันรับ · ปิดงานรับ"]
    m5["บิลค่าใช้จ่าย · ทะเบียน"]
  end
  subgraph Owner["เจ้าของ (+ทุกอย่างของผู้จัดการ)"]
    o1["ตั้งเกณฑ์อนุมัติ · ผู้ตรวจบิล"]
    o2["ยกเลิกบิลที่ยืนยันแล้ว"]
    o3["เชิญ / เปลี่ยนบทบาท / พักสมาชิก"]
    o4["นำเข้าข้อมูลสำรอง"]
  end
  AP["อนุมัติใบจัดซื้อ / ยืนยันบิล<br/>= เฉพาะคนที่ตั้งเป็นผู้อนุมัติ / ผู้ตรวจ<br/>(ชื่อ + บทบาทต้องตรง)"]
  Manager -.-> AP
  Owner -.-> AP
```

พนักงานไม่ได้รับข้อมูลบิล ราคา ยอดซื้อ หรือวงเงินจาก server เลย ไม่ใช่แค่ซ่อนในหน้าจอ

## 9. การทดสอบ

```mermaid
flowchart LR
  L["legacy/assets<br/>prototype v0.8.1"] -- "parity: demo seed + fuzz 3,600 ขั้น<br/>+ migration v1–6" --> D["src/domain"]
  R["กฎ 11 ข้อ<br/>(rules.test.ts)"] --> D
  DB["migrations จริงใน PGlite<br/>(schema.test.ts)"] --> SQL["RLS · RPC · append-only"]
  API["API integration<br/>(api.test.ts)"] --> S["src/server"]
  API -. "รันกับ" .-> P["PGlite repo"]
  API -. "รันกับ" .-> M["memory repo"]
  E2E["Playwright<br/>desktop + mobile"] --> UI["build จริง · โหมดทดลอง<br/>journey หลายบทบาท · 2 แท็บชนกัน"]
  CA["check:api"] --> V["api/ แบบ Node ESM<br/>(เหมือน Vercel)"]
```

| คำสั่ง | ตรวจอะไร |
|---|---|
| `npm test` | domain, ฐานข้อมูล, API (Vitest) |
| `npm run test:e2e` | build แล้วรัน Playwright |
| `npm run check:api` | คอมไพล์และเรียก `api/` แบบที่ Vercel รัน |
| `npm run legacy:test` | unit tests เดิมของ prototype |
