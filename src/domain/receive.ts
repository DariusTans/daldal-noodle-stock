/**
 * Receiving against ordered purchase orders (legacy receive-core.js).
 * Only a confirmed receipt adds stock (once); void reverses it; history is never deleted.
 * Raw ops — the public API validates input/output.
 */
import { receiptIssues } from './constants.js';
import { hasOpenCount } from './counts.js';
import { can } from './permissions.js';
import { parseQuantity } from './quantity.js';
import { nowIso, uid } from './runtime.js';
import * as stock from './stock.js';
import type {
  PurchaseOrder,
  Receipt,
  ReceiptIssue,
  ReceivingSummary,
  Role,
  ShopState,
} from './types.js';
import { clone, fail, hasOwn, normRef, required, round3 } from './util.js';

const req = (v: unknown, n = 500, t = 'กรอกข้อมูลให้ครบ') => required(v, n, t);

export interface ReceiptInput {
  id?: string;
  reference: string;
  accepted: unknown;
  rejected: unknown;
  issueType: string;
  note: string;
  person: string;
}

export interface ConfirmReceiptInput {
  person: string;
  checked: boolean;
  notCounted: boolean;
}

export interface CloseReceivingInput {
  person: string;
  reason: string;
  checked: boolean;
  closeShort?: boolean;
}

const permission = (role: Role, action: string) => {
  if (!can(role, action)) fail('บทบาทนี้ทำรายการนี้ไม่ได้');
};

/** An ordered purchase order (receivable). */
export function orderedOrder(s: ShopState, id: string): PurchaseOrder {
  const o = s.purchaseOrders.find((o) => o.id === id && o.status === 'ordered');
  if (!o) return fail('ต้องเป็นใบจัดซื้อที่บันทึกซื้อแล้ว');
  return o;
}

const opened = (o: PurchaseOrder) => {
  if (o.receiving?.status === 'closed') fail('ใบนี้ปิดการรับแล้ว แก้ไขย้อนหลังไม่ได้');
};

const unlocked = (s: ShopState) => {
  if (hasOpenCount(s)) fail('มีรอบนับค้างอยู่ กรุณายืนยันหรือยกเลิกรอบก่อนรับสินค้า');
};

function amount(v: unknown): number {
  const n = parseQuantity(v);
  if (n === null) fail('กรอกจำนวนให้ครบ ช่องว่างไม่ใช่ศูนย์');
  return n as number;
}

export function receivingSummary(s: ShopState, o: PurchaseOrder): ReceivingSummary {
  const receipts = s.receipts.filter((r) => r.orderId === o.id),
    posted = receipts.filter((r) => r.status === 'confirmed'),
    accepted = round3(posted.reduce((n, r) => n + r.accepted, 0)),
    rejected = round3(posted.reduce((n, r) => n + r.rejected, 0)),
    remaining = round3(o.purchase!.orderedQty - accepted),
    issues = posted.filter((r) => r.issueType !== 'none' && !r.resolution),
    draft = receipts.find((r) => r.status === 'draft');
  return {
    receipts,
    accepted,
    rejected,
    remaining,
    issues,
    draft,
    closed: o.receiving?.status === 'closed',
  };
}

export function receivingLabel(s: ShopState, o: PurchaseOrder): string {
  const v = receivingSummary(s, o);
  return v.closed
    ? v.remaining
      ? 'ปิดรับบางส่วน'
      : 'รับครบและปิดแล้ว'
    : v.issues.length
      ? 'มีปัญหารอติดตาม'
      : v.remaining === 0
        ? 'รับครบ รอปิดงาน'
        : v.accepted > 0
          ? 'รับบางส่วน'
          : 'รอตรวจรับ';
}

function sync(s: ShopState, o: PurchaseOrder) {
  o.purchase!.receivedQty = receivingSummary(s, o).accepted;
}

function finish(
  s: ShopState,
  o: PurchaseOrder,
  action: string,
  person: unknown,
  role: Role,
  detail: Record<string, unknown> = {},
): ShopState {
  o.audit.push({
    at: nowIso(),
    action,
    person: req(person, 80, 'ระบุชื่อผู้ทำรายการ'),
    role,
    ...detail,
  });
  s.revision++;
  return s;
}

