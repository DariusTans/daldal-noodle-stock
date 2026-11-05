/**
 * Stock ledger, completeness checks, reorder policies and purchase requests
 * (legacy stock-core.js). Raw ops — the public API validates input/output.
 */
import { movementKinds } from './constants';
import { hasOpenCount, latestCounts } from './counts';
import { can } from './permissions';
import { parseQuantity } from './quantity';
import { nowIso, uid } from './runtime';
import type {
  Movement,
  MovementKind,
  PurchaseRequest,
  Role,
  ShopState,
  StockCheck,
  StockPolicy,
  StockRow,
} from './types';
import { clone, fail, isQuantity, required, round3 } from './util';

export interface MovementInput {
  ingredientId: string;
  kind: string;
  qty: unknown;
  person: string;
  reason: string;
  reference?: string;
}

export interface PolicyInput {
  ingredientId: string;
  minimum: unknown;
  target: unknown;
  enabled: boolean;
  person: string;
}

export interface RequestReviewInput {
  qty: unknown;
  reason?: string;
  person: string;
  checked: boolean;
}

export const movementsFor = (s: ShopState, ingredientId: string, roundId: string) =>
  s.movements.filter((m) => m.ingredientId === ingredientId && m.roundId === roundId);
export const movementIds = (ms: Movement[]) => ms.map((m) => m.id).join('|');

const permit = (role: Role, action: string) => {
  if (!can(role, action)) fail('บทบาทนี้ทำรายการนี้ไม่ได้');
};

const unlocked = (s: ShopState) => {
  if (hasOpenCount(s))
    fail('มีรอบนับค้างอยู่ กรุณายืนยันหรือยกเลิกรอบนับก่อน เพื่อไม่ให้ยอดซ้อนช่วงนับ');
};

function amount(v: unknown, positive = false): number {
  const n = parseQuantity(v);
  if (n === null || (positive && n <= 0))
    fail(positive ? 'จำนวนต้องมากกว่าศูนย์' : 'กรอกจำนวนให้ครบ');
  return n as number;
}

/**
 * Current stock per ingredient.
 * referenceQty = confirmed count + movements since, but only once a completeness check
 * covers exactly those movements; otherwise the confirmed count itself.
 */
export function stockRows(s: ShopState): StockRow[] {
  const baseline = latestCounts(s);
  return s.ingredients.map((i) => {
    const base = baseline.find((b) => b.ingredientId === i.id),
      unit = s.units.find((u) => u.id === i.unitId)!,
      ms = base ? movementsFor(s, i.id, base.roundId) : [],
      net = round3(ms.reduce((n, m) => n + m.delta, 0)),
      ledger = base ? round3(base.qty! + net) : null,
      check = base
        ? [...s.stockChecks]
            .reverse()
            .find(
              (c) =>
                c.ingredientId === i.id &&
                c.roundId === base.roundId &&
                c.movementIds === movementIds(ms),
            )
        : null,
      policy = s.stockPolicies.find((p) => p.ingredientId === i.id),
      referenceQty = base ? (check ? ledger : base.qty) : null,
      referenceAt = check?.at || base?.countedAt || null,
      low = i.active && referenceQty !== null && policy?.enabled && referenceQty <= policy.minimum,
      suggested = low ? round3(policy!.target - referenceQty!) : null;
    return {
      ...i,
      unit,
      base,
      movements: ms,
      net,
      ledger,
      check,
      policy,
      referenceQty,
      referenceAt,
      low: !!low,
      suggested,
      fingerprint: JSON.stringify([
        base?.roundId || null,
        movementIds(ms),
        check?.id || null,
        policy?.id || null,
      ]),
    };
  });
}

export function stockRow(s: ShopState, ingredientId: string): StockRow {
  const r = stockRows(s).find((r) => r.id === ingredientId);
  if (!r) return fail('ไม่พบวัตถุดิบ');
  return r;
}

function finish(
  s: ShopState,
  action: string,
  target: string,
  person: unknown,
  role: Role,
  details: Record<string, unknown> = {},
): ShopState {
  s.revision++;
  s.stockAudit.push({
    id: uid('sa', 7),
    at: nowIso(),
    action,
    target,
    person: required(person, 80, 'ระบุชื่อผู้ทำรายการ'),
    role,
    ...details,
  });
  return s;
}

