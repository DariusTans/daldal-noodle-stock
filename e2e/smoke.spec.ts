import { expect, test } from '@playwright/test';

test('every page renders without errors in demo mode', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/');
  await expect(page.getByText('โหมดทดลอง').first()).toBeVisible();
  await page.screenshot({ path: 'test-output/e2e/home.png', fullPage: true });
  const url = new URL(page.url());
  const base = url.pathname.replace(/\/home$/, '');
  for (const p of [
    'counting',
    'latest',
    'movements',
    'alerts',
    'buy',
    'receiving',
    'expenses',
    'dashboard',
    'settings',
    'ingredients',
    'units',
    'members',
  ]) {
    await page.goto(base + '/' + p);
    await expect(page.locator('main h1')).toBeVisible();
    await page.screenshot({ path: `test-output/e2e/${p}.png`, fullPage: true });
  }
  expect(errors).toEqual([]);
});
