/**
 * Daldal domain — public API.
 *
 * Every mutating operation is pure: (state, …args) → new state, and runs
 *   validate(input) → cross-module guards → operation → post-steps → validate(output)
 * which is exactly the composed behaviour of the legacy layered prototype (v0.8.1),
 * verified by tests/domain/parity.test.ts.
 */
import * as buy from './buy.js';
import * as counts from './counts.js';
import * as expense from './expense.js';
import * as master from './master.js';
import * as receive from './receive.js';
import * as stock from './stock.js';
import type { ShopState } from './types.js';
import { fail, normRef } from './util.js';
import { validate } from './validate.js';

export * from './constants.js';
export * from './types.js';
export { can, type Action } from './permissions.js';
export { DomainError } from './util.js';
export { withRuntime, type Runtime } from './runtime.js';
export { validate, validateAt } from './validate.js';
export { migrate } from './migrate.js';
export { seed } from './seed.js';
export { parseQuantity } from './quantity.js';
export { parseMoney, parseExpenseAmount, formatMinor } from './money.js';
export { latestCounts, hasOpenCount, lineNeedsReason } from './counts.js';
export { stockRows } from './stock.js';
export {
  quoteTotal,
  orderSourceStale,
  orderPolicyStale,
  needsApproval,
  selectedOffer,
} from './buy.js';
export { receivingSummary, receivingLabel } from './receive.js';
export { expenseDuplicates, expenseWarnings, expenseTotals, bangkokToday } from './expense.js';
export { report, reportCSV, reportDay, reportRange } from './report.js';
export type { Report, ReportKind, DateRange } from './report.js';
export { workflowTasks, type WorkflowTask } from './workflow.js';
export type { IngredientInput, UnitInput } from './master.js';
export type { CountUpdate } from './counts.js';
export type { MovementInput, PolicyInput, RequestReviewInput } from './stock.js';
export type {
  PurchasePolicyInput,
  SourceReviewInput,
  OfferInput,
  MarkOrderedInput,
  DecideAction,
} from './buy.js';
export type { ReceiptInput, ConfirmReceiptInput, CloseReceivingInput } from './receive.js';
export type {
  ExpenseReviewerInput,
  ExpenseInput,
  ExpenseReviewInput,
  ExpenseNoteInput,
} from './expense.js';

type Op<A extends unknown[]> = (state: ShopState, ...args: A) => ShopState;

function mutation<A extends unknown[]>(
  op: Op<A>,
  guard?: (s: ShopState, ...args: A) => void,
  after?: (out: ShopState, before: ShopState, ...args: A) => void,
): Op<A> {
  return (state, ...args) => {
    validate(state);
    guard?.(state, ...args);
    const out = op(state, ...args);
    after?.(out, state, ...args);
    validate(out);
    return out;
  };
}

const roundsUse = (s: ShopState, pred: (l: { ingredientId: string; unitId: string }) => boolean) =>
  s.countRounds.some((r) => r.lines.some(pred));

// ── Master data ──
export const saveIngredient = mutation(master.saveIngredient, (s, d) => {
  const old = s.ingredients.find((i) => i.id === d.id);
  if (old && old.unitId !== d.unitId && s.stockPolicies.some((p) => p.ingredientId === old.id))
    fail('มีจุดเตือนในหน่วยเดิมแล้ว เปลี่ยนหน่วยไม่ได้ ให้สร้างวัตถุดิบใหม่');
  if (old && old.unitId !== d.unitId && roundsUse(s, (l) => l.ingredientId === old.id))
    fail('วัตถุดิบนี้มีรอบนับแล้ว เปลี่ยนหน่วยไม่ได้ ให้สร้างรายการใหม่เพื่อรักษาประวัติ');
});
export const saveUnit = mutation(master.saveUnit, (s, d) => {
  const old = s.units.find((u) => u.id === d.id);
  if (old && old.type !== d.type && roundsUse(s, (l) => l.unitId === old.id))
    fail('หน่วยนี้มีประวัติการนับแล้ว เปลี่ยนประเภทไม่ได้');
});
export const toggle = mutation(master.toggle);

