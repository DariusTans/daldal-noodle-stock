/**
 * The business rules from legacy/docs/DEV_GUIDE.md ("กฎที่ห้ามเปลี่ยนโดยไม่ทบทวน"), as
 * readable specs against the TypeScript domain. Parity with the prototype is covered
 * separately (parity.test.ts); these keep the rules pinned once the legacy code is retired.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as D from '../../src/domain';
import { demoSeed } from '../../src/domain/demo';
import type { ShopState } from '../../src/domain';

const OWNER = 'เจ้าของตัวอย่าง',
  MANAGER = 'ผู้จัดการตัวอย่าง',
  STAFF = 'พนักงานตัวอย่าง';

let t = Date.parse('2026-11-05T03:00:00.000Z');
const tick = () => vi.setSystemTime((t += 60_000));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  tick();
});
afterEach(() => vi.useRealTimers());

const row = (s: ShopState, id: string) => D.stockRows(s).find((r) => r.id === id)!;

/** Fresh shop with one confirmed count (qty 2 everywhere) and min 5 / target 12 on i-1. */
function counted(): ShopState {
  let s = D.seed();
  s = D.startCount(s, 'เปิดร้าน', STAFF, 'staff');
  const r = s.countRounds[0]!;
  s = D.saveCount(
    s,
    r.id,
    r.lines.map((l) => ({ ingredientId: l.ingredientId, qty: 2 })),
    STAFF,
    'staff',
  );
  s = D.submitCount(s, r.id, STAFF, 'staff');
  s = D.confirmCount(s, r.id, MANAGER, 'manager');
  return D.savePolicy(
    s,
    { ingredientId: 'i-1', minimum: 5, target: 12, enabled: true, person: MANAGER },
    'manager',
  );
}

describe('1. count rounds: draft → review → confirmed', () => {
  it('can be returned for edits before confirmation and is locked after', () => {
    let s = D.seed();
    s = D.startCount(s, 'รอบ', STAFF, 'staff');
    const id = s.countRounds[0]!.id;
    const lines = s.countRounds[0]!.lines;
    expect(() => D.submitCount(s, id, STAFF, 'staff')).toThrow('ยังนับไม่ครบ');
    s = D.saveCount(
      s,
      id,
      lines.map((l) => ({ ingredientId: l.ingredientId, qty: '3' })),
      STAFF,
      'staff',
    );
    s = D.submitCount(s, id, STAFF, 'staff');
    expect(() => D.confirmCount(s, id, STAFF, 'staff')).toThrow(
      'บทบาทนี้ยืนยันหรือส่งกลับรอบนับไม่ได้',
    );
    s = D.returnCount(s, id, 'ตรวจอีกครั้ง', MANAGER, 'manager');
    expect(s.countRounds[0]!.status).toBe('draft');
    s = D.submitCount(s, id, STAFF, 'staff');
    s = D.confirmCount(s, id, MANAGER, 'manager');
    expect(() =>
      D.saveCount(
        s,
        id,
        lines.map((l) => ({ ingredientId: l.ingredientId, qty: 1, reason: 'แก้' })),
        STAFF,
        'staff',
      ),
    ).toThrow('สถานะรอบนับเปลี่ยนแล้ว');
  });

  it('blank is "not counted", never zero; only one open round at a time', () => {
    expect(D.parseQuantity('')).toBeNull();
    expect(D.parseQuantity('0')).toBe(0);
    expect(() => D.parseQuantity('1.2345')).toThrow();
    const s = D.startCount(D.seed(), 'รอบ', STAFF, 'staff');
    expect(() => D.startCount(s, 'อีกรอบ', STAFF, 'staff')).toThrow('มีรอบนับค้างอยู่');
  });
});

