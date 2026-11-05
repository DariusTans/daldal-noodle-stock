/**
 * "Today's work" list (legacy workflow-core.js) — derived purely from document states,
 * there is no separate task store.
 */
import { orderStatuses, expenseStatuses, roles } from './constants.js';
import { receivingLabel, receivingSummary } from './receive.js';
import { stockRows } from './stock.js';
import type { Role, ShopState } from './types.js';

export interface WorkflowTask {
  key: string;
  title: string;
  status: string;
  who: string;
  page: string;
  id: string;
  action: string;
  /** Whether the current role can act on it. */
  can: boolean;
  /** What has already happened (context line). */
  done: string;
}

export function workflowTasks(s: ShopState, role: Role): WorkflowTask[] {
  const tasks: WorkflowTask[] = [],
    manager = ['owner', 'manager'].includes(role),
    add = (
      key: string,
      title: string,
      status: string,
      who: string,
      page: string,
      id: string,
      action = '',
      can = true,
      done = '',
    ) => tasks.push({ key, title, status, who, page, id, action, can, done });
  const open = s.countRounds.find((r) => ['draft', 'review'].includes(r.status));
  if (open)
    add(
      'count:' + open.id,
      open.title,
      open.status === 'draft' ? 'ร่างนับค้าง' : 'รอตรวจยอด',
      open.status === 'draft' ? 'พนักงาน / ผู้จัดการ' : 'ผู้จัดการ / เจ้าของ',
      'counting',
      open.id,
      '',
      open.status === 'draft' || manager,
      open.status === 'review' ? 'ส่งยอดนับแล้ว' : 'เปิดรอบนับแล้ว',
    );
  if (!open) {
    for (const r of stockRows(s).filter((r) => r.active)) {
      if (r.base && !r.check && r.movements.length)
        add(
          'check:' + r.id,
          r.name,
          'ตรวจเคลื่อนไหวก่อนใช้ยอดใหม่',
          'ผู้จัดการ / เจ้าของ',
          'movements',
          r.id,
          'check',
          manager,
          'มีรายการใหม่ · ยอดคำนวณ ' +
            r.ledger +
            ' ' +
            r.unit.symbol +
            ' / อ้างอิงยัง ' +
            r.referenceQty,
        );
      if (
        r.low &&
        !s.purchaseRequests.some(
          (p) => p.ingredientId === r.id && !['cancelled', 'completed'].includes(p.status),
        )
      )
        add(
          'low:' + r.id,
          r.name,
          'เสนอซื้อจากยอดอ้างอิง ' + r.referenceQty + ' ' + r.unit.symbol,
          'พนักงาน / ผู้จัดการ',
          'alerts',
          r.id,
          'propose',
          true,
          'เข้าเกณฑ์เตือนซื้อ',
        );
    }
  }
  for (const p of s.purchaseRequests.filter((p) => ['draft', 'ready'].includes(p.status))) {
    const o = s.purchaseOrders.find(
      (o) => o.requestId === p.id && !['cancelled', 'rejected'].includes(o.status),
    );
    if (!o)
      add(
        'request:' + p.id,
        p.name,
        p.status === 'draft' ? 'รอตรวจจำนวน' : 'รอเปิดใบจัดซื้อ',
        'ผู้จัดการ / เจ้าของ',
        p.status === 'draft' ? 'alerts' : 'buy',
        p.id,
        p.status === 'draft' ? 'request' : 'create',
        manager,
        p.status === 'draft' ? 'บันทึกร่างเสนอซื้อแล้ว' : 'ตรวจจำนวนแล้ว',
      );
  }
  for (const o of s.purchaseOrders) {
    if (['cancelled', 'rejected'].includes(o.status)) continue;
    if (o.status !== 'ordered') {
      if (manager)
        add(
          'buy:' + o.id,
          o.name,
          orderStatuses[o.status],
          o.status === 'pending'
            ? s.purchasePolicy
              ? `${s.purchasePolicy.approver} (${roles[s.purchasePolicy.approverRole]})`
              : 'เจ้าของต้องตั้งผู้อนุมัติ'
            : 'ผู้จัดการ / เจ้าของ',
          'buy',
          o.id,
          '',
          o.status !== 'pending' || s.purchasePolicy?.approverRole === role,
          o.status === 'pending'
            ? 'ส่งพิจารณาแล้ว'
            : o.status === 'approved' || o.status === 'cleared'
              ? 'ผ่านพิจารณาแล้ว'
              : 'เปิดใบจัดซื้อแล้ว',
        );
      continue;
    }
    const v = receivingSummary(s, o);
    if (!v.closed)
      add(
        'receive:' + o.id,
        o.name,
        receivingLabel(s, o),
        v.draft ? 'ผู้จัดการ / เจ้าของ' : 'พนักงานร่างรับ · ผู้จัดการยืนยัน',
        'receiving',
        o.id,
        '',
        !v.draft || manager,
        'บันทึกซื้อแล้ว · ค้างรับ ' + v.remaining + ' ' + o.unitSymbol,
      );
    if (manager && !s.expenses.some((e) => e.orderId === o.id && e.status !== 'cancelled'))
      add(
        'bill:' + o.id,
        o.name,
        'รอบันทึกบิลเมื่อมีหลักฐาน',
        'ผู้จัดการ / เจ้าของ',
        'expenses',
        o.id,
        'create',
        true,
        'ใบซื้อ ' + o.purchase!.reference + ' · ' + receivingLabel(s, o),
      );
  }
  if (manager)
    for (const e of s.expenses.filter((e) => ['draft', 'pending', 'returned'].includes(e.status)))
      add(
        'expense:' + e.id,
        e.vendor,
        expenseStatuses[e.status],
        e.status === 'pending'
          ? s.expenseReviewer
            ? `${s.expenseReviewer.name} (${roles[s.expenseReviewer.role]})`
            : 'เจ้าของต้องตั้งผู้ตรวจ'
          : 'ผู้จัดการ / เจ้าของ',
        'expenses',
        e.id,
        '',
        e.status !== 'pending' || s.expenseReviewer?.role === role,
        e.status === 'returned' ? 'ผู้ตรวจส่งกลับแก้ไข' : 'บันทึกค่าใช้จ่ายแล้ว',
      );
  return tasks;
}