export function saveReceipt(
  state: ShopState,
  orderId: string,
  d: ReceiptInput,
  role: Role,
): ShopState {
  permission(role, 'receive');
  unlocked(state);
  const s = clone(state),
    o = orderedOrder(s, orderId);
  opened(o);
  const v = receivingSummary(s, o),
    r = d.id ? s.receipts.find((r) => r.id === d.id && r.orderId === orderId) : null;
  if (d.id && (!r || r.status !== 'draft')) fail('แก้ได้เฉพาะร่างรับ');
  if (v.draft && v.draft.id !== r?.id) fail('มีร่างรับค้างอยู่ เปิดร่างเดิมก่อน');
  const b = stock.stockRows(s).find((b) => b.id === o.ingredientId);
  if (!b?.base || !b.active) fail('วัตถุดิบต้องใช้งานและมียอดนับยืนยัน');
  const accepted = amount(d.accepted),
    rejected = amount(d.rejected);
  if (accepted + rejected <= 0 || round3(accepted + rejected) > v.remaining)
    fail('จำนวนที่มาตรวจต้องมากกว่าศูนย์และไม่เกินยอดค้างรับ ถ้าเกินให้แยกคืนหรือตกลงจัดซื้อใหม่');
  if (!hasOwn(receiptIssues, d.issueType) || (rejected > 0 && d.issueType === 'none'))
    fail('จำนวนไม่รับต้องระบุประเภทปัญหา');
  const reference = req(d.reference, 100, 'ระบุเลขส่งของ/ครั้งส่งที่ไม่ซ้ำ');
  if (
    s.receipts.some(
      (x) =>
        x.id !== r?.id &&
        x.orderId === orderId &&
        ['draft', 'confirmed'].includes(x.status) &&
        normRef(x.reference) === normRef(reference),
    )
  )
    fail('เลขส่งของนี้บันทึกไว้แล้ว ห้ามรับซ้ำ');
  const next: Receipt = {
    id: r?.id || uid('rc', 7),
    orderId,
    ingredientId: o.ingredientId,
    unitId: o.unitId,
    status: 'draft',
    reference,
    accepted,
    rejected,
    issueType: d.issueType as ReceiptIssue,
    note: req(d.note, 500, 'ระบุผลตรวจหรือเหตุผลรับบางส่วน'),
    person: req(d.person, 80, 'ระบุชื่อผู้ตรวจรับ'),
    role,
    at: nowIso(),
    baseRoundId: b!.base!.roundId,
    movementId: null,
    resolution: null,
  };
  if (r) s.receipts[s.receipts.indexOf(r)] = next;
  else s.receipts.push(next);
  return finish(s, o, 'บันทึกร่างตรวจรับ', d.person, role, {
    receiptId: next.id,
    reference,
    accepted,
    rejected,
    note: next.note,
  });
}

export function confirmReceipt(
  state: ShopState,
  id: string,
  d: ConfirmReceiptInput,
  role: Role,
): ShopState {
  permission(role, 'receiveReview');
  unlocked(state);
  let s = clone(state),
    r = s.receipts.find((r) => r.id === id);
  if (!r || r.status !== 'draft') return fail('ยืนยันได้เฉพาะร่างรับที่ยังไม่ยืนยัน');
  let o = orderedOrder(s, r.orderId);
  opened(o);
  const b = stock.stockRows(s).find((b) => b.id === r!.ingredientId),
    v = receivingSummary(s, o);
  if (!b?.active || !b.base || b.base.roundId !== r.baseRoundId)
    fail('ยอดนับอ้างอิงเปลี่ยน ต้องเปิดแก้ร่างและตรวจว่าไม่ได้รวมของนี้ในยอดนับแล้ว');
  if (round3(r.accepted + r.rejected) > v.remaining) fail('จำนวนเกินยอดค้างรับ');
  if (d.notCounted !== true || d.checked !== true)
    fail('ต้องยืนยันผลตรวจและรับรองว่ายังไม่รวมจำนวนนี้ในสต็อก');
  const person = req(d.person, 80, 'ระบุชื่อผู้ยืนยัน');
  if (r.accepted > 0) {
    s = stock.addMovement(
      s,
      {
        ingredientId: r.ingredientId,
        kind: 'receive',
        qty: r.accepted,
        person,
        reason: 'ตรวจรับสินค้า ' + r.id,
        reference: r.reference,
      },
      role,
    );
    r = s.receipts.find((r) => r.id === id)!;
    o = orderedOrder(s, r.orderId);
    const m = s.movements.at(-1)!;
    m.receiptId = r.id;
    m.purchaseOrderId = o.id;
    r.movementId = m.id;
  }
  Object.assign(r, {
    status: 'confirmed',
    confirmedBy: person,
    confirmedRole: role,
    confirmedAt: nowIso(),
    notCounted: true,
  });
  sync(s, o);
  return finish(s, o, 'ยืนยันรับจริงเข้าสต็อก', person, role, {
    receiptId: r.id,
    reference: r.reference,
    accepted: r.accepted,
    rejected: r.rejected,
    movementId: r.movementId,
  });
}

