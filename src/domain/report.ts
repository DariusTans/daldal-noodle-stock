/**
 * Read-only reports (legacy report-core.js). Purchases and expenses are reported
 * separately and must never be summed together; this is not a sales/profit report.
 */
import { movementKinds, orderStatuses, expenseStatuses, receiptIssues, roles } from './constants';
import { can } from './permissions';
import { nowIso } from './runtime';
import { receivingLabel, receivingSummary } from './receive';
import { stockRows } from './stock';
import type { Currency, ExpenseCategory, Funding, MovementKind, Role, ShopState } from './types';
import { fail, hasOwn, round3 } from './util';
import { validate } from './validate';

export interface DateRange {
  from: string;
  to: string;
}

/** Calendar day of an instant in Asia/Bangkok, YYYY-MM-DD. */
export const reportDay = (value: string | number | Date) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));

export function reportRange(from = '', to = ''): DateRange {
  const valid = (v: unknown) =>
    typeof v === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(v) &&
    Number.isFinite(Date.parse(v + 'T00:00:00Z')) &&
    new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
  if ((from && !valid(from)) || (to && !valid(to)) || (from && to && from > to))
    fail('เลือกช่วงวันที่ให้ถูกต้อง วันเริ่มต้องไม่เกินวันสิ้นสุด');
  return { from, to };
}

const within = (day: string, r: DateRange) => (!r.from || day >= r.from) && (!r.to || day <= r.to);

export interface StockReportRow {
  id: string;
  name: string;
  code: string;
  active: boolean;
  unit: string;
  baseQty: number | null;
  ledger: number | null;
  referenceQty: number | null;
  referenceAt: string | null;
  basis: string;
  roundId: string;
  low: boolean;
  minimum: number | null;
  suggested: number | null;
  needsReview: boolean;
}

export interface MovementReportRow {
  id: string;
  ingredientId: string;
  name: string;
  unit: string;
  kind: MovementKind;
  delta: number;
  at: string;
  reference: string;
  reverseOf: string | null;
  roundId: string;
  person: string;
}

export type MovementGroup = {
  ingredientId: string;
  name: string;
  unit: string;
  net: number;
} & Record<MovementKind, number>;

export interface ReportTask {
  kind: string;
  id: string;
  label: string;
  status: string;
  page: string;
  at: string | null;
}

export interface ReceiptReportRow {
  id: string;
  orderId: string;
  name: string;
  unit: string;
  reference: string;
  accepted: number;
  rejected: number;
  issue: string;
  at: string;
  person: string;
}

export interface ExpenseReportRow {
  id: string;
  date: string;
  vendor: string;
  reference: string;
  category: ExpenseCategory;
  amount: number;
  currency: Currency;
  funding: Funding;
  payer: string;
  orderId: string | null;
  reviewedBy: string;
  reviewedAt: string;
}

export interface PurchaseReportRow {
  id: string;
  name: string;
  reference: string;
  vendor: string;
  currency: Currency;
  total: number;
  orderedQty: number;
  receivedQty: number;
  unit: string;
  at: string;
  status: string;
}

export interface ExpenseTotal {
  total: number;
  shop: number;
  personal: number;
  count: number;
  categories: Partial<Record<ExpenseCategory, number>>;
}

export interface Report {
  range: DateRange;
  generatedAt: string;
  stock: StockReportRow[];
  moves: MovementReportRow[];
  movementGroups: MovementGroup[];
  tasks: ReportTask[];
  receipts: ReceiptReportRow[];
  finance: null | {
    expenses: ExpenseReportRow[];
    purchases: PurchaseReportRow[];
    expenseTotals: Partial<Record<Currency, ExpenseTotal>>;
    purchaseTotals: Partial<Record<Currency, number>>;
  };
}

