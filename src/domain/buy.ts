/**
 * Purchase orders and approval (legacy buy-core.js).
 * draft/returned → pending → approved/cleared → ordered; rejected/cancelled close the order.
 * Raw ops — the public API validates input/output.
 */
import { currencies } from './constants';
import { hasOpenCount } from './counts';
import { parseMoney } from './money';
import { can } from './permissions';
import { positiveQuantity } from './quantity';
import { nowIso, nowMs, uid } from './runtime';
import { stockRows } from './stock';
import type {
  Currency,
  Offer,
  OrderAudit,
  OrderStatus,
  PurchaseOrder,
  PurchasePolicy,
  QuoteTotal,
  Role,
  ShopState,
} from './types';
import { clone, fail, isStamp, isText, required } from './util';

const req = (v: unknown, n = 500, message = 'กรอกข้อมูลให้ครบ') => required(v, n, message);
const CLOSED: OrderStatus[] = ['rejected', 'cancelled', 'ordered'];
const EDITABLE: OrderStatus[] = ['draft', 'returned'];
export const isLiveOrder = (o: PurchaseOrder) =>
  o.status !== 'cancelled' && o.status !== 'rejected';

export interface PurchasePolicyInput {
  currency: Currency;
  mode: 'all' | 'above';
  threshold?: unknown;
  approver: string;
  approverRole: 'owner' | 'manager';
  note: string;
  person: string;
  checked: boolean;
}

export interface SourceReviewInput {
  qty: unknown;
  person: string;
  reason: string;
  checked: boolean;
}

export interface OfferInput {
  id?: string;
  vendor: string;
  packQty: unknown;
  packPrice: unknown;
  shipping: unknown;
  extra: unknown;
  discount: unknown;
  source: string;
  conditions: string;
  quotedAt: string;
  person: string;
}

export interface MarkOrderedInput {
  reference: string;
  person: string;
  checked: boolean;
}

export type DecideAction = 'approve' | 'return' | 'reject';

const perm = (role: Role, action: string) => {
  if (!can(role, action)) fail('บทบาทนี้ทำรายการนี้ไม่ได้');
};