describe('2–3. reference quantity and completeness', () => {
  it('uses the confirmed count until a completeness check covers the movements', () => {
    let s = counted();
    s = D.addMovement(
      s,
      { ingredientId: 'i-1', kind: 'use', qty: 1, person: STAFF, reason: 'ใช้' },
      'staff',
    );
    expect(row(s, 'i-1')).toMatchObject({ ledger: 1, referenceQty: 2 });
    s = D.reviewLedger(s, 'i-1', 'ตรวจครบ', MANAGER, true, 'manager');
    expect(row(s, 'i-1')).toMatchObject({ ledger: 1, referenceQty: 1 });
  });

  it('a new movement expires the previous check', () => {
    let s = counted();
    s = D.reviewLedger(s, 'i-1', 'ตรวจครบ', MANAGER, true, 'manager');
    expect(row(s, 'i-1').check).toBeTruthy();
    s = D.addMovement(
      s,
      { ingredientId: 'i-1', kind: 'waste', qty: 1, person: STAFF, reason: 'เสีย' },
      'staff',
    );
    expect(row(s, 'i-1').check).toBeUndefined();
    expect(row(s, 'i-1').referenceQty).toBe(2);
  });

  it('an open count pauses movements and purchase requests', () => {
    const s = D.startCount(counted(), 'รอบสอง', STAFF, 'staff');
    expect(() =>
      D.addMovement(
        s,
        { ingredientId: 'i-1', kind: 'use', qty: 1, person: STAFF, reason: 'ใช้' },
        'staff',
      ),
    ).toThrow('มีรอบนับค้างอยู่');
    expect(() => D.createRequest(s, 'i-1', STAFF, 'staff')).toThrow('มีรอบนับค้างอยู่');
  });

  it('stock can never go negative', () => {
    const s = counted();
    expect(() =>
      D.addMovement(
        s,
        { ingredientId: 'i-1', kind: 'use', qty: 3, person: STAFF, reason: 'ใช้' },
        'staff',
      ),
    ).toThrow('ยอดตามรายการจะติดลบ');
  });
});

describe('4. reorder alerts', () => {
  it('alerts at referenceQty <= minimum and proposes target − referenceQty', () => {
    const s = counted();
    expect(row(s, 'i-1')).toMatchObject({ low: true, suggested: 10 });
    expect(row(s, 'i-2').low).toBe(false); // no policy
    expect(() =>
      D.savePolicy(
        s,
        { ingredientId: 'i-2', minimum: 5, target: 5, enabled: true, person: MANAGER },
        'manager',
      ),
    ).toThrow('ยอดเป้าหมายต้องมากกว่าจุดเตือน');
  });
});

describe('5–7. purchasing', () => {
  it('a ready request is not an approval: the order starts as a draft', () => {
    const s = demoSeed();
    const ready = s.purchaseRequests.find((p) => p.ingredientId === 'i-5')!;
    expect(ready.status).toBe('ready');
    const out = D.createOrder(s, ready.id, 'THB', MANAGER, 'manager');
    expect(out.purchaseOrders.at(-1)!.status).toBe('draft');
  });

  it('only the configured approver (name and role) can decide', () => {
    const s = demoSeed();
    const pending = s.purchaseOrders.find((o) => o.status === 'pending')!;
    const msg = 'ผู้พิจารณาต้องตรงชื่อและบทบาทที่ตั้งไว้';
    expect(() => D.decideOrder(s, pending.id, 'approve', 'ok', MANAGER, 'manager')).toThrow(msg);
    expect(() => D.decideOrder(s, pending.id, 'approve', 'ok', 'คนอื่น', 'owner')).toThrow(msg);
    const out = D.decideOrder(s, pending.id, 'approve', 'ok', OWNER, 'owner');
    expect(out.purchaseOrders.find((o) => o.id === pending.id)!.status).toBe('approved');
  });

  it('packs are rounded up to cover the quantity', () => {
    expect(
      D.quoteTotal(
        { qty: 10 },
        { packQty: 3, packPrice: 5000, shipping: 0, extra: 0, discount: 0 },
      ),
    ).toMatchObject({
      packs: 4,
      units: 12,
      total: 20000,
    });
  });

  it('marking an order as purchased neither adds stock nor confirms an expense', () => {
    let s = demoSeed();
    const pending = s.purchaseOrders.find((o) => o.status === 'pending')!;
    s = D.decideOrder(s, pending.id, 'approve', 'ok', OWNER, 'owner');
    const before = row(s, pending.ingredientId).ledger;
    const totals = D.expenseTotals(s);
    s = D.markOrdered(
      s,
      pending.id,
      { reference: 'PO-9', person: MANAGER, checked: true },
      'manager',
    );
    expect(row(s, pending.ingredientId).ledger).toBe(before);
    expect(D.expenseTotals(s)).toEqual(totals);
  });
});

