/**
 * Full shop journey in demo mode, switching between owner / manager / staff the way a real
 * shop would: purchase → approval → receiving → bill with evidence → review → report → count.
 */
import { expect, test, type Page } from '@playwright/test';

const ROLE = { owner: 'หุ้นส่วน / เจ้าของ', manager: 'ผู้จัดการ', staff: 'พนักงาน' } as const;

async function openShop(page: Page) {
  await page.goto('/');
  await expect(page.getByText('โหมดทดลอง').first()).toBeVisible();
  return new URL(page.url()).pathname.replace(/\/home$/, '');
}
const as = async (page: Page, role: keyof typeof ROLE) => {
  await page.getByRole('button', { name: ROLE[role], exact: true }).click();
  await expect(page.locator('header').getByText(ROLE[role], { exact: true })).toBeVisible();
};
const dialog = (page: Page) => page.getByRole('dialog');
const toast = (page: Page, text: string | RegExp) =>
  expect(page.getByRole('status').getByText(text)).toBeVisible();
const card = (page: Page, text: string) => page.locator('section').filter({ hasText: text });

// a minimal valid PNG (signature + IHDR … IEND)
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

test('purchase → approve → receive → bill → review → report → count', async ({ page }, info) => {
  test.skip(
    info.project.name === 'mobile',
    'long journey runs on desktop; mobile has its own test',
  );
  const base = await openShop(page);

  // ── manager opens an order from the ready request and compares offers
  await as(page, 'manager');
  await page.goto(base + '/buy');
  await card(page, 'ซอสปรุงรส · 10 ขวด').getByRole('button', { name: 'เปิดใบจัดซื้อ' }).click();
  await dialog(page).getByRole('button', { name: 'เปิดใบ' }).click();
  await toast(page, 'เปิดใบจัดซื้อแล้ว');

  const order = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: /ซอสปรุงรส · 10 ขวด/ }) });
  await order.getByRole('button', { name: '+ ทางเลือกซื้อ' }).click();
  const d = dialog(page);
  await d.getByLabel('แหล่งซื้อ / ร้านค้า').fill('ร้านซอส E2E');
  await d.getByLabel(/ขนาดแพ็ก/).fill('6');
  await d.getByLabel(/ราคาต่อแพ็ก/).fill('40');
  await d.getByLabel('ที่มาราคา / เลขอ้างอิง').fill('LINE ร้าน');
  await d.getByLabel(/เงื่อนไขราคา/).fill('ไม่มีเงื่อนไข');
  await d.getByRole('button', { name: 'บันทึก' }).click();
  await toast(page, 'บันทึกทางเลือกแล้ว');
  await expect(order.getByText('80.00 บาท')).toBeVisible(); // 2 packs × 40, rounded up to cover 10

  await order.getByRole('button', { name: 'เลือก', exact: true }).click();
  await dialog(page)
    .getByLabel(/เหตุผลที่เลือก/)
    .fill('ราคาดี ส่งไว');
  await dialog(page).getByRole('button', { name: 'เลือก' }).click();
  await toast(page, 'เลือกแหล่งซื้อแล้ว');
  await order.getByRole('button', { name: 'ส่งพิจารณา' }).click();
  await toast(page, 'ส่งพิจารณาแล้ว');
  await expect(order.getByText('รอ เจ้าของตัวอย่าง พิจารณา')).toBeVisible();

  // ── owner (the configured approver) approves
  await as(page, 'owner');
  await order.getByRole('button', { name: 'พิจารณา' }).click();
  await dialog(page).getByLabel('เหตุผล').fill('อนุมัติ');
  await dialog(page).getByRole('button', { name: 'บันทึกผลพิจารณา' }).click();
  await toast(page, 'บันทึกผลพิจารณาแล้ว');

  // ── manager records the external purchase (no stock yet)
  await as(page, 'manager');
  await order.getByRole('button', { name: 'บันทึกว่าซื้อแล้ว' }).click();
  await dialog(page)
    .getByLabel(/เลขคำสั่งซื้อ/)
    .fill('PO-E2E-1');
  await dialog(page)
    .getByLabel(/ซื้อตามรายละเอียด/)
    .check();
  await dialog(page).getByRole('button', { name: 'บันทึก' }).click();
  await toast(page, 'บันทึกซื้อแล้ว รอตรวจรับ');

  // ── staff drafts the receipt and never sees finance
  await as(page, 'staff');
  await expect(page.getByRole('navigation').getByRole('link', { name: 'ค่าใช้จ่าย' })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole('navigation').getByRole('link', { name: 'จัดซื้อและอนุมัติ' }),
  ).toHaveCount(0);
  await page.goto(base + '/receiving');
  const rec = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: /^ซอสปรุงรส/ }) });
  await rec.getByRole('button', { name: '+ ร่างใบรับ' }).click();
  await dialog(page)
    .getByLabel(/เลขส่งของ/)
    .fill('DEL-E2E-1');
  await dialog(page)
    .getByLabel(/รับจริง/)
    .fill('12');
  await dialog(page)
    .getByLabel(/ผลตรวจ \/ เหตุผล/)
    .fill('ครบ สภาพดี');
  await dialog(page).getByRole('button', { name: 'บันทึกร่าง' }).click();
  await toast(page, /บันทึกร่างรับแล้ว/);
  await expect(page.locator('main')).not.toContainText('80.00');
  await expect(rec.getByRole('button', { name: 'ยืนยันรับ' })).toHaveCount(0);

  // ── manager confirms (stock +12 exactly once) and closes receiving
  await as(page, 'manager');
  await rec.getByRole('button', { name: 'ยืนยันรับ' }).click();
  await dialog(page)
    .getByLabel(/ตรวจของจริง/)
    .check();
  await dialog(page)
    .getByLabel(/ยังไม่ได้รวมจำนวนนี้/)
    .check();
  await dialog(page).getByRole('button', { name: 'ยืนยันรับเข้าสต็อก' }).click();
  await toast(page, 'รับเข้าสต็อกแล้ว');
  await rec.getByRole('button', { name: 'ปิดงานรับ' }).click();
  await dialog(page)
    .getByLabel(/เหตุผล \/ หลักฐานปิดรับ/)
    .fill('รับครบ');
  await dialog(page)
    .getByLabel(/ยืนยันปิดงานรับ/)
    .check();
  await dialog(page).getByRole('button', { name: 'ปิดงานรับ' }).click();
  await toast(page, 'ปิดงานรับแล้ว');

  await page.goto(base + '/movements');
  const sauce = page.getByRole('row').filter({ hasText: 'ซอสปรุงรส' }).first();
  await expect(sauce).toContainText('14 ขวด'); // counted 2 + received 12
  await expect(sauce).toContainText('รอตรวจความครบ');

  // ── manager records the bill with an uploaded file, linked to the order
  await page.goto(base + '/expenses');
  await page.getByRole('button', { name: '+ บันทึกบิล' }).click();
  const b = dialog(page);
  await b.getByLabel('ร้านค้า / ผู้รับเงิน').fill('ร้านซอส E2E');
  await b.getByLabel('ยอดเงิน').fill('80');
  await b.getByLabel('ผู้จ่าย').fill('ผู้จัดการตัวอย่าง');
  await b.getByLabel(/อ้างอิงใบซื้อ/).selectOption({ label: 'ซอสปรุงรส · PO-E2E-1' });
  await b.getByLabel('รายละเอียด').fill('ค่าซอส 2 แพ็ก');
  await b
    .getByLabel(/ไฟล์หลักฐาน/)
    .setInputFiles({ name: 'bill.png', mimeType: 'image/png', buffer: PNG });
  await b.getByRole('button', { name: 'บันทึกร่าง' }).click();
  await toast(page, 'บันทึกร่างแล้ว');
  const bill = page.getByRole('row').filter({ hasText: 'ร้านซอส E2E' });
  await expect(bill.getByText('ดูหลักฐาน (bill.png)')).toBeVisible();
  await bill.getByRole('button', { name: 'ส่งตรวจ' }).click();
  await dialog(page).getByRole('button', { name: 'ส่งตรวจ' }).click();
  await toast(page, 'ส่งตรวจแล้ว');

  // ── owner (the expense reviewer) confirms it
  await as(page, 'owner');
  await bill.getByRole('button', { name: 'ตรวจ', exact: true }).click();
  await dialog(page).getByLabel('บันทึกผลตรวจ').fill('ตรงกับใบซื้อ');
  await dialog(page)
    .getByLabel(/ตรวจหลักฐานและรายละเอียดแล้ว/)
    .check();
  const exceptions = dialog(page).getByLabel(/ทบทวนข้อควรตรวจ/);
  if (await exceptions.count()) await exceptions.check();
  await dialog(page).getByRole('button', { name: 'บันทึกผลตรวจ' }).click();
  await toast(page, 'บันทึกผลตรวจแล้ว');
  await expect(page.getByText('580.00 บาท').first()).toBeVisible(); // 500 demo + 80

  // ── report keeps purchases and expenses apart
  await page.goto(base + '/dashboard');
  await expect(page.getByText('ยอดซื้อ (THB)')).toBeVisible();
  await expect(
    page
      .locator('div')
      .filter({ hasText: /^ยอดซื้อ \(THB\)/ })
      .getByText('610.00 บาท'),
  ).toBeVisible();
  await expect(
    page
      .locator('div')
      .filter({ hasText: /^ค่าใช้จ่ายยืนยันแล้ว \(THB\)/ })
      .getByText('580.00 บาท')
      .first(),
  ).toBeVisible();

  // ── staff counts, manager confirms
  await as(page, 'staff');
  await page.goto(base + '/counting');
  await page.getByRole('button', { name: '+ เปิดรอบนับ' }).click();
  await dialog(page).getByRole('button', { name: 'เปิดรอบ' }).click();
  await toast(page, 'เปิดรอบนับแล้ว');
  for (const input of await page.getByLabel(/^ยอดนับ /).all()) await input.fill('5');
  for (const input of await page.getByLabel(/^คำอธิบาย /).all())
    await input.fill('นับจริงหลังปิดร้าน');
  await page.getByRole('button', { name: 'บันทึกและส่งตรวจ' }).click();
  await toast(page, 'ส่งตรวจแล้ว');
  await as(page, 'manager');
  await page.getByRole('button', { name: 'ยืนยันยอดนับ' }).click();
  await dialog(page).getByRole('button', { name: 'ยืนยันและล็อกรอบ' }).click();
  await toast(page, 'ยืนยันยอดนับแล้ว');
  await page.goto(base + '/latest');
  await expect(page.getByRole('row').filter({ hasText: 'ซอสปรุงรส' })).toContainText('5 ขวด');
});