export function report(
  s: ShopState,
  range: Partial<DateRange> | null | undefined,
  role: Role,
): Report {
  validate(s);
  if (!hasOwn(roles, role)) fail('ไม่พบบทบาท');
  const r = reportRange(range?.from, range?.to),
    finance = can(role, 'expense'),
    stock: StockReportRow[] = stockRows(s).map((x) => ({
      id: x.id,
      name: x.name,
      code: x.code,
      active: x.active,
      unit: x.unit.symbol,
      baseQty: x.base?.qty ?? null,
      ledger: x.ledger,
      referenceQty: x.referenceQty,
      referenceAt: x.referenceAt,
      basis: !x.base ? 'ยังไม่นับ' : x.check ? 'ตรวจเคลื่อนไหวครบ' : 'ยอดนับล่าสุด',
      roundId: x.base?.roundId || '',
      low: x.low,
      minimum: x.policy?.enabled ? x.policy.minimum : null,
      suggested: x.suggested,
      needsReview: !!x.base && !x.check,
    })),
    moves: MovementReportRow[] = s.movements
      .filter((m) => within(reportDay(m.at), r))
      .map((m) => ({
        id: m.id,
        ingredientId: m.ingredientId,
        name: m.name,
        unit: m.unitSymbol,
        kind: m.kind,
        delta: m.delta,
        at: m.at,
        reference: m.reference,
        reverseOf: m.reverseOf,
        roundId: m.roundId,
        person: m.person,
      })),
    movementGroups: MovementGroup[] = [];
  for (const m of moves) {
    let g = movementGroups.find((x) => x.ingredientId === m.ingredientId && x.unit === m.unit);
    if (!g) {
      g = {
        ingredientId: m.ingredientId,
        name: m.name,
        unit: m.unit,
        receive: 0,
        use: 0,
        waste: 0,
        increase: 0,
        decrease: 0,
        reverse: 0,
        net: 0,
      };
      movementGroups.push(g);
    }
    g[m.kind] = round3(g[m.kind] + m.delta);
    g.net = round3(g.net + m.delta);
  }
  const tasks: ReportTask[] = [];
  for (const x of s.countRounds.filter((x) => ['draft', 'review'].includes(x.status)))
    tasks.push({
      kind: 'รอบนับ',
      id: x.id,
      label: x.title,
      status: x.status === 'draft' ? 'ร่างนับค้าง' : 'รอตรวจยอด',
      page: 'counting',
      at: x.createdAt || null,
    });
  for (const x of s.purchaseRequests.filter(
    (x) =>
      ['draft', 'ready'].includes(x.status) &&
      !s.purchaseOrders.some(
        (o) => o.requestId === x.id && !['cancelled', 'rejected'].includes(o.status),
      ),
  ))
    tasks.push({
      kind: 'เสนอซื้อ',
      id: x.id,
      label: x.name,
      status: x.status === 'draft' ? 'รอตรวจจำนวน' : 'รอเริ่มจัดซื้อ',
      page: 'alerts',
      at: x.at,
    });
  if (finance)
    for (const o of s.purchaseOrders.filter(
      (o) => !['ordered', 'cancelled', 'rejected'].includes(o.status),
    ))
      tasks.push({
        kind: 'จัดซื้อ',
        id: o.id,
        label: o.name,
        status: orderStatuses[o.status],
        page: 'buy',
        at: o.at,
      });
  for (const o of s.purchaseOrders.filter(
    (o) => o.status === 'ordered' && o.receiving?.status !== 'closed',
  )) {
    const v = receivingSummary(s, o);
    tasks.push({
      kind: 'ตรวจรับ',
      id: o.id,
      label: o.name,
      status: receivingLabel(s, o) + (v.issues.length ? ' · ' + v.issues.length + ' ปัญหา' : ''),
      page: 'receiving',
      at: o.purchase!.at,
    });
  }
  if (finance)
    for (const e of s.expenses.filter((e) => ['draft', 'returned', 'pending'].includes(e.status)))
      tasks.push({
        kind: 'ค่าใช้จ่าย',
        id: e.id,
        label: e.vendor,
        status: expenseStatuses[e.status],
        page: 'expenses',
        at: e.at,
      });
  const receipts: ReceiptReportRow[] = s.receipts
    .filter((x) => x.status === 'confirmed' && within(reportDay(x.confirmedAt!), r))
    .map((x) => ({
      id: x.id,
      orderId: x.orderId,
      name: s.purchaseOrders.find((o) => o.id === x.orderId)!.name,
      unit: s.units.find((u) => u.id === x.unitId)!.symbol,
      reference: x.reference,
      accepted: x.accepted,
      rejected: x.rejected,
      issue: receiptIssues[x.issueType],
      at: x.confirmedAt!,
      person: x.confirmedBy!,
    }));
  const result: Report = {
    range: r,
    generatedAt: nowIso(),
    stock,
    moves,
    movementGroups,
    tasks,
    receipts,
    finance: null,
  };
  if (finance) {
    const expenses: ExpenseReportRow[] = s.expenses
        .filter((e) => e.status === 'confirmed' && within(e.date, r))
        .map((e) => ({
          id: e.id,
          date: e.date,
          vendor: e.vendor,
          reference: e.reference,
          category: e.category,
          amount: e.amount,
          currency: e.currency,
          funding: e.funding,
          payer: e.payer,
          orderId: e.orderId,
          reviewedBy: e.review!.person,
          reviewedAt: e.review!.at,
        })),
      purchases: PurchaseReportRow[] = s.purchaseOrders
        .filter((o) => o.status === 'ordered' && within(reportDay(o.purchase!.at), r))
        .map((o) => ({
          id: o.id,
          name: o.name,
          reference: o.purchase!.reference,
          vendor: o.purchase!.offer.vendor,
          currency: o.currency,
          total: o.purchase!.total,
          orderedQty: o.purchase!.orderedQty,
          receivedQty: o.purchase!.receivedQty,
          unit: o.unitSymbol,
          at: o.purchase!.at,
          status: receivingLabel(s, o),
        })),
      expenseTotals: Partial<Record<Currency, ExpenseTotal>> = {},
      purchaseTotals: Partial<Record<Currency, number>> = {};
    for (const e of expenses) {
      const t =
        expenseTotals[e.currency] ||
        (expenseTotals[e.currency] = { total: 0, shop: 0, personal: 0, count: 0, categories: {} });
      t.total += e.amount;
      t[e.funding] += e.amount;
      t.count++;
      t.categories[e.category] = (t.categories[e.category] || 0) + e.amount;
    }
    for (const p of purchases)
      purchaseTotals[p.currency] = (purchaseTotals[p.currency] || 0) + p.total;
    result.finance = { expenses, purchases, expenseTotals, purchaseTotals };
  }
  return result;
}

