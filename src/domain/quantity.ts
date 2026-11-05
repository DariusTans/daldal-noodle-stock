import { fail, isQuantity } from './util.js';

/** Parse a count/stock quantity. Blank → null (blank means "not counted", never zero). */
export function parseQuantity(v: unknown): number | null {
  if (v === null || (typeof v === 'string' && !v.trim())) return null;
  if (typeof v === 'string' && !/^\d+(\.\d{1,3})?$/.test(v.trim()))
    fail('จำนวนต้องเป็นศูนย์หรือจำนวนบวก ทศนิยมไม่เกิน 3 ตำแหน่ง');
  const n = typeof v === 'number' ? v : Number((v as string).trim());
  if (!isQuantity(n)) fail('จำนวนไม่ถูกต้อง สูงสุด 1,000,000,000 และทศนิยม 3 ตำแหน่ง');
  return n;
}

/** Positive purchase quantity. */
export function positiveQuantity(v: unknown): number {
  const n = parseQuantity(v);
  if (n === null || n <= 0) fail('จำนวนต้องมากกว่าศูนย์');
  return n as number;
}