test('a stale tab gets a conflict instead of overwriting another tab', async ({ context }) => {
  const a = await context.newPage();
  const base = await openShop(a);
  const b = await context.newPage();
  await b.goto(base + '/units');
  await a.goto(base + '/units');

  const addUnit = async (page: Page, name: string) => {
    await page.getByRole('button', { name: '+ เพิ่มหน่วย' }).click();
    await dialog(page).getByLabel('ชื่อ').fill(name);
    await dialog(page).getByLabel('หน่วยย่อ').fill(name);
    await dialog(page).getByRole('button', { name: 'บันทึก' }).click();
  };
  await addUnit(a, 'ลัง');
  await toast(a, 'บันทึกหน่วยแล้ว');
  await addUnit(b, 'กล่อง'); // b still shows the old revision
  await toast(b, /ข้อมูลเปลี่ยนจากผู้ใช้อื่นแล้ว/);
  await expect(dialog(b).getByRole('alert')).toContainText('ข้อมูลเปลี่ยนแล้ว');
  await expect(b.getByRole('row').filter({ hasText: 'ลัง' })).toBeVisible(); // b reloaded the latest
  await dialog(b).getByRole('button', { name: 'บันทึก' }).click(); // retry on the fresh revision
  await toast(b, 'บันทึกหน่วยแล้ว');
  await a.reload();
  await expect(a.getByRole('row').filter({ hasText: 'กล่อง' })).toBeVisible();
  await expect(a.getByRole('row').filter({ hasText: 'ลัง' })).toBeVisible();
});

