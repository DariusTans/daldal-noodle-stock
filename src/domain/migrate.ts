/**
 * Upgrade any prototype backup (schemaVersion 1–6) to v6, validating at every step
 * exactly like the legacy layered `migrate`. Never mutates the input.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ShopState } from './types.js';
import { clone, fail } from './util.js';
import { validateAt } from './validate.js';

function toV2(input: any): any {
  if (input?.schemaVersion === 1) {
    validateAt(input, 1);
    const s = clone(input);
    s.schemaVersion = 2;
    s.countRounds = [];
    validateAt(s, 2);
    return s;
  }
  validateAt(input, 2);
  return clone(input);
}

function toV3(input: any): any {
  if (input?.schemaVersion === 1 || input?.schemaVersion === 2) {
    const s = toV2(input);
    Object.assign(s, {
      schemaVersion: 3,
      movements: [],
      stockChecks: [],
      stockPolicies: [],
      purchaseRequests: [],
      stockAudit: [],
    });
    validateAt(s, 3);
    return s;
  }
  validateAt(input, 3);
  return clone(input);
}

function toV4(input: any): any {
  if ([1, 2, 3].includes(input?.schemaVersion)) {
    const s = toV3(input);
    Object.assign(s, {
      schemaVersion: 4,
      purchaseOrders: [],
      purchasePolicy: null,
      purchasePolicyAudit: [],
    });
    validateAt(s, 4);
    return s;
  }
  validateAt(input, 4);
  return clone(input);
}

function toV5(input: any): any {
  if ([1, 2, 3, 4].includes(input?.schemaVersion)) {
    const s = toV4(input);
    s.schemaVersion = 5;
    s.receipts = [];
    for (const o of s.purchaseOrders)
      if (o.status === 'ordered') {
        if (o.purchase.receivedQty !== 0) fail('ข้อมูลรุ่นเดิมมียอดรับที่ไม่รู้ที่มา ห้ามรีเซ็ต');
        o.receiving = { status: 'open' };
      }
    validateAt(s, 5);
    return s;
  }
  validateAt(input, 5);
  return clone(input);
}

export function migrate(input: unknown): ShopState {
  const i = input as any;
  if ([1, 2, 3, 4, 5].includes(i?.schemaVersion)) {
    const s = toV5(i);
    Object.assign(s, { schemaVersion: 6, expenses: [], expenseReviewer: null });
    validateAt(s, 6);
    return s;
  }
  validateAt(i, 6);
  return clone(i);
}