// ── Counting ──
export const startCount = mutation(counts.startCount, undefined, (out, before) => {
  // A new round compares against the verified ledger when a completeness check covers it.
  const rows = stock.stockRows(before);
  for (const l of out.countRounds.at(-1)!.lines) {
    const b = rows.find((b) => b.id === l.ingredientId)!;
    l.expectedQty = b.check ? b.ledger : null;
    l.expectedAt = b.check?.at || null;
    l.expectedBy = b.check?.person || null;
  }
});
export const saveCount = mutation(counts.saveCount);
export const submitCount = mutation(counts.submitCount);
export const returnCount = mutation(counts.returnCount);
export const confirmCount = mutation(counts.confirmCount);
export const cancelCount = mutation(counts.cancelCount);

// ── Stock ──
export const addMovement = mutation(stock.addMovement, (s, d) => {
  if (d.kind !== 'receive') return;
  if (
    s.purchaseOrders.some(
      (o) =>
        o.status === 'ordered' &&
        o.ingredientId === d.ingredientId &&
        o.receiving?.status !== 'closed',
    )
  )
    fail('มีใบซื้อรอตรวจรับสำหรับวัตถุดิบนี้ ใช้หน้าตรวจรับเพื่อไม่ลงยอดซ้ำ');
  if (
    d.reference &&
    s.receipts.some(
      (r) =>
        ['confirmed', 'void'].includes(r.status) && normRef(r.reference) === normRef(d.reference),
    )
  )
    fail('เลขอ้างอิงนี้เป็นใบรับแล้ว กรุณาตรวจประวัติ');
});
export const reverseMovement = mutation(stock.reverseMovement, (s, id) => {
  if (s.movements.find((m) => m.id === id)?.receiptId)
    fail('รายการนี้มาจากตรวจรับ ให้ยกเลิกใบรับที่หน้าตรวจรับ');
});
export const reviewLedger = mutation(stock.reviewLedger);
export const savePolicy = mutation(stock.savePolicy);
export const createRequest = mutation(stock.createRequest);
export const reviewRequest = mutation(stock.reviewRequest);
export const refreshRequest = mutation(stock.refreshRequest);
export const cancelRequest = mutation(stock.cancelRequest, (s, id) => {
  if (s.purchaseOrders.some((o) => o.requestId === id && buy.isLiveOrder(o)))
    fail('มีใบจัดซื้ออ้างอิงอยู่ ต้องยกเลิกใบจัดซื้อก่อน รายการซื้อแล้วรอตรวจรับ');
});

// ── Purchasing ──
export const savePurchasePolicy = mutation(buy.savePurchasePolicy);
export const createOrder = mutation(buy.createOrder);
export const reviewOrderSource = mutation(buy.reviewOrderSource);
export const saveOffer = mutation(buy.saveOffer);
export const selectOffer = mutation(buy.selectOffer);
export const submitOrder = mutation(buy.submitOrder);
export const decideOrder = mutation(buy.decideOrder);
export const reviseOrder = mutation(buy.reviseOrder);
export const cancelOrder = mutation(buy.cancelOrder);
export const markOrdered = mutation(buy.markOrdered, undefined, (out, _before, id) => {
  out.purchaseOrders.find((o) => o.id === id)!.receiving = { status: 'open' };
});

// ── Receiving ──
export const saveReceipt = mutation(receive.saveReceipt);
export const confirmReceipt = mutation(receive.confirmReceipt);
export const cancelReceipt = mutation(receive.cancelReceipt);
export const resolveReceiptIssue = mutation(receive.resolveReceiptIssue);
export const closeReceiving = mutation(receive.closeReceiving);

// ── Expenses ──
export const saveExpenseReviewer = mutation(expense.saveExpenseReviewer);
export const saveExpense = mutation(expense.saveExpense);
export const submitExpense = mutation(expense.submitExpense);
export const reviewExpense = mutation(expense.reviewExpense);
export const cancelExpense = mutation(expense.cancelExpense);
