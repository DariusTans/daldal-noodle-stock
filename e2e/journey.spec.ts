/**
 * Full shop journey in demo mode on the prototype-identical UI, switching roles with the
 * legacy "ทดลองบทบาท" picker: purchase → approval → receiving → bill with evidence → review →
 * report → count.
 */
import { expect, test, type Page } from '@playwright/test';

const ROLE = { owner: 'หุ้นส่วน / เจ้าของ', manager: 'ผู้จัดการ', staff: 'พนักงาน' } as const;
const AVATAR = { owner: 'PJ', manager: 'MG', staff: 'ST' } as const;

async function openShop(page: Page) {
  await page.goto('/');
  await expect(page.locator('.demo-bar')).toBeVisible();
  return new URL(page.url()).pathname.replace(/\/home$/, '');
}
const as = async (page: Page, role: keyof typeof ROLE) => {
  await page.locator('#role').selectOption({ label: ROLE[role] });
  await expect(page.locator('#avatar')).toHaveText(AVATAR[role]);
};
const dialog = (page: Page) => page.locator('dialog[open]');
const toast = (page: Page, text: string | RegExp) =>
  expect(page.locator('#toast')).toContainText(text);
const row = (page: Page, text: string) => page.getByRole('row').filter({ hasText: text });

// a minimal valid PNG
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

  // ── manager opens an order from the reviewed request and compares offers
  await as(page, 'manager');
  await page.goto(base + '/buy');
  await row(page, 'ซอสปรุงรส').getByRole('button', { name: 'เปิดใบจัดซื้อ' }).click();
  await dialog(page).getByRole('button', { name: 'เปิดใบจัดซื้อ' }).click();
  await toast(page, 'บันทึกเรียบร้อย');
  await expect(page.locator('.count-banner h2')).toHaveText('ซอสปรุงรส'); // the new order opens

  await page.locator('#buy-add-offer').click();
  const d = dialog(page);
  await d.getByLabel('ร้าน / แหล่งซื้อ *').fill('ร้านซอส E2E');
  await d.getByLabel(/ต่อชุดซื้อ \*/).fill('6');
  await d.getByLabel('ราคาต่อชุดซื้อ รวมภาษี *').fill('40');
  await d.getByLabel('ที่มาราคา / เลขอ้างอิง *').fill('LINE ร้าน');
  await d.getByLabel(/เงื่อนไข \/ คูปอง/).fill('ไม่มีเงื่อนไข');
  await d.getByRole('button', { name: 'บันทึกทางเลือก' }).click();
  await toast(page, 'บันทึกเรียบร้อย');
  await expect(page.locator('.quote-table')).toContainText('80.00 THB'); // 2 packs × 40 cover 10

  await page.locator('.quote-table').getByRole('button', { name: 'เลือก', exact: true }).click();
  await dialog(page).getByLabel('เหตุผล *').fill('ราคาดี ส่งไว');
  await dialog(page).getByRole('button', { name: 'เลือกแหล่งซื้อ' }).click();
  await expect(page.locator('.buy-selection')).toContainText('ราคาดี ส่งไว');
  await page.locator('#buy-submit').click();
  await dialog(page).getByRole('button', { name: 'ส่งพิจารณา' }).click();
  await expect(page.locator('.count-banner .chip')).toHaveText('รอพิจารณา');
  await expect(page.locator('#buy-approve')).toHaveCount(0); // manager is not the approver

  // ── owner (the configured approver) approves
  await as(page, 'owner');
  await page.locator('#buy-approve').click();
  await dialog(page).getByLabel('เหตุผล *').fill('อนุมัติ');
  await dialog(page).getByRole('button', { name: 'ยืนยันผลพิจารณา' }).click();
  await expect(page.locator('.count-banner .chip')).toHaveText('อนุมัติแล้ว');

  // ── manager records the external purchase (no stock yet)
  await as(page, 'manager');
  await page.locator('#buy-ordered').click();
  await dialog(page).getByLabel('เลขคำสั่งซื้อ / หลักฐาน *').fill('PO-E2E-1');
  await dialog(page).getByLabel('ซื้อภายนอกแล้วตามรายละเอียดที่ผ่านพิจารณา').check();
  await dialog(page).getByRole('button', { name: 'บันทึกซื้อแล้ว รอตรวจรับ' }).click();
  await expect(page.locator('.review-feedback').filter({ hasText: 'PO-E2E-1' })).toBeVisible();

  // ── staff drafts the receipt and never sees prices
  await as(page, 'staff');
  await page.goto(base + '/buy');
  await expect(page.locator('main')).toContainText('บทบาทนี้ยังไม่เปิดข้อมูลราคาและจัดซื้อ');
  await page.goto(base + '/receiving');
  await row(page, 'ซอสปรุงรส').getByRole('button', { name: 'เปิดตรวจรับ' }).click();
  await page.locator('#receive-edit').click();
  await dialog(page).getByLabel('เลขส่งของ / ครั้งส่งที่ไม่ซ้ำ *').fill('DEL-E2E-1');
  await dialog(page).getByLabel('จำนวนผ่านตรวจ รับเข้าสต็อก *').fill('12');
  await dialog(page)
    .getByLabel(/จำนวนไม่รับ/)
    .fill('0');
  await dialog(page)
    .getByLabel(/รายละเอียดผลตรวจ/)
    .fill('ครบ สภาพดี');
  await dialog(page).getByRole('button', { name: 'บันทึกร่าง' }).click();
  await toast(page, 'บันทึกตรวจรับแล้ว');
  await expect(page.locator('main')).not.toContainText('80.00');
  await expect(page.locator('#receive-confirm')).toHaveCount(0);

  // ── manager confirms (stock +12 exactly once) and closes receiving
  await as(page, 'manager');
  await page.locator('#receive-confirm').click();
  await dialog(page).getByLabel('ตรวจจำนวนและคุณภาพสินค้าจริงแล้ว').check();
  await dialog(page)
    .getByLabel(/ยังไม่เคยลงรับ/)
    .check();
  await dialog(page).getByRole('button', { name: 'ยืนยันและลงสต็อก' }).click();
  await expect(page.locator('.receive-card .chip').first()).toHaveText('ยืนยันแล้ว');
  await page.locator('#receive-close').click();
  await dialog(page).getByLabel('เหตุผล / หลักฐานปิดรับ *').fill('รับครบ');
  await dialog(page).getByLabel('ตรวจประวัติรับและตกลงปิดงานแล้ว').check();
  await dialog(page).getByRole('button', { name: 'ยืนยันปิดรับ' }).click();
  await expect(page.locator('.count-banner .chip')).toHaveText('รับครบและปิดแล้ว');

  await page.goto(base + '/movements');
  const sauce = page.locator('.stock-table').getByRole('row').filter({ hasText: 'ซอสปรุงรส' });
  await expect(sauce).toContainText('14 ขวด'); // counted 2 + received 12
  await expect(sauce).toContainText('ยังไม่รับรองข้อมูลเคลื่อนไหวครบ');

  // ── manager records the bill with an uploaded file, linked to the order
  await page.goto(base + '/expenses');
  await page.locator('#expense-new').click();
  const b = dialog(page);
  await b
    .locator('#expense-file')
    .setInputFiles({ name: 'bill.png', mimeType: 'image/png', buffer: PNG });
  await b.getByLabel('ร้านค้า / ผู้รับเงิน *').fill('ร้านซอส E2E');
  await b
    .getByLabel('วันที่บิล *')
    .fill(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }));
  await b.getByLabel('ยอดรวมทั้งบิล *').fill('80');
  await b.getByLabel('ชื่อผู้จ่ายเงินจริง *').fill('ผู้จัดการตัวอย่าง');
  await b.getByLabel(/เชื่อมใบซื้อ/).selectOption({ label: 'PO-E2E-1 · ซอสปรุงรส' });
  await b.getByLabel('รายละเอียดค่าใช้จ่าย *').fill('ค่าซอส 2 แพ็ก');
  await b.getByRole('button', { name: 'บันทึกร่าง' }).click();
  await toast(page, 'บันทึกค่าใช้จ่ายแล้ว');
  await page
    .locator('.expense-row')
    .filter({ hasText: 'ร้านซอส E2E' })
    .getByRole('button', { name: 'ดูรายละเอียด' })
    .click();
  await expect(page.locator('.expense-totals').first()).toContainText('หลักฐาน: bill.png');
  await page.locator('#expense-submit').click();
  await dialog(page).getByRole('button', { name: 'ส่งตรวจ' }).click();
  await expect(page.locator('.count-banner .chip')).toHaveText('รอตรวจ');

  // ── owner (the expense reviewer) confirms it
  await as(page, 'owner');
  await page.locator('#expense-confirm').click();
  await dialog(page)
    .getByLabel(/ผลตรวจ \/ เหตุผลรับรอง/)
    .fill('ตรงกับใบซื้อ');
  await dialog(page).getByLabel('ตรวจยอด วันที่ แหล่งเงิน และหลักฐานแล้ว').check();
  const exceptions = dialog(page).getByLabel(/ตรวจข้อสังเกต/);
  if (await exceptions.count()) await exceptions.check();
  await dialog(page).getByRole('button', { name: 'ยืนยันรวมค่าใช้จ่าย' }).click();
  await expect(page.locator('.count-banner .chip')).toHaveText('ยืนยันแล้ว');
  await page.locator('#expense-back').click();
  await expect(
    page.locator('section.expense-totals').filter({ hasText: 'ค่าใช้จ่ายที่ยืนยันแล้วทั้งหมด' }),
  ).toContainText('580.00 THB'); // 500 demo + 80

  // ── report keeps purchases and expenses apart
  await page.goto(base + '/dashboard');
  await expect(page.locator('.report-purchase-totals')).toContainText('610.00 THB');
  await expect(page.locator('.report-money-card strong')).toHaveText('580.00 THB');

  // ── staff counts, manager confirms
  await as(page, 'staff');
  await page.goto(base + '/counting');
  await page.locator('#new-count').click();
  await dialog(page).getByRole('button', { name: 'เปิดรอบนับ' }).click();
  await toast(page, 'เปิดรอบนับแล้ว');
  for (const input of await page.getByLabel(/^ยอดนับ /).all()) await input.fill('5');
  for (const input of await page.getByLabel(/^เหตุผล /).all())
    await input.fill('นับจริงหลังปิดร้าน');
  await page.locator('#submit-count').click();
  await toast(page, /ส่งตรวจแล้ว/);
  await as(page, 'manager');
  await page.locator('#confirm-count').click();
  await dialog(page).getByRole('button', { name: 'ยืนยันยอดนับ' }).click();
  await toast(page, 'ยืนยันยอดนับแล้ว');
  await page.goto(base + '/latest');
  await expect(row(page, 'ซอสปรุงรส')).toContainText('5 ขวด');
});