/** Packs needed (rounded up so the quantity is covered) and the landed total in minor units. */
export function quoteTotal(
  o: { qty: number },
  f: Pick<Offer, 'packQty' | 'packPrice' | 'shipping' | 'extra' | 'discount'>,
): QuoteTotal {
  const packs = Math.ceil(Math.round(o.qty * 1000) / Math.round(f.packQty * 1000));
  const units = Math.round(packs * f.packQty * 1000) / 1000,
    total = packs * f.packPrice + f.shipping + f.extra - f.discount;
  if (!Number.isSafeInteger(total) || total < 0 || total > 1e11 || units > 1e9)
    fail('ยอดรวมไม่ถูกต้อง ตรวจส่วนลดหรือจำนวน');
  return { packs, units, total, unitCost: units ? total / 100 / units : 0 };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function assertValidPolicy(p: any): asserts p is PurchasePolicy {
  if (
    !p ||
    !isText(p.id, 100) ||
    !currencies.includes(p.currency) ||
    !['all', 'above'].includes(p.mode) ||
    !Number.isSafeInteger(p.threshold) ||
    p.threshold < 0 ||
    p.threshold > 1e11 ||
    !['owner', 'manager'].includes(p.approverRole) ||
    !isText(p.approver, 80) ||
    !isText(p.person, 80) ||
    !isStamp(p.at) ||
    !isText(p.note)
  )
    fail('เกณฑ์อนุมัติไม่ถูกต้อง');
}

function findOrder(s: ShopState, id: string): PurchaseOrder {
  const o = s.purchaseOrders.find((o) => o.id === id);
  if (!o) return fail('ไม่พบรายการจัดซื้อ');
  return o;
}

const currentRow = (s: ShopState, o: PurchaseOrder) =>
  stockRows(s).find((r) => r.id === o.ingredientId);
export const selectedOffer = (o: PurchaseOrder) => o.offers.find((f) => f.id === o.selectedId);

/** The stock basis this order was reviewed against has changed. */
export function orderSourceStale(s: ShopState, o: PurchaseOrder): boolean {
  const p = s.purchaseRequests.find((p) => p.id === o.requestId),
    r = currentRow(s, o);
  return (
    !p || p.status !== 'ready' || !r?.active || !r.base || r.fingerprint !== o.sourceFingerprint
  );
}

export const orderPolicyStale = (s: ShopState, o: PurchaseOrder) =>
  !s.purchasePolicy || o.policySnapshot?.id !== s.purchasePolicy.id;

/** null = cannot decide yet (no policy / no selected offer / currency mismatch). */
export function needsApproval(s: ShopState, o: PurchaseOrder): boolean | null {
  const policy = s.purchasePolicy,
    f = selectedOffer(o);
  if (!policy || !f || policy.currency !== o.currency) return null;
  return policy.mode === 'all' || quoteTotal(o, f).total > policy.threshold;
}

function finish(
  s: ShopState,
  o: PurchaseOrder,
  action: string,
  person: unknown,
  role: Role,
  detail: Record<string, unknown> = {},
): ShopState {
  const entry: OrderAudit = {
    at: nowIso(),
    action,
    person: req(person, 80, 'ระบุชื่อผู้ทำรายการ'),
    role,
    ...detail,
  };
  o.audit.push(entry);
  s.revision++;
  return s;
}

function copyEdit(state: ShopState, id: string, role: Role) {
  perm(role, 'buy');
  const s = clone(state),
    o = findOrder(s, id);
  if (!EDITABLE.includes(o.status)) fail('แก้ไขได้เฉพาะร่างหรือรายการส่งกลับ ให้ถอนกลับแก้ไขก่อน');
  return { s, o };
}

function sourceReady(s: ShopState, o: PurchaseOrder) {
  if (hasOpenCount(s)) fail('กรุณาจบรอบนับก่อนดำเนินรายการจัดซื้อ');
  if (orderSourceStale(s, o)) fail('ยอดต้นทางเปลี่ยนแล้ว ต้องทบทวนยอดและจำนวนซื้อก่อน');
}

function policyReady(s: ShopState, o: PurchaseOrder) {
  if (!s.purchasePolicy) fail('ยังไม่ตั้งเกณฑ์และผู้อนุมัติ จำเป็นต้องตั้งค่าก่อนส่งตรวจ');
  if (s.purchasePolicy!.currency !== o.currency) fail('สกุลเงินของใบจัดซื้อไม่ตรงกับเกณฑ์อนุมัติ');
}

export function savePurchasePolicy(
  state: ShopState,
  d: PurchasePolicyInput,
  role: Role,
): ShopState {
  perm(role, 'buySettings');
  if (d.checked !== true) fail('รับรองว่าตั้งค่าทดลองตามแนวทางที่ต้องการก่อน');
  const s = clone(state),
    p = {
      id: uid('bp', 7),
      currency: d.currency,
      mode: d.mode,
      threshold: d.mode === 'all' ? 0 : parseMoney(d.threshold),
      approver: req(d.approver, 80, 'ระบุชื่อผู้พิจารณา'),
      approverRole: d.approverRole,
      note: req(d.note, 500, 'ระบุที่มาหรือขอบเขตเกณฑ์'),
      person: req(d.person, 80, 'ระบุชื่อผู้ตั้งค่า'),
      at: nowIso(),
    };
  assertValidPolicy(p);
  s.purchasePolicy = p;
  s.purchasePolicyAudit.push(clone(p));
  s.revision++;
  return s;
}

export function createOrder(
  state: ShopState,
  requestId: string,
  currency: Currency,
  person: string,
  role: Role,
): ShopState {
  perm(role, 'buy');
  if (hasOpenCount(state)) fail('กรุณาจบรอบนับก่อน');
  const p = state.purchaseRequests.find((p) => p.id === requestId),
    r = p && stockRows(state).find((r) => r.id === p.ingredientId);
  if (!p || p.status !== 'ready' || !r?.active)
    return fail('เลือกได้เฉพาะรายการเสนอซื้อที่ตรวจแล้วและยังใช้งาน');
  if (state.purchaseOrders.some((o) => o.requestId === requestId && isLiveOrder(o)))
    fail('มีใบจัดซื้อจากรายการนี้แล้ว');
  if (!currencies.includes(currency)) fail('เลือกสกุลเงิน ไม่รองรับการแปลงเงินอัตโนมัติ');
  const s = clone(state),
    o: PurchaseOrder = {
      id: uid('po', 7),
      requestId,
      ingredientId: p.ingredientId,
      name: p.name,
      unitId: r.unitId,
      unitSymbol: p.unitSymbol,
      qty: p.qty,
      currency,
      status: 'draft',
      at: nowIso(),
      person: req(person, 80, 'ระบุชื่อผู้จัดซื้อ'),
      role,
      sourceFingerprint: p.fingerprint,
      sourceCheckedBy: p.reviewedBy!,
      sourceCheckedAt: p.reviewedAt!,
      sourceReason: '',
      offers: [],
      selectedId: null,
      selectionReason: '',
      policySnapshot: null,
      decision: null,
      purchase: null,
      audit: [],
    };
  s.purchaseOrders.push(o);
  return finish(s, o, 'เปิดใบจัดซื้อจากรายการตรวจแล้ว', person, role);
}

export function reviewOrderSource(
  state: ShopState,
  id: string,
  d: SourceReviewInput,
  role: Role,
): ShopState {
  const { s, o } = copyEdit(state, id, role);
  const r = currentRow(s, o),
    p = s.purchaseRequests.find((p) => p.id === o.requestId)!;
  if (!r?.active || !r.base || p.status !== 'ready' || hasOpenCount(s))
    fail('ยอดต้นทางยังไม่พร้อมหรือมีรอบนับค้าง');
  if (d.checked !== true) fail('ตรวจยอดจริงและจำนวนที่ยังต้องซื้อก่อน');
  o.qty = positiveQuantity(d.qty);
  o.sourceFingerprint = r!.fingerprint;
  o.sourceCheckedBy = req(d.person, 80, 'ระบุชื่อผู้ทบทวน');
  o.sourceCheckedAt = nowIso();
  o.sourceReason = req(d.reason, 500, 'ระบุเหตุผลและสิ่งที่ตรวจ');
  o.selectedId = null;
  o.selectionReason = '';
  o.decision = null;
  return finish(s, o, 'ทบทวนยอดและจำนวนซื้อ', d.person, role, {
    reason: o.sourceReason,
    qty: o.qty,
  });
}

export function saveOffer(state: ShopState, id: string, d: OfferInput, role: Role): ShopState {
  const { s, o } = copyEdit(state, id, role);
  const old = d.id ? o.offers.find((f) => f.id === d.id) : null;
  if (d.id && !old) fail('ไม่พบทางเลือกเดิม');
  if (!old && o.offers.length >= 30) fail('รองรับไม่เกิน 30 ทางเลือก');
  const f: Offer = {
    id: old?.id || uid('quote', 7),
    vendor: req(d.vendor, 100, 'ระบุแหล่งซื้อ'),
    packQty: positiveQuantity(d.packQty),
    packPrice: parseMoney(d.packPrice),
    shipping: parseMoney(d.shipping),
    extra: parseMoney(d.extra),
    discount: parseMoney(d.discount),
    currency: o.currency,
    source: req(d.source, 500, 'ระบุแหล่งที่มาราคา / เลขอ้างอิง'),
    conditions: req(d.conditions, 500, 'ระบุเงื่อนไขราคา หรือไม่มีเงื่อนไข'),
    quotedAt: isStamp(d.quotedAt) ? d.quotedAt : fail('ระบุวันและเวลาที่ตรวจราคา'),
    at: nowIso(),
    person: req(d.person, 80, 'ระบุชื่อผู้บันทึก'),
  };
  if (Date.parse(f.quotedAt) > nowMs() + 60000) fail('เวลาราคาไม่ควรอยู่ในอนาคต');
  quoteTotal(o, f);
  if (old) o.offers[o.offers.indexOf(old)] = f;
  else o.offers.push(f);
  if (o.selectedId === f.id) {
    o.selectedId = null;
    o.selectionReason = '';
  }
  return finish(s, o, 'บันทึกทางเลือกซื้อ', d.person, role, { offer: clone(f) });
}

export function selectOffer(
  state: ShopState,
  id: string,
  offerId: string,
  reason: string,
  person: string,
  role: Role,
): ShopState {
  const { s, o } = copyEdit(state, id, role);
  if (!o.offers.some((f) => f.id === offerId)) fail('ไม่พบทางเลือก');
  o.selectedId = offerId;
  o.selectionReason = req(reason, 500, 'ระบุเหตุผลเลือก แม้ราคาต่ำสุด');
  return finish(s, o, 'เลือกแหล่งซื้อ', person, role, { offerId, reason: o.selectionReason });
}

export function submitOrder(state: ShopState, id: string, person: string, role: Role): ShopState {
  const { s, o } = copyEdit(state, id, role);
  sourceReady(s, o);
  policyReady(s, o);
  if (!o.selectedId) fail('เลือกแหล่งซื้อก่อนส่งตรวจ');
  o.status = 'pending';
  o.policySnapshot = clone(s.purchasePolicy);
  o.submittedAt = nowIso();
  o.submittedBy = req(person, 80, 'ระบุชื่อผู้ส่ง');
  o.decision = null;
  return finish(s, o, 'ส่งพิจารณา', person, role, {
    selectedId: o.selectedId,
    total: quoteTotal(o, selectedOffer(o)!).total,
    policy: clone(o.policySnapshot),
  });
}

export function decideOrder(
  state: ShopState,
  id: string,
  action: DecideAction,
  reason: string,
  person: string,
  role: Role,
): ShopState {
  const s = clone(state),
    o = findOrder(s, id);
  if (o.status !== 'pending') fail('รายการนี้ไม่ได้รอพิจารณา');
  policyReady(s, o);
  if (orderPolicyStale(s, o)) fail('เกณฑ์เปลี่ยน ให้ถอนกลับแล้วส่งตรวจใหม่');
  if (role !== s.purchasePolicy!.approverRole || person?.trim() !== s.purchasePolicy!.approver)
    fail('ผู้พิจารณาต้องตรงชื่อและบทบาทที่ตั้งไว้');
  if (!['approve', 'return', 'reject'].includes(action)) fail('ผลพิจารณาไม่ถูกต้อง');
  reason = req(reason, 500, 'ระบุเหตุผลพิจารณา');
  if (action === 'approve') {
    sourceReady(s, o);
    const needs = needsApproval(s, o);
    o.status = needs ? 'approved' : 'cleared';
    o.decision = {
      type: needs ? 'approve' : 'clear',
      at: nowIso(),
      person: person.trim(),
      role,
      reason,
      qty: o.qty,
      offer: clone(selectedOffer(o)!),
      selectedId: o.selectedId!,
      total: quoteTotal(o, selectedOffer(o)!).total,
      sourceFingerprint: o.sourceFingerprint,
    };
  } else {
    o.status = action === 'return' ? 'returned' : 'rejected';
    o.decision = null;
  }
  return finish(
    s,
    o,
    action === 'approve' ? 'ผ่านการพิจารณา' : action === 'return' ? 'ส่งกลับแก้ไข' : 'ไม่อนุมัติ',
    person,
    role,
    { reason, decision: clone(o.decision) },
  );
}

export function reviseOrder(
  state: ShopState,
  id: string,
  reason: string,
  person: string,
  role: Role,
): ShopState {
  perm(role, 'buy');
  const s = clone(state),
    o = findOrder(s, id);
  if (CLOSED.includes(o.status) || EDITABLE.includes(o.status)) fail('ถอนกลับไม่ได้ในสถานะนี้');
  const before = { status: o.status, decision: clone(o.decision), selectedId: o.selectedId };
  o.status = 'draft';
  o.decision = null;
  o.policySnapshot = null;
  return finish(s, o, 'ถอนกลับแก้ไข ต้องพิจารณาใหม่', person, role, {
    reason: req(reason, 500, 'ระบุเหตุผลถอนกลับ'),
    before,
  });
}

export function cancelOrder(
  state: ShopState,
  id: string,
  reason: string,
  person: string,
  role: Role,
): ShopState {
  perm(role, 'buy');
  const s = clone(state),
    o = findOrder(s, id);
  if (CLOSED.includes(o.status)) fail('รายการนี้ปิดแล้ว ซื้อแล้วต้องติดตามผ่านงานตรวจรับ');
  o.status = 'cancelled';
  return finish(s, o, 'ยกเลิกใบจัดซื้อ', person, role, {
    reason: req(reason, 500, 'ระบุเหตุผลยกเลิก'),
  });
}

export function markOrdered(
  state: ShopState,
  id: string,
  d: MarkOrderedInput,
  role: Role,
): ShopState {
  perm(role, 'buy');
  const s = clone(state),
    o = findOrder(s, id);
  if (!['approved', 'cleared'].includes(o.status)) fail('ต้องผ่านพิจารณาก่อนบันทึกซื้อ');
  sourceReady(s, o);
  policyReady(s, o);
  if (orderPolicyStale(s, o)) fail('เกณฑ์เปลี่ยน ต้องส่งพิจารณาใหม่');
  if (d.checked !== true) fail('ยืนยันว่าซื้อภายนอกตามรายละเอียดที่ผ่านแล้ว');
  const offer = selectedOffer(o)!;
  o.purchase = {
    reference: req(d.reference, 100, 'ระบุเลขคำสั่งซื้อหรือหลักฐาน'),
    person: req(d.person, 80, 'ระบุชื่อผู้ซื้อ'),
    at: nowIso(),
    total: o.decision!.total,
    offer: clone(offer),
    qty: o.qty,
    orderedQty: quoteTotal(o, offer).units,
    packCount: quoteTotal(o, offer).packs,
    receivedQty: 0,
  };
  o.status = 'ordered';
  return finish(s, o, 'บันทึกซื้อแล้ว รอตรวจรับ', d.person, role, {
    reference: o.purchase.reference,
    total: o.purchase.total,
  });
}
