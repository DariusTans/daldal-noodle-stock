import type { ShopState } from './types';

/** Starter shop: 6 units and 8 sample ingredients (the 8th inactive), no history. */
export function seed(): ShopState {
  const now = '2026-10-13T00:00:00.000Z';
  return {
    schemaVersion: 6,
    revision: 0,
    units: (
      [
        ['u-pack', 'แพ็ก', 'แพ็ก', 'จำนวน'],
        ['u-egg', 'ฟอง', 'ฟอง', 'จำนวน'],
        ['u-kg', 'กิโลกรัม', 'กก.', 'น้ำหนัก'],
        ['u-bottle', 'ขวด', 'ขวด', 'จำนวน'],
        ['u-bag', 'ถุง', 'ถุง', 'จำนวน'],
        ['u-piece', 'ชิ้น', 'ชิ้น', 'จำนวน'],
      ] as const
    ).map(([id, name, symbol, type]) => ({ id, name, symbol, type })),
    ingredients: (
      [
        ['i-1', 'DD-001', 'เส้นรามยอน', 'เส้นและแป้ง', 'u-pack', 'ชั้นวางแห้ง'],
        ['i-2', 'DD-002', 'ไข่ไก่', 'โปรตีน', 'u-egg', 'ตู้เย็น'],
        ['i-3', 'DD-003', 'หมูสไลซ์', 'โปรตีน', 'u-kg', 'ตู้แช่แข็ง'],
        ['i-4', 'DD-004', 'กะหล่ำปลี', 'ผักและของสด', 'u-kg', 'ตู้เย็น'],
        ['i-5', 'DD-005', 'ซอสปรุงรส', 'เครื่องปรุง', 'u-bottle', 'ชั้นวางแห้ง'],
        ['i-6', 'DD-006', 'สาหร่าย', 'เครื่องปรุง', 'u-pack', 'ชั้นวางแห้ง'],
        ['i-7', 'DD-007', 'ชามกลับบ้าน', 'บรรจุภัณฑ์', 'u-piece', 'ชั้นบรรจุภัณฑ์'],
        ['i-8', 'DD-008', 'เส้นอุด้ง', 'เส้นและแป้ง', 'u-pack', 'ตู้เย็น'],
      ] as const
    ).map(([id, code, name, category, unitId, location], i) => ({
      id,
      code,
      name,
      category,
      unitId,
      location,
      note: 'ข้อมูลตัวอย่างสำหรับทดลอง',
      active: i !== 7,
      createdAt: now,
      updatedAt: now,
    })),
    events: [],
    countRounds: [],
    movements: [],
    stockChecks: [],
    stockPolicies: [],
    purchaseRequests: [],
    stockAudit: [],
    purchaseOrders: [],
    purchasePolicy: null,
    purchasePolicyAudit: [],
    receipts: [],
    expenses: [],
    expenseReviewer: null,
  };
}
