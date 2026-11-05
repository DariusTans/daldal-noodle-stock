/** Count rounds: draft → review → confirmed (legacy counts-core.js). Raw ops. */
import { can } from './permissions.js';
import { parseQuantity } from './quantity.js';
import { nowIso, uid } from './runtime.js';
import type { CountAudit, CountLine, CountRound, LatestCount, Role, ShopState } from './types.js';
import { clone, fail, isText } from './util.js';

export interface CountUpdate {
  ingredientId: string;
  qty: unknown;
  reason?: unknown;
}

function personName(person: unknown): string {
  if (!isText(person, 80)) fail('ระบุชื่อผู้ทำรายการ ไม่เกิน 80 ตัวอักษร');
  return (person as string).trim();
}

function permitted(role: Role, action: 'count' | 'reviewCount') {
  if (!can(role, action)) fail('บทบาทนี้ยืนยันหรือส่งกลับรอบนับไม่ได้');
}

function addAudit(
  s: ShopState,
  r: CountRound,
  action: string,
  person: unknown,
  role: Role,
  extra: Partial<CountAudit> = {},
): ShopState {
  r.audit.push({ time: nowIso(), action, person: personName(person), role, ...extra });
  s.revision++;
  return s;
}

function findRound(s: ShopState, rid: string, status?: CountRound['status']): CountRound {
  const r = s.countRounds.find((r) => r.id === rid);
  if (!r) return fail('ไม่พบรอบนับ');
  if (status && r.status !== status) fail('สถานะรอบนับเปลี่ยนแล้ว หรือรอบนี้ถูกล็อก');
  return r;
}

export const isOpenRound = (r: CountRound) => r.status === 'draft' || r.status === 'review';
export const hasOpenCount = (s: ShopState) => s.countRounds.some(isOpenRound);

/** The most recent confirmed count line per ingredient. */
export function latestCounts(s: ShopState): LatestCount[] {
  const map = new Map<string, LatestCount>();
  for (const r of s.countRounds)
    if (r.status === 'confirmed')
      for (const l of r.lines) {
        const current = map.get(l.ingredientId);
        if (!current || r.confirmedAt! >= current.confirmedAt)
          map.set(l.ingredientId, {
            ...clone(l),
            roundId: r.id,
            roundTitle: r.title,
            confirmedAt: r.confirmedAt!,
            confirmedBy: r.confirmedBy!,
          });
      }
  return [...map.values()];
}

const comparison = (l: CountLine) => l.expectedQty ?? l.previousQty;
/** A line differs from its comparison quantity and has no explanation. */
export const lineNeedsReason = (l: CountLine) =>
  comparison(l) !== null && comparison(l) !== l.qty && !l.reason.trim();

export function startCount(state: ShopState, title: string, person: string, role: Role): ShopState {
  permitted(role, 'count');
  person = personName(person);
  if (!isText(title, 100)) fail('ระบุชื่อรอบนับ ไม่เกิน 100 ตัวอักษร');
  if (state.countRounds.some(isOpenRound)) fail('มีรอบนับค้างอยู่ กรุณาจบหรือยกเลิกรอบเดิมก่อน');
  const items = state.ingredients.filter((i) => i.active);
  if (!items.length) fail('ไม่มีวัตถุดิบที่เปิดใช้งาน');
  const s = clone(state),
    previous = latestCounts(s),
    time = nowIso();
  const r: CountRound = {
    id: uid('ct', 6),
    title: title.trim(),
    status: 'draft',
    createdBy: person,
    createdAt: time,
    submittedAt: null,
    submittedBy: null,
    confirmedAt: null,
    confirmedBy: null,
    feedback: '',
    cancelledAt: null,
    cancelReason: '',
    lines: items.map((i) => {
      const u = s.units.find((u) => u.id === i.unitId)!,
        p = previous.find((l) => l.ingredientId === i.id && l.unitId === i.unitId);
      return {
        ingredientId: i.id,
        code: i.code,
        name: i.name,
        category: i.category,
        location: i.location,
        unitId: u.id,
        unitName: u.name,
        unitSymbol: u.symbol,
        previousQty: p?.qty ?? null,
        previousAt: p?.countedAt ?? null,
        previousRoundId: p?.roundId ?? null,
        qty: null,
        countedAt: null,
        countedBy: null,
        reason: '',
      };
    }),
    audit: [],
  };
  s.countRounds.push(r);
  return addAudit(s, r, 'เปิดรอบนับ', person, role);
}

