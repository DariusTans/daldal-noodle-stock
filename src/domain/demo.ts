/**
 * Demo dataset (legacy demo-data.js): built by running the real operations, so every
 * record is consistent with the rules. Purchases 530 THB / confirmed expenses 500 THB.
 */
import { demoProof } from './demo-proof.js';
import * as D from './index.js';
import { nowIso } from './runtime.js';
import type { ShopState } from './types.js';

export interface DemoNames {
  owner?: string;
  manager?: string;
  staff?: string;
}

/** `names.owner` becomes the configured purchase approver and expense reviewer. */
export function demoSeed(names: DemoNames = {}): ShopState {
  let s = D.seed();
  const staff = names.staff ?? 'พนักงานตัวอย่าง',
    manager = names.manager ?? 'ผู้จัดการตัวอย่าง',
    owner = names.owner ?? 'เจ้าของตัวอย่าง',
    day = D.reportDay(nowIso());
  s = D.startCount(s, 'นับเปิดร้าน · ข้อมูลตัวอย่าง', staff, 'staff');
  const r = s.countRounds[0]!;
  s = D.saveCount(
    s,
    r.id,
    r.lines.map((l) => ({ ingredientId: l.ingredientId, qty: 2, reason: '' })),
    staff,
    'staff',
  );
  s = D.submitCount(s, r.id, staff, 'staff');
  s = D.confirmCount(s, r.id, manager, 'manager');
  s = D.savePurchasePolicy(
    s,
    {
      mode: 'all',
      currency: 'THB',
      threshold: 0,
      approver: owner,
      approverRole: 'owner',
      note: 'เกณฑ์ตัวอย่างสำหรับทดลอง ไม่ใช่เกณฑ์จริงของร้าน',
      person: owner,
      checked: true,
    },
    'owner',
  );
  s = D.saveExpenseReviewer(
    s,
    { name: owner, role: 'owner', note: 'ผู้ตรวจตัวอย่าง', person: owner, checked: true },
    'owner',
  );
  for (const i of s.ingredients.filter((i) => i.active))
    s = D.savePolicy(
      s,
      { ingredientId: i.id, minimum: 5, target: 12, enabled: true, person: manager },
      'manager',
    );
  const orders: string[] = [];
  for (let n = 1; n <= 6; n++) {
    const iid = 'i-' + n;
    s = D.createRequest(s, iid, staff, 'staff');
    const pid = s.purchaseRequests.at(-1)!.id;
    if (n === 6) continue;
    s = D.reviewRequest(
      s,
      pid,
      { qty: 10, reason: 'เติมให้ถึงเป้าหมายตัวอย่าง', person: manager, checked: true },
      'manager',
    );
    if (n === 5) continue;
    s = D.createOrder(s, pid, 'THB', manager, 'manager');
    const id = s.purchaseOrders.at(-1)!.id;
    orders.push(id);
    s = D.saveOffer(
      s,
      id,
      {
        vendor: ['ร้านเส้นตัวอย่าง', 'ฟาร์มไข่ตัวอย่าง', 'ร้านหมูตัวอย่าง', 'ตลาดผักตัวอย่าง'][
          n - 1
        ]!,
        packQty: 1,
        packPrice: [50, 3, 150, 25][n - 1],
        shipping: 0,
        extra: 0,
        discount: 0,
        source: 'DEMO-QUOTE-' + n,
        conditions: 'ข้อมูลสมมติ รวมภาษี ส่งที่ร้าน',
        quotedAt: nowIso(),
        person: manager,
      },
      'manager',
    );
    if (n === 4) continue;
    s = D.selectOffer(
      s,
      id,
      s.purchaseOrders.at(-1)!.offers[0]!.id,
      'ตัวอย่างเลือกจากราคาและเวลาส่ง',
      manager,
      'manager',
    );
    s = D.submitOrder(s, id, manager, 'manager');
    if (n === 3) continue;
    s = D.decideOrder(s, id, 'approve', 'อนุมัติข้อมูลตัวอย่าง', owner, 'owner');
    s = D.markOrdered(
      s,
      id,
      { reference: 'DEMO-PO-' + n, person: manager, checked: true },
      'manager',
    );
    s = D.saveReceipt(
      s,
      id,
      {
        reference: 'DEMO-DEL-' + n,
        accepted: n === 1 ? 10 : 4,
        rejected: n === 1 ? 0 : 1,
        issueType: n === 1 ? 'none' : 'damaged',
        note: n === 1 ? 'รับครบตามตัวอย่าง' : 'รับดี 4 เสียหาย 1 รอผู้ขายส่งทดแทน',
        person: staff,
      },
      'staff',
    );
    s = D.confirmReceipt(
      s,
      s.receipts.at(-1)!.id,
      { person: manager, checked: true, notCounted: true },
      'manager',
    );
    if (n === 1) {
      s = D.closeReceiving(
        s,
        id,
        { person: manager, reason: 'รับครบ ปิดงานตัวอย่าง', checked: true },
        'manager',
      );
      s = D.reviewLedger(s, iid, 'ตรวจรับครบตามเอกสารตัวอย่าง', manager, true, 'manager');
    }
  }
  s = D.addMovement(
    s,
    {
      ingredientId: 'i-7',
      kind: 'use',
      qty: 1,
      person: staff,
      reason: 'เบิกชามสำหรับออเดอร์ตัวอย่าง',
      reference: 'DEMO-USE-1',
    },
    'staff',
  );
  const statuses = ['confirmed', 'pending', 'draft', 'returned', 'cancelled'] as const;
  for (const [index, status] of statuses.entries()) {
    s = D.saveExpense(
      s,
      {
        vendor: [
          'ร้านเส้นตัวอย่าง',
          'ฟาร์มไข่ตัวอย่าง',
          'การไฟฟ้า (ตัวอย่าง)',
          'ร้านอุปกรณ์ (ตัวอย่าง)',
          'รายการบันทึกผิด (ตัวอย่าง)',
        ][index]!,
        date: day,
        reference: 'DEMO-BILL-' + (index + 1),
        amount: [500, 30, 890, 120, 60][index],
        currency: 'THB',
        category: index < 2 ? 'วัตถุดิบ' : 'อื่น ๆ',
        funding: index === 3 ? 'personal' : 'shop',
        payer: manager,
        orderId: index < 2 ? orders[index]! : '',
        note: 'ข้อมูลจำลองสำหรับทดลองหน้าจอและขั้นตอน ไม่ใช่ค่าใช้จ่ายจริง',
        person: manager,
        attachment: index === 0 ? demoProof : null,
        noEvidenceReason: index === 0 ? '' : 'เอกสารตัวอย่าง ไม่มีการจ่ายเงินจริง',
      },
      'manager',
    );
    const id = s.expenses.at(-1)!.id;
    if (status === 'confirmed' || status === 'pending' || status === 'returned')
      s = D.submitExpense(s, id, manager, 'manager');
    if (status === 'confirmed')
      s = D.reviewExpense(
        s,
        id,
        {
          action: 'confirm',
          person: owner,
          note: 'รับรองข้อมูลสมมติสำหรับดูรายงาน',
          checked: true,
          exceptionsChecked: true,
        },
        'owner',
      );
    if (status === 'returned')
      s = D.reviewExpense(
        s,
        id,
        { action: 'return', person: owner, note: 'ตัวอย่างส่งกลับ: กรุณาทวนเลขอ้างอิง' },
        'owner',
      );
    if (status === 'cancelled')
      s = D.cancelExpense(s, id, { person: owner, note: 'ตัวอย่างยกเลิกรายการซ้ำ' }, 'owner');
  }
  D.validate(s);
  return s;
}
