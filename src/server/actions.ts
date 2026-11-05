/**
 * Action registry: every state change a client can request.
 *
 * Clients send `{ type, payload }`. The payload never contains who is acting — the actor's
 * display name and role come from shop_members, so nobody can act as someone else or claim
 * a higher role. Approvers / expense reviewers are chosen by member id and resolved to the
 * member's display name + role here.
 */
import { z } from 'zod';
import * as D from '../domain/index.js';
import type { ShopState, StoredAttachment } from '../domain/index.js';
import { sha256Hex, sniffType } from './evidence.js';
import { HttpError } from './http.js';
import type { Deps, Member } from './ports.js';

export interface ActionContext {
  shopId: string;
  actor: Member;
  deps: Deps;
}

type Run<T> = (state: ShopState, input: T, ctx: ActionContext) => ShopState | Promise<ShopState>;
interface ActionDef<S extends z.ZodType> {
  schema: S;
  run: Run<z.infer<S>>;
}
const def = <S extends z.ZodType>(schema: S, run: Run<z.infer<S>>): ActionDef<S> => ({
  schema,
  run,
});

// ── payload building blocks ──
const id = z.string().min(1).max(100);
const uuid = z.uuid();
const str = (max: number) => z.string().max(max);
const qty = z.union([z.number(), z.string().max(40), z.null()]);
const money = z.union([z.number(), z.string().max(40)]);
const obj = z.strictObject;
const currency = z.enum(['THB', 'USD', 'KRW', 'JPY']);

const role = (ctx: ActionContext) => ctx.actor.role as D.Role;
const who = (ctx: ActionContext) => ctx.actor.displayName;

/** A member who can review/approve (owner or manager) — resolved from their user id. */
async function reviewerMember(ctx: ActionContext, userId: string, what: string): Promise<Member> {
  const m = (await ctx.deps.repo.members(ctx.shopId)).find((m) => m.userId === userId && m.active);
  if (!m || (m.role !== 'owner' && m.role !== 'manager'))
    throw new HttpError(422, 'rule', `${what}ต้องเป็นเจ้าของหรือผู้จัดการที่ยังใช้งานในร้าน`);
  return m;
}

/** Turn an uploaded evidence id into a verified stored attachment. */
async function storedAttachment(ctx: ActionContext, evidenceId: string): Promise<StoredAttachment> {
  const { repo, storage } = ctx.deps;
  const row = await repo.findEvidence(ctx.shopId, evidenceId);
  if (!row) throw new HttpError(422, 'evidence', 'ไม่พบไฟล์หลักฐาน กรุณาอัปโหลดใหม่');
  if (!row.verified_at) {
    const bytes = await storage.read(row.object_path);
    if (!bytes) throw new HttpError(422, 'evidence', 'ยังอัปโหลดไฟล์หลักฐานไม่เสร็จ');
    if (
      bytes.length !== row.size_bytes ||
      sha256Hex(bytes) !== row.sha256 ||
      sniffType(bytes) !== row.mime
    )
      throw new HttpError(422, 'evidence', 'ไฟล์หลักฐานไม่ตรงกับที่แจ้งไว้ กรุณาอัปโหลดใหม่');
    await repo.markEvidenceVerified(row.id);
  }
  return {
    name: row.original_name,
    type: row.mime,
    size: row.size_bytes,
    hash: row.sha256,
    evidenceId: row.id,
    path: row.object_path,
  };
}