export function saveCount(
  state: ShopState,
  rid: string,
  updates: CountUpdate[],
  person: string,
  role: Role,
): ShopState {
  permitted(role, 'count');
  person = personName(person);
  const s = clone(state),
    r = findRound(s, rid, 'draft');
  if (
    !Array.isArray(updates) ||
    updates.length !== r.lines.length ||
    new Set(updates.map((u) => u.ingredientId)).size !== r.lines.length
  )
    fail('ต้องบันทึกข้อมูลครบทุกแถวของรอบ');
  const changes: NonNullable<CountAudit['changes']> = [],
    time = nowIso();
  for (const l of r.lines) {
    const u = updates.find((x) => x.ingredientId === l.ingredientId);
    if (!u) return fail('ไม่พบรายการนับ');
    const qty = parseQuantity(u.qty),
      reason = typeof u.reason === 'string' ? u.reason.trim() : '';
    if (reason.length > 500) fail('หมายเหตุไม่เกิน 500 ตัวอักษร');
    if (l.qty !== null && l.qty !== qty && !reason) fail('ระบุเหตุผลแก้ยอดของ ' + l.name);
    if (l.qty !== qty || l.reason !== reason) {
      changes.push({ ingredientId: l.ingredientId, before: l.qty, after: qty, reason });
      if (l.qty !== qty) {
        l.countedAt = qty === null ? null : time;
        l.countedBy = qty === null ? null : person;
      }
      l.qty = qty;
      l.reason = reason;
    }
  }
  if (!changes.length) return s;
  return addAudit(s, r, 'บันทึกยอดนับ', person, role, { changes });
}

export function submitCount(state: ShopState, rid: string, person: string, role: Role): ShopState {
  permitted(role, 'count');
  person = personName(person);
  const s = clone(state),
    r = findRound(s, rid, 'draft');
  if (r.lines.some((l) => l.qty === null)) fail('ยังนับไม่ครบ ช่องว่างคือยังไม่ได้นับ ไม่ใช่ศูนย์');
  if (r.lines.some(lineNeedsReason)) fail('ระบุคำอธิบายของรายการที่ต่างจากยอดเปรียบเทียบ');
  r.status = 'review';
  r.submittedAt = nowIso();
  r.submittedBy = person;
  return addAudit(s, r, 'ส่งตรวจ', person, role);
}

export function returnCount(
  state: ShopState,
  rid: string,
  reason: string,
  person: string,
  role: Role,
): ShopState {
  permitted(role, 'reviewCount');
  if (!isText(reason, 500)) fail('ระบุเหตุผลส่งกลับ');
  const s = clone(state),
    r = findRound(s, rid, 'review');
  r.status = 'draft';
  r.feedback = reason.trim();
  r.submittedAt = null;
  r.submittedBy = null;
  return addAudit(s, r, 'ส่งกลับแก้ไข', person, role, { reason: reason.trim() });
}

export function confirmCount(state: ShopState, rid: string, person: string, role: Role): ShopState {
  permitted(role, 'reviewCount');
  const s = clone(state),
    r = findRound(s, rid, 'review');
  r.status = 'confirmed';
  r.confirmedAt = nowIso();
  r.confirmedBy = personName(person);
  return addAudit(s, r, 'ยืนยันยอดนับ', person, role);
}

export function cancelCount(
  state: ShopState,
  rid: string,
  reason: string,
  person: string,
  role: Role,
): ShopState {
  permitted(role, 'reviewCount');
  if (!isText(reason, 500)) fail('ระบุเหตุผลยกเลิก');
  const s = clone(state),
    r = findRound(s, rid);
  if (!isOpenRound(r)) fail('รอบนี้ปิดแล้ว');
  r.status = 'cancelled';
  r.cancelledAt = nowIso();
  r.cancelReason = reason.trim();
  return addAudit(s, r, 'ยกเลิกรอบ', person, role, { reason: reason.trim() });
}
