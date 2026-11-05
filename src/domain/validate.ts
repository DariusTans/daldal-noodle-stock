/**
 * Whole-state invariants, one function per legacy layer (v1 master … v6 expenses).
 * `validateAt(s, level)` mirrors the legacy layered `validate` (used by migrations);
 * `validate(s)` is the v6 check that every public operation runs before and after.
 *
 * Inputs are untrusted (imports, backups), so the checks operate on `any`.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { assertValidPolicy, quoteTotal } from './buy.js';
import {
  ATTACHMENTS_TOTAL_MAX_BYTES,
  countStatuses,
  currencies,
  expenseCategories,
  expenseStatuses,
  ingredientCategories,
  movementKinds,
  orderStatuses,
  receiptIssues,
  roles,
  unitTypes,
} from './constants.js';
import { assertValidAttachment, isValidDate } from './expense.js';
import { can } from './permissions.js';
import { positiveQuantity } from './quantity.js';
import { orderedOrder, receivingSummary } from './receive.js';
import { movementsFor } from './stock.js';
import type { ShopState } from './types.js';
import { fail, hasOwn, isQuantity, isStamp, isText, normName, normRef, round3 } from './util.js';

type Level = 1 | 2 | 3 | 4 | 5 | 6;
const text = isText;
const stamp = isStamp;
const quantity = isQuantity;

function v1(s: any) {
  if (
    !s ||
    !Number.isInteger(s.revision) ||
    s.revision < 0 ||
    !Array.isArray(s.units) ||
    !Array.isArray(s.ingredients) ||
    !Array.isArray(s.events)
  )
    fail('รูปแบบข้อมูลหรือเวอร์ชันไม่รองรับ');
  if (s.units.length > 500 || s.ingredients.length > 5000 || s.events.length > 20000)
    fail('ไฟล์มีรายการเกินขนาดที่ต้นแบบรองรับ');
  const ids = new Set(),
    un = new Set(),
    us = new Set();
  for (const u of s.units) {
    if (
      !u ||
      ![u.id, u.name, u.symbol].every((v) => typeof v === 'string' && v.trim() && v.length <= 80) ||
      !(unitTypes as readonly string[]).includes(u.type) ||
      ids.has(u.id) ||
      un.has(normName(u.name)) ||
      us.has(normName(u.symbol))
    )
      fail('ข้อมูลหน่วยนับไม่ถูกต้องหรือซ้ำ');
    ids.add(u.id);
    un.add(normName(u.name));
    us.add(normName(u.symbol));
  }
  const ii = new Set(),
    codes = new Set(),
    names = new Set();
  for (const i of s.ingredients) {
    if (
      !i ||
      ![
        'id',
        'code',
        'name',
        'category',
        'unitId',
        'location',
        'note',
        'createdAt',
        'updatedAt',
      ].every((k) => typeof i[k] === 'string') ||
      !i.id ||
      !i.name.trim() ||
      i.name.length > 100 ||
      !i.code ||
      i.code.length > 30 ||
      i.location.length > 100 ||
      i.note.length > 500 ||
      !(ingredientCategories as readonly string[]).includes(i.category) ||
      !ids.has(i.unitId) ||
      typeof i.active !== 'boolean' ||
      ii.has(i.id) ||
      codes.has(normName(i.code)) ||
      names.has(normName(i.name)) ||
      !Number.isFinite(Date.parse(i.createdAt)) ||
      !Number.isFinite(Date.parse(i.updatedAt))
    )
      fail('ข้อมูลวัตถุดิบไม่ถูกต้อง ซ้ำ หรืออ้างอิงหน่วยที่ไม่มี');
    ii.add(i.id);
    codes.add(normName(i.code));
    names.add(normName(i.name));
  }
  for (const e of s.events)
    if (
      !e ||
      !['id', 'target', 'action', 'actor', 'time'].every((k) => typeof e[k] === 'string') ||
      !Number.isFinite(Date.parse(e.time))
    )
      fail('ประวัติรายการไม่ถูกต้อง');
}

function v2(s: any) {
  if (!Array.isArray(s.countRounds) || s.countRounds.length > 2000) fail('ข้อมูลรอบนับไม่ถูกต้อง');
  const ids = new Set();
  let open = 0;
  for (const r of s.countRounds) {
    if (
      !r ||
      !text(r.id, 100) ||
      ids.has(r.id) ||
      !text(r.title, 100) ||
      !text(r.createdBy, 80) ||
      !(countStatuses as readonly string[]).includes(r.status) ||
      !stamp(r.createdAt) ||
      !Array.isArray(r.lines) ||
      !r.lines.length ||
      r.lines.length > 5000 ||
      !Array.isArray(r.audit) ||
      r.audit.length > 20000
    )
      fail('ข้อมูลรอบนับไม่ครบหรือซ้ำ');
    ids.add(r.id);
    if (['draft', 'review'].includes(r.status)) open++;
    const lineIds = new Set();
    for (const l of r.lines) {
      if (
        !l ||
        !text(l.ingredientId, 100) ||
        lineIds.has(l.ingredientId) ||
        !s.ingredients.some((i: any) => i.id === l.ingredientId) ||
        !text(l.name, 100) ||
        !text(l.code, 30) ||
        !text(l.unitId, 100) ||
        !s.units.some((u: any) => u.id === l.unitId) ||
        !text(l.unitName, 80) ||
        !text(l.unitSymbol, 80) ||
        typeof l.location !== 'string' ||
        typeof l.reason !== 'string' ||
        l.reason.length > 500 ||
        !(l.qty === null || quantity(l.qty)) ||
        !(l.previousQty === null || quantity(l.previousQty))
      )
        fail('ข้อมูลรายการนับไม่ถูกต้อง');
      lineIds.add(l.ingredientId);
      if (l.qty !== null && (!stamp(l.countedAt) || !text(l.countedBy, 80)))
        fail('รายการนับขาดเวลา/ผู้บันทึก');
      if (l.qty === null && (l.countedAt !== null || l.countedBy !== null))
        fail('รายการยังไม่นับต้องไม่มีเวลานับ');
      if (l.previousQty !== null && (!stamp(l.previousAt) || !text(l.previousRoundId, 100)))
        fail('ยอดเปรียบเทียบไม่มีที่มา');
      if (['review', 'confirmed'].includes(r.status) && l.qty === null)
        fail('รอบที่ส่งตรวจต้องนับครบ');
      if (
        ['review', 'confirmed'].includes(r.status) &&
        (l.expectedQty ?? l.previousQty) !== null &&
        (l.expectedQty ?? l.previousQty) !== l.qty &&
        !l.reason.trim()
      )
        fail('รายการส่วนต่างขาดคำอธิบาย');
    }
    if (
      ['review', 'confirmed'].includes(r.status) &&
      (!stamp(r.submittedAt) || !text(r.submittedBy, 80))
    )
      fail('ขาดผู้ส่งตรวจ');
    if (r.status === 'confirmed' && (!stamp(r.confirmedAt) || !text(r.confirmedBy, 80)))
      fail('ขาดข้อมูลการยืนยัน');
    if (r.status === 'cancelled' && (!stamp(r.cancelledAt) || !text(r.cancelReason, 500)))
      fail('ขาดเหตุผลยกเลิก');
    for (const a of r.audit) {
      if (
        !a ||
        !stamp(a.time) ||
        !text(a.action, 100) ||
        !text(a.person, 80) ||
        !hasOwn(roles, a.role)
      )
        fail('ประวัติรอบนับไม่ถูกต้อง');
      if (a.changes !== undefined) {
        if (!Array.isArray(a.changes)) fail('ประวัติการแก้ไขไม่ถูกต้อง');
        for (const ch of a.changes)
          if (
            !ch ||
            !lineIds.has(ch.ingredientId) ||
            !(ch.before === null || quantity(ch.before)) ||
            !(ch.after === null || quantity(ch.after)) ||
            typeof ch.reason !== 'string' ||
            ch.reason.length > 500
          )
            fail('ประวัติแก้ยอดไม่ถูกต้อง');
      }
    }
  }
  if (open > 1) fail('เปิดรอบนับพร้อมกันได้หนึ่งรอบ');
}

function v3(s: any) {
  for (const key of ['movements', 'stockChecks', 'stockPolicies', 'purchaseRequests', 'stockAudit'])
    if (!Array.isArray(s[key]) || s[key].length > 20000) fail('ข้อมูลสต็อกไม่ถูกต้องหรือเกินขนาด');
  const unique = new Set(),
    take = (o: any) => {
      if (!o || !text(o.id, 100) || unique.has(o.id)) fail('รหัสรายการสต็อกซ้ำหรือไม่ถูกต้อง');
      unique.add(o.id);
    },
    ingredient = (id: string) => s.ingredients.find((i: any) => i.id === id),
    baseline = (i: string, r: string) =>
      s.countRounds
        .find((c: any) => c.id === r && c.status === 'confirmed')
        ?.lines.find((l: any) => l.ingredientId === i),
    actor = (o: any) => text(o.person, 80) && stamp(o.at) && hasOwn(roles, o.role);
  const balances = new Map<string, number>(),
    seen = new Map<string, any>(),
    reversed = new Set();
  for (const m of s.movements) {
    take(m);
    const b = baseline(m.ingredientId, m.roundId);
    if (
      !b ||
      !ingredient(m.ingredientId) ||
      m.unitId !== b.unitId ||
      !text(m.name, 100) ||
      !text(m.unitSymbol, 80) ||
      !actor(m) ||
      !text(m.reason) ||
      typeof m.reference !== 'string' ||
      m.reference.length > 100 ||
      !hasOwn(movementKinds, m.kind) ||
      !can(m.role, ['increase', 'decrease', 'reverse'].includes(m.kind) ? 'adjust' : 'movement') ||
      !quantity(m.qty) ||
      m.qty === 0 ||
      !Number.isFinite(m.delta) ||
      Math.abs(m.delta) !== m.qty
    )
      fail('ข้อมูลเคลื่อนไหวไม่ถูกต้อง');
    if (m.kind === 'reverse') {
      const orig = seen.get(m.reverseOf);
      if (
        !orig ||
        orig.kind === 'reverse' ||
        reversed.has(orig.id) ||
        orig.ingredientId !== m.ingredientId ||
        orig.roundId !== m.roundId ||
        orig.delta !== -m.delta
      )
        fail('ข้อมูลกลับรายการไม่ถูกต้อง');
      reversed.add(orig.id);
    } else if (
      m.delta !== (m.kind === 'receive' || m.kind === 'increase' ? m.qty : -m.qty) ||
      m.reverseOf !== null
    )
      fail('ทิศทางเคลื่อนไหวไม่ถูกต้อง');
    const key = m.ingredientId + '|' + m.roundId,
      balance = round3((balances.get(key) ?? b.qty) + m.delta);
    if (!quantity(balance)) fail('ยอดตามรายการติดลบหรือเกินขนาด');
    balances.set(key, balance);
    seen.set(m.id, m);
  }
  for (const c of s.stockChecks) {
    take(c);
    if (
      !baseline(c.ingredientId, c.roundId) ||
      !actor(c) ||
      !can(c.role, 'stockReview') ||
      c.complete !== true ||
      typeof c.movementIds !== 'string' ||
      !text(c.note)
    )
      fail('ข้อมูลตรวจความครบไม่ถูกต้อง');
    const all = movementsFor(s, c.ingredientId, c.roundId).map((m) => m.id),
      checked: string[] = c.movementIds ? c.movementIds.split('|') : [];
    if (checked.some((id, i) => id !== all[i]) || checked.length > all.length)
      fail('รายการอ้างอิงการตรวจไม่ถูกต้อง');
  }
  const policies = new Set();
  for (const p of s.stockPolicies) {
    take(p);
    if (
      !ingredient(p.ingredientId) ||
      policies.has(p.ingredientId) ||
      p.unitId !== ingredient(p.ingredientId).unitId ||
      !quantity(p.minimum) ||
      !quantity(p.target) ||
      p.target <= p.minimum ||
      typeof p.enabled !== 'boolean' ||
      !actor(p) ||
      !can(p.role, 'policy')
    )
      fail('จุดเตือนหรือยอดเป้าหมายไม่ถูกต้อง');
    policies.add(p.ingredientId);
  }
  const pending = new Set();
  for (const p of s.purchaseRequests) {
    take(p);
    if (
      !ingredient(p.ingredientId) ||
      !baseline(p.ingredientId, p.roundId) ||
      !['draft', 'ready', 'cancelled', 'completed'].includes(p.status) ||
      !quantity(p.qty) ||
      p.qty === 0 ||
      !quantity(p.suggested) ||
      p.suggested === 0 ||
      !quantity(p.referenceQty) ||
      !['count', 'ledger'].includes(p.referenceBasis) ||
      !text(p.name, 100) ||
      !text(p.unitSymbol, 80) ||
      !stamp(p.referenceAt) ||
      !text(p.fingerprint, 100000) ||
      !actor(p) ||
      typeof p.reason !== 'string' ||
      p.reason.length > 500
    )
      fail('รายการเสนอซื้อไม่ถูกต้อง');
    if (!['cancelled', 'completed'].includes(p.status)) {
      if (pending.has(p.ingredientId)) fail('มีรายการเสนอซื้อซ้ำ');
      pending.add(p.ingredientId);
    }
    if (
      ['ready', 'completed'].includes(p.status) &&
      (!text(p.reviewedBy, 80) || !stamp(p.reviewedAt) || !can(p.reviewedRole, 'requestReview'))
    )
      fail('รายการเสนอซื้อขาดผู้ตรวจ');
    if (p.status === 'cancelled' && (!text(p.cancelReason) || !stamp(p.cancelledAt)))
      fail('รายการเสนอซื้อขาดเหตุผลยกเลิก');
  }
  for (const a of s.stockAudit) {
    take(a);
    if (!actor(a) || !text(a.action, 100) || !text(a.target, 100)) fail('ประวัติสต็อกไม่ถูกต้อง');
  }
  for (const r of s.countRounds)
    for (const l of r.lines)
      if (l.expectedQty !== undefined && l.expectedQty !== null) {
        if (!quantity(l.expectedQty) || !stamp(l.expectedAt) || !text(l.expectedBy, 80))
          fail('ยอดคาดหมายรอบนับไม่ถูกต้อง');
      }
}

function v4(s: any) {
  if (
    !Array.isArray(s.purchaseOrders) ||
    s.purchaseOrders.length > 5000 ||
    !Array.isArray(s.purchasePolicyAudit) ||
    s.purchasePolicyAudit.length > 2000
  )
    fail('ข้อมูลจัดซื้อไม่ถูกต้อง');
  if (s.purchasePolicy) assertValidPolicy(s.purchasePolicy);
  const globalIds = new Set(),
    active = new Set();
  for (const p of s.purchasePolicyAudit) assertValidPolicy(p);
  for (const o of s.purchaseOrders) {
    const p = s.purchaseRequests.find((p: any) => p.id === o.requestId);
    if (
      !o ||
      !p ||
      o.ingredientId !== p.ingredientId ||
      !text(o.id, 100) ||
      globalIds.has(o.id) ||
      !text(o.name, 100) ||
      !text(o.unitSymbol, 80) ||
      !text(o.unitId, 100) ||
      o.unitId !== s.ingredients.find((i: any) => i.id === o.ingredientId)?.unitId ||
      !hasOwn(orderStatuses, o.status) ||
      !currencies.includes(o.currency) ||
      !text(o.person, 80) ||
      !stamp(o.at) ||
      !hasOwn(roles, o.role) ||
      !Array.isArray(o.offers) ||
      o.offers.length > 30 ||
      !Array.isArray(o.audit) ||
      o.audit.length > 2000 ||
      !text(o.sourceFingerprint, 100000) ||
      !text(o.sourceCheckedBy, 80) ||
      !stamp(o.sourceCheckedAt) ||
      typeof o.sourceReason !== 'string' ||
      o.sourceReason.length > 500
    )
      fail('ข้อมูลใบจัดซื้อไม่ครบหรือซ้ำ');
    if (typeof o.qty !== 'number') fail('จำนวนซื้อไม่ถูกต้อง');
    positiveQuantity(o.qty);
    globalIds.add(o.id);
    if (!['rejected', 'cancelled'].includes(o.status)) {
      if (
        active.has(o.requestId) ||
        (p.status !== 'ready' &&
          !(
            p.status === 'completed' &&
            p.completedOrderId === o.id &&
            o.receiving?.status === 'closed'
          ))
      )
        fail('ใบจัดซื้อซ้ำหรือรายการต้นทางไม่พร้อม');
      active.add(o.requestId);
    }
    const ids = new Set();
    for (const f of o.offers) {
      if (
        !f ||
        !text(f.id, 100) ||
        ids.has(f.id) ||
        !text(f.vendor, 100) ||
        !text(f.source, 500) ||
        !text(f.conditions, 500) ||
        !stamp(f.quotedAt) ||
        !stamp(f.at) ||
        !text(f.person, 80) ||
        f.currency !== o.currency
      )
        fail('ทางเลือกซื้อไม่ถูกต้อง');
      ids.add(f.id);
      if (typeof f.packQty !== 'number') fail('ขนาดแพ็กไม่ถูกต้อง');
      positiveQuantity(f.packQty);
      for (const key of ['packPrice', 'shipping', 'extra', 'discount'])
        if (!Number.isSafeInteger(f[key]) || f[key] < 0 || f[key] > 1e11) fail('ราคาไม่ถูกต้อง');
      quoteTotal(o, f);
    }
    if (o.selectedId !== null && !ids.has(o.selectedId)) fail('ไม่พบทางเลือกที่เลือก');
    if (o.selectedId && !text(o.selectionReason)) fail('ขาดเหตุผลเลือกแหล่งซื้อ');
    const selected = () => o.offers.find((f: any) => f.id === o.selectedId);
    if (['pending', 'approved', 'cleared', 'ordered'].includes(o.status)) {
      if (!o.selectedId || !text(o.submittedBy, 80) || !stamp(o.submittedAt) || !o.policySnapshot)
        fail('ขาดรายละเอียดส่งตรวจ');
      assertValidPolicy(o.policySnapshot);
      if (o.policySnapshot.currency !== o.currency) fail('สกุลเงินเกณฑ์ไม่ตรง');
    }
    if (['approved', 'cleared', 'ordered'].includes(o.status)) {
      if (
        !o.decision ||
        !text(o.decision.person, 80) ||
        !stamp(o.decision.at) ||
        !text(o.decision.reason) ||
        o.decision.role !== o.policySnapshot.approverRole ||
        o.decision.person !== o.policySnapshot.approver ||
        o.decision.total !== quoteTotal(o, selected()).total ||
        o.decision.qty !== o.qty ||
        JSON.stringify(o.decision.offer) !== JSON.stringify(selected()) ||
        o.decision.selectedId !== o.selectedId ||
        o.decision.sourceFingerprint !== o.sourceFingerprint
      )
        fail('ข้อมูลอนุมัติไม่ตรงกับรายการ');
      const needs =
        o.policySnapshot.mode === 'all' || o.decision.total > o.policySnapshot.threshold;
      if (
        o.decision.type !== (needs ? 'approve' : 'clear') ||
        (o.status !== 'ordered' && o.status !== (needs ? 'approved' : 'cleared'))
      )
        fail('ผลอนุมัติไม่ตรงเกณฑ์');
    }
    if (
      o.status === 'ordered' &&
      (!o.purchase ||
        !text(o.purchase.reference, 100) ||
        !text(o.purchase.person, 80) ||
        !stamp(o.purchase.at) ||
        o.purchase.total !== o.decision.total ||
        o.purchase.qty !== o.qty ||
        o.purchase.orderedQty !== quoteTotal(o, o.purchase.offer).units ||
        o.purchase.packCount !== quoteTotal(o, o.purchase.offer).packs ||
        JSON.stringify(o.purchase.offer) !== JSON.stringify(selected()))
    )
      fail('ขาดหลักฐานบันทึกการซื้อ');
    for (const a of o.audit)
      if (
        !a ||
        !text(a.action, 100) ||
        !text(a.person, 80) ||
        !hasOwn(roles, a.role) ||
        !stamp(a.at)
      )
        fail('ประวัติจัดซื้อไม่ถูกต้อง');
  }
}

function v5(s: any) {
  if (!Array.isArray(s.receipts) || s.receipts.length > 20000) fail('ข้อมูลตรวจรับไม่ถูกต้อง');
  const ids = new Set(),
    refs = new Set(),
    drafts = new Set(),
    links = new Set();
  for (const r of s.receipts) {
    if (
      !r ||
      !text(r.id, 100) ||
      ids.has(r.id) ||
      !['draft', 'confirmed', 'void', 'cancelled'].includes(r.status) ||
      !text(r.reference, 100) ||
      !text(r.person, 80) ||
      !can(r.role, 'receive') ||
      !stamp(r.at) ||
      !quantity(r.accepted) ||
      !quantity(r.rejected) ||
      r.accepted + r.rejected <= 0 ||
      !hasOwn(receiptIssues, r.issueType) ||
      !text(r.note) ||
      (r.rejected > 0 && r.issueType === 'none')
    )
      fail('ข้อมูลใบรับไม่ครบหรือซ้ำ');
    ids.add(r.id);
    const o = orderedOrder(s, r.orderId);
    if (
      r.ingredientId !== o.ingredientId ||
      r.unitId !== o.unitId ||
      !s.countRounds.some(
        (c: any) =>
          c.id === r.baseRoundId &&
          c.status === 'confirmed' &&
          c.lines.some((l: any) => l.ingredientId === r.ingredientId),
      )
    )
      fail('ใบรับอ้างอิงข้อมูลไม่ถูกต้อง');
    if (['draft', 'confirmed'].includes(r.status)) {
      const ref = r.orderId + '|' + normRef(r.reference);
      if (refs.has(ref)) fail('เลขส่งของซ้ำในใบจัดซื้อ');
      refs.add(ref);
    }
    if (r.status === 'draft') {
      if (drafts.has(r.orderId) || o.receiving?.status === 'closed' || r.movementId !== null)
        fail('ร่างรับซ้ำหรือใบปิดแล้ว');
      drafts.add(r.orderId);
    }
    if (['confirmed', 'void'].includes(r.status)) {
      if (
        !text(r.confirmedBy, 80) ||
        !stamp(r.confirmedAt) ||
        !can(r.confirmedRole, 'receiveReview') ||
        r.notCounted !== true
      )
        fail('ใบรับขาดผู้ยืนยัน');
      const m = s.movements.find((m: any) => m.id === r.movementId);
      if (r.accepted > 0) {
        if (
          !m ||
          m.kind !== 'receive' ||
          m.qty !== r.accepted ||
          m.ingredientId !== r.ingredientId ||
          m.roundId !== r.baseRoundId ||
          m.unitId !== r.unitId ||
          m.receiptId !== r.id ||
          m.purchaseOrderId !== r.orderId ||
          links.has(m.id)
        )
          fail('ยอดรับไม่ตรงรายการเคลื่อนไหว');
        links.add(m.id);
        const reversals = s.movements.filter((v: any) => v.reverseOf === m.id);
        if (
          (r.status === 'confirmed' && reversals.length) ||
          (r.status === 'void' &&
            (reversals.length !== 1 ||
              reversals[0].id !== r.reversalId ||
              reversals[0].receiptId !== r.id))
        )
          fail('สถานะรับไม่ตรงการกลับรายการ');
      } else if (r.movementId !== null || r.reversalId) fail('ไม่มีจำนวนรับแต่มีเคลื่อนไหว');
    } else if (r.movementId !== null) fail('ร่างหรือยกเลิกต้องไม่เพิ่มสต็อก');
    if (
      ['void', 'cancelled'].includes(r.status) &&
      (!text(r.cancelReason) ||
        !text(r.cancelledBy, 80) ||
        !stamp(r.cancelledAt) ||
        !can(r.cancelledRole, r.status === 'void' ? 'receiveReview' : 'receive'))
    )
      fail('ขาดเหตุผลยกเลิกใบรับ');
    if (
      r.resolution &&
      (!text(r.resolution.note) ||
        !text(r.resolution.person, 80) ||
        !stamp(r.resolution.at) ||
        !can(r.resolution.role, 'receiveReview'))
    )
      fail('ข้อมูลแก้ปัญหาไม่ถูกต้อง');
  }
  for (const m of s.movements)
    if (m.receiptId) {
      const r = s.receipts.find((r: any) => r.id === m.receiptId);
      if (
        !r ||
        !['confirmed', 'void'].includes(r.status) ||
        ![r.movementId, r.reversalId].includes(m.id) ||
        m.purchaseOrderId !== r.orderId
      )
        fail('เคลื่อนไหวไม่มีใบรับที่ตรงกัน');
    }
  for (const o of s.purchaseOrders)
    if (o.status === 'ordered') {
      const v = receivingSummary(s, o);
      if (!quantity(v.remaining) || o.purchase.receivedQty !== v.accepted)
        fail('ยอดรวมรับไม่ตรงหรือรับเกินที่ซื้อ');
      if (o.receiving && !['open', 'closed'].includes(o.receiving.status))
        fail('สถานะรับไม่ถูกต้อง');
      if (v.closed) {
        const c = o.receiving,
          p = s.purchaseRequests.find((p: any) => p.id === o.requestId);
        if (
          v.draft ||
          v.issues.length ||
          !text(c.reason) ||
          !text(c.person, 80) ||
          !stamp(c.at) ||
          !can(c.role, 'receiveReview') ||
          c.accepted !== v.accepted ||
          c.unreceived !== v.remaining ||
          p.status !== 'completed' ||
          p.completedOrderId !== o.id ||
          p.completedAt !== c.at
        )
          fail('ข้อมูลปิดรับไม่ครบ');
      }
    }
  for (const p of s.purchaseRequests)
    if (
      p.status === 'completed' &&
      !s.purchaseOrders.some(
        (o: any) =>
          o.id === p.completedOrderId && o.requestId === p.id && o.receiving?.status === 'closed',
      )
    )
      fail('รายการเสนอซื้อปิดโดยไม่มีงานรับ');
}

function v6(s: any) {
  if (!Array.isArray(s.expenses) || s.expenses.length > 10000) fail('ข้อมูลค่าใช้จ่ายไม่ถูกต้อง');
  const p = s.expenseReviewer;
  if (
    p &&
    (!text(p.id, 100) ||
      !text(p.name, 80) ||
      !['owner', 'manager'].includes(p.role) ||
      !text(p.note) ||
      !stamp(p.at) ||
      !text(p.person, 80))
  )
    fail('ผู้ตรวจค่าใช้จ่ายไม่ถูกต้อง');
  let bytes = 0;
  const ids = new Set();
  for (const e of s.expenses) {
    if (
      !e ||
      !text(e.id, 100) ||
      ids.has(e.id) ||
      !hasOwn(expenseStatuses, e.status) ||
      !text(e.vendor, 100) ||
      !isValidDate(e.date) ||
      !currencies.includes(e.currency) ||
      !Number.isSafeInteger(e.amount) ||
      e.amount <= 0 ||
      e.amount > 99999999999 ||
      !(expenseCategories as readonly string[]).includes(e.category) ||
      !['shop', 'personal'].includes(e.funding) ||
      !text(e.payer, 80) ||
      typeof e.reference !== 'string' ||
      e.reference.length > 100 ||
      !text(e.note) ||
      !text(e.person, 80) ||
      !can(e.role, 'expense') ||
      !stamp(e.at) ||
      !Array.isArray(e.audit)
    )
      fail('ข้อมูลค่าใช้จ่ายไม่ครบหรือซ้ำ');
    ids.add(e.id);
    if (
      e.orderId &&
      !s.purchaseOrders.some((o: any) => o.id === e.orderId && o.status === 'ordered')
    )
      fail('ใบซื้ออ้างอิงไม่ถูกต้อง');
    if (e.attachment) {
      assertValidAttachment(e.attachment);
      // Only inline (data URL) evidence counts toward the in-document size budget.
      if (typeof e.attachment.data === 'string') bytes += e.attachment.size;
    } else if (!text(e.noEvidenceReason)) fail('ระบุเหตุผลที่ไม่มีหลักฐาน');
    for (const a of e.audit)
      if (
        !text(a.action, 100) ||
        !text(a.person, 80) ||
        !can(a.role, 'expense') ||
        !stamp(a.at) ||
        !text(a.note)
      )
        fail('ประวัติค่าใช้จ่ายไม่ครบ');
    if (
      ['pending', 'confirmed'].includes(e.status) &&
      (!e.reviewPolicy ||
        !text(e.reviewPolicy.id, 100) ||
        !text(e.reviewPolicy.name, 80) ||
        !can(e.reviewPolicy.role, 'expense'))
    )
      fail('ขาดเกณฑ์ผู้ตรวจ');
    if (
      e.status === 'confirmed' &&
      (!e.review ||
        e.review.person !== e.reviewPolicy.name ||
        e.review.role !== e.reviewPolicy.role ||
        !stamp(e.review.at) ||
        !text(e.review.note) ||
        e.review.checked !== true ||
        !Array.isArray(e.review.warnings))
    )
      fail('รายการยืนยันขาดผลตรวจ');
    if (e.status === 'returned' && !text(e.feedback)) fail('ขาดเหตุผลส่งกลับ');
    if (e.status === 'cancelled' && !text(e.cancelReason)) fail('ขาดเหตุผลยกเลิก');
  }
  if (bytes > ATTACHMENTS_TOTAL_MAX_BYTES)
    fail('หลักฐานรวมเกิน 1.4 MB สำหรับต้นแบบ กรุณาใช้ไฟล์เล็กลง');
}

const LAYERS = [v1, v2, v3, v4, v5, v6] as const;

/** Legacy layered validation at a given schema version (used by migrations). */
export function validateAt(s: unknown, level: Level): true {
  if (!s || (s as { schemaVersion?: unknown }).schemaVersion !== level)
    fail(level === 6 ? 'เวอร์ชันข้อมูลไม่รองรับ' : 'รูปแบบข้อมูลหรือเวอร์ชันไม่รองรับ');
  for (let i = 0; i < level; i++) LAYERS[i]!(s);
  return true;
}

/** Full v6 invariant check. Throws DomainError with a Thai message on the first violation. */
export function validate(s: unknown): asserts s is ShopState {
  validateAt(s, 6);
}