export function addMovement(state: ShopState, d: MovementInput, role: Role): ShopState {
  permit(role, ['increase', 'decrease'].includes(d.kind) ? 'adjust' : 'movement');
  unlocked(state);
  if (!['receive', 'use', 'waste', 'increase', 'decrease'].includes(d.kind))
    fail('เลือกประเภทเคลื่อนไหว');
  const kind = d.kind as MovementKind;
  const r = stockRow(state, d.ingredientId);
  if (!r.active) fail('วัตถุดิบพักใช้งานอยู่');
  if (!r.base) fail('ต้องมีรอบนับที่ยืนยันก่อนบันทึกเคลื่อนไหว');
  const q = amount(d.qty, true),
    delta = kind === 'receive' || kind === 'increase' ? q : -q;
  if (!isQuantity(round3(r.ledger! + delta)))
    fail('ยอดตามรายการจะติดลบหรือเกินขนาด กรุณาตรวจข้อมูลหรือนับใหม่');
  const s = clone(state),
    m: Movement = {
      id: uid('mv', 7),
      ingredientId: r.id,
      roundId: r.base!.roundId,
      unitId: r.unitId,
      name: r.name,
      unitSymbol: r.unit.symbol,
      kind,
      qty: q,
      delta,
      person: required(d.person, 80, 'ระบุชื่อผู้ทำรายการ'),
      at: nowIso(),
      role,
      reason: required(d.reason, 500, 'ระบุเหตุผลหรือรายละเอียด'),
      reference: typeof d.reference === 'string' ? d.reference.trim() : '',
      reverseOf: null,
    };
  s.movements.push(m);
  return finish(s, 'บันทึก' + movementKinds[kind], m.id, m.person, role);
}

export function reverseMovement(
  state: ShopState,
  id: string,
  reason: string,
  person: string,
  role: Role,
): ShopState {
  permit(role, 'adjust');
  unlocked(state);
  const orig = state.movements.find((m) => m.id === id);
  if (!orig || orig.kind === 'reverse' || state.movements.some((m) => m.reverseOf === id))
    fail('รายการนี้กลับรายการไม่ได้หรือกลับแล้ว');
  const r = stockRow(state, orig!.ingredientId);
  if (r.base?.roundId !== orig!.roundId)
    fail('รายการอยู่ก่อนรอบนับล่าสุด ใช้ปรับยอดในรอบปัจจุบันพร้อมเหตุผล');
  if (!isQuantity(round3(r.ledger! - orig!.delta)))
    fail('กลับรายการแล้วติดลบหรือเกินขนาด กรุณาตรวจรายการภายหลัง');
  const s = clone(state),
    m: Movement = {
      ...clone(orig!),
      id: uid('mv', 7),
      kind: 'reverse',
      delta: -orig!.delta,
      reverseOf: id,
      reason: required(reason, 500, 'ระบุเหตุผลกลับรายการ'),
      person: required(person, 80, 'ระบุชื่อผู้ทำรายการ'),
      role,
      at: nowIso(),
    };
  s.movements.push(m);
  return finish(s, 'กลับรายการ', id, person, role, { reason: m.reason });
}

export function reviewLedger(
  state: ShopState,
  id: string,
  note: string,
  person: string,
  complete: boolean,
  role: Role,
): ShopState {
  permit(role, 'stockReview');
  unlocked(state);
  const r = stockRow(state, id);
  if (!r.active || !r.base) fail('ต้องเป็นวัตถุดิบใช้งานที่มียอดนับยืนยัน');
  if (complete !== true) fail('ต้องตรวจและรับรองว่ารับเข้า เบิกใช้ ของเสีย และปรับยอดครบแล้ว');
  const s = clone(state),
    c: StockCheck = {
      id: uid('sc', 7),
      ingredientId: id,
      roundId: r.base!.roundId,
      movementIds: movementIds(r.movements),
      complete: true,
      note: required(note, 500, 'ระบุขอบเขตหรือหลักฐานที่ตรวจ'),
      person: required(person, 80, 'ระบุชื่อผู้ตรวจ'),
      role,
      at: nowIso(),
    };
  s.stockChecks.push(c);
  return finish(s, 'ตรวจความครบข้อมูลเคลื่อนไหว', id, person, role, { note: c.note });
}

export function savePolicy(state: ShopState, d: PolicyInput, role: Role): ShopState {
  permit(role, 'policy');
  const r = stockRow(state, d.ingredientId),
    minimum = amount(d.minimum),
    target = amount(d.target);
  if (target <= minimum) fail('ยอดเป้าหมายต้องมากกว่าจุดเตือน');
  const s = clone(state),
    p: StockPolicy = {
      id: uid('sp', 7),
      ingredientId: r.id,
      unitId: r.unitId,
      minimum,
      target,
      enabled: d.enabled === true,
      person: required(d.person, 80, 'ระบุชื่อผู้ตั้งค่า'),
      role,
      at: nowIso(),
    },
    old = s.stockPolicies.find((p) => p.ingredientId === r.id);
  if (old) s.stockPolicies[s.stockPolicies.indexOf(old)] = p;
  else s.stockPolicies.push(p);
  return finish(s, 'ตั้งจุดเตือน', r.id, p.person, role, { before: old || null, after: p });
}