describe('8–9. receiving and reversals', () => {
  it('a confirmed receipt adds stock exactly once; delivery references cannot repeat', () => {
    let s = demoSeed();
    const o = s.purchaseOrders.find((o) => o.ingredientId === 'i-2')!;
    const before = row(s, 'i-2').ledger!;
    s = D.saveReceipt(
      s,
      o.id,
      {
        reference: 'DEL-NEW',
        accepted: 2,
        rejected: 0,
        issueType: 'none',
        note: 'ok',
        person: STAFF,
      },
      'staff',
    );
    expect(row(s, 'i-2').ledger).toBe(before); // draft does not count
    const rid = s.receipts.at(-1)!.id;
    expect(() =>
      D.confirmReceipt(s, rid, { person: STAFF, checked: true, notCounted: true }, 'staff'),
    ).toThrow('บทบาทนี้ทำรายการนี้ไม่ได้');
    s = D.confirmReceipt(s, rid, { person: MANAGER, checked: true, notCounted: true }, 'manager');
    expect(row(s, 'i-2').ledger).toBe(before + 2);
    expect(() =>
      D.confirmReceipt(s, rid, { person: MANAGER, checked: true, notCounted: true }, 'manager'),
    ).toThrow();
    expect(() =>
      D.saveReceipt(
        s,
        o.id,
        {
          reference: 'del-new',
          accepted: 1,
          rejected: 0,
          issueType: 'none',
          note: 'ok',
          person: STAFF,
        },
        'staff',
      ),
    ).toThrow('เลขส่งของนี้บันทึกไว้แล้ว');
  });

  it('receiving-linked stock must be fixed by voiding the receipt, which reverses without deleting', () => {
    let s = demoSeed();
    const r = s.receipts.find((r) => r.status === 'confirmed' && r.ingredientId === 'i-2')!;
    expect(() => D.reverseMovement(s, r.movementId!, 'ผิด', MANAGER, 'manager')).toThrow(
      'ให้ยกเลิกใบรับที่หน้าตรวจรับ',
    );
    const count = s.movements.length;
    s = D.cancelReceipt(s, r.id, 'บันทึกผิด', MANAGER, 'manager');
    expect(s.movements).toHaveLength(count + 1);
    expect(s.movements.at(-1)).toMatchObject({ kind: 'reverse', reverseOf: r.movementId });
    expect(s.receipts.find((x) => x.id === r.id)!.status).toBe('void');
  });

  it('closing with open issues is blocked', () => {
    const s = demoSeed();
    const o = s.purchaseOrders.find((o) => o.ingredientId === 'i-2')!;
    expect(() =>
      D.closeReceiving(
        s,
        o.id,
        { person: MANAGER, reason: 'ปิด', checked: true, closeShort: true },
        'manager',
      ),
    ).toThrow('ยังมีร่างรับหรือปัญหาค้าง');
  });
});

describe('10–11. expenses and reporting', () => {
  it('only confirmed expenses count, and expenses never touch stock', () => {
    const s = demoSeed();
    expect(D.expenseTotals(s).THB).toEqual({ total: 50000, shop: 50000, personal: 0 });
    const draft = s.expenses.find((e) => e.status === 'draft')!;
    const stock = D.stockRows(s).map((r) => r.ledger);
    const out = D.submitExpense(s, draft.id, MANAGER, 'manager');
    expect(D.expenseTotals(out)).toEqual(D.expenseTotals(s));
    expect(D.stockRows(out).map((r) => r.ledger)).toEqual(stock);
  });

  it('confirmed expenses can only be cancelled by the owner', () => {
    const s = demoSeed();
    const confirmed = s.expenses.find((e) => e.status === 'confirmed')!;
    expect(() =>
      D.cancelExpense(s, confirmed.id, { person: MANAGER, note: 'ผิด' }, 'manager'),
    ).toThrow('ให้เจ้าของยกเลิก');
  });

  it('the report keeps purchases and expenses apart and hides finance from staff', () => {
    const s = demoSeed();
    const owner = D.report(s, null, 'owner');
    expect(owner.finance!.purchaseTotals.THB).toBe(53000);
    expect(owner.finance!.expenseTotals.THB!.total).toBe(50000);
    expect(D.report(s, null, 'staff').finance).toBeNull();
    expect(() => D.reportCSV(s, null, 'staff', 'expenses')).toThrow('บทบาทนี้ไม่เปิดรายงานการเงิน');
  });

  it('CSV escapes spreadsheet formulas', () => {
    let s = D.seed();
    s = D.saveIngredient(
      s,
      { code: 'X-1', name: '=HYPERLINK("x")', category: 'อื่น ๆ', unitId: 'u-pack' },
      'owner',
    );
    expect(D.reportCSV(s, null, 'owner', 'stock')).toContain('"\'=HYPERLINK(""x"")"');
  });
});