export type ReportKind = 'stock' | 'movements' | 'receipts' | 'expenses' | 'purchases';

/** CSV with formula-injection escaping (leading = + - @ or control chars get a quote prefix). */
const cell = (v: unknown) => {
  let t = String(v ?? '');
  if (typeof v === 'string' && (/^[\s﻿]*[=+\-@]/.test(t) || /^[\t\r\n]/.test(t))) t = "'" + t;
  return '"' + t.replace(/"/g, '""') + '"';
};

export function reportCSV(
  s: ShopState,
  range: Partial<DateRange> | null | undefined,
  role: Role,
  kind: ReportKind,
): string {
  const r = report(s, range, role);
  let head: string[], rows: unknown[][];
  if (kind === 'stock') {
    head = [
      'รหัส',
      'วัตถุดิบ',
      'ใช้งาน',
      'หน่วย',
      'ยอดอ้างอิงปัจจุบัน',
      'ฐานยอด',
      'เวลาฐานยอด',
      'ยอดคำนวณปัจจุบัน',
      'จุดเตือน',
      'เข้าเกณฑ์เตือน',
    ];
    rows = r.stock.map((x) => [
      x.code,
      x.name,
      x.active ? 'ใช่' : 'ไม่',
      x.unit,
      x.referenceQty,
      x.basis,
      x.referenceAt,
      x.ledger,
      x.minimum,
      x.low ? 'ใช่' : 'ไม่',
    ]);
  } else if (kind === 'movements') {
    head = [
      'รหัสเคลื่อนไหว',
      'เวลา ISO',
      'วัตถุดิบ',
      'ประเภท',
      'จำนวนเปลี่ยน',
      'หน่วย',
      'รอบนับ',
      'เลขอ้างอิง',
      'กลับรายการของ',
      'ผู้บันทึก',
    ];
    rows = r.moves.map((x) => [
      x.id,
      x.at,
      x.name,
      movementKinds[x.kind],
      x.delta,
      x.unit,
      x.roundId,
      x.reference,
      x.reverseOf,
      x.person,
    ]);
  } else if (kind === 'receipts') {
    head = [
      'รหัสรับ',
      'ใบซื้อ',
      'เวลา ISO',
      'วัตถุดิบ',
      'เลขส่งของ',
      'รับจริง',
      'ไม่รับ',
      'หน่วย',
      'ผลตรวจ',
      'ผู้ยืนยัน',
    ];
    rows = r.receipts.map((x) => [
      x.id,
      x.orderId,
      x.at,
      x.name,
      x.reference,
      x.accepted,
      x.rejected,
      x.unit,
      x.issue,
      x.person,
    ]);
  } else if (kind === 'expenses') {
    if (!r.finance) return fail('บทบาทนี้ไม่เปิดรายงานการเงิน');
    head = [
      'รหัสค่าใช้จ่าย',
      'วันที่บิล',
      'ร้านค้า',
      'เลขบิล',
      'หมวด',
      'ยอดเงิน',
      'สกุลเงิน',
      'แหล่งเงิน',
      'ผู้จ่าย',
      'ใบซื้อ',
      'ผู้ตรวจ',
      'เวลายืนยัน ISO',
    ];
    rows = r.finance.expenses.map((x) => [
      x.id,
      x.date,
      x.vendor,
      x.reference,
      x.category,
      (x.amount / 100).toFixed(2),
      x.currency,
      x.funding === 'shop' ? 'เงินร้าน' : 'สำรองส่วนตัว',
      x.payer,
      x.orderId,
      x.reviewedBy,
      x.reviewedAt,
    ]);
  } else if (kind === 'purchases') {
    if (!r.finance) return fail('บทบาทนี้ไม่เปิดรายงานการเงิน');
    head = [
      'ใบซื้อ',
      'วันที่บันทึกซื้อ ISO',
      'วัตถุดิบ',
      'ร้านค้า',
      'เลขซื้อ',
      'ยอดซื้อ',
      'สกุลเงิน',
      'สั่งจริง',
      'รับสะสมปัจจุบัน',
      'หน่วย',
      'สถานะปัจจุบัน',
    ];
    rows = r.finance.purchases.map((x) => [
      x.id,
      x.at,
      x.name,
      x.vendor,
      x.reference,
      (x.total / 100).toFixed(2),
      x.currency,
      x.orderedQty,
      x.receivedQty,
      x.unit,
      x.status,
    ]);
  } else return fail('ไม่พบประเภทรายงาน');
  const note =
    kind === 'stock'
      ? 'สต็อกปัจจุบัน ไม่กรองช่วงวัน ไม่ใช่ยอดย้อนหลัง'
      : kind === 'expenses'
        ? 'กรองวันที่บิล เฉพาะสถานะยืนยันปัจจุบัน ไม่ใช่งบปิดย้อนหลัง'
        : kind === 'purchases'
          ? 'กรองวันที่บันทึกซื้อ ยอดซื้อไม่ใช่ค่าใช้จ่าย ห้ามบวกรวมกัน'
          : kind === 'receipts'
            ? 'กรองเวลายืนยัน เฉพาะใบรับที่ยังยืนยัน ไม่รวมกลับรายการ'
            : 'กรองเวลาบันทึก รวมรายการกลับรายการ ไม่ใช่ยอดคงเหลือ';
  return (
    '﻿' +
    [
      ['DALDAL', kind],
      ['สร้างเมื่อ ISO', r.generatedAt],
      ['วันเริ่ม (ไทย)', r.range.from || 'ทั้งหมด'],
      ['วันสิ้นสุด (ไทย)', r.range.to || 'ทั้งหมด'],
      ['ขอบเขต', note],
      [],
      head,
      ...rows,
    ]
      .map((row) => row.map(cell).join(','))
      .join('\r\n')
  );
}