function proposalData(r: StockRow) {
  return {
    ingredientId: r.id,
    roundId: r.base!.roundId,
    name: r.name,
    unitSymbol: r.unit.symbol,
    referenceQty: r.referenceQty!,
    referenceAt: r.referenceAt!,
    referenceBasis: (r.check ? 'ledger' : 'count') as PurchaseRequest['referenceBasis'],
    suggested: r.suggested!,
    fingerprint: r.fingerprint,
  };
}

const isOpenRequest = (p: PurchaseRequest) => !['cancelled', 'completed'].includes(p.status);

export function createRequest(state: ShopState, id: string, person: string, role: Role): ShopState {
  permit(role, 'request');
  unlocked(state);
  const r = stockRow(state, id);
  if (!r.low || !r.suggested) fail('รายการนี้ยังไม่เข้าเกณฑ์เสนอซื้อ ตรวจยอดและจุดเตือนก่อน');
  if (state.purchaseRequests.some((p) => p.ingredientId === id && isOpenRequest(p)))
    fail('มีรายการเสนอซื้อค้างอยู่แล้ว');
  const s = clone(state),
    p: PurchaseRequest = {
      id: uid('pr', 7),
      ...proposalData(r),
      qty: r.suggested!,
      status: 'draft',
      reason: '',
      person: required(person, 80, 'ระบุชื่อผู้เสนอ'),
      role,
      at: nowIso(),
    };
  s.purchaseRequests.push(p);
  return finish(s, 'ร่างรายการเสนอซื้อ', p.id, person, role);
}

export function reviewRequest(
  state: ShopState,
  id: string,
  d: RequestReviewInput,
  role: Role,
): ShopState {
  permit(role, 'requestReview');
  unlocked(state);
  const s = clone(state),
    p = s.purchaseRequests.find((p) => p.id === id);
  if (!p || p.status !== 'draft') return fail('รายการนี้ไม่ใช่ร่าง');
  const r = stockRow(s, p.ingredientId);
  if (!r.low || r.fingerprint !== p.fingerprint)
    fail('ยอดหรือจุดเตือนเปลี่ยนแล้ว กรุณาอัปเดตร่างก่อนยืนยัน');
  const q = amount(d.qty, true),
    reason = typeof d.reason === 'string' ? d.reason.trim() : '';
  if (q !== p.suggested && !reason) fail('ระบุเหตุผลเมื่อจำนวนซื้อแตกต่างจากที่เสนอ');
  if (d.checked !== true) fail('ตรวจยอดอ้างอิงและจำนวนซื้อก่อนยืนยัน');
  Object.assign(p, {
    qty: q,
    reason,
    status: 'ready',
    reviewedBy: required(d.person, 80, 'ระบุชื่อผู้ตรวจ'),
    reviewedAt: nowIso(),
    reviewedRole: role,
  });
  return finish(s, 'ตรวจรายการเสนอซื้อแล้ว รอรอบจัดซื้อ', id, d.person, role);
}

export function refreshRequest(
  state: ShopState,
  id: string,
  person: string,
  role: Role,
): ShopState {
  permit(role, 'request');
  unlocked(state);
  const s = clone(state),
    p = s.purchaseRequests.find((p) => p.id === id);
  if (!p || p.status !== 'draft') return fail('อัปเดตได้เฉพาะร่าง');
  const r = stockRow(s, p.ingredientId);
  if (!r.low) fail('ไม่เข้าเกณฑ์เตือนแล้ว ให้ยกเลิกร่างแทน');
  Object.assign(p, proposalData(r), { qty: r.suggested, reason: '' });
  return finish(s, 'อัปเดตร่างตามยอดล่าสุด', id, person, role);
}

export function cancelRequest(
  state: ShopState,
  id: string,
  reason: string,
  person: string,
  role: Role,
): ShopState {
  permit(role, 'requestReview');
  const s = clone(state),
    p = s.purchaseRequests.find((p) => p.id === id);
  if (!p || !isOpenRequest(p)) return fail('รายการนี้ยกเลิกแล้ว');
  Object.assign(p, {
    status: 'cancelled',
    cancelReason: required(reason, 500, 'ระบุเหตุผลยกเลิก'),
    cancelledAt: nowIso(),
  });
  return finish(s, 'ยกเลิกรายการเสนอซื้อ', id, person, role, { reason: p.cancelReason });
}