test('a stale tab gets a conflict instead of overwriting another tab', async ({ context }) => {
  const a = await context.newPage();
  const base = await openShop(a);
  const b = await context.newPage();
  await b.goto(base + '/units');
  await a.goto(base + '/units');

  const addUnit = async (page: Page, name: string) => {
    await page.locator('#add-unit').click();
    await dialog(page).getByLabel('ชื่อหน่วย *').fill(name);
    await dialog(page).getByLabel('หน่วยย่อ *').fill(name);
    await dialog(page).getByRole('button', { name: 'บันทึกข้อมูล' }).click();
  };
  await addUnit(a, 'ลัง');
  await toast(a, 'บันทึกหน่วยแล้ว');
  await addUnit(b, 'กล่อง'); // b still shows the old revision
  await toast(b, /ข้อมูลเปลี่ยนจากผู้ใช้อื่นแล้ว/);
  await expect(dialog(b).locator('.form-error')).toContainText('ข้อมูลเปลี่ยนแล้ว');
  await expect(row(b, 'ลัง')).toBeVisible(); // b reloaded the latest
  await dialog(b).getByRole('button', { name: 'บันทึกข้อมูล' }).click(); // retry on the fresh revision
  await toast(b, 'บันทึกหน่วยแล้ว');
  await a.reload();
  await expect(row(a, 'กล่อง')).toBeVisible();
  await expect(row(a, 'ลัง')).toBeVisible();
});

