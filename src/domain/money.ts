import type { Minor } from './types';
import { fail } from './util';

/** Purchase money input → minor units. Zero allowed. */
export function parseMoney(v: unknown): Minor {
  const str = String(v ?? '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(str)) fail('จำนวนเงินต้องไม่ติดลบและมีทศนิยมไม่เกิน 2 ตำแหน่ง');
  const n = Number(str);
  if (!Number.isFinite(n) || n > 1e9) fail('จำนวนเงินเกินขนาด');
  return Math.round(n * 100);
}

/** Expense amount input → minor units. Must be > 0. */
export function parseExpenseAmount(v: unknown): Minor {
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(String(v)))
    fail('กรอกยอดเงินมากกว่าศูนย์ ทศนิยมไม่เกิน 2 หลัก');
  const n = Math.round(Number(v) * 100);
  if (n <= 0) fail('ยอดเงินต้องมากกว่าศูนย์');
  return n;
}

/** Minor units → "1,234.50" display string. */
export const formatMinor = (minor: Minor): string =>
  (minor / 100).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
