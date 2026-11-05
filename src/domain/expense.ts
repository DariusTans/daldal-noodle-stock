/**
 * Expenses / bills (legacy expense-core.js).
 * draft/returned → pending → confirmed; only confirmed counts toward totals; never touches stock.
 * Raw ops — the public API validates input/output.
 */
import { ATTACHMENT_MAX_BYTES, STORED_ATTACHMENT_MAX_BYTES, attachmentTypes } from './constants.js';
import { parseExpenseAmount } from './money.js';
import { can } from './permissions.js';
import { nowDate, nowIso, uid } from './runtime.js';
import type {
  Attachment,
  Currency,
  Expense,
  ExpenseCategory,
  ExpenseSnapshot,
  Funding,
  ReviewerRole,
  Role,
  ShopState,
} from './types.js';
import { clone, fail, isText, normLoose } from './util.js';

const req = (v: unknown, n = 500) => (isText(v, n) ? v.trim() : fail('กรอกข้อมูลที่จำเป็นให้ครบ'));
const expenseId = () => uid('ex', 7);

export interface ExpenseReviewerInput {
  name: string;
  role: ReviewerRole;
  note: string;
  person: string;
  checked: boolean;
}

export interface ExpenseInput {
  id?: string;
  vendor: string;
  date: string;
  reference?: string;
  amount: unknown;
  currency: Currency;
  category: ExpenseCategory;
  funding: Funding;
  payer: string;
  orderId?: string | null;
  note: string;
  person: string;
  /** undefined = keep the previous attachment; null = remove. */
  attachment?: Attachment | null;
  noEvidenceReason?: string;
}

export interface ExpenseReviewInput {
  action: 'confirm' | 'return';
  person: string;
  note: string;
  checked?: boolean;
  exceptionsChecked?: boolean;
}

export interface ExpenseNoteInput {
  person: string;
  note: string;
}

const permit = (role: Role) => {
  if (!can(role, 'expense')) fail('บทบาทนี้ไม่เปิดข้อมูลค่าใช้จ่าย');
};

export const isValidDate = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;

/** Today in Asia/Bangkok as YYYY-MM-DD. */
export const bangkokToday = () =>
  nowDate().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const STORED_PATH = new RegExp('^' + UUID + '/' + UUID + '$');

