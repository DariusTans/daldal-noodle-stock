import type { Currency, Role } from './types';

export const SCHEMA_VERSION = 6;
export const STORAGE_KEY = 'daldal-operations-data';

export const roles: Record<Role, string> = {
  owner: 'หุ้นส่วน / เจ้าของ',
  manager: 'ผู้จัดการ',
  staff: 'พนักงาน',
};

export const ingredientCategories = [
  'เส้นและแป้ง',
  'โปรตีน',
  'ผักและของสด',
  'เครื่องปรุง',
  'บรรจุภัณฑ์',
  'อื่น ๆ',
] as const;

export const unitTypes = ['จำนวน', 'น้ำหนัก', 'ปริมาตร'] as const;

export const countStatuses = ['draft', 'review', 'confirmed', 'cancelled'] as const;

export const movementKinds = {
  receive: 'รับเข้า',
  use: 'เบิกใช้',
  waste: 'ของเสีย',
  increase: 'ปรับเพิ่ม',
  decrease: 'ปรับลด',
  reverse: 'กลับรายการ',
} as const;

export const orderStatuses = {
  draft: 'ร่าง / เทียบทางเลือก',
  pending: 'รอพิจารณา',
  returned: 'ส่งกลับแก้ไข',
  approved: 'อนุมัติแล้ว',
  cleared: 'ตรวจแล้ว ไม่เข้าเกณฑ์วงเงิน',
  rejected: 'ไม่อนุมัติ',
  cancelled: 'ยกเลิก',
  ordered: 'ซื้อแล้ว รอตรวจรับ',
} as const;

export const currencies: Currency[] = ['THB', 'USD', 'KRW', 'JPY'];

export const receiptIssues = {
  none: 'ไม่พบปัญหา',
  short: 'ส่งไม่ครบ / รอส่วนที่ขาด',
  damaged: 'เสียหาย / คุณภาพไม่ผ่าน',
  wrong: 'ของไม่ตรงรายการ',
  other: 'ปัญหาอื่น',
} as const;

export const expenseStatuses = {
  draft: 'ร่าง',
  pending: 'รอตรวจ',
  returned: 'ส่งกลับแก้ไข',
  confirmed: 'ยืนยันแล้ว',
  cancelled: 'ยกเลิก',
} as const;

export const expenseCategories = [
  'วัตถุดิบ',
  'อุปกรณ์',
  'ค่าสาธารณูปโภค',
  'ค่าขนส่ง',
  'อื่น ๆ',
] as const;

export const attachmentTypes = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/pdf',
] as const;
export const ATTACHMENT_MAX_BYTES = 350000;
export const ATTACHMENTS_TOTAL_MAX_BYTES = 1400000;