export function cancelReceipt(
  state: ShopState,
  id: string,
  reason: string,
  person: string,
  role: Role,
): ShopState {
  let s = clone(state),
    r = s.receipts.find((r) => r.id === id);
  if (!r || !['draft', 'confirmed'].includes(r.status)) return fail('ใบรับนี้ยกเลิกแล้ว');
  permission(role, r.status === 'confirmed' ? 'receiveReview' : 'receive');
  let o = orderedOrder(s, r.orderId);
  opened(o);
  reason = req(reason, 500, 'ระบุเหตุผลยกเลิกใบรับ');
  person = req(person, 80, 'ระบุชื่อผู้ยกเลิก');
  const confirmed = r.status === 'confirmed';
  if (confirmed && r.accepted > 0) {
    s = stock.reverseMovement(s, r.movementId!, reason, person, role);
    r = s.receipts.find((r) => r.id === id)!;
    o = orderedOrder(s, r.orderId);
    r.reversalId = s.movements.at(-1)!.id;
  }
  Object.assign(r, {
    status: confirmed ? 'void' : 'cancelled',
    cancelReason: reason,
    cancelledBy: person,
    cancelledRole: role,
    cancelledAt: nowIso(),
  });
  sync(s, o);
  return finish(s, o, 'ยกเลิกใบรับและเก็บประวัติ', person, role, {
    receiptId: id,
    reason,
    reversalId: r.reversalId || null,
  });
}

export function resolveReceiptIssue(
  state: ShopState,
  id: string,
  note: string,
  person: string,
  role: Role,
): ShopState {
  permission(role, 'receiveReview');
  const s = clone(state),
    r = s.receipts.find((r) => r.id === id);
  if (!r || r.status !== 'confirmed' || r.issueType === 'none' || r.resolution)
    return fail('ไม่มีปัญหาค้างในใบรับนี้');
  const o = orderedOrder(s, r.orderId);
  opened(o);
  r.resolution = {
    note: req(note, 500, 'ระบุผลติดตามและหลักฐานอ้างอิง'),
    person: req(person, 80, 'ระบุชื่อผู้ติดตาม'),
    role,
    at: nowIso(),
  };
  return finish(s, o, 'บันทึกผลติดตามปัญหา', person, role, {
    receiptId: id,
    note: r.resolution.note,
  });
}

export function closeReceiving(
  state: ShopState,
  orderId: string,
  d: CloseReceivingInput,
  role: Role,
): ShopState {
  permission(role, 'receiveReview');
  const s = clone(state),
    o = orderedOrder(s, orderId);
  opened(o);
  const v = receivingSummary(s, o);
  if (v.draft || v.issues.length) fail('ยังมีร่างรับหรือปัญหาค้าง ต้องจัดการก่อนปิด');
  if (d.checked !== true || (v.remaining > 0 && d.closeShort !== true))
    fail('ยืนยันปิดรับและตกลงไม่รับส่วนที่เหลือก่อน');
  const at = nowIso();
  o.receiving = {
    status: 'closed',
    accepted: v.accepted,
    unreceived: v.remaining,
    reason: req(d.reason, 500, 'ระบุเหตุผล/หลักฐานปิดรับ'),
    person: req(d.person, 80, 'ระบุชื่อผู้ปิดรับ'),
    role,
    at,
  };
  const p = s.purchaseRequests.find((p) => p.id === o.requestId)!;
  p.status = 'completed';
  p.completedOrderId = o.id;
  p.completedAt = at;
  return finish(
    s,
    o,
    v.remaining ? 'ปิดรับบางส่วน ไม่รับส่วนที่เหลือ' : 'รับครบและปิดงาน',
    d.person,
    role,
    { reason: o.receiving.reason, accepted: v.accepted, unreceived: v.remaining },
  );
}