const SIGNATURES: Record<Attachment['type'], string> = {
  'image/png': 'iVBORw0KGgo',
  'image/jpeg': '/9j/',
  'image/webp': 'UklGR',
  'application/pdf': 'JVBERi0',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function assertValidAttachment(a: any): asserts a is Attachment {
  if (a && typeof a.data !== 'string' && typeof a.path === 'string') return assertValidStored(a);
  if (
    !a ||
    !isText(a.name, 160) ||
    !(attachmentTypes as readonly string[]).includes(a.type) ||
    !Number.isInteger(a.size) ||
    a.size < 1 ||
    a.size > ATTACHMENT_MAX_BYTES ||
    !/^([a-f0-9]{64})$/.test(a.hash) ||
    typeof a.data !== 'string'
  )
    fail('หลักฐานไม่ถูกต้อง รองรับภาพ/PDF ไม่เกิน 350 KB ต่อไฟล์');
  const m = (a.data as string).match(/^data:([^;]+);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (
    !m ||
    m[1] !== a.type ||
    m[2]!.length % 4 ||
    (m[2]!.length * 3) / 4 - (m[2]!.endsWith('==') ? 2 : m[2]!.endsWith('=') ? 1 : 0) !== a.size
  )
    fail('ข้อมูลไฟล์หลักฐานไม่ครบ');
  if (!m![2]!.startsWith(SIGNATURES[a.type as Attachment['type']])) fail('ชนิดไฟล์ไม่ตรงหลักฐาน');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function assertValidStored(a: any): void {
  if (
    !isText(a.name, 160) ||
    !(attachmentTypes as readonly string[]).includes(a.type) ||
    !Number.isInteger(a.size) ||
    a.size < 1 ||
    a.size > STORED_ATTACHMENT_MAX_BYTES ||
    !/^([a-f0-9]{64})$/.test(a.hash) ||
    !isText(a.evidenceId, 100) ||
    !STORED_PATH.test(a.path) ||
    !a.path.endsWith('/' + a.evidenceId) ||
    'data' in a
  )
    fail('หลักฐานไม่ถูกต้อง รองรับภาพ/PDF ไม่เกิน 5 MB ต่อไฟล์');
}

/** Other live expenses that look like the same bill (same file, vendor+reference, or vendor+date+amount). */
export const expenseDuplicates = (s: ShopState, e: Expense) =>
  s.expenses.filter(
    (x) =>
      x.id !== e.id &&
      x.status !== 'cancelled' &&
      ((e.attachment && x.attachment?.hash === e.attachment.hash) ||
        (e.reference &&
          x.reference &&
          normLoose(e.vendor) === normLoose(x.vendor) &&
          normLoose(e.reference) === normLoose(x.reference)) ||
        (normLoose(e.vendor) === normLoose(x.vendor) &&
          e.date === x.date &&
          e.currency === x.currency &&
          e.amount === x.amount)),
  );

export function expenseWarnings(s: ShopState, e: Expense): string[] {
  const list = expenseDuplicates(s, e).map((x) => 'สงสัยซ้ำกับ ' + x.id);
  if (!e.attachment) list.push('ไม่มีไฟล์หลักฐาน');
  if (e.orderId) {
    const o = s.purchaseOrders.find((x) => x.id === e.orderId)!;
    if (o.receiving?.status !== 'closed') list.push('ใบซื้อยังไม่ปิดตรวจรับ');
    if (e.currency !== o.currency || e.amount !== o.purchase!.total)
      list.push('ยอดหรือสกุลเงินต่างจากใบซื้อ');
    if (o.receiving?.status === 'closed' && o.receiving.unreceived > 0)
      list.push('ใบซื้อปิดรับบางส่วน');
  }
  return list;
}

export type ExpenseTotals = Partial<
  Record<Currency, { total: number; shop: number; personal: number }>
>;

/** Confirmed expenses only, per currency (never converted). */
export function expenseTotals(s: ShopState): ExpenseTotals {
  const totals: ExpenseTotals = {};
  for (const e of s.expenses.filter((e) => e.status === 'confirmed')) {
    const t = totals[e.currency] || (totals[e.currency] = { total: 0, shop: 0, personal: 0 });
    t.total += e.amount;
    t[e.funding] += e.amount;
  }
  return totals;
}

function finish(
  s: ShopState,
  e: Expense,
  action: string,
  person: unknown,
  role: Role,
  note: unknown,
) {
  e.audit.push({ action, person: req(person, 80), role, note: req(note), at: nowIso() });
  s.revision++;
  return s;
}

export function saveExpenseReviewer(
  state: ShopState,
  d: ExpenseReviewerInput,
  role: Role,
): ShopState {
  if (!can(role, 'expenseSettings')) fail('เฉพาะเจ้าของตั้งผู้ตรวจ');
  if (d.checked !== true || !['owner', 'manager'].includes(d.role))
    fail('รับรองเกณฑ์ทดลองและเลือกบทบาทผู้ตรวจ');
  const s = clone(state);
  s.expenseReviewer = {
    id: expenseId(),
    name: req(d.name, 80),
    role: d.role,
    note: req(d.note),
    person: req(d.person, 80),
    at: nowIso(),
  };
  s.revision++;
  return s;
}

const snapshot = (x: Expense): ExpenseSnapshot => ({
  vendor: x.vendor,
  date: x.date,
  reference: x.reference,
  amount: x.amount,
  currency: x.currency,
  category: x.category,
  funding: x.funding,
  payer: x.payer,
  orderId: x.orderId,
  note: x.note,
  noEvidenceReason: x.noEvidenceReason,
  attachment: x.attachment ? { name: x.attachment.name, hash: x.attachment.hash } : null,
});

export function saveExpense(state: ShopState, d: ExpenseInput, role: Role): ShopState {
  permit(role);
  const s = clone(state),
    old = d.id ? s.expenses.find((e) => e.id === d.id) : null;
  if (d.id && (!old || !['draft', 'returned'].includes(old.status)))
    fail('แก้ไขได้เฉพาะร่างหรือส่งกลับ');
  if (!isValidDate(d.date) || d.date > bangkokToday()) fail('วันที่บิลไม่ถูกต้องหรืออยู่ในอนาคต');
  const e: Expense = {
    id: old?.id || expenseId(),
    status: 'draft',
    vendor: req(d.vendor, 100),
    date: d.date,
    reference: String(d.reference || '').trim(),
    amount: parseExpenseAmount(d.amount),
    currency: d.currency,
    category: d.category,
    funding: d.funding,
    payer: req(d.payer, 80),
    orderId: d.orderId || null,
    note: req(d.note),
    person: req(d.person, 80),
    role,
    at: old?.at || nowIso(),
    attachment: d.attachment === undefined ? old?.attachment || null : d.attachment,
    noEvidenceReason: d.noEvidenceReason || '',
    audit: old?.audit || [],
  };
  e.audit.push({
    action: 'รายละเอียดร่าง',
    person: e.person,
    role,
    note: e.note,
    at: nowIso(),
    before: old ? snapshot(old) : null,
    after: snapshot(e),
  });
  if (old) s.expenses[s.expenses.indexOf(old)] = e;
  else s.expenses.push(e);
  return finish(s, e, 'บันทึกร่าง', d.person, role, e.note);
}

export function submitExpense(state: ShopState, id: string, person: string, role: Role): ShopState {
  permit(role);
  const s = clone(state),
    e = s.expenses.find((e) => e.id === id);
  if (!e || !['draft', 'returned'].includes(e.status)) return fail('ส่งได้เฉพาะร่าง');
  if (!s.expenseReviewer) return fail('เจ้าของต้องตั้งผู้ตรวจค่าใช้จ่ายก่อน');
  e.reviewPolicy = clone(s.expenseReviewer);
  e.status = 'pending';
  return finish(s, e, 'ส่งตรวจ', person, role, 'ส่งให้ ' + s.expenseReviewer.name);
}

export function reviewExpense(
  state: ShopState,
  id: string,
  d: ExpenseReviewInput,
  role: Role,
): ShopState {
  permit(role);
  const s = clone(state),
    e = s.expenses.find((e) => e.id === id);
  if (!e || e.status !== 'pending') return fail('รายการนี้ไม่ได้รอตรวจ');
  const p = s.expenseReviewer;
  if (!p || p.role !== role || p.name !== String(d.person).trim())
    return fail('ต้องตรงชื่อและบทบาทผู้ตรวจที่ตั้งไว้');
  if (!['confirm', 'return'].includes(d.action)) fail('เลือกผลตรวจ');
  if (d.action === 'return') {
    e.status = 'returned';
    e.feedback = req(d.note);
  } else {
    if (e.reviewPolicy!.id !== p.id) fail('เกณฑ์ผู้ตรวจเปลี่ยน ส่งกลับแล้วส่งตรวจใหม่');
    const warnings = expenseWarnings(s, e);
    if (d.checked !== true || (warnings.length && d.exceptionsChecked !== true))
      fail('ตรวจหลักฐานและรับรองรายการที่ต้องทบทวนให้ครบ');
    e.review = { person: p.name, role, at: nowIso(), note: req(d.note), checked: true, warnings };
    e.status = 'confirmed';
  }
  return finish(
    s,
    e,
    d.action === 'confirm' ? 'ยืนยันค่าใช้จ่าย' : 'ส่งกลับแก้ไข',
    d.person,
    role,
    d.note,
  );
}

export function cancelExpense(
  state: ShopState,
  id: string,
  d: ExpenseNoteInput,
  role: Role,
): ShopState {
  permit(role);
  const s = clone(state),
    e = s.expenses.find((e) => e.id === id);
  if (!e || e.status === 'cancelled') return fail('รายการนี้ยกเลิกแล้ว');
  if (e.status === 'confirmed' && role !== 'owner')
    fail('รายการยืนยันแล้วให้เจ้าของยกเลิกพร้อมเหตุผล');
  e.status = 'cancelled';
  e.cancelReason = req(d.note);
  return finish(s, e, 'ยกเลิกค่าใช้จ่าย', d.person, role, d.note);
}
