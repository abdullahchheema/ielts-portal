import { expect, test } from '@playwright/test';

/** Smoke paths through the real stack: a public page, a student, and an admin metric. Needs the demo seed. */
const enabled = !!process.env.E2E_BASE_URL;
test.skip(!enabled, 'Set E2E_BASE_URL to run the end-to-end suite against a running stack.');

async function logIn(page: import('@playwright/test').Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(process.env.E2E_PASSWORD ?? 'DemoPass123');
  await page.getByRole('button', { name: /log in/i }).click();
}

test('an unknown certificate code says it was not found', async ({ page }) => {
  await page.goto('/verify/IELTS-NOT-A-REAL-CODE');
  await expect(page.getByRole('heading', { name: /certificate not found/i })).toBeVisible();
});

test('a student reaches their dashboard', async ({ page }) => {
  await logIn(page, 'student1@example.com');
  await page.waitForURL(/\/student/);
  await expect(page.getByText(/Hello/)).toBeVisible();
});

test('an admin sees the command centre, and a metric links to a filtered list', async ({ page }) => {
  await logIn(page, 'admin@example.com');
  await page.waitForURL(/\/admin/);
  await page.goto('/admin');
  const metric = page.getByRole('link', { name: /pending|applications/i }).first();
  await expect(metric).toBeVisible();
  await metric.click();
  await expect(page).toHaveURL(/\/admin\//);
});