describe('state integrity', () => {
  it('operations are pure and bump the revision', () => {
    const s = D.seed();
    const frozen = JSON.stringify(s);
    const out = D.saveUnit(s, { name: 'ลัง', symbol: 'ลัง', type: 'จำนวน' }, 'manager');
    expect(JSON.stringify(s)).toBe(frozen);
    expect(out.revision).toBe(s.revision + 1);
  });

  it('withRuntime pins ids and timestamps (server determinism)', () => {
    const rt = { now: () => new Date('2026-01-01T00:00:00Z'), random: () => 0.5 };
    const a = D.withRuntime(rt, () =>
      D.saveUnit(D.seed(), { name: 'ลัง', symbol: 'ลัง', type: 'จำนวน' }, 'owner'),
    );
    const b = D.withRuntime(rt, () =>
      D.saveUnit(D.seed(), { name: 'ลัง', symbol: 'ลัง', type: 'จำนวน' }, 'owner'),
    );
    expect(a).toEqual(b);
    expect(a.events.at(-1)!.time).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('stored evidence (Supabase Storage)', () => {
  const shop = '11111111-1111-4111-8111-111111111111';
  const ev = '22222222-2222-4222-8222-222222222222';
  const stored = (over: Partial<D.StoredAttachment> = {}): D.StoredAttachment => ({
    name: 'bill.pdf',
    type: 'application/pdf',
    size: 4_000_000,
    hash: 'c'.repeat(64),
    evidenceId: ev,
    path: `${shop}/${ev}`,
    ...over,
  });
  const draft = (attachment: D.Attachment | null) => ({
    vendor: 'ร้าน',
    date: '2026-11-01',
    amount: '120',
    currency: 'THB' as const,
    category: 'อื่น ๆ' as const,
    funding: 'shop' as const,
    payer: MANAGER,
    note: 'บิล',
    person: MANAGER,
    attachment,
    noEvidenceReason: attachment ? '' : 'ไม่มี',
  });

  it('accepts files up to 5 MB that do not count toward the 1.4 MB inline budget', () => {
    let s = D.seed();
    for (let i = 0; i < 3; i++)
      s = D.saveExpense(s, draft(stored({ hash: String(i).repeat(64) })), 'manager');
    expect(s.expenses).toHaveLength(3);
    expect(D.isStoredAttachment(s.expenses[0]!.attachment)).toBe(true);
  });

  it('rejects malformed references, oversize files and mixed formats', () => {
    const s = D.seed();
    const bad = [
      stored({ path: `../${ev}` }),
      stored({ path: `${shop}/33333333-3333-4333-8333-333333333333` }),
      stored({ size: 5_242_881 }),
      { ...stored(), data: 'x' } as unknown as D.Attachment,
    ];
    for (const a of bad) expect(() => D.saveExpense(s, draft(a), 'manager')).toThrow();
  });

  it('same file hash is flagged as a possible duplicate bill', () => {
    let s = D.saveExpense(D.seed(), draft(stored()), 'manager');
    s = D.saveExpense(s, { ...draft(stored()), vendor: 'ร้านอื่น', amount: '99' }, 'manager');
    expect(D.expenseWarnings(s, s.expenses[1]!)).toContain('สงสัยซ้ำกับ ' + s.expenses[0]!.id);
  });
});