test('mobile: navigation drawer and a staff movement', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'mobile only');
  await openShop(page);
  await as(page, 'staff');
  await page.getByRole('button', { name: 'เปิดเมนู' }).click();
  await page.getByRole('navigation').getByRole('link', { name: 'เคลื่อนไหว / ตรวจครบ' }).click();
  await expect(page.locator('main h1')).toHaveText('เคลื่อนไหว / ตรวจครบ');
  await page.getByRole('button', { name: '+ บันทึกเคลื่อนไหว' }).click();
  const d = dialog(page);
  await d.getByLabel('วัตถุดิบ').selectOption({ label: 'สาหร่าย' });
  await d.getByLabel('ประเภท').selectOption({ label: 'เบิกใช้' });
  await expect(d.getByLabel('ประเภท').locator('option', { hasText: 'ปรับเพิ่ม' })).toHaveCount(0); // staff cannot adjust
  await d.getByLabel('จำนวน').fill('1');
  await d.getByLabel(/เหตุผล/).fill('ใช้ทำราเมง');
  await d.getByRole('button', { name: 'บันทึก' }).click();
  await toast(page, 'บันทึกแล้ว');
  await expect(page.getByRole('row').filter({ hasText: 'ใช้ทำราเมง' })).toContainText(
    'พนักงานตัวอย่าง',
  );
});