export const actions = {
  // ── master data ──
  saveIngredient: def(
    obj({
      id: id.optional(),
      code: str(60),
      name: str(200),
      category: str(60),
      unitId: id,
      location: str(200).optional(),
      note: str(1000).optional(),
    }),
    (s, p, c) => D.saveIngredient(s, p, role(c)),
  ),
  saveUnit: def(
    obj({ id: id.optional(), name: str(80), symbol: str(30), type: str(30) }),
    (s, p, c) => D.saveUnit(s, p, role(c)),
  ),
  toggleIngredient: def(obj({ id }), (s, p, c) => D.toggle(s, p.id, role(c))),

  // ── counting ──
  startCount: def(obj({ title: str(200) }), (s, p, c) => D.startCount(s, p.title, who(c), role(c))),
  saveCount: def(
    obj({
      roundId: id,
      updates: z.array(obj({ ingredientId: id, qty, reason: str(1000).optional() })).max(5000),
    }),
    (s, p, c) => D.saveCount(s, p.roundId, p.updates, who(c), role(c)),
  ),
  submitCount: def(obj({ roundId: id }), (s, p, c) => D.submitCount(s, p.roundId, who(c), role(c))),
  returnCount: def(obj({ roundId: id, reason: str(1000) }), (s, p, c) =>
    D.returnCount(s, p.roundId, p.reason, who(c), role(c)),
  ),
  confirmCount: def(obj({ roundId: id }), (s, p, c) =>
    D.confirmCount(s, p.roundId, who(c), role(c)),
  ),
  cancelCount: def(obj({ roundId: id, reason: str(1000) }), (s, p, c) =>
    D.cancelCount(s, p.roundId, p.reason, who(c), role(c)),
  ),

  // ── stock ──
  addMovement: def(
    obj({
      ingredientId: id,
      kind: str(20),
      qty,
      reason: str(1000),
      reference: str(200).optional(),
    }),
    (s, p, c) => D.addMovement(s, { ...p, person: who(c) }, role(c)),
  ),
  reverseMovement: def(obj({ movementId: id, reason: str(1000) }), (s, p, c) =>
    D.reverseMovement(s, p.movementId, p.reason, who(c), role(c)),
  ),
  reviewLedger: def(obj({ ingredientId: id, note: str(1000), complete: z.boolean() }), (s, p, c) =>
    D.reviewLedger(s, p.ingredientId, p.note, who(c), p.complete, role(c)),
  ),
  savePolicy: def(
    obj({ ingredientId: id, minimum: qty, target: qty, enabled: z.boolean() }),
    (s, p, c) => D.savePolicy(s, { ...p, person: who(c) }, role(c)),
  ),
  createRequest: def(obj({ ingredientId: id }), (s, p, c) =>
    D.createRequest(s, p.ingredientId, who(c), role(c)),
  ),
  reviewRequest: def(
    obj({ requestId: id, qty, reason: str(1000).optional(), checked: z.boolean() }),
    (s, p, c) =>
      D.reviewRequest(
        s,
        p.requestId,
        { qty: p.qty, reason: p.reason, checked: p.checked, person: who(c) },
        role(c),
      ),
  ),
  refreshRequest: def(obj({ requestId: id }), (s, p, c) =>
    D.refreshRequest(s, p.requestId, who(c), role(c)),
  ),
  cancelRequest: def(obj({ requestId: id, reason: str(1000) }), (s, p, c) =>
    D.cancelRequest(s, p.requestId, p.reason, who(c), role(c)),
  ),

  // ── purchasing ──
  savePurchasePolicy: def(
    obj({
      currency,
      mode: z.enum(['all', 'above']),
      threshold: money.optional(),
      approverUserId: uuid,
      note: str(1000),
      checked: z.boolean(),
    }),
    async (s, p, c) => {
      const approver = await reviewerMember(c, p.approverUserId, 'ผู้อนุมัติ');
      return D.savePurchasePolicy(
        s,
        {
          currency: p.currency,
          mode: p.mode,
          threshold: p.threshold,
          approver: approver.displayName,
          approverRole: approver.role as D.ReviewerRole,
          note: p.note,
          checked: p.checked,
          person: who(c),
        },
        role(c),
      );
    },
  ),
  createOrder: def(obj({ requestId: id, currency }), (s, p, c) =>
    D.createOrder(s, p.requestId, p.currency, who(c), role(c)),
  ),
  reviewOrderSource: def(
    obj({ orderId: id, qty, reason: str(1000), checked: z.boolean() }),
    (s, p, c) =>
      D.reviewOrderSource(
        s,
        p.orderId,
        { qty: p.qty, reason: p.reason, checked: p.checked, person: who(c) },
        role(c),
      ),
  ),
  saveOffer: def(
    obj({
      orderId: id,
      offer: obj({
        id: id.optional(),
        vendor: str(200),
        packQty: qty,
        packPrice: money,
        shipping: money,
        extra: money,
        discount: money,
        source: str(1000),
        conditions: str(1000),
        quotedAt: str(40),
      }),
    }),
    (s, p, c) => D.saveOffer(s, p.orderId, { ...p.offer, person: who(c) }, role(c)),
  ),
  selectOffer: def(obj({ orderId: id, offerId: id, reason: str(1000) }), (s, p, c) =>
    D.selectOffer(s, p.orderId, p.offerId, p.reason, who(c), role(c)),
  ),
  submitOrder: def(obj({ orderId: id }), (s, p, c) => D.submitOrder(s, p.orderId, who(c), role(c))),
  decideOrder: def(
    obj({ orderId: id, decision: z.enum(['approve', 'return', 'reject']), reason: str(1000) }),
    (s, p, c) => D.decideOrder(s, p.orderId, p.decision, p.reason, who(c), role(c)),
  ),
  reviseOrder: def(obj({ orderId: id, reason: str(1000) }), (s, p, c) =>
    D.reviseOrder(s, p.orderId, p.reason, who(c), role(c)),
  ),
  cancelOrder: def(obj({ orderId: id, reason: str(1000) }), (s, p, c) =>
    D.cancelOrder(s, p.orderId, p.reason, who(c), role(c)),
  ),
  markOrdered: def(obj({ orderId: id, reference: str(200), checked: z.boolean() }), (s, p, c) =>
    D.markOrdered(
      s,
      p.orderId,
      { reference: p.reference, checked: p.checked, person: who(c) },
      role(c),
    ),
  ),

  // ── receiving ──
  saveReceipt: def(
    obj({
      orderId: id,
      receipt: obj({
        id: id.optional(),
        reference: str(200),
        accepted: qty,
        rejected: qty,
        issueType: str(20),
        note: str(1000),
      }),
    }),
    (s, p, c) => D.saveReceipt(s, p.orderId, { ...p.receipt, person: who(c) }, role(c)),
  ),
  confirmReceipt: def(
    obj({ receiptId: id, checked: z.boolean(), notCounted: z.boolean() }),
    (s, p, c) =>
      D.confirmReceipt(
        s,
        p.receiptId,
        { checked: p.checked, notCounted: p.notCounted, person: who(c) },
        role(c),
      ),
  ),
  cancelReceipt: def(obj({ receiptId: id, reason: str(1000) }), (s, p, c) =>
    D.cancelReceipt(s, p.receiptId, p.reason, who(c), role(c)),
  ),
  resolveReceiptIssue: def(obj({ receiptId: id, note: str(1000) }), (s, p, c) =>
    D.resolveReceiptIssue(s, p.receiptId, p.note, who(c), role(c)),
  ),
  closeReceiving: def(
    obj({
      orderId: id,
      reason: str(1000),
      checked: z.boolean(),
      closeShort: z.boolean().optional(),
    }),
    (s, p, c) => D.closeReceiving(s, p.orderId, { ...p, person: who(c) }, role(c)),
  ),

  // ── expenses ──
  saveExpenseReviewer: def(
    obj({ reviewerUserId: uuid, note: str(1000), checked: z.boolean() }),
    async (s, p, c) => {
      const reviewer = await reviewerMember(c, p.reviewerUserId, 'ผู้ตรวจค่าใช้จ่าย');
      return D.saveExpenseReviewer(
        s,
        {
          name: reviewer.displayName,
          role: reviewer.role as D.ReviewerRole,
          note: p.note,
          checked: p.checked,
          person: who(c),
        },
        role(c),
      );
    },
  ),
  saveExpense: def(
    obj({
      id: id.optional(),
      vendor: str(200),
      date: str(20),
      reference: str(200).optional(),
      amount: money,
      currency,
      category: z.enum(D.expenseCategories),
      funding: z.enum(['shop', 'personal']),
      payer: str(160),
      orderId: id.nullable().optional(),
      note: str(1000),
      /** undefined = keep the current file, null = remove, uuid = attach uploaded evidence */
      evidenceId: uuid.nullable().optional(),
      noEvidenceReason: str(1000).optional(),
    }),
    async (s, p, c) => {
      const { evidenceId, ...rest } = p;
      // Evidence is only for people allowed to record expenses — check before touching storage.
      if (!D.can(role(c), 'expense')) throw new D.DomainError('บทบาทนี้ไม่เปิดข้อมูลค่าใช้จ่าย');
      const attachment =
        evidenceId === undefined
          ? undefined
          : evidenceId === null
            ? null
            : await storedAttachment(c, evidenceId);
      return D.saveExpense(s, { ...rest, attachment, person: who(c) }, role(c));
    },
  ),
  submitExpense: def(obj({ expenseId: id }), (s, p, c) =>
    D.submitExpense(s, p.expenseId, who(c), role(c)),
  ),
  reviewExpense: def(
    obj({
      expenseId: id,
      decision: z.enum(['confirm', 'return']),
      note: str(1000),
      checked: z.boolean().optional(),
      exceptionsChecked: z.boolean().optional(),
    }),
    (s, p, c) =>
      D.reviewExpense(
        s,
        p.expenseId,
        {
          action: p.decision,
          note: p.note,
          checked: p.checked,
          exceptionsChecked: p.exceptionsChecked,
          person: who(c),
        },
        role(c),
      ),
  ),
  cancelExpense: def(obj({ expenseId: id, note: str(1000) }), (s, p, c) =>
    D.cancelExpense(s, p.expenseId, { note: p.note, person: who(c) }, role(c)),
  ),
} satisfies Record<string, ActionDef<z.ZodType>>;

export type ActionType = keyof typeof actions;
export type ActionPayload<T extends ActionType> = z.input<(typeof actions)[T]['schema']>;
export const actionTypes = Object.keys(actions) as ActionType[];