test('mobile: navigation drawer and a staff movement', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'mobile only');
  await openShop(page);
  await as(page, 'staff');
  await page.getByRole('button', { name: 'เปิดเมนู' }).click();
  await expect(page.locator('#sidebar')).toHaveClass(/open/);
  await page.getByRole('navigation').getByRole('button', { name: 'เคลื่อนไหว / ตรวจครบ' }).click();
  await expect(page.locator('main h1')).toHaveText('เคลื่อนไหวสต็อก');
  await page.locator('#add-movement').click();
  const d = dialog(page);
  await d.getByLabel('วัตถุดิบ *').selectOption({ label: 'สาหร่าย (แพ็ก)' });
  await d.getByLabel('ประเภท *').selectOption({ label: 'เบิกใช้' });
  await expect(d.getByLabel('ประเภท *').locator('option', { hasText: 'ปรับเพิ่ม' })).toHaveCount(0); // staff cannot adjust
  await d.getByLabel('จำนวน *').fill('1');
  await d.getByLabel('เหตุผล / รายละเอียด *').fill('ใช้ทำราเมง');
  await d.getByRole('button', { name: 'บันทึกรายการ' }).click();
  await toast(page, 'บันทึกเรียบร้อย');
  await expect(row(page, 'ใช้ทำราเมง')).toContainText('พนักงานตัวอย่าง');
});
